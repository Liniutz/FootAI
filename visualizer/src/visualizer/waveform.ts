/**
 * Pure transforms for the waveform/spectrum render surface (spec Task 7).
 *
 * These functions convert raw AnalyserNode buffers into polyline points in
 * pixel space. They contain no rendering or DOM access so they are unit
 * testable in isolation; the Pixi component feeds them analyser data each RAF.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Convert a time-domain byte buffer (0-255, 128 = silence) into waveform
 * polyline points spanning [0, width] x [0, height], centered vertically.
 */
export function timeDomainToPoints(
  buffer: Uint8Array,
  width: number,
  height: number,
): Point[] {
  const n = buffer.length;
  if (n === 0 || width <= 0 || height <= 0) return [];
  const mid = height / 2;
  const points: Point[] = new Array(n);
  const stepX = n > 1 ? width / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    // Normalize 0..255 to -1..1, then map to vertical pixels.
    const v = (buffer[i] - 128) / 128;
    points[i] = { x: i * stepX, y: mid - v * mid };
  }
  return points;
}

/**
 * Convert a frequency byte buffer (0-255 magnitude per bin) into bar heights
 * in pixels, downsampled to `barCount` bars across the given width.
 */
export function frequencyToBars(
  buffer: Uint8Array,
  barCount: number,
  height: number,
): number[] {
  if (buffer.length === 0 || barCount <= 0 || height <= 0) return [];
  const bars: number[] = new Array(barCount).fill(0);
  const binsPerBar = Math.max(1, Math.floor(buffer.length / barCount));
  for (let b = 0; b < barCount; b++) {
    let sum = 0;
    const start = b * binsPerBar;
    const end = Math.min(start + binsPerBar, buffer.length);
    for (let i = start; i < end; i++) sum += buffer[i];
    const avg = end > start ? sum / (end - start) : 0;
    bars[b] = (avg / 255) * height;
  }
  return bars;
}
