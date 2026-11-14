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

  it("auto-opens both screens at the home route and shows the opened message", () => {
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(FAKE_WINDOW);

    render(<App />);

    expect(
      screen.getByRole("region", { name: "Launcher" }),
    ).toBeInTheDocument();
    // One call per screen (menu + visualizer).
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[0]?.[1]).toBe("cyberjam-menu");
    expect(open.mock.calls[1]?.[1]).toBe("cyberjam-visualizer");
    expect(screen.getByText(/Menu and Visualizer launched/)).toBeInTheDocument();
  });

  it("falls back to a manual button when popups are blocked", async () => {
    // Blocked popups -> window.open returns null.
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    render(<App />);

    const button = screen.getByRole("button", { name: /Start the Show/ });
    expect(button).toBeInTheDocument();
    expect(screen.getByText(/held back the second screen/)).toBeInTheDocument();

    // Clicking retries the open (user gesture).
    open.mockReturnValue(FAKE_WINDOW);
    await act(async () => {
      button.click();
    });
    expect(screen.getByText(/Menu and Visualizer launched/)).toBeInTheDocument();
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

  it("updates the view when the hash changes (same window)", () => {
    vi.spyOn(window, "open").mockReturnValue(FAKE_WINDOW);
    render(<App />);
    expect(
      screen.getByRole("region", { name: "Launcher" }),
    ).toBeInTheDocument();

    setHash("#/visualizer");
    expect(
      screen.getByRole("region", { name: "Visualizer" }),
    ).toBeInTheDocument();
  });

  it("rehydrates the persisted selection on a directly-opened Visualizer window", () => {
    vi.spyOn(window, "open").mockReturnValue(FAKE_WINDOW);
    localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({
        songId: "cargo-song",
        instrumentIds: ["drums"],
        mode: "beginner",
      }),
    );
    useVisualizerStore.setState({ selection: INITIAL_SELECTION });

    setHash("#/visualizer");
    render(<App />);

    const selection = useVisualizerStore.getState().selection;
    expect(selection.songId).toBe("cargo-song");
    expect(selection.mode).toBe("beginner");
    localStorage.clear();
  });
});
