# ML Integration Guide

Two ML layers exist in the repository:
1. **Real-Time Stubs & Sequencer (`cyberjam/ml_brain.py`)** — Zero-dependency mock patterns for immediate DAW routing & latency testing.
2. **Magenta TensorFlow Agent (`magenta_agent.py`)** — Symbolic MIDI generator using pre-trained `.mag` bundles.

---

## 1. Real-Time Stubs (`cyberjam/ml_brain.py`)

`MLSequencer` runs a drift-compensated 16th-note step loop in a dedicated background thread and calls:
* `generate_drum_midi(bpm: float, bar: int = 0) -> list[MidiStepEvent]`
  * Legacy fixed 4-bar rock groove (kept for tests/back-compat).
* `generate_bass_midi(key: str, bpm: float, bar: int = 0) -> list[MidiStepEvent]`
  * Legacy walking line over `i - VI - III - VII` (kept for tests/back-compat).

### Live generative engine (`cyberjam/generative.py`)
The live session and `MLSequencer` now use `LiveGrooveGenerator`, which writes a **new bar every bar** instead of looping a fixed pattern:

* **Key/mode inference** — `infer_key()` builds a rolling pitch-class histogram (last 64 detections from the DSP) and picks the most frequent class as tonic; the mode is major if the major third is played more than the minor third, else minor.
* **Bass** — a mean-reverting Markov walk over scale degrees (stepwise motion, occasional fifth/octave leaps), rendered through one of four rhythm templates chosen by playing intensity, then mutated each bar. Notes are folded into a playable `E1–E3` window.
* **Drums** — one of five grooves (laid-back, rock drive, funk 16ths, four-on-the-floor, half-time) chosen by intensity/brightness, then varied per bar (kick displacement, ghost snares, hat gaps), with a crash on each 4-bar downbeat and a tom fill at phrase ends or when the player digs in.
* **Conditioning inputs** — `rms` (density/velocity), `spectral_centroid_hz` (hat subdivision/groove brightness), `pitch_classes` (key/mode), `bpm` (timing).
* **Creativity knob** — `CYBERJAM_CREATIVITY` (default `0.6`, `0.0` = static motif, `1.0` = constant mutation).

Robustness: each step runs inside a guard (a failing `note_on`/`note_off` is logged and the loop continues), and a `try/finally` always flushes every pending `note_off` on stop. `MidiEgress.close()` additionally sends CC 120 (All Sound Off) and CC 123 (All Notes Off) on all 16 channels.

Arming / stopping: the sequencer only plays while `MusicalState.band_active` is `true`. The live session sets it once BPM **and** key have been detected, and clears it after `CYBERJAM_SILENCE_TIMEOUT` (default `6s`) without guitar input — at which point all band voices are released (`all_notes_off` on bass and drum channels) and the piano-roll timeline is cleared. Playing again re-arms the band.

To replace the stubs with custom models, keep the `MidiStepEvent(step, note, velocity, duration_steps)` return contract.

---

## 1b. Magenta RNN worker (`scripts/rnn_worker.py` + `cyberjam/rnn_client.py`)

The trained `.mag` bundles in `models/` (`cargo_bass`, `cargo_drums`, `cargo_lead`) are real
Magenta generators (`attention_rnn` for the two melody models, `drum_kit` for the drums).
They need TensorFlow 2.15 + Magenta, which do **not** run on the Python 3.14 main venv, so
they live in a separate Python 3.9 interpreter (`.venv-magenta`) that is driven as a
subprocess over stdin/stdout JSON lines:

```
main session (Python 3.14)                 .venv-magenta (Python 3.9)
scripts/run_inprocess_session.py  --JSON--> scripts/rnn_worker.py
        cyberjam/rnn_client.py  <--JSON---   magenta SequenceGenerator
```

* **Protocol** — request: `{"bpm", "root_pc", "mode", "rms", "temperature", "seed"}`;
  response: `{"bass": [...], "drums": [...], "lead": [...]}` with `{step, note, velocity}` events.
* **Priming** — each request builds a one-bar primer from the live key/mode (root, fifth,
  octave, third for melodies; kick/snare/hats for drums) and asks the model to continue it.
* **Lookahead** — the session requests the next bar while the current one plays. If the
  result is not ready in time (first bar, slow machine) it falls back to
  `LiveGrooveGenerator` for that bar, so playback never stalls.
* **Lead** — `cargo_lead` is wired but **disabled by default** (`CYBERJAM_LEAD=1` to enable)
  because the live guitar already occupies the lead role.
* **Graceful degradation** — if the venv or bundles are missing, the client logs a warning
  and the algorithmic engine keeps the band playing.

| Env var | Default | Meaning |
| :--- | :--- | :--- |
| `CYBERJAM_RNN` | `1` | `0` disables the RNN worker entirely |
| `CYBERJAM_RNN_SET` | `cargo` | model set: `cargo` (fine-tuned) or `default` (stock Magenta) |
| `CYBERJAM_RNN_PYTHON` | `.venv-magenta/bin/python` | interpreter that has TensorFlow |
| `CYBERJAM_RNN_MODELS` | per model set | bundle directory override |
| `CYBERJAM_RNN_TEMPERATURE` | `1.05` | sampling temperature |
| `CYBERJAM_LEAD` | `0` | `1` plays the lead model on channel 3 |

### Model sets

| Set | Directory | Bass | Drums | Lead |
| :--- | :--- | :--- | :--- | :--- |
| `cargo` (default) | `models/wetransfer_cargo_bass-mag_2026-11-14_1356/` | `cargo_bass.mag` | `cargo_drums.mag` | `cargo_lead.mag` |
| `default` | `models/pretrained/` | `attention_rnn.mag` | `drum_kit_rnn.mag` | `attention_rnn.mag` |
| `groovae` | `models/pretrained/` + `models/groovae/tap2drum_2bar/` | `attention_rnn.mag` | **GrooVAE** (tap2drum, driven by live guitar onsets) | — |

### Demo mode (`--demo`)

A guided first-run flow for the installation:

1. **wait** — the band is silent; the session watches for the first guitar note.
2. **capture** — as soon as you play, the visualizer/terminal prompts for 4 bars by default
   (16 measures; approximately 8 seconds at 120 BPM) and a countdown runs. Nothing is generated yet.
3. **locked** — after the capture window the session freezes the measured BPM and the inferred
   key/mode, logs `Locked: 100 BPM, E minor`, and only then starts the RNN band. From that point
   the tempo and key stay fixed (DSP updates are ignored) so the loops stay in sync with what
   you sang.

```fish
./start_cyberjam.sh --demo                 # 4-bar capture by default
./start_cyberjam.sh --demo --demo-bars 8   # longer capture window
```

The prompt is broadcast in `demo_prompt` / `demo_phase` and rendered as a banner in
`public/visualizer.html`. After `CYBERJAM_SILENCE_TIMEOUT` of silence the demo resets to
**wait** so it can be run again.


### GrooVAE (`--models groovae`)

Magenta's public Python GrooVAE checkpoints no longer exist, but the JS demo weights
(`tap2drum_2bar`, a MusicVAE with the `groovae_2bar_tap_fixed_velocity` architecture) are
still online. `scripts/rnn_worker.py` rebuilds that graph and loads the raw tfjs shard into
it by variable name, so GrooVAE runs as a normal subprocess model.

In this mode the drums are **generated from what you play**: every guitar onset is recorded
into a 32-step (2-bar) tap grid (`onset_count` in `MusicalState`), sent with the request as
`taps`, and GrooVAE turns that rhythm into a humanised kick/snare/hat groove. Bass still comes
from the melody RNN. Phrases are 2 bars in this mode.

#### Making GrooVAE sound like Cargo

GrooVAE alone is a generic groove model, so `--models groovae` chains three stages:

1. **Rhythm from the Cargo model** — `cargo_drums.mag` (fine-tuned on Cargo) generates a 2-bar
   pattern. This supplies the *style* (where the kicks and backbeat land).
2. **Feel from GrooVAE** — that pattern is collapsed (`tapify`) to a 32-step tap grid and fed to
   GrooVAE tap2drum, which returns a humanised performance (micro-timing + velocity accents).
3. **Cargo template** — `cargo_drums()` re-imposes the band's signature shape: driving 8th-note
   closed hats (velocities from GrooVAE), kick on 1 and 3 plus the "and of 3" push when the
   model played it, hard backbeat on 2 and 4, a ghost note before the backbeat, crash on the
   phrase downbeat and an open hat closing a 4-bar phrase. Never more than three kicks and no
   double-pedal runs.

The bass in this set is `cargo_bass.mag`, so the whole band is Cargo-flavoured with GrooVAE's
human feel.

```fish
./start_cyberjam.sh --models groovae                      # Cargo rhythm -> GrooVAE feel
set -x CYBERJAM_GROOVAE_TAPS live                          # use your guitar onsets as taps instead
```

CLI flags on `scripts/run_inprocess_session.py` (all forwarded by `./start_cyberjam.sh`):

```fish
./start_cyberjam.sh --models default        # stock Magenta bundles
./start_cyberjam.sh --models cargo          # fine-tuned bundles
./start_cyberjam.sh --rnn-models-dir PATH   # custom bundle directory
./start_cyberjam.sh --no-rnn                # algorithmic engine only
./start_cyberjam.sh --lead                  # enable the generated lead line
./start_cyberjam.sh --creativity 0.9        # fallback engine mutation rate
```

Download the stock bundles with `fish scripts/download_default_models.sh`
(`attention_rnn.mag` + `drum_kit_rnn.mag` from `download.magenta.tensorflow.org`).

Recreate the environment with `fish scripts/setup_magenta_env.sh`.

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
