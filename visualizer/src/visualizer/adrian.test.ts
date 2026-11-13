/** Spec Task 15 tests: Adrian mood/flow mappings + manifest. */
import { describe, expect, it } from "vitest";
import {
  ADRIAN_ANIMATIONS,
  animationForMood,
  effectsForFlow,
  isManifestValid,
  MOOD_COLORS,
} from "./adrian";
import type { PerformanceMood } from "../types";

const MOODS: PerformanceMood[] = [
  "idle",
  "warming",
  "playing",
  "hyped",
  "slump",
];

describe("animationForMood", () => {
  it("returns a descriptor for every mood", () => {
    for (const m of MOODS) {
      const a = animationForMood(m);
      expect(a.mood).toBe(m);
      expect(a.frameCount).toBeGreaterThanOrEqual(1);
      expect(a.fps).toBeGreaterThan(0);
    }
  });

  it("animates faster and bigger as energy rises", () => {
    expect(animationForMood("hyped").fps).toBeGreaterThan(
      animationForMood("idle").fps,
    );
    expect(animationForMood("hyped").bobAmplitude).toBeGreaterThan(
      animationForMood("slump").bobAmplitude,
    );
  });
});

describe("effectsForFlow", () => {
  it("scales glow/particles/shake with flow and warms the hue", () => {
    const low = effectsForFlow(0);
    const high = effectsForFlow(1);
    expect(high.glow).toBeGreaterThan(low.glow);
    expect(high.particleRate).toBeGreaterThan(low.particleRate);
    expect(high.shake).toBeGreaterThan(low.shake);
    expect(high.hue).toBeLessThan(low.hue); // warmer (lower hue) at high flow
  });

  it("clamps out-of-range flow", () => {
    expect(effectsForFlow(2).glow).toBe(effectsForFlow(1).glow);
    expect(effectsForFlow(-1).glow).toBe(effectsForFlow(0).glow);
  });
});

describe("manifest + colors", () => {
  it("validates the placeholder manifest", () => {
    expect(isManifestValid(ADRIAN_ANIMATIONS)).toBe(true);
  });
  it("has a color for every mood", () => {
    for (const m of MOODS) expect(typeof MOOD_COLORS[m]).toBe("number");
  });
});
