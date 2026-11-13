/**
 * Cross-window live sync (spec Task 1 / decision: two separate windows).
 *
 * The Menu window and the Visualizer window are two separate browser windows
 * from ONE dev-server instance (one per screen). They share the user's
 * `selection` in real time via the BroadcastChannel API — no backend, pure
 * client-side, consistent with the "local app state only" spec decision.
 *
 * Each window keeps its own Zustand store; this module mirrors `selection`
 * writes out to the channel and applies inbound updates back into the store,
 * guarding against echo loops.
 */
import type { SessionSelection } from "./types";
import { useVisualizerStore } from "./store";

const CHANNEL_NAME = "cyberjam-visualizer";

type SyncMessage = {
  type: "selection";
  payload: SessionSelection;
  /** Per-instance sender id so a window ignores its own echoed messages. */
  origin: string;
};

/** BroadcastChannel is unavailable in some test/SSR envs; degrade gracefully. */
function createChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

export interface SelectionSync {
  /** Publish a local selection change to the other window. */
  publish: (selection: SessionSelection) => void;
  /** Stop listening and close the channel. */
  dispose: () => void;
}

/**
 * Wire the store's `selection` to a BroadcastChannel so both windows stay in
 * sync. Returns a handle used to publish local changes and to tear down.
 *
 * `applyRemote` lets callers inject a custom applier in tests; by default it
 * writes straight into the shared store.
 */
export function startSelectionSync(
  applyRemote: (selection: SessionSelection) => void = (selection) =>
    useVisualizerStore.getState().setSelection(selection),
): SelectionSync {
  const channel = createChannel();
  // Per-instance id: in production each window is its own JS context, so this
  // uniquely identifies the sender and lets a window drop its own echoes.
  const originId = Math.random().toString(36).slice(2);

  if (channel) {
    channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const data = event.data;
      if (!data || data.type !== "selection") return;
      if (data.origin === originId) return; // ignore our own echo
      applyRemote(data.payload);
    };
  }

  return {
    publish: (selection) => {
      channel?.postMessage({
        type: "selection",
        payload: selection,
        origin: originId,
      } satisfies SyncMessage);
    },
    dispose: () => {
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// React integration
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";

/**
 * Hook that keeps this window's `selection` in sync with the other window.
 *
 * - Applies inbound remote selections into the store.
 * - Publishes local selection changes out to the channel.
 *
 * A ref guards the publish path so applying a remote update does not
 * immediately re-broadcast it (which the origin check would drop anyway, but
 * this avoids needless chatter).
 */
export function useSelectionSync(): void {
  const applyingRemote = useRef(false);
  const syncRef = useRef<SelectionSync | null>(null);

  useEffect(() => {
    const sync = startSelectionSync((selection) => {
      applyingRemote.current = true;
      useVisualizerStore.getState().setSelection(selection);
      applyingRemote.current = false;
    });
    syncRef.current = sync;

    // Publish subsequent local selection changes to the other window.
    const unsubscribe = useVisualizerStore.subscribe((state, prev) => {
      if (state.selection === prev.selection) return;
      if (applyingRemote.current) return;
      sync.publish(state.selection);
    });

    return () => {
      unsubscribe();
      sync.dispose();
      syncRef.current = null;
    };
  }, []);
}
