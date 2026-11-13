/**
 * Score/combo hook driven by onset streaks (track E restyle).
 *
 * Each new onset (a detected strum) registers a hit; a sustained silence
 * breaks the combo. Returns the live ScoreState for the HUD.
 */
import { useEffect, useRef, useState } from "react";
import { useVisualizerStore } from "../store";
import {
  breakCombo,
  INITIAL_SCORE,
  registerHit,
  type ScoreState,
} from "./scoring";
import { OnsetTracker } from "./noteVisuals";

/** Frames of silence (no energy) before the combo breaks (~1s at 20 Hz). */
const SILENCE_BREAK_FRAMES = 20;

export function useScore(): ScoreState {
  const latestFrame = useVisualizerStore((s) => s.latestFrame);
  const [score, setScore] = useState<ScoreState>(INITIAL_SCORE);
  const onsetRef = useRef(new OnsetTracker());
  const silenceRef = useRef(0);

  useEffect(() => {
    if (!latestFrame) return;

    if (onsetRef.current.consume(latestFrame)) {
      setScore((s) => registerHit(s));
      silenceRef.current = 0;
      return;
    }

    // Track silence to break the combo after a sustained gap.
    const silent = latestFrame.rms < 0.01;
    silenceRef.current = silent ? silenceRef.current + 1 : 0;
    if (silenceRef.current === SILENCE_BREAK_FRAMES) {
      setScore((s) => (s.combo > 0 ? breakCombo(s) : s));
    }
  }, [latestFrame]);

  return score;
}
