/**
 * PixiJS waveform render surface (spec Task 7, Lane C).
 *
 * Reads the AnalyserNode's time-domain buffer every animation frame and draws
 * a live waveform with a Pixi `Graphics` object. The RAF loop reads analyser
 * data directly (not via React state) so rendering is decoupled from
 * re-renders. All Pixi/GL resources and the loop are torn down on unmount.
 */
import { useEffect, useRef } from "react";
import { Application, Graphics } from "pixi.js";
import { RenderLoop } from "./renderLoop";
import { timeDomainToPoints } from "./waveform";

export interface WaveformCanvasProps {
  /** Live analyser; when null the surface renders an idle baseline. */
  analyser: AnalyserNode | null;
  /** Stroke color for the waveform (CSS hex). Defaults to white. */
  color?: number;
}

export function WaveformCanvas({
  analyser,
  color = 0xffffff,
}: WaveformCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const app = new Application();
    const graphics = new Graphics();
    const loop = new RenderLoop({ onFrame: draw });

    // Reusable buffer sized to the analyser (or a default) to avoid per-frame
    // allocation in the render callback.
    let buffer = new Uint8Array(analyser ? analyser.fftSize : 2048);

    function draw() {
      const width = app.renderer?.width ?? host!.clientWidth;
      const height = app.renderer?.height ?? host!.clientHeight;
      graphics.clear();

      if (analyser) {
        if (buffer.length !== analyser.fftSize) {
          buffer = new Uint8Array(analyser.fftSize);
        }
        analyser.getByteTimeDomainData(buffer);
        const points = timeDomainToPoints(buffer, width, height);
        if (points.length > 1) {
          graphics.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            graphics.lineTo(points[i].x, points[i].y);
          }
          graphics.stroke({ width: 2, color });
        }
      } else {
        // Idle baseline.
        graphics.moveTo(0, height / 2);
        graphics.lineTo(width, height / 2);
        graphics.stroke({ width: 1, color: 0x334155 });
      }
    }

    void app
      .init({
        resizeTo: host,
        antialias: true,
        backgroundAlpha: 0,
      })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        app.stage.addChild(graphics);
        host.appendChild(app.canvas);
        loop.start();
      })
      .catch(() => {
        // Pixi/WebGL init can fail in headless/unsupported envs; fail quietly.
      });

    return () => {
      disposed = true;
      loop.stop();
      // destroy(true) also removes the canvas from the DOM.
      try {
        app.destroy(true, { children: true });
      } catch {
        // ignore teardown errors
      }
    };
  }, [analyser, color]);

  return (
    <div
      ref={hostRef}
      className="waveform-canvas"
      role="img"
      aria-label="Live audio waveform"
    />
  );
}
