/**
 * Session overlay (spec Task 9): ties the Menu `selection` to the Visualizer.
 *
 * Renders two things driven by the store's `selection` + live telemetry:
 *   1. A song reference panel — title, reference BPM vs live BPM, reference key
 *      vs detected key (color-coded match / off).
 *   2. A lane legend — the selected instrument lanes with their `displayColor`
 *      and documented MIDI role label (Ch 1/2/10).
 *
 * With no selection yet it shows a neutral "Free session" header and the full
 * lane legend, so the Visualizer is never blank before the operator chooses.
 */
import { useVisualizerStore } from "../store";
import {
  activeLanes,
  compareBpm,
  compareKey,
  selectedSong,
} from "./selectionView";

export function SessionOverlay() {
  const selection = useVisualizerStore((s) => s.selection);
  const frame = useVisualizerStore((s) => s.latestFrame);
  const song = selectedSong(selection);
  const lanes = activeLanes(selection);

  const liveBpm = frame?.bpm ?? null;
  const detectedKey = frame?.detected_pitch.key ?? null;
  const demoPrompt = frame?.demo_prompt;
  const demoPhase = frame?.demo_phase;
  const freestyleActive = Boolean(song?.freestyle);
  const promptVisible = freestyleActive && demoPhase !== "locked";

  const bpmMatch = song ? compareBpm(liveBpm, song.referenceBpm) : null;
  const keyMatch = song ? compareKey(detectedKey, song.referenceKey) : null;

  return (
    <div className="session-overlay" aria-label="Session overlay">
      <div className="session-overlay__song">
        <span className="session-overlay__eyebrow">Now Playing</span>
        <span className="session-overlay__title" data-testid="session-song-title">
          {song ? song.title : "Free Session"}
        </span>

        {song?.freestyle && (
          <div className="session-overlay__refs">
            <span className="session-ref session-ref--none" data-testid="session-bpm">
              BPM {Math.round(liveBpm && liveBpm > 0 ? liveBpm : 0) || "—"}
            </span>
            <span className="session-ref session-ref--none" data-testid="session-key">
              Key {detectedKey && detectedKey !== "N/A" ? detectedKey : "—"}
            </span>
            <span className="session-ref__tag" data-testid="session-freestyle-tag">
              Guitar leads · band follows
            </span>
            {demoPhase === "locked" && (
              <span className="session-ref__tag" data-testid="freestyle-prompt" data-phase="locked">
                {demoPrompt || "Guitar leads · band follows"}
              </span>
            )}
          </div>
        )}

        {song && !song.freestyle && (
          <div className="session-overlay__refs">
            <span
              className={`session-ref session-ref--${bpmMatch ?? "none"}`}
              data-testid="session-bpm"
            >
              BPM {Math.round(liveBpm && liveBpm > 0 ? liveBpm : 0) || "—"}
              <span className="session-ref__target"> / {song.referenceBpm}</span>
            </span>
            <span
              className={`session-ref session-ref--${keyMatch ?? "none"}`}
              data-testid="session-key"
            >
              Key {detectedKey && detectedKey !== "N/A" ? detectedKey : "—"}
              <span className="session-ref__target"> / {song.referenceKey}</span>
            </span>
          </div>
        )}
      </div>

      {freestyleActive && promptVisible && demoPhase !== "locked" && (
        <div className="freestyle-prompt-backdrop" data-testid="freestyle-prompt-backdrop">
          <section
            aria-label="Freestyle groove setup"
            aria-modal="true"
            className="freestyle-prompt"
            data-phase={demoPhase || "wait"}
            role="dialog"
          >
            <span className="freestyle-prompt__eyebrow">Freestyle · groove setup</span>
            <h2>Play 2 bars</h2>
            <p>Play eight measures at a comfortable pace. The band will lock to your groove, then you can follow the drums.</p>
            {demoPhase === "capture" && demoPrompt && (
              <p className="freestyle-prompt__status" data-testid="freestyle-prompt-status">{demoPrompt}</p>
            )}
          </section>
        </div>
      )}

      <ul className="session-overlay__lanes" aria-label="Active lanes">
        {lanes.map(({ instrument }) => (
          <li
            key={instrument.id}
            className="session-lane"
            data-testid={`session-lane-${instrument.id}`}
            style={{ "--lane-color": instrument.displayColor } as React.CSSProperties}
          >
            <span className="session-lane__dot" aria-hidden="true" />
            <span className="session-lane__label">{instrument.label}</span>
            <span className="session-lane__channel">Ch {instrument.midiChannel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
