/** Spec Task 5 tests: Menu view selection, persistence, rehydrate, navigation. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { MenuView } from "./MenuView";
import { useVisualizerStore } from "../store";
import { INITIAL_SELECTION } from "../store";
import { SELECTION_STORAGE_KEY } from "../menu/persistence";

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

  it("toggling instruments multi-selects and reflects aria-pressed", () => {
    render(<MenuView />);

    const drums = screen.getByRole("button", { name: /Drums/ });
    const bass = screen.getByRole("button", { name: /Bass/ });

    expect(drums).toHaveAttribute("aria-pressed", "false");

    act(() => drums.click());
    act(() => bass.click());

    expect(drums).toHaveAttribute("aria-pressed", "true");
    expect(bass).toHaveAttribute("aria-pressed", "true");
    expect(useVisualizerStore.getState().selection.instrumentIds).toEqual([
      "drums",
      "bass",
    ]);

    // Toggling off removes it.
    act(() => drums.click());
    expect(drums).toHaveAttribute("aria-pressed", "false");
    expect(useVisualizerStore.getState().selection.instrumentIds).toEqual([
      "bass",
    ]);
  });

  it("rehydrates a persisted selection on mount", () => {
    localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({ songId: "cargo-song", instrumentIds: ["bass"] }),
    );

    render(<MenuView />);

    expect(screen.getByRole("radio", { name: /Cargo/ })).toBeChecked();
    expect(screen.getByRole("button", { name: /Bass/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(useVisualizerStore.getState().selection).toEqual({
      songId: "cargo-song",
      instrumentIds: ["bass"],
    });
  });

  it("falls back to defaults when stored selection is corrupt", () => {
    localStorage.setItem(SELECTION_STORAGE_KEY, "{broken json");

    render(<MenuView />);

    expect(useVisualizerStore.getState().selection).toEqual(INITIAL_SELECTION);
    expect(screen.getByRole("radio", { name: /Cargo/ })).not.toBeChecked();
  });

  it("disables Start until a song is chosen, then navigates to the Visualizer", () => {
    render(<MenuView />);

    const start = screen.getByRole("button", {
      name: /Start \/ Go to Visualizer/,
    });
    expect(start).toBeDisabled();

    act(() => screen.getByRole("radio", { name: /Cargo/ }).click());
    expect(start).toBeEnabled();

    act(() => start.click());
    expect(window.location.hash).toBe("#/visualizer");
  });
});
