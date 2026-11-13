/**
 * Central Zustand store (spec Task 2).
 *
 * Holds the live data-layer slices shared by both windows. Navigation is owned
 * by the hash router (`router.ts`), not the store, because the Menu and
 * Visualizer are now separate windows (one per screen) rather than tabs.
 * Cross-window `selection` sync is handled by `sync.ts`.
 */
import { create } from "zustand";
import type {
  AudioStatus,
  BandMidiEvent,
  ConnectionStatus,
  MidiStatus,
  PerformanceMood,
  SessionSelection,
  TelemetryFrame,
} from "./types";

/** Initial, empty selection (nothing chosen yet). */
export const INITIAL_SELECTION: SessionSelection = {
  songId: null,
  instrumentIds: [],
};

/** Max band MIDI events retained for the scrolling ribbon history. */
export const BAND_EVENT_CAP = 512;

export interface VisualizerState {
  // --- Live telemetry ----------------------------------------------------
  latestFrame: TelemetryFrame | null;
  setLatestFrame: (frame: TelemetryFrame) => void;

  // --- Connection + audio status ----------------------------------------
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;

  audioStatus: AudioStatus;
  setAudioStatus: (status: AudioStatus) => void;

  // --- Band MIDI (track E) ----------------------------------------------
  midiStatus: MidiStatus;
  setMidiStatus: (status: MidiStatus) => void;
  bandEvents: BandMidiEvent[];
  pushBandEvent: (event: BandMidiEvent) => void;
  clearBandEvents: () => void;

  // --- Performance flow (track E) ---------------------------------------
  flow: number; // 0..1
  mood: PerformanceMood;
  setFlow: (flow: number, mood: PerformanceMood) => void;

  // --- Menu selection (synced across windows via sync.ts) ----------------
  selection: SessionSelection;
  setSelection: (selection: SessionSelection) => void;
  setSong: (songId: string | null) => void;
  toggleInstrument: (instrumentId: string) => void;
  resetSelection: () => void;
}

export const useVisualizerStore = create<VisualizerState>((set) => ({
  latestFrame: null,
  setLatestFrame: (frame) => set({ latestFrame: frame }),

  connectionStatus: "connecting",
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

  audioStatus: "idle",
  setAudioStatus: (audioStatus) => set({ audioStatus }),

  midiStatus: "idle",
  setMidiStatus: (midiStatus) => set({ midiStatus }),
  bandEvents: [],
  pushBandEvent: (event) =>
    set((state) => {
      const next = state.bandEvents.length >= BAND_EVENT_CAP
        ? [...state.bandEvents.slice(state.bandEvents.length - BAND_EVENT_CAP + 1), event]
        : [...state.bandEvents, event];
      return { bandEvents: next };
    }),
  clearBandEvents: () => set({ bandEvents: [] }),

  flow: 0,
  mood: "idle",
  setFlow: (flow, mood) => set({ flow, mood }),

  selection: INITIAL_SELECTION,
  setSelection: (selection) => set({ selection }),
  setSong: (songId) =>
    set((state) => ({ selection: { ...state.selection, songId } })),
  toggleInstrument: (instrumentId) =>
    set((state) => {
      const has = state.selection.instrumentIds.includes(instrumentId);
      const instrumentIds = has
        ? state.selection.instrumentIds.filter((id) => id !== instrumentId)
        : [...state.selection.instrumentIds, instrumentId];
      return { selection: { ...state.selection, instrumentIds } };
    }),
  resetSelection: () => set({ selection: INITIAL_SELECTION }),
}));
