/**
 * Pure mapping functions for note & pitch visuals (spec Task 8, Lane C).
 *
 * Convert a telemetry frame into visual properties. No DOM/React here so these
 * are unit-testable against the contract's boundary cases (hz=0, note "N/A",
 * onset toggling, clamped bpm/rms).
 */
import type { TelemetryFrame } from "../types";

/** MIDI range we map onto the vertical axis (low E on a guitar ~ E2=40). */
export const MIDI_MIN = 36;
export const MIDI_MAX = 88;

/** Visual props derived from a single frame. */
export interface NoteVisual {
  /** Whether a pitched note is currently detected (above the noise gate). */
  active: boolean;
  /** Display note name, or "" when inactive. */
  note: string;
  key: string;
  midi: number;
  /** Vertical position 0..1 (0 = low, 1 = high) from the MIDI note. */
  position: number;
  /** Intensity 0..1 from RMS (clamped). */
  intensity: number;
  /** CSS hex color string derived from spectral centroid ("brightness"). */
  color: string;
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** True when the frame has no pitched content (below the noise gate). */
export function isSilent(frame: TelemetryFrame): boolean {
  return frame.detected_pitch.hz <= 0 || frame.detected_pitch.note === "N/A";
}

/** Map a MIDI note number to a 0..1 vertical position (clamped). */
export function midiToPosition(midi: number): number {
  const clamped = clamp(midi, MIDI_MIN, MIDI_MAX);
  return (clamped - MIDI_MIN) / (MIDI_MAX - MIDI_MIN);
}

/**
 * Map spectral centroid (Hz) to a hue-based color. Low centroid = warm red,
 * high centroid = cool blue. Centroid is log-scaled across ~80 Hz..8 kHz.
 */
export function centroidToColor(centroidHz: number): string {
  const minHz = 80;
  const maxHz = 8000;
  const c = clamp(centroidHz, minHz, maxHz);
  const t = Math.log(c / minHz) / Math.log(maxHz / minHz); // 0..1
  // Hue 0 (red) -> 220 (blue) as brightness increases.
  const hue = Math.round(t * 220);
  return `hsl(${hue}, 85%, 55%)`;
}

/** Derive the full visual props from a telemetry frame. */
export function frameToNoteVisual(frame: TelemetryFrame): NoteVisual {
  const silent = isSilent(frame);
  const { note, key, midi } = frame.detected_pitch;
  return {
    active: !silent,
    note: silent ? "" : note,
    key: silent ? "" : key,
    midi,
    position: midiToPosition(midi),
    intensity: clamp(frame.rms, 0, 1),
    color: centroidToColor(frame.spectral_centroid_hz),
  };
}

// ---------------------------------------------------------------------------
// Onset-once tracking
// ---------------------------------------------------------------------------

/**
 * Onset pulses must fire once per transient. Because the engine consumes the
 * `onset` flag each broadcast, a `true` frame is a new onset. This helper
 * records the frame timestamp of the last handled onset so repeated reads of
 * the same frame do not re-trigger.
 */
export class OnsetTracker {
  private lastTs = -1;

  /** Returns true exactly once for each new onset frame. */
  consume(frame: TelemetryFrame): boolean {
    if (frame.onset && frame.timestamp !== this.lastTs) {
      this.lastTs = frame.timestamp;
      return true;
    }
    return false;
  }

  reset(): void {
    this.lastTs = -1;
  }
}

// ---------------------------------------------------------------------------
// Pitch history ring buffer (for the trail)
// ---------------------------------------------------------------------------

export interface PitchSample {
  position: number;
  intensity: number;
  color: string;
}

/** Fixed-capacity ring buffer of recent active pitch samples. */
export class PitchHistory {
  private readonly capacity: number;
  private readonly samples: PitchSample[] = [];

  constructor(capacity = 64) {
    this.capacity = Math.max(1, capacity);
  }

  push(sample: PitchSample): void {
    this.samples.push(sample);
    if (this.samples.length > this.capacity) {
      this.samples.shift();
    }
  }

  /** Oldest-to-newest list of samples. */
  toArray(): PitchSample[] {
    return [...this.samples];
  }

  get length(): number {
    return this.samples.length;
  }

  clear(): void {
    this.samples.length = 0;
  }
}
