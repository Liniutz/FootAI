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

interface HtmlStemPlayer {
  audio: HTMLAudioElement;
  playbackRate: number;
  readonly loaded: boolean;
  readonly volume: { rampTo(value: number, duration?: number): void };
  sync(): HtmlStemPlayer;
  start(time?: number): HtmlStemPlayer;
  dispose(): void;
}

export interface CargoBandOptions {
  baseUrl?: string;
  socketFactory?: (url: string) => WebSocket;
  playerFactory?: (url: string, stem: CargoStem) => HtmlStemPlayer;
  onVisualUpdate?: (state: CargoVisualState) => void;
}

/** Optional stems playback and the isolated Cargo guitar-engine websocket client. */
export class CargoBandEngine {
  private readonly baseUrl: string;
  private readonly socketFactory: (url: string) => WebSocket;
  private readonly playerFactory: (url: string, stem: CargoStem) => HtmlStemPlayer;
  private readonly onVisualUpdate?: (state: CargoVisualState) => void;
  private players: Partial<Record<CargoStem, HtmlStemPlayer>> = {};
  private songMap: CargoSongMap | null = null;
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserSource: MediaStreamAudioSourceNode | null = null;
  private meterData: Uint8Array | null = null;
  private generation = 0;
  private playbackPositionSeconds = 0;
  private isPlaying = false;

  constructor(options: CargoBandOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
    this.playerFactory = options.playerFactory ?? ((url, stem) => createHtmlStemPlayer(url, stem));
    this.onVisualUpdate = options.onVisualUpdate;
  }

  get loadedSong(): CargoSongMap | null {
    return this.songMap;
  }

  async loadSong(slug: string): Promise<void> {
    const generation = ++this.generation;
    this.stop();
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
    const players: Partial<Record<CargoStem, HtmlStemPlayer>> = {};
    try {
      await Promise.all(checked.map(async ([stem, url]) => {
        const player = this.playerFactory(url, stem);
        players[stem] = player;
        // Apply the mix here so custom player factories behave identically.
        player.volume.rampTo(STEM_GAIN[stem]);
        if (!player.loaded) {
          await waitForAudio(player.audio, stem);
        }
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
    this.playbackPositionSeconds = 0;
    this.isPlaying = false;
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
      // The visitor is the lead guitar: keep the recorded guitar stem muted.

      const now = this.currentPlaybackSeconds();
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

  async resumeAudio(): Promise<void> {
    // Create/resume the metering context inside the click gesture. Playback
    // itself is plain HTMLAudio and does not depend on it.
    if (typeof window === "undefined") return;
    type AudioWindow = typeof window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextClass =
      window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!this.audioContext) {
      try {
        this.audioContext = new AudioContextClass();
      } catch {
        return;
      }
    }
    if (this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
      } catch {
        // Stems still play through the element itself.
      }
    }
  }

  /** Current stem position in seconds (0 when stopped). */
  playbackSeconds(): number {
    return this.currentPlaybackSeconds();
  }

  async play(): Promise<void> {
    const players = Object.values(this.players);
    if (players.length === 0) throw new Error("No Cargo stems loaded.");

    // Lead with the drums: it is always present, so the analyser always sees signal.
    const first = this.players.drums ?? players[0];
    const rest = players.filter((player) => player !== first);
    // Start all at the stored position; await the first one for the user-gesture promise.
    syncCurrentTimes(players, this.playbackPositionSeconds);
    await first.audio.play();
    await Promise.all(rest.map((player) => player.audio.play()));
    this.isPlaying = true;
    this.ensureAnalyser(first.audio);
  }

  async diagnostics(): Promise<{
    context: string;
    transport: string;
    stems: number;
    position: number;
    levels: Partial<Record<CargoStem, number>>;
  }> {
    const drums = this.players.drums?.audio;
    const context = drums?.paused ? "suspended" : "running";
    const levels: Partial<Record<CargoStem, number>> = {};
    (Object.keys(this.players) as CargoStem[]).forEach((stem) => {
      const player = this.players[stem];
      if (player) levels[stem] = Number(player.audio.volume.toFixed(2));
    });
    return {
      context,
      transport: this.isPlaying ? "started" : "stopped",
      stems: Object.keys(this.players).length,
      // Advances only when the element really plays, so it proves audio output.
      position: Number((drums?.currentTime ?? 0).toFixed(2)),
      levels,
    };
  }

  async outputLevel(): Promise<number> {
    if (!this.analyser || !this.meterData) return 0;
    this.analyser.getByteTimeDomainData(this.meterData);
    let sum = 0;
    for (let i = 0; i < this.meterData.length; i += 1) {
      const centered = (this.meterData[i] - 128) / 128;
      sum += centered * centered;
    }
    return Math.sqrt(sum / this.meterData.length);
  }

  stop(): void {
    if (this.isPlaying) {
      this.playbackPositionSeconds = this.currentPlaybackSeconds();
    }
    this.disconnectAnalyser();
    Object.values(this.players).forEach((player) => {
      try {
        player.audio.pause();
        player.audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    });
    this.playbackPositionSeconds = 0;
    this.isPlaying = false;
    this.songMap = null;
    Object.values(this.players).forEach((player) => {
      try { player?.dispose(); } catch { /* ignore teardown errors */ }
    });
    this.players = {};
  }

  dispose(): void {
    this.generation += 1;
    this.stop();
    this.disconnectAnalyser();
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }

  private currentPlaybackSeconds(): number {
    if (!this.isPlaying || !this.players.drums) return this.playbackPositionSeconds;
    return this.players.drums.audio.currentTime || this.playbackPositionSeconds;
  }

  private sendBaseBpm(bpm: number): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ base_bpm: bpm }));
    }
  }

  private ensureAnalyser(audio: HTMLAudioElement): void {
    if (typeof window === "undefined") return;
    const context = this.audioContext;
    // Only meter through a *running* context. A suspended context with a
    // MediaElementSource would silently mute the element it is attached to.
    if (!context || context.state !== "running") return;
    const capture = (
      audio as HTMLAudioElement & { captureStream?: () => MediaStream }
    ).captureStream;
    if (typeof capture !== "function") return;
    try {
      const stream = capture.call(audio);
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      // Tap the stream into the analyser only: the element keeps playing to the
      // device directly, so metering can never mute or double the audio.
      source.connect(analyser);
      this.analyserSource = source;
      this.analyser = analyser;
      this.meterData = new Uint8Array(analyser.frequencyBinCount * 2);
    } catch {
      // Metering is optional; never let it affect playback.
    }
  }

  private disconnectAnalyser(): void {
    try {
      this.analyserSource?.disconnect();
    } catch {
      /* ignore */
    }
    this.analyserSource = null;
    this.analyser = null;
    this.meterData = null;
  }
}

/**
 * Per-stem mix levels. The visitor plays rhythm guitar, so the recorded
 * guitar stem (lead + double) stays in the mix. Every stem is audible.
 */
const STEM_GAIN: Record<CargoStem, number> = {
  drums: 0.9,
  bass: 0.85,
  vocals: 0.85,
  guitar: 0.85,
  piano: 0.85,
  other: 0.85,
};

function createHtmlStemPlayer(url: string, stem: CargoStem): HtmlStemPlayer {
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";
  audio.loop = false;
  audio.volume = Math.max(0, Math.min(1, STEM_GAIN[stem] ?? 0.85));
  return {
    audio,
    get loaded() {
      return audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA;
    },
    get playbackRate() {
      return audio.playbackRate;
    },
    set playbackRate(value: number) {
      audio.playbackRate = value;
      if (audio.preservesPitch !== undefined) audio.preservesPitch = false;
      const moz = audio as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
      if (moz.mozPreservesPitch !== undefined) moz.mozPreservesPitch = false;
      if (moz.webkitPreservesPitch !== undefined) moz.webkitPreservesPitch = false;
    },
    volume: {
      rampTo(value: number) {
        audio.volume = Math.max(0, Math.min(1, value));
      },
    },
    sync() {
      return this;
    },
    start() {
      return this;
    },
    dispose() {
      audio.pause();
      audio.src = "";
      audio.load();
    },
  };
}

function syncCurrentTimes(players: HtmlStemPlayer[], seconds: number): void {
  players.forEach((player) => {
    try {
      player.audio.currentTime = seconds;
    } catch {
      // ignore seeks before metadata settles; waitForAudio covers initial load.
    }
  });
}

function waitForAudio(audio: HTMLAudioElement, stem: CargoStem): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("canplaythrough", onLoad);
      audio.removeEventListener("loadeddata", onLoad);
      audio.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Could not load ${stem}.wav`));
    };
    audio.addEventListener("canplaythrough", onLoad, { once: true });
    audio.addEventListener("loadeddata", onLoad, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.load();
  });
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
