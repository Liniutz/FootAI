/**
 * Note & pitch panel (spec Task 8, Lane C).
 *
 * Renders the currently detected note, a pitch-position marker, an onset pulse,
 * and a short pitch-history trail. Driven by the store's `latestFrame`.
 */
import { useEffect, useRef, useState } from "react";
import { useVisualizerStore } from "../store";
import {
  frameToNoteVisual,
  OnsetTracker,
  PitchHistory,
  type NoteVisual,
  type PitchSample,
} from "./noteVisuals";

export function NotePitchPanel() {
  const latestFrame = useVisualizerStore((s) => s.latestFrame);
  const [visual, setVisual] = useState<NoteVisual | null>(null);
  const [pulse, setPulse] = useState(false);
  const [trail, setTrail] = useState<PitchSample[]>([]);

  const onsetRef = useRef(new OnsetTracker());
  const historyRef = useRef(new PitchHistory(64));
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!latestFrame) return;
    const v = frameToNoteVisual(latestFrame);
    setVisual(v);

    if (v.active) {
      historyRef.current.push({
        position: v.position,
        intensity: v.intensity,
        color: v.color,
      });
      setTrail(historyRef.current.toArray());
    }

    if (onsetRef.current.consume(latestFrame)) {
      setPulse(true);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulse(false), 120);
    }
  }, [latestFrame]);

  useEffect(() => {
    return () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    };
  }, []);

  const active = visual?.active ?? false;

  return (
    <section
      aria-label="Note and pitch"
      className={`note-panel${pulse ? " note-panel--onset" : ""}`}
    >
      <div className="note-panel__readout">
        <span className="note-panel__note" data-testid="note-name">
          {active ? visual!.note : "—"}
        </span>
        <span className="note-panel__key">
          {active ? `key ${visual!.key}` : "silent"}
        </span>
      </div>

      <div className="note-panel__track" aria-hidden="true">
        {/* pitch-history trail */}
        {trail.map((s, i) => (
          <span
            key={i}
            className="note-panel__trail-dot"
            style={{
              bottom: `${s.position * 100}%`,
              opacity: 0.15 + (i / Math.max(1, trail.length)) * 0.85,
              background: s.color,
            }}
          />
        ))}
        {/* current marker */}
        {active && (
          <span
            className="note-panel__marker"
            data-testid="pitch-marker"
            style={{
              bottom: `${visual!.position * 100}%`,
              background: visual!.color,
              boxShadow: `0 0 ${8 + visual!.intensity * 24}px ${visual!.color}`,
            }}
          />
        )}
      </div>
    </section>
  );
}
