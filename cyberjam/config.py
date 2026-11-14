"""
Thread-safe shared MusicalState and SessionConfig for CyberJam.
"""

from __future__ import annotations

import dataclasses
import threading
from typing import Any


@dataclasses.dataclass
class SessionConfig:
    audio_device: str = "default"
    sample_rate: int = 48000
    block_size: int = 512
    udp_host: str = "127.0.0.1"
    udp_port: int = 13000
    osc_port: int = 12000
    ws_port: int = 8080
    midi_port: str = "CyberJam_Band"
    default_key: str = "E"
    default_bpm: float = 120.0
    onset_threshold: float = 0.3
    silence_db: float = -40.0
    pitch_backend: str = "aubio"
    enable_pipewire_loopback: bool = False
    channels: int = 1
    silence_hold_sec: float = 2.0
    creativity: float = 0.5


class MusicalState:
    """Thread-safe state container for real-time DSP telemetry and ML conditions."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = {
            "bpm": 120.0,
            "key": "E Minor",
            "pitch_hz": 0.0,
            "rms": 0.0,
            "centroid": 0.0,
            "wekinator_cc": 0,
            "current_step": 0,
            "active_root": "E",
            "detected_bpm": False,
            "detected_key": False,
            "band_active": False,
            "demo_phase": "",
            "demo_prompt": "",
        }

    def update(self, **kwargs: Any) -> None:
        with self._lock:
            for k, v in kwargs.items():
                self._state[k] = v

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._state)
