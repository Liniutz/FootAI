/** Spec Task 7 tests: pure transforms + RAF loop control. */
import { describe, expect, it, vi } from "vitest";
import { timeDomainToPoints, frequencyToBars } from "./waveform";
import { RenderLoop } from "./renderLoop";

describe("timeDomainToPoints", () => {
  it("returns empty for empty/zero-size inputs", () => {
    expect(timeDomainToPoints(new Uint8Array(0), 100, 100)).toEqual([]);
    expect(timeDomainToPoints(new Uint8Array(4), 0, 100)).toEqual([]);
  });

  it("maps silence (128) to the vertical midline", () => {
    const buf = new Uint8Array([128, 128, 128]);
    const pts = timeDomainToPoints(buf, 100, 200);
    expect(pts.every((p) => p.y === 100)).toBe(true);
    expect(pts[0].x).toBe(0);
    expect(pts[2].x).toBe(100);
  });

  it("maps extremes to top and bottom", () => {
    const buf = new Uint8Array([255, 0]);
    const pts = timeDomainToPoints(buf, 100, 200);
    // 255 -> above midline (smaller y), 0 -> below midline (larger y)
    expect(pts[0].y).toBeLessThan(100);
    expect(pts[1].y).toBeGreaterThan(100);
  });
});

describe("frequencyToBars", () => {
  it("downsamples bins into bar heights", () => {
    const buf = new Uint8Array([255, 255, 0, 0]);
    const bars = frequencyToBars(buf, 2, 100);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toBeCloseTo(100); // avg 255 -> full height
    expect(bars[1]).toBeCloseTo(0);
  });

  it("returns empty for invalid args", () => {
    expect(frequencyToBars(new Uint8Array(0), 4, 100)).toEqual([]);
    expect(frequencyToBars(new Uint8Array(4), 0, 100)).toEqual([]);
  });
});

describe("RenderLoop", () => {
  it("starts and stops the RAF loop", () => {
    let handle = 0;
    const scheduled = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.fn((cb: FrameRequestCallback) => {
      handle += 1;
      scheduled.set(handle, cb);
      return handle;
    });
    const cancelFrame = vi.fn((h: number) => scheduled.delete(h));
    const onFrame = vi.fn();

    const loop = new RenderLoop({ onFrame, requestFrame, cancelFrame });
    expect(loop.isRunning()).toBe(false);

    loop.start();
    expect(loop.isRunning()).toBe(true);
    expect(requestFrame).toHaveBeenCalledTimes(1);

    // Drive one frame manually.
    const firstCb = scheduled.get(1)!;
    firstCb(16);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(requestFrame).toHaveBeenCalledTimes(2); // re-scheduled next frame

    loop.stop();
    expect(loop.isRunning()).toBe(false);
    expect(cancelFrame).toHaveBeenCalled();
  });

  it("start() is idempotent", () => {
    const requestFrame = vi.fn(() => 1);
    const loop = new RenderLoop({
      onFrame: () => {},
      requestFrame,
      cancelFrame: () => {},
    });
    loop.start();
    loop.start();
    expect(requestFrame).toHaveBeenCalledTimes(1);
  });
});
