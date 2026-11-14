import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useVisualizerStore } from "../store";
import type { TelemetryFrame } from "../types";
import { RockMeter } from "./GuitarHeroHud";

afterEach(() => cleanup());

const frame: TelemetryFrame = {
  timestamp: 1,
  bpm: 120,
  detected_pitch: { hz: 110, note: "A2", midi: 45, key: "A" },
  rms: 0.06,
  spectral_centroid_hz: 1000,
  onset: false,
};

describe("RockMeter guitar input", () => {
  it("shows a scaled live RMS meter and numeric input level", () => {
    useVisualizerStore.setState({ latestFrame: frame });
    render(<RockMeter />);
    expect(screen.getByText(/GUITAR\s+INPUT/)).toBeInTheDocument();
    expect(screen.getByTestId("rockmeter-fill")).toHaveStyle({ height: "50%" });
    expect(screen.getByText(/0\.060 RMS/)).toBeInTheDocument();
  });

  it("stays empty before telemetry arrives", () => {
    useVisualizerStore.setState({ latestFrame: null });
    render(<RockMeter />);
    expect(screen.getByTestId("rockmeter-fill")).toHaveStyle({ height: "0%" });
    expect(screen.getByText(/0\.000 RMS/)).toBeInTheDocument();
  });
});
