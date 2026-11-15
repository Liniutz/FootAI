const STEMS = ["drums", "bass", "vocals", "guitar", "piano", "other"] as const;
export type CargoStem = (typeof STEMS)[number];

export interface CargoSongMap {
  id: string;
  base_bpm: number;
  beats: number[];
  chords: Array<{ time: number; chord: string; pitch_class: number }>;
}

export interface CargoVisualState {
  currentChord: string;
  nextChord: string;
  chordMatch: boolean;
  liveBpm: number | null;
  energy: number;
  detectedPitchClass: number;
}

interface GrainPlayerLike {
  sync(): GrainPlayerLike;
  start(time?: number): GrainPlayerLike;
  dispose(): void;
  playbackRate: number;
  volume: { rampTo(value: number, duration: number): void };
  /** Load completion signals; Tone exposes these on the underlying player. */
  loaded?: boolean;
  onload?: () => void;
  onerror?: (error: unknown) => void;
}

export type CargoPlayerFactory = (
  url: string,
  stem: CargoStem,
  onLoad: () => void,
  onError: (error: unknown) => void,
) => GrainPlayerLike | Promise<GrainPlayerLike>;

export interface CargoBandOptions {
  baseUrl?: string;
  socketFactory?: (url: string) => WebSocket;
  playerFactory?: CargoPlayerFactory;
  onVisualUpdate?: (state: CargoVisualState) => void;
}

/** Minimal transport surface, injected so tests and non-Tone players can run headlessly. */
export interface CargoTransport {
  start(): void;
  /** Stop AND rewind: synced sources are scheduled at transport time 0. */
  stop(): void;
  readonly seconds: number;
}

/** Optional stems playback and the isolated Cargo guitar-engine websocket client. */
export class CargoBandEngine {
  private readonly baseUrl: string;
  private readonly socketFactory: (url: string) => WebSocket;
  private readonly playerFactory: CargoPlayerFactory;
  private transport: CargoTransport | null = null;
  private readonly onVisualUpdate?: (state: CargoVisualState) => void;
  private players: Partial<Record<CargoStem, GrainPlayerLike>> = {};
  private songMap: CargoSongMap | null = null;
  private socket: WebSocket | null = null;
  private analyser: { getValue(): Float32Array | Float32Array[] | number; dispose(): void } | null = null;
  private generation = 0;

  constructor(options: CargoBandOptions = {}, transport?: CargoTransport) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
    this.playerFactory = options.playerFactory ?? defaultPlayerFactory;
    this.transport = transport ?? null;
    this.onVisualUpdate = options.onVisualUpdate;
  }

  private async ensureTransport(): Promise<CargoTransport> {
    if (this.transport) return this.transport;
    this.transport = await createToneTransport();
    return this.transport;
  }

  get loadedSong(): CargoSongMap | null {
    return this.songMap;
  }

  async loadSong(slug: string): Promise<void> {
    const generation = ++this.generation;
    await ensureToneStarted();
    Object.values(this.players).forEach((player) => {
      try { player?.dispose(); } catch { /* ignore teardown errors */ }
    });
    this.players = {};
    this.songMap = null;
    (await this.ensureTransport()).stop();
    const safeSlug = slug.split("/").map(encodeURIComponent).join("/");
    const mapResponse = await fetch(`${this.baseUrl}/${safeSlug}/song_map.json`);
    if (!mapResponse.ok) throw new Error(`Song map unavailable (${mapResponse.status})`);
    const songMap = validateSongMap(await mapResponse.json());

    const checked = await Promise.all(STEMS.map(async (stem) => {
      const url = `${this.baseUrl}/${safeSlug}/${stem}.wav`;
      const response = await fetch(url, { method: "HEAD" });
      if (!response.ok) throw new Error(`Missing ${stem}.wav stem for ${slug}`);
      return [stem, url] as const;
    }));

    if (generation !== this.generation) return;
    const players: Partial<Record<CargoStem, GrainPlayerLike>> = {};
    try {
      await Promise.all(checked.map(async ([stem, url]) => {
        let settlePlayer: (() => void) | null = null;
        const player = await this.playerFactory(url, stem, () => settlePlayer?.(), () => {});
        players[stem] = player;
        player.sync().start(0);
        await new Promise<void>((resolve, reject) => {
          if (player.loaded === true) {
            resolve();
            return;
          }
          settlePlayer = resolve;
          player.onerror = (error) => reject(error instanceof Error ? error : new Error(`Could not load ${stem}.wav`));
        });
      }));
    } catch (error) {
      Object.values(players).forEach((player) => player?.dispose());
      throw error;
    }

    if (generation !== this.generation) {
      Object.values(players).forEach((player) => player?.dispose());
      return;
    }
    this.players = players;
    this.songMap = songMap;
    this.sendBaseBpm(songMap.base_bpm);
  }

  connectToGuitarEngine(): void {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return;
    this.socket = this.socketFactory("ws://127.0.0.1:8765");
    this.socket.onmessage = (event) => {
      let data: unknown;
      try { data = JSON.parse(String(event.data)); } catch { return; }
      if (!isCargoEngineFrame(data) || !this.songMap) return;
      const frame = data;
      const rate = Math.max(0.5, Math.min(2, frame.live_bpm / this.songMap.base_bpm));
      STEMS.forEach((stem) => {
        const player = this.players[stem];
        if (player) player.playbackRate = rate;
      });
      this.players.guitar?.volume.rampTo(frame.is_playing ? -14 : -1.5, 0.25);

      const now = this.transport?.seconds ?? 0;
      let index = -1;
      for (let i = 0; i < this.songMap.chords.length; i += 1) {
        if (this.songMap.chords[i].time <= now) index = i;
        else break;
      }
      const current = this.songMap.chords[index] ?? { time: 0, chord: "E5", pitch_class: 4 };
      const next = this.songMap.chords[index + 1] ?? current;
      this.onVisualUpdate?.({
        currentChord: current.chord,
        nextChord: next.chord,
        chordMatch: frame.is_playing && frame.detected_pitch_class === current.pitch_class,
        liveBpm: frame.live_bpm,
        energy: frame.energy,
        detectedPitchClass: frame.detected_pitch_class,
      });
    };
    this.socket.onopen = () => {
      if (this.songMap) this.sendBaseBpm(this.songMap.base_bpm);
    };
    this.socket.onerror = () => {
      // Optional service: no effect on the normal engine/telemetry path.
    };
  }

  /**
   * Resume the Web Audio context. Await this inside the user gesture that
   * triggers playback (a button click) — browsers only allow it while a
   * transient activation is live, which is gone after any slow network call.
   */
  async resumeAudio(): Promise<void> {
    await ensureToneStarted();
  }

  /** Start Transport playback of the loaded stems (resume audio first). */
  async play(): Promise<void> {
    await ensureToneStarted();
    const transport = await this.ensureTransport();
    transport.start();
  }

  /** Operator-facing diagnostics: is the browser actually letting us make sound? */
  async diagnostics(): Promise<{ context: string; transport: string; stems: number }> {
    const Tone = await import("tone");
    const transport = (Tone as { Transport?: { state?: string } }).Transport;
    return {
      context: Tone.getContext().state,
      transport: transport?.state ?? "missing",
      stems: Object.keys(this.players).length,
    };
  }

  /** RMS of the master output (0..1) — proves whether audio is really flowing. */
  async outputLevel(): Promise<number> {
    const Tone = await import("tone");
    if (!this.analyser) {
      const analyser = new Tone.Analyser("waveform", 1024);
      Tone.getDestination().connect(analyser);
      this.analyser = analyser;
    }
    const analyser = this.analyser;
    if (!analyser) return 0;
    const value = analyser.getValue();
    if (!(value instanceof Float32Array)) return 0;
    let sum = 0;
    for (let i = 0; i < value.length; i += 1) sum += value[i] * value[i];
    return Math.sqrt(sum / value.length);
  }

  stop(): void {
    this.ensureTransport()
      .then((transport) => transport.stop())
      .catch(() => {
        // Audio is optional; headless/test environments may not expose one.
      });
    Object.values(this.players).forEach((player) => {
      try { player?.dispose(); } catch { /* ignore teardown errors */ }
    });
    this.players = {};
    this.songMap = null;
  }

  dispose(): void {
    this.generation += 1;
    this.stop();
    if (this.analyser) {
      try { this.analyser.dispose(); } catch { /* ignore teardown errors */ }
      this.analyser = null;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }

  private sendBaseBpm(bpm: number): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ base_bpm: bpm }));
    }
  }
}

/**
 * Resume the Web Audio context. Called on every playback entry point: it is
 * idempotent, and re-calling it inside a fresh user gesture is what actually
 * unblocks a suspended context (the first attempt may have happened outside
 * any gesture, e.g. while a view was mounting).
 */
async function ensureToneStarted(): Promise<void> {
  const Tone = await import("tone");
  await Tone.start();
}

async function defaultPlayerFactory(
  url: string,
  _stem: CargoStem,
  onLoad: () => void,
  onError: (error: unknown) => void,
): Promise<GrainPlayerLike> {
  return createTonePlayer(url, onLoad, onError);
}

async function createToneTransport(): Promise<CargoTransport> {
  const Tone = await import("tone");
  const transport = (Tone as {
    Transport?: { start(): void; stop(): void; seconds: number; ticks: number };
  }).Transport;
  if (!transport || typeof transport.stop !== "function") {
    // Headless/test environments: keep the engine functional without audio.
    return { start: () => {}, stop: () => {}, seconds: 0 };
  }
  return {
    start: () => transport.start(),
    stop: () => {
      transport.stop();
      // Tone's Transport.stop() keeps the playhead where it was. The stems are
      // scheduled with sync().start(0), so without rewinding, a second START
      // (or a START after Stop) would schedule them in the past and stay silent.
      transport.ticks = 0;
    },
    get seconds() { return transport.seconds; },
  };
}

async function createTonePlayer(
  url: string,
  onLoad: () => void,
  onError: (error: unknown) => void,
): Promise<GrainPlayerLike> {
  const Tone = await import("tone");
  return new Tone.GrainPlayer({
    url,
    grainSize: 0.1,
    overlap: 0.05,
    onload: onLoad,
    onerror: onError,
  }).toDestination() as unknown as GrainPlayerLike;
}

export function validateSongMap(raw: unknown): CargoSongMap {
  if (!raw || typeof raw !== "object") throw new Error("Invalid Cargo song map");
  const map = raw as Partial<CargoSongMap>;
  if (
    typeof map.id !== "string" ||
    typeof map.base_bpm !== "number" || !Number.isFinite(map.base_bpm) || map.base_bpm <= 0 ||
    !Array.isArray(map.beats) || !Array.isArray(map.chords) ||
    !map.chords.every((chord) => chord && Number.isFinite(chord.time) && typeof chord.chord === "string" && Number.isInteger(chord.pitch_class))
  ) throw new Error("Invalid Cargo song map schema");
  return map as CargoSongMap;
}

export interface CargoEngineFrame {
  live_bpm: number;
  is_playing: boolean;
  energy: number;
  detected_pitch_class: number;
}

export function isCargoEngineFrame(value: unknown): value is CargoEngineFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<CargoEngineFrame>;
  return typeof frame.live_bpm === "number" && Number.isFinite(frame.live_bpm) &&
    typeof frame.is_playing === "boolean" && typeof frame.energy === "number" &&
    Number.isFinite(frame.energy) && Number.isInteger(frame.detected_pitch_class);
}
