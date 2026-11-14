"""Tests for the live-conditioned generative groove engine."""

import unittest

from cyberjam.generative import (
    LiveContext,
    LiveGrooveGenerator,
    infer_key,
)


class TestInferKey(unittest.TestCase):
    def test_minor_when_minor_third_dominates(self):
        # E, G, B, D -> E minor
        root, mode = infer_key([4, 4, 4, 7, 7, 11, 2])
        self.assertEqual(root, 4)
        self.assertEqual(mode, "minor")

    def test_major_when_major_third_dominates(self):
        # G, B, D, F# -> G major
        root, mode = infer_key([7, 7, 7, 11, 11, 2, 6])
        self.assertEqual(root, 7)
        self.assertEqual(mode, "major")

    def test_empty_histogram_falls_back(self):
        self.assertEqual(infer_key([], fallback_pc=9), (9, "minor"))


class TestLiveGrooveGenerator(unittest.TestCase):
    def _ctx(self, rms=0.1, centroid=1200.0):
        return LiveContext(bpm=120.0, root_pc=4, mode="minor", rms=rms, centroid=centroid)

    def test_notes_stay_in_midi_range(self):
        gen = LiveGrooveGenerator(seed=3, creativity=0.8)
        for _ in range(32):
            bass, drums = gen.next_bar(self._ctx())
            for event in bass + drums:
                self.assertGreaterEqual(event.note, 0)
                self.assertLessEqual(event.note, 127)
                self.assertGreaterEqual(event.velocity, 1)
                self.assertLessEqual(event.velocity, 127)
                self.assertGreaterEqual(event.step, 0)
                self.assertLessEqual(event.step, 15)

    def test_bass_stays_in_playable_window(self):
        gen = LiveGrooveGenerator(seed=11, creativity=1.0)
        for _ in range(32):
            bass, _ = gen.next_bar(self._ctx())
            for event in bass:
                self.assertGreaterEqual(event.note, 28)
                self.assertLessEqual(event.note, 55)

    def test_bass_varies_between_bars(self):
        gen = LiveGrooveGenerator(seed=5, creativity=0.7)
        motifs = []
        for _ in range(8):
            bass, _drums = gen.next_bar(self._ctx())
            motifs.append(tuple((e.step, e.note) for e in bass))
        for previous, current in zip(motifs, motifs[1:]):
            self.assertNotEqual(previous, current)

    def test_drums_are_simple_four_four(self):
        gen = LiveGrooveGenerator(seed=4, creativity=1.0)
        for _ in range(8):
            _bass, drums = gen.next_bar(self._ctx(rms=0.4, centroid=4000.0))
            kicks = sorted(e.step for e in drums if e.note == 36)
            snares = sorted(e.step for e in drums if e.note == 38)
            hats = sorted(e.step for e in drums if e.note == 42)
            # Two kicks per bar, no double pedal.
            self.assertEqual(kicks, [0, 8])
            self.assertEqual(snares, [4, 12])
            self.assertTrue(all(step % 2 == 0 for step in hats))
            self.assertTrue(set(e.note for e in drums) <= {36, 38, 42, 49})

    def test_bass_is_soft_not_punchy(self):
        gen = LiveGrooveGenerator(seed=6, creativity=0.7)
        for _ in range(8):
            bass, _ = gen.next_bar(self._ctx(rms=0.5))
            for event in bass:
                self.assertLessEqual(event.velocity, 108)

    def test_zero_creativity_keeps_motif_stable(self):
        gen = LiveGrooveGenerator(seed=9, creativity=0.0)
        first, _ = gen.next_bar(self._ctx())
        second, _ = gen.next_bar(self._ctx())
        self.assertEqual(
            [(e.step, e.note) for e in first],
            [(e.step, e.note) for e in second],
        )


if __name__ == "__main__":
    unittest.main()
