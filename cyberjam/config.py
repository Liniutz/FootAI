"""Configuration and shared state models for CyberJam."""

from __future__ import annotations

from dataclasses import dataclass, field
import threading
import time

ONSET_STALE_SEC = 0.25


@dataclass(frozen=True)
class SessionConfig:
    """Immutable runtime configuration for all CyberJam subsystems."""

    # Audio Ingress & DSP ("The Ears")
    sample_rate: int = 48000
    block_size: int = 512
    channels: int = 1
    audio_device: str | int | None = None
    prefer_jack: bool = True
    pitch_backend: str = "auto"  # "auto" | "aubio" | "librosa" | "crepe"
    onset_threshold: float = 0.35
    silence_db: float = -42.0
    silence_hold_sec: float = 0.35

    # Live Audio Broadcast for Visuals
    udp_host: str = "127.0.0.1"
    udp_port: int = 13000
    enable_pipewire_loopback: bool = False

    # MIDI Egress ("The Hands")
    midi_port_name: str = "CyberJam_Band"
    drum_channel: int = 9  # MIDI Channel 10 (0-indexed)
    bass_channel: int = 1  # MIDI Channel 2 (0-indexed)
    cc_channel: int = 0    # MIDI Channel 1 (0-indexed)
    default_bpm: float = 120.0
    default_key: str = "E"

    # Wekinator OSC Server ("The Soul")
    osc_host: str = "127.0.0.1"
    osc_port: int = 12000

    # Visual Telemetry WebSocket ("The Face")
    ws_host: str = "127.0.0.1"
    ws_port: int = 8080
    ws_interval_ms: int = 50


@dataclass
class MusicalState:
    """Thread-safe shared musical & DSP telemetry state."""

    is_playing: bool = False
    bpm: float = 0.0
    bar: int = 0
    beat: int = 0
    detected_pitch_hz: float = 0.0
    detected_note: str = "N/A"
    detected_midi_note: int = 0
    detected_key: str = "N/A"
    rms: float = 0.0
    spectral_centroid_hz: float = 0.0
    onset_detected: bool = False
    last_onset_ts: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def update(
        self,
        *,
        is_playing: bool | None = None,
        bpm: float | None = None,
        reset_bpm: bool = False,
        bar: int | None = None,
        beat: int | None = None,
        pitch_hz: float | None = None,
        note: str | None = None,
        midi_note: int | None = None,
        key: str | None = None,
        rms: float | None = None,
        spectral_centroid_hz: float | None = None,
        onset: bool = False,
    ) -> None:
        with self._lock:
            if is_playing is not None:
                self.is_playing = is_playing
            if reset_bpm:
                self.bpm = 0.0
            if bpm is not None and 40.0 <= bpm <= 240.0:
                self.bpm = round(bpm, 2)
            if bar is not None:
                self.bar = bar
            if beat is not None:
                self.beat = beat
            if pitch_hz is not None:
                self.detected_pitch_hz = round(pitch_hz, 2)
            if note is not None:
                self.detected_note = note
            if midi_note is not None:
                self.detected_midi_note = midi_note
            if key is not None:
                self.detected_key = key
            if rms is not None:
                self.rms = round(rms, 6)
            if spectral_centroid_hz is not None:
                self.spectral_centroid_hz = round(spectral_centroid_hz, 2)
            if onset:
                self.onset_detected = True
                self.last_onset_ts = time.time()

    def snapshot(self, consume_onset: bool = False) -> dict[str, object]:
        """Return a JSON-serializable snapshot of the current musical state."""
        with self._lock:
            # An onset nobody consumed within one telemetry window is stale; don't replay it
            if self.onset_detected and (time.time() - self.last_onset_ts) > ONSET_STALE_SEC:
                self.onset_detected = False
            onset_flag = self.onset_detected
            if consume_onset:
                self.onset_detected = False
            return {
                "timestamp": time.time(),
                "is_playing": self.is_playing,
                "bpm": self.bpm,
                "bar": self.bar,
                "beat": self.beat,
                "detected_pitch": {
                    "hz": self.detected_pitch_hz,
                    "note": self.detected_note,
                    "midi": self.detected_midi_note,
                    "key": self.detected_key,
                },
                "rms": self.rms,
                "spectral_centroid_hz": self.spectral_centroid_hz,
                "onset": onset_flag,
            }
