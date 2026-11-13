"""Wekinator OSC-to-MIDI CC server ("The Soul") via python-osc."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import AsyncIOOSCUDPServer

from .config import SessionConfig
from .midi_egress import MidiEgress

logger = logging.getLogger(__name__)

# Default MIDI CC mapping for Wekinator /wek/outputs float vector
WEKINATOR_CC_MAP: tuple[int, ...] = (74, 71, 1, 11, 20, 21, 22, 23)


def _float_to_cc_value(val: float) -> int:
    """Convert normalized [0.0, 1.0] (or [0, 127]) float to MIDI CC 0..127."""
    if 0.0 <= val <= 1.0:
        return max(0, min(127, int(round(val * 127.0))))
    return max(0, min(127, int(round(val))))


class WekinatorOSCServer:
    """AsyncIO OSC UDP server listening on port 12000 and forwarding MIDI CCs."""

    def __init__(self, config: SessionConfig, midi: MidiEgress) -> None:
        self.config = config
        self.midi = midi
        self._transport: asyncio.DatagramTransport | None = None

        self._dispatcher = Dispatcher()
        self._dispatcher.map("/wek/outputs", self._handle_wek_outputs)
        self._dispatcher.map("/cyberjam/cc/*", self._handle_explicit_cc)
        self._dispatcher.map("/cyberjam/rms", self._handle_rms)
        self._dispatcher.map("/cyberjam/centroid", self._handle_centroid)

    async def start(self) -> None:
        """Bind and start the OSC UDP server on the running asyncio event loop."""
        loop = asyncio.get_running_loop()
        server = AsyncIOOSCUDPServer(
            (self.config.osc_host, self.config.osc_port),
            self._dispatcher,
            loop,
        )
        self._transport, _ = await server.create_serve_endpoint()
        logger.info(
            "Wekinator OSC server listening on %s:%d",
            self.config.osc_host,
            self.config.osc_port,
        )

    def stop(self) -> None:
        """Close the OSC UDP transport."""
        if self._transport is not None:
            self._transport.close()
            self._transport = None
            logger.info("Wekinator OSC server stopped.")

    def _handle_wek_outputs(self, address: str, *args: Any) -> None:
        """Map Wekinator /wek/outputs float vector to MIDI CC messages."""
        for idx, raw in enumerate(args):
            if idx >= len(WEKINATOR_CC_MAP):
                break
            try:
                cc_val = _float_to_cc_value(float(raw))
                cc_num = WEKINATOR_CC_MAP[idx]
                self.midi.control_change(self.config.cc_channel, cc_num, cc_val)
            except (TypeError, ValueError):
                logger.debug("Ignoring non-numeric OSC arg at %s: %r", address, raw)

    def _handle_explicit_cc(self, address: str, *args: Any) -> None:
        """Handle /cyberjam/cc/<cc_num> <float_value>."""
        if not args:
            return
        try:
            cc_num = int(address.rsplit("/", 1)[-1])
            cc_val = _float_to_cc_value(float(args[0]))
            if 0 <= cc_num <= 127:
                self.midi.control_change(self.config.cc_channel, cc_num, cc_val)
        except (TypeError, ValueError):
            logger.debug("Invalid explicit CC OSC message: %s %r", address, args)

    def _handle_rms(self, address: str, *args: Any) -> None:
        """Convenience handler mapping /cyberjam/rms -> CC 74 (Brightness/Cutoff)."""
        if args:
            try:
                self.midi.control_change(self.config.cc_channel, 74, _float_to_cc_value(float(args[0])))
            except (TypeError, ValueError):
                pass

    def _handle_centroid(self, address: str, *args: Any) -> None:
        """Convenience handler mapping /cyberjam/centroid -> CC 71 (Resonance/Timbre)."""
        if args:
            try:
                self.midi.control_change(self.config.cc_channel, 71, _float_to_cc_value(float(args[0])))
            except (TypeError, ValueError):
                pass
