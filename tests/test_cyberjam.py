"""Unit tests for CyberJam core DSP, state, OSC, and ML stub contracts."""

from __future__ import annotations

import unittest

import numpy as np

from cyberjam.audio_dsp import AudioDSPEngine, hz_to_note_info
from cyberjam.config import MusicalState, SessionConfig
from cyberjam.ml_brain import generate_bass_midi, generate_drum_midi
from cyberjam.osc_wekinator import _float_to_cc_value
from cyberjam.tempo import estimate_bpm


class TestCyberJamCore(unittest.TestCase):
    def test_musical_state_starts_idle(self) -> None:
        state = MusicalState()
        snap = state.snapshot()
        self.assertFalse(snap["is_playing"])
        self.assertEqual(snap["bpm"], 0.0)
        self.assertEqual(snap["bar"], 0)
        self.assertEqual(snap["beat"], 0)
        pitch = snap["detected_pitch"]
        self.assertEqual(pitch["note"], "N/A")
        self.assertEqual(pitch["key"], "N/A")
        self.assertEqual(pitch["hz"], 0.0)

    def test_musical_state_update_and_onset_consume(self) -> None:
        state = MusicalState()
        state.update(is_playing=True, bpm=124.5, bar=2, beat=3, pitch_hz=110.0, note="A2", midi_note=45, key="A", rms=0.1, onset=True)
        snap1 = state.snapshot(consume_onset=True)
        self.assertTrue(snap1["is_playing"])
        self.assertTrue(snap1["onset"])
        self.assertEqual(snap1["bpm"], 124.5)
        self.assertEqual(snap1["bar"], 2)
        self.assertEqual(snap1["beat"], 3)

        snap2 = state.snapshot(consume_onset=True)
        self.assertFalse(snap2["onset"])

    def test_hz_to_note_info_boundaries(self) -> None:
        self.assertEqual(hz_to_note_info(0.0), (0, "N/A", "E"))
        self.assertEqual(hz_to_note_info(110.0), (45, "A2", "A"))
        self.assertEqual(hz_to_note_info(440.0), (69, "A4", "A"))

    def test_osc_float_to_cc_clamping(self) -> None:
        self.assertEqual(_float_to_cc_value(-0.5), 0)
        self.assertEqual(_float_to_cc_value(0.0), 0)
        self.assertEqual(_float_to_cc_value(0.5), 64)
        self.assertEqual(_float_to_cc_value(1.0), 127)
        self.assertEqual(_float_to_cc_value(200.0), 127)

    def test_ml_stubs_valid_midi_bounds(self) -> None:
        for ev in generate_drum_midi(120.0) + generate_bass_midi("E", 120.0):
            self.assertGreaterEqual(ev.step, 0)
            self.assertLessEqual(ev.step, 15)
            self.assertGreaterEqual(ev.note, 0)
            self.assertLessEqual(ev.note, 127)
            self.assertGreaterEqual(ev.velocity, 1)
            self.assertLessEqual(ev.velocity, 127)

    def test_bpm_envelope_waits_for_enough_bars(self) -> None:
        fps = 48000 / 512
        short_env = np.zeros(int(1.5 * fps), dtype=np.float32)
        short_env[::47] = 1.0
        self.assertIsNone(estimate_bpm(short_env, fps))

        env_120 = np.zeros(int(6.0 * fps), dtype=np.float32)
        for t in np.arange(0.0, 6.0, 0.5):
            env_120[int(t * fps)] = 1.0
        for t in np.arange(0.375, 6.0, 1.0):
            env_120[int(t * fps)] = 0.6
        res = estimate_bpm(env_120, fps)
        self.assertIsNotNone(res)
        self.assertAlmostEqual(res[0], 120.0, delta=4.0)

    def test_superflux_vibrato_suppression_and_accent(self) -> None:
        prev = np.zeros(32, dtype=np.float32)
        prev[10] = 2.0
        # Shifted by 1 bin (vibrato) with same amplitude should produce zero flux
        shifted = np.zeros(32, dtype=np.float32)
        shifted[11] = (np.exp(2.0) - 1.0) / 10.0
        flux_vib, _ = AudioDSPEngine._compute_superflux(shifted, prev, rms=0.05)
        self.assertAlmostEqual(flux_vib, 0.0, places=5)

        # True new transient at higher RMS should produce stronger weighted flux
        attack = np.zeros(32, dtype=np.float32)
        attack[20] = 5.0
        flux_soft, _ = AudioDSPEngine._compute_superflux(attack, prev, rms=0.02)
        flux_loud, _ = AudioDSPEngine._compute_superflux(attack, prev, rms=0.15)
        self.assertGreater(flux_loud, flux_soft)


if __name__ == "__main__":
    unittest.main()
