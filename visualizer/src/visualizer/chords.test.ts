/** Beginner-mode chord data tests: library + per-song progression + bar loop. */
import { describe, expect, it } from "vitest";
import {
  CHORD_LIBRARY,
  chordForBar,
  DEFAULT_PROGRESSION,
  getChord,
  progressionForSong,
  STRING_COUNT,
} from "./chords";

describe("chord library", () => {
  it("gives every shape exactly one state per string", () => {
    for (const shape of Object.values(CHORD_LIBRARY)) {
      expect(shape.strings).toHaveLength(STRING_COUNT);
    }
  });

  it("uses valid frets and finger numbers", () => {
    for (const shape of Object.values(CHORD_LIBRARY)) {
      for (const st of shape.strings) {
        if (st.kind === "fret") {
          expect(st.fret).toBeGreaterThanOrEqual(1);
          expect(st.fret).toBeLessThanOrEqual(5);
          if (st.finger !== undefined) {
            expect(st.finger).toBeGreaterThanOrEqual(1);
            expect(st.finger).toBeLessThanOrEqual(4);
          }
        }
      }
    }
  });

  it("looks up by name", () => {
    expect(getChord("Em")?.name).toBe("Em");
    expect(getChord("nope")).toBeUndefined();
  });
});

describe("progressions", () => {
  it("returns a defined progression for known songs", () => {
    expect(progressionForSong("cargo-song").length).toBeGreaterThan(0);
    expect(progressionForSong("free-jam").length).toBeGreaterThan(0);
  });

  it("falls back to the default for unknown / null song", () => {
    expect(progressionForSong(null)).toEqual(DEFAULT_PROGRESSION);
    expect(progressionForSong("ghost")).toEqual(DEFAULT_PROGRESSION);
  });

  it("loops the progression across bars", () => {
    const prog = progressionForSong("cargo-song");
    const first = chordForBar("cargo-song", 0);
    const looped = chordForBar("cargo-song", prog.length);
    expect(looped.name).toBe(first.name);
  });

  it("handles negative bar indices safely", () => {
    const chord = chordForBar("cargo-song", -1);
    expect(chord.strings).toHaveLength(STRING_COUNT);
  });

  it("resolves a real chord shape for each bar", () => {
    const chord = chordForBar("cargo-song", 1);
    expect(chord.name).toBeTruthy();
    expect(chord.strings).toHaveLength(STRING_COUNT);
  });
});
