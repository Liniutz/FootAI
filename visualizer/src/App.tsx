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
import { DebugPanel } from "./components/DebugPanel";
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
      <h2>CyberJam — Screens</h2>

      {result === "opened" ? (
        <p className="launcher__hint">
          Opened the Menu and Visualizer in separate windows — drag each to its
          screen. You can close this tab.
        </p>
      ) : (
        <>
          <p>
            {blocked
              ? "Your browser blocked the automatic split. Click below to open both screens:"
              : "Opening the Menu and Visualizer screens…"}
          </p>
          <button
            type="button"
            className="launcher__button"
            onClick={() => setResult(openBothScreens())}
          >
            Open both screens
          </button>
        </>
      )}

      <p className="launcher__hint">
        Selections made in the Menu window appear live in the Visualizer window.
      </p>
    </section>
  );
}

export function App() {
  const route = useRoute();

  // Keep this window's selection synced with the other window.
  useSelectionSync();

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

      <DebugPanel />
    </div>
  );
}

export default App;
