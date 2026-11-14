/**
 * Local beat/bar clock + osu!-style approach-circle timing (Beginner mode).
 *
 * The approach circle contracts in time with the song's BPM in 4/4, converging
 * onto the target exactly on **Beat 1** of each bar. We drive this from a local
 * monotonic clock (not the engine) so it *leads* the player and works without
 * the engine running: the song's reference BPM sets the tempo, and each bar is
 * `beatsPerBar` beats long.
 *
 * All functions here are pure given an elapsed-ms input, so they are unit
 * testable without timers or rendering.
 */

/** Beats per bar (time signature numerator); 4 for 4/4. */
export const BEATS_PER_BAR = 4;

/** Clamp bpm to a sane range so timing math never divides by ~0. */
export function safeBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 120;
  return Math.min(300, Math.max(30, bpm));
}

/** Milliseconds per beat for a given BPM. */
export function msPerBeat(bpm: number): number {
  return 60000 / safeBpm(bpm);
}

/** Milliseconds per bar (one full approach-circle cycle). */
export function msPerBar(bpm: number, beatsPerBar = BEATS_PER_BAR): number {
  return msPerBeat(bpm) * beatsPerBar;
}

export interface BarPhase {
  /** 0-based bar index since the clock started. */
  barIndex: number;
  /** Progress through the CURRENT bar, 0 at Beat 1 → approaching 1 before the next Beat 1. */
  barProgress: number;
  /** Current beat within the bar, 1..beatsPerBar. */
  beat: number;
  /** Milliseconds until the NEXT Beat 1 (when the circle converges). */
  msToNextBeat1: number;
}

/**
 * Compute the bar phase from elapsed milliseconds since the clock's start.
 * Beat 1 of bar 0 is at elapsed = 0.
 */
export function barPhase(
  elapsedMs: number,
  bpm: number,
  beatsPerBar = BEATS_PER_BAR,
): BarPhase {
  const barMs = msPerBar(bpm, beatsPerBar);
  const beatMs = msPerBeat(bpm);
  const e = Math.max(0, elapsedMs);

  const barIndex = Math.floor(e / barMs);
  const intoBar = e - barIndex * barMs; // 0..barMs
  const barProgress = intoBar / barMs; // 0..1
  const beat = Math.floor(intoBar / beatMs) + 1; // 1..beatsPerBar
  const msToNextBeat1 = barMs - intoBar;

  return { barIndex, barProgress, beat, msToNextBeat1 };
}

/**
 * Approach-circle outer radius as a fraction of its start radius.
 *
 * It starts at 1.0 right after a Beat 1 and shrinks LINEARLY to 0.0 exactly at
 * the next Beat 1 (convergence onto the target). Equivalent to `1 - barProgress`.
 */
export function approachRadiusFraction(barProgress: number): number {
  return Math.min(1, Math.max(0, 1 - barProgress));
}

// ---------------------------------------------------------------------------
// Hit judgment (green / yellow / red)
// ---------------------------------------------------------------------------

/** Timing verdict for a strum relative to the nearest Beat 1. */
export type HitVerdict = "perfect" | "good" | "ok" | "miss";

/** The feedback color shown on the target circle for each verdict. */
export const VERDICT_COLOR: Record<HitVerdict, string> = {
  perfect: "#2ecc71", // green
  good: "#2ecc71", // green
  ok: "#f1c40f", // yellow
  miss: "#e74c3c", // red
};

/** Timing windows (ms of absolute error around Beat 1). */
export interface HitWindows {
  perfectMs: number;
  goodMs: number;
  okMs: number;
}

/** Default windows; scale with tempo so faster songs are proportionally tighter. */
export function hitWindowsForBpm(bpm: number): HitWindows {
  const beat = msPerBeat(bpm);
  return {
    perfectMs: beat * 0.1, // within 10% of a beat
    goodMs: beat * 0.22,
    okMs: beat * 0.4,
  };
}

/**
 * Signed error (ms) from a strum time to the NEAREST Beat 1, given the clock.
 * Negative = early, positive = late.
 */
export function errorToNearestBeat1(
  strumElapsedMs: number,
  bpm: number,
  beatsPerBar = BEATS_PER_BAR,
): number {
  const barMs = msPerBar(bpm, beatsPerBar);
  const intoBar = ((strumElapsedMs % barMs) + barMs) % barMs;
  // Late relative to this bar's Beat 1 (positive) vs early for the next
  // bar's Beat 1 (negative).
  return intoBar <= barMs / 2 ? intoBar : intoBar - barMs;
}

/** Judge a timing error (ms) into a verdict using the given windows. */
export function judgeError(errorMs: number, windows: HitWindows): HitVerdict {
  const e = Math.abs(errorMs);
  if (e <= windows.perfectMs) return "perfect";
  if (e <= windows.goodMs) return "good";
  if (e <= windows.okMs) return "ok";
  return "miss";
}

/** Convenience: judge a strum time directly against the beat clock. */
export function judgeStrum(
  strumElapsedMs: number,
  bpm: number,
  beatsPerBar = BEATS_PER_BAR,
): HitVerdict {
  const err = errorToNearestBeat1(strumElapsedMs, bpm, beatsPerBar);
  return judgeError(err, hitWindowsForBpm(bpm));
}
