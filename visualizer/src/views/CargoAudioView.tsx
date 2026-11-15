import { useEffect, useRef, useState } from "react";
import { CargoBandEngine, type CargoVisualState } from "../audio/cargoBandEngine";
import { SONGS } from "../data/catalog";
import { useVisualizerStore } from "../store";
import { loadSelection } from "../menu/persistence";
import "./CargoAudioView.css";

/** Optional stems screen. Normal TV Visualizer remains the default for all other songs. */
export function CargoAudioView() {
  const engineRef = useRef<CargoBandEngine | null>(null);
  const [visual, setVisual] = useState<CargoVisualState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [started, setStarted] = useState(false);
  const selection = useVisualizerStore((state) => state.selection);
  const song = SONGS.find((candidate) => candidate.id === selection.songId && candidate.cargoStemSlug);

  useEffect(() => {
    if (useVisualizerStore.getState().selection.songId === null) {
      useVisualizerStore.getState().setSelection(loadSelection());
    }
    const stored = loadSelection();
    if (stored.songId) useVisualizerStore.getState().setSelection(stored);
    const engine = new CargoBandEngine({ onVisualUpdate: setVisual });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!song?.cargoStemSlug || !engineRef.current) {
      setLoaded(false);
      setStarted(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLoaded(false);
    setStarted(false);
    void engineRef.current.loadSong(song.cargoStemSlug).then(() => {
      if (cancelled) return;
      engineRef.current?.connectToGuitarEngine();
      setLoaded(true);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : "Could not load Cargo audio.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      engineRef.current?.stop();
    };
  }, [song?.cargoStemSlug]);

  const start = async () => {
    if (!engineRef.current || !loaded) return;
    try {
      await engineRef.current.play();
      setStarted(true);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Audio playback could not start.");
    }
  };

  return (
    <main className="cargo-audio-screen" aria-label="Cargo audio performance">
      <p className="cargo-audio-screen__eyebrow">CyberJam · Cargo stems</p>
      <h1>{song?.title ?? "Select a Cargo song on the Menu monitor"}</h1>
      {loading && <p role="status">Loading song map and six audio stems…</p>}
      {error && <p role="alert">Cargo audio unavailable: {error}</p>}
      {!song && <p>Choose Ziua Vrăjitoarelor, Nu Mai Am Țigări, or Andri Popa from the Menu display.</p>}
      {song && !loading && !error && !loaded && <p role="status">Preparing aligned stems…</p>}
      {song && (
        <div className="cargo-audio-screen__performance" aria-live="polite">
          <p className="cargo-audio-screen__chord">
            {visual ? <>{visual.currentChord} <span>→</span> {visual.nextChord}</> : "—"}
          </p>
          <p>{visual?.liveBpm ? `${Math.round(visual.liveBpm)} BPM` : "Listening for guitar"}</p>
          {visual?.chordMatch && <p className="cargo-audio-screen__match">Chord match!</p>}
        </div>
      )}
      {loaded && !started && (
        <button className="cargo-audio-screen__start" type="button" onClick={() => void start()}>
          Start Cargo Audio
        </button>
      )}
      {started && <p className="cargo-audio-screen__live">Cargo stems playing</p>}
    </main>
  );
}
