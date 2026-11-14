import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { SessionOverlay } from "./SessionOverlay";
import { INITIAL_SELECTION, useVisualizerStore } from "../store";
import type { TelemetryFrame } from "../types";

afterEach(cleanup);

function frame(partial: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return {
    timestamp: 1,
    bpm: 0,
    detected_pitch: { hz: 0, note: "N/A", midi: 0, key: "N/A" },
    rms: 0,
    spectral_centroid_hz: 0,
    onset: false,
    ...partial,
  };
}

beforeEach(() => useVisualizerStore.setState({ selection: INITIAL_SELECTION, latestFrame: null }));

describe("TV live HUD", () => {
  it("shows the selected song, score, and live BPM/key without band lanes", () => {
    useVisualizerStore.setState({
      selection: { songId: "cargo-song", instrumentIds: [], mode: "experienced" },
      latestFrame: frame({ bpm: 128, detected_pitch: { hz: 82, note: "E2", midi: 40, key: "E" } }),
    });
    render(<SessionOverlay />);
    expect(screen.getByTestId("session-song-title")).toHaveTextContent("Cargo");
    expect(screen.getByTestId("session-bpm")).toHaveTextContent("128");
    expect(screen.getByTestId("session-key")).toHaveTextContent("E");
    expect(screen.getByTestId("score-points")).toBeInTheDocument();
    expect(screen.queryByText(/Drums|Bass|Synth/i)).not.toBeInTheDocument();
  });

  it("shows the Play 4 bars popup for Freestyle before lock and closes once locked", () => {
    useVisualizerStore.setState({
      selection: { songId: "freestyle", instrumentIds: [], mode: null },
      latestFrame: null,
    });
    const { rerender } = render(<SessionOverlay />);
    expect(screen.getByTestId("freestyle-prompt-backdrop")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Freestyle groove setup" })).toHaveTextContent("Play 4 bars");

    act(() => {
      useVisualizerStore.setState({
        latestFrame: frame({ demo_phase: "capture", demo_prompt: "Capturing 2/4 bars…" }),
      });
    });
    rerender(<SessionOverlay />);
    expect(screen.getByTestId("freestyle-prompt-status")).toHaveTextContent("Capturing 2/4 bars…");

    act(() => {
      useVisualizerStore.setState({
        latestFrame: frame({ demo_phase: "locked", demo_prompt: "Locked: 126 BPM, E" }),
      });
    });
    rerender(<SessionOverlay />);
    expect(screen.queryByTestId("freestyle-prompt-backdrop")).not.toBeInTheDocument();
  });
});
