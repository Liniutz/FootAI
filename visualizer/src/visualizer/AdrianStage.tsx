/**
 * Center-stage pixel-art Adrian Barar (spec Task 15, track E).
 *
 * Supplied Adrian PNG poses follow `PerformanceMood`; glow and motion scale
 * with flow, and guitar onsets trigger a pulse. PixiJS and the shared RenderLoop
 * keep rendering independent from React.
 */
import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import { useVisualizerStore } from "../store";
import { RenderLoop } from "./renderLoop";
import {
  animationForMood,
  effectsForFlow,
  MOOD_COLORS,
} from "./adrian";
import { OnsetTracker } from "./noteVisuals";

const SPRITE_URLS = {
  idle: "/sprites/adrian/BararIdle.png",
  warming: "/sprites/adrian/BararAccording.png",
  playing: "/sprites/adrian/BararBrother.png",
  hyped: "/sprites/adrian/BararHyped.png",
  slump: "/sprites/adrian/BararObo.png",
} as const;

async function loadSprites(): Promise<Record<keyof typeof SPRITE_URLS, Texture>> {
  const entries = await Promise.all(
    Object.entries(SPRITE_URLS).map(async ([mood, url]) => {
      const texture = await Assets.load<Texture>(url);
      if (texture.source) {
        texture.source.scaleMode = "nearest";
      }
      return [mood, texture] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<keyof typeof SPRITE_URLS, Texture>;
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
    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    const glowLayer = new Graphics();
    let sprites: Record<keyof typeof SPRITE_URLS, Texture> | null = null;
    const onset = new OnsetTracker();
    const loop = new RenderLoop({ onFrame: draw });

    container.addChild(glowLayer);
    container.addChild(sprite);

    let lastMood = "idle";
    let pulse = 0;

    function draw(tsMs: number) {
      const width = app.renderer?.width ?? host!.clientWidth;
      const height = app.renderer?.height ?? host!.clientHeight;
      if (width <= 0 || height <= 0) return;

      const { mood, flow, latestFrame } = useVisualizerStore.getState();
      const anim = animationForMood(mood);
      const fx = effectsForFlow(flow);

      if (sprites && mood !== lastMood) {
        sprite.texture = sprites[mood];
        lastMood = mood;
      }

      // Onset pulse.
      if (latestFrame && onset.consume(latestFrame)) {
        pulse = 1;
      }
      pulse = Math.max(0, pulse - 0.06);

      // Center the container; apply bob + onset shake (unless reduced motion).
      const bob = reduceMotion
        ? 0
        : Math.sin((tsMs / 1000) * anim.fps) * anim.bobAmplitude;
      const shake = reduceMotion ? 0 : pulse * fx.shake;
      const pulseScale = 1 + pulse * 0.08;
      container.x = width / 2 + (Math.random() - 0.5) * shake;
      container.y = height / 2 + bob;

      // Scale sprite only once a valid texture is loaded (avoid divide-by-zero).
      const texW = sprite.texture.width;
      const texH = sprite.texture.height;
      if (texW > 0 && texH > 0) {
        const fitScale = Math.min((width * 0.85) / texW, (height * 0.94) / texH);
        sprite.scale.set(fitScale * pulseScale);
      }

      // Glow layer behind the sprite (unscaled at container center).
      glowLayer.clear();
      if (fx.glow > 0) {
        const baseRadius = Math.min(width, height) * 0.24;
        glowLayer.circle(0, 0, baseRadius + fx.glow);
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
        app.stage.addChild(container);
        host.appendChild(app.canvas);
        void loadSprites()
          .then((textures) => {
            if (disposed) return;
            sprites = textures;
            const currentMood = useVisualizerStore.getState().mood;
            sprite.texture = textures[currentMood] ?? textures.idle;
            lastMood = currentMood;
          })
          .catch(() => {
            /* Keep the stage empty if supplied artwork cannot be loaded. */
          });
        loop.start();
      })
      .catch(() => {
        /* headless/unsupported: fail quietly */
      });

    return () => {
      disposed = true;
      loop.stop();
      try {
        // Never destroy cached Assets textures here so StrictMode remounts keep them valid.
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
