import { useEffect, useRef } from "react";
import type { SessionSelection, TelemetryFrame } from "./types";
import { useVisualizerStore } from "./store";

const CHANNEL_NAME = "cyberjam-visualizer";
type SyncMessage =
  | { type: "selection"; payload: SessionSelection; origin: string }
  | { type: "telemetry"; payload: TelemetryFrame; origin: string };

function createChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
}

function selectionsEqual(a: SessionSelection, b: SessionSelection): boolean {
  return (
    a.songId === b.songId &&
    a.mode === b.mode &&
    a.instrumentIds.length === b.instrumentIds.length &&
    a.instrumentIds.every((id, i) => id === b.instrumentIds[i])
  );
}

export interface SelectionSync {
  publish(selection: SessionSelection): void;
  publishTelemetry(frame: TelemetryFrame): void;
  dispose(): void;
}

export function startSelectionSync(
  applyRemote: (selection: SessionSelection) => void = (selection) => useVisualizerStore.getState().setSelection(selection),
  applyRemoteTelemetry: (frame: TelemetryFrame) => void = (frame) => useVisualizerStore.getState().setLatestFrame(frame),
): SelectionSync {
  const channel = createChannel();
  const originId = Math.random().toString(36).slice(2);
  if (channel) {
    channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const data = event.data;
      if (!data || data.origin === originId) return;
      if (data.type === "selection") applyRemote(data.payload);
      else if (data.type === "telemetry") applyRemoteTelemetry(data.payload);
    };
  }
  return {
    publish: (payload) => channel?.postMessage({ type: "selection", payload, origin: originId } satisfies SyncMessage),
    publishTelemetry: (payload) => channel?.postMessage({ type: "telemetry", payload, origin: originId } satisfies SyncMessage),
    dispose: () => {
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
    },
  };
}

let activeWindowSync: SelectionSync | null = null;

/** Forward a locally-received telemetry frame to the peer window on the single window channel. */
export function publishTelemetryToPeer(frame: TelemetryFrame): void {
  activeWindowSync?.publishTelemetry(frame);
}

export function useSelectionSync(): void {
  const applyingRemote = useRef(false);
  useEffect(() => {
    const sync = startSelectionSync(
      (selection) => {
        const current = useVisualizerStore.getState().selection;
        if (selectionsEqual(current, selection)) return;
        applyingRemote.current = true;
        useVisualizerStore.getState().setSelection(selection);
        applyingRemote.current = false;
      },
      (frame) => {
        // Only use peer telemetry when this window's own engine WebSocket is not open,
        // avoiding duplicate frame processing in useFlow / NotePitchPanel.
        if (useVisualizerStore.getState().connectionStatus === "open") return;
        applyingRemote.current = true;
        useVisualizerStore.getState().setLatestFrame(frame);
        applyingRemote.current = false;
      },
    );
    activeWindowSync = sync;
    const unsubscribe = useVisualizerStore.subscribe((state, prev) => {
      if (applyingRemote.current) return;
      if (!selectionsEqual(state.selection, prev.selection)) {
        sync.publish(state.selection);
      }
    });
    return () => {
      if (activeWindowSync === sync) activeWindowSync = null;
      unsubscribe();
      sync.dispose();
    };
  }, []);
}
