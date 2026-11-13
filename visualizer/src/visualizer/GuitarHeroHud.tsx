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
  const zone = rockZone(flow);
  const color = ROCK_ZONE_COLORS[zone];
  const pct = Math.round(flow * 100);

  return (
    <div className="gh-rockmeter" aria-label="Rock meter">
      <div className="gh-rockmeter__label">ROCK&nbsp;METER</div>
      <div className="gh-rockmeter__track">
        <div
          className="gh-rockmeter__fill"
          data-testid="rockmeter-fill"
          style={{ height: `${pct}%`, background: color, boxShadow: `0 0 18px ${color}` }}
        />
        {showFlames(flow) && <div className="gh-rockmeter__flames" aria-hidden="true">🔥</div>}
      </div>
      <div className="gh-rockmeter__tag" style={{ color }}>
        {MOOD_TAGLINE[mood]}
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
