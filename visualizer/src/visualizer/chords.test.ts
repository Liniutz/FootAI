/** Beginner-mode chord data tests: library + per-song progression + bar loop. */
import { describe, expect, it } from "vitest";
import {
  CHORD_LIBRARY,
  chordForBar,
  chordShapeFor,
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
          expect(st.fret).toBeLessThanOrEqual(12);
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

describe("power chords (Cargo stem songs)", () => {
  it("uses the open low-E shape for E5", () => {
    const e5 = getChord("E5");
    expect(e5).toBeDefined();
    expect(e5!.strings[0]).toEqual({ kind: "open" });
    expect(e5!.strings[1]).toEqual({ kind: "fret", fret: 2, finger: 2 });
    expect(e5!.strings[3]).toEqual({ kind: "muted" });
  });

  it("uses the open A-string shape for A5", () => {
    const a5 = getChord("A5");
    expect(a5).toBeDefined();
    expect(a5!.strings[0]).toEqual({ kind: "muted" });
    expect(a5!.strings[1]).toEqual({ kind: "open" });
  });

  it("roots B5 on the A string two frets up", () => {
    const b5 = getChord("B5");
    expect(b5).toBeDefined();
    expect(b5!.strings[1]).toEqual({ kind: "fret", fret: 2, finger: 1 });
    expect(b5!.strings[2]).toEqual({ kind: "fret", fret: 4, finger: 3 });
  });

  it("keeps every power chord within a visible 4-fret window", () => {
    for (const name of Object.keys(CHORD_LIBRARY).filter((n) => n.endsWith("5"))) {
      const shape = CHORD_LIBRARY[name];
      const frets = shape.strings
        .filter((s) => s.kind === "fret")
        .map((s) => (s.kind === "fret" ? s.fret : 0));
      const span = Math.max(...frets) - Math.min(...frets);
      expect(span).toBeLessThanOrEqual(3);
    }
  });

  it("falls back to a muted placeholder for unknown names", () => {
    const shape = chordShapeFor("Q9");
    expect(shape.name).toBe("Q9");
    expect(shape.strings.every((s) => s.kind === "muted")).toBe(true);
  });
});

describe("progressions", () => {
  it("returns a defined progression for known songs", () => {
    expect(progressionForSong("cargo-song").length).toBeGreaterThan(0);
    expect(progressionForSong("free-jam").length).toBeGreaterThan(0);
  });

  it("uses real power chords for the Cargo stem songs", () => {
    expect(progressionForSong("cargo-song")).toEqual(["E5", "E5", "B5", "A5"]);
    expect(getChord(progressionForSong("cargo-andri-popa")[0])).toBeDefined();
    expect(getChord(progressionForSong("cargo-nu-mai-am-tigari")[0])).toBeDefined();
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
