/**
 * Visualizer view (Lane C + track E).
 *
 * Layout:
 *   - top HUD: status pills + score/combo/multiplier
 *   - stage row: Rock Meter | Adrian + note panel
 *   - live waveform
 *   - horizontal 6-string fretboard (ML band notes placed on strings by pitch)
 */
import { useVisualizerStore } from "../store";
import { useTelemetry } from "../telemetry/useTelemetry";
import { useAudioCapture } from "../audio/useAudioCapture";
import { useBandMidi } from "../midi/useBandMidi";
import { useFlow } from "../visualizer/useFlow";
import { WaveformCanvas } from "../visualizer/WaveformCanvas";
import { NotePitchPanel } from "../visualizer/NotePitchPanel";
import { AdrianStage } from "../visualizer/AdrianStage";
import { Fretboard } from "../visualizer/Fretboard";
import { RockMeter, ScoreBoard } from "../visualizer/GuitarHeroHud";
import { SessionOverlay } from "../visualizer/SessionOverlay";
import { BeginnerCoach } from "../visualizer/BeginnerCoach";
import { StatusBar } from "../components/StatusBar";
import "../visualizer/visualizer.css";

export function VisualizerView() {
  useTelemetry();
  useFlow();

  const { start: startAudio, analyser } = useAudioCapture();
  const { start: startMidi } = useBandMidi();

  const audioStatus = useVisualizerStore((s) => s.audioStatus);
  const midiStatus = useVisualizerStore((s) => s.midiStatus);
  const mode = useVisualizerStore((s) => s.selection.mode);

  return (
    <section aria-label="Visualizer" className="view view--visualizer gh">
      <StatusBar>
        {audioStatus !== "active" && (
          <button
            type="button"
            className="visualizer__enable-audio"
            onClick={() => void startAudio()}
          >
            Enable Audio
          </button>
        )}
        {midiStatus !== "active" && (
          <button
            type="button"
            className="visualizer__enable-audio"
            onClick={() => void startMidi()}
          >
            Connect Band MIDI
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

      <Fretboard />
    </section>
  );
}
