/**
 * Bar-by-bar chord progression derived from a Cargo stem song's
 * `song_map.json` (see docs/contracts-and-apis.md — Cargo stem contracts).
 *
 * The map's `chords` are fine-grained audio-analysis segments (often several
 * per second). The beginner coach advances one chord per 4/4 bar, so this
 * module samples the segment that is active at each bar boundary, using the
 * map's own `base_bpm` for the bar length. Falls back to the song duration
 * implied by the last segment when the beat list is missing.
 */

export interface SongMapSegment {
  time: number;
  chord: string;
}

interface RawSongMap {
  base_bpm?: unknown;
  beats?: unknown;
  chords?: unknown;
}

/**
 * Fetch `/<slug>/song_map.json` and return one chord name per bar, in order.
 * The returned list loops: bar N shows `list[N % list.length]`.
 */
export async function fetchStemProgression(
  slug: string,
): Promise<readonly string[]> {
  const safeSlug = slug.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`/${safeSlug}/song_map.json`);
  if (!response.ok) {
    throw new Error(`Song map unavailable (${response.status})`);
  }
  const raw: unknown = await response.json();
  const segments = parseSegments(raw);
  const bpm = (raw as RawSongMap).base_bpm;
  if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm <= 0) {
    throw new Error("Invalid Cargo song map");
  }
  const barSeconds = 240 / bpm;
  const beats = (raw as RawSongMap).beats;
  const barCount = Array.isArray(beats) && beats.length >= 4
    ? Math.floor(beats.length / 4)
    : Math.max(1, Math.ceil(segments[segments.length - 1].time / barSeconds));

  const progression: string[] = [];
  let cursor = 0;
  for (let bar = 0; bar < barCount; bar += 1) {
    const barTime = bar * barSeconds;
    while (
      cursor + 1 < segments.length &&
      segments[cursor + 1].time <= barTime
    ) {
      cursor += 1;
    }
    progression.push(segments[cursor].chord);
  }
  return progression;
}

/** Validate and narrow the raw JSON into clean {time, chord} segments. */
function parseSegments(raw: unknown): SongMapSegment[] {
  const chords = (raw as RawSongMap)?.chords;
  if (!Array.isArray(chords)) throw new Error("Invalid Cargo song map");
  const segments: SongMapSegment[] = [];
  for (const entry of chords) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as SongMapSegment).time === "number" &&
      Number.isFinite((entry as SongMapSegment).time) &&
      typeof (entry as SongMapSegment).chord === "string" &&
      (entry as SongMapSegment).chord.length > 0
    ) {
      segments.push({ time: (entry as SongMapSegment).time, chord: (entry as SongMapSegment).chord });
    }
  }
  if (segments.length === 0) throw new Error("Invalid Cargo song map");
  return segments;
}
