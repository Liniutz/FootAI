/** Dev mock feed tests: URL gating + store-driving + teardown. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMockEnabled, startMockFeed } from "./mockFeed";
import { useVisualizerStore } from "../store";

describe("isMockEnabled", () => {
  it("is on for ?mock and ?mock=1, off otherwise", () => {
    expect(isMockEnabled("?mock")).toBe(true);
    expect(isMockEnabled("?mock=1")).toBe(true);
    expect(isMockEnabled("?mock=0")).toBe(false);
    expect(isMockEnabled("")).toBe(false);
    expect(isMockEnabled("?other=1")).toBe(false);
  });
});

describe("startMockFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useVisualizerStore.setState({
      latestFrame: null,
      connectionStatus: "connecting",
      midiStatus: "idle",
      bandEvents: [],
    });
  });
  afterEach(() => vi.useRealTimers());

  it("flips statuses to a healthy live state", () => {
    const feed = startMockFeed();
    const s = useVisualizerStore.getState();
    expect(s.connectionStatus).toBe("open");
    expect(s.midiStatus).toBe("active");
    feed.stop();
  });

  it("pushes telemetry frames and band events over time", () => {
    const feed = startMockFeed();
    vi.advanceTimersByTime(500);

    const s = useVisualizerStore.getState();
    expect(s.latestFrame).not.toBeNull();
    expect(s.latestFrame?.detected_pitch.note).toMatch(/^[A-G]#?\d$/);
    expect(s.bandEvents.length).toBeGreaterThan(0);
    // All three roles should appear.
    const roles = new Set(s.bandEvents.map((e) => e.role));
    expect(roles.has("drums")).toBe(true);
    expect(roles.has("bass")).toBe(true);
    expect(roles.has("cc")).toBe(true);
    feed.stop();
  });

  it("stops producing after teardown", () => {
    const feed = startMockFeed();
    vi.advanceTimersByTime(200);
    feed.stop();
    const countAfterStop = useVisualizerStore.getState().bandEvents.length;
    const frameAfterStop = useVisualizerStore.getState().latestFrame;

    vi.advanceTimersByTime(2000);
    expect(useVisualizerStore.getState().bandEvents.length).toBe(countAfterStop);
    expect(useVisualizerStore.getState().latestFrame).toBe(frameAfterStop);
  });
});
