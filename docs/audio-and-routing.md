# Audio Ingress, DSP & `qpwgraph` Routing

## 1. Audio Ingress & DSP (`audio_dsp.py`)

* **Sample Rate & Block Size:** `48000 Hz`, `512` frames (`~10.67 ms` per block), mono (`float32`).
* **Onset Detection:**
  * `aubio.onset("default", 2048, 512, 48000)` when `aubio` is installed, otherwise the SuperFlux detector below. Onsets are debounced to `>= 100 ms`.
* **BPM Detection (guitar-optimised, `cyberjam/tempo.py`, pure NumPy — same path with or without `aubio`):**
  * Envelope: log-compressed `80–5000 Hz` SuperFlux (3-bin vibrato suppression + RMS accent weighting) at `~93.75` frames/s, kept in a `6 s` sliding window.
  * Estimator: FFT autocorrelation scored with a *comb* over lag multiples `0.5x, 1x, 2x, 3x, 4x, 8x` of each candidate beat (resolves the half/double-tempo and dotted-beat ambiguity of strummed guitar), times a soft log-Gaussian prior around `110 BPM` (`±1.4 octaves`). Search range `60–180 BPM`.
  * Stability: first lock needs two agreeing estimates (`±6%`); a tempo change needs two consecutive agreeing estimates; agreeing estimates are EMA-smoothed (`0.7/0.3`); estimates below confidence `1.6` are ignored. Re-estimated every `1 s` once `>= 3.8 s` of playing is buffered.
  * Silence: a short pause pushes zero-flux frames (keeps real-time spacing); `> 3 s` silence resets the tracker, the bar/beat counter **and** `state.bpm` to `0.0`.
  * Accuracy on synthetic strum envelopes (quarters/8ths/16ths/folk, jitter + noise): `~77%` exact (±4%) and `~91%` within a factor of 2 over `75–140 BPM`; end-to-end on synthesized Karplus-Strong chord strums it locked `80/100/120 BPM` exactly (one `80 BPM` 16th-note pattern locked at the double tempo `160`).
* **Pitch & Key Estimation:**
  * `auto` (default): `aubio` if the C-extension imports, otherwise `librosa`. The active backend is logged at startup.
  * `aubio`: `aubio.pitch("yin", ...)` with confidence gate `>= 0.65` (falls back to `librosa` with a warning if `aubio` is missing). `yin` is used instead of `yinfft` because `yinfft` reports a constant `0.0` confidence in the packaged aubio build, which silently blocked every key detection.
  * `librosa`: `librosa.yin(..., fmin=75.0, fmax=1400.0)` over a 2048-sample rolling buffer.
  * `crepe`: Optional neural pitch tracker (requires `crepe` + `tensorflow`).
* **Spectral Centroid & RMS:** Computed per block via Hann-windowed `np.fft.rfft` and linear RMS (`noise gate: rms > 10^(--noise-gate-db/20)`, default `-42 dBFS ≈ 0.008`).
* **Real-time safety:** `_audio_callback` never logs or blocks; xruns are counted with a plain integer and reported by the DSP worker at debug level.
* **External audio feed:** `AudioDSPEngine.start_processing()` starts only the DSP worker (no capture stream) and `feed_audio(mono_block)` pushes externally captured float32 blocks into the same path (UDP broadcast + DSP queue). This is what the duplex guitar passthrough uses, so a single stream can both monitor the guitar and analyse it.
* **Live session routing (`scripts/run_inprocess_session.py`):** capture and playback are opened as *separate* `sd.InputStream` / `sd.OutputStream` objects (a duplex `sd.Stream` produced no output on this PipeWire setup). Device names are resolved to PortAudio indices by substring, because `"hw:2,0"` is parsed by PortAudio as `name="hw:2", hostapi="0"` and can silently land on the wrong device. Overrides: `CYBERJAM_INPUT_DEVICE` (default `Scarlett`), `CYBERJAM_OUTPUT_DEVICES` (comma list, default `default,Scarlett`), `CYBERJAM_TEST_TONE=0` to skip the startup beep.
* **Mix balance:** `CYBERJAM_GUITAR_GAIN` (default `2.0`, applied to the passthrough block with hard clipping at ±1.0) and `CYBERJAM_BAND_GAIN` (default `0.45`, applied through `fluid_synth_set_gain` via `ctypes` because this pyfluidsynth build exposes no gain setter).
* **Instruments & drum kit:** bass uses GM program `32` (Acoustic/upright, jazzy and round). Drums are selected with `--drum-kit NAME` (GeneralUser GS percussion bank 128): `power` (rock, default), `standard`, `standard2`, `standard3`, `room`, `jazz`, `brush`, `electronic`, `808`, `dance`, `orchestral`, `sfx`, or a numeric preset. `--drum-soundfont PATH --drum-preset N` assigns a dedicated kit `.sf2` to channel 10 instead. `--soundfont PATH` overrides the main `.sf2` (bass/lead). `--list-drum-kits` prints what the loaded soundfont offers. Env equivalents: `CYBERJAM_DRUM_KIT`, `CYBERJAM_DRUM_SOUNDFONT`, `CYBERJAM_DRUM_PRESET`, `CYBERJAM_SOUNDFONT`.
* **Latency:** streams open with `latency="low"` and a 256-frame block by default (`--block N`, `CYBERJAM_BLOCK`). The visualizer dev flow (`npm run dev` → `scripts/session_control.py`) launches with **64 frames** (1.3 ms block, ~8 ms output / ~11 ms input here) for the lowest possible monitoring delay; override with `CYBERJAM_BLOCK`. Measured on this machine: `512/default` ≈ 43 ms per direction, `256/low` ≈ 11 ms, `64/low` ≈ 8-11 ms. The guitar block is written to the monitor outputs **directly from the capture callback** (no queue hop, no extra block of delay). FluidSynth's ALSA buffer is shrunk to 64 frames × 3 periods before `start()` (~4 ms instead of ~21 ms). `--no-passthrough` (`CYBERJAM_PASSTHROUGH=0`) disables software monitoring when the interface's hardware **Direct Monitor** is on, which otherwise doubles the guitar into a slapback.

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

## Note on Singing & Sustained Vocals vs Percussive Instruments
- When using `aubio` as the pitch backend, `aubio.tempo` can over-trigger on vocal vibrato or sustained notes, causing tempo estimates to drift higher (135–155 BPM).
- For vocals, sustained guitar chords, or smooth melodies, using `--pitch-backend librosa` routes audio through the guitar/singing-optimised NumPy autocorrelation comb tracker (`cyberjam/tempo.py`), which correctly locks onto stable underlying tempos (such as 126 BPM) and rejects vocal envelope modulation.
