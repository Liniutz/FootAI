# Setup & Installation (CachyOS / Arch Linux)

## 1. System Dependencies

Install PipeWire, JACK compatibility, `qpwgraph`, and native audio/MIDI headers:

```bash
sudo pacman -S --needed \
  pipewire pipewire-jack pipewire-alsa pipewire-pulse wireplumber \
  qpwgraph portaudio alsa-lib aubio python-pip python-virtualenv
```

## 2. Python Virtual Environment

Create `.venv` and install Python dependencies:

```bash
python -m venv .venv
```

### Fish Shell (Recommended for this workstation)
```fish
source .venv/bin/activate.fish
pip install --upgrade pip
pip install -r requirements.txt
```

### Bash / Zsh
```bash
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

> [!NOTE]
> On Python 3.14 + modern FFmpeg (`libavcodec`), building `aubio 0.4.9` from PyPI source may fail. `cyberjam/audio_dsp.py` automatically falls back to SuperFlux onsets and a `librosa.yin` pitch estimator (BPM always uses the NumPy guitar tempo tracker in `cyberjam/tempo.py`). `aubio` is optional in `requirements.txt` if the `aubio` C-extension is absent.

## 2b. Magenta RNN Environment (optional)

The trained `.mag` bundles in `models/` require TensorFlow 2.15 + Magenta, which only support
Python <= 3.11. They run in a **separate** interpreter and are driven by the session over
stdin/stdout JSON, so the main `.venv` stays on 3.14:

```fish
fish scripts/setup_magenta_env.sh
```

This creates `.venv-magenta` (Python 3.9 via `uv`), installs TensorFlow 2.15, note-seq and
Magenta from source, and verifies the import. With the env present, `./start_cyberjam.sh`
picks up `models/wetransfer_cargo_bass-mag_2026-11-14_1356/cargo_{bass,drums,lead}.mag`
automatically; without it, the algorithmic generator is used instead.

## 3. Running the Session

### Direct (Fish / `.venv`)
```fish
.venv/bin/python run_session.py --list-devices
.venv/bin/python run_session.py --pipewire-loopback --device pipewire
```

### Under `pw-jack` (Exposes JACK client node in `qpwgraph`)
```fish
pw-jack .venv/bin/python run_session.py --pipewire-loopback
```

## 3b. Visualizer-Controlled Session Start

`npm run dev` in `visualizer/` starts Vite and the loopback-only session-control service together.
The Menu's **Start Session** button starts `scripts/setup_pipewire_loopback.sh` and
`start_cyberjam.sh` through that service. Both the virtual source and engine are intentionally left
running when browser windows close. To stop them, use another terminal:

```fish
curl -X POST http://127.0.0.1:8765/stop
```

The service is bound to loopback only and must run on the same workstation as the Python engine and
PipeWire audio devices. Do not expose port `8765` to the network.

## 4. CLI Flags

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--list-devices` | `False` | Print available `sounddevice` input/output devices and exit |
| `--device` | `None` | Audio input device index or name substring (e.g., `pipewire`, `4`) |
| `--sample-rate` | `48000` | Audio sample rate in Hz |
| `--block-size` | `512` | Callback buffer size in frames (`512` @ 48kHz ≈ `10.67 ms`) |
| `--pitch-backend` | `auto` | Pitch tracker: `auto` (aubio if installed, else librosa), `aubio`, `librosa`, or `crepe` |
| `--noise-gate-db` | `-42.0` | RMS noise gate threshold in dBFS (`is_playing` & pitch/onset gating) |
| *(exit code 1)* | | If UDP `12000` / TCP `8080` are taken, CyberJam logs "another session running?" and exits with code `1` instead of a traceback |
| `--no-jack` | `False` | Skip JACK host API preference and use default system API |
| `--pipewire-loopback` | `False` | Spawn `pw-loopback` Virtual Source for TouchDesigner / React |
| `--verbose`, `-v` | `False` | Enable debug logging |
