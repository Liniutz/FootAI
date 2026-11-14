#!/usr/bin/env python3
"""
CyberJam & Nota DAW MCP Bridge.
Exposes Model Context Protocol (MCP) tools over HTTP to configure and control
the Nota DAW (.mcp.json at port 3900) or manage CyberJam session states,
MIDI egress, audio DSP, and ML parameter injection.
"""

import asyncio
import json
import logging
import os
import aiohttp
from aiohttp import web

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("nota_mcp_bridge")

class NotaMcpBridgeServer:
    def __init__(self, host="127.0.0.1", port=3900):
        self.host = host
        self.port = port
        self.app = web.Application()
        self.app.router.add_get('/', self.handle_root)
        self.app.router.add_post('/', self.handle_mcp_rpc)
        self.app.router.add_get('/sse', self.handle_sse)
        
        # State representing Nota DAW / CyberJam configuration
        self.project_config = {
            "name": "CyberJam_Nota_Session",
            "bpm": 125.0,
            "key": "E Minor",
            "swing": 16,
            "tracks": [
                {"name": "Guitarix Amp", "type": "audio", "channel": 1, "plugin": "guitarix"},
                {"name": "Finger Bass", "type": "midi", "channel": 2, "plugin": "yoshimi"},
                {"name": "808 Drums", "type": "midi", "channel": 10, "plugin": "avldrums"}
            ],
            "rnn_parameters": {
                "temperature": 1.0,
                "density": 1.0,
                "key": "E"
            }
        }

    async def handle_root(self, request):
        return web.json_response({
            "name": "Nota DAW & CyberJam MCP Server",
            "version": "1.0",
            "status": "online",
            "endpoints": ["/", "/sse"],
            "project_config": self.project_config
        })

    async def handle_sse(self, request):
        response = web.StreamResponse()
        response.content_type = 'text/event-stream'
        await response.prepare(request)
        await response.write(b"data: {\"type\": \"connected\"}\n\n")
        try:
            while True:
                await asyncio.sleep(10)
                await response.write(b"data: {\"type\": \"ping\"}\n\n")
        except Exception:
            pass
        return response

    async def handle_mcp_rpc(self, request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        
        method = body.get("method", "tools/list")
        req_id = body.get("id", 1)
        
        logger.info(f"Received MCP RPC method: {method} with params: {body.get('params')}")

        if method == "initialize":
            return web.json_response({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "Nota-CyberJam-MCP", "version": "1.0"}
                }
            })
        elif method == "tools/list":
            return web.json_response({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "tools": [
                        {
                            "name": "nota_get_config",
                            "description": "Get current Nota DAW project and track configuration.",
                            "inputSchema": {"type": "object", "properties": {}}
                        },
                        {
                            "name": "nota_set_bpm",
                            "description": "Set project tempo (BPM) live in Nota DAW / CyberJam.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {"bpm": {"type": "number"}},
                                "required": ["bpm"]
                            }
                        },
                        {
                            "name": "nota_set_rnn_params",
                            "description": "Adjust RNN temperature, density, or key live during playback.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "temperature": {"type": "number"},
                                    "density": {"type": "number"},
                                    "key": {"type": "string"}
                                }
                            }
                        },
                        {
                            "name": "nota_add_track",
                            "description": "Add a new track (Audio, MIDI, or Instrument) to Nota DAW.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string"},
                                    "type": {"type": "string"},
                                    "plugin": {"type": "string"}
                                },
                                "required": ["name", "type"]
                            }
                        }
                    ]
                }
            })
        elif method == "tools/call":
            params = body.get("params", {})
            tool_name = params.get("name")
            arguments = params.get("arguments", {})

            if tool_name == "nota_get_config":
                return web.json_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": json.dumps(self.project_config, indent=2)}]}
                })
            elif tool_name == "nota_set_bpm":
                bpm = float(arguments.get("bpm", 120.0))
                self.project_config["bpm"] = bpm
                return web.json_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": f"Successfully updated BPM to {bpm}"}]}
                })
            elif tool_name == "nota_set_rnn_params":
                for k, v in arguments.items():
                    if k in self.project_config["rnn_parameters"]:
                        self.project_config["rnn_parameters"][k] = v
                return web.json_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": f"Successfully updated RNN parameters: {self.project_config['rnn_parameters']}"}]}
                })
            elif tool_name == "nota_add_track":
                track = {
                    "name": arguments.get("name", "New Track"),
                    "type": arguments.get("type", "midi"),
                    "plugin": arguments.get("plugin", "default")
                }
                self.project_config["tracks"].append(track)
                return web.json_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": f"Successfully added track: {track}"}]}
                })
            else:
                return web.json_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Tool not found: {tool_name}"}
                })
        else:
            return web.json_response({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"}
            })

    async def start(self):
        runner = web.AppRunner(self.app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.port)
        await site.start()
        logger.info(f"Nota DAW MCP Bridge server running at http://{self.host}:{self.port}")
        while True:
            await asyncio.sleep(3600)

def main():
    server = NotaMcpBridgeServer()
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("Shutting down Nota MCP Bridge...")

if __name__ == "__main__":
    main()
