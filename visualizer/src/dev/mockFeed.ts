/**
 * Dev-only mock data feed (no engine required).
 *
 * Synthesizes plausible telemetry frames and band MIDI events straight into the
 * Zustand store so the Visualizer animates without the Python engine running.
 * This is strictly a local testing aid — it is gated behind a URL flag
 * (`?mock` or `&mock=1`) and never runs in normal use.
 *
 * Enable it by opening, e.g.:
 *   http://localhost:5173/?mock#/visualizer
 *
 * It drives:
 *   - telemetry: a walking pitch around E2–E4, swaying BPM, RMS/centroid,
 *     occasional onsets → feeds note visuals, waveform-independent HUD, flow.
 *   - band MIDI: periodic drums (Ch10), bass (Ch2), and CC (Ch1) events →
 *     feeds the fretboard ribbon + session-overlay lanes.
 *   - statuses: flips telemetry→open and MIDI→active so the StatusBar shows a
 *     healthy "live" state.
 *
 * Audio (the live waveform) still needs a real input device; the mock cannot
 * fabricate a Web Audio stream, so the waveform stays flat under mock mode.
 */
import { useVisualizerStore } from "../store";
import type { BandMidiEvent, TelemetryFrame } from "../types";

const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

function midiToNote(midi: number): { note: string; key: string; hz: number } {
  const key = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  const hz = 440 * Math.pow(2, (midi - 69) / 12);
  return { note: `${key}${octave}`, key, hz };
}

export interface MockFeedHandle {
  stop: () => void;
}

/** True when the URL asks for the mock feed (`?mock` / `?mock=1`). */
export function isMockEnabled(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  return params.has("mock") && params.get("mock") !== "0";
}

/**
 * Start the mock feed. Returns a handle to stop it. Safe to call once per
 * window; it flips statuses to a healthy state and schedules two timers.
 */
export function startMockFeed(): MockFeedHandle {
  const store = useVisualizerStore.getState();
  store.setConnectionStatus("open");
  store.setMidiStatus("active");

  let tick = 0;
  // Telemetry at ~20 Hz to mirror the real broadcast cadence.
  const telemetryTimer = window.setInterval(() => {
    tick += 1;
    const s = useVisualizerStore.getState();

    // Walk a melody around the guitar's range.
    const base = 40; // E2
    const midi = base + Math.round(12 + 10 * Math.sin(tick / 13));
    const { note, key, hz } = midiToNote(midi);

    const onset = tick % 10 === 0; // a transient roughly every 0.5 s
    const bpm = 120 + 8 * Math.sin(tick / 40);
    const rms = 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(tick / 7));
    const centroid = 1200 + 600 * Math.sin(tick / 11);

    const frame: TelemetryFrame = {
      timestamp: Date.now() / 1000,
      bpm,
      detected_pitch: { hz, note, midi, key },
      rms,
      spectral_centroid_hz: centroid,
      onset,
    };
    s.setLatestFrame(frame);
  }, 50);

  // Band MIDI events on a looser musical grid.
  const midiTimer = window.setInterval(() => {
    tick += 1;
    const s = useVisualizerStore.getState();
    const now = performance.now();

    const push = (e: Omit<BandMidiEvent, "time">) =>
      s.pushBandEvent({ ...e, time: now });

    // Drums (Ch 10 / wire 9): kick + hat pattern.
    push({ role: "drums", channel: 9, kind: "note_on", data1: 36, data2: 110 });
    if (tick % 2 === 0) {
      push({ role: "drums", channel: 9, kind: "note_on", data1: 42, data2: 80 });
    }
    // Bass (Ch 2 / wire 1): a moving root note.
    const bassNote = 40 + ((tick * 2) % 12);
    push({ role: "bass", channel: 1, kind: "note_on", data1: bassNote, data2: 100 });
    // CC / synth-fx (Ch 1 / wire 0): filter sweep.
    push({ role: "cc", channel: 0, kind: "cc", data1: 74, data2: (tick * 9) % 128 });
  }, 400);

  return {
    stop: () => {
      window.clearInterval(telemetryTimer);
      window.clearInterval(midiTimer);
    },
  };
}
