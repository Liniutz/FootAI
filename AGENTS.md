# AGENTS.md — Repository Rules & Engineering Guide

This file defines the mandatory workflow, architectural invariants, testing standards, and documentation rules for AI agents and contributors working in **FootAI ("CyberJam")**.

---

## 1. Project Context

**CyberJam** is a monolithic, low-latency interactive museum installation running on **CachyOS (Arch Linux)** with **PipeWire** (`qpwgraph` for patchbay routing) and **Python 3.11+** (workstation uses Python 3.14.7 in `.venv/` and **Fish** shell).

### Subsystems & Boundaries
| Subsystem | Location | Purpose |
| :--- | :--- | :--- |
| **Audio & DSP ("The Ears")** | `cyberjam/audio_dsp.py` | `sounddevice` capture, UDP `:13000` raw `float32` PCM stream, optional `pw-loopback`, onset/BPM/pitch/RMS/centroid extraction |
| **ML Brain (Stubs & Magenta)** | `cyberjam/ml_brain.py`, `magenta_agent.py` | Symbolic MIDI generation (`generate_drum_midi`, `generate_bass_midi`, `MagentaAgent` `.mag` bundles) |
| **MIDI Egress ("The Hands")** | `cyberjam/midi_egress.py` | Thread-safe virtual ALSA MIDI port `CyberJam_Band` (`mido` + `python-rtmidi`) |
| **Wekinator OSC ("The Soul")** | `cyberjam/osc_wekinator.py` | AsyncIO OSC UDP server on `127.0.0.1:12000` mapping floats to MIDI CC on Ch 1 |
| **Visual Telemetry ("The Face")** | `cyberjam/ws_telemetry.py` | AsyncIO WebSocket server on `ws://127.0.0.1:8080` broadcasting JSON at 20 Hz (`50 ms`) |
| **Orchestrator & Config** | `cyberjam/main.py`, `cyberjam/config.py`, `run_session.py` | CLI flags, `SessionConfig`, lock-protected `MusicalState`, graceful `SIGINT`/`SIGTERM` shutdown |

Read [`docs/README.md`](./docs/README.md) and [`docs/architecture.md`](./docs/architecture.md) before modifying any subsystem.

---

## 2. Mandatory Git & Branching Workflow

1. **Never commit directly to `main`.**
2. **Always create a dedicated branch** before making edits:
   - `feat/<short-name>` for new features
   - `fix/<short-name>` for bug fixes
   - `docs/<short-name>` for documentation
   - `test/<short-name>` for test additions
3. Keep `.venv/`, `__pycache__/`, and `*.log` untracked (covered by `.gitignore`).
4. Write clear commit messages and include exact verification commands/results in your PR description.
5. **Close branches after merge (mandatory):**
   - As soon as a PR is merged into `main`, delete its branch **both locally and on `origin`**:
     ```fish
     git push origin --delete <branch-name>
     git branch -d <branch-name>
     ```
   - Prune stale remote-tracking refs and remove any local branch already merged into `main` before starting new work:
     ```fish
     git fetch --prune
     git branch --merged main | grep -v '^\* main$' | xargs -r git branch -d
     ```
   - Never leave a merged branch behind. Enable GitHub's **"Automatically delete head branches"** setting (Settings → General) as a safety net — it requires repo admin rights.

---

## 3. Critical Architectural Invariants (Do Not Break)

1. **Audio Callback Must Never Block:**
   - `_audio_callback` in `cyberjam/audio_dsp.py` runs on a real-time audio thread. Never perform file I/O, heavy allocations, blocking locks, or ML inference inside it. Use bounded `queue.Queue.put_nowait` and non-blocking UDP sockets.
2. **TensorFlow / ML Offloading:**
   - Model bundles (`.mag`) must be loaded **once** in `__init__` (never per-bar or per-request).
   - Model `.generate()` calls must run in a background thread (`MLSequencer` or `asyncio.to_thread`) so neither the audio callback nor the `asyncio` event loop blocks.
3. **No Stuck MIDI Notes:**
   - Every `note_on` must have a scheduled `note_off` (e.g., via `asyncio.sleep` timers or step-sequencer release tracking) and a `try/finally` panic/flush on shutdown or cancellation.
4. **Thread-Safe Shared State:**
   - All DSP $\leftrightarrow$ ML/WebSocket reads and writes must go through `MusicalState.update()` and `MusicalState.snapshot()`.
5. **Defensive Fallbacks:**
   - `aubio` C-extension imports and `.mag` checkpoint loads must fail gracefully with clear logs rather than crashing startup.

---

## 4. Testing & Verification Standards

Every code change must be verified before committing:

1. **Write Tests:**
   - Place unit and integration tests in `tests/` (using `pytest` or `unittest`).
   - Mock hardware audio devices (`sounddevice.InputStream`) and MIDI ports (`mido.open_output`) in unit tests so tests run deterministically in headless environments.
   - Test edge cases: MIDI value clamping (`0`–`127`), `hz_to_note_info` boundary frequencies, WebSocket JSON schema keys, OSC `/wek/outputs` normalization, and `note_off` cleanup on task cancellation.
2. **Run Checks After Your Final Edit:**
   ```fish
   # Syntax check all Python files
   .venv/bin/python -m py_compile run_session.py cyberjam/*.py

   # Run test suite (if tests/ exists)
   .venv/bin/python -m unittest discover -s tests -v

   # Audio device discovery & short live smoke test
   .venv/bin/python run_session.py --list-devices
   timeout -s INT 4 .venv/bin/python run_session.py --device pipewire
   ```
3. Only report tests or checks as passing if you ran them **after your final edit** and observed them pass.

---

## 5. Documentation Rules (`docs/`)

1. **Document Every Change in `docs/`:**
   - Port, JSON schema, OSC address, or MIDI channel change $\rightarrow$ update [`docs/contracts-and-apis.md`](./docs/contracts-and-apis.md).
   - Audio/DSP, UDP, `pw-loopback`, or `qpwgraph` change $\rightarrow$ update [`docs/audio-and-routing.md`](./docs/audio-and-routing.md).
   - ML stub or `MagentaAgent` change $\rightarrow$ update [`docs/ml-integration.md`](./docs/ml-integration.md).
   - OS dependency, `.venv`, or CLI flag change $\rightarrow$ update [`docs/setup-cachyos.md`](./docs/setup-cachyos.md).
   - New subsystem $\rightarrow$ create `docs/<subsystem>.md` and add it to [`docs/README.md`](./docs/README.md).
2. **Shell Examples:** Prefer **Fish** syntax (`source .venv/bin/activate.fish` or `.venv/bin/python ...`) alongside standard Bash where relevant.
