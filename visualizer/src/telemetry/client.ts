/**
 * Telemetry WebSocket client (spec Task 3, Lane C).
 *
 * Connects to the engine's 20 Hz telemetry broadcast (ws://127.0.0.1:8080),
 * validates each inbound JSON frame, forwards valid frames to a sink, and
 * auto-reconnects with exponential backoff. All socket data is treated as
 * untrusted: malformed frames are dropped, never stored.
 *
 * Testable without a live engine by injecting a `WebSocket`-compatible factory.
 */
import {
  TELEMETRY_RECONNECT_BASE_MS,
  TELEMETRY_RECONNECT_MAX_MS,
  TELEMETRY_WS_URL,
} from "../config";
import type { ConnectionStatus, TelemetryFrame } from "../types";

/** Minimal structural type of the parts of WebSocket we use (eases mocking). */
export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface TelemetryClientOptions {
  url?: string;
  /** Called with every validated frame. */
  onFrame: (frame: TelemetryFrame) => void;
  /** Called on every connection-status transition. */
  onStatus: (status: ConnectionStatus) => void;
  /** Injectable factory (defaults to the global WebSocket). */
  socketFactory?: WebSocketFactory;
  /** Injectable timer scheduler (defaults to setTimeout). */
  scheduleReconnect?: (fn: () => void, delayMs: number) => void;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

/**
 * Validate an unknown value as a `TelemetryFrame`. Returns the typed frame or
 * `null` if the shape does not match the contract (missing/wrong-typed fields,
 * absent `detected_pitch`, etc.).
 */
export function parseTelemetryFrame(raw: unknown): TelemetryFrame | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) return null;

  const f = data as Record<string, unknown>;
  const p = f.detected_pitch as Record<string, unknown> | undefined;

  const isNum = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
  const isStr = (v: unknown): v is string => typeof v === "string";

  if (
    !isNum(f.timestamp) ||
    !isNum(f.bpm) ||
    !isNum(f.rms) ||
    !isNum(f.spectral_centroid_hz) ||
    typeof f.onset !== "boolean" ||
    typeof p !== "object" ||
    p === null ||
    !isNum(p.hz) ||
    !isStr(p.note) ||
    !isNum(p.midi) ||
    !isStr(p.key)
  ) {
    return null;
  }

  return {
    timestamp: f.timestamp,
    bpm: f.bpm,
    detected_pitch: {
      hz: p.hz,
      note: p.note,
      midi: p.midi,
      key: p.key,
    },
    rms: f.rms,
    spectral_centroid_hz: f.spectral_centroid_hz,
    onset: f.onset,
    ...(typeof f.demo_phase === "string" ? { demo_phase: f.demo_phase } : {}),
    ...(typeof f.demo_prompt === "string" ? { demo_prompt: f.demo_prompt } : {}),
  };
}

/**
 * Manages a single telemetry WebSocket connection with auto-reconnect.
 * Call `start()` to connect and `stop()` to tear down (disables reconnect).
 */
export class TelemetryClient {
  private readonly url: string;
  private readonly onFrame: (frame: TelemetryFrame) => void;
  private readonly onStatus: (status: ConnectionStatus) => void;
  private readonly socketFactory: WebSocketFactory;
  private readonly schedule: (fn: () => void, delayMs: number) => void;
  private readonly baseMs: number;
  private readonly maxMs: number;

  private socket: WebSocketLike | null = null;
  private stopped = false;
  private attempt = 0;

  constructor(opts: TelemetryClientOptions) {
    this.url = opts.url ?? TELEMETRY_WS_URL;
    this.onFrame = opts.onFrame;
    this.onStatus = opts.onStatus;
    this.socketFactory =
      opts.socketFactory ??
      ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.schedule =
      opts.scheduleReconnect ??
      ((fn, delay) => {
        setTimeout(fn, delay);
      });
    this.baseMs = opts.reconnectBaseMs ?? TELEMETRY_RECONNECT_BASE_MS;
    this.maxMs = opts.reconnectMaxMs ?? TELEMETRY_RECONNECT_MAX_MS;
  }

  /** Exponential backoff delay for the current attempt, capped at maxMs. */
  private backoffMs(): number {
    const delay = this.baseMs * 2 ** this.attempt;
    return Math.min(delay, this.maxMs);
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      this.socket.close();
      this.socket = null;
    }
  }

  private connect(): void {
    this.onStatus("connecting");
    const socket = this.socketFactory(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.onStatus("open");
    };

    socket.onmessage = (ev) => {
      const frame = parseTelemetryFrame(ev.data);
      if (frame) this.onFrame(frame);
    };

    socket.onerror = () => {
      this.onStatus("error");
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.stopped) {
        this.onStatus("closed");
        return;
      }
      this.onStatus("closed");
      const delay = this.backoffMs();
      this.attempt += 1;
      this.schedule(() => {
        if (!this.stopped) this.connect();
      }, delay);
    };
  }
}
