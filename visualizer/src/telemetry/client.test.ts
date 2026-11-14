/** Spec Task 3 tests: telemetry parsing + client reconnect. */
import { describe, expect, it, vi } from "vitest";
import {
  parseTelemetryFrame,
  TelemetryClient,
  type WebSocketLike,
} from "./client";
import type { ConnectionStatus, TelemetryFrame } from "../types";

const VALID = {
  timestamp: 1763042450.123456,
  bpm: 122.45,
  detected_pitch: { hz: 110.0, note: "A2", midi: 45, key: "A" },
  rms: 0.08412,
  spectral_centroid_hz: 1420.55,
  onset: true,
};

describe("parseTelemetryFrame", () => {
  it("accepts a valid frame (object or JSON string)", () => {
    expect(parseTelemetryFrame(VALID)).toEqual(VALID);
    expect(parseTelemetryFrame(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("preserves optional guided-capture fields from the engine", () => {
    const guided = {
      ...VALID,
      demo_phase: "locked",
      demo_prompt: "Locked: 120 BPM.",
    };
    expect(parseTelemetryFrame(guided)).toEqual(guided);
  });

  it("rejects malformed JSON", () => {
    expect(parseTelemetryFrame("{not json")).toBeNull();
  });

  it("rejects frames missing detected_pitch", () => {
    const { detected_pitch: _omit, ...rest } = VALID;
    void _omit;
    expect(parseTelemetryFrame(rest)).toBeNull();
  });

  it("rejects wrong field types", () => {
    expect(parseTelemetryFrame({ ...VALID, bpm: "fast" })).toBeNull();
    expect(
      parseTelemetryFrame({
        ...VALID,
        detected_pitch: { ...VALID.detected_pitch, midi: "45" },
      }),
    ).toBeNull();
  });

  it("rejects non-finite numbers", () => {
    expect(parseTelemetryFrame({ ...VALID, rms: Infinity })).toBeNull();
  });
});

/** Build a controllable fake socket + factory. */
function makeFakeSocket() {
  const socket: WebSocketLike = {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    close: vi.fn(),
  };
  return socket;
}

describe("TelemetryClient", () => {
  it("emits connecting then open, and forwards valid frames", () => {
    const socket = makeFakeSocket();
    const statuses: ConnectionStatus[] = [];
    const frames: TelemetryFrame[] = [];

    const client = new TelemetryClient({
      socketFactory: () => socket,
      onStatus: (s) => statuses.push(s),
      onFrame: (f) => frames.push(f),
      scheduleReconnect: () => {},
    });
    client.start();

    expect(statuses).toEqual(["connecting"]);
    socket.onopen?.({});
    expect(statuses).toEqual(["connecting", "open"]);

    socket.onmessage?.({ data: JSON.stringify(VALID) });
    expect(frames).toEqual([VALID]);
  });

  it("drops malformed frames", () => {
    const socket = makeFakeSocket();
    const frames: TelemetryFrame[] = [];
    const client = new TelemetryClient({
      socketFactory: () => socket,
      onStatus: () => {},
      onFrame: (f) => frames.push(f),
      scheduleReconnect: () => {},
    });
    client.start();
    socket.onmessage?.({ data: "garbage" });
    socket.onmessage?.({ data: JSON.stringify({ bpm: 1 }) });
    expect(frames).toEqual([]);
  });

  it("schedules a reconnect on close", () => {
    const sockets: WebSocketLike[] = [];
    const scheduled: Array<() => void> = [];
    const client = new TelemetryClient({
      socketFactory: () => {
        const s = makeFakeSocket();
        sockets.push(s);
        return s;
      },
      onStatus: () => {},
      onFrame: () => {},
      scheduleReconnect: (fn) => scheduled.push(fn),
    });
    client.start();

    // First socket closes -> one reconnect scheduled.
    sockets[0].onclose?.({});
    expect(scheduled).toHaveLength(1);

    // Running the scheduled fn creates a new socket (reconnect attempt).
    scheduled[0]();
    expect(sockets).toHaveLength(2);
  });

  it("does not reconnect after stop()", () => {
    const sockets: WebSocketLike[] = [];
    const scheduled: Array<() => void> = [];
    const client = new TelemetryClient({
      socketFactory: () => {
        const s = makeFakeSocket();
        sockets.push(s);
        return s;
      },
      onStatus: () => {},
      onFrame: () => {},
      scheduleReconnect: (fn) => scheduled.push(fn),
    });
    client.start();
    client.stop();
    // A late close should not schedule a reconnect.
    sockets[0].onclose?.({});
    expect(scheduled).toHaveLength(0);
    expect(sockets[0].close).toHaveBeenCalled();
  });
});
