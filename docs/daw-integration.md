# Ardour DAW Integration Guide

CyberJam integrates natively with **Ardour** (the premier open-source digital audio workstation for Linux/PipeWire) using **OSC (Open Sound Control)** and virtual **ALSA MIDI**.

## 1. Configuring Ardour as an OSC Server
1. Open Ardour.
2. Go to **Window > Control Surfaces**.
3. Enable **OSC (Open Sound Control)**.
4. Set port to `3819` (Ardour's default OSC listener port).

## 2. Python Bridge (`cyberjam/daw/ardour_bridge.py`)
CyberJam includes an OSC client bridge that can control Ardour transport, session tempo, and track parameters directly from Python or event loops:
```python
from cyberjam.daw.ardour_bridge import ArdourOscBridge

bridge = ArdourOscBridge()
bridge.set_tempo(126.0)
bridge.set_transport(True)
```

## 3. Audio & MIDI Routing (`qpwgraph`)
1. Route your guitar input into both CyberJam and an Ardour audio track (with amp simulation or effects).
2. Connect CyberJam's virtual MIDI output (**`CyberJam_Band`**) to Ardour's MIDI track inputs (Channel 10 for drums, Channel 2 for bass/synth).
3. Connect Ardour's Master Output to your audio interface speakers.

## 4. Routing DAW Audio to Visuals (`TouchDesigner` / `React`)
To ensure your visualizers receive the final processed DAW audio (with amp sims, effects, and mixing) instead of raw dry guitar:
1. In Ardour, select your Master Bus or a designated Visuals Submix bus.
2. Open `qpwgraph`.
3. Connect **Ardour Master Out (or Submix Out)** $\rightarrow$ **`CyberJam_VisualIn playback_FL / playback_FR`** (spawned via `--pipewire-loopback`).
4. TouchDesigner or your Web Visualizer can then open the **`CyberJam Visual Audio`** virtual source and react to the fully produced DAW master mix at 60 FPS.
