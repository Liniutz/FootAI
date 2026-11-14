/**
 * Menu view (Lane B, Task 5 + controller support & Rocksmith-style UI).
 *
 * The operator chooses one song (single-select) and any number of instruments
 * (multi-select), with full keyboard, mouse, and gamepad navigation. Choices
 * are written into the store's `selection` (which `useSelectionSync` mirrors to
 * the Visualizer window) and persisted to localStorage, rehydrating on mount.
 *
 * Controller model (see `useGamepad`): D-pad up/down moves a single focus
 * cursor across all focusable items (songs, then instruments, then Start); A
 * confirms the focused item (select song / toggle instrument / launch); the
 * Start button launches directly.
 */
import { useEffect, useMemo, useState } from "react";
import { INSTRUMENTS, SONGS, isFreestyleSong } from "../data/catalog";
import { useVisualizerStore } from "../store";
import { loadSelection, saveSelection } from "../menu/persistence";
import { routeHref } from "../router";
import { useGamepad } from "../menu/useGamepad";
import type { DifficultyMode } from "../types";
import { startEngineSession, stopEngineSession } from "../sessionControl";

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
  | { kind: "instrument"; id: string }
  | { kind: "start" };

export function MenuView() {
  const selection = useVisualizerStore((s) => s.selection);
  const setSelection = useVisualizerStore((s) => s.setSelection);
  const setSong = useVisualizerStore((s) => s.setSong);
  const setMode = useVisualizerStore((s) => s.setMode);
  const toggleInstrument = useVisualizerStore((s) => s.toggleInstrument);

  const [focusIndex, setFocusIndex] = useState(0);
  const [padConnected, setPadConnected] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [stopMessage, setStopMessage] = useState<string | null>(null);

  // The difficulty-mode step applies only to real songs, not Freestyle.
  const showModeStep =
    selection.songId !== null && !isFreestyleSong(selection.songId);

  // The ordered focus ring: songs, then (if applicable) modes, then
  // instruments, then the Start action. It changes when the mode step toggles.
  const focusItems = useMemo<FocusItem[]>(
    () => [
      ...SONGS.map((s) => ({ kind: "song", id: s.id }) as const),
      ...(showModeStep
        ? MODES.map((m) => ({ kind: "mode", id: m.id }) as const)
        : []),
      ...INSTRUMENTS.map((i) => ({ kind: "instrument", id: i.id }) as const),
      { kind: "start" } as const,
    ],
    [showModeStep],
  );

  // Rehydrate persisted selection on mount (corrupt storage -> defaults).
  useEffect(() => {
    setSelection(loadSelection());
  }, [setSelection]);

  // Persist on every selection change.
  useEffect(() => {
    saveSelection(selection);
  }, [selection]);

  const canStart =
    selection.songId !== null && (!showModeStep || selection.mode !== null);

  const startVisualizer = async () => {
    if (!canStart || starting) return;
    setStarting(true);
    setStartError(null);
    const result = await startEngineSession(isFreestyleSong(selection.songId) ? "freestyle" : "song");
    if (!result.running) {
      setStartError(result.error ?? "Could not start the CyberJam engine.");
      setStarting(false);
      return;
    }
    window.location.hash = routeHref("visualizer");
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
    else if (item.kind === "instrument") toggleInstrument(item.id);
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

  let runningIndex = -1;

  return (
    <section aria-label="Menu" className="view view--menu rocksmith">
      <div className="rs-hero">
        <p className="rs-eyebrow">CyberJam</p>
        <h2 className="rs-title">Choose Your Session</h2>
        <p className="rs-sub">
          Pick a song and the instruments you want in the band.
        </p>
      </div>

      <div className="rs-columns">
        {/* --- Songs --- */}
        <section className="rs-panel" aria-label="Song">
          <h3 className="rs-panel__heading">Song</h3>
          <div role="radiogroup" aria-label="Song" className="rs-cards">
            {SONGS.map((song) => {
              runningIndex += 1;
              const index = runningIndex;
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
                      ? "Jam freely — drums & bass follow your guitar"
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
            <h3 className="rs-panel__heading">Mode</h3>
            <div role="radiogroup" aria-label="Mode" className="rs-cards">
              {MODES.map((mode) => {
                runningIndex += 1;
                const index = runningIndex;
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

        {/* --- Instruments --- */}
        <section className="rs-panel" aria-label="Instruments">
          <h3 className="rs-panel__heading">Band</h3>
          <div className="rs-cards">
            {INSTRUMENTS.map((instrument) => {
              runningIndex += 1;
              const index = runningIndex;
              const selected = selection.instrumentIds.includes(instrument.id);
              const focused = focusIndex === index;
              return (
                <button
                  key={instrument.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={instrument.label}
                  className={
                    "rs-card rs-card--inst" +
                    (selected ? " is-selected" : "") +
                    (focused ? " is-focused" : "")
                  }
                  style={
                    {
                      "--accent": instrument.displayColor,
                    } as React.CSSProperties
                  }
                  onClick={() => {
                    setFocusIndex(index);
                    toggleInstrument(instrument.id);
                  }}
                  onMouseEnter={() => setFocusIndex(index)}
                >
                  <span className="rs-card__dot" aria-hidden="true" />
                  <span className="rs-card__title">{instrument.label}</span>
                  <span className="rs-card__meta">
                    Channel {instrument.midiChannel}
                  </span>
                  <span className="rs-card__check" aria-hidden="true">
                    {selected ? "✓" : "+"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {(() => {
        runningIndex += 1;
        const index = runningIndex;
        const focused = focusIndex === index;
        return (
          <button
            type="button"
            className={
              "rs-start" + (focused ? " is-focused" : "")
            }
            onClick={startVisualizer}
            onMouseEnter={() => setFocusIndex(index)}
            disabled={!canStart || starting}
          >
            {starting
              ? "Starting CyberJam…"
              : canStart
                ? "Start Session ▶"
              : selection.songId === null
                ? "Select a song to start"
                : "Choose a mode to start"}
          </button>
        );
      })()}

      <button
        type="button"
        className="rs-start rs-stop"
        onClick={() => void stopSession()}
        disabled={stopping}
      >
        {stopping ? "Stopping CyberJam…" : "Stop Session ■"}
      </button>

      {(startError || stopMessage) && (
        <p className="rs-hint" role={startError ? "alert" : "status"}>
          {startError ?? stopMessage}
        </p>
      )}

      <p className="rs-hint" aria-live="polite">
        {padConnected
          ? "🎮 Controller connected — D-pad to move, A to select, Start to play."
          : "Use mouse, keyboard, or connect a controller."}
      </p>
    </section>
  );
}
