/** Spec Task 9 tests: selection -> Visualizer mapping (pure helpers). */
import { describe, expect, it } from "vitest";
import {
  activeLanes,
  activeRoles,
  compareBpm,
  compareKey,
  filterEventsBySelection,
  instrumentIdToRole,
  selectedSong,
} from "./selectionView";
import type { BandMidiEvent, SessionSelection } from "../types";

const EMPTY: SessionSelection = { songId: null, instrumentIds: [], mode: null };

function ev(role: BandMidiEvent["role"]): BandMidiEvent {
  return { time: 0, role, channel: 0, kind: "note_on", data1: 60, data2: 100 };
}

describe("instrumentIdToRole", () => {
  it("maps catalog ids to band roles", () => {
    expect(instrumentIdToRole("drums")).toBe("drums");
    expect(instrumentIdToRole("bass")).toBe("bass");
    expect(instrumentIdToRole("synth-fx")).toBe("cc");
    expect(instrumentIdToRole("nope")).toBeNull();
  });
});

describe("activeLanes", () => {
  it("returns only the selected instruments in catalog order", () => {
    const sel: SessionSelection = {
      songId: null,
      instrumentIds: ["synth-fx", "drums"],
      mode: null,
    };
    expect(activeLanes(sel).map((l) => l.instrument.id)).toEqual([
      "drums",
      "synth-fx",
    ]);
  });

  it("falls back to all lanes when nothing is selected", () => {
    expect(activeLanes(EMPTY).map((l) => l.instrument.id)).toEqual([
      "drums",
      "bass",
      "synth-fx",
    ]);
  });

  it("drops unknown instrument ids", () => {
    const sel: SessionSelection = {
      songId: null,
      instrumentIds: ["drums", "ghost"],
      mode: null,
    };
    expect(activeLanes(sel).map((l) => l.instrument.id)).toEqual(["drums"]);
  });

  it("tags each lane with its MIDI role", () => {
    const sel: SessionSelection = { songId: null, instrumentIds: ["bass"], mode: null };
    expect(activeLanes(sel)[0]?.role).toBe("bass");
  });
});

describe("activeRoles / filterEventsBySelection", () => {
  it("keeps only events whose role is selected", () => {
    const sel: SessionSelection = {
      songId: null,
      instrumentIds: ["drums", "bass"],
      mode: null,
    };
    expect(activeRoles(sel)).toEqual(new Set(["drums", "bass"]));

    const events = [ev("drums"), ev("bass"), ev("cc")];
    expect(filterEventsBySelection(events, sel).map((e) => e.role)).toEqual([
      "drums",
      "bass",
    ]);
  });

  it("keeps all events when nothing is selected", () => {
    const events = [ev("drums"), ev("bass"), ev("cc")];
    expect(filterEventsBySelection(events, EMPTY)).toHaveLength(3);
  });
});

describe("selectedSong", () => {
  it("resolves a selected song", () => {
    expect(
      selectedSong({ songId: "cargo-song", instrumentIds: [], mode: null })?.title,
    ).toBe("Cargo");
  });

  it("returns null when no / unknown song", () => {
    expect(selectedSong(EMPTY)).toBeNull();
    expect(selectedSong({ songId: "ghost", instrumentIds: [], mode: null })).toBeNull();
  });
});

describe("compareBpm", () => {
  it("returns match within tolerance", () => {
    expect(compareBpm(128, 128)).toBe("match");
    expect(compareBpm(129, 128)).toBe("match");
  });

  it("returns above / below outside tolerance", () => {
    expect(compareBpm(140, 128)).toBe("above");
    expect(compareBpm(110, 128)).toBe("below");
  });

  it("returns null when there is no live tempo", () => {
    expect(compareBpm(0, 128)).toBeNull();
    expect(compareBpm(null, 128)).toBeNull();
    expect(compareBpm(undefined, 128)).toBeNull();
  });
});

describe("compareKey", () => {
  it("matches case-insensitively", () => {
    expect(compareKey("e", "E")).toBe("match");
    expect(compareKey("E", "E")).toBe("match");
  });

  it("flags a different key", () => {
    expect(compareKey("A", "E")).toBe("above");
  });

  it("returns null when no key detected", () => {
    expect(compareKey("", "E")).toBeNull();
    expect(compareKey("N/A", "E")).toBeNull();
    expect(compareKey(null, "E")).toBeNull();
  });
});
