/** Tests for cross-window selection sync (BroadcastChannel). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSelectionSync } from "./sync";
import { INITIAL_SELECTION, useVisualizerStore } from "./store";
import type { SessionSelection } from "./types";

/**
 * Minimal in-memory BroadcastChannel mock: all instances on the same name
 * share a registry and deliver messages to every *other* instance.
 */
class MockBroadcastChannel {
  static registry = new Map<string, Set<MockBroadcastChannel>>();
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(public name: string) {
    const set = MockBroadcastChannel.registry.get(name) ?? new Set();
    set.add(this);
    MockBroadcastChannel.registry.set(name, set);
  }

  postMessage(data: unknown) {
    const peers = MockBroadcastChannel.registry.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === this) continue;
      peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close() {
    MockBroadcastChannel.registry.get(this.name)?.delete(this);
  }
}

describe("startSelectionSync", () => {
  beforeEach(() => {
    MockBroadcastChannel.registry.clear();
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    useVisualizerStore.setState({ selection: INITIAL_SELECTION });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers a published selection to the other window's applier", () => {
    const applied: SessionSelection[] = [];
    const windowA = startSelectionSync(() => {});
    const windowB = startSelectionSync((sel) => applied.push(sel));

    const selection: SessionSelection = {
      songId: "cargo-song",
      instrumentIds: ["drums", "bass"],
    };
    windowA.publish(selection);

    expect(applied).toEqual([selection]);

    windowA.dispose();
    windowB.dispose();
  });

  it("does not deliver a window's own published message back to itself", () => {
    const applied: SessionSelection[] = [];
    const windowA = startSelectionSync((sel) => applied.push(sel));

    windowA.publish({ songId: "x", instrumentIds: [] });

    expect(applied).toEqual([]);
    windowA.dispose();
  });

  it("applies a remote selection into the store by default", () => {
    const sender = startSelectionSync(() => {});
    const receiver = startSelectionSync(); // default applier -> store

    sender.publish({ songId: "cargo-song", instrumentIds: ["synth"] });

    expect(useVisualizerStore.getState().selection).toEqual({
      songId: "cargo-song",
      instrumentIds: ["synth"],
    });

    sender.dispose();
    receiver.dispose();
  });

  it("degrades gracefully when BroadcastChannel is unavailable", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const sync = startSelectionSync();
    // Should not throw with no channel present.
    expect(() =>
      sync.publish({ songId: null, instrumentIds: [] }),
    ).not.toThrow();
    sync.dispose();
  });
});
