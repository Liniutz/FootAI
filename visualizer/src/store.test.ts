/** Spec Task 2 tests: store initial state and actions. */
import { beforeEach, describe, expect, it } from "vitest";
import { INITIAL_SELECTION, useVisualizerStore } from "./store";
import type { TelemetryFrame } from "./types";

function freshStore() {
  useVisualizerStore.setState({
    latestFrame: null,
    connectionStatus: "connecting",
    audioStatus: "idle",
    selection: INITIAL_SELECTION,
  });
}

const SAMPLE_FRAME: TelemetryFrame = {
  timestamp: 1763042450.123456,
  bpm: 122.45,
  detected_pitch: { hz: 110.0, note: "A2", midi: 45, key: "A" },
  rms: 0.08412,
  spectral_centroid_hz: 1420.55,
  onset: true,
};

describe("useVisualizerStore", () => {
  beforeEach(freshStore);

  it("has the expected initial state", () => {
    const s = useVisualizerStore.getState();
    expect(s.latestFrame).toBeNull();
    expect(s.connectionStatus).toBe("connecting");
    expect(s.audioStatus).toBe("idle");
    expect(s.selection).toEqual({ songId: null, instrumentIds: [] });
  });

  it("sets the latest telemetry frame", () => {
    useVisualizerStore.getState().setLatestFrame(SAMPLE_FRAME);
    expect(useVisualizerStore.getState().latestFrame).toEqual(SAMPLE_FRAME);
  });

  it("sets connection and audio statuses", () => {
    useVisualizerStore.getState().setConnectionStatus("open");
    useVisualizerStore.getState().setAudioStatus("active");
    const s = useVisualizerStore.getState();
    expect(s.connectionStatus).toBe("open");
    expect(s.audioStatus).toBe("active");
  });

  it("sets the full selection", () => {
    useVisualizerStore
      .getState()
      .setSelection({ songId: "cargo-song", instrumentIds: ["drums"] });
    expect(useVisualizerStore.getState().selection).toEqual({
      songId: "cargo-song",
      instrumentIds: ["drums"],
    });
  });

  it("sets the selected song without clearing instruments", () => {
    useVisualizerStore.getState().toggleInstrument("bass");
    useVisualizerStore.getState().setSong("cargo-song");
    expect(useVisualizerStore.getState().selection).toEqual({
      songId: "cargo-song",
      instrumentIds: ["bass"],
    });
  });

  it("toggles instruments on and off", () => {
    const { toggleInstrument } = useVisualizerStore.getState();
    toggleInstrument("drums");
    toggleInstrument("bass");
    expect(useVisualizerStore.getState().selection.instrumentIds).toEqual([
      "drums",
      "bass",
    ]);

    toggleInstrument("drums");
    expect(useVisualizerStore.getState().selection.instrumentIds).toEqual([
      "bass",
    ]);
  });

  it("resets the selection", () => {
    useVisualizerStore
      .getState()
      .setSelection({ songId: "x", instrumentIds: ["a", "b"] });
    useVisualizerStore.getState().resetSelection();
    expect(useVisualizerStore.getState().selection).toEqual(INITIAL_SELECTION);
  });
});
