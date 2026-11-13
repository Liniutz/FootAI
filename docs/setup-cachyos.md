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
