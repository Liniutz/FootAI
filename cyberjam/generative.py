"""Live-conditioned generative groove engine ("The Brain", no ML dependencies).

The original stubs returned one fixed 16-step loop, so the band sounded identical
no matter what was played. This module generates a *new* bar every time, driven by
live guitar features:

* **key / mode** — inferred from a rolling pitch-class histogram (major vs minor
  decided by which third is actually played more),
* **intensity** (`rms`) — controls note density, velocity and groove choice,
* **brightness** (`spectral_centroid_hz`) — controls hi-hat subdivision and cymbal use,
* **creativity** — probability of mutating the current motif / groove.

Everything is deterministic per seed, so it is testable, but it never repeats the
same bar twice in a row unless the player's input is identical.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import random

# General MIDI drum map (channel 10 / index 9)
GM_KICK = 36
GM_SNARE = 38
GM_CLOSED_HAT = 42
GM_LOW_TOM = 45
GM_OPEN_HAT = 46
GM_MID_TOM = 47
GM_CRASH = 49
GM_HIGH_TOM = 50

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

SCALES: dict[str, tuple[int, ...]] = {
    "minor": (0, 2, 3, 5, 7, 8, 10),
    "major": (0, 2, 4, 5, 7, 9, 11),
}

# Bass rhythm templates: (step, length_in_steps) — chosen by intensity.
BASS_RHYTHMS: tuple[tuple[tuple[int, int], ...], ...] = (
    ((0, 2), (6, 2), (8, 2), (14, 2)),                       # sparse
    ((0, 2), (3, 1), (6, 2), (8, 2), (11, 1), (14, 2)),      # classic rock
    ((0, 1), (2, 1), (4, 1), (6, 1), (8, 1), (10, 1), (12, 1), (14, 1)),  # driving 8ths
    ((0, 2), (4, 1), (6, 1), (8, 2), (12, 1), (14, 1)),      # syncopated
)

# Drum grooves: (kick steps, snare steps, hat steps, open-hat steps)
DRUM_GROOVES: tuple[tuple[tuple[int, ...], tuple[int, ...], tuple[int, ...], tuple[int, ...]], ...] = (
    ((0, 8), (4, 12), (0, 2, 4, 6, 8, 10, 12, 14), (14,)),                 # laid back
    ((0, 6, 8, 11), (4, 12), (0, 2, 4, 6, 8, 10, 12, 14), (14,)),          # rock drive
    ((0, 3, 6, 10), (4, 12), (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15), (15,)),  # funk 16ths
    ((0, 4, 8, 12), (4, 12), (0, 2, 4, 6, 8, 10, 12, 14), ()),              # four on the floor
    ((0, 7, 8), (4, 12), (0, 2, 4, 6, 8, 10, 12, 14), (6,)),                # half-time feel
)


@dataclass(frozen=True)
class MidiStepEvent:
    step: int
    note: int
    velocity: int


@dataclass
class LiveContext:
    """Snapshot of what the guitar is doing right now."""

    bpm: float = 120.0
    root_pc: int = 4          # E
    mode: str = "minor"
    rms: float = 0.0
    centroid: float = 0.0
    pitch_classes: tuple[int, ...] = ()
    creativity: float = 0.5


@dataclass
class _BassMotif:
    rhythm: tuple[tuple[int, int], ...]
    degrees: list[int] = field(default_factory=list)


def infer_key(pitch_classes: tuple[int, ...] | list[int], fallback_pc: int = 4) -> tuple[int, str]:
    """Infer (root pitch class, mode) from a rolling pitch-class histogram.

    The most frequent pitch class becomes the tonic; the mode is decided by
    whether the minor third or the major third is played more often.
    """
    if not pitch_classes:
        return fallback_pc, "minor"

    counts = [0] * 12
    for pc in pitch_classes:
        counts[int(pc) % 12] += 1

    root = max(range(12), key=lambda pc: counts[pc])
    minor_third = counts[(root + 3) % 12]
    major_third = counts[(root + 4) % 12]
    mode = "major" if major_third > minor_third else "minor"
    return root, mode


class LiveGrooveGenerator:
    """Generates a fresh bass line + drum groove for every bar."""

    def __init__(self, seed: int | None = None, creativity: float = 0.5) -> None:
        self.rng = random.Random(seed)
        self.creativity = max(0.0, min(1.0, creativity))
        self._bass: _BassMotif | None = None
        self._groove: tuple[tuple[int, ...], tuple[int, ...], tuple[int, ...], tuple[int, ...]] | None = None
        self._bar = 0
        self._last_bass_notes: list[int] = []

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
        return max(low, min(high, value))

    def _scale_note(self, root_pc: int, mode: str, degree: int) -> int:
        scale = SCALES.get(mode, SCALES["minor"])
        octave, index = divmod(degree, len(scale))
        note = 36 + root_pc + 12 * octave + scale[index]
        # Keep the bass inside a playable E1-E3 window.
        while note < 28:
            note += 12
        while note > 55:
            note -= 12
        return note

    def _humanise(self, velocity: int) -> int:
        return int(self._clamp(velocity + self.rng.randint(-6, 6), 20, 127))

    def _pick_rhythm(self, intensity: float) -> tuple[tuple[int, int], ...]:
        # Sparse, jazzy phrasing only: leave space between notes.
        return self.rng.choice(BASS_RHYTHMS[:2])

    def _walk_degrees(self, count: int, start: int = 0) -> list[int]:
        """Markov-ish walk over scale degrees: stepwise motion, occasional leaps."""
        degrees = [start]
        for _ in range(count - 1):
            current = degrees[-1]
            # Mean-revert so the line stays around the root instead of drifting away.
            if abs(current) >= 3 and self.rng.random() < 0.65:
                step = -1 if current > 0 else 1
            else:
                roll = self.rng.random()
                if roll < 0.45:
                    step = self.rng.choice((-1, 1))
                elif roll < 0.7:
                    step = self.rng.choice((-2, 2))
                elif roll < 0.85:
                    step = 0
                else:
                    step = self.rng.choice((-4, 4, 7, -7))  # fifth / octave leap
            degrees.append(max(-5, min(5, current + step)))
        return degrees

    def _mutate_degrees(self, degrees: list[int]) -> list[int]:
        if not degrees:
            return degrees
        mutated = list(degrees)
        for index in range(len(mutated)):
            if self.rng.random() < self.creativity * 0.75:
                mutated[index] = max(-5, min(5, mutated[index] + self.rng.choice((-2, -1, 1, 2))))
        return mutated

    # -------------------------------------------------------------------- bass
    def _next_bass(self, ctx: LiveContext, intensity: float) -> list[MidiStepEvent]:
        if self._bass is None or self.rng.random() < self.creativity * 0.35:
            rhythm = self._pick_rhythm(intensity)
            self._bass = _BassMotif(rhythm=rhythm, degrees=self._walk_degrees(len(rhythm)))
        else:
            # Keep the motif but vary it, so it evolves instead of looping.
            self._bass.degrees = self._mutate_degrees(self._bass.degrees)
            if self.rng.random() < self.creativity * 0.25:
                self._bass.rhythm = self._pick_rhythm(intensity)

        events: list[MidiStepEvent] = []
        for (step, _length), degree in zip(self._bass.rhythm, self._bass.degrees):
            note = self._scale_note(ctx.root_pc, ctx.mode, degree)
            # Occasional chromatic approach note for a jazzier line.
            if self.rng.random() < self.creativity * 0.35:
                note += self.rng.choice((-1, 1))
            while note < 28:
                note += 12
            while note > 55:
                note -= 12
            # Soft, round dynamics: no hard accents.
            base = 98 if step == 0 else 80
            vel = int(self._clamp(base + self.rng.randint(-6, 6), 40, 108))
            events.append(MidiStepEvent(step, note, vel))
        self._last_bass_notes = [e.note for e in events]
        return events

    # ------------------------------------------------------------------ drums
    def _next_drums(self, ctx: LiveContext, intensity: float, brightness: float) -> list[MidiStepEvent]:
        """Plain 4/4 backbeat: kick on 1 & 3, snare on 2 & 4, closed hats on 8ths.

        No double-pedal runs, no fills, and at most two kicks per bar, so the
        groove stays simple no matter how busy the guitar is.
        """
        events: list[MidiStepEvent] = []

        for step in range(0, 16, 2):
            velocity = 96 if step % 4 == 0 else 74
            events.append(MidiStepEvent(step, GM_CLOSED_HAT, self._humanise(velocity)))

        events.append(MidiStepEvent(0, GM_KICK, self._humanise(112)))
        events.append(MidiStepEvent(8, GM_KICK, self._humanise(102)))
        events.append(MidiStepEvent(4, GM_SNARE, self._humanise(106)))
        events.append(MidiStepEvent(12, GM_SNARE, self._humanise(112)))

        if self._bar % 4 == 0:
            events.append(MidiStepEvent(0, GM_CRASH, self._humanise(92)))

        return events

    # ------------------------------------------------------------------- public
    def next_bar(self, ctx: LiveContext) -> tuple[list[MidiStepEvent], list[MidiStepEvent]]:
        """Return ``(bass_events, drum_events)`` for the next bar."""
        intensity = self._clamp(ctx.rms / 0.25)
        brightness = self._clamp(ctx.centroid / 3000.0)

        bass = self._next_bass(ctx, intensity)
        drums = self._next_drums(ctx, intensity, brightness)
        self._bar += 1
        return bass, drums

    def describe(self, ctx: LiveContext) -> str:
        intensity = self._clamp(ctx.rms / 0.25)
        return (
            f"key={NOTE_NAMES[ctx.root_pc % 12]} {ctx.mode} "
            f"intensity={intensity:.2f} brightness={self._clamp(ctx.centroid / 3000.0):.2f} "
            f"creativity={self.creativity:.2f}"
        )
