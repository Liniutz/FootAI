/** Spec Task 14 tests: flow reducers + mood. */
import { describe, expect, it } from "vitest";
import {
  computeFlow,
  energyScore,
  moodFromFlow,
  pitchStabilityScore,
  tempoSteadinessScore,
} from "./flow";
import type { TelemetryFrame } from "../types";

function frame(o: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return {
    timestamp: 0,
    bpm: 120,
    detected_pitch: { hz: 110, note: "A2", midi: 45, key: "A" },
    rms: 0.1,
    spectral_centroid_hz: 1000,
    onset: false,
    ...o,
  };
}

const silent = frame({
  rms: 0,
  onset: false,
  detected_pitch: { hz: 0, note: "N/A", midi: 0, key: "C" },
});

describe("energyScore", () => {
  it("is ~0 for silence and higher for energetic play", () => {
    expect(energyScore([silent, silent])).toBeLessThan(0.05);
    const energetic = Array.from({ length: 10 }, (_, i) =>
      frame({ rms: 0.2, onset: i % 2 === 0 }),
    );
    expect(energyScore(energetic)).toBeGreaterThan(0.5);
  });
});

describe("pitchStabilityScore", () => {
  it("is high for a steady pitch and lower for jumps", () => {
    const steady = Array.from({ length: 6 }, () =>
      frame({ detected_pitch: { hz: 110, note: "A2", midi: 45, key: "A" } }),
    );
    expect(pitchStabilityScore(steady)).toBeCloseTo(1);

    const jumpy = [45, 60, 40, 70, 50, 65].map((m) =>
      frame({ detected_pitch: { hz: 100, note: "x", midi: m, key: "A" } }),
    );
    expect(pitchStabilityScore(jumpy)).toBeLessThan(0.6);
  });
});

describe("tempoSteadinessScore", () => {
  it("is high for stable BPM, lower for fluctuating BPM", () => {
    const stable = Array.from({ length: 6 }, () => frame({ bpm: 120 }));
    expect(tempoSteadinessScore(stable)).toBeCloseTo(1);

    const wobbly = [110, 140, 100, 150, 120, 130].map((b) => frame({ bpm: b }));
    expect(tempoSteadinessScore(wobbly)).toBeLessThan(0.5);
  });
});

describe("moodFromFlow", () => {
  it("maps flow + energy to moods", () => {
    expect(moodFromFlow(0.9, 0)).toBe("idle"); // no energy -> idle
    expect(moodFromFlow(0.1, 0.5)).toBe("slump");
    expect(moodFromFlow(0.3, 0.5)).toBe("warming");
    expect(moodFromFlow(0.6, 0.5)).toBe("playing");
    expect(moodFromFlow(0.9, 0.9)).toBe("hyped");
  });
});

describe("computeFlow", () => {
  it("collapses to idle/0 on silence", () => {
    const r = computeFlow([silent, silent, silent]);
    expect(r.flow).toBe(0);
    expect(r.mood).toBe("idle");
  });

  it("produces high flow + hyped for steady energetic play", () => {
    const frames = Array.from({ length: 30 }, (_, i) =>
      frame({ rms: 0.25, onset: i % 2 === 0, bpm: 120 }),
    );
    const r = computeFlow(frames);
    expect(r.flow).toBeGreaterThan(0.6);
    expect(r.mood).toBe("hyped");
    expect(r.flow).toBeLessThanOrEqual(1);
  });
});
