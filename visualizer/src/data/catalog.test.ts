/** Spec Task 4 tests: catalog integrity + selector helpers. */
import { describe, expect, it } from "vitest";
import {
  INSTRUMENTS,
  SONGS,
  getInstrumentById,
  getInstrumentsByIds,
  getSongById,
  isValidInstrumentId,
  isValidSongId,
} from "./catalog";
import type { MidiChannel } from "../types";

const VALID_CHANNELS: MidiChannel[] = [1, 2, 10];

describe("instrument catalog integrity", () => {
  it("has at least one instrument", () => {
    expect(INSTRUMENTS.length).toBeGreaterThan(0);
  });

  it("has unique instrument ids", () => {
    const ids = INSTRUMENTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps every instrument to a documented MIDI channel", () => {
    for (const instrument of INSTRUMENTS) {
      expect(VALID_CHANNELS).toContain(instrument.midiChannel);
    }
  });

  it("gives every instrument a non-empty display color", () => {
    for (const instrument of INSTRUMENTS) {
      expect(instrument.displayColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("gives every instrument a non-empty label", () => {
    for (const instrument of INSTRUMENTS) {
      expect(instrument.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("assigns unique, non-negative lane indices", () => {
    const lanes = INSTRUMENTS.map((i) => i.lane);
    expect(new Set(lanes).size).toBe(lanes.length);
    for (const lane of lanes) {
      expect(lane).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(lane)).toBe(true);
    }
  });

  it("maps the documented roles to their channels", () => {
    expect(getInstrumentById("drums")?.midiChannel).toBe(10);
    expect(getInstrumentById("bass")?.midiChannel).toBe(2);
    expect(getInstrumentById("synth-fx")?.midiChannel).toBe(1);
  });
});

describe("song catalog integrity", () => {
  it("has at least one song including Cargo", () => {
    expect(SONGS.length).toBeGreaterThan(0);
    expect(getSongById("cargo-song")?.title).toBe("Cargo");
  });

  it("has unique song ids", () => {
    const ids = SONGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every song a plausible reference bpm and non-empty key", () => {
    for (const song of SONGS) {
      expect(song.referenceBpm).toBeGreaterThanOrEqual(40);
      expect(song.referenceBpm).toBeLessThanOrEqual(240);
      expect(song.referenceKey.trim().length).toBeGreaterThan(0);
      expect(song.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("selector helpers", () => {
  it("getInstrumentById resolves known ids and rejects unknown", () => {
    expect(getInstrumentById("drums")?.label).toBe("Drums");
    expect(getInstrumentById("nope")).toBeUndefined();
  });

  it("getSongById resolves known ids and rejects unknown", () => {
    expect(getSongById("cargo-song")?.title).toBe("Cargo");
    expect(getSongById("nope")).toBeUndefined();
  });

  it("getInstrumentsByIds preserves catalog lane order and drops unknowns", () => {
    const resolved = getInstrumentsByIds(["synth-fx", "unknown", "drums"]);
    expect(resolved.map((i) => i.id)).toEqual(["drums", "synth-fx"]);
  });

  it("getInstrumentsByIds returns empty for empty / all-unknown input", () => {
    expect(getInstrumentsByIds([])).toEqual([]);
    expect(getInstrumentsByIds(["x", "y"])).toEqual([]);
  });

  it("isValidInstrumentId / isValidSongId guard membership", () => {
    expect(isValidInstrumentId("bass")).toBe(true);
    expect(isValidInstrumentId("bass-2")).toBe(false);
    expect(isValidSongId("cargo-song")).toBe(true);
    expect(isValidSongId("cargo")).toBe(false);
  });
});
