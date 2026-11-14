/**
 * App shell (spec Task 1): hash-routed, multi-window shell.
 *
 * One dev-server instance serves three routes so each view can live in its own
 * browser window on its own screen:
 *   #/            -> Launcher (auto-opens both screens; falls back to a button)
 *   #/menu        -> full-page Menu (screen 1, choose in real time)
 *   #/visualizer  -> full-page Visualizer (screen 2, see everything)
 *
 * `useSelectionSync` keeps the Menu and Visualizer windows in sync live.
 */
import { useEffect, useState } from "react";
import { useRoute } from "./router";
import { useSelectionSync } from "./sync";
import { useTelemetry } from "./telemetry/useTelemetry";
import { openBothScreens, type OpenWindowsResult } from "./windows";
import { MenuView } from "./views/MenuView";
import { VisualizerView } from "./views/VisualizerView";
import { isMockEnabled, startMockFeed } from "./dev/mockFeed";
import { loadSelection } from "./menu/persistence";
import { useVisualizerStore } from "./store";
import "./App.css";

function Launcher() {
  // Open the TV from a user gesture; this window becomes the operator monitor.
  // Browsers may block the popup, in which case the operator can retry.
  const [result, setResult] = useState<OpenWindowsResult | null>(null);

  useEffect(() => {
    if (window.location.hash.replace(/^#\/?/, "").toLowerCase() === "menu") return;
    setResult(openBothScreens());
  }, []);

  const blocked = result === "blocked" || result === "unsupported";

  return (
    <section aria-label="Launcher" className="launcher">
      <h2>🎸 TAKE THE STAGE</h2>

      {result === "opened" ? (
        <p className="launcher__hint">
          The TV Visualizer is open. This window is the Menu and learning monitor.
        </p>
      ) : (
        <>
          <p>
            {blocked
              ? "Your browser held back the second screen. Hit the button to go live:"
              : "Rolling out the two screens…"}
          </p>
          <button
            type="button"
            className="launcher__button"
            onClick={() => setResult(openBothScreens())}
          >
            ▶ Start the Show
          </button>
        </>
      )}

      <p className="launcher__hint">
        Choose the session and follow beginner guidance on this monitor; the TV shows the live Visualizer.
      </p>
    </section>
  );
}

export function App() {
  const route = useRoute();

  // Seed persisted selection on the TV route if it hasn't received one via
  // BroadcastChannel yet (e.g. opened directly or after Menu mounted).
  useEffect(() => {
    if (route !== "visualizer") return;
    if (useVisualizerStore.getState().selection.songId !== null) return;
    const stored = loadSelection();
    if (stored.songId) {
      useVisualizerStore.getState().setSelection(stored);
    }
  }, [route]);

  // Each screen maintains engine telemetry; BroadcastChannel forwards frames
  // and selection so either display stays useful when the peer is offline.
  useTelemetry();
  useSelectionSync();

  // Dev-only: synthesize telemetry + band MIDI so the Visualizer animates
  // without the engine. Gated behind the `?mock` URL flag; inert otherwise.
  useEffect(() => {
    if (!isMockEnabled()) return;
    const feed = startMockFeed();
    return () => feed.stop();
  }, []);

  return (
    <div className="app" data-route={route}>
      {route === "home" && (
        <header className="app__header">
          <h1 className="app__title">CyberJam</h1>
        </header>
      )}

      <main className="app__main">
        {route === "menu" && <MenuView />}
        {route === "visualizer" && <VisualizerView />}
        {route === "home" && <Launcher />}
      </main>
    </div>
  );
}

export default App;
