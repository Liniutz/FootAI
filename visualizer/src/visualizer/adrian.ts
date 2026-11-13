/**
 * Pure mappings + asset manifest for the Adrian Barar sprite (spec Task 15).
 *
 * Adrian (Cargo's founder) plays along with the user. His animation state is
 * driven by `PerformanceMood`; effects scale with the flow score. Art is a
 * swappable placeholder — the manifest declares frames per mood so real pixel
 * art drops in later without code changes.
 */
import type { PerformanceMood } from "../types";
import { clamp } from "./noteVisuals";

/** Describes how a mood animates (frame count + playback speed). */
export interface AnimationDescriptor {
  mood: PerformanceMood;
  /** Number of frames in the mood's loop. */
  frameCount: number;
  /** Frames per second for the loop. */
  fps: number;
  /** Strum/bob amplitude in px (placeholder art motion). */
  bobAmplitude: number;
}

/** Placeholder manifest: one entry per mood. Real art replaces frameCount/art. */
export const ADRIAN_ANIMATIONS: Record<PerformanceMood, AnimationDescriptor> = {
  idle: { mood: "idle", frameCount: 2, fps: 2, bobAmplitude: 2 },
  warming: { mood: "warming", frameCount: 3, fps: 4, bobAmplitude: 4 },
  playing: { mood: "playing", frameCount: 4, fps: 8, bobAmplitude: 8 },
  hyped: { mood: "hyped", frameCount: 4, fps: 12, bobAmplitude: 14 },
  slump: { mood: "slump", frameCount: 2, fps: 1.5, bobAmplitude: 1 },
};

/** Look up the animation for a mood. */
export function animationForMood(mood: PerformanceMood): AnimationDescriptor {
  return ADRIAN_ANIMATIONS[mood];
}

/** Effect parameters derived from the flow score (0..1). */
export interface EffectParams {
  /** Glow radius in px. */
  glow: number;
  /** Particle spawn rate per second. */
  particleRate: number;
  /** Background hue tint 0..360 (cool -> warm as flow rises). */
  hue: number;
  /** Onset pulse/shake magnitude in px. */
  shake: number;
}

/** Map flow (0..1) to effect parameters. */
export function effectsForFlow(flow: number): EffectParams {
  const f = clamp(flow, 0, 1);
  return {
    glow: Math.round(f * 40),
    particleRate: Math.round(f * 30),
    hue: Math.round(200 - f * 160), // 200 (cool) -> 40 (warm)
    shake: Math.round(f * 8),
  };
}

/** Validate the manifest (used in tests / future real-art integration). */
export function isManifestValid(
  manifest: Record<PerformanceMood, AnimationDescriptor>,
): boolean {
  const moods: PerformanceMood[] = [
    "idle",
    "warming",
    "playing",
    "hyped",
    "slump",
  ];
  return moods.every((m) => {
    const a = manifest[m];
    return (
      !!a &&
      a.mood === m &&
      a.frameCount >= 1 &&
      a.fps > 0 &&
      a.bobAmplitude >= 0
    );
  });
}

/** A mood's accent color — colored pixel-art sprite tint (not grayscale). */
export const MOOD_COLORS: Record<PerformanceMood, number> = {
  idle: 0x6b5a47, // aged bronze
  warming: 0x38bdf8, // cool blue
  playing: 0x39d353, // green
  hyped: 0xff7b1a, // fiery orange
  slump: 0x7a3b52, // muted maroon
};
