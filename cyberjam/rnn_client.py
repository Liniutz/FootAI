"""Client for the Magenta RNN worker subprocess.

The RNN models need TensorFlow 2.15 + Magenta, which only run on Python <= 3.11,
so they live in a separate interpreter (``.venv-magenta``). This client keeps a
long-lived worker process, feeds it the live musical context, and hands back
generated bars without ever blocking the audio/sequencer threads.

If the worker is unavailable (missing venv, model load failure, timeout) the
caller simply keeps using the algorithmic generator.
"""

from __future__ import annotations

import collections
import json
import logging
import os
import queue
import subprocess
import threading
import time

logger = logging.getLogger(__name__)


def to_events(raw: list[dict], fold_low: bool = False) -> list[dict]:
    """Normalise RNN worker JSON events into ``{bar, step, note, velocity}`` dicts.

    ``fold_low`` folds notes into a playable bass window (E1-E3, MIDI 28-55)
    so generated bass never drops below the instrument range.
    """
    events: list[dict] = []
    for item in raw or []:
        try:
            step = int(item["step"])
            note = int(item["note"])
            velocity = int(item["velocity"])
        except (KeyError, TypeError, ValueError):
            continue
        bar = int(item.get("bar", 0) or 0)
        if fold_low:
            while note < 28:
                note += 12
            while note > 55:
                note -= 12
        events.append(
            {
                "bar": max(0, bar),
                "step": max(0, min(15, step)),
                "note": max(0, min(127, note)),
                "velocity": max(1, min(127, velocity)),
            }
        )
    events.sort(key=lambda e: (e["bar"], e["step"], e["note"]))
    return events


class RnnClient:
    """Non-blocking bridge to ``scripts/rnn_worker.py``."""

    def __init__(
        self,
        python_exe: str,
        worker_script: str,
        models_dir: str,
        timeout: float = 20.0,
        worker_args: list[str] | None = None,
    ) -> None:
        self.python_exe = python_exe
        self.worker_script = worker_script
        self.models_dir = models_dir
        self.timeout = timeout
        self.worker_args = list(worker_args or [])

        self._proc: subprocess.Popen[str] | None = None
        self._lines: queue.Queue[str] = queue.Queue()
        self._stderr_lines: collections.deque[str] = collections.deque(maxlen=25)
        self._result: dict | None = None
        self._result_lock = threading.Lock()
        self._request_event = threading.Event()
        self._pending: dict | None = None
        self._pending_lock = threading.Lock()
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self.available = False
        self.loaded: list[str] = []

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> bool:
        if not os.path.exists(self.python_exe):
            logger.warning("RNN worker interpreter not found: %s", self.python_exe)
            return False
        if not os.path.exists(self.worker_script):
            logger.warning("RNN worker script not found: %s", self.worker_script)
            return False

        try:
            self._proc = subprocess.Popen(
                [
                    self.python_exe,
                    self.worker_script,
                    "--models-dir",
                    self.models_dir,
                    *self.worker_args,
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Could not start RNN worker: %s", exc)
            return False

        self._stop.clear()
        reader = threading.Thread(target=self._read_loop, name="RnnReader", daemon=True)
        reader.start()
        self._threads.append(reader)
        stderr_reader = threading.Thread(target=self._stderr_loop, name="RnnStderr", daemon=True)
        stderr_reader.start()
        self._threads.append(stderr_reader)

        # Wait for the bundle-loading lines.
        ready = False
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            try:
                line = self._lines.get(timeout=0.2)
            except queue.Empty:
                if self._proc.poll() is not None:
                    self._log_worker_stderr("exited during startup")
                    return False
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if payload.get("ready"):
                ready = True
                for name in payload.get("loaded") or []:
                    if name not in self.loaded:
                        self.loaded.append(name)
                break
            if payload.get("loaded"):
                name = payload["loaded"]
                if isinstance(name, str) and name not in self.loaded:
                    self.loaded.append(name)
                logger.info("RNN bundle loaded: %s (%s)", name, payload.get("generator"))
            elif payload.get("ok") is False:
                logger.error("RNN worker error: %s", payload.get("error"))

        if not self.loaded:
            self._log_worker_stderr("started but loaded no bundles")
            self.stop()
            return False

        self.available = True
        requester = threading.Thread(target=self._request_loop, name="RnnRequester", daemon=True)
        requester.start()
        self._threads.append(requester)
        logger.info("RNN worker ready with bundles: %s", ", ".join(self.loaded))
        return True

    def stop(self) -> None:
        self._stop.set()
        self._request_event.set()
        if self._proc is not None:
            try:
                if self._proc.stdin:
                    self._proc.stdin.write(json.dumps({"cmd": "quit"}) + "\n")
                    self._proc.stdin.flush()
            except Exception:
                pass
            try:
                self._proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                self._proc.kill()
            self._proc = None
        self.available = False

    # -------------------------------------------------------------------- threads
    def _read_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        for line in proc.stdout:
            line = line.strip()
            if line:
                self._lines.put(line)
        self._lines.put("")

    def _stderr_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stderr is None:
            return
        for line in proc.stderr:
            line = line.rstrip()
            if line:
                self._stderr_lines.append(line)

    def _log_worker_stderr(self, reason: str) -> None:
        tail = list(self._stderr_lines)
        if tail:
            logger.error("RNN worker %s. Last stderr lines:\n%s", reason, "\n".join(tail))
        else:
            logger.error("RNN worker %s (no stderr output).", reason)

    def _request_loop(self) -> None:
        while not self._stop.is_set():
            self._request_event.wait(timeout=0.2)
            if self._stop.is_set():
                break
            self._request_event.clear()

            with self._pending_lock:
                request = self._pending
                self._pending = None
            if request is None:
                continue

            proc = self._proc
            if proc is None or proc.stdin is None:
                continue
            try:
                proc.stdin.write(json.dumps(request) + "\n")
                proc.stdin.flush()
            except Exception as exc:  # noqa: BLE001
                logger.warning("RNN request failed: %s", exc)
                self.available = False
                return

            # Wait for the matching response.
            deadline = time.monotonic() + self.timeout
            while time.monotonic() < deadline and not self._stop.is_set():
                try:
                    line = self._lines.get(timeout=0.2)
                except queue.Empty:
                    continue
                if not line:
                    self.available = False
                    self._log_worker_stderr("closed its stdout")
                    return
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if payload.get("loaded"):
                    continue
                if payload.get("ok"):
                    with self._result_lock:
                        self._result = payload
                else:
                    logger.warning("RNN generation error: %s", payload.get("error"))
                break

    # ----------------------------------------------------------------------- api
    def submit(self, context: dict) -> None:
        """Queue a generation request (non-blocking)."""
        if not self.available:
            return
        with self._pending_lock:
            self._pending = context
        self._request_event.set()

    def take(self) -> dict | None:
        """Return the most recent generated bar, if any."""
        with self._result_lock:
            result = self._result
            self._result = None
        return result
