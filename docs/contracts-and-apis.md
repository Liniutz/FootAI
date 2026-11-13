# API & Interface Contracts

## 1. Visual Telemetry WebSocket (`ws://127.0.0.1:8080`)

Broadcasts a JSON payload every **50 ms (20 Hz)** to all connected visual clients (TouchDesigner / React).

### JSON Schema & Example
```json
{
  "timestamp": 1763042450.123456,
  "bpm": 122.45,
  "detected_pitch": {
    "hz": 110.0,
    "note": "A2",
    "midi": 45,
    "key": "A"
  },
  "rms": 0.08412,
  "spectral_centroid_hz": 1420.55,
  "onset": true
}
```

| Field | Type | Range / Notes |
| :--- | :--- | :--- |
| `timestamp` | `float` | Unix epoch seconds |
| `bpm` | `float` | `40.0` – `240.0` |
| `detected_pitch.hz` | `float` | Fundamental frequency in Hz (`0.0` below noise gate) |
| `detected_pitch.note` | `string` | Note name + octave (e.g., `"E2"`, `"A2"`, `"N/A"`) |
| `detected_pitch.midi` | `int` | `0` – `127` |
| `detected_pitch.key` | `string` | Pitch class (`"C"`, `"C#"`, ..., `"B"`) |
| `rms` | `float` | Linear RMS amplitude (`0.0` – `1.0`) |
| `spectral_centroid_hz` | `float` | Spectral centroid in Hz |
| `onset` | `bool` | `true` if an onset occurred since the previous 50ms broadcast |

---

## 2. Wekinator OSC Server (`udp://127.0.0.1:12000`)

Incoming OSC floats are normalized (`[0.0, 1.0]` $\rightarrow$ `0`–`127`; values `> 1.0` clamped to `0`–`127`) and emitted as MIDI Control Change messages on **MIDI Channel 1** via `CyberJam_Band`.

| OSC Address | Arguments | Target MIDI CC (Channel 1) |
| :--- | :--- | :--- |
| `/wek/outputs` | `float0, float1, ...` | Maps sequentially to CC `[74, 71, 1, 11, 20, 21, 22, 23]` |
| `/cyberjam/cc/<num>` | `float` | Explicit MIDI CC `<num>` (`0`–`127`) |
| `/cyberjam/rms` | `float` | CC `74` (Filter Cutoff / Brightness) |
| `/cyberjam/centroid` | `float` | CC `71` (Filter Resonance / Timbre) |

---

## 3. Virtual MIDI Egress (`CyberJam_Band`)

Created via `mido` + `python-rtmidi` (`virtual=True`).

| MIDI Channel (1-based) | Source | Content |
| :--- | :--- | :--- |
| **Channel 1** | `WekinatorOSCServer` | MIDI CC modulation (`74`, `71`, `1`, `11`, etc.) |
| **Channel 2** | `MLSequencer` / `MagentaAgent` | Generated Bassline / Melody notes |
| **Channel 10** | `MLSequencer` / `MagentaAgent` | General MIDI Drums (Kick `36`, Snare `38`, Closed Hat `42`) |
