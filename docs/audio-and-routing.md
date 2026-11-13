# Audio Ingress, DSP & `qpwgraph` Routing

## 1. Audio Ingress & DSP (`audio_dsp.py`)

* **Sample Rate & Block Size:** `48000 Hz`, `512` frames (`~10.67 ms` per block), mono (`float32`).
* **Onset & BPM Detection:**
  * Primary: `aubio.onset("default", 2048, 512, 48000)` + `aubio.tempo(...)`.
  * Fallback (when `aubio` C-extension is unavailable): NumPy spectral-flux onset detector + `librosa.feature.tempo` tempogram BPM tracker over a 2–3 bar (`3.8s`–`7.0s`) onset-strength envelope, recomputed every `~2.0s`.
* **Pitch & Key Estimation:**
  * `aubio` (default): `aubio.pitch("yinfft", ...)` with confidence gate `>= 0.65`.
  * `librosa`: `librosa.yin(..., fmin=75.0, fmax=1400.0)` over a 2048-sample rolling buffer (also used automatically if `aubio` is not installed).
  * `crepe`: Optional neural pitch tracker (requires `crepe` + `tensorflow`).
* **Spectral Centroid & RMS:** Computed per block via Hann-windowed `np.fft.rfft` and linear RMS (`noise gate: rms > 0.002`).

---

## 2. Live Audio Streams for Visuals

### Option A: Low-Latency UDP Broadcast (`127.0.0.1:13000`)
Every audio callback pushes raw PCM bytes directly to `127.0.0.1:13000`:
* **Format:** `32-bit IEEE Float` (`float32`, little-endian), mono, `48000 Hz`
* **Packet Size:** `512` samples = `2048 bytes` per datagram

**TouchDesigner:** Use a **UDP In DAT** or Python Script CHOP unpacking `struct.unpack('<512f', packet)`.

### Option B: PipeWire Virtual Source (`CyberJam Visual Audio`)
Launch with `--pipewire-loopback` or run `./scripts/setup_pipewire_loopback.sh`. This runs:
```bash
pw-loopback \
  --capture-props="node.name=CyberJam_VisualIn node.description='CyberJam Visual In'" \
  --playback-props="media.class=Audio/Source node.name=CyberJam_VisualSource node.description='CyberJam Visual Audio'"
```
* **React / Browser:** Call `navigator.mediaDevices.getUserMedia({ audio: { deviceId } })` selecting `"CyberJam Visual Audio"` and pipe into Web Audio API `AnalyserNode`.
* **TouchDesigner:** Add an **Audio Device In CHOP** and select `"CyberJam Visual Audio"`.

---

## 3. `qpwgraph` Routing Map

Open `qpwgraph` after starting the Python router and your DAW:

1. **Guitar $\rightarrow$ Python DSP ("The Ears"):**
   * Connect **`Scarlett Solo USB` (or USB Interface) `capture_FL`** $\rightarrow$ **`PortAudio` / `python3` input**.
2. **Guitar $\rightarrow$ Visuals Virtual Source (if using `pw-loopback`):**
   * Connect **`Scarlett Solo USB capture_FL`** $\rightarrow$ **`CyberJam_VisualIn playback_FL`**.
3. **Python Virtual MIDI $\rightarrow$ DAW:**
   * Connect **`CyberJam_Band` (MIDI Out)** $\rightarrow$ **DAW MIDI Input**:
     * **Track 1 (Drums VST):** MIDI Channel 10 (GM Kick `36`, Snare `38`, Closed Hat `42`).
     * **Track 2 (Bass VST):** MIDI Channel 2.
     * **Track 3 (Modulated Synth / Guitar FX):** MIDI Channel 1 (Wekinator MIDI CCs).
4. **DAW $\rightarrow$ Museum Speakers:**
   * Connect **DAW Master Out `1 / 2`** $\rightarrow$ **`Scarlett Solo USB playback_FL / playback_FR`**.
