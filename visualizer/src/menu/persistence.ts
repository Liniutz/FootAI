/**
 * localStorage persistence for the Menu `SessionSelection` (spec Task 5, Lane B).
 *
 * The Menu is "local app state only" — no backend. The user's song/instrument
 * choices are mirrored to localStorage so they survive a window reload, and
 * rehydrated on app load. All reads are defensive: corrupt or malformed JSON
 * falls back to the empty selection rather than throwing.
 *
 * Validation uses the static catalog as the source of truth, so a stored id
 * that no longer exists in the catalog (e.g. after a catalog change) is
 * silently dropped rather than carried forward.
 */
import type { SessionSelection } from "../types";
import { INITIAL_SELECTION } from "../store";
import { isValidInstrumentId, isValidSongId } from "../data/catalog";

/** localStorage key holding the serialized selection. */
export const SELECTION_STORAGE_KEY = "cyberjam.selection";

/** Best-effort access to localStorage (absent in some test/SSR envs). */
function getStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Accessing localStorage can throw (e.g. disabled cookies / privacy mode).
    return null;
  }
}

/**
 * Coerce arbitrary parsed JSON into a valid `SessionSelection`, dropping
 * anything that does not match the catalog or the expected shape.
 */
function sanitize(raw: unknown): SessionSelection {
  if (typeof raw !== "object" || raw === null) return INITIAL_SELECTION;

  const candidate = raw as Partial<Record<keyof SessionSelection, unknown>>;

  const songId =
    typeof candidate.songId === "string" && isValidSongId(candidate.songId)
      ? candidate.songId
      : null;

  const instrumentIds = Array.isArray(candidate.instrumentIds)
    ? candidate.instrumentIds.filter(
        (id): id is string =>
          typeof id === "string" && isValidInstrumentId(id),
      )
    : [];

  // De-duplicate while preserving first-seen order.
  const uniqueInstrumentIds = [...new Set(instrumentIds)];

  return { songId, instrumentIds: uniqueInstrumentIds };
}

/**
 * Read the persisted selection. Returns the empty selection when storage is
 * unavailable, empty, or contains corrupt/invalid data.
 */
export function loadSelection(): SessionSelection {
  const storage = getStorage();
  if (!storage) return INITIAL_SELECTION;

  const serialized = storage.getItem(SELECTION_STORAGE_KEY);
  if (!serialized) return INITIAL_SELECTION;

  try {
    return sanitize(JSON.parse(serialized));
  } catch {
    // Corrupt JSON -> fall back to defaults (and do not crash the app).
    return INITIAL_SELECTION;
  }
}

/** Persist the selection. Silently no-ops when storage is unavailable. */
export function saveSelection(selection: SessionSelection): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Quota / privacy-mode failures are non-fatal for a visual installation.
  }
}
