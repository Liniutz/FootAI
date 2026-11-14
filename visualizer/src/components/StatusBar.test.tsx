/** Spec Task 10 tests: persistent status bar guidance + recovery. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { useVisualizerStore } from "../store";

function setStatuses(opts: {
  connection?: Parameters<
    ReturnType<typeof useVisualizerStore.getState>["setConnectionStatus"]
  >[0];
  audio?: Parameters<
    ReturnType<typeof useVisualizerStore.getState>["setAudioStatus"]
  >[0];
  midi?: Parameters<
    ReturnType<typeof useVisualizerStore.getState>["setMidiStatus"]
  >[0];
}) {
  act(() => {
    const s = useVisualizerStore.getState();
    if (opts.connection) s.setConnectionStatus(opts.connection);
    if (opts.audio) s.setAudioStatus(opts.audio);
    if (opts.midi) s.setMidiStatus(opts.midi);
  });
}

describe("StatusBar", () => {
  beforeEach(() => {
    useVisualizerStore.setState({
      connectionStatus: "connecting",
      audioStatus: "idle",
      midiStatus: "idle",
    });
  });
  afterEach(cleanup);

  it("shows offline guidance when the engine is down", () => {
    setStatuses({ connection: "closed" });
    render(<StatusBar />);
    expect(screen.getByTestId("status-telemetry")).toHaveTextContent(
      "Engine offline",
    );
    expect(screen.getByTestId("status-hint")).toHaveTextContent(/run_session\.py/);
  });

  it("shows a reconnect indicator while connecting", () => {
    setStatuses({ connection: "connecting" });
    render(<StatusBar />);
    expect(screen.getByTestId("status-reconnect")).toBeInTheDocument();
  });

  it("surfaces audio-denied guidance when the engine is live", () => {
    setStatuses({ connection: "open", audio: "denied" });
    render(<StatusBar />);
    expect(screen.getByTestId("status-audio")).toHaveTextContent("Audio denied");
    expect(screen.getByTestId("status-hint")).toHaveTextContent(/permission was denied/);
  });

  it("clears the hint and reconnect indicator once everything is healthy", () => {
    setStatuses({ connection: "closed", audio: "device-missing" });
    const { rerender } = render(<StatusBar />);
    expect(screen.getByTestId("status-hint")).toBeInTheDocument();

    // Recover: engine connects, audio + midi active.
    setStatuses({ connection: "open", audio: "active", midi: "active" });
    rerender(<StatusBar />);

    expect(screen.queryByTestId("status-hint")).not.toBeInTheDocument();
    expect(screen.queryByTestId("status-reconnect")).not.toBeInTheDocument();
    expect(screen.getByTestId("status-telemetry")).toHaveTextContent("Engine live");
  });

  it("renders passed-in action children", () => {
    render(
      <StatusBar>
        <button type="button">Enable Audio</button>
      </StatusBar>,
    );
    expect(
      screen.getByRole("button", { name: "Enable Audio" }),
    ).toBeInTheDocument();
  });

  it("hides the band-MIDI pill when showMidi is false", () => {
    setStatuses({ connection: "open", midi: "port-missing" });
    render(<StatusBar showMidi={false} />);
    expect(screen.queryByTestId("status-midi")).not.toBeInTheDocument();
    // A missing MIDI port must not drive the guidance line when hidden.
    expect(screen.queryByTestId("status-hint")).not.toBeInTheDocument();
  });
});
