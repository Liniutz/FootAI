/**
 * React hook managing a single `AudioCapture` lifecycle (spec Task 6, Lane C).
 *
 * Exposes an imperative `start()` (call from a user gesture) and `stop()`, the
 * live `AnalyserNode`, and mirrors the capture status into the store's
 * `audioStatus`. Cleans up the capture graph on unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useVisualizerStore } from "../store";
import { AudioCapture, type MediaProvider } from "./capture";

export interface UseAudioCapture {
  /** Start capture (invoke from a click/tap handler). */
  start: () => Promise<void>;
  /** Stop capture and release resources. */
  stop: () => Promise<void>;
  /** The live analyser while active, else null. */
  analyser: AnalyserNode | null;
}

export function useAudioCapture(media?: MediaProvider): UseAudioCapture {
  const setAudioStatus = useVisualizerStore((s) => s.setAudioStatus);
  const captureRef = useRef<AudioCapture | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const stop = useCallback(async () => {
    const capture = captureRef.current;
    captureRef.current = null;
    setAnalyser(null);
    if (capture) await capture.stop();
    setAudioStatus("idle");
  }, [setAudioStatus]);

  const start = useCallback(async () => {
    // Replace any prior capture before starting a new one.
    if (captureRef.current) {
      await captureRef.current.stop();
      captureRef.current = null;
    }
    setAudioStatus("requesting");
    const capture = new AudioCapture(media);
    captureRef.current = capture;
    const result = await capture.start();
    setAudioStatus(result.status);
    if (result.status === "active") {
      setAnalyser(result.analyser);
    } else {
      setAnalyser(null);
      captureRef.current = null;
      await capture.stop();
    }
  }, [media, setAudioStatus]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      const capture = captureRef.current;
      captureRef.current = null;
      if (capture) void capture.stop();
    };
  }, []);

  return { start, stop, analyser };
}
