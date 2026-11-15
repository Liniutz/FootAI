/** Tests for StageFlames intensity curve and non-blocking render. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { computeFlameProfile, StageFlames } from "./StageFlames";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("computeFlameProfile", () => {
  it("keeps atmospheric baseline flames even at zero flow", () => {
    const idle = computeFlameProfile(0, 0);
    expect(idle.intensity).toBeGreaterThan(0.35);
    expect(idle.widthFraction).toBeGreaterThan(0.1);
    expect(idle.heightFraction).toBeGreaterThan(0.5);
  });

  it("grows flame reach and intensity with flow and onset pulse", () => {
    const low = computeFlameProfile(0, 0);
    const high = computeFlameProfile(1, 0);
    const burst = computeFlameProfile(1, 1);

    expect(high.intensity).toBeGreaterThan(low.intensity);
    expect(high.widthFraction).toBeGreaterThan(low.widthFraction);
    expect(high.heightFraction).toBeGreaterThan(low.heightFraction);
    expect(high.emberSpawnRate).toBeGreaterThan(low.emberSpawnRate);

    expect(burst.intensity).toBeGreaterThanOrEqual(high.intensity);
    expect(burst.widthFraction).toBeGreaterThan(high.widthFraction);
  });

  it("clamps out-of-range inputs cleanly", () => {
    expect(computeFlameProfile(5, 5)).toEqual(computeFlameProfile(1, 1));
    expect(computeFlameProfile(-2, -1)).toEqual(computeFlameProfile(0, 0));
  });
});

describe("StageFlames", () => {
  it("mounts a decorative canvas overlay without failing in headless DOM", () => {
    render(<StageFlames />);
    const canvas = screen.getByTestId("stage-flames");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas.className).toContain("stage-flames");
  });
});
