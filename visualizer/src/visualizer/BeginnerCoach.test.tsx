/** BeginnerCoach restart & WAV sync tests. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BeginnerCoach } from "./BeginnerCoach";
import { INITIAL_SELECTION, useVisualizerStore } from "../store";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useVisualizerStore.setState({
    selection: { ...INITIAL_SELECTION, songId: "cargo-song", mode: "beginner" },
    coachRunId: 0,
    coachStartedAtMs: null,
  });
});

describe("BeginnerCoach sync on START", () => {
  it("restarts from bar 1 when restartCoach is called mid-song", async () => {
    // 120 BPM => 2000 ms per bar; 6000 ms elapsed = bar index 3.
    let fakeNow = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => fakeNow);

    // Deterministic chord progression per bar so bar index is observable in DOM.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          base_bpm: 120,
          beats: Array.from({ length: 24 }, (_, i) => i * 0.5),
          chords: [
            { time: 0, chord: "E5", pitch_class: 4 },
            { time: 2, chord: "A5", pitch_class: 9 },
            { time: 4, chord: "B5", pitch_class: 11 },
            { time: 6, chord: "G5", pitch_class: 7 },
          ],
        }),
      }),
    );

    // Prevent RenderLoop from looping continuously; keep mount setup exact.
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    render(<BeginnerCoach />);

    // Let fetchStemProgression settle; origin is still t=1000, now=1000 => bar 0 (E5).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("img", { name: "Timing approach circle" })).toHaveTextContent("E5");

    // Advance 6 seconds into the song (t=7000) and trigger START (restartCoach(0)):
    // the tutorial must jump back to bar 1 (E5) aligned with the WAV start.
    fakeNow = 7000;
    act(() => {
      useVisualizerStore.getState().restartCoach(0);
    });
    expect(screen.getByRole("img", { name: "Timing approach circle" })).toHaveTextContent("E5");

    // If START happens with a non-zero WAV offset (e.g. 4.1s = bar 2), the coach
    // aligns immediately to that bar (B5) rather than bar 0.
    act(() => {
      useVisualizerStore.getState().restartCoach(4.1);
    });
    expect(screen.getByRole("img", { name: "Timing approach circle" })).toHaveTextContent("B5");
  });
});
