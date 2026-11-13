# API & Interface Contracts

## 1. Visual Telemetry WebSocket (`ws://127.0.0.1:8080`)

Broadcasts a JSON payload every **50 ms (20 Hz)** to all connected visual clients (TouchDesigner / React).

> **Built-in Live Monitor GUI:** Open [`scripts/monitor_gui.html`](../scripts/monitor_gui.html) in a browser (`xdg-open scripts/monitor_gui.html`) to view live notes, chromatic pitch class, BPM, RMS, spectral centroid, and onset flashes in real time.

### JSON Schema & Example
```json
{
  "timestamp": 1763042450.123456,
  "is_playing": true,
  "bpm": 122.45,
  "bar": 3,
  "beat": 2,
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
| `is_playing` | `bool` | `true` when input RMS is above the noise gate (`--noise-gate-db`), `false` after `0.35s` of silence |
| `bpm` | `float` | `0.0` initially, or `60.0` – `180.0` once the guitar tempo tracker locks; returns to `0.0` after `> 3.0s` silence |
| `bar` | `int` | `0` when idle, `1+` counting continuously from the first note played (resets after `> 3.0s` silence) |
| `beat` | `int` | `0` when idle, `1`–`4` within the current 4/4 bar |
| `detected_pitch.hz` | `float` | Fundamental frequency in Hz (`0.0` below noise gate) |
| `detected_pitch.note` | `string` | Note name + octave (e.g., `"E2"`, `"A2"`, `"N/A"`) |
| `detected_pitch.midi` | `int` | `0` – `127` |
| `detected_pitch.key` | `string` | Pitch class (`"C"`, `"C#"`, ..., `"B"`) |
| `rms` | `float` | Linear RMS amplitude (`0.0` – `1.0`) |
| `spectral_centroid_hz` | `float` | Spectral centroid in Hz |
| `onset` | `bool` | `true` if an onset occurred since the previous 50ms broadcast (an onset not consumed within `0.25s` expires, so a newly connected client never receives a stale one) |

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

### Visual consumer: React Visualizer (Web MIDI, read-only)

The React visualizer reads `CyberJam_Band` **as an input** via the browser **Web MIDI API**
(`navigator.requestMIDIAccess`) to render the ML band's live notes as a scrolling 3-lane ribbon.
It never sends MIDI. Channel→role mapping (0-based wire channel in parentheses):

| Role (lane) | Wire channel | Source |
| :--- | :--- | :--- |
| Synth/FX (CC) | `0` (Ch 1) | Wekinator CC modulation |
| Bass | `1` (Ch 2) | ML bassline note_on/note_off |
| Drums | `9` (Ch 10) | ML drum note_on/note_off |

A `note_on` with velocity `0` is treated as `note_off`. Requires a secure context
(`http://localhost` qualifies), user permission, and that the browser runs on the machine hosting
the `CyberJam_Band` port. The visualizer degrades gracefully (`unsupported` / `denied` /
`port-missing`) when any of these is absent. See
[`visualizer-react.md`](./visualizer-react.md) Extension track E.
