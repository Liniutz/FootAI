/**
 * React hook computing performance flow from telemetry (spec Task 14, track E).
 *
 * Maintains a rolling window of recent telemetry frames, recomputes flow on
 * each new frame, smooths it to avoid jitter, and writes flow + mood into the
 * store. Returns the latest `FlowResult`.
 */
import { useEffect, useRef, useState } from "react";
import { useVisualizerStore } from "../store";
import { computeFlow, FLOW_WINDOW, type FlowResult } from "./flow";

/** Exponential smoothing factor for the flow value (0..1; higher = snappier). */
const SMOOTHING = 0.25;

const INITIAL: FlowResult = {
  flow: 0,
  energy: 0,
  pitchStability: 0,
  tempoSteadiness: 0,
  mood: "idle",
};

export function useFlow(): FlowResult {
  const latestFrame = useVisualizerStore((s) => s.latestFrame);
  const setFlow = useVisualizerStore((s) => s.setFlow);
  const windowRef = useRef<Parameters<typeof computeFlow>[0]>([]);
  const smoothedRef = useRef(0);
  const [result, setResult] = useState<FlowResult>(INITIAL);

  useEffect(() => {
    if (!latestFrame) return;
    const win = windowRef.current;
    win.push(latestFrame);
    if (win.length > FLOW_WINDOW) win.shift();

    const raw = computeFlow(win);
    // Smooth the flow value; mood follows the smoothed value's energy gate.
    smoothedRef.current =
      smoothedRef.current + (raw.flow - smoothedRef.current) * SMOOTHING;
    const smoothed: FlowResult = { ...raw, flow: smoothedRef.current };

    setResult(smoothed);
    setFlow(smoothed.flow, smoothed.mood);
  }, [latestFrame, setFlow]);

  return result;
}
