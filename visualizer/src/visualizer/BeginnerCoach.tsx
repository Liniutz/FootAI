/**
 * Beginner-mode coach: chord diagrams + osu!-style approach circle.
 *
 * Shows the current bar's chord diagram and a preview of the next chord, next
 * to a static target circle with a shrinking "approach circle". The approach
 * circle contracts in time with the selected song's reference BPM (4/4) and
 * converges onto the target exactly on Beat 1 of each bar. On each bar
 * boundary the progression advances and the circle resets.
 *
 * Timing feedback replaces an audio cue: when the player strums (telemetry
 * `onset`), the target flashes green (perfect/good), yellow (ok), or red
 * (miss) based on how close the strum was to Beat 1.
 *
 * The animation runs on a RenderLoop and writes the circle radius straight to
 * the SVG via a ref, so it does not re-render React every frame. Only discrete
 * changes (bar advance, verdict flash) use React state.
 */
import { useEffect, useRef, useState } from "react";
import { useVisualizerStore } from "../store";
import { getSongById } from "../data/catalog";
import { RenderLoop } from "./renderLoop";
import { OnsetTracker } from "./noteVisuals";
import { ChordDiagram } from "./ChordDiagram";
import { chordForBar } from "./chords";
import {
  approachRadiusFraction,
  barPhase,
  judgeStrum,
  VERDICT_COLOR,
  type HitVerdict,
} from "./beatClock";

const TARGET_R = 46; // px, static target circle radius
const START_R = 120; // px, approach circle radius at Beat 1 start

export function BeginnerCoach() {
  const selection = useVisualizerStore((s) => s.selection);
  const songId = selection.songId;

  // Tempo comes from the song's reference BPM (deterministic, engine-less).
  const bpm = (songId && getSongById(songId)?.referenceBpm) || 120;

  const [barIndex, setBarIndex] = useState(0);
  const [verdict, setVerdict] = useState<HitVerdict | null>(null);

  const approachRef = useRef<SVGCircleElement | null>(null);
  const targetRef = useRef<SVGCircleElement | null>(null);
  const startRef = useRef<number>(performance.now());
  const lastBarRef = useRef<number>(0);
  const verdictTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animate the approach circle from the local beat clock.
  useEffect(() => {
    startRef.current = performance.now();
    lastBarRef.current = 0;
    setBarIndex(0);

    const loop = new RenderLoop({
      onFrame: (now) => {
        const elapsed = now - startRef.current;
        const phase = barPhase(elapsed, bpm);

        const frac = approachRadiusFraction(phase.barProgress);
        const r = TARGET_R + (START_R - TARGET_R) * frac;
        approachRef.current?.setAttribute("r", String(r));

        if (phase.barIndex !== lastBarRef.current) {
          lastBarRef.current = phase.barIndex;
          setBarIndex(phase.barIndex);
        }
      },
    });
    loop.start();
    return () => loop.stop();
  }, [bpm]);

  // Judge strums (onset) against the beat clock and flash the target.
  const latestFrame = useVisualizerStore((s) => s.latestFrame);
  const onsetRef = useRef(new OnsetTracker());
  useEffect(() => {
    if (!latestFrame) return;
    if (!onsetRef.current.consume(latestFrame)) return;

    const elapsed = performance.now() - startRef.current;
    const v = judgeStrum(elapsed, bpm);
    setVerdict(v);
    const color = VERDICT_COLOR[v];
    targetRef.current?.setAttribute("stroke", color);

    if (verdictTimer.current) clearTimeout(verdictTimer.current);
    verdictTimer.current = setTimeout(() => {
      setVerdict(null);
      targetRef.current?.setAttribute("stroke", "#5a6b86");
    }, 450);
  }, [latestFrame, bpm]);

  useEffect(
    () => () => {
      if (verdictTimer.current) clearTimeout(verdictTimer.current);
    },
    [],
  );

  const currentChord = chordForBar(songId, barIndex);
  const nextChord = chordForBar(songId, barIndex + 1);

  const viewSize = START_R * 2 + 8;
  const center = viewSize / 2;

  return (
    <section className="beginner-coach" aria-label="Beginner coach">
      <div className="beginner-coach__chords">
        <ChordDiagram chord={currentChord} />
        <ChordDiagram chord={nextChord} preview />
      </div>

      <div className="beginner-coach__approach">
        <svg
          width={viewSize}
          height={viewSize}
          viewBox={`0 0 ${viewSize} ${viewSize}`}
          role="img"
          aria-label="Timing approach circle"
        >
          {/* Static target ring. */}
          <circle
            ref={targetRef}
            cx={center}
            cy={center}
            r={TARGET_R}
            fill="none"
            stroke="#5a6b86"
            strokeWidth={4}
            data-testid="target-circle"
          />
          {/* Shrinking approach ring. */}
          <circle
            ref={approachRef}
            cx={center}
            cy={center}
            r={START_R}
            fill="none"
            stroke="#6ee7ff"
            strokeWidth={3}
            opacity={0.85}
            data-testid="approach-circle"
          />
          {/* Center chord name. */}
          <text
            x={center}
            y={center}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={22}
            fontWeight={700}
            fill="#e8eef7"
            fontFamily="var(--font-heading, sans-serif)"
          >
            {currentChord.name}
          </text>
        </svg>
        <p
          className="beginner-coach__verdict"
          data-testid="coach-verdict"
          style={verdict ? { color: VERDICT_COLOR[verdict] } : undefined}
          aria-live="polite"
        >
          {verdict ? verdict.toUpperCase() : "Strum on the beat"}
        </p>
      </div>
    </section>
  );
}
