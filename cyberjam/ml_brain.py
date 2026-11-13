"""ML Generator Stubs ("The Brain") and asynchronous step sequencer.

This module isolates the DrumRNN and MelodyRNN integration boundary.
Replace the bodies of `generate_drum_midi` and `generate_bass_midi` with
actual model inference when the trained checkpoints are ready.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
import threading
import time

from .config import MusicalState, SessionConfig
from .midi_egress import MidiEgress

logger = logging.getLogger(__name__)

# General MIDI Drum Map (Channel 10 / index 9)
GM_KICK = 36
GM_SNARE = 38
GM_CLOSED_HAT = 42

# Pitch class to MIDI note in octave 2 (C2 = 36 .. B2 = 47)
KEY_TO_BASS_MIDI: dict[str, int] = {
    "C": 36,
    "C#": 37,
    "D": 38,
    "D#": 39,
    "E": 40,
    "F": 41,
    "F#": 42,
    "G": 43,
    "G#": 44,
    "A": 45,
    "A#": 46,
    "B": 47,
}


@dataclass(frozen=True)
class MidiStepEvent:
    """A single quantized MIDI event within a 16-step (4/4) bar."""

    step: int             # 0..15 (16th-note index in a 4/4 bar)
    note: int             # MIDI note number (0..127)
    velocity: int         # MIDI velocity (1..127)
    duration_steps: int   # Note length in 16th-note steps


def generate_drum_midi(bpm: float) -> list[MidiStepEvent]:
    """ML STUB (DrumRNN): Generate a 1-bar (16-step) 4/4 drum pattern.

    Args:
        bpm: Current detected tempo in beats per minute.

    Returns:
        List of quantized `MidiStepEvent` objects for a 4/4 bar:
        - Kick (36) on beats 1 and 3 (steps 0, 8)
        - Snare (38) on beats 2 and 4 (steps 4, 12)
        - Closed Hi-Hat (42) on 8th-note subdivisions
    """
    _ = bpm  # Reserved for tempo-conditioned DrumRNN inference
    events: list[MidiStepEvent] = []

    for step in range(16):
        if step in (0, 8):
            events.append(MidiStepEvent(step=step, note=GM_KICK, velocity=115, duration_steps=2))
        if step in (4, 12):
            events.append(MidiStepEvent(step=step, note=GM_SNARE, velocity=105, duration_steps=2))
        if step % 2 == 0:
            vel = 85 if step % 4 == 0 else 65
            events.append(MidiStepEvent(step=step, note=GM_CLOSED_HAT, velocity=vel, duration_steps=1))

    return events


def generate_bass_midi(key: str, bpm: float) -> list[MidiStepEvent]:
    """ML STUB (MelodyRNN): Generate a 1-bar (16-step) bassline in the detected key.

    Args:
        key: Detected musical pitch class (e.g., "E", "A", "C#").
        bpm: Current detected tempo in beats per minute.

    Returns:
        List of quantized `MidiStepEvent` objects forming a root/fifth/octave groove.
    """
    _ = bpm  # Reserved for tempo-conditioned MelodyRNN inference
    root = KEY_TO_BASS_MIDI.get(key, 40)  # Default to E2 (40)
    fifth = root + 7
    octave = root + 12

    return [
        MidiStepEvent(step=0, note=root, velocity=110, duration_steps=3),
        MidiStepEvent(step=4, note=root, velocity=95, duration_steps=2),
        MidiStepEvent(step=6, note=fifth, velocity=90, duration_steps=2),
        MidiStepEvent(step=8, note=root, velocity=105, duration_steps=3),
        MidiStepEvent(step=12, note=octave, velocity=95, duration_steps=2),
        MidiStepEvent(step=14, note=fifth, velocity=85, duration_steps=2),
    ]


class MLSequencer:
    """Dedicated background thread that steps through ML-generated bars without blocking audio."""

    def __init__(self, config: SessionConfig, state: MusicalState, midi: MidiEgress) -> None:
        self.config = config
        self.state = state
        self.midi = midi
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Launch the asynchronous ML MIDI sequencer thread."""
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="CyberJamMLSequencer",
            daemon=True,
        )
        self._thread.start()
        logger.info("ML Sequencer started (Drum ch=%d, Bass ch=%d)", self.config.drum_channel + 1, self.config.bass_channel + 1)

    def stop(self) -> None:
        """Stop the ML sequencer thread cleanly."""
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        logger.info("ML Sequencer stopped.")

    def _run_loop(self) -> None:
        step = 0
        drum_pattern = generate_drum_midi(self.config.default_bpm)
        bass_pattern = generate_bass_midi(self.config.default_key, self.config.default_bpm)

        # Track active note-offs: step_to_release -> list of (channel, note)
        pending_note_offs: dict[int, list[tuple[int, int]]] = {}
        next_step_time = time.perf_counter()

        while not self._stop_event.is_set():
            snap = self.state.snapshot()
            bpm = float(snap["bpm"])  # type: ignore[arg-type]
            pitch_info = snap["detected_pitch"]  # type: ignore[assignment]
            key = str(pitch_info["key"])  # type: ignore[index]

            # Refresh bar patterns at the start of every 4/4 bar
            if step == 0:
                drum_pattern = generate_drum_midi(bpm)
                bass_pattern = generate_bass_midi(key, bpm)

            # 1. Release any notes scheduled to end on this step
            for ch, note in pending_note_offs.pop(step, []):
                self.midi.note_off(ch, note)

            # 2. Trigger drum & bass notes for this step
            self._trigger_step_events(step, drum_pattern, self.config.drum_channel, pending_note_offs)
            self._trigger_step_events(step, bass_pattern, self.config.bass_channel, pending_note_offs)

            # 3. Drift-compensated 16th-note sleep
            sixteenth_sec = 60.0 / max(40.0, min(240.0, bpm)) / 4.0
            next_step_time += sixteenth_sec
            sleep_for = next_step_time - time.perf_counter()
            if sleep_for > 0:
                self._stop_event.wait(timeout=sleep_for)
            else:
                # Resync clock if thread was stalled
                next_step_time = time.perf_counter()

            step = (step + 1) % 16

        # Flush any hanging notes on exit
        for notes in pending_note_offs.values():
            for ch, note in notes:
                self.midi.note_off(ch, note)

    def _trigger_step_events(
        self,
        step: int,
        events: list[MidiStepEvent],
        channel: int,
        pending_note_offs: dict[int, list[tuple[int, int]]],
    ) -> None:
        for ev in events:
            if ev.step != step:
                continue
            self.midi.note_on(channel, ev.note, ev.velocity)
            release_step = (step + max(1, ev.duration_steps)) % 16
            pending_note_offs.setdefault(release_step, []).append((channel, ev.note))
