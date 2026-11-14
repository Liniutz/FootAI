/**
 * Pure helpers that map the Menu `selection` onto the Visualizer (spec Task 9).
 *
 * These functions turn the frozen `SessionSelection` + catalog into:
 *   - the ordered list of active instrument *lanes* (with color + MIDI role),
 *   - a filter deciding which band MIDI events belong to selected lanes, and
 *   - the song reference overlay (title, reference BPM/key vs live values).
 *
 * Everything here is pure and headless-testable; the React components just
 * render the results. "No selection yet" is handled by returning sensible
 * defaults (all lanes shown, no song reference) so the Visualizer is never
 * blank before the operator has chosen anything.
 */
import type {
  BandMidiEvent,
  InstrumentEntry,
  MidiRole,
  SessionSelection,
  SongEntry,
} from "../types";
import { INSTRUMENTS, getSongById } from "../data/catalog";

/**
 * Map a catalog instrument id to the band MIDI role it visualizes.
 * (Drums→drums Ch10, Bass→bass Ch2, Synth/FX→cc Ch1.)
 */
export function instrumentIdToRole(id: string): MidiRole | null {
  switch (id) {
    case "drums":
      return "drums";
    case "bass":
      return "bass";
    case "synth-fx":
      return "cc";
    default:
      return null;
  }
}

/** A resolved, displayable lane derived from a selected instrument. */
export interface ActiveLane {
  instrument: InstrumentEntry;
  role: MidiRole;
}

/**
 * Resolve the instrument lanes to render, in catalog lane order.
 *
 * - With a non-empty selection: only the selected instruments (unknown ids
 *   dropped) that map to a band role.
 * - With an empty selection ("no selection yet"): all catalog instruments, so
 *   the default Visualizer still shows every lane rather than nothing.
 */
export function activeLanes(selection: SessionSelection): ActiveLane[] {
  const selected =
    selection.instrumentIds.length > 0
      ? INSTRUMENTS.filter((i) => selection.instrumentIds.includes(i.id))
      : INSTRUMENTS;

  return selected
    .map((instrument) => {
      const role = instrumentIdToRole(instrument.id);
      return role ? { instrument, role } : null;
    })
    .filter((lane): lane is ActiveLane => lane !== null);
}

/** The set of band roles currently visible given a selection. */
export function activeRoles(selection: SessionSelection): Set<MidiRole> {
  return new Set(activeLanes(selection).map((l) => l.role));
}

/**
 * Keep only band events whose role is in the active set. With an empty
 * selection every lane is active, so nothing is filtered out.
 */
export function filterEventsBySelection(
  events: readonly BandMidiEvent[],
  selection: SessionSelection,
): BandMidiEvent[] {
  const roles = activeRoles(selection);
  return events.filter((e) => roles.has(e.role));
}

/** Resolve the selected song reference, or null when none is chosen. */
export function selectedSong(selection: SessionSelection): SongEntry | null {
  if (!selection.songId) return null;
  return getSongById(selection.songId) ?? null;
}

/** How a live value compares to a reference, for overlay styling. */
export type ReferenceMatch = "match" | "above" | "below";

/**
 * Compare a live BPM against a reference within a tolerance (default ±2 BPM).
 * Returns null when there is no live/valid tempo yet (bpm <= 0).
 */
export function compareBpm(
  liveBpm: number | null | undefined,
  referenceBpm: number,
  toleranceBpm = 2,
): ReferenceMatch | null {
  if (liveBpm == null || liveBpm <= 0) return null;
  if (Math.abs(liveBpm - referenceBpm) <= toleranceBpm) return "match";
  return liveBpm > referenceBpm ? "above" : "below";
}

/**
 * Compare a detected key (pitch class) against a reference key.
 * Returns null when no key is detected yet (empty / "N/A").
 */
export function compareKey(
  detectedKey: string | null | undefined,
  referenceKey: string,
): ReferenceMatch | null {
  if (!detectedKey || detectedKey === "N/A") return null;
  return detectedKey.toUpperCase() === referenceKey.toUpperCase()
    ? "match"
    : "above"; // "above" here just means "differs"; UI treats non-match uniformly
}
