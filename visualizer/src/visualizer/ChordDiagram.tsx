/**
 * SVG guitar chord diagram (Beginner mode).
 *
 * Draws a clean vertical fretboard for a `ChordShape`: six string lines, a few
 * fret wires, a thick nut, open/muted markers (`O` / `X`) above the nut, and
 * numbered finger dots on fretted positions. Strings are laid out left→right
 * as low-E … high-E (reading the shape's low-E-first array).
 *
 * Pure presentational component — no timers, no store access — so it is easy
 * to render for both the current and the upcoming (preview) chord.
 */
import type { ChordShape } from "./chords";
import { STRING_COUNT } from "./chords";

interface ChordDiagramProps {
  chord: ChordShape;
  /** Render smaller/dimmer for the "next chord" preview. */
  preview?: boolean;
  /** Visible fret rows. */
  fretRows?: number;
}

export function ChordDiagram({
  chord,
  preview = false,
  fretRows = 4,
}: ChordDiagramProps) {
  const w = preview ? 110 : 160;
  const padX = w * 0.16;
  const padTop = preview ? 26 : 34;
  const padBottom = preview ? 10 : 14;
  const boardW = w - padX * 2;
  const rowH = preview ? 24 : 32;
  const h = padTop + rowH * fretRows + padBottom;

  const colGap = boardW / (STRING_COUNT - 1);
  const stringX = (s: number) => padX + s * colGap;
  const fretY = (row: number) => padTop + row * rowH;

  const muteOpenColor = preview ? "#9aa7bd" : "#cfd8e8";
  const dotColor = preview ? "#8fb8ff" : "#6ee7ff";
  const lineColor = preview ? "#3a475e" : "#5a6b86";

  return (
    <figure className={"chorddiagram" + (preview ? " chorddiagram--preview" : "")}>
      <figcaption className="chorddiagram__name" data-testid="chord-name">
        {preview ? "Next" : "Now"}: {chord.name}
      </figcaption>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${chord.name} chord diagram`}
      >
        {/* Nut (thick top line). */}
        <rect
          x={stringX(0)}
          y={padTop - 4}
          width={boardW}
          height={4}
          fill={muteOpenColor}
        />

        {/* Fret wires. */}
        {Array.from({ length: fretRows + 1 }, (_, r) => (
          <line
            key={`f${r}`}
            x1={stringX(0)}
            y1={fretY(r)}
            x2={stringX(STRING_COUNT - 1)}
            y2={fretY(r)}
            stroke={lineColor}
            strokeWidth={1}
          />
        ))}

        {/* String lines. */}
        {Array.from({ length: STRING_COUNT }, (_, s) => (
          <line
            key={`s${s}`}
            x1={stringX(s)}
            y1={padTop}
            x2={stringX(s)}
            y2={fretY(fretRows)}
            stroke={lineColor}
            strokeWidth={1}
          />
        ))}

        {/* Open / muted markers above the nut + finger dots. */}
        {chord.strings.map((st, s) => {
          const cx = stringX(s);
          if (st.kind === "open" || st.kind === "muted") {
            return (
              <text
                key={`m${s}`}
                x={cx}
                y={padTop - 10}
                textAnchor="middle"
                fontSize={preview ? 12 : 15}
                fill={muteOpenColor}
                fontFamily="monospace"
                data-testid={`marker-${s}`}
              >
                {st.kind === "open" ? "O" : "X"}
              </text>
            );
          }
          // Fretted: dot centered in its fret row.
          const cy = fretY(st.fret - 1) + rowH / 2;
          const r = preview ? 8 : 11;
          return (
            <g key={`d${s}`} data-testid={`dot-${s}`}>
              <circle cx={cx} cy={cy} r={r} fill={dotColor} />
              {st.finger && (
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={preview ? 9 : 12}
                  fill="#0b1020"
                  fontFamily="monospace"
                  fontWeight="700"
                >
                  {st.finger}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
