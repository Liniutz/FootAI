/**
 * Center-stage pixel-art Adrian Barar (spec Task 15, track E).
 *
 * Placeholder procedural pixel sprite that plays along: animation speed/bob
 * follow `PerformanceMood`; glow/tint scale with flow; onsets trigger a pulse.
 * Rendered with PixiJS and driven by the shared RenderLoop (decoupled from
 * React). Swap the `drawAdrian` body for real sprite-sheet frames later.
 */
import { useEffect, useRef } from "react";
import { Application, Container, Graphics } from "pixi.js";
import { useVisualizerStore } from "../store";
import { RenderLoop } from "./renderLoop";
import {
  animationForMood,
  effectsForFlow,
  MOOD_COLORS,
} from "./adrian";
import { OnsetTracker } from "./noteVisuals";

/** Draw a tiny placeholder pixel figure "holding a guitar" into a container. */
function drawAdrian(g: Graphics, bodyColor: number): void {
  g.clear();
  const px = 10; // pixel size
  const draw = (cx: number, cy: number, color: number) => {
    g.rect(cx * px, cy * px, px, px);
    g.fill({ color });
  };
  // Head
  for (let x = 3; x <= 5; x++) draw(x, 0, 0xf1c27d);
  for (let x = 3; x <= 5; x++) draw(x, 1, 0xf1c27d);
  // Hair
  for (let x = 3; x <= 5; x++) draw(x, -1, 0x2a211b);
  // Body
  for (let y = 2; y <= 4; y++) for (let x = 3; x <= 5; x++) draw(x, y, bodyColor);
  // Arms
  draw(2, 3, bodyColor);
  draw(6, 3, bodyColor);
  // Guitar (diagonal accent)
  draw(6, 4, 0x8b4513);
  draw(7, 5, 0x8b4513);
}

export function AdrianStage() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let disposed = false;
    const app = new Application();
    const container = new Container();
    const sprite = new Graphics();
    const glowLayer = new Graphics();
    const onset = new OnsetTracker();
    const loop = new RenderLoop({ onFrame: draw });

    container.addChild(glowLayer);
    container.addChild(sprite);

    let lastMood = "idle";
    let pulse = 0;

    function draw(tsMs: number) {
      const width = app.renderer?.width ?? host!.clientWidth;
      const height = app.renderer?.height ?? host!.clientHeight;
      const { mood, flow, latestFrame } = useVisualizerStore.getState();
      const anim = animationForMood(mood);
      const fx = effectsForFlow(flow);

      if (mood !== lastMood) {
        drawAdrian(sprite, MOOD_COLORS[mood]);
        lastMood = mood;
      }

      // Onset pulse.
      if (latestFrame && onset.consume(latestFrame)) {
        pulse = 1;
      }
      pulse = Math.max(0, pulse - 0.06);

      // Center the sprite; apply bob + onset shake (unless reduced motion).
      const bob = reduceMotion
        ? 0
        : Math.sin((tsMs / 1000) * anim.fps) * anim.bobAmplitude;
      const shake = reduceMotion ? 0 : pulse * fx.shake;
      const scale = 1 + pulse * 0.08;
      container.x = width / 2 - 40 * scale + (Math.random() - 0.5) * shake;
      container.y = height / 2 - 30 * scale + bob;
      container.scale.set(scale);

      // Glow layer behind the sprite.
      glowLayer.clear();
      if (fx.glow > 0) {
        glowLayer.circle(40, 30, 30 + fx.glow);
        glowLayer.fill({ color: MOOD_COLORS[mood], alpha: 0.12 + flow * 0.2 });
      }
    }

    void app
      .init({ resizeTo: host, antialias: false, backgroundAlpha: 0 })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        drawAdrian(sprite, MOOD_COLORS.idle);
        app.stage.addChild(container);
        host.appendChild(app.canvas);
        loop.start();
      })
      .catch(() => {
        /* headless/unsupported: fail quietly */
      });

    return () => {
      disposed = true;
      loop.stop();
      try {
        app.destroy(true, { children: true });
      } catch {
        /* ignore teardown errors */
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="adrian-stage"
      role="img"
      aria-label="Adrian Barar playing along"
    />
  );
}
