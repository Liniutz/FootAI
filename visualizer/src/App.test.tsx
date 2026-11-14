/** Spec Task 1 tests: hash-routed multi-window shell with auto-split launcher. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import App from "./App";
import { useVisualizerStore, INITIAL_SELECTION } from "./store";
import { SELECTION_STORAGE_KEY } from "./menu/persistence";

function setHash(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

/** A fake non-null window handle representing a successfully opened popup. */
const FAKE_WINDOW = {} as Window;

describe("App shell (routing)", () => {
  beforeEach(() => setHash("#/"));
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the launcher open as Menu and opens the TV Visualizer", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(FAKE_WINDOW);
    render(<App />);

    expect(await screen.findByRole("region", { name: "Menu" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Launcher" })).not.toBeInTheDocument();
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]?.[1]).toBe("cyberjam-visualizer");
  });

  it("can retry opening the TV when the browser blocks the popup", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<App />);

    const button = screen.getByRole("button", { name: /Start the Show/ });
    expect(screen.getByText(/held back the second screen/)).toBeInTheDocument();
    open.mockReturnValue(FAKE_WINDOW);
    await act(async () => button.click());

    expect(await screen.findByRole("region", { name: "Menu" })).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("keeps the global header off the Menu and TV screens", () => {
    setHash("#/menu");
    const { rerender } = render(<App />);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    setHash("#/visualizer");
    rerender(<App />);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("does not render the removed header nav links", () => {
    vi.spyOn(window, "open").mockReturnValue(FAKE_WINDOW);
    render(<App />);
    expect(
      screen.queryByRole("navigation", { name: "Views" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Menu" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Visualizer" }),
    ).not.toBeInTheDocument();
  });

  it("renders the Menu view at #/menu (no auto-open here)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(FAKE_WINDOW);
    setHash("#/menu");
    render(<App />);
    expect(screen.getByRole("region", { name: "Menu" })).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Visualizer" }),
    ).not.toBeInTheDocument();
    // Launcher is not mounted, so no windows are opened from a view route.
    expect(open).not.toHaveBeenCalled();
  });

  it("renders the Visualizer view at #/visualizer (no auto-open here)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(FAKE_WINDOW);
    setHash("#/visualizer");
    render(<App />);
    expect(
      screen.getByRole("region", { name: "Visualizer" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Menu" }),
    ).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("shows the requested screen for a directly-opened window route", () => {
    vi.spyOn(window, "open").mockReturnValue(FAKE_WINDOW);
    setHash("#/menu");
    const { rerender } = render(<App />);
    expect(screen.getByRole("region", { name: "Menu" })).toBeInTheDocument();
    setHash("#/visualizer");
    rerender(<App />);
    expect(screen.getByRole("region", { name: "Visualizer" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Menu" })).not.toBeInTheDocument();
  });

  it("rehydrates the persisted selection on a directly-opened Menu window", () => {
    localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({
        songId: "cargo-song",
        instrumentIds: ["drums"],
        mode: "beginner",
      }),
    );
    useVisualizerStore.setState({ selection: INITIAL_SELECTION });

    setHash("#/menu");
    render(<App />);

    const selection = useVisualizerStore.getState().selection;
    expect(selection.songId).toBe("cargo-song");
    expect(selection.mode).toBe("beginner");
    localStorage.clear();
  });
});
