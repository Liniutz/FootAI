/**
 * Menu view (Lane B, Task 5).
 *
 * The operator chooses one song (single-select radio group) and any number of
 * instruments (multi-select toggle buttons). Choices are written into the
 * store's `selection` (which `useSelectionSync` mirrors to the Visualizer
 * window) and persisted to localStorage, rehydrating on mount. A "Start"
 * action navigates this window to the Visualizer route.
 */
import { useEffect } from "react";
import { INSTRUMENTS, SONGS } from "../data/catalog";
import { useVisualizerStore } from "../store";
import { loadSelection, saveSelection } from "../menu/persistence";
import { routeHref } from "../router";

export function MenuView() {
  const selection = useVisualizerStore((s) => s.selection);
  const setSelection = useVisualizerStore((s) => s.setSelection);
  const setSong = useVisualizerStore((s) => s.setSong);
  const toggleInstrument = useVisualizerStore((s) => s.toggleInstrument);

  // Rehydrate persisted selection on mount (corrupt storage -> defaults).
  useEffect(() => {
    setSelection(loadSelection());
  }, [setSelection]);

  // Persist on every selection change.
  useEffect(() => {
    saveSelection(selection);
  }, [selection]);

  const startVisualizer = () => {
    window.location.hash = routeHref("visualizer");
  };

  return (
    <section aria-label="Menu" className="view view--menu">
      <h2>Menu</h2>

      <fieldset className="menu__group">
        <legend>Song</legend>
        <div role="radiogroup" aria-label="Song">
          {SONGS.map((song) => (
            <label key={song.id} className="menu__option">
              <input
                type="radio"
                name="song"
                value={song.id}
                checked={selection.songId === song.id}
                onChange={() => setSong(song.id)}
              />
              <span>
                {song.title} — {song.referenceBpm} BPM, key {song.referenceKey}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="menu__group">
        <legend>Instruments</legend>
        <div className="menu__toggles">
          {INSTRUMENTS.map((instrument) => {
            const selected = selection.instrumentIds.includes(instrument.id);
            return (
              <button
                key={instrument.id}
                type="button"
                className="menu__toggle"
                aria-pressed={selected}
                onClick={() => toggleInstrument(instrument.id)}
                style={{
                  borderColor: instrument.displayColor,
                  background: selected ? instrument.displayColor : "transparent",
                }}
              >
                <span
                  aria-hidden="true"
                  className="menu__swatch"
                  style={{ background: instrument.displayColor }}
                />
                {instrument.label}
                <span className="menu__channel"> (Ch {instrument.midiChannel})</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <button
        type="button"
        className="menu__start"
        onClick={startVisualizer}
        disabled={selection.songId === null}
      >
        Start / Go to Visualizer
      </button>
    </section>
  );
}
