/**
 * Persistent status bar (spec Task 10).
 *
 * Reads the live data-layer statuses from the store and renders color-coded
 * pills (telemetry / audio / band MIDI) with a reconnect indicator, plus a
 * single operator-facing guidance line when action is needed (engine offline,
 * audio device missing, etc.). Action buttons are passed in as children so the
 * Visualizer can wire Enable Audio without this component owning those hooks.
 * Replaces the temporary DebugPanel from earlier tasks.
 */
import type { ReactNode } from "react";
import { useVisualizerStore } from "../store";
import {
  audioStatusView,
  midiStatusView,
  primaryHint,
  telemetryStatusView,
  type StatusView,
} from "./statusMessages";

function Pill({ view, testId }: { view: StatusView; testId: string }) {
  return (
    <span
      className={`statusbar__pill statusbar__pill--${view.tone}`}
      data-testid={testId}
      title={view.hint ?? view.label}
    >
      {view.label}
    </span>
  );
}

export function StatusBar({
  children,
  showMidi = true,
}: {
  children?: ReactNode;
  /** Show the band-MIDI pill. False when no band ribbon consumes it. */
  showMidi?: boolean;
}) {
  const connectionStatus = useVisualizerStore((s) => s.connectionStatus);
  const audioStatus = useVisualizerStore((s) => s.audioStatus);
  const midiStatus = useVisualizerStore((s) => s.midiStatus);

  const telemetry = telemetryStatusView(connectionStatus);
  const audio = audioStatusView(audioStatus);
  const midi = midiStatusView(midiStatus);
  // Only let MIDI drive the guidance line when its pill is actually shown.
  const hint = showMidi
    ? primaryHint(connectionStatus, audioStatus, midiStatus)
    : primaryHint(connectionStatus, audioStatus, "idle");

  return (
    <div className="statusbar" aria-label="Status">
      <div className="statusbar__pills">
        <Pill view={telemetry} testId="status-telemetry" />
        {connectionStatus === "connecting" && (
          <span className="statusbar__reconnect" data-testid="status-reconnect">
            ⟳ reconnecting
          </span>
        )}
        <Pill view={audio} testId="status-audio" />
        {showMidi && <Pill view={midi} testId="status-midi" />}
        {children}
      </div>

      {hint && (
        <p className="statusbar__hint" role="status" data-testid="status-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
