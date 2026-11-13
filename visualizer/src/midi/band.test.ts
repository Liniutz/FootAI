/** Spec Task 12 tests: band MIDI parsing + client. */
import { describe, expect, it, vi } from "vitest";
import {
  BandMidiClient,
  channelToRole,
  findBandInput,
  parseMidiMessage,
  type MidiAccessLike,
  type MidiInputLike,
  type MidiProvider,
} from "./band";
import type { BandMidiEvent, MidiStatus } from "../types";

describe("channelToRole", () => {
  it("maps documented channels to roles", () => {
    expect(channelToRole(0)).toBe("cc"); // Ch 1
    expect(channelToRole(1)).toBe("bass"); // Ch 2
    expect(channelToRole(9)).toBe("drums"); // Ch 10
  });
  it("ignores other channels", () => {
    expect(channelToRole(2)).toBeNull();
    expect(channelToRole(15)).toBeNull();
  });
});

describe("parseMidiMessage", () => {
  it("parses note_on on the bass channel", () => {
    const e = parseMidiMessage([0x91, 45, 110], 123);
    expect(e).toEqual({
      time: 123,
      role: "bass",
      channel: 1,
      kind: "note_on",
      data1: 45,
      data2: 110,
    });
  });

  it("treats note_on velocity 0 as note_off", () => {
    const e = parseMidiMessage([0x99, 36, 0], 10);
    expect(e?.kind).toBe("note_off");
    expect(e?.role).toBe("drums");
  });

  it("parses explicit note_off", () => {
    const e = parseMidiMessage([0x89, 42, 64], 5);
    expect(e?.kind).toBe("note_off");
  });

  it("parses CC on channel 1", () => {
    const e = parseMidiMessage([0xb0, 74, 100], 7);
    expect(e).toEqual({
      time: 7,
      role: "cc",
      channel: 0,
      kind: "cc",
      data1: 74,
      data2: 100,
    });
  });

  it("drops non-band channels and short messages", () => {
    expect(parseMidiMessage([0x92, 60, 100], 0)).toBeNull(); // ch 3
    expect(parseMidiMessage([0x90], 0)).toBeNull();
  });
});

function makeInput(name: string): MidiInputLike {
  return { name, onmidimessage: null };
}

function makeAccess(inputs: MidiInputLike[]): MidiAccessLike {
  const map = new Map<string, MidiInputLike>();
  inputs.forEach((i, idx) => map.set(String(idx), i));
  return { inputs: map };
}

describe("findBandInput", () => {
  it("finds CyberJam_Band by name substring", () => {
    const access = makeAccess([
      makeInput("Some Other Port"),
      makeInput("CyberJam_Band 1"),
    ]);
    expect(findBandInput(access)?.name).toBe("CyberJam_Band 1");
  });
  it("returns null when absent", () => {
    expect(findBandInput(makeAccess([makeInput("nope")]))).toBeNull();
  });
});

describe("BandMidiClient", () => {
  it("reports unsupported when Web MIDI is unavailable", async () => {
    const statuses: MidiStatus[] = [];
    const provider: MidiProvider = {
      isSupported: () => false,
      requestAccess: vi.fn(),
    };
    const client = new BandMidiClient({
      provider,
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
    });
    await client.start();
    expect(statuses).toEqual(["unsupported"]);
  });

  it("reports port-missing when CyberJam_Band is absent", async () => {
    const statuses: MidiStatus[] = [];
    const provider: MidiProvider = {
      isSupported: () => true,
      requestAccess: async () => makeAccess([makeInput("Other")]),
    };
    const client = new BandMidiClient({
      provider,
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
    });
    await client.start();
    expect(statuses).toEqual(["requesting", "port-missing"]);
  });

  it("goes active and forwards parsed events", async () => {
    const statuses: MidiStatus[] = [];
    const events: BandMidiEvent[] = [];
    const input = makeInput("CyberJam_Band");
    const provider: MidiProvider = {
      isSupported: () => true,
      requestAccess: async () => makeAccess([input]),
    };
    const client = new BandMidiClient({
      provider,
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
    });
    await client.start();
    expect(statuses).toEqual(["requesting", "active"]);

    // Simulate an incoming note on the bass channel.
    input.onmidimessage?.({ data: new Uint8Array([0x91, 45, 100]), timeStamp: 50 });
    expect(events).toHaveLength(1);
    expect(events[0].role).toBe("bass");

    client.stop();
    expect(input.onmidimessage).toBeNull();
  });

  it("reports denied when requestAccess rejects", async () => {
    const statuses: MidiStatus[] = [];
    const provider: MidiProvider = {
      isSupported: () => true,
      requestAccess: async () => {
        throw new Error("denied");
      },
    };
    const client = new BandMidiClient({
      provider,
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
    });
    await client.start();
    expect(statuses).toEqual(["requesting", "denied"]);
  });
});
