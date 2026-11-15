/**
 * Chord shapes + per-song progressions for Beginner mode (chord-diagram coach).
 *
 * A chord shape describes how to finger it on a standard-tuned 6-string guitar.
 * Strings are indexed 0..5 from the LOW E (6th string) to the high E (1st
 * string); this matches how a diagram is read top-to-bottom when the low E is
 * drawn at the top. For each string a `ChordStringState` says whether it is
 * played open (`"open"`, drawn as `O`), muted (`"muted"`, drawn as `X`), or
 * fretted at a given fret (1-based) with an optional finger number (1..4).
 *
 * All data is static (no engine dependency); the diagrams and the osu!-style
 * approach circle are driven locally from the selected song's reference BPM.
 */

/** 0 = low E (6th string) ... 5 = high E (1st string). */
export const STRING_COUNT = 6;

/** Per-string state in a chord shape. */
export type ChordStringState =
  | { kind: "open" }
  | { kind: "muted" }
  | { kind: "fret"; fret: number; finger?: 1 | 2 | 3 | 4 };

export interface ChordShape {
  /** Display name, e.g. "Em", "G", "C". */
  name: string;
  /** Exactly STRING_COUNT entries, low-E first. */
  strings: ChordStringState[];
}

const O: ChordStringState = { kind: "open" };
const X: ChordStringState = { kind: "muted" };
const fret = (f: number, finger?: 1 | 2 | 3 | 4): ChordStringState => ({
  kind: "fret",
  fret: f,
  finger,
});

const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/**
 * Build a rock power chord (root + fifth) for a pitch class, 0 = C, in
 * standard tuning. The root sits on the low-E string when that keeps the
 * hand low on the neck; otherwise it moves to the A string. Open shapes are
 * used for E5 and A5.
 */
export function powerChordShape(pitchClass: number): ChordShape {
  const pc = ((pitchClass % 12) + 12) % 12;
  const name = `${PC_NAMES[pc]}5`;
  const fretOnLowE = (pc - 4 + 12) % 12;
  if (fretOnLowE === 0) {
    // E5: open low E + B and E at fret 2.
    return { name, strings: [O, fret(2, 2), fret(2, 3), X, X, X] };
  }
  const fretOnA = (pc - 9 + 12) % 12;
  if (fretOnLowE <= fretOnA) {
    return {
      name,
      strings: [fret(fretOnLowE, 1), fret(fretOnLowE + 2, 3), fret(fretOnLowE + 2, 4), X, X, X],
    };
  }
  if (fretOnA === 0) {
    // A5: open A + D and G at fret 2.
    return { name, strings: [X, O, fret(2, 3), fret(2, 4), X, X] };
  }
  return {
    name,
    strings: [X, fret(fretOnA, 1), fret(fretOnA + 2, 3), fret(fretOnA + 2, 4), X, X],
  };
}

/**
 * A small library of common open-position chords (low-E first).
 * These are standard beginner shapes.
 */
const OPEN_CHORDS: Record<string, ChordShape> = {
  Em: { name: "Em", strings: [O, fret(2, 2), fret(2, 3), O, O, O] },
  G: { name: "G", strings: [fret(3, 2), fret(2, 1), O, O, O, fret(3, 3)] },
  C: { name: "C", strings: [X, fret(3, 3), fret(2, 2), O, fret(1, 1), O] },
  D: { name: "D", strings: [X, X, O, fret(2, 1), fret(3, 3), fret(2, 2)] },
  A: { name: "A", strings: [X, O, fret(2, 1), fret(2, 2), fret(2, 3), O] },
  Am: { name: "Am", strings: [X, O, fret(2, 2), fret(2, 3), fret(1, 1), O] },
  E: { name: "E", strings: [O, fret(2, 2), fret(2, 3), fret(1, 1), O, O] },
};

export const CHORD_LIBRARY: Record<string, ChordShape> = {
  ...OPEN_CHORDS,
  // Every rock power chord, "C5" … "B5", used by the Cargo stem songs.
  ...Object.fromEntries(PC_NAMES.map((_, pc) => {
    const shape = powerChordShape(pc);
    return [shape.name, shape] as const;
  })),
};

/** Look up a chord shape by name, or `undefined` if unknown. */
export function getChord(name: string): ChordShape | undefined {
  return CHORD_LIBRARY[name];
}

/** Resolve a chord shape by name, falling back to a muted placeholder. */
export function chordShapeFor(name: string): ChordShape {
  return getChord(name) ?? { name, strings: Array(STRING_COUNT).fill(X) };
}

/**
 * Per-song chord progression (one chord per bar, 4/4). Keyed by catalog song
 * id. The progression loops: bar N shows `progression[N % length]`.
 */
export const SONG_PROGRESSIONS: Record<string, readonly string[]> = {
  // Ziua Vrăjitoarelor (Cargo stem song, key E) — E5-heavy riffing loop.
  "cargo-song": ["E5", "E5", "B5", "A5"],
  // Andri Popa (Cargo stem song) — A-major driven riff loop.
  "cargo-andri-popa": ["A5", "D5", "G5", "A5"],
  // Nu Mai Am Țigări (Cargo stem song) — slow A/E rock ballad loop.
  "cargo-nu-mai-am-tigari": ["A5", "E5", "B5", "G5"],
  // Free Jam (key E) — simple I–IV–V-ish open chords.
  "free-jam": ["E", "A", "D", "A"],
};

/** Fallback progression when a song has none defined. */
export const DEFAULT_PROGRESSION: readonly string[] = ["Em", "G", "C", "D"];

/** The chord-name progression for a song id (never empty). */
export function progressionForSong(
  songId: string | null,
): readonly string[] {
  if (songId && SONG_PROGRESSIONS[songId]) return SONG_PROGRESSIONS[songId];
  return DEFAULT_PROGRESSION;
}

/** Resolve the chord shape for a given bar index (loops the progression). */
export function chordForBar(
  songId: string | null,
  barIndex: number,
): ChordShape {
  const prog = progressionForSong(songId);
  const safeIndex = ((barIndex % prog.length) + prog.length) % prog.length;
  const name = prog[safeIndex];
  return getChord(name) ?? { name, strings: Array(STRING_COUNT).fill(X) };
}
