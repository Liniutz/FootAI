"""Guitar tempo tracker tests (synthetic strum envelopes)."""

from __future__ import annotations

import unittest

import numpy as np

from cyberjam.tempo import GuitarTempoTracker, estimate_bpm

FPS = 48000 / 512


def strum_env(bpm: float, pattern: list[float], secs: float = 6.0, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(secs * FPS)
    env = np.abs(rng.standard_normal(n)) * 0.05
    beat = 60.0 / bpm
    t = rng.uniform(0, beat)
    while t < secs:
        for k, amp in enumerate(pattern):
            if amp <= 0:
                continue
            idx = int((t + k * 4 * beat / len(pattern) + rng.normal(0, 0.012)) * FPS)
            if 0 <= idx < n:
                env[idx] += amp * rng.uniform(0.7, 1.0)
        t += 4 * beat
    return env


EIGHTHS = [1, 0.5, 0.8, 0.5, 0.9, 0.5, 0.8, 0.5]
SIXTEENTHS = [1, 0.3, 0.5, 0.3, 0.8, 0.3, 0.5, 0.3, 0.9, 0.3, 0.5, 0.3, 0.8, 0.3, 0.5, 0.3]
QUARTERS = [1, 0.7, 0.8, 0.7]


class TestEstimate(unittest.TestCase):
    def test_too_short_or_silent_returns_none(self) -> None:
        self.assertIsNone(estimate_bpm(np.ones(int(1.0 * FPS)), FPS))
        self.assertIsNone(estimate_bpm(np.zeros(int(6 * FPS)), FPS))

    def test_common_guitar_tempos_within_4_percent(self) -> None:
        hits = total = 0
        for pat in (EIGHTHS, SIXTEENTHS, QUARTERS):
            for bpm in (80, 90, 100, 110, 120):
                for seed in range(2):
                    total += 1
                    res = estimate_bpm(strum_env(bpm, pat, seed=seed), FPS)
                    if res and abs(res[0] - bpm) <= 0.04 * bpm:
                        hits += 1
        self.assertGreaterEqual(hits / total, 0.75, f"{hits}/{total}")

    def test_output_always_in_range(self) -> None:
        for bpm in (50, 200):
            res = estimate_bpm(strum_env(bpm, EIGHTHS), FPS)
            if res:
                self.assertTrue(60.0 <= res[0] <= 180.0)


class TestTracker(unittest.TestCase):
    def _run(self, tracker: GuitarTempoTracker, env: np.ndarray) -> list[float]:
        return [b for f in env if (b := tracker.push(float(f))) is not None]

    def test_locks_and_is_stable(self) -> None:
        tr = GuitarTempoTracker(FPS)
        outs = self._run(tr, strum_env(100, SIXTEENTHS, secs=14.0))
        self.assertTrue(outs)
        self.assertAlmostEqual(outs[-1], 100.0, delta=4.0)
        tail = outs[-4:]
        self.assertLess(max(tail) - min(tail), 4.0)

    def test_reset_clears_state(self) -> None:
        tr = GuitarTempoTracker(FPS)
        self._run(tr, strum_env(100, SIXTEENTHS, secs=14.0))
        tr.reset()
        self.assertIsNone(tr.bpm)
        self.assertIsNone(tr.push(1.0))

    def test_single_outlier_does_not_jump_tempo(self) -> None:
        tr = GuitarTempoTracker(FPS)
        self._run(tr, strum_env(100, SIXTEENTHS, secs=14.0))
        locked = tr.bpm
        tr._pending = None
        tr._env.clear()
        self._run(tr, strum_env(150, EIGHTHS, secs=4.5, seed=3))  # one disagreeing estimate at most
        self.assertAlmostEqual(tr.bpm, locked, delta=0.3 * locked)


if __name__ == "__main__":
    unittest.main()
