import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CargoBandEngine,
  isCargoEngineFrame,
  validateSongMap,
  type CargoTransport,
} from "./cargoBandEngine";

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

function fakePlayer() {
  return {
    loaded: true,
    playbackRate: 1,
    volume: { rampTo: () => {} },
    sync() { return this; },
    start() { return this; },
    dispose: () => {},
  };
}

function stubStemFetch() {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: "track",
      base_bpm: 120,
      beats: [0, 0.5, 1, 1.5],
      chords: [{ time: 0, chord: "E5", pitch_class: 4 }],
    }),
  })));
}

describe("CargoBandEngine transport lifecycle", () => {
  it("stops (and rewinds) before every load so a second START still plays", async () => {
    const calls: string[] = [];
    const transport: CargoTransport = {
      start: () => calls.push("start"),
      stop: () => calls.push("stop"),
      seconds: 0,
    };
    stubStemFetch();
    const engine = new CargoBandEngine(
      { playerFactory: () => fakePlayer() as never },
      transport,
    );

    await engine.loadSong("ziua_vrajitoarelor");
    await engine.play();
    // Retry / second START: the transport must be stopped+rewound again,
    // otherwise the time-0 synced stems are scheduled in the past.
    await engine.loadSong("ziua_vrajitoarelor");
    await engine.play();

    expect(calls).toEqual(["stop", "start", "stop", "start"]);
    expect(engine.loadedSong?.id).toBe("track");
    engine.dispose();
  });

  it("fails loudly when a stem file is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: !String(url).endsWith("drums.wav"),
      status: String(url).endsWith("drums.wav") ? 404 : 200,
      json: async () => ({ id: "t", base_bpm: 120, beats: [0, 1, 2, 3], chords: [{ time: 0, chord: "E5", pitch_class: 4 }] }),
    })));
    const engine = new CargoBandEngine(
      { playerFactory: () => fakePlayer() as never },
      { start: () => {}, stop: () => {}, seconds: 0 },
    );
    await expect(engine.loadSong("ghost")).rejects.toThrow(/Missing drums\.wav/);
    engine.dispose();
  });
});
