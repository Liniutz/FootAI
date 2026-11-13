"""Hardening tests: OSC, MIDI egress, sequencer cleanup, WebSocket schema, onset debounce, Magenta events."""

from __future__ import annotations

import asyncio
import json
import threading
import time
import unittest
from types import SimpleNamespace
from unittest import mock

import numpy as np

from cyberjam.audio_dsp import AudioDSPEngine
from cyberjam.config import MusicalState, SessionConfig
from cyberjam.midi_egress import MidiEgress
from cyberjam.ml_brain import MLSequencer
from cyberjam.osc_wekinator import WekinatorOSCServer, _float_to_cc_value
from cyberjam.ws_telemetry import VisualTelemetryServer


class FakeMidi:
    """Records MIDI traffic; stands in for MidiEgress."""

    def __init__(self) -> None:
        self.ons: list[tuple[int, int, int]] = []
        self.offs: list[tuple[int, int]] = []
        self.ccs: list[tuple[int, int, int]] = []
        self.sent: list[object] = []

    def note_on(self, ch: int, note: int, vel: int = 100) -> None:
        self.ons.append((ch, note, vel))

    def note_off(self, ch: int, note: int) -> None:
        self.offs.append((ch, note))

    def control_change(self, ch: int, cc: int, val: int) -> None:
        self.ccs.append((ch, cc, val))

    def send(self, msg: object) -> None:
        self.sent.append(msg)


class TestOSC(unittest.TestCase):
    def test_nan_and_inf_never_raise(self) -> None:
        self.assertEqual(_float_to_cc_value(float("nan")), 0)
        self.assertEqual(_float_to_cc_value(float("inf")), 127)
        self.assertEqual(_float_to_cc_value(float("-inf")), 0)

    def test_wek_outputs_normalisation_and_bad_args(self) -> None:
        midi = FakeMidi()
        srv = WekinatorOSCServer(SessionConfig(), midi)  # type: ignore[arg-type]
        srv._handle_wek_outputs("/wek/outputs", 0.0, 1.0, "bad", float("inf"), 0.5)
        self.assertEqual([c[2] for c in midi.ccs], [0, 127, 127, 64])  # "bad" skipped
        self.assertTrue(all(c[0] == 0 for c in midi.ccs))  # Channel 1

    def test_wek_outputs_ignores_extra_values(self) -> None:
        midi = FakeMidi()
        srv = WekinatorOSCServer(SessionConfig(), midi)  # type: ignore[arg-type]
        srv._handle_wek_outputs("/wek/outputs", *([0.5] * 20))
        self.assertEqual(len(midi.ccs), 8)

    def test_explicit_cc_range_and_garbage(self) -> None:
        midi = FakeMidi()
        srv = WekinatorOSCServer(SessionConfig(), midi)  # type: ignore[arg-type]
        srv._handle_explicit_cc("/cyberjam/cc/200", 0.5)
        srv._handle_explicit_cc("/cyberjam/cc/abc", 0.5)
        srv._handle_explicit_cc("/cyberjam/cc/7", float("nan"))
        self.assertEqual(midi.ccs, [(0, 7, 0)])
        srv._handle_rms("/cyberjam/rms", "x")
        srv._handle_centroid("/cyberjam/centroid")


class TestMidiEgress(unittest.TestCase):
    def _egress(self) -> tuple[MidiEgress, mock.Mock]:
        egress = MidiEgress()
        port = mock.Mock()
        egress._port = port
        return egress, port

    def test_values_are_clamped(self) -> None:
        egress, port = self._egress()
        egress.note_on(99, 500, 999)
        egress.note_off(-3, -9)
        egress.control_change(40, 300, -5)
        on, off, cc = [c.args[0] for c in port.send.call_args_list]
        self.assertEqual((on.channel, on.note, on.velocity), (15, 127, 127))
        self.assertEqual((off.channel, off.note), (0, 0))
        self.assertEqual((cc.channel, cc.control, cc.value), (15, 127, 0))

    def test_close_panics_with_cc120_and_cc123_on_all_channels(self) -> None:
        egress, port = self._egress()
        egress.close()
        controls = {(m.args[0].channel, m.args[0].control) for m in port.send.call_args_list}
        for ch in range(16):
            self.assertIn((ch, 120), controls)
            self.assertIn((ch, 123), controls)
        port.close.assert_called_once()

    def test_send_without_port_is_noop(self) -> None:
        MidiEgress().note_on(0, 60, 100)


class TestSequencer(unittest.TestCase):
    def test_every_note_on_gets_note_off_after_stop(self) -> None:
        midi = FakeMidi()
        cfg = SessionConfig(default_bpm=240.0)
        seq = MLSequencer(cfg, MusicalState(), midi)  # type: ignore[arg-type]
        seq.start()
        time.sleep(0.6)
        seq.stop()
        from collections import Counter

        on = Counter((c, n) for c, n, _ in midi.ons)
        off = Counter(midi.offs)
        self.assertGreater(sum(on.values()), 0)
        for key, count in on.items():
            self.assertGreaterEqual(off[key], count, f"stuck note {key}")

    def test_midi_error_does_not_kill_thread_and_still_flushes(self) -> None:
        midi = FakeMidi()
        calls = {"n": 0}
        real_on = midi.note_on

        def flaky(ch: int, note: int, vel: int = 100) -> None:
            calls["n"] += 1
            if calls["n"] == 3:
                raise RuntimeError("port vanished")
            real_on(ch, note, vel)

        midi.note_on = flaky  # type: ignore[method-assign]
        seq = MLSequencer(SessionConfig(default_bpm=240.0), MusicalState(), midi)  # type: ignore[arg-type]
        seq.start()
        time.sleep(0.8)
        alive = seq._thread is not None and seq._thread.is_alive()
        seq.stop()
        self.assertTrue(alive)
        self.assertGreater(calls["n"], 5)


class TestTelemetrySchema(unittest.TestCase):
    def test_snapshot_schema_keys(self) -> None:
        snap = MusicalState().snapshot()
        self.assertEqual(
            set(snap),
            {"timestamp", "is_playing", "bpm", "bar", "beat", "detected_pitch", "rms", "spectral_centroid_hz", "onset"},
        )
        self.assertEqual(set(snap["detected_pitch"]), {"hz", "note", "midi", "key"})  # type: ignore[arg-type]
        json.dumps(snap)

    def test_broadcast_sends_json_and_consumes_onset(self) -> None:
        async def run() -> list[str]:
            state = MusicalState()
            state.update(onset=True, is_playing=True)
            srv = VisualTelemetryServer(SessionConfig(ws_interval_ms=10), state)
            got: list[str] = []
            with mock.patch("cyberjam.ws_telemetry.websockets.broadcast", lambda c, p: got.append(p)):
                srv._clients.add(object())
                task = asyncio.create_task(srv._broadcast_loop())
                await asyncio.sleep(0.08)
                srv._stop_event.set()
                await task
            return got

        got = asyncio.run(run())
        self.assertGreaterEqual(len(got), 2)
        self.assertTrue(json.loads(got[0])["onset"])
        self.assertFalse(json.loads(got[1])["onset"])

    def test_stale_onset_expires_and_bpm_resets(self) -> None:
        state = MusicalState()
        state.update(onset=True, bpm=120.0)
        state.last_onset_ts = time.time() - 5.0
        self.assertFalse(state.snapshot()["onset"])
        state.update(reset_bpm=True)
        self.assertEqual(state.snapshot()["bpm"], 0.0)


class TestOnsetDebounce(unittest.TestCase):
    def test_onsets_are_at_least_100ms_apart(self) -> None:
        eng = AudioDSPEngine(SessionConfig(), MusicalState())
        self.addCleanup(eng._udp_sock.close)
        eng._use_aubio = False
        rng = np.random.default_rng(0)
        hop = 512
        fired: list[float] = []
        t = 1000.0
        for i in range(120):
            amp = 0.002 if i < 12 else (0.3 if i % 2 == 0 else 0.05)
            s = (rng.standard_normal(hop) * amp).astype(np.float32)
            rms = float(np.sqrt(np.mean(s**2)))
            mag = np.abs(np.fft.rfft(s * eng._hann))
            t += hop / 48000
            onset, _ = eng._flux_onset_and_bpm(mag, rms, t)
            if onset:
                fired.append(t)
        self.assertGreater(len(fired), 1)
        gaps = np.diff(fired)
        self.assertGreaterEqual(float(gaps.min()), 0.10)


class TestMagentaEvents(unittest.TestCase):
    def _agent_cls(self):
        import magenta_agent

        return magenta_agent.MagentaAgent, magenta_agent

    def test_extract_events_clamps_and_skips_primer(self) -> None:
        cls, _ = self._agent_cls()
        notes = [
            SimpleNamespace(start_time=0.0, end_time=0.5, pitch=40, velocity=100),  # primer
            SimpleNamespace(start_time=0.6, end_time=0.9, pitch=300, velocity=0),
        ]
        evs = cls._extract_events(SimpleNamespace(notes=notes), 0.5, channel=99)
        self.assertEqual(len(evs), 2)
        on = next(e for e in evs if e.msg_type == "note_on")
        self.assertEqual((on.channel, on.pitch, on.velocity), (15, 127, 95))
        self.assertLess(on.offset_sec, next(e for e in evs if e.msg_type == "note_off").offset_sec)

    def test_cancelled_playback_releases_notes(self) -> None:
        cls, mod = self._agent_cls()
        agent = cls.__new__(cls)
        agent._midi_lock = threading.Lock()
        out = mock.Mock()
        timeline = [
            mod._ScheduledMidiEvent(0.0, 1, "note_on", 1, 60, 100),
            mod._ScheduledMidiEvent(30.0, 0, "note_off", 1, 60, 0),
        ]

        async def run() -> None:
            task = asyncio.create_task(agent._play_timeline(timeline, out))
            await asyncio.sleep(0.1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        asyncio.run(run())
        types = [c.args[0].type for c in out.send.call_args_list]
        self.assertEqual(types, ["note_on", "note_off"])


if __name__ == "__main__":
    unittest.main()
