# ML Integration Guide

Two ML layers exist in the repository:
1. **Real-Time Stubs & Sequencer (`cyberjam/ml_brain.py`)** — Zero-dependency mock patterns for immediate DAW routing & latency testing.
2. **Magenta TensorFlow Agent (`magenta_agent.py`)** — Symbolic MIDI generator using pre-trained `.mag` bundles.

---

## 1. Real-Time Stubs (`cyberjam/ml_brain.py`)

`MLSequencer` runs a drift-compensated 16th-note step loop in a dedicated background thread and calls:
* `generate_drum_midi(bpm: float) -> list[MidiStepEvent]`
  * Mock: 4/4 Kick (`36`) on beats 1/3, Snare (`38`) on beats 2/4, Closed Hi-Hat (`42`) on 8th notes.
* `generate_bass_midi(key: str, bpm: float) -> list[MidiStepEvent]`
  * Mock: Root/fifth/octave bass groove in octave 2 (`KEY_TO_BASS_MIDI`) from the detected key.

To replace the stubs with custom models, keep the `MidiStepEvent(step, note, velocity, duration_steps)` return contract.

---

## 2. Magenta Symbolic MIDI Agent (`magenta_agent.py`)

`MagentaAgent` loads TensorFlow Magenta `.mag` bundles **once** in `__init__` so they remain hot in RAM:
* `./checkpoints/drum_kit_rnn.mag` (`drum_kit`)
* `./checkpoints/basic_rnn.mag` (`basic_rnn`)

### Key Methods
* `create_primer(current_bpm: int, root_midi_note: int) -> NoteSequence`
  * Builds a `NoteSequence` protobuf with tempo and a `0.5s` root note.
* `async generate_and_play(primer, midi_out, bars=2, drum_channel=9, melody_channel=1)`
  * Runs `.generate()` off the event loop via `asyncio.to_thread`.
  * Schedules `note_on` and `note_off` events using non-blocking `asyncio.sleep` timers based on `note.start_time` and `note.end_time` (with a `try/finally` note-off flush so VST synths never hang).

### Required Dependencies & Checkpoints
```bash
pip install magenta mido python-rtmidi
```
Place `.mag` files in `./checkpoints/drum_kit_rnn.mag` and `./checkpoints/basic_rnn.mag` before running `python magenta_agent.py`.
