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
> On Python 3.14 + modern FFmpeg (`libavcodec`), building `aubio 0.4.9` from PyPI source may fail. `cyberjam/audio_dsp.py` automatically falls back to a NumPy spectral-flux onset/IOI-BPM tracker and `librosa.yin` pitch estimator if the `aubio` C-extension is absent.

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
| `--pitch-backend` | `aubio` | Pitch tracker: `aubio`, `librosa`, or `crepe` |
| `--noise-gate-db` | `-42.0` | RMS noise gate threshold in dBFS (`is_playing` & pitch/onset gating) |
| `--no-jack` | `False` | Skip JACK host API preference and use default system API |
| `--pipewire-loopback` | `False` | Spawn `pw-loopback` Virtual Source for TouchDesigner / React |
| `--verbose`, `-v` | `False` | Enable debug logging |
