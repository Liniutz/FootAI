/**
 * Guitar Hero HUD scoring + rock meter (track E restyle).
 *
 * Score/combo/multiplier are derived from the player's onset streaks (each
 * detected strum = a "note hit"); the multiplier climbs with the combo like
 * GH (x1→x2→x3→x4). The Rock Meter reflects the flow score. All pure.
 */
import type { PerformanceMood } from "../types";
import { clamp } from "./noteVisuals";

export interface ScoreState {
  score: number;
  combo: number;
  multiplier: number;
}

export const INITIAL_SCORE: ScoreState = {
  score: 0,
  combo: 0,
  multiplier: 1,
};

/** Base points awarded per registered onset "hit". */
export const BASE_HIT_POINTS = 50;

/** Combo thresholds at which the multiplier steps up (GH-style). */
export const MULTIPLIER_THRESHOLDS = [0, 8, 16, 24];

/** Multiplier for a given combo length (1..4). */
export function multiplierForCombo(combo: number): number {
  let mult = 1;
  for (let i = 0; i < MULTIPLIER_THRESHOLDS.length; i++) {
    if (combo >= MULTIPLIER_THRESHOLDS[i]) mult = i + 1;
  }
  return mult;
}

/**
 * Register a hit (an onset). Increments combo, recomputes the multiplier, and
 * adds points scaled by the multiplier.
 */
export function registerHit(state: ScoreState): ScoreState {
  const combo = state.combo + 1;
  const multiplier = multiplierForCombo(combo);
  return {
    combo,
    multiplier,
    score: state.score + BASE_HIT_POINTS * multiplier,
  };
}

/** Break the combo (e.g. on a long silence); multiplier resets to x1. */
export function breakCombo(state: ScoreState): ScoreState {
  return { ...state, combo: 0, multiplier: 1 };
}

// ---------------------------------------------------------------------------
// Rock meter
// ---------------------------------------------------------------------------

export type RockZone = "fail" | "danger" | "ok" | "good" | "fire";

/** Map flow (0..1) to a rock-meter zone (color/label of the gauge). */
export function rockZone(flow: number): RockZone {
  const f = clamp(flow, 0, 1);
  if (f < 0.15) return "fail";
  if (f < 0.35) return "danger";
  if (f < 0.6) return "ok";
  if (f < 0.85) return "good";
  return "fire";
}

/** Grayscale shade for a rock-meter zone (brighter = hotter). */
export const ROCK_ZONE_COLORS: Record<RockZone, string> = {
  fail: "#3a3a3a",
  danger: "#6e6e6e",
  ok: "#9a9a9a",
  good: "#d0d0d0",
  fire: "#ffffff",
};

/** Whether flames should be shown (high flow / fire zone). */
export function showFlames(flow: number): boolean {
  return rockZone(flow) === "fire";
}

/** A short status word for the HUD based on mood. */
export const MOOD_TAGLINE: Record<PerformanceMood, string> = {
  idle: "WAITING…",
  warming: "WARMING UP",
  playing: "ROCKING",
  hyped: "ON FIRE!",
  slump: "KEEP GOING",
};
