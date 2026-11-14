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

/**
 * A small library of common open-position chords (low-E first).
 * These are standard beginner shapes.
 */
export const CHORD_LIBRARY: Record<string, ChordShape> = {
  Em: { name: "Em", strings: [O, fret(2, 2), fret(2, 3), O, O, O] },
  G: { name: "G", strings: [fret(3, 2), fret(2, 1), O, O, O, fret(3, 3)] },
  C: { name: "C", strings: [X, fret(3, 3), fret(2, 2), O, fret(1, 1), O] },
  D: { name: "D", strings: [X, X, O, fret(2, 1), fret(3, 3), fret(2, 2)] },
  A: { name: "A", strings: [X, O, fret(2, 1), fret(2, 2), fret(2, 3), O] },
  Am: { name: "Am", strings: [X, O, fret(2, 2), fret(2, 3), fret(1, 1), O] },
  E: { name: "E", strings: [O, fret(2, 2), fret(2, 3), fret(1, 1), O, O] },
};

/** Look up a chord shape by name, or `undefined` if unknown. */
export function getChord(name: string): ChordShape | undefined {
  return CHORD_LIBRARY[name];
}

/**
 * Per-song chord progression (one chord per bar, 4/4). Keyed by catalog song
 * id. The progression loops: bar N shows `progression[N % length]`.
 */
export const SONG_PROGRESSIONS: Record<string, readonly string[]> = {
  // Cargo (key E) — a driving minor loop.
  "cargo-song": ["Em", "C", "G", "D"],
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
