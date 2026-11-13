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
import "../visualizer/visualizer.css";

function audioMessage(status: string): string {
  switch (status) {
    case "active":
      return "Audio on";
    case "requesting":
      return "Audio…";
    case "denied":
      return "Audio denied";
    case "device-missing":
      return "No visual-audio device (--pipewire-loopback)";
    default:
      return "Audio off";
  }
}

function midiMessage(status: string): string {
  switch (status) {
    case "active":
      return "Band MIDI on";
    case "requesting":
      return "MIDI…";
    case "denied":
      return "MIDI denied";
    case "port-missing":
      return "No CyberJam_Band port";
    case "unsupported":
      return "No Web MIDI";
    default:
      return "Band MIDI off";
  }
}

export function VisualizerView() {
  useTelemetry();
  useFlow();

  const { start: startAudio, analyser } = useAudioCapture();
  const { start: startMidi } = useBandMidi();

  const audioStatus = useVisualizerStore((s) => s.audioStatus);
  const midiStatus = useVisualizerStore((s) => s.midiStatus);
  const connectionStatus = useVisualizerStore((s) => s.connectionStatus);

  return (
    <section aria-label="Visualizer" className="view view--visualizer gh">
      <div className="visualizer__statusbar">
        <span data-testid="viz-connection">telemetry: {connectionStatus}</span>
        <span data-testid="viz-audio">{audioMessage(audioStatus)}</span>
        <span data-testid="viz-midi">{midiMessage(midiStatus)}</span>
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
      </div>

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
