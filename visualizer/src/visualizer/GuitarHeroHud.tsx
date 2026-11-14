/**
 * HUD overlay (track E restyle): Rock Meter, score/combo/multiplier, and mood
 * tagline. React/DOM for crisp text; reads live state from the store + the
 * score hook. (The per-string notes now live on the horizontal Fretboard, so
 * the old 5-fret pitch strip was removed.)
 */
import { useVisualizerStore } from "../store";
import { useScore } from "./useScore";
import {
  MOOD_TAGLINE,
  ROCK_ZONE_COLORS,
  rockZone,
  showFlames,
} from "./scoring";

export function RockMeter() {
  const flow = useVisualizerStore((s) => s.flow);
  const mood = useVisualizerStore((s) => s.mood);
  const latestFrame = useVisualizerStore((s) => s.latestFrame);
  const zone = rockZone(flow);
  const color = ROCK_ZONE_COLORS[zone];
  // Show the actual guitar signal, not the slower composite flow score.
  // Typical guitar RMS is small (< 0.1), so scale against a useful input range.
  const rms = latestFrame?.rms ?? 0;
  const pct = Math.round(Math.min(1, Math.max(0, rms / 0.12)) * 100);

  return (
    <div className="gh-rockmeter" aria-label="Guitar input level">
      <div className="gh-rockmeter__label">GUITAR&nbsp;INPUT</div>
      <div className="gh-rockmeter__track">
        <div
          className="gh-rockmeter__fill"
          data-testid="rockmeter-fill"
          style={{ height: `${pct}%`, background: color, boxShadow: `0 0 18px ${color}` }}
        />
        {showFlames(flow) && <div className="gh-rockmeter__flames" aria-hidden="true">🔥</div>}
      </div>
      <div className="gh-rockmeter__tag" style={{ color }}>
        {rms.toFixed(3)} RMS · {MOOD_TAGLINE[mood]}
      </div>
    </div>
  );
}

export function ScoreBoard() {
  const score = useScore();
  return (
    <div className="gh-score" aria-label="Score">
      <div className="gh-score__mult" data-testid="score-mult">
        ×{score.multiplier}
      </div>
      <div className="gh-score__points" data-testid="score-points">
        {score.score.toLocaleString()}
      </div>
      <div className="gh-score__combo">
        {score.combo > 0 ? `${score.combo} COMBO` : "—"}
      </div>
    </div>
  );
}
