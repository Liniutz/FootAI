/**
 * Shared configuration constants for the CyberJam visualizer.
 *
 * Values mirror the engine contracts documented in:
 *   - docs/contracts-and-apis.md  (WebSocket telemetry :8080)
 *   - docs/audio-and-routing.md   (PipeWire Virtual Source audio)
 *   - cyberjam/config.py          (engine defaults)
 */

/** Telemetry WebSocket endpoint broadcasting the 20 Hz JSON frame. */
export const TELEMETRY_WS_URL = "ws://127.0.0.1:8080";

/** Engine broadcast cadence: one JSON frame every 50 ms (20 Hz). */
export const TELEMETRY_INTERVAL_MS = 50;

/** Base delay before attempting to reconnect a closed telemetry socket (ms). */
export const TELEMETRY_RECONNECT_BASE_MS = 1000;

/** Upper bound for exponential reconnect backoff (ms). */
export const TELEMETRY_RECONNECT_MAX_MS = 10000;

/**
 * Label of the PipeWire Virtual Source exposed when the engine is launched
 * with `--pipewire-loopback`. The Visualizer selects this device via
 * `navigator.mediaDevices.getUserMedia` for live audio.
 */
export const VISUAL_AUDIO_DEVICE_LABEL = "CyberJam Visual Audio";

/** Engine defaults (from cyberjam/config.py), used as selection fallbacks. */
export const DEFAULT_BPM = 120;
export const DEFAULT_KEY = "E";

/**
 * Virtual MIDI port created by the engine (`mido`/`python-rtmidi`, virtual=True)
 * carrying the ML band output. Read via the Web MIDI API.
 *   - Channel 1  (0-based 0): Wekinator CC modulation
 *   - Channel 2  (0-based 1): ML bassline
 *   - Channel 10 (0-based 9): ML drums
 */
export const BAND_MIDI_PORT_NAME = "CyberJam_Band";
