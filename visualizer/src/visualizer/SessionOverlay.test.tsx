/** Spec Task 9 tests: SessionOverlay renders selection + reference overlays. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { SessionOverlay } from "./SessionOverlay";
import { useVisualizerStore, INITIAL_SELECTION } from "../store";
import type { TelemetryFrame } from "../types";

function frame(partial: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return {
    timestamp: 1,
    bpm: 0,
    detected_pitch: { hz: 0, note: "N/A", midi: 0, key: "" },
    rms: 0,
    spectral_centroid_hz: 0,
    onset: false,
    ...partial,
  };
}

function resetStore() {
  useVisualizerStore.setState({
    selection: INITIAL_SELECTION,
    latestFrame: null,
  });
}

describe("SessionOverlay", () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  it("shows a neutral header and all lanes with no selection", () => {
    render(<SessionOverlay />);
    expect(screen.getByTestId("session-song-title")).toHaveTextContent(
      "Free Session",
    );
    expect(screen.getByTestId("session-lane-drums")).toBeInTheDocument();
    expect(screen.getByTestId("session-lane-bass")).toBeInTheDocument();
    expect(screen.getByTestId("session-lane-synth-fx")).toBeInTheDocument();
  });

  it("renders only selected lanes and the chosen song title", () => {
    act(() => {
      useVisualizerStore.setState({
        selection: { songId: "cargo-song", instrumentIds: ["drums", "bass"], mode: "experienced" },
      });
    });
    render(<SessionOverlay />);

    expect(screen.getByTestId("session-song-title")).toHaveTextContent("Cargo");
    expect(screen.getByTestId("session-lane-drums")).toBeInTheDocument();
    expect(screen.getByTestId("session-lane-bass")).toBeInTheDocument();
    expect(screen.queryByTestId("session-lane-synth-fx")).not.toBeInTheDocument();
  });

  it("shows reference BPM/key vs live values and flags a match", () => {
    act(() => {
      useVisualizerStore.setState({
        selection: { songId: "cargo-song", instrumentIds: ["drums"], mode: "experienced" },
        latestFrame: frame({
          bpm: 128,
          detected_pitch: { hz: 82, note: "E2", midi: 40, key: "E" },
        }),
      });
    });
    render(<SessionOverlay />);

    const bpm = screen.getByTestId("session-bpm");
    const key = screen.getByTestId("session-key");
    expect(bpm).toHaveTextContent("128");
    expect(bpm).toHaveTextContent("/ 128");
    expect(bpm.className).toContain("session-ref--match");
    expect(key).toHaveTextContent("E");
    expect(key.className).toContain("session-ref--match");
  });

  it("updates when the selection changes", () => {
    const { rerender } = render(<SessionOverlay />);
    expect(screen.getByTestId("session-lane-synth-fx")).toBeInTheDocument();

    act(() => {
      useVisualizerStore.setState({
        selection: { songId: null, instrumentIds: ["drums"], mode: null },
      });
    });
    rerender(<SessionOverlay />);

    expect(screen.getByTestId("session-lane-drums")).toBeInTheDocument();
    expect(screen.queryByTestId("session-lane-bass")).not.toBeInTheDocument();
  });

  it("shows live BPM/key without a reference target for Freestyle", () => {
    act(() => {
      useVisualizerStore.setState({
        selection: { songId: "freestyle", instrumentIds: ["drums", "bass"], mode: null },
        latestFrame: frame({
          bpm: 134,
          detected_pitch: { hz: 220, note: "A3", midi: 57, key: "A" },
        }),
      });
    });
    render(<SessionOverlay />);

    expect(screen.getByTestId("session-song-title")).toHaveTextContent(
      "Freestyle",
    );
    const bpm = screen.getByTestId("session-bpm");
    const key = screen.getByTestId("session-key");
    // Live values shown…
    expect(bpm).toHaveTextContent("134");
    expect(key).toHaveTextContent("A");
    // …but no "/ reference" target and no match/off coloring.
    expect(bpm).not.toHaveTextContent("/");
    expect(key).not.toHaveTextContent("/");
    expect(bpm.className).toContain("session-ref--none");
    // The freestyle tagline is present.
    expect(screen.getByTestId("session-freestyle-tag")).toHaveTextContent(
      /band follows/i,
    );
  });
});
