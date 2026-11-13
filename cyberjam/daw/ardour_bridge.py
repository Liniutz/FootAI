"""Ardour DAW Bridge for CyberJam.

Connects CyberJam telemetry and musical state to Ardour via OSC (Open Sound Control)
and virtual ALSA MIDI ports.
"""

from __core__ import annotations

import argparse
import asyncio
import logging
from typing import Any

from pythonosc import udp_client

logger = logging.getLogger("ardour_bridge")


class ArdourOscBridge:
    """Controls Ardour playback, transport, and mixer parameters via OSC."""

    def __init__(self, ardour_host: str = "127.0.0.1", ardour_port: int = 3819) -> None:
        self.client = udp_client.SimpleUDPClient(ardour_host, ardour_port)
        logger.info("Initialized Ardour OSC client at %s:%d", ardour_host, ardour_port)

    def set_transport(self, play: bool) -> None:
        """Start or stop Ardour transport."""
        cmd = "/ardour/transport_play" if play else "/ardour/transport_stop"
        self.client.send_message(cmd, 1)

    def set_tempo(self, bpm: float) -> None:
        """Set session BPM in Ardour."""
        self.client.send_message("/ardour/set_tempo", float(bpm))

    def set_gain(self, track_id: int, gain_float: float) -> None:
        """Set track gain (0.0 to 1.0)."""
        self.client.send_message(f"/ardour/tracks/{track_id}/gain", float(gain_float))


async def main_async() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    bridge = ArdourOscBridge()
    logger.info("Testing Ardour OSC bridge connection...")
    bridge.set_tempo(126.0)
    logger.info("Sent tempo 126.0 to Ardour.")


if __name__ == "__main__":
    asyncio.run(main_async())
