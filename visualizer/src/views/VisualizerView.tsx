/**
 * Visualizer view (Lane C + track E).
 *
 * Layout:
 *   - top HUD: status pills + score/combo/multiplier
 *   - session overlay (song reference + selected lanes)
 *   - beginner coach (chord diagrams + approach circle) when mode = beginner
 *   - stage row: Rock Meter | Adrian + note panel (the note panel shows the
 *     player's detected guitar note)
 *   - live waveform
 *
 * The old horizontal fretboard ribbon showed the ML band's MIDI (drums/bass),
 * not the player's guitar — the note panel already covers "what I played" — so
 * it was removed to keep the screen focused on the player. The band-MIDI data
 * layer (useBandMidi / bandEvents) is retained for possible reuse but is no
 * longer wired into this view.
 */
import { useVisualizerStore } from "../store";
import { useTelemetry } from "../telemetry/useTelemetry";
import { useAudioCapture } from "../audio/useAudioCapture";
import { useFlow } from "../visualizer/useFlow";
import { WaveformCanvas } from "../visualizer/WaveformCanvas";
import { NotePitchPanel } from "../visualizer/NotePitchPanel";
import { AdrianStage } from "../visualizer/AdrianStage";
import { RockMeter, ScoreBoard } from "../visualizer/GuitarHeroHud";
import { SessionOverlay } from "../visualizer/SessionOverlay";
import { BeginnerCoach } from "../visualizer/BeginnerCoach";
import { StatusBar } from "../components/StatusBar";
import "../visualizer/visualizer.css";

export function VisualizerView() {
  useTelemetry();
  useFlow();

  const { start: startAudio, analyser } = useAudioCapture();

  const audioStatus = useVisualizerStore((s) => s.audioStatus);
  const mode = useVisualizerStore((s) => s.selection.mode);

  return (
    <section aria-label="Visualizer" className="view view--visualizer gh">
      <StatusBar showMidi={false}>
        {audioStatus !== "active" && (
          <button
            type="button"
            className="visualizer__enable-audio"
            onClick={() => void startAudio()}
          >
            Enable Audio
          </button>
        )}
        <ScoreBoard />
      </StatusBar>

      <SessionOverlay />

      {mode === "beginner" && <BeginnerCoach />}

      <div className="gh-stage">
        <RockMeter />
        <div className="gh-stage__center">
          <AdrianStage />
        </div>
        <NotePitchPanel />
      </div>

      <WaveformCanvas analyser={analyser} />
    </section>
  );
}
