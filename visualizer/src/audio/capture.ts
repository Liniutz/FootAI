/**
 * Web Audio capture from the PipeWire Virtual Source (spec Task 6, Lane C).
 *
 * Enumerates audio input devices, selects the engine's virtual source
 * ("CyberJam Visual Audio", exposed via `--pipewire-loopback`), opens a
 * `getUserMedia` stream, and exposes an `AnalyserNode` for the render surface.
 *
 * Browser autoplay policy requires a user gesture to start audio, so the
 * caller (the Visualizer view) invokes `start()` from a click handler.
 */
import { VISUAL_AUDIO_DEVICE_LABEL } from "../config";
import type { AudioStatus } from "../types";

/** Result of an attempt to start capture. */
export type StartResult =
  | { status: "active"; analyser: AnalyserNode }
  | { status: "denied" }
  | { status: "device-missing" };

/** FFT size for the analyser; 2048 gives 1024 frequency bins. */
const FFT_SIZE = 2048;

/**
 * Find the deviceId of the virtual visual-audio source by label.
 * Returns `null` when no matching device is present (engine not launched with
 * `--pipewire-loopback`, or permissions not yet granted so labels are empty).
 */
export function findVisualAudioDeviceId(
  devices: MediaDeviceInfo[],
  label: string = VISUAL_AUDIO_DEVICE_LABEL,
): string | null {
  const match = devices.find(
    (d) => d.kind === "audioinput" && d.label.includes(label),
  );
  return match ? match.deviceId : null;
}

/** Minimal surface of the media APIs we depend on (eases mocking). */
export interface MediaProvider {
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createAudioContext(): AudioContext;
}

/** Default provider backed by the real browser APIs. */
export function browserMediaProvider(): MediaProvider {
  return {
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
    getUserMedia: (constraints) =>
      navigator.mediaDevices.getUserMedia(constraints),
    createAudioContext: () => new AudioContext(),
  };
}

/**
 * Owns the live capture graph: MediaStream -> MediaStreamSource -> Analyser.
 * One instance per active capture; `stop()` releases all resources.
 */
export class AudioCapture {
  private readonly media: MediaProvider;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;

  constructor(media: MediaProvider = browserMediaProvider()) {
    this.media = media;
  }

  /**
   * Attempt to start capture from the virtual visual-audio device.
   * Reports the resulting status; on success exposes the `AnalyserNode`.
   */
  async start(): Promise<StartResult> {
    // First, see if the device exists. Labels may be empty before permission
    // is granted, so we also fall back to a label-less constraint below.
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await this.media.enumerateDevices();
    } catch {
      // Treat enumeration failure as a denied/unavailable environment.
      return { status: "denied" };
    }

    const deviceId = findVisualAudioDeviceId(devices);
    const hasAnyInput = devices.some((d) => d.kind === "audioinput");

    // If labels are visible and the virtual device is absent, surface it.
    const labelsVisible = devices.some(
      (d) => d.kind === "audioinput" && d.label !== "",
    );
    if (labelsVisible && deviceId === null) {
      return { status: "device-missing" };
    }
    if (!hasAnyInput) {
      return { status: "device-missing" };
    }

    const constraints: MediaStreamConstraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    };

    let stream: MediaStream;
    try {
      stream = await this.media.getUserMedia(constraints);
    } catch (err) {
      // NotFound/OverconstrainedError -> device missing; others -> denied.
      const name = (err as { name?: string } | null)?.name ?? "";
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        return { status: "device-missing" };
      }
      return { status: "denied" };
    }

    const context = this.media.createAudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source.connect(analyser);

    this.context = context;
    this.stream = stream;
    this.source = source;
    this.analyser = analyser;

    return { status: "active", analyser };
  }

  /** The active analyser, or null when not capturing. */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** Release the stream tracks, disconnect nodes, and close the context. */
  async stop(): Promise<void> {
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.context && this.context.state !== "closed") {
      try {
        await this.context.close();
      } catch {
        // ignore close errors during teardown
      }
    }
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.context = null;
  }
}

/** Map a non-active StartResult to the corresponding AudioStatus. */
export function statusFromResult(result: StartResult): AudioStatus {
  return result.status;
}
