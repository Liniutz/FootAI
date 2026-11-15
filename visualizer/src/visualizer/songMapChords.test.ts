/** Tests: bar-by-bar chord progression derived from Cargo stem song maps. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStemProgression } from "./songMapChords";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status === 200,
    status,
    json: () => Promise.resolve(body),
  }));
}

describe("fetchStemProgression", () => {
  it("samples the active chord at each bar boundary", async () => {
    // base_bpm 120 -> one bar = 2 s; 24 beats = 6 bars.
    // Chord changes at t=3 (bar 2) and t=6 (bar 3).
    stubFetch({
      id: "track",
      base_bpm: 120,
      beats: Array.from({ length: 24 }, (_, i) => i * 0.5),
      chords: [
        { time: 0, chord: "E5", pitch_class: 4 },
        { time: 3, chord: "A5", pitch_class: 9 },
        { time: 6, chord: "B5", pitch_class: 11 },
      ],
    });
    const { progression, baseBpm } = await fetchStemProgression("ziua_vrajitoarelor");
    // Bar times 0,2,4,6,8,10 — a chord starting exactly on a boundary
    // (B5 at t=6) belongs to the new bar.
    expect(progression).toEqual(["E5", "E5", "A5", "B5", "B5", "B5"]);
    // The coach must use the stem mix's tempo, not the catalog's rounded one.
    expect(baseBpm).toBe(120);
  });

  it("uses the first chord for bars before any segment starts", async () => {
    stubFetch({
      base_bpm: 60, // bar = 4 s
      chords: [{ time: 5, chord: "A5", pitch_class: 9 }],
    });
    const { progression } = await fetchStemProgression("track");
    expect(progression[0]).toBe("A5");
    // Duration fallback: ceil(5 / 4) = 2 bars.
    expect(progression).toHaveLength(2);
  });

  it("encodes slugs with spaces", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ base_bpm: 120, chords: [{ time: 0, chord: "E5", pitch_class: 4 }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchStemProgression("andri popa");
    expect(fetchMock).toHaveBeenCalledWith("/andri%20popa/song_map.json");
  });

  it("rejects when the map is missing or malformed", async () => {
    stubFetch({}, 404);
    await expect(fetchStemProgression("ghost")).rejects.toThrow(/unavailable/);

    stubFetch({ base_bpm: 120, chords: "nope" });
    await expect(fetchStemProgression("bad")).rejects.toThrow(/song map/);

    stubFetch({ chords: [{ time: 0, chord: "E5", pitch_class: 4 }] });
    await expect(fetchStemProgression("no-bpm")).rejects.toThrow(/song map/);
  });
});
