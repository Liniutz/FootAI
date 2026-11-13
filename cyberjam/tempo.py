"""Guitar-optimised tempo tracking ("The Ears" -> BPM).

Solo guitar differs from full-band music: there is no kick/snare backbone, strums contain
many soft up-strokes, and the dominant periodicity is often the 8th-note strum rather than
the quarter-note beat. The tracker therefore:

* scores each candidate tempo with a *comb* over autocorrelation lags of the beat and its
  sub-/super-divisions (1/2, 1x, 2x, 4x beat) instead of a single peak,
* applies a soft log-Gaussian prior around typical guitar tempos to resolve octave errors,
* requires two agreeing estimates before jumping to a new tempo (stability for the visuals),
* is pure NumPy (no librosa/numba), so it is fast, deterministic and works without aubio.
"""

from __future__ import annotations

from collections import deque

import numpy as np

MIN_BPM = 60.0
MAX_BPM = 180.0
PRIOR_BPM = 110.0
PRIOR_WIDTH_OCT = 1.4  # std-dev of the log2 prior in octaves (soft, never excludes a tempo)

# Comb weights over lag multiples of the beat period: (multiple, weight).
# Tuned on synthetic strum patterns (quarters / 8ths / 16ths / folk, jitter + noise): the 3x
# and 8x lags disambiguate dotted-beat and half/double-tempo confusions typical for solo guitar.
_COMB: tuple[tuple[float, float], ...] = (
    (0.5, 0.2),
    (1.0, 1.0),
    (2.0, 0.6),
    (3.0, 0.6),
    (4.0, 0.3),
    (8.0, 0.4),
)


def estimate_bpm(
    env: np.ndarray,
    fps: float,
    min_bpm: float = MIN_BPM,
    max_bpm: float = MAX_BPM,
    prior_bpm: float = PRIOR_BPM,
    prior_width_oct: float = PRIOR_WIDTH_OCT,
) -> tuple[float, float] | None:
    """Estimate tempo from an onset-strength envelope sampled at ``fps`` frames/second.

    Returns ``(bpm, confidence)`` or ``None`` when the envelope has no usable rhythm.
    ``confidence`` is the winning comb score divided by the median score (>= 1.0).
    """
    x = np.asarray(env, dtype=np.float64)
    n = len(x)
    # 8x-beat lag at the slowest tempo needs ~2 bars; the comb ignores lags beyond 60% of the window
    if n < int(2.0 * fps):
        return None

    # Remove slow level drift, keep only positive excursions (onset peaks), compress dynamics
    x = x - np.mean(x)
    x = np.maximum(x, 0.0)
    peak = float(np.max(x))
    if peak <= 1e-9:
        return None
    x = np.sqrt(x / peak)

    # Unbiased, normalised autocorrelation via FFT
    nfft = 1 << int(np.ceil(np.log2(2 * n)))
    spec = np.fft.rfft(x, nfft)
    ac = np.fft.irfft(spec * np.conj(spec), nfft)[:n]
    if ac[0] <= 1e-12:
        return None
    ac = ac / ac[0]
    ac = ac / np.maximum(1.0 - np.arange(n) / n, 0.25)

    bpms = np.arange(min_bpm, max_bpm + 0.01, 0.5)
    lags = fps * 60.0 / bpms
    lag_axis = np.arange(n, dtype=np.float64)

    scores = np.zeros_like(bpms)
    for mult, weight in _COMB:
        mlags = lags * mult
        valid = mlags < (n * 0.6)
        vals = np.interp(mlags, lag_axis, ac)
        scores += np.where(valid, weight * vals, 0.0)

    prior = np.exp(-0.5 * (np.log2(bpms / prior_bpm) / prior_width_oct) ** 2)
    weighted = scores * prior

    best = int(np.argmax(weighted))
    if weighted[best] <= 0.0:
        return None
    median = float(np.median(weighted))
    confidence = float(weighted[best] / median) if median > 1e-9 else float("inf")
    return float(bpms[best]), confidence


class GuitarTempoTracker:
    """Streaming tempo tracker: push onset-strength frames, poll for a stable BPM."""

    def __init__(
        self,
        fps: float,
        window_sec: float = 6.0,
        min_sec: float = 3.8,
        update_sec: float = 1.0,
        min_confidence: float = 1.6,
        jump_tolerance: float = 0.06,
    ) -> None:
        self.fps = float(fps)
        self.min_frames = int(min_sec * fps)
        self.update_frames = max(1, int(update_sec * fps))
        self.min_confidence = min_confidence
        self.jump_tolerance = jump_tolerance
        self._env: deque[float] = deque(maxlen=int(window_sec * fps))
        self._frames_since_update = 0
        self._bpm: float | None = None
        self._pending: float | None = None

    @property
    def bpm(self) -> float | None:
        return self._bpm

    def reset(self) -> None:
        self._env.clear()
        self._frames_since_update = 0
        self._bpm = None
        self._pending = None

    def push(self, flux: float) -> float | None:
        """Append one onset-strength frame. Returns the BPM when a (re)estimate was produced."""
        self._env.append(float(flux))
        self._frames_since_update += 1
        if len(self._env) < self.min_frames or self._frames_since_update < self.update_frames:
            return None
        self._frames_since_update = 0
        return self._update()

    def _update(self) -> float | None:
        result = estimate_bpm(
            np.fromiter(self._env, dtype=np.float64, count=len(self._env)),
            self.fps,
            prior_bpm=self._bpm if self._bpm is not None else PRIOR_BPM,
            prior_width_oct=PRIOR_WIDTH_OCT if self._bpm is None else 0.6,
        )
        if result is None:
            return self._bpm
        cand, confidence = result
        if confidence < self.min_confidence:
            return self._bpm

        if self._bpm is None:
            # First lock needs two consecutive agreeing estimates
            if self._pending is not None and self._close(cand, self._pending):
                self._bpm = (cand + self._pending) / 2.0
                self._pending = None
            else:
                self._pending = cand
            return self._bpm

        if self._close(cand, self._bpm):
            self._pending = None
            self._bpm = 0.7 * self._bpm + 0.3 * cand
        elif self._pending is not None and self._close(cand, self._pending):
            # Confirmed tempo change
            self._bpm = cand
            self._pending = None
        else:
            self._pending = cand
        return self._bpm

    def _close(self, a: float, b: float) -> bool:
        return abs(a - b) <= self.jump_tolerance * max(a, b)
