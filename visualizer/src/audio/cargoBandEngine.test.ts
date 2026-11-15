import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CargoBandEngine,
  isCargoEngineFrame,
  validateSongMap,
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

type FakeAudio = {
  readyState: number;
  paused: boolean;
  currentTime: number;
  playbackRate: number;
  volume: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function fakeAudio(): FakeAudio {
  const audio: FakeAudio = {
    readyState: 4,
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    volume: 0.85,
    play: vi.fn(async () => {
      audio.paused = false;
    }),
    pause: vi.fn(() => {
      audio.paused = true;
    }),
    load: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return audio;
}

function fakePlayer() {
  const audio = fakeAudio();
  return {
    audio,
    loaded: true,
    get playbackRate() {
      return audio.playbackRate;
    },
    set playbackRate(value: number) {
      audio.playbackRate = value;
    },
    volume: { rampTo: (value: number) => { audio.volume = value; } },
    sync() { return this; },
    start() { return this; },
    dispose: vi.fn(),
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

describe("CargoBandEngine HTMLAudio playback", () => {
  it("loads six stems and starts them from the beginning on play", async () => {
    stubStemFetch();
    const created: ReturnType<typeof fakePlayer>[] = [];
    const engine = new CargoBandEngine({
      playerFactory: () => {
        const player = fakePlayer();
        created.push(player);
        return player as never;
      },
    });

    await engine.loadSong("ziua_vrajitoarelor");
    await engine.play();

    expect(created).toHaveLength(6);
    expect(created.every((player) => player.audio.play.mock.calls.length === 1)).toBe(true);
    expect(created.every((player) => player.audio.currentTime === 0)).toBe(true);
    const diag = await engine.diagnostics();
    expect(diag.stems).toBe(6);
    // All six stems are audible: the visitor plays rhythm over the full mix.
    expect(diag.levels.drums).toBeGreaterThan(0);
    expect(diag.levels.bass).toBeGreaterThan(0);
    expect(diag.levels.vocals).toBeGreaterThan(0);
    expect(diag.levels.guitar).toBeGreaterThan(0);
  });

  it("fails loudly when a stem file is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: !String(url).endsWith("drums.wav"),
      status: String(url).endsWith("drums.wav") ? 404 : 200,
      json: async () => ({ id: "t", base_bpm: 120, beats: [0, 1, 2, 3], chords: [{ time: 0, chord: "E5", pitch_class: 4 }] }),
    })));
    const engine = new CargoBandEngine({ playerFactory: () => fakePlayer() as never });
    await expect(engine.loadSong("ghost")).rejects.toThrow(/Missing drums\.wav/);
    engine.dispose();
  });

  it("updates playbackRate and guitar volume from the live guitar-engine feed", async () => {
    stubStemFetch();
    const created: ReturnType<typeof fakePlayer>[] = [];
    const socketFactory = vi.fn((() => ({ readyState: 1, send: vi.fn(), close: vi.fn() })) as unknown as () => WebSocket);
    const engine = new CargoBandEngine({
      playerFactory: () => {
        const player = fakePlayer();
        created.push(player);
        return player as never;
      },
      socketFactory,
    });
    await engine.loadSong("ziua_vrajitoarelor");
    engine.connectToGuitarEngine();
    const socket = socketFactory.mock.results[0]?.value as { onmessage?: (event: { data: string }) => void } | undefined;
    if (!socket?.onmessage) throw new Error("socket handler missing");
    socket.onmessage({ data: JSON.stringify({ live_bpm: 180, is_playing: true, energy: 0.6, detected_pitch_class: 4 }) });
    expect(created.every((player) => player.audio.playbackRate > 1)).toBe(true);
  });
});
