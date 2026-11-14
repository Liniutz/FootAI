import { useVisualizerStore } from "../store";
import { ScoreBoard } from "./GuitarHeroHud";
import { selectedSong } from "./selectionView";

/** Fullscreen TV overlay: unboxed song title, live BPM/key, score, and Freestyle 4-bars setup popup. */
export function SessionOverlay() {
  const selection = useVisualizerStore((s) => s.selection);
  const frame = useVisualizerStore((s) => s.latestFrame);
  const song = selectedSong(selection);
  const liveKey = frame?.detected_pitch.key;
  const key = liveKey && liveKey !== "N/A" ? liveKey : "—";
  const bpm = Math.round(frame?.bpm || 0) || "—";
  const demoPhase = frame?.demo_phase;
  const demoPrompt = frame?.demo_prompt;
  const freestyleActive = Boolean(song?.freestyle);
  const promptVisible = freestyleActive && demoPhase !== "locked";

  return (
    <div className="tv-hud" aria-label="Live music information">
      <div className="tv-hud__song" data-testid="session-song-title">
        {song ? song.title : "Free Session"}
      </div>

      <div className="tv-hud__stats">
        <span data-testid="session-bpm"><strong>{bpm}</strong><small>BPM</small></span>
        <span data-testid="session-key"><strong>{key}</strong><small>KEY</small></span>
      </div>

      <ScoreBoard />

      {promptVisible && (
        <div className="freestyle-prompt-backdrop" data-testid="freestyle-prompt-backdrop">
          <section
            aria-label="Freestyle groove setup"
            aria-modal="true"
            className="freestyle-prompt"
            data-phase={demoPhase || "wait"}
            role="dialog"
          >
            <span className="freestyle-prompt__eyebrow">Freestyle · groove setup</span>
            <h2>Play 4 bars</h2>
            <p>Play sixteen measures at a comfortable pace. The band will lock to your groove, then you can follow the drums.</p>
            {demoPhase === "capture" && demoPrompt && (
              <p className="freestyle-prompt__status" data-testid="freestyle-prompt-status">{demoPrompt}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
