/**
 * Visualizer view (Lane C + track E).
 *
 * TV layout: full-screen performance visuals with unboxed live song, tempo,
 * key, score, guitar input meter, Adrian sprite, detected note panel, and
 * live waveform. Song selection and beginner coaching live on the Menu display.
 *
 * Generated band instruments remain an engine concern; their labels and MIDI
 * lane visuals are intentionally not shown on the TV performance screen.
 */
import { useAudioCapture } from "../audio/useAudioCapture";
import { useVisualizerStore } from "../store";
import { useFlow } from "../visualizer/useFlow";
import { WaveformCanvas } from "../visualizer/WaveformCanvas";
import { NotePitchPanel } from "../visualizer/NotePitchPanel";
import { AdrianStage } from "../visualizer/AdrianStage";
import { RockMeter } from "../visualizer/GuitarHeroHud";
import { SessionOverlay } from "../visualizer/SessionOverlay";
import "../visualizer/visualizer.css";

export function VisualizerView() {
  useFlow();

  const { start: startAudio, analyser } = useAudioCapture();
  const audioStatus = useVisualizerStore((s) => s.audioStatus);

  return (
    <section aria-label="Visualizer" className="view view--visualizer gh gh--tv">
      <SessionOverlay />
      <div className="gh-stage gh-stage--tv">
        <RockMeter />
        <div className="gh-stage__center">
          <AdrianStage />
        </div>
        <NotePitchPanel />
      </div>
      <div className="tv-waveform-row">
        <WaveformCanvas analyser={analyser} />
        {audioStatus !== "active" && (
          <button
            type="button"
            className="tv-enable-audio"
            onClick={() => void startAudio()}
          >
            Enable Audio
          </button>
        )}
      </div>
    </section>
  );
}
