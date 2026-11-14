#!/usr/bin/env python3
"""
CyberJam & Nota DAW Session with live MCP Server integration,
Audio DSP ingress, ML Brain sequence generation, Pro Audio routing,
and WebSocket Visual Telemetry at 20 Hz (`ws://127.0.0.1:8080`).
"""

import asyncio
import logging
import os
import sys
import threading
import time
from aiohttp import web

sys.path.insert(0, '/tmp/claw-daw-src/claw-daw-main')
from cyberjam.audio_dsp import AudioDSPEngine
from cyberjam.config import SessionConfig, MusicalState
from cyberjam.midi_egress import MidiEgress
from cyberjam.ml_brain import MLSequencer
from cyberjam.tempo import GuitarTempoTracker
from cyberjam.ws_telemetry import WebSocketTelemetryServer
from cyberjam.pro_audio_routing import ProAudioRoutingBridge
from nota_mcp_bridge import NotaMcpBridgeServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("nota_session")

class FullCyberJamSession:
    def __init__(self):
        self.config = SessionConfig()
        self.state = MusicalState()
        self.egress = MidiEgress(port_name="CyberJam_Band")
        
        self.routing = ProAudioRoutingBridge()
        self.dsp = AudioDSPEngine(self.config, self.state)
        self.ml = MLSequencer(self.config, self.state, self.egress)
        self.telemetry = WebSocketTelemetryServer(self.config, self.state)
        self.mcp_server = NotaMcpBridgeServer(host="127.0.0.1", port=3900)

    async def async_main(self):
        self.egress.open()
        self.routing.start()
        self.dsp.start()
        self.ml.start()
        await self.telemetry.start()

        # Start MCP server in background thread
        mcp_thread = threading.Thread(target=lambda: asyncio.run(self.mcp_server.start()), daemon=True)
        mcp_thread.start()

        logger.info("==================================================")
        logger.info(" CyberJam + Nota DAW Full Wiring Active!")
        logger.info(" - Audio DSP & ML Brain: Active")
        logger.info(" - MIDI Egress (CyberJam_Band): Active")
        logger.info(" - Pro Audio (Guitarix + FluidSynth): Active")
        logger.info(" - Visual Telemetry API: ws://127.0.0.1:8080")
        logger.info(" - MCP Server (.mcp.json): http://127.0.0.1:3900")
        logger.info("==================================================")

        try:
            while True:
                await asyncio.sleep(3600)
        finally:
            self.ml.stop()
            self.dsp.stop()
            await self.telemetry.stop()
            self.routing.stop()
            self.egress.close()

def main():
    session = FullCyberJamSession()
    try:
        asyncio.run(session.async_main())
    except KeyboardInterrupt:
        logger.info("Shutting down CyberJam session...")

if __name__ == "__main__":
    main()
