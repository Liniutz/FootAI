import { afterEach, describe, expect, it, vi } from "vitest";
import { isCargoEngineFrame, validateSongMap } from "./cargoBandEngine";

afterEach(() => vi.unstubAllGlobals());

describe("Cargo audio contracts", () => {
  it("validates song maps and rejects malformed metadata", () => {
    const map = { id: "track", base_bpm: 120, beats: [0.5, 1], chords: [{ time: 0, chord: "E5", pitch_class: 4 }] };
    expect(validateSongMap(map)).toEqual(map);
    expect(() => validateSongMap({ ...map, base_bpm: 0 })).toThrow(/song map/);
  });

  it("validates live guitar-engine frames before the band consumes them", () => {
    expect(isCargoEngineFrame({ live_bpm: 128, is_playing: true, energy: 0.4, detected_pitch_class: 4 })).toBe(true);
    expect(isCargoEngineFrame({ live_bpm: "128", is_playing: true, energy: 0.4, detected_pitch_class: 4 })).toBe(false);
    expect(isCargoEngineFrame(null)).toBe(false);
  });
});
