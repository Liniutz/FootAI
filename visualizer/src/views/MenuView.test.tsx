/** Spec Task 5 tests: Menu view selection, persistence, rehydrate, navigation. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { MenuView } from "./MenuView";
import { useVisualizerStore } from "../store";
import { INITIAL_SELECTION } from "../store";
import { SELECTION_STORAGE_KEY } from "../menu/persistence";
import { startEngineSession, stopEngineSession } from "../sessionControl";

vi.mock("../sessionControl", () => ({
  startEngineSession: vi.fn().mockResolvedValue({ running: true, started: true }),
  stopEngineSession: vi.fn().mockResolvedValue({ running: false, stopped: true }),
}));

function resetStore() {
  useVisualizerStore.setState({ selection: INITIAL_SELECTION });
}

describe("MenuView", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    window.location.hash = "#/menu";
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("selecting a song updates the store and persists it", () => {
    render(<MenuView />);

    const cargo = screen.getByRole("radio", { name: /Cargo/ });
    act(() => cargo.click());

    expect(useVisualizerStore.getState().selection.songId).toBe("cargo-song");
    const stored = JSON.parse(
      localStorage.getItem(SELECTION_STORAGE_KEY) ?? "{}",
    );
    expect(stored.songId).toBe("cargo-song");
  });

  it("rehydrates a persisted song and mode on mount", () => {
    localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({ songId: "cargo-song", instrumentIds: [], mode: "beginner" }),
    );

    render(<MenuView />);

    expect(screen.getByRole("radio", { name: /Cargo/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Beginner" })).toBeChecked();
    expect(useVisualizerStore.getState().selection).toEqual({
      songId: "cargo-song",
      instrumentIds: [],
      mode: "beginner",
    });
  });

  it("falls back to defaults when stored selection is corrupt", () => {
    localStorage.setItem(SELECTION_STORAGE_KEY, "{broken json");

    render(<MenuView />);

    expect(useVisualizerStore.getState().selection).toEqual(INITIAL_SELECTION);
    expect(screen.getByRole("radio", { name: /Cargo/ })).not.toBeChecked();
  });

  it("shows live BPM and key and has no band-instrument controls", () => {
    useVisualizerStore.setState({ latestFrame: {
      timestamp: 1,
      bpm: 116,
      detected_pitch: { hz: 110, note: "A2", midi: 45, key: "A" },
      rms: 0.1,
      spectral_centroid_hz: 900,
      onset: false,
    } });
    render(<MenuView />);
    expect(screen.getByTestId("menu-bpm")).toHaveTextContent("116");
    expect(screen.getByTestId("menu-key")).toHaveTextContent("A");
    expect(screen.queryByRole("button", { name: "Drums" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bass" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Synth / FX" })).not.toBeInTheDocument();
  });

  it("shows beginner guidance on the Menu screen", () => {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify({
      songId: "cargo-song", instrumentIds: [], mode: "beginner",
    }));
    render(<MenuView />);
    expect(screen.getByLabelText("Beginner coach")).toBeInTheDocument();
  });

  it("starts the engine pipeline before navigating to the Visualizer", async () => {
    render(<MenuView />);

    expect(screen.getByRole("button", { name: /START/ })).toBeDisabled();

    // Picking a real song reveals the difficulty step but Start stays disabled.
    act(() => screen.getByRole("radio", { name: /Cargo/ }).click());
    expect(screen.getByRole("button", { name: /START/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Beginner" })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Experienced" }),
    ).toBeInTheDocument();

    // Choosing a mode enables Start.
    act(() => screen.getByRole("radio", { name: "Beginner" }).click());
    const ready = screen.getByRole("button", { name: /START/ });
    expect(ready).toBeEnabled();

    await act(async () => {
      ready.click();
      await Promise.resolve();
    });
    expect(startEngineSession).toHaveBeenCalledWith("song");
    expect(window.location.hash).toBe("#/menu");
    expect(screen.getByRole("status")).toHaveTextContent("Session live on TV.");
    expect(useVisualizerStore.getState().selection.mode).toBe("beginner");
  });

  it("renders beginner guidance on the menu monitor when beginner mode is selected", () => {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify({
      songId: "cargo-song", instrumentIds: [], mode: "beginner",
    }));
    render(<MenuView />);
    expect(screen.getByLabelText("Beginner coach")).toBeInTheDocument();
    expect(screen.getByTestId("menu-bpm")).toBeInTheDocument();
  });

  it("shows stop-session feedback after gracefully stopping the engine", async () => {
    render(<MenuView />);
    const stop = screen.getByRole("button", { name: /Stop session/ });
    await act(async () => {
      stop.click();
      await Promise.resolve();
    });
    expect(stopEngineSession).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("CyberJam session stopped.");
  });

  it("does not show the mode step for Freestyle and starts without a mode", () => {
    render(<MenuView />);

    act(() => screen.getByRole("radio", { name: "Freestyle" }).click());

    expect(screen.queryByRole("radio", { name: "Beginner" })).not.toBeInTheDocument();
    const ready = screen.getByRole("button", { name: /START/ });
    expect(ready).toBeEnabled();
    expect(useVisualizerStore.getState().selection.mode).toBeNull();
  });

  it("keeps persisted difficulty visible while initial selection hydrates", () => {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify({
      songId: "cargo-song", instrumentIds: [], mode: null,
    }));
    render(<MenuView />);
    expect(screen.getByRole("radiogroup", { name: "Mode" })).toBeInTheDocument();
  });

  it("clears a chosen mode when switching to another song", () => {
    render(<MenuView />);

    act(() => screen.getByRole("radio", { name: /Cargo/ }).click());
    act(() => screen.getByRole("radio", { name: "Experienced" }).click());
    expect(useVisualizerStore.getState().selection.mode).toBe("experienced");

    act(() => screen.getByRole("radio", { name: /Free Jam/ }).click());
    expect(useVisualizerStore.getState().selection.mode).toBeNull();
    expect(screen.getByRole("button", { name: /START/ })).toBeDisabled();
  });
});
