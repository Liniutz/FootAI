import { beforeEach, describe, expect, it } from "vitest";
import { useVisualizerStore } from "./store";

describe("beginner coach timeline", () => {
  beforeEach(() => {
    useVisualizerStore.setState({ coachRunId: 0, coachStartedAtMs: null });
  });

  it("restarts the run and anchors the clock at the given playback position", () => {
    useVisualizerStore.getState().restartCoach(2.5);
    const state = useVisualizerStore.getState();
    expect(state.coachRunId).toBe(1);
    expect(state.coachStartedAtMs).not.toBeNull();
    // Playback is already 2.5s in, so bar 1 (elapsed 0) maps 2.5s into the past.
    const elapsed = performance.now() - (state.coachStartedAtMs as number);
    expect(elapsed).toBeGreaterThanOrEqual(2500);
    expect(elapsed).toBeLessThan(3500);
  });

  it("resets to position zero for a fresh take", () => {
    useVisualizerStore.getState().restartCoach(10);
    useVisualizerStore.getState().restartCoach();
    const state = useVisualizerStore.getState();
    expect(state.coachRunId).toBe(2);
    expect(performance.now() - (state.coachStartedAtMs as number)).toBeLessThan(500);
  });
});
