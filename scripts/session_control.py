#!/usr/bin/env python3
"""Local HTTP control service to start/stop a CyberJam engine session.

Bind to loopback only. The visualizer calls this service when the operator
starts a session; the engine remains running until explicitly stopped here.
"""
from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
from pathlib import Path

from aiohttp import web

ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = int(os.environ.get("CYBERJAM_CONTROL_PORT", "8765"))
PROCESS: subprocess.Popen[bytes] | None = None
LOOPBACK: subprocess.Popen[bytes] | None = None

# Model sets understood by scripts/run_inprocess_session.py --models.
MODEL_SETS = ("cargo", "default", "groovae")


def process_running() -> bool:
    global PROCESS
    if PROCESS is None:
        return False
    if PROCESS.poll() is not None:
        PROCESS = None
        return False
    return True


async def status(_request: web.Request) -> web.Response:
    return web.json_response({"running": process_running()})


async def start(request: web.Request) -> web.Response:
    global PROCESS, LOOPBACK
    if process_running():
        return web.json_response({"running": True, "started": False})

    fish = __import__("shutil").which("fish")
    launcher = ROOT / "start_cyberjam.sh"
    if not fish or not launcher.exists():
        return web.json_response(
            {"running": False, "error": "Fish or start_cyberjam.sh is unavailable"},
            status=500,
        )

    # The in-process launcher doesn't create CyberJam Visual Audio itself,
    # unlike run_session.py. Start its documented helper separately and keep it
    # alive alongside the session.
    loopback_script = ROOT / "scripts" / "setup_pipewire_loopback.sh"
    pw_loopback = __import__("shutil").which("pw-loopback")
    if not pw_loopback or not loopback_script.exists():
        return web.json_response(
            {"running": False, "error": "pw-loopback or scripts/setup_pipewire_loopback.sh is unavailable"},
            status=500,
        )
    LOOPBACK = subprocess.Popen(
        [str(loopback_script)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    # Confirm the actual PipeWire source appeared, not merely that pw-loopback
    # remained alive. Poll briefly because graph registration is asynchronous.
    pw_cli = __import__("shutil").which("pw-cli")
    source_ready = False
    for _ in range(20):
        if LOOPBACK.poll() is not None:
            break
        if pw_cli:
            probe = await asyncio.create_subprocess_exec(
                pw_cli, "ls", "Node", stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            output, _ = await probe.communicate()
            if b'node.name = "CyberJam_VisualSource"' in output and b'node.description = "CyberJam Visual Audio"' in output:
                source_ready = True
                break
        await asyncio.sleep(0.25)
    if not source_ready:
        code = LOOPBACK.poll()
        if code is None:
            os.killpg(LOOPBACK.pid, signal.SIGTERM)
            await asyncio.to_thread(LOOPBACK.wait, 3)
        LOOPBACK = None
        return web.json_response(
            {
                "running": False,
                "error": (
                    f"PipeWire virtual source did not register (pw-loopback exit={code}); "
                    "check PipeWire and run scripts/setup_pipewire_loopback.sh manually"
                ),
            },
            status=500,
        )

    # Freestyle capture is automatic for Menu-started live sessions; explicit
    # command-line --demo remains available when launching the script directly.
    try:
        payload = await request.json()
    except (ValueError, web.HTTPException):
        payload = {}
    freestyle = payload.get("mode") == "freestyle" if isinstance(payload, dict) else False
    models = "cargo"
    if isinstance(payload, dict) and payload.get("models"):
        models = str(payload["models"]).strip().lower()
    if models not in MODEL_SETS:
        models = os.environ.get("CYBERJAM_RNN_SET", "cargo").strip().lower()
    if models not in MODEL_SETS:
        models = "cargo"
    environment = os.environ.copy()
    environment["CYBERJAM_FREESTYLE"] = "1" if freestyle else "0"
    environment["CYBERJAM_RNN_SET"] = models
    # Lowest-latency defaults for the dev flow; override with CYBERJAM_BLOCK.
    block = str(environment.get("CYBERJAM_BLOCK", "64"))
    environment["CYBERJAM_BLOCK"] = block
    environment.setdefault("CYBERJAM_LATENCY", "low")
    # Use the supported live-session launcher (guitar passthrough, DSP, backing
    # band, telemetry and optional Magenta worker), not experimental run_session.py.
    PROCESS = subprocess.Popen(
        [fish, str(launcher), "--models", models, "--block", block],
        cwd=ROOT,
        env=environment,
        start_new_session=True,
    )
    # Wait briefly for early startup errors without blocking the event loop.
    await asyncio.sleep(0.8)
    if PROCESS.poll() is not None:
        code = PROCESS.returncode
        PROCESS = None
        return web.json_response(
            {"running": False, "error": f"Engine exited during startup (code {code})"},
            status=500,
        )
    return web.json_response({"running": True, "started": True, "models": models})


async def stop(_request: web.Request) -> web.Response:
    global PROCESS, LOOPBACK
    stopped = False
    if process_running():
        assert PROCESS is not None
        os.killpg(PROCESS.pid, signal.SIGINT)
        try:
            await asyncio.to_thread(PROCESS.wait, 5)
        except subprocess.TimeoutExpired:
            os.killpg(PROCESS.pid, signal.SIGTERM)
            await asyncio.to_thread(PROCESS.wait, 3)
        PROCESS = None
        stopped = True
    if LOOPBACK is not None:
        if LOOPBACK.poll() is None:
            os.killpg(LOOPBACK.pid, signal.SIGTERM)
            try:
                await asyncio.to_thread(LOOPBACK.wait, 3)
            except subprocess.TimeoutExpired:
                os.killpg(LOOPBACK.pid, signal.SIGKILL)
                await asyncio.to_thread(LOOPBACK.wait, 3)
        LOOPBACK = None
        stopped = True
    # Remove orphaned visual loopbacks from earlier controller runs. Only
    # terminate processes with the exact helper command and this user's UID.
    if os.geteuid() == os.getuid():
        uid = str(os.getuid())
        for proc in Path("/proc").iterdir():
            if not proc.name.isdigit():
                continue
            try:
                if (proc / "status").read_text().split("Uid:", 1)[1].split()[0] != uid:
                    continue
                cmdline = (proc / "cmdline").read_bytes().replace(b"\\0", b" ").decode(errors="ignore")
                if "pw-loopback" in cmdline and "CyberJam_VisualSource" in cmdline:
                    pid = int(proc.name)
                    if pid != os.getpid():
                        os.kill(pid, signal.SIGTERM)
                        stopped = True
            except (OSError, IndexError, ValueError, ProcessLookupError):
                continue
    return web.json_response({"running": False, "stopped": stopped})


def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/status", status)
    app.router.add_post("/start", start)
    app.router.add_post("/stop", stop)
    return app


if __name__ == "__main__":
    print(f"CyberJam session control listening at http://{HOST}:{PORT}", flush=True)
    web.run_app(create_app(), host=HOST, port=PORT, print=None)
