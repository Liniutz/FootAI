/**
 * FROZEN CONTRACT (spec Task 2).
 *
 * These types define the Menu <-> Visualizer boundary and mirror the engine
 * telemetry JSON schema in docs/contracts-and-apis.md EXACTLY. After Sprint 0,
 * changes here require agreement from both lane owners (see docs/visualizer-react.md §4).
 */

// ---------------------------------------------------------------------------
// Telemetry (consumed by the Visualizer lane) — matches ws://127.0.0.1:8080
// ---------------------------------------------------------------------------

/** Nested pitch object within a telemetry frame. */
export interface DetectedPitch {
  /** Fundamental frequency in Hz. `0.0` when below the noise gate. */
  hz: number;
  /** Nearest note name + octave (e.g. "E2", "A2"), or "N/A" below the gate. */
  note: string;
  /** MIDI note number, 0-127. */
  midi: number;
  /** Pitch class ("C", "C#", ..., "B"). */
  key: string;
}

/** One 20 Hz telemetry broadcast frame. */
export interface TelemetryFrame {
  /** Unix epoch seconds when the snapshot was generated. */
  timestamp: number;
  /** Live tempo estimate, clamped 40.0-240.0 upstream. */
  bpm: number;
  detected_pitch: DetectedPitch;
  /** Linear RMS amplitude, 0.0-1.0. */
  rms: number;
  /** Spectral centroid ("brightness") in Hz. */
  spectral_centroid_hz: number;
  /** True once per transient (consumed each broadcast). */
  onset: boolean;
}

// ---------------------------------------------------------------------------
// Connection / audio status (surfaced by the data layer)
// ---------------------------------------------------------------------------

export type ConnectionStatus = "connecting" | "open" | "closed" | "error";

export type AudioStatus =
  | "idle"
  | "requesting"
  | "active"
  | "denied"
  | "device-missing";

// ---------------------------------------------------------------------------
// Catalog (owned by the Menu lane; read by the Visualizer lane in Task 9)
// ---------------------------------------------------------------------------

/**
 * Documented MIDI role channels (1-based) from docs/contracts-and-apis.md §3.
 * Reference-only labels — the app never opens MIDI.
 */
export type MidiChannel = 1 | 2 | 10;

/** A selectable instrument and its Visualizer presentation. */
export interface InstrumentEntry {
  id: string;
  /** Human-readable name (e.g. "Drums", "Bass", "Synth / FX"). */
  label: string;
  /** Visualizer lane index this instrument renders in. */
  lane: number;
  /** CSS color used by the Visualizer for this instrument's lane. */
  displayColor: string;
  /** Documented MIDI channel this role maps to (reference-only). */
  midiChannel: MidiChannel;
}

/** A selectable song with reference values for Visualizer overlays. */
export interface SongEntry {
  id: string;
  title: string;
  /** Reference tempo for comparison against live telemetry `bpm`. */
  referenceBpm: number;
  /** Reference key for comparison against detected `key`. */
  referenceKey: string;
  /**
   * Freestyle jam mode: the guitar leads and the ML band (drums + bass) is
   * generated to follow it, so there is no fixed target tempo/key. When true,
   * the Visualizer shows live BPM/key without a reference comparison.
   * Optional and defaults to false for regular songs.
   */
  freestyle?: boolean;
}

// ---------------------------------------------------------------------------
// Session selection (written by the Menu lane; read by the Visualizer lane)
// ---------------------------------------------------------------------------

/** The user's Menu choices. Persisted to localStorage (Task 5). */
export interface SessionSelection {
  /** Selected song id, or null when nothing is chosen yet. */
  songId: string | null;
  /** Selected instrument ids (multi-select). */
  instrumentIds: string[];
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

/** The two top-level views of the app. */
export type AppView = "menu" | "visualizer";

// ---------------------------------------------------------------------------
// Band MIDI (Extension track E — read from CyberJam_Band via Web MIDI)
// ---------------------------------------------------------------------------

/** Role a MIDI channel maps to, per docs/contracts-and-apis.md §3. */
export type MidiRole = "drums" | "bass" | "cc";

export type MidiStatus =
  | "idle"
  | "requesting"
  | "active"
  | "denied"
  | "port-missing"
  | "unsupported";

/** A parsed band MIDI event (note or CC) tagged with its role. */
export interface BandMidiEvent {
  /** Performance-clock timestamp in ms (from the MIDI event). */
  time: number;
  role: MidiRole;
  /** 0-based MIDI channel on the wire (0, 1, or 9). */
  channel: number;
  kind: "note_on" | "note_off" | "cc";
  /** Note number (note events) or CC number (cc events). */
  data1: number;
  /** Velocity (note events) or CC value (cc events), 0-127. */
  data2: number;
}

/** Performance "flow" mood derived from telemetry (Extension track E). */
export type PerformanceMood =
  | "idle"
  | "warming"
  | "playing"
  | "hyped"
  | "slump";
