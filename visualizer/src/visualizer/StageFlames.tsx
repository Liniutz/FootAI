/**
 * Side-stage pyrotechnic flames for the TV Visualizer.
 *
 * Renders glowing amber/crimson flame jets and rising embers along the left and
 * right edges of the stage using a lightweight 2D canvas driven by RenderLoop.
 * Intensity scales smoothly with `flow` and flares on guitar onsets, while
 * keeping an atmospheric baseline glow when idle.
 */
import { useEffect, useRef } from "react";
import { useVisualizerStore } from "../store";
import { RenderLoop } from "./renderLoop";
import { clamp, OnsetTracker } from "./noteVisuals";

export interface FlameProfile {
  /** Normalized flame reach/intensity (0.35..1.0). */
  intensity: number;
  /** Width of each side flame column relative to viewport width. */
  widthFraction: number;
  /** Height of the main flame tongues relative to viewport height. */
  heightFraction: number;
  /** Embers spawned per frame tick across both sides. */
  emberSpawnRate: number;
}

/** Pure helper mapping live flow (0..1) and onset pulse (0..1) to flame size. */
export function computeFlameProfile(flow: number, pulse: number): FlameProfile {
  const f = clamp(flow, 0, 1);
  const p = clamp(pulse, 0, 1);
  const intensity = clamp(0.42 + f * 0.42 + p * 0.28, 0.35, 1.1);
  return {
    intensity,
    widthFraction: 0.14 + f * 0.08 + p * 0.04,
    heightFraction: 0.62 + f * 0.24 + p * 0.1,
    emberSpawnRate: 0.35 + f * 1.4 + p * 1.1,
  };
}

interface Ember {
  side: -1 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  maxLife: number;
}

export function StageFlames() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onset = new OnsetTracker();
    const embers: Ember[] = [];
    let pulse = 0;
    let lastTs = 0;

    function resize() {
      const parent = canvas!.parentElement;
      const w = parent?.clientWidth || window.innerWidth || 0;
      const h = parent?.clientHeight || window.innerHeight || 0;
      if (w <= 0 || h <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas!.width !== targetW || canvas!.height !== targetH) {
        canvas!.width = targetW;
        canvas!.height = targetH;
      }
    }

    function drawSideFire(
      side: -1 | 1,
      w: number,
      h: number,
      t: number,
      profile: FlameProfile,
    ) {
      const edgeX = side === -1 ? 0 : w;
      const maxReach = w * profile.widthFraction;
      const maxHeight = h * profile.heightFraction;

      // Broad warm stage glow radiating inward from the left/right edges.
      const glow = ctx!.createRadialGradient(
        edgeX,
        h * 0.84,
        maxReach * 0.08,
        edgeX - side * maxReach * 0.35,
        h * 0.66,
        maxReach * 1.85,
      );
      glow.addColorStop(0, `rgba(255, 168, 46, ${0.42 * profile.intensity})`);
      glow.addColorStop(0.42, `rgba(235, 72, 18, ${0.26 * profile.intensity})`);
      glow.addColorStop(0.78, `rgba(140, 22, 6, ${0.1 * profile.intensity})`);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx!.fillStyle = glow;
      ctx!.fillRect(0, 0, w, h);

      // Layered flickering flame tongues climbing each side from the bottom corners.
      const layers = [
        { scale: 1.0, speed: 3.1, colorTop: "rgba(255, 68, 12, 0)", colorMid: `rgba(255, 92, 18, ${0.46 * profile.intensity})`, colorBase: `rgba(255, 145, 32, ${0.65 * profile.intensity})` },
        { scale: 0.72, speed: 4.4, colorTop: "rgba(255, 130, 20, 0)", colorMid: `rgba(255, 162, 42, ${0.52 * profile.intensity})`, colorBase: `rgba(255, 220, 110, ${0.72 * profile.intensity})` },
        { scale: 0.44, speed: 5.8, colorTop: "rgba(255, 210, 90, 0)", colorMid: `rgba(255, 224, 128, ${0.5 * profile.intensity})`, colorBase: `rgba(255, 248, 210, ${0.78 * profile.intensity})` },
      ];

      for (let li = 0; li < layers.length; li += 1) {
        const layer = layers[li];
        const reach = maxReach * layer.scale;
        const height = maxHeight * (0.82 + 0.18 * layer.scale);
        const topY = h - height;
        const steps = 16;

        ctx!.beginPath();
        ctx!.moveTo(edgeX, h);
        for (let i = 0; i <= steps; i += 1) {
          const frac = i / steps; // 0 = bottom, 1 = top tip
          const y = h - frac * height;
          const taper = Math.pow(1 - frac, 0.75);
          const wave1 = Math.sin(frac * 7.5 - t * layer.speed + li * 1.7 + (side === 1 ? 2.1 : 0));
          const wave2 = Math.cos(frac * 13.0 - t * (layer.speed * 1.37) + li * 0.9);
          const flicker = 0.72 + 0.28 * (0.6 * wave1 + 0.4 * wave2);
          const inward = reach * taper * flicker;
          const x = edgeX - side * inward;
          ctx!.lineTo(x, y);
        }
        ctx!.lineTo(edgeX, topY);
        ctx!.closePath();

        const grad = ctx!.createLinearGradient(edgeX, h, edgeX - side * reach, topY);
        grad.addColorStop(0, layer.colorBase);
        grad.addColorStop(0.5, layer.colorMid);
        grad.addColorStop(1, layer.colorTop);
        ctx!.fillStyle = grad;
        ctx!.fill();
      }
    }

    function draw(tsMs: number) {
      resize();
      const w = canvas!.width;
      const h = canvas!.height;
      if (w <= 0 || h <= 0) return;

      const dt = lastTs > 0 ? Math.min(0.05, (tsMs - lastTs) / 1000) : 1 / 60;
      lastTs = tsMs;
      const t = reduceMotion ? 0 : tsMs / 1000;

      const { flow, latestFrame } = useVisualizerStore.getState();
      if (latestFrame && onset.consume(latestFrame)) {
        pulse = 1;
      }
      pulse = Math.max(0, pulse - dt * 2.4);

      const profile = computeFlameProfile(flow, reduceMotion ? 0 : pulse);

      ctx!.clearRect(0, 0, w, h);
      ctx!.save();
      ctx!.globalCompositeOperation = "screen";

      drawSideFire(-1, w, h, t, profile);
      drawSideFire(1, w, h, t, profile);

      if (!reduceMotion) {
        // Spawn glowing embers drifting up and inward from both sides.
        if (embers.length < 48 && Math.random() < profile.emberSpawnRate) {
          const side: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
          const edgeX = side === -1 ? 0 : w;
          const span = w * profile.widthFraction * 0.7;
          embers.push({
            side,
            x: edgeX - side * (Math.random() * span),
            y: h - Math.random() * (h * 0.25),
            vx: -side * (18 + Math.random() * 55),
            vy: -(75 + Math.random() * 145),
            radius: 1.5 + Math.random() * 3.2,
            life: 0,
            maxLife: 0.9 + Math.random() * 1.3,
          });
        }

        for (let i = embers.length - 1; i >= 0; i -= 1) {
          const e = embers[i];
          e.life += dt;
          if (e.life >= e.maxLife) {
            embers.splice(i, 1);
            continue;
          }
          e.x += (e.vx + Math.sin(t * 5 + i) * 20) * dt;
          e.y += e.vy * dt;
          const alpha = (1 - e.life / e.maxLife) * 0.85 * Math.min(1, profile.intensity);
          ctx!.beginPath();
          ctx!.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(255, 200, 92, ${alpha})`;
          ctx!.fill();
        }
      }

      ctx!.restore();
    }

    const loop = new RenderLoop({ onFrame: draw });
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="stage-flames"
      aria-hidden="true"
      data-testid="stage-flames"
    />
  );
}
