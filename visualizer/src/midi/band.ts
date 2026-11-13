/**
 * Web MIDI client for the CyberJam_Band virtual port (spec Task 12, track E).
 *
 * Reads the ML band's live MIDI (drums Ch 10, bass Ch 2, CC Ch 1) and parses
 * raw status/data bytes into typed `BandMidiEvent`s tagged by role. All bytes
 * are treated defensively. Degrades gracefully when Web MIDI is unsupported,
 * denied, or the port is absent.
 */
import { BAND_MIDI_PORT_NAME } from "../config";
import type { BandMidiEvent, MidiRole, MidiStatus } from "../types";

/** Map a 0-based wire channel to a role, per contracts-and-apis.md §3. */
export function channelToRole(channel0: number): MidiRole | null {
  switch (channel0) {
    case 0:
      return "cc"; // MIDI Channel 1 — Wekinator CC
    case 1:
      return "bass"; // MIDI Channel 2 — ML bass
    case 9:
      return "drums"; // MIDI Channel 10 — ML drums
    default:
      return null;
  }
}

/**
 * Parse a raw MIDI message (status + up to 2 data bytes) into a BandMidiEvent.
 * Returns null for channels we don't visualize or unsupported message types.
 * A note_on with velocity 0 is treated as note_off (running-status convention).
 */
export function parseMidiMessage(
  data: Uint8Array | number[],
  time: number,
): BandMidiEvent | null {
  if (data.length < 2) return null;
  const status = data[0];
  const type = status & 0xf0;
  const channel = status & 0x0f;
  const role = channelToRole(channel);
  if (role === null) return null;

  const data1 = data[1] & 0x7f;
  const data2 = (data[2] ?? 0) & 0x7f;

  if (type === 0x90) {
    // note_on (velocity 0 == note_off)
    return {
      time,
      role,
      channel,
      kind: data2 === 0 ? "note_off" : "note_on",
      data1,
      data2,
    };
  }
  if (type === 0x80) {
    return { time, role, channel, kind: "note_off", data1, data2 };
  }
  if (type === 0xb0) {
    return { time, role, channel, kind: "cc", data1, data2 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Minimal structural types for Web MIDI (eases mocking; avoids DOM lib reliance)
// ---------------------------------------------------------------------------

export interface MidiMessageEventLike {
  data: Uint8Array | null;
  /** DOMHighResTimeStamp in ms. */
  timeStamp: number;
}

export interface MidiInputLike {
  name: string | null;
  onmidimessage: ((ev: MidiMessageEventLike) => void) | null;
}

/** Just the read-only iteration surface we need from a MIDI input map. */
export interface MidiInputMapLike {
  values(): IterableIterator<MidiInputLike>;
}

export interface MidiAccessLike {
  inputs: MidiInputMapLike;
}

export interface MidiProvider {
  isSupported(): boolean;
  requestAccess(): Promise<MidiAccessLike>;
}

/** Default provider backed by the real Web MIDI API. */
export function browserMidiProvider(): MidiProvider {
  return {
    isSupported: () =>
      typeof navigator !== "undefined" &&
      typeof (navigator as Navigator & {
        requestMIDIAccess?: unknown;
      }).requestMIDIAccess === "function",
    requestAccess: () =>
      (navigator as Navigator & {
        requestMIDIAccess: (opts?: { sysex?: boolean }) => Promise<unknown>;
      })
        .requestMIDIAccess({ sysex: false })
        .then((access) => access as unknown as MidiAccessLike),
  };
}

/** Find the CyberJam_Band input by name (case-insensitive substring). */
export function findBandInput(
  access: MidiAccessLike,
  portName: string = BAND_MIDI_PORT_NAME,
): MidiInputLike | null {
  const needle = portName.toLowerCase();
  for (const input of access.inputs.values()) {
    if ((input.name ?? "").toLowerCase().includes(needle)) return input;
  }
  return null;
}

export interface BandMidiClientOptions {
  onEvent: (event: BandMidiEvent) => void;
  onStatus: (status: MidiStatus) => void;
  provider?: MidiProvider;
  portName?: string;
}

/** Owns the Web MIDI connection and forwards parsed band events. */
export class BandMidiClient {
  private readonly onEvent: (event: BandMidiEvent) => void;
  private readonly onStatus: (status: MidiStatus) => void;
  private readonly provider: MidiProvider;
  private readonly portName: string;
  private input: MidiInputLike | null = null;

  constructor(opts: BandMidiClientOptions) {
    this.onEvent = opts.onEvent;
    this.onStatus = opts.onStatus;
    this.provider = opts.provider ?? browserMidiProvider();
    this.portName = opts.portName ?? BAND_MIDI_PORT_NAME;
  }

  async start(): Promise<void> {
    if (!this.provider.isSupported()) {
      this.onStatus("unsupported");
      return;
    }
    this.onStatus("requesting");

    let access: MidiAccessLike;
    try {
      access = await this.provider.requestAccess();
    } catch {
      this.onStatus("denied");
      return;
    }

    const input = findBandInput(access, this.portName);
    if (!input) {
      this.onStatus("port-missing");
      return;
    }

    this.input = input;
    input.onmidimessage = (ev) => {
      if (!ev.data) return;
      const parsed = parseMidiMessage(ev.data, ev.timeStamp);
      if (parsed) this.onEvent(parsed);
    };
    this.onStatus("active");
  }

  stop(): void {
    if (this.input) {
      this.input.onmidimessage = null;
      this.input = null;
    }
  }
}
