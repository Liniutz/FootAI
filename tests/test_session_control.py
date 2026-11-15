"""Session-control tests: fixed-song sessions keep guitar passthrough, drop models."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def _load_session_control():
    path = Path(__file__).resolve().parents[1] / "scripts" / "session_control.py"
    spec = importlib.util.spec_from_file_location("cyberjam_session_control", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _FakeRequest:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    async def json(self) -> dict:
        return self._payload


class _FakeProcess:
    def __init__(self) -> None:
        self.pid = 4242
        self.returncode = None

    def poll(self):
        return None


class TestSessionControlStart(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.module = _load_session_control()
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "start_cyberjam.sh").write_text("#!/usr/bin/env fish\n")
        (root / "scripts").mkdir()
        (root / "scripts" / "setup_pipewire_loopback.sh").write_text("#!/bin/sh\n")
        self.module.ROOT = root
        self.module.PROCESS = None
        self.module.LOOPBACK = None

        self.popen = mock.MagicMock(return_value=_FakeProcess())

        async def fake_probe(*_args, **_kwargs):
            banner = (
                b'node.name = "CyberJam_VisualSource" '
                b'node.description = "CyberJam Visual Audio"'
            )

            class _Probe:
                async def communicate(self):
                    return banner, b""

            return _Probe()

        self.patches = [
            mock.patch.object(self.module.subprocess, "Popen", self.popen),
            mock.patch.object(self.module.asyncio, "create_subprocess_exec", fake_probe),
            mock.patch.object(self.module.asyncio, "sleep", mock.AsyncMock()),
            mock.patch("shutil.which", lambda name: f"/usr/bin/{name}"),
        ]
        for patch in self.patches:
            patch.start()

    async def asyncTearDown(self) -> None:
        for patch in reversed(self.patches):
            patch.stop()
        self.module.PROCESS = None
        self.module.LOOPBACK = None
        self.tmp.cleanup()

    async def test_passthrough_only_session_disables_rnn_and_band(self) -> None:
        response = await self.module.start(
            _FakeRequest({"mode": "song", "passthrough_only": True})
        )
        body = json.loads(response.text)
        self.assertTrue(body["running"])
        self.assertTrue(body["passthrough_only"])

        command, kwargs = self.popen.call_args
        args = command[0]
        self.assertIn("--no-rnn", args)
        self.assertIn("--no-band", args)
        env = kwargs["env"]
        self.assertEqual(env["CYBERJAM_BAND"], "0")
        self.assertEqual(env["CYBERJAM_RNN"], "0")
        self.assertEqual(env["CYBERJAM_PASSTHROUGH"], "1")

    async def test_live_session_keeps_the_band_enabled(self) -> None:
        response = await self.module.start(_FakeRequest({"mode": "freestyle"}))
        body = json.loads(response.text)
        self.assertFalse(body["passthrough_only"])
        args = self.popen.call_args[0][0]
        self.assertNotIn("--no-band", args)
        self.assertNotIn("--no-rnn", args)
        self.assertEqual(self.popen.call_args[1]["env"]["CYBERJAM_PASSTHROUGH"], "1")


def _load_inprocess_session():
    path = Path(__file__).resolve().parents[1] / "scripts" / "run_inprocess_session.py"
    spec = importlib.util.spec_from_file_location("cyberjam_inprocess_session", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestInProcessFlags(unittest.TestCase):
    def test_no_band_flag_is_parsed(self) -> None:
        try:
            module = _load_inprocess_session()
        except Exception as exc:  # noqa: BLE001 - audio/ML deps may be absent in CI
            self.skipTest(f"in-process session deps unavailable: {exc}")
        with mock.patch("sys.argv", ["run_inprocess_session.py", "--no-band"]):
            args = module._parse_args()
        self.assertTrue(args.no_band)


if __name__ == "__main__":
    unittest.main()
