/**
 * Horizontal 6-string guitar fretboard geometry (track E restyle).
 *
 * Notes are laid out on six horizontal strings tuned like a guitar (standard
 * E-A-D-G-B-E). Each incoming note is placed on the string whose open-string
 * pitch is nearest its MIDI number. Notes enter at the right "now" line and
 * scroll LEFT into the past over a fixed window (rolling live history — the
 * MIDI/pitch data has no look-ahead). All math is pure and unit-testable.
 */
import type { BandMidiEvent, MidiRole } from "../types";

/** Visible history window in ms (how far back along the neck a note travels). */
export const FRETBOARD_WINDOW_MS = 4000;

/** Number of strings on the board. */
export const STRING_COUNT = 6;

/**
 * Standard-tuning open-string MIDI notes, index 0 = top row (high E) down to
 * index 5 = bottom row (low E). Rendering top→bottom mirrors a guitar held
 * with the high string up on screen.
 *   high E4 = 64, B3 = 59, G3 = 55, D3 = 50, A2 = 45, low E2 = 40
 */
export const STRING_OPEN_MIDI: number[] = [64, 59, 55, 50, 45, 40];

/** Short labels for each string row (top→bottom). */
export const STRING_LABELS: string[] = ["e", "B", "G", "D", "A", "E"];

/** Relative render thickness per string (low strings are thicker). */
export const STRING_THICKNESS: number[] = [1, 1.3, 1.7, 2.1, 2.6, 3.2];

/** Grayscale gem shade per band role (distinguished by brightness). */
export const ROLE_GEM_COLORS: Record<MidiRole, number> = {
  drums: 0xffffff, // white
  bass: 0xb0b0b0, // light gray
  cc: 0x707070, // mid gray
};

/** Fretboard accent shades (grayscale, hex for Pixi). */
export const BOARD_WOOD = 0x0c0c0c; /* near-black board */
export const BOARD_EDGE = 0x8a8a8a; /* gray binding */
export const STRING_COLOR = 0xbfbfbf; /* steel string */
export const FRET_COLOR = 0x5a5a5a; /* fret wire */
export const NUT_COLOR = 0xffffff; /* "now" line / nut */

/** Fraction of width reserved at the left for string labels / nut. */
export const LABEL_MARGIN_FRAC = 0.06;

export interface Size {
  width: number;
  height: number;
}

/** Map a MIDI note to the nearest string index 0..5 (by open-string pitch). */
export function midiToString(midi: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < STRING_OPEN_MIDI.length; i++) {
    const dist = Math.abs(midi - STRING_OPEN_MIDI[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** True when a note is older than the visible window. */
export function isExpired(
  eventTime: number,
  now: number,
  windowMs = FRETBOARD_WINDOW_MS,
): boolean {
  return now - eventTime > windowMs;
}

/**
 * Horizontal X for a note's age. now (age 0) sits at the right edge; older
 * notes scroll left toward the nut/label margin.
 */
export function ageToX(
  ageMs: number,
  size: Size,
  windowMs = FRETBOARD_WINDOW_MS,
): number {
  const left = size.width * LABEL_MARGIN_FRAC;
  const right = size.width;
  const frac = 1 - ageMs / windowMs; // 1 at now (right), 0 at window edge (left)
  return left + Math.min(1, Math.max(0, frac)) * (right - left);
}

/** Vertical Y (center) of a string row 0..5, top→bottom. */
export function stringY(stringIndex: number, size: Size): number {
  const pad = size.height * 0.1;
  const usable = size.height - pad * 2;
  const gap = usable / (STRING_COUNT - 1);
  return pad + gap * stringIndex;
}

/** Gem radius scaled to the board height. */
export function gemRadius(size: Size): number {
  return Math.max(5, size.height * 0.05);
}

export interface FretboardGem {
  role: MidiRole;
  stringIndex: number;
  x: number;
  y: number;
  radius: number;
  color: number;
  /** 0..1 velocity-based brightness. */
  intensity: number;
}

/**
 * Build renderable gems from band events. Only note_on events become gems;
 * expired notes are dropped.
 */
export function buildFretboardGems(
  events: BandMidiEvent[],
  now: number,
  size: Size,
  windowMs = FRETBOARD_WINDOW_MS,
): FretboardGem[] {
  if (size.width <= 0 || size.height <= 0) return [];
  const r = gemRadius(size);
  const gems: FretboardGem[] = [];
  for (const e of events) {
    if (e.kind !== "note_on") continue;
    const age = now - e.time;
    if (age < 0 || age > windowMs) continue;
    const stringIndex = midiToString(e.data1);
    gems.push({
      role: e.role,
      stringIndex,
      x: ageToX(age, size, windowMs),
      y: stringY(stringIndex, size),
      radius: r,
      color: ROLE_GEM_COLORS[e.role],
      intensity: e.data2 / 127,
    });
  }
  return gems;
}
