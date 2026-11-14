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
import { openBothScreens, type OpenWindowsResult } from "./windows";
import { MenuView } from "./views/MenuView";
import { VisualizerView } from "./views/VisualizerView";
import { isMockEnabled, startMockFeed } from "./dev/mockFeed";
import "./App.css";

function Launcher() {
  // Attempt an automatic split into two windows on first mount; browsers
  // usually block unprompted popups, so fall back to a manual button (1=b).
  const [result, setResult] = useState<OpenWindowsResult | null>(null);

  useEffect(() => {
    setResult(openBothScreens());
  }, []);

  const blocked = result === "blocked" || result === "unsupported";

  return (
    <section aria-label="Launcher" className="launcher">
      <h2>🎸 TAKE THE STAGE</h2>

      {result === "opened" ? (
        <p className="launcher__hint">
          Menu and Visualizer launched in separate windows — drag each to its
          screen. You can close this tab.
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
        Pick your song on the Menu screen — it lights up the Visualizer live.
      </p>
    </section>
  );
}

export function App() {
  const route = useRoute();

  // Keep this window's selection synced with the other window.
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
      <header className="app__header">
        <h1 className="app__title">CyberJam</h1>
      </header>

      <main className="app__main">
        {route === "menu" && <MenuView />}
        {route === "visualizer" && <VisualizerView />}
        {route === "home" && <Launcher />}
      </main>
    </div>
  );
}

export default App;
