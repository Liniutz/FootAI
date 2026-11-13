/** Spec Task 5 tests: selection persistence + corrupt-storage fallback. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SELECTION_STORAGE_KEY,
  loadSelection,
  saveSelection,
} from "./persistence";
import { INITIAL_SELECTION } from "../store";

describe("selection persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns the empty selection when nothing is stored", () => {
    expect(loadSelection()).toEqual(INITIAL_SELECTION);
  });

  it("round-trips a valid selection", () => {
    const selection = { songId: "cargo-song", instrumentIds: ["drums", "bass"] };
    saveSelection(selection);
    expect(loadSelection()).toEqual(selection);
  });

  it("falls back to defaults on corrupt JSON", () => {
    localStorage.setItem(SELECTION_STORAGE_KEY, "{not valid json");
    expect(loadSelection()).toEqual(INITIAL_SELECTION);
  });

  it("drops a song id that is not in the catalog", () => {
    saveSelection({ songId: "ghost-song", instrumentIds: [] });
    expect(loadSelection().songId).toBeNull();
  });

  it("filters out unknown instrument ids and de-duplicates", () => {
    localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({
        songId: "cargo-song",
        instrumentIds: ["drums", "drums", "nope", "bass"],
      }),
    );
    expect(loadSelection()).toEqual({
      songId: "cargo-song",
      instrumentIds: ["drums", "bass"],
    });
  });

  it("falls back to defaults when the stored value is not an object", () => {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(42));
    expect(loadSelection()).toEqual(INITIAL_SELECTION);
  });

  it("tolerates missing / wrong-typed fields", () => {
    localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({ songId: 123, instrumentIds: "drums" }),
    );
    expect(loadSelection()).toEqual(INITIAL_SELECTION);
  });
});
