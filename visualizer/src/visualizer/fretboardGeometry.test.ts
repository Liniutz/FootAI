/** Tests: horizontal 6-string fretboard geometry + pitch→string mapping (pure). */
import { describe, expect, it } from "vitest";
import {
  ageToX,
  buildFretboardGems,
  FRETBOARD_WINDOW_MS,
  isExpired,
  LABEL_MARGIN_FRAC,
  midiToString,
  STRING_COUNT,
  STRING_OPEN_MIDI,
  stringY,
  type Size,
} from "./fretboardGeometry";
import type { BandMidiEvent } from "../types";

const SIZE: Size = { width: 800, height: 240 };

function noteOn(
  time: number,
  role: BandMidiEvent["role"],
  midi = 45,
  vel = 100,
): BandMidiEvent {
  return { time, role, channel: 1, kind: "note_on", data1: midi, data2: vel };
}

describe("midiToString", () => {
  it("maps each open-string pitch to its own string index", () => {
    STRING_OPEN_MIDI.forEach((midi, i) => {
      expect(midiToString(midi)).toBe(i);
    });
  });
  it("snaps to the nearest string for in-between pitches", () => {
    // Low E (40) is index 5; a note just above it stays nearest low E or A.
    expect(midiToString(41)).toBe(5); // closest to E2=40
    expect(midiToString(64)).toBe(0); // high E
    expect(midiToString(100)).toBe(0); // above range → nearest is high E
    expect(midiToString(10)).toBe(5); // below range → nearest is low E
  });
  it("always returns a valid string index", () => {
    for (let m = 0; m < 128; m++) {
      const s = midiToString(m);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(STRING_COUNT);
    }
  });
});

describe("ageToX (right→left scroll)", () => {
  it("places now at the right edge and window-edge at the label margin", () => {
    expect(ageToX(0, SIZE)).toBeCloseTo(SIZE.width);
    expect(ageToX(FRETBOARD_WINDOW_MS, SIZE)).toBeCloseTo(
      SIZE.width * LABEL_MARGIN_FRAC,
    );
  });
  it("older notes sit further left than newer ones", () => {
    expect(ageToX(2000, SIZE)).toBeLessThan(ageToX(500, SIZE));
  });
});

describe("isExpired", () => {
  it("expires notes older than the window", () => {
    expect(isExpired(0, FRETBOARD_WINDOW_MS + 1)).toBe(true);
    expect(isExpired(FRETBOARD_WINDOW_MS, FRETBOARD_WINDOW_MS)).toBe(false);
  });
});

describe("stringY", () => {
  it("orders strings top→bottom and stays within bounds", () => {
    let prev = -1;
    for (let s = 0; s < STRING_COUNT; s++) {
      const y = stringY(s, SIZE);
      expect(y).toBeGreaterThan(prev);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(SIZE.height);
      prev = y;
    }
  });
});

describe("buildFretboardGems", () => {
  it("builds one gem per in-window note_on, on its pitch's string", () => {
    const now = 10000;
    const events = [
      noteOn(now - 100, "drums", 64), // high E → string 0
      noteOn(now - 200, "bass", 40), // low E → string 5
      { time: now - 50, role: "cc", channel: 0, kind: "cc", data1: 74, data2: 90 } as BandMidiEvent,
    ];
    const gems = buildFretboardGems(events, now, SIZE);
    expect(gems).toHaveLength(2); // cc (not note_on) excluded
    expect(gems.find((g) => g.role === "drums")!.stringIndex).toBe(0);
    expect(gems.find((g) => g.role === "bass")!.stringIndex).toBe(5);
  });

  it("drops expired notes and handles zero-size", () => {
    const now = 10000;
    expect(
      buildFretboardGems([noteOn(now - FRETBOARD_WINDOW_MS - 1, "bass")], now, SIZE),
    ).toEqual([]);
    expect(
      buildFretboardGems([noteOn(now, "bass")], now, { width: 0, height: 0 }),
    ).toEqual([]);
  });
});
