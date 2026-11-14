/**
 * Menu view (Lane B, Task 5 + controller support & Rocksmith-style UI).
 *
 * The operator chooses a song and difficulty, monitors live tempo/key, and can
 * start/stop a session from this screen. Choices
 * are written into the store's `selection` (which `useSelectionSync` mirrors to
 * the Visualizer window) and persisted to localStorage, rehydrating on mount.
 *
 * Controller model (see `useGamepad`): D-pad navigates songs, difficulty, and
 * launch; A confirms the focused item and Start launches directly.
 */
import { useEffect, useMemo, useState } from "react";
import { SONGS, isFreestyleSong } from "../data/catalog";
import { BeginnerCoach } from "../visualizer/BeginnerCoach";
import { useVisualizerStore } from "../store";
import { loadSelection, saveSelection } from "../menu/persistence";
import { useGamepad } from "../menu/useGamepad";
import type { DifficultyMode } from "../types";
import { startEngineSession, stopEngineSession } from "../sessionControl";
import { routeUrl } from "../windows";

/** The selectable difficulty modes (shown once a real song is picked). */
const MODES: ReadonlyArray<{
  id: DifficultyMode;
  label: string;
  description: string;
}> = [
  {
    id: "beginner",
    label: "Beginner",
    description: "Chord diagram with a timing circle to guide each change.",
  },
  {
    id: "experienced",
    label: "Experienced",
    description: "Minimal assists — just play along.",
  },
];

/** Flat list of focusable items for unified D-pad navigation. */
type FocusItem =
  | { kind: "song"; id: string }
  | { kind: "mode"; id: DifficultyMode }
  | { kind: "start" };

export function MenuView() {
  const selection = useVisualizerStore((s) => s.selection);
  const setSelection = useVisualizerStore((s) => s.setSelection);
  const [rehydrated, setRehydrated] = useState(false);
  const [storedSelection] = useState(loadSelection);
  const setSong = useVisualizerStore((s) => s.setSong);
  const setMode = useVisualizerStore((s) => s.setMode);
  const frame = useVisualizerStore((s) => s.latestFrame);
  const liveKey = frame?.detected_pitch.key;
  const key = liveKey && liveKey !== "N/A" ? liveKey : "—";
  const bpm = Math.round(frame?.bpm || 0) || "—";

  const [focusIndex, setFocusIndex] = useState(0);
  const [padConnected, setPadConnected] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [stopMessage, setStopMessage] = useState<string | null>(null);

  // Show difficulty choices for regular songs; never briefly unmount them while
  // the persisted selection is being restored from localStorage.
  const effectiveSongId = selection.songId ?? (!rehydrated ? storedSelection.songId : null);
  const showModeStep =
    effectiveSongId !== null && !isFreestyleSong(effectiveSongId);

  // The focus ring contains the song choices, optional difficulty, and launch.
  const focusItems = useMemo<FocusItem[]>(
    () => [
      ...SONGS.map((s) => ({ kind: "song", id: s.id }) as const),
      ...(showModeStep
        ? MODES.map((m) => ({ kind: "mode", id: m.id }) as const)
        : []),
      { kind: "start" } as const,
    ],
    [showModeStep],
  );

  // Rehydrate once before enabling controls. The other screen may already have
  // sent the user's current choice; only use storage when the store is empty.
  useEffect(() => {
    const currentSelection = useVisualizerStore.getState().selection;
    if (!currentSelection.songId && storedSelection.songId) {
      setSelection(storedSelection);
    }
    setRehydrated(true);
  }, [setSelection, storedSelection]);

  // Persist on every selection change after storage has been loaded.
  useEffect(() => {
    if (rehydrated) saveSelection(selection);
  }, [selection, rehydrated]);

  const canStart =
    selection.songId !== null && (!showModeStep || selection.mode !== null);

  const startVisualizer = async () => {
    if (!canStart || starting) return;
    setStarting(true);
    setStartError(null);
    setStopMessage(null);
    const result = await startEngineSession(isFreestyleSong(selection.songId) ? "freestyle" : "song");
    setStarting(false);
    if (!result.running) {
      setStartError(result.error ?? "Could not start the CyberJam engine.");
      return;
    }
    setStopMessage("Session live on TV.");
  };

  const openTvScreen = () => {
    window.open?.(routeUrl("visualizer"), "cyberjam-visualizer");
  };

  const stopSession = async () => {
    if (stopping) return;
    setStopping(true);
    setStopMessage(null);
    const result = await stopEngineSession();
    setStopping(false);
    setStopMessage(
      result.error ?? (result.running ? "Session could not be stopped." : "CyberJam session stopped."),
    );
  };

  // Activate whatever item currently has focus (controller "A" / Enter).
  const confirmFocused = () => {
    const item = focusItems[focusIndex];
    if (!item) return;
    if (item.kind === "song") setSong(item.id);
    else if (item.kind === "mode") setMode(item.id);
    else startVisualizer();
  };

  const moveFocus = (delta: number) => {
    setFocusIndex((i) => {
      const n = focusItems.length;
      return (i + delta + n) % n;
    });
  };

  useGamepad({
    onUp: () => moveFocus(-1),
    onDown: () => moveFocus(1),
    // Left/right also move focus so either stick axis is usable.
    onLeft: () => moveFocus(-1),
    onRight: () => moveFocus(1),
    onConfirm: confirmFocused,
    onStart: startVisualizer,
    onConnectionChange: setPadConnected,
  });


  return (
    <section aria-label="Menu" className="view view--menu rocksmith">
      <div className="menu-toolbar">
        <div>
          <h2 className="rs-title">CyberJam</h2>
          <p className="rs-sub">Select a song · then play</p>
        </div>
        <button
          type="button"
          className="menu-start"
          onClick={startVisualizer}
          disabled={!canStart || starting}
        >
          {starting ? "STARTING…" : "START ▶"}
        </button>
      </div>

      <div className="menu-live-stats" aria-label="Live tempo and key">
        <span><strong data-testid="menu-bpm">{bpm}</strong><small>BPM</small></span>
        <span><strong data-testid="menu-key">{key}</strong><small>KEY</small></span>
      </div>

      {selection.mode === "beginner" && <BeginnerCoach />}

      <div className="rs-columns">
        {/* --- Songs --- */}
        <section className="rs-panel" aria-label="Song">
          <h3 className="rs-panel__heading">Song</h3>
          <div role="radiogroup" aria-label="Song" className="rs-cards">
            {SONGS.map((song) => {
              const index = focusItems.findIndex((item) => item.kind === "song" && item.id === song.id);
              const selected = selection.songId === song.id;
              const focused = focusIndex === index;
              return (
                <button
                  key={song.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={song.title}
                  className={
                    "rs-card rs-card--song" +
                    (selected ? " is-selected" : "") +
                    (focused ? " is-focused" : "")
                  }
                  onClick={() => {
                    setFocusIndex(index);
                    setSong(song.id);
                  }}
                  onMouseEnter={() => setFocusIndex(index)}
                >
                  <span className="rs-card__title">{song.title}</span>
                  <span className="rs-card__meta">
                    {song.freestyle
                      ? "Jam freely · live tempo and key"
                      : `${song.referenceBpm} BPM · Key ${song.referenceKey}`}
                  </span>
                  {selected && <span className="rs-card__badge">Selected</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* --- Difficulty mode (only for real songs, not Freestyle) --- */}
        {showModeStep && (
          <section className="rs-panel" aria-label="Mode">
            <h3 className="rs-panel__heading">Difficulty</h3>
            <div role="radiogroup" aria-label="Mode" className="rs-cards">
              {MODES.map((mode) => {
                const index = focusItems.findIndex((item) => item.kind === "mode" && item.id === mode.id);
                const selected = selection.mode === mode.id;
                const focused = focusIndex === index;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={mode.label}
                    className={
                      "rs-card rs-card--mode" +
                      (selected ? " is-selected" : "") +
                      (focused ? " is-focused" : "")
                    }
                    onClick={() => {
                      setFocusIndex(index);
                      setMode(mode.id);
                    }}
                    onMouseEnter={() => setFocusIndex(index)}
                  >
                    <span className="rs-card__title">{mode.label}</span>
                    <span className="rs-card__meta">{mode.description}</span>
                    {selected && <span className="rs-card__badge">Selected</span>}
                  </button>
                );
              })}
            </div>
          </section>
        )}

      </div>

      <div className="menu-actions-secondary">
        <button
          type="button"
          className="menu-stop"
          onClick={() => void stopSession()}
          disabled={stopping}
        >
          {stopping ? "Stopping…" : "Stop session"}
        </button>
        <button
          type="button"
          className="menu-open-tv"
          onClick={openTvScreen}
        >
          Open TV
        </button>
      </div>

      {startError && <p className="rs-hint" role="alert">{startError}</p>}
      {stopMessage && <p className="rs-hint" role="status">{stopMessage}</p>}
      <p className="rs-hint" aria-live="polite">
        {padConnected ? "Controller connected" : "Use mouse, keyboard, or connect a controller."}
      </p>
    </section>
  );
}
