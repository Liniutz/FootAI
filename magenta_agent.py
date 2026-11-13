# Required pip installs:
#   pip install magenta mido python-rtmidi
#
# Ensure local Magenta bundle checkpoints exist at:
#   ./checkpoints/drum_kit_rnn.mag
#   ./checkpoints/basic_rnn.mag

"""Symbolic MIDI generation agent powered by Magenta (DrumsRNN & MelodyRNN)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging
from pathlib import Path
import threading
import time
from typing import Any

import mido

try:
    import magenta.music as mm
    from magenta.models.drums_rnn import drums_rnn_sequence_generator
    from magenta.models.melody_rnn import melody_rnn_sequence_generator
    from note_seq.protobuf import generator_pb2, music_pb2

    _MAGENTA_AVAILABLE = True
except ImportError:
    try:
        import magenta.music as mm
        from magenta.models.drums_rnn import drums_rnn_sequence_generator
        from magenta.models.melody_rnn import melody_rnn_sequence_generator
        from magenta.protobuf import generator_pb2, music_pb2

        _MAGENTA_AVAILABLE = True
    except ImportError:
        mm = None  # type: ignore[assignment]
        drums_rnn_sequence_generator = None  # type: ignore[assignment]
        melody_rnn_sequence_generator = None  # type: ignore[assignment]
        generator_pb2 = None  # type: ignore[assignment]
        music_pb2 = None  # type: ignore[assignment]
        _MAGENTA_AVAILABLE = False

logger = logging.getLogger(__name__)


@dataclass(frozen=True, order=True)
class _ScheduledMidiEvent:
    """Internal timeline event ordered by trigger offset in seconds."""

    offset_sec: float
    priority: int  # 0 = note_off before 1 = note_on at identical timestamps
    msg_type: str  # "note_on" | "note_off"
    channel: int
    pitch: int
    velocity: int


class MagentaAgent:
    """Pre-loads Magenta RNN bundles in RAM and streams symbolic MIDI asynchronously."""

    def __init__(
        self,
        drum_bundle_path: str | Path = "./checkpoints/drum_kit_rnn.mag",
        melody_bundle_path: str | Path = "./checkpoints/basic_rnn.mag",
        drum_generator_id: str = "drum_kit",
        melody_generator_id: str = "basic_rnn",
    ) -> None:
        self.drum_bundle_path = Path(drum_bundle_path)
        self.melody_bundle_path = Path(melody_bundle_path)
        self.drum_generator: Any | None = None
        self.melody_generator: Any | None = None
        self._midi_lock = threading.Lock()

        if not _MAGENTA_AVAILABLE:
            logger.error(
                "Magenta is not installed in the current environment. "
                "Install with: pip install magenta mido python-rtmidi"
            )
            return

        self.drum_generator = self._load_generator(
            bundle_path=self.drum_bundle_path,
            generator_map=drums_rnn_sequence_generator.get_generator_map(),
            generator_id=drum_generator_id,
            label="DrumsRNN",
        )
        self.melody_generator = self._load_generator(
            bundle_path=self.melody_bundle_path,
            generator_map=melody_rnn_sequence_generator.get_generator_map(),
            generator_id=melody_generator_id,
            label="MelodyRNN",
        )

    @staticmethod
    def _load_generator(
        bundle_path: Path,
        generator_map: dict[str, Any],
        generator_id: str,
        label: str,
    ) -> Any | None:
        """Load a .mag bundle once into TensorFlow RAM and warm up the generator."""
        if not bundle_path.is_file():
            logger.error(
                "%s checkpoint missing at '%s'. Generation for this model will be skipped.",
                label,
                bundle_path,
            )
            return None

        if generator_id not in generator_map:
            logger.error(
                "%s generator ID '%s' not found in generator map: %s",
                label,
                generator_id,
                list(generator_map.keys()),
            )
            return None

        try:
            logger.info("Pre-loading %s bundle into TensorFlow RAM: %s", label, bundle_path)
            bundle = mm.read_bundle_file(str(bundle_path))
            generator = generator_map[generator_id](checkpoint=None, bundle=bundle)
            generator.initialize()
            logger.info("%s (%s) initialized and hot in RAM.", label, generator_id)
            return generator
        except Exception as exc:
            logger.exception("Failed to initialize %s from '%s': %s", label, bundle_path, exc)
            return None

    def create_primer(self, current_bpm: int, root_midi_note: int) -> Any:
        """Build a Magenta NoteSequence primer with tempo and a 0.5s root note."""
        if music_pb2 is None:
            raise RuntimeError("Magenta / note_seq protobufs are unavailable.")

        bpm = max(40, min(240, int(current_bpm)))
        pitch = max(0, min(127, int(root_midi_note)))

        primer = music_pb2.NoteSequence()
        primer.tempos.add(time=0.0, qpm=float(bpm))
        primer.notes.add(
            pitch=pitch,
            velocity=100,
            start_time=0.0,
            end_time=0.5,
            instrument=0,
            program=33,  # Electric Bass (finger)
        )
        primer.total_time = 0.5
        return primer

    async def generate_and_play(
        self,
        primer: Any,
        midi_out: mido.ports.BaseOutput,
        bars: int = 2,
        drum_channel: int = 9,
        melody_channel: int = 1,
    ) -> None:
        """Generate symbolic MIDI from loaded RNNs and play with non-blocking asyncio timers."""
        if not _MAGENTA_AVAILABLE or generator_pb2 is None:
            logger.warning("Cannot generate: Magenta is unavailable.")
            return

        if self.drum_generator is None and self.melody_generator is None:
            logger.warning("No Magenta generators are loaded; check ./checkpoints/*.mag.")
            return

        qpm = float(primer.tempos[0].qpm) if getattr(primer, "tempos", None) else 120.0
        bar_duration_sec = (60.0 / max(40.0, qpm)) * 4.0
        target_duration_sec = max(0.5, float(bars) * bar_duration_sec)

        start_t = float(primer.total_time)
        end_t = start_t + target_duration_sec

        options = generator_pb2.GeneratorOptions()
        options.generate_sections.add(start_time=start_t, end_time=end_t)

        # Offload TensorFlow inference to worker threads so the asyncio loop stays responsive
        tasks: list[asyncio.Task[Any]] = []
        if self.drum_generator is not None:
            tasks.append(asyncio.create_task(asyncio.to_thread(self.drum_generator.generate, primer, options)))
        if self.melody_generator is not None:
            tasks.append(asyncio.create_task(asyncio.to_thread(self.melody_generator.generate, primer, options)))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        drum_seq = results.pop(0) if self.drum_generator is not None else None
        melody_seq = results.pop(0) if self.melody_generator is not None else None

        timeline: list[_ScheduledMidiEvent] = []
        if drum_seq is not None and not isinstance(drum_seq, Exception):
            timeline.extend(self._extract_events(drum_seq, start_t, drum_channel))
        elif isinstance(drum_seq, Exception):
            logger.error("DrumsRNN generation error: %s", drum_seq)

        if melody_seq is not None and not isinstance(melody_seq, Exception):
            timeline.extend(self._extract_events(melody_seq, start_t, melody_channel))
        elif isinstance(melody_seq, Exception):
            logger.error("MelodyRNN generation error: %s", melody_seq)

        if not timeline:
            logger.warning("Generated NoteSequences contained no playable notes.")
            return

        await self._play_timeline(timeline, midi_out)

    @staticmethod
    def _extract_events(
        sequence: Any,
        primer_end_time: float,
        channel: int,
    ) -> list[_ScheduledMidiEvent]:
        """Convert generated Magenta NoteSequence notes into note_on / note_off events."""
        events: list[_ScheduledMidiEvent] = []
        ch = max(0, min(15, int(channel)))

        for note in sequence.notes:
            # Skip primer notes; shift generated notes so playback starts at 0.0s
            if note.end_time <= primer_end_time:
                continue

            on_t = max(0.0, float(note.start_time) - primer_end_time)
            off_t = max(on_t + 0.05, float(note.end_time) - primer_end_time)
            pitch = max(0, min(127, int(note.pitch)))
            velocity = max(1, min(127, int(note.velocity) or 95))

            events.append(
                _ScheduledMidiEvent(
                    offset_sec=on_t,
                    priority=1,
                    msg_type="note_on",
                    channel=ch,
                    pitch=pitch,
                    velocity=velocity,
                )
            )
            events.append(
                _ScheduledMidiEvent(
                    offset_sec=off_t,
                    priority=0,
                    msg_type="note_off",
                    channel=ch,
                    pitch=pitch,
                    velocity=0,
                )
            )
        return events

    async def _play_timeline(
        self,
        timeline: list[_ScheduledMidiEvent],
        midi_out: mido.ports.BaseOutput,
    ) -> None:
        """Dispatch scheduled note_on and note_off messages using non-blocking asyncio.sleep."""
        timeline.sort()
        active_notes: set[tuple[int, int]] = set()
        t0 = time.perf_counter()

        try:
            for ev in timeline:
                delay = (t0 + ev.offset_sec) - time.perf_counter()
                if delay > 0:
                    await asyncio.sleep(delay)

                msg = mido.Message(
                    ev.msg_type,
                    channel=ev.channel,
                    note=ev.pitch,
                    velocity=ev.velocity,
                )
                self._send_midi(midi_out, msg)

                if ev.msg_type == "note_on":
                    active_notes.add((ev.channel, ev.pitch))
                else:
                    active_notes.discard((ev.channel, ev.pitch))
        finally:
            # Guarantee no stuck notes if playback is cancelled or interrupted
            for ch, pitch in active_notes:
                self._send_midi(
                    midi_out,
                    mido.Message("note_off", channel=ch, note=pitch, velocity=0),
                )

    def _send_midi(self, midi_out: mido.ports.BaseOutput, msg: mido.Message) -> None:
        with self._midi_lock:
            midi_out.send(msg)


async def _run_smoke_test() -> None:
    agent = MagentaAgent()

    mido.set_backend("mido.backends.rtmidi")
    midi_out = mido.open_output("CyberJam_Band_MagentaTest", virtual=True)
    try:
        if not _MAGENTA_AVAILABLE:
            logger.info("Skipping primer generation test because Magenta is not installed.")
            return

        primer = agent.create_primer(current_bpm=120, root_midi_note=40)  # E2 at 120 BPM
        logger.info("Created 120 BPM primer (pitch=%d). Running 2-bar generation...", primer.notes[0].pitch)
        await agent.generate_and_play(primer=primer, midi_out=midi_out, bars=2)
        logger.info("Test generation & playback complete.")
    finally:
        midi_out.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    asyncio.run(_run_smoke_test())
