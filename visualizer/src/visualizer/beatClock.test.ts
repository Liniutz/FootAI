/** Beginner-mode timing tests: beat clock + approach circle + hit judgment. */
import { describe, expect, it } from "vitest";
import {
  approachRadiusFraction,
  barPhase,
  BEATS_PER_BAR,
  errorToNearestBeat1,
  hitWindowsForBpm,
  judgeError,
  judgeStrum,
  msPerBar,
  msPerBeat,
  safeBpm,
} from "./beatClock";

describe("tempo math", () => {
  it("clamps nonsense bpm to a sane default/range", () => {
    expect(safeBpm(0)).toBe(120);
    expect(safeBpm(-5)).toBe(120);
    expect(safeBpm(NaN)).toBe(120);
    expect(safeBpm(10)).toBe(30);
    expect(safeBpm(1000)).toBe(300);
    expect(safeBpm(128)).toBe(128);
  });

  it("computes ms per beat and per bar for 120 BPM 4/4", () => {
    expect(msPerBeat(120)).toBe(500);
    expect(msPerBar(120)).toBe(2000);
    expect(BEATS_PER_BAR).toBe(4);
  });
});

describe("barPhase", () => {
  it("is Beat 1 / progress 0 at the start of a bar", () => {
    const p = barPhase(0, 120);
    expect(p.barIndex).toBe(0);
    expect(p.beat).toBe(1);
    expect(p.barProgress).toBeCloseTo(0, 5);
    expect(p.msToNextBeat1).toBeCloseTo(2000, 5);
  });

  it("advances beats within a bar", () => {
    expect(barPhase(500, 120).beat).toBe(2);
    expect(barPhase(1000, 120).beat).toBe(3);
    expect(barPhase(1500, 120).beat).toBe(4);
  });

  it("rolls over to the next bar at Beat 1", () => {
    const p = barPhase(2000, 120);
    expect(p.barIndex).toBe(1);
    expect(p.beat).toBe(1);
    expect(p.barProgress).toBeCloseTo(0, 5);
  });

  it("reports progress near 1 just before the next bar", () => {
    const p = barPhase(1900, 120);
    expect(p.barProgress).toBeCloseTo(0.95, 2);
    expect(p.msToNextBeat1).toBeCloseTo(100, 5);
  });
});

describe("approachRadiusFraction", () => {
  it("is 1 at bar start and 0 at convergence", () => {
    expect(approachRadiusFraction(0)).toBe(1);
    expect(approachRadiusFraction(1)).toBe(0);
    expect(approachRadiusFraction(0.5)).toBeCloseTo(0.5, 5);
  });

  it("clamps out-of-range progress", () => {
    expect(approachRadiusFraction(-0.2)).toBe(1);
    expect(approachRadiusFraction(1.5)).toBe(0);
  });
});

describe("hit judgment", () => {
  it("signs the error early (negative) vs late (positive)", () => {
    // 50 ms into the bar => 50 ms late relative to this bar's Beat 1.
    expect(errorToNearestBeat1(50, 120)).toBeCloseTo(50, 5);
    // 50 ms before the next bar => early relative to next Beat 1.
    expect(errorToNearestBeat1(1950, 120)).toBeCloseTo(-50, 5);
  });

  it("maps errors to verdicts with tempo-scaled windows", () => {
    const w = hitWindowsForBpm(120); // beat=500ms
    expect(judgeError(0, w)).toBe("perfect");
    expect(judgeError(40, w)).toBe("perfect"); // <= 50
    expect(judgeError(80, w)).toBe("good"); // <= 110
    expect(judgeError(150, w)).toBe("ok"); // <= 200
    expect(judgeError(300, w)).toBe("miss");
  });

  it("judgeStrum: dead-on Beat 1 is perfect, off-beat is a miss", () => {
    expect(judgeStrum(0, 120)).toBe("perfect");
    expect(judgeStrum(2000, 120)).toBe("perfect"); // next Beat 1
    expect(judgeStrum(1000, 120)).toBe("miss"); // Beat 3 (mid-bar)
  });
});
