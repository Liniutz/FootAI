/**
 * Operator-facing status messages (spec Task 10).
 *
 * Pure mappers from the data-layer status unions to a short pill label, a tone
 * (for color coding), and an optional actionable hint shown when the engine or
 * a device is not available. Keeping these pure makes the guidance testable
 * without rendering, and keeps the exact port/device references from
 * docs/contracts-and-apis.md / docs/audio-and-routing.md in one place.
 */
import type { AudioStatus, ConnectionStatus, MidiStatus } from "../types";
import {
  BAND_MIDI_PORT_NAME,
  TELEMETRY_WS_URL,
  VISUAL_AUDIO_DEVICE_LABEL,
} from "../config";

/** Severity used for color coding a status pill. */
export type StatusTone = "ok" | "pending" | "warn" | "error";

export interface StatusView {
  /** Short pill label. */
  label: string;
  tone: StatusTone;
  /** Longer actionable guidance, present only when action is needed. */
  hint?: string;
}

/** Telemetry WebSocket status → operator view. */
export function telemetryStatusView(status: ConnectionStatus): StatusView {
  switch (status) {
    case "open":
      return { label: "Engine live", tone: "ok" };
    case "connecting":
      return {
        label: "Connecting…",
        tone: "pending",
        hint: `Reaching the engine at ${TELEMETRY_WS_URL}…`,
      };
    case "closed":
    case "error":
      return {
        label: "Engine offline",
        tone: "error",
        hint: "Engine offline — start the engine (run_session.py). Reconnecting automatically.",
      };
  }
}

/** Audio capture status → operator view. */
export function audioStatusView(status: AudioStatus): StatusView {
  switch (status) {
    case "active":
      return { label: "Audio live", tone: "ok" };
    case "requesting":
      return { label: "Audio…", tone: "pending" };
    case "denied":
      return {
        label: "Audio denied",
        tone: "warn",
        hint: "Microphone permission was denied — allow audio access, then click Enable Audio.",
      };
    case "device-missing":
      return {
        label: "No audio device",
        tone: "warn",
        hint: `Virtual audio device "${VISUAL_AUDIO_DEVICE_LABEL}" not found — launch the engine with --pipewire-loopback.`,
      };
    case "idle":
    default:
      return {
        label: "Audio off",
        tone: "pending",
        hint: "Click Enable Audio to show the live waveform.",
      };
  }
}

/** Band MIDI status → operator view. */
export function midiStatusView(status: MidiStatus): StatusView {
  switch (status) {
    case "active":
      return { label: "Band MIDI live", tone: "ok" };
    case "requesting":
      return { label: "MIDI…", tone: "pending" };
    case "denied":
      return {
        label: "MIDI denied",
        tone: "warn",
        hint: "Web MIDI permission was denied — allow MIDI access, then Connect Band MIDI.",
      };
    case "port-missing":
      return {
        label: "No band port",
        tone: "warn",
        hint: `MIDI port "${BAND_MIDI_PORT_NAME}" not found — start the engine so it creates the virtual port.`,
      };
    case "unsupported":
      return {
        label: "No Web MIDI",
        tone: "warn",
        hint: "This browser has no Web MIDI support — the band ribbon stays empty.",
      };
    case "idle":
    default:
      return {
        label: "Band MIDI off",
        tone: "pending",
        hint: "Click Connect Band MIDI to show the band ribbon.",
      };
  }
}

/**
 * The single most important hint to surface, or null when all is well.
 * Prioritizes the engine being offline (blocks everything), then audio, then
 * MIDI — so the operator sees the most actionable problem first.
 */
export function primaryHint(
  telemetry: ConnectionStatus,
  audio: AudioStatus,
  midi: MidiStatus,
): string | null {
  const t = telemetryStatusView(telemetry);
  if (t.tone === "error") return t.hint ?? null;
  const a = audioStatusView(audio);
  if (a.tone === "warn") return a.hint ?? null;
  const m = midiStatusView(midi);
  if (m.tone === "warn") return m.hint ?? null;
  return null;
}
