"""Unit tests for CyberJam core DSP, state, OSC, and ML stub contracts."""

from __future__ import annotations

import unittest

from cyberjam.audio_dsp import hz_to_note_info
from cyberjam.config import MusicalState, SessionConfig
from cyberjam.ml_brain import generate_bass_midi, generate_drum_midi
from cyberjam.osc_wekinator import _float_to_cc_value


class TestCyberJamCore(unittest.TestCase):
    def test_musical_state_starts_idle(self) -> None:
        state = MusicalState()
        snap = state.snapshot()
        self.assertFalse(snap["is_playing"])
        self.assertEqual(snap["bpm"], 0.0)
        pitch = snap["detected_pitch"]
        self.assertEqual(pitch["note"], "N/A")
        self.assertEqual(pitch["key"], "N/A")
        self.assertEqual(pitch["hz"], 0.0)

    def test_musical_state_update_and_onset_consume(self) -> None:
        state = MusicalState()
        state.update(is_playing=True, bpm=124.5, pitch_hz=110.0, note="A2", midi_note=45, key="A", rms=0.1, onset=True)
        snap1 = state.snapshot(consume_onset=True)
        self.assertTrue(snap1["is_playing"])
        self.assertTrue(snap1["onset"])
        self.assertEqual(snap1["bpm"], 124.5)

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


if __name__ == "__main__":
    unittest.main()
