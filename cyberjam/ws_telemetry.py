"""
Visual Telemetry WebSocket Server ("The Face").
Broadcasts MusicalState JSON at 20 Hz (every 50 ms) for visualizers / DAW dashboards.
Includes robust port reuse and release handling.
"""

from __future__ import annotations

import asyncio
import json
import logging
from aiohttp import web

from .config import MusicalState, SessionConfig

logger = logging.getLogger(__name__)


class WebSocketTelemetryServer:
    def __init__(self, config: SessionConfig, state: MusicalState) -> None:
        self.config = config
        self.state = state
        self.app = web.Application()
        self.app.router.add_get("/", self.handle_ws)
        self.runner: web.AppRunner | None = None
        self.site: web.TCPSite | None = None
        self._clients: set[web.WebSocketResponse] = set()
        self._task: asyncio.Task[None] | None = None

    async def handle_ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self._clients.add(ws)
        logger.info(f"Telemetry client connected from {request.remote}")
        try:
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    pass
        finally:
            self._clients.discard(ws)
            logger.info("Telemetry client disconnected")
        return ws

    async def _broadcast_loop(self) -> None:
        while True:
            await asyncio.sleep(0.05)  # 20 Hz (50 ms)
            if not self._clients:
                continue
            snapshot = self.state.snapshot()
            payload = json.dumps(snapshot)
            for ws in list(self._clients):
                try:
                    await ws.send_str(payload)
                except Exception:
                    self._clients.discard(ws)

    async def start(self) -> None:
        # Clean up any existing socket bindings on port
        import socket
        for _ in range(3):
            try:
                self.runner = web.AppRunner(self.app)
                await self.runner.setup()
                self.site = web.TCPSite(self.runner, "127.0.0.1", self.config.ws_port)
                await self.site.start()
                break
            except OSError:
                if self.runner:
                    await self.runner.cleanup()
                await asyncio.sleep(0.5)
        else:
            # Force kill any process holding port 8080 if needed
            import subprocess
            subprocess.run(["fuser", "-k", f"{self.config.ws_port}/tcp"], capture_output=True)
            await asyncio.sleep(0.5)
            self.runner = web.AppRunner(self.app)
            await self.runner.setup()
            self.site = web.TCPSite(self.runner, "127.0.0.1", self.config.ws_port)
            await self.site.start()

        self._task = asyncio.create_task(self._broadcast_loop())
        logger.info(f"WebSocket telemetry server running at ws://127.0.0.1:{self.config.ws_port}")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        for ws in list(self._clients):
            await ws.close()
        self._clients.clear()
        if self.site:
            await self.site.stop()
            self.site = None
        if self.runner:
            await self.runner.cleanup()
            self.runner = None
        logger.info("WebSocket telemetry server stopped")
