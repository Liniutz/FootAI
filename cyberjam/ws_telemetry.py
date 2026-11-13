"""Visual telemetry WebSocket server ("The Face") broadcasting at ~20 Hz (50ms)."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import websockets

from .config import MusicalState, SessionConfig

logger = logging.getLogger(__name__)


class VisualTelemetryServer:
    """Broadcasts live DSP & musical state JSON to TouchDesigner / React clients."""

    def __init__(self, config: SessionConfig, state: MusicalState) -> None:
        self.config = config
        self.state = state
        self._clients: set[Any] = set()
        self._server: Any = None
        self._broadcast_task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        """Start the WebSocket server and periodic 50ms broadcast loop."""
        self._stop_event.clear()
        self._server = await websockets.serve(
            self._client_handler,
            self.config.ws_host,
            self.config.ws_port,
        )
        self._broadcast_task = asyncio.create_task(self._broadcast_loop())
        logger.info(
            "Visual telemetry WebSocket server listening on ws://%s:%d (%dms interval)",
            self.config.ws_host,
            self.config.ws_port,
            self.config.ws_interval_ms,
        )

    async def stop(self) -> None:
        """Stop the broadcast loop and close the WebSocket server."""
        self._stop_event.set()
        if self._broadcast_task is not None:
            self._broadcast_task.cancel()
            try:
                await self._broadcast_task
            except asyncio.CancelledError:
                pass
            self._broadcast_task = None

        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        logger.info("Visual telemetry WebSocket server stopped.")

    async def _client_handler(self, websocket: Any) -> None:
        self._clients.add(websocket)
        remote = getattr(websocket, "remote_address", "unknown")
        logger.info("Visual client connected: %s (total=%d)", remote, len(self._clients))
        try:
            async for _ in websocket:
                # Visual clients are read-only consumers; ignore incoming messages
                pass
        except websockets.ConnectionClosed:
            pass
        finally:
            self._clients.discard(websocket)
            logger.info("Visual client disconnected: %s (total=%d)", remote, len(self._clients))

    async def _broadcast_loop(self) -> None:
        interval_sec = self.config.ws_interval_ms / 1000.0
        while not self._stop_event.is_set():
            if self._clients:
                payload = json.dumps(self.state.snapshot(consume_onset=True))
                websockets.broadcast(self._clients, payload)
            await asyncio.sleep(interval_sec)
