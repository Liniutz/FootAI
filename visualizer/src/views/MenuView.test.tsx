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
      mode: null,
    });
  });

  it("falls back to defaults when stored selection is corrupt", () => {
    localStorage.setItem(SELECTION_STORAGE_KEY, "{broken json");

    render(<MenuView />);

    expect(useVisualizerStore.getState().selection).toEqual(INITIAL_SELECTION);
    expect(screen.getByRole("radio", { name: /Cargo/ })).not.toBeChecked();
  });

  it("requires a song then a mode before Start enables, then navigates", () => {
    render(<MenuView />);

    expect(
      screen.getByRole("button", { name: /Select a song to start/ }),
    ).toBeDisabled();

    // Picking a real song reveals the Mode step but Start stays disabled.
    act(() => screen.getByRole("radio", { name: /Cargo/ }).click());
    expect(
      screen.getByRole("button", { name: /Choose a mode to start/ }),
    ).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Beginner" })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Experienced" }),
    ).toBeInTheDocument();

    // Choosing a mode enables Start.
    act(() => screen.getByRole("radio", { name: "Beginner" }).click());
    const ready = screen.getByRole("button", { name: /Start Session/ });
    expect(ready).toBeEnabled();

    act(() => ready.click());
    expect(window.location.hash).toBe("#/visualizer");
    expect(useVisualizerStore.getState().selection.mode).toBe("beginner");
  });

  it("does not show the mode step for Freestyle and starts without a mode", () => {
    render(<MenuView />);

    act(() => screen.getByRole("radio", { name: "Freestyle" }).click());

    expect(screen.queryByRole("radio", { name: "Beginner" })).not.toBeInTheDocument();
    const ready = screen.getByRole("button", { name: /Start Session/ });
    expect(ready).toBeEnabled();
    expect(useVisualizerStore.getState().selection.mode).toBeNull();
  });

  it("clears a chosen mode when switching to another song", () => {
    render(<MenuView />);

    act(() => screen.getByRole("radio", { name: /Cargo/ }).click());
    act(() => screen.getByRole("radio", { name: "Experienced" }).click());
    expect(useVisualizerStore.getState().selection.mode).toBe("experienced");

    act(() => screen.getByRole("radio", { name: /Free Jam/ }).click());
    expect(useVisualizerStore.getState().selection.mode).toBeNull();
    expect(
      screen.getByRole("button", { name: /Choose a mode to start/ }),
    ).toBeDisabled();
  });
});
