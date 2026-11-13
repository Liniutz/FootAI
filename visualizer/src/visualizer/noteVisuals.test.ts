/** Spec Task 8 tests: note/pitch mapping + onset-once + history. */
import { describe, expect, it } from "vitest";
import {
  centroidToColor,
  clamp,
  frameToNoteVisual,
  isSilent,
  midiToPosition,
  MIDI_MAX,
  MIDI_MIN,
  OnsetTracker,
  PitchHistory,
} from "./noteVisuals";
import type { TelemetryFrame } from "../types";

function frame(overrides: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return {
    timestamp: 1,
    bpm: 120,
    detected_pitch: { hz: 110, note: "A2", midi: 45, key: "A" },
    rms: 0.1,
    spectral_centroid_hz: 1000,
    onset: false,
    ...overrides,
  };
}

describe("clamp", () => {
  it("bounds values", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe("isSilent", () => {
  it("is silent when hz is 0 or note is N/A", () => {
    expect(isSilent(frame({ detected_pitch: { hz: 0, note: "N/A", midi: 0, key: "C" } }))).toBe(true);
    expect(isSilent(frame({ detected_pitch: { hz: 110, note: "N/A", midi: 45, key: "A" } }))).toBe(true);
  });
  it("is not silent for a real pitch", () => {
    expect(isSilent(frame())).toBe(false);
  });
});

describe("midiToPosition", () => {
  it("maps the range endpoints to 0 and 1 (clamped)", () => {
    expect(midiToPosition(MIDI_MIN)).toBe(0);
    expect(midiToPosition(MIDI_MAX)).toBe(1);
    expect(midiToPosition(MIDI_MIN - 20)).toBe(0);
    expect(midiToPosition(MIDI_MAX + 20)).toBe(1);
  });
});

describe("centroidToColor", () => {
  it("returns an hsl string and shifts hue with brightness", () => {
    const low = centroidToColor(80);
    const high = centroidToColor(8000);
    expect(low).toMatch(/^hsl\(/);
    expect(high).toMatch(/^hsl\(/);
    expect(low).not.toBe(high);
  });
});

describe("frameToNoteVisual", () => {
  it("produces active visuals for a real pitch", () => {
    const v = frameToNoteVisual(frame({ rms: 0.5 }));
    expect(v.active).toBe(true);
    expect(v.note).toBe("A2");
    expect(v.intensity).toBe(0.5);
    expect(v.position).toBeGreaterThan(0);
  });

  it("suppresses the note when silent", () => {
    const v = frameToNoteVisual(
      frame({ detected_pitch: { hz: 0, note: "N/A", midi: 0, key: "C" } }),
    );
    expect(v.active).toBe(false);
    expect(v.note).toBe("");
    expect(v.key).toBe("");
  });

  it("clamps out-of-range rms into intensity", () => {
    expect(frameToNoteVisual(frame({ rms: 5 })).intensity).toBe(1);
    expect(frameToNoteVisual(frame({ rms: -1 })).intensity).toBe(0);
  });
});

describe("OnsetTracker", () => {
  it("fires once per new onset frame and not on repeats", () => {
    const t = new OnsetTracker();
    const onsetFrame = frame({ onset: true, timestamp: 100 });
    expect(t.consume(onsetFrame)).toBe(true);
    // Same frame re-read -> no re-trigger.
    expect(t.consume(onsetFrame)).toBe(false);
    // Non-onset frame -> false.
    expect(t.consume(frame({ onset: false, timestamp: 101 }))).toBe(false);
    // New onset frame -> fires again.
    expect(t.consume(frame({ onset: true, timestamp: 102 }))).toBe(true);
  });
});

describe("PitchHistory", () => {
  it("keeps a bounded rolling window oldest-to-newest", () => {
    const h = new PitchHistory(3);
    for (let i = 0; i < 5; i++) {
      h.push({ position: i / 10, intensity: 0.1, color: "#fff" });
    }
    const arr = h.toArray();
    expect(arr).toHaveLength(3);
    expect(arr[0].position).toBeCloseTo(0.2); // oldest kept
    expect(arr[2].position).toBeCloseTo(0.4); // newest
  });

  it("clears", () => {
    const h = new PitchHistory();
    h.push({ position: 0.1, intensity: 0.1, color: "#fff" });
    h.clear();
    expect(h.length).toBe(0);
  });
});
