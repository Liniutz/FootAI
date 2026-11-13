/**
 * React hook wrapping `BandMidiClient` (spec Task 12, track E).
 *
 * Starts Web MIDI on a user gesture (`start()`), pushes parsed band events and
 * status into the store, and tears down on unmount.
 */
import { useCallback, useEffect, useRef } from "react";
import { useVisualizerStore } from "../store";
import { BandMidiClient, type MidiProvider } from "./band";

export interface UseBandMidi {
  start: () => Promise<void>;
  stop: () => void;
}

export function useBandMidi(provider?: MidiProvider): UseBandMidi {
  const pushBandEvent = useVisualizerStore((s) => s.pushBandEvent);
  const setMidiStatus = useVisualizerStore((s) => s.setMidiStatus);
  const clientRef = useRef<BandMidiClient | null>(null);

  const stop = useCallback(() => {
    clientRef.current?.stop();
    clientRef.current = null;
    setMidiStatus("idle");
  }, [setMidiStatus]);

  const start = useCallback(async () => {
    clientRef.current?.stop();
    const client = new BandMidiClient({
      provider,
      onEvent: pushBandEvent,
      onStatus: setMidiStatus,
    });
    clientRef.current = client;
    await client.start();
  }, [provider, pushBandEvent, setMidiStatus]);

  useEffect(() => {
    return () => {
      clientRef.current?.stop();
      clientRef.current = null;
    };
  }, []);

  return { start, stop };
}
