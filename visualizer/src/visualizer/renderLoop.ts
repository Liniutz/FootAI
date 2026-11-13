/**
 * Minimal requestAnimationFrame loop controller (spec Task 7).
 *
 * Decouples the render loop from React re-renders and is unit-testable by
 * injecting a RAF-compatible scheduler. `start()` runs `onFrame` once per
 * animation frame until `stop()`.
 */
export type RafScheduler = (cb: FrameRequestCallback) => number;
export type RafCanceller = (handle: number) => void;

export interface RenderLoopOptions {
  onFrame: (timestampMs: number) => void;
  requestFrame?: RafScheduler;
  cancelFrame?: RafCanceller;
}

export class RenderLoop {
  private readonly onFrame: (timestampMs: number) => void;
  private readonly requestFrame: RafScheduler;
  private readonly cancelFrame: RafCanceller;
  private handle: number | null = null;
  private running = false;

  constructor(opts: RenderLoopOptions) {
    this.onFrame = opts.onFrame;
    this.requestFrame =
      opts.requestFrame ??
      ((cb) => requestAnimationFrame(cb));
    this.cancelFrame =
      opts.cancelFrame ?? ((h) => cancelAnimationFrame(h));
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick: FrameRequestCallback = (ts) => {
      if (!this.running) return;
      this.onFrame(ts);
      this.handle = this.requestFrame(tick);
    };
    this.handle = this.requestFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) {
      this.cancelFrame(this.handle);
      this.handle = null;
    }
  }
}
