"""Tests for the Magenta RNN worker client (no TensorFlow required)."""

import unittest

from cyberjam.rnn_client import RnnClient, to_events


class TestToEvents(unittest.TestCase):
    def test_normalises_and_sorts(self):
        raw = [
            {"step": 8, "note": 40, "velocity": 100},
            {"step": 0, "note": 36, "velocity": 120},
        ]
        events = to_events(raw)
        self.assertEqual([e["step"] for e in events], [0, 8])

    def test_clamps_out_of_range_values(self):
        raw = [{"step": 99, "note": 300, "velocity": 0}]
        event = to_events(raw)[0]
        self.assertEqual(event["step"], 15)
        self.assertEqual(event["note"], 127)
        self.assertEqual(event["velocity"], 1)

    def test_fold_low_keeps_bass_playable(self):
        raw = [{"step": 0, "note": 12, "velocity": 100}, {"step": 4, "note": 70, "velocity": 100}]
        notes = [e["note"] for e in to_events(raw, fold_low=True)]
        for note in notes:
            self.assertGreaterEqual(note, 28)
            self.assertLessEqual(note, 55)

    def test_skips_malformed_entries(self):
        raw = [{"step": 0}, {"note": 40}, "nope", {"step": 1, "note": 40, "velocity": 90}]
        self.assertEqual(len(to_events(raw)), 1)


class TestRnnClientFallback(unittest.TestCase):
    def test_missing_interpreter_is_not_fatal(self):
        client = RnnClient("/nonexistent/python", "/nonexistent/worker.py", "/nonexistent/models")
        self.assertFalse(client.start())
        self.assertFalse(client.available)

    def test_submit_and_take_are_safe_when_unavailable(self):
        client = RnnClient("/nonexistent/python", "/nonexistent/worker.py", "/nonexistent/models")
        client.submit({"bpm": 120})
        self.assertIsNone(client.take())
        client.stop()


if __name__ == "__main__":
    unittest.main()
