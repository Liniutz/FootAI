/**
 * Static instrument & song catalog (spec Task 4, Lane B — Menu).
 *
 * The catalog is the single source of truth for the selectable instruments and
 * songs offered in the Menu view. It carries no network calls — everything is
 * compiled in. Instrument entries map to the documented MIDI roles in
 * docs/contracts-and-apis.md §3 for *display only* (the app never opens MIDI):
 *
 *   - Drums    -> Channel 10
 *   - Bass     -> Channel 2
 *   - Synth/FX -> Channel 1
 *
 * `displayColor` and `lane` are consumed later by the Visualizer (Task 9) to
 * paint each instrument's lane; `referenceBpm`/`referenceKey` on songs drive
 * the Visualizer tempo/key overlays.
 */
import type { InstrumentEntry, SongEntry } from "../types";
import { DEFAULT_BPM, DEFAULT_KEY } from "../config";

// ---------------------------------------------------------------------------
// Instruments — ordered by Visualizer lane (0 = topmost).
// ---------------------------------------------------------------------------

export const INSTRUMENTS: readonly InstrumentEntry[] = [
  {
    id: "drums",
    label: "Drums",
    lane: 0,
    displayColor: "#ff4d6d", // warm red
    midiChannel: 10,
  },
  {
    id: "bass",
    label: "Bass",
    lane: 1,
    displayColor: "#4dabf7", // blue
    midiChannel: 2,
  },
  {
    id: "synth-fx",
    label: "Synth / FX",
    lane: 2,
    displayColor: "#b197fc", // violet
    midiChannel: 1,
  },
] as const;

// ---------------------------------------------------------------------------
// Songs — static list with reference tempo/key for Visualizer overlays.
// ---------------------------------------------------------------------------

export const SONGS: readonly SongEntry[] = [
  {
    id: "cargo-song",
    title: "Cargo",
    referenceBpm: 128,
    referenceKey: "E",
  },
  {
    id: "free-jam",
    title: "Free Jam",
    referenceBpm: DEFAULT_BPM,
    referenceKey: DEFAULT_KEY,
  },
] as const;

// ---------------------------------------------------------------------------
// Selectors / lookup helpers.
// ---------------------------------------------------------------------------

/** Return the instrument with the given id, or `undefined` if unknown. */
export function getInstrumentById(id: string): InstrumentEntry | undefined {
  return INSTRUMENTS.find((entry) => entry.id === id);
}

/** Return the song with the given id, or `undefined` if unknown. */
export function getSongById(id: string): SongEntry | undefined {
  return SONGS.find((entry) => entry.id === id);
}

/**
 * Resolve a list of instrument ids to their catalog entries, preserving
 * catalog lane order and silently dropping any unknown ids.
 */
export function getInstrumentsByIds(
  ids: readonly string[],
): InstrumentEntry[] {
  const wanted = new Set(ids);
  return INSTRUMENTS.filter((entry) => wanted.has(entry.id));
}

/** True when `id` names a known instrument in the catalog. */
export function isValidInstrumentId(id: string): boolean {
  return getInstrumentById(id) !== undefined;
}

/** True when `id` names a known song in the catalog. */
export function isValidSongId(id: string): boolean {
  return getSongById(id) !== undefined;
}
