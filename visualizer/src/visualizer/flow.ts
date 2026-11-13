/**
 * Performance "flow" scoring from telemetry (spec Task 14, track E).
 *
 * Flow is a lenient 0..1 measure of how energetically and steadily the player
 * is performing — robust to mono pitch-detection noise. Computed from a short
 * rolling window of telemetry frames via pure reducers (unit-testable).
 */
import type { PerformanceMood, TelemetryFrame } from "../types";
import { clamp } from "./noteVisuals";

/** How many recent frames contribute to the score (~1.5s at 20 Hz). */
export const FLOW_WINDOW = 30;

export interface FlowResult {
  /** Overall flow 0..1. */
  flow: number;
  /** Component scores (for effects / debugging). */
  energy: number;
  pitchStability: number;
  tempoSteadiness: number;
  mood: PerformanceMood;
}

/** Mean of a numeric array (0 when empty). */
function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation. */
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

/**
 * Energy: average RMS plus onset density, both lenient. Silence -> ~0.
 */
export function energyScore(frames: TelemetryFrame[]): number {
  if (frames.length === 0) return 0;
  const rms = mean(frames.map((f) => clamp(f.rms, 0, 1)));
  const onsetDensity = frames.filter((f) => f.onset).length / frames.length;
  // RMS is small in practice; scale it up before combining.
  const rmsScaled = clamp(rms * 6, 0, 1);
  return clamp(rmsScaled * 0.7 + onsetDensity * 0.3, 0, 1);
}

/**
 * Pitch stability: 1 when the detected pitch stays coherent across voiced
 * frames, lower when it jumps around. Unvoiced frames (hz<=0) are ignored.
 */
export function pitchStabilityScore(frames: TelemetryFrame[]): number {
  const midis = frames
    .filter((f) => f.detected_pitch.hz > 0 && f.detected_pitch.note !== "N/A")
    .map((f) => f.detected_pitch.midi);
  if (midis.length < 2) return 0;
  const sd = stdev(midis);
  // 0 semitone spread -> 1; ~12 semitones spread -> 0.
  return clamp(1 - sd / 12, 0, 1);
}

/**
 * Tempo steadiness: 1 when BPM is stable across the window, lower when it
 * fluctuates. Zero/invalid BPMs are ignored.
 */
export function tempoSteadinessScore(frames: TelemetryFrame[]): number {
  const bpms = frames.map((f) => f.bpm).filter((b) => b >= 40 && b <= 240);
  if (bpms.length < 2) return 0;
  const sd = stdev(bpms);
  // 0 BPM spread -> 1; ~20 BPM spread -> 0.
  return clamp(1 - sd / 20, 0, 1);
}

/** Derive a discrete mood from the flow score + whether there is any energy. */
export function moodFromFlow(flow: number, energy: number): PerformanceMood {
  if (energy < 0.05) return "idle";
  if (flow < 0.2) return "slump";
  if (flow < 0.45) return "warming";
  if (flow < 0.75) return "playing";
  return "hyped";
}

/** Compute the full flow result from a window of frames (newest last). */
export function computeFlow(frames: TelemetryFrame[]): FlowResult {
  const window = frames.slice(-FLOW_WINDOW);
  const energy = energyScore(window);
  const pitchStability = pitchStabilityScore(window);
  const tempoSteadiness = tempoSteadinessScore(window);
  // Energy dominates (a museum player strumming = good flow); stability/tempo
  // refine it. When there's no energy, flow collapses regardless.
  const raw =
    energy * 0.6 + pitchStability * 0.25 + tempoSteadiness * 0.15;
  const flow = energy < 0.05 ? 0 : clamp(raw, 0, 1);
  return {
    flow,
    energy,
    pitchStability,
    tempoSteadiness,
    mood: moodFromFlow(flow, energy),
  };
}
