"""Virtual MIDI egress ("The Hands") via mido + python-rtmidi."""

from __future__ import annotations

import logging
import threading
import mido

logger = logging.getLogger(__name__)


class MidiEgress:
    """Thread-safe virtual ALSA MIDI output port manager."""

    def __init__(self, port_name: str = "CyberJam_Band") -> None:
        self.port_name = port_name
        self._lock = threading.Lock()
        self._port: mido.ports.BaseOutput | None = None

    def open(self) -> None:
        """Open the virtual MIDI output port using python-rtmidi."""
        mido.set_backend("mido.backends.rtmidi")
        self._port = mido.open_output(self.port_name, virtual=True)
        logger.info("Opened virtual MIDI output port: %s", self.port_name)

    def close(self) -> None:
        """Send All Notes Off and close the virtual MIDI port."""
        with self._lock:
            if self._port is not None:
                try:
                    self._panic_unlocked()
                    self._port.close()
                finally:
                    self._port = None
                    logger.info("Closed virtual MIDI output port: %s", self.port_name)

    def send(self, msg: mido.Message) -> None:
        """Send a single mido.Message in a thread-safe manner."""
        with self._lock:
            if self._port is not None:
                self._port.send(msg)

    def note_on(self, channel: int, note: int, velocity: int = 100) -> None:
        """Send a MIDI Note On message (clamped to valid 0-127 bounds)."""
        self.send(
            mido.Message(
                "note_on",
                channel=max(0, min(15, channel)),
                note=max(0, min(127, note)),
                velocity=max(0, min(127, velocity)),
            )
        )

    def note_off(self, channel: int, note: int) -> None:
        """Send a MIDI Note Off message."""
        self.send(
            mido.Message(
                "note_off",
                channel=max(0, min(15, channel)),
                note=max(0, min(127, note)),
                velocity=0,
            )
        )

    def control_change(self, channel: int, control: int, value: int) -> None:
        """Send a MIDI Control Change (CC) message."""
        self.send(
            mido.Message(
                "control_change",
                channel=max(0, min(15, channel)),
                control=max(0, min(127, control)),
                value=max(0, min(127, value)),
            )
        )

    def _panic_unlocked(self) -> None:
        if self._port is None:
            return
        for ch in range(16):
            self._port.send(mido.Message("control_change", channel=ch, control=123, value=0))
