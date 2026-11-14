"""
ML Generator ("The Brain") and asynchronous step sequencer conditioned on live guitar DSP.
"""

from __future__ import annotations

import logging
import threading
import time

from .config import MusicalState, SessionConfig
from .generative import (
    GM_CLOSED_HAT,
    GM_CRASH,
    GM_HIGH_TOM,
    GM_KICK,
    GM_LOW_TOM,
    GM_MID_TOM,
    GM_OPEN_HAT,
    GM_SNARE,
    LiveContext,
    LiveGrooveGenerator,
    MidiStepEvent,
    infer_key,
)
from .midi_egress import MidiEgress

logger = logging.getLogger(__name__)

KEY_TO_BASS_MIDI: dict[str, int] = {
    "C": 36, "C#": 37, "D": 38, "D#": 39, "E": 40, "F": 41,
    "F#": 42, "G": 43, "G#": 44, "A": 45, "A#": 46, "B": 47,
}

# Minor-key rock progression (i - VI - III - VII), one bar each.
BASS_PROGRESSION = (0, 8, 3, 10)


def generate_drum_midi(bpm: float, bar: int = 0) -> list[MidiStepEvent]:
    """Four-bar rock groove: 8th-note hats, kick/snare backbeat, crash + fill.

    ``bar`` cycles 0-3 so crashes land on the downbeat of every 4th bar and the
    last bar ends with a tom fill, instead of looping one static bar forever.
    """
    _ = bpm
    events: list[MidiStepEvent] = []

    # Closed hi-hats on every 8th, accenting the beat.
    for step in range(0, 16, 2):
        events.append(MidiStepEvent(step, GM_CLOSED_HAT, 98 if step % 4 == 0 else 76))

    # Kick pattern driving the groove.
    for step, vel in ((0, 124), (6, 106), (8, 120), (11, 98)):
        events.append(MidiStepEvent(step, GM_KICK, vel))

    # Snare backbeat on 2 and 4.
    events.append(MidiStepEvent(4, GM_SNARE, 118))
    events.append(MidiStepEvent(12, GM_SNARE, 122))

    # Ghost note for a live feel.
    events.append(MidiStepEvent(7, GM_SNARE, 38))

    # Open hat lifts the end of the bar.
    events.append(MidiStepEvent(14, GM_OPEN_HAT, 86))

    # Crash on the downbeat of each 4-bar phrase.
    if bar % 4 == 0:
        events.append(MidiStepEvent(0, GM_CRASH, 112))

    # Tom fill closing the phrase.
    if bar % 4 == 3:
        fill = ((12, GM_SNARE), (13, GM_HIGH_TOM), (14, GM_MID_TOM), (15, GM_LOW_TOM))
        for step, note in fill:
            events.append(MidiStepEvent(step, note, 100 + (step - 12) * 6))

    return events


def generate_bass_midi(key: str, bpm: float, bar: int = 0) -> list[MidiStepEvent]:
    """Walking rock bass line that follows a 4-bar i-VI-III-VII progression."""
    _ = bpm
    root = KEY_TO_BASS_MIDI.get(key.upper(), 40)
    chord_root = root + BASS_PROGRESSION[bar % len(BASS_PROGRESSION)]

    # (step, interval above chord root, velocity)
    pattern = (
        (0, 0, 120),
        (3, 0, 92),
        (6, 7, 110),   # fifth
        (8, 12, 112),  # octave
        (11, 10, 100), # flat seventh
        (14, 5, 104),  # fourth, leading back
    )
    return [MidiStepEvent(step, chord_root + interval, vel) for step, interval, vel in pattern]


class MLSequencer:
    """Asynchronous step sequencer pulling live guitar DSP and feeding DrumRNN & MelodyRNN."""

    def __init__(self, config: SessionConfig, state: MusicalState, egress: MidiEgress) -> None:
        self.config = config
        self.state = state
        self.egress = egress
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._last_valid_key = getattr(config, "default_key", "E")
        self._generator = LiveGrooveGenerator(creativity=float(getattr(config, "creativity", 0.5)))
        self._bar_events: tuple[list[MidiStepEvent], list[MidiStepEvent]] = ([], [])

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info("Live-conditioned ML Sequencer started (Drum ch=10, Bass ch=2)")

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=1.0)
            self._thread = None
        logger.info("Live-conditioned ML Sequencer stopped")

    def _run_loop(self) -> None:
        step = 0
        bar = 0
        held_bass: list[tuple[int, float]] = []
        while not self._stop_event.is_set():
            snapshot = self.state.snapshot()

            # The session owns the arm/stop decision (BPM+key lock, silence timeout).
            if not snapshot.get("band_active", False):
                for note, _started in list(held_bass):
                    self.egress.note_off(channel=2, note=note)
                held_bass.clear()
                self._stop_event.wait(0.05)
                continue

            raw_bpm = snapshot.get("bpm")
            bpm = float(raw_bpm) if raw_bpm is not None else 120.0
            if bpm <= 0:
                bpm = 120.0

            key_str = str(snapshot.get("key", "E Minor"))
            root_key = key_str.split()[0] if key_str else self._last_valid_key
            self._last_valid_key = root_key

            step_dur = 60.0 / bpm / 4.0
            now = time.monotonic()

            # Release bass notes so they never pile up into mud.
            for note, started in list(held_bass):
                if now - started >= step_dur * 1.8:
                    self.egress.note_off(channel=2, note=note)
                    held_bass.remove((note, started))

            # Generate a fresh bar whenever the step counter wraps.
            if step == 0:
                root_pc, mode = infer_key(
                    tuple(snapshot.get("pitch_classes") or ()),
                    fallback_pc=KEY_TO_BASS_MIDI.get(root_key.upper(), 40) % 12,
                )
                ctx = LiveContext(
                    bpm=bpm,
                    root_pc=root_pc,
                    mode=mode,
                    rms=float(snapshot.get("rms") or 0.0),
                    centroid=float(snapshot.get("spectral_centroid_hz") or 0.0),
                    pitch_classes=tuple(snapshot.get("pitch_classes") or ()),
                    creativity=self._generator.creativity,
                )
                self._bar_events = self._generator.next_bar(ctx)
                logger.debug("New bar: %s", self._generator.describe(ctx))

            drums, bass = self._bar_events

            for ev in drums:
                if ev.step == step:
                    self.egress.note_on(channel=10, note=ev.note, velocity=ev.velocity)

            for ev in bass:
                if ev.step == step:
                    self.egress.note_on(channel=2, note=ev.note, velocity=ev.velocity)
                    held_bass.append((ev.note, now))

            try:
                self.state.update(current_step=step, active_root=root_key)
            except Exception:
                pass

            step = (step + 1) % 16
            if step == 0:
                bar = (bar + 1) % 4
            time.sleep(step_dur)
