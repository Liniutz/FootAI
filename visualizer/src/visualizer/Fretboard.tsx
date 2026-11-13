/**
 * Horizontal 6-string guitar fretboard (track E restyle).
 *
 * Renders the ML band's live notes as gems on a six-string board (standard
 * tuning, high string on top). Notes enter at the right "now" line and scroll
 * left into the past. Driven by `bandEvents` in the store, read each animation
 * frame via the shared RenderLoop (decoupled from React).
 */
import { useEffect, useRef } from "react";
import { Application, Graphics, Text, TextStyle } from "pixi.js";
import { useVisualizerStore } from "../store";
import { RenderLoop } from "./renderLoop";
import {
  BOARD_EDGE,
  BOARD_WOOD,
  buildFretboardGems,
  FRET_COLOR,
  LABEL_MARGIN_FRAC,
  NUT_COLOR,
  STRING_COLOR,
  STRING_COUNT,
  STRING_LABELS,
  STRING_THICKNESS,
  stringY,
  type Size,
} from "./fretboardGeometry";

export function Fretboard() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const app = new Application();
    const g = new Graphics();
    const labels: Text[] = [];
    const loop = new RenderLoop({ onFrame: draw });

    function draw() {
      const size: Size = {
        width: app.renderer?.width ?? host!.clientWidth,
        height: app.renderer?.height ?? host!.clientHeight,
      };
      if (size.width <= 0 || size.height <= 0) return;
      const now = performance.now();
      const events = useVisualizerStore.getState().bandEvents;
      const labelX = size.width * LABEL_MARGIN_FRAC;

      g.clear();

      // Board background + binding.
      g.rect(0, 0, size.width, size.height);
      g.fill({ color: BOARD_WOOD, alpha: 0.95 });
      g.rect(0.5, 0.5, size.width - 1, size.height - 1);
      g.stroke({ width: 1, color: BOARD_EDGE, alpha: 0.5 });

      // Vertical fret wires across the neck.
      const fretCount = 7;
      for (let f = 1; f <= fretCount; f++) {
        const x = labelX + ((size.width - labelX) * f) / (fretCount + 1);
        g.moveTo(x, size.height * 0.06);
        g.lineTo(x, size.height * 0.94);
        g.stroke({ width: 1, color: FRET_COLOR, alpha: 0.4 });
      }

      // Nut / "now" line at the right edge.
      g.moveTo(size.width - 2, 0);
      g.lineTo(size.width - 2, size.height);
      g.stroke({ width: 3, color: NUT_COLOR, alpha: 0.75 });

      // Six strings (thicker toward the low E at the bottom).
      for (let s = 0; s < STRING_COUNT; s++) {
        const y = stringY(s, size);
        g.moveTo(labelX, y);
        g.lineTo(size.width, y);
        g.stroke({ width: STRING_THICKNESS[s], color: STRING_COLOR, alpha: 0.7 });
      }

      // Gems on their strings.
      const gems = buildFretboardGems(events, now, size);
      for (const gem of gems) {
        g.circle(gem.x, gem.y, gem.radius * 1.5);
        g.fill({ color: gem.color, alpha: 0.1 + gem.intensity * 0.18 });
        g.circle(gem.x, gem.y, gem.radius);
        g.fill({ color: gem.color, alpha: 0.7 + gem.intensity * 0.3 });
        g.circle(gem.x, gem.y, gem.radius);
        g.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
      }

      // Position the string labels.
      for (let s = 0; s < STRING_COUNT; s++) {
        const lbl = labels[s];
        if (!lbl) continue;
        lbl.x = labelX * 0.3;
        lbl.y = stringY(s, size) - lbl.height / 2;
      }
    }

    void app
      .init({ resizeTo: host, antialias: true, backgroundAlpha: 0 })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        app.stage.addChild(g);

        const style = new TextStyle({
          fill: 0xd6d6d6,
          fontSize: 14,
          fontFamily: "monospace",
        });
        for (let s = 0; s < STRING_COUNT; s++) {
          const t = new Text({ text: STRING_LABELS[s], style });
          labels.push(t);
          app.stage.addChild(t);
        }

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
      className="fretboard"
      role="img"
      aria-label="Six-string guitar fretboard"
    />
  );
}
