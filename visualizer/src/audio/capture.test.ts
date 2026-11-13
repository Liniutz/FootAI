/** Spec Task 6 tests: audio device selection, status, and teardown. */
import { describe, expect, it, vi } from "vitest";
import {
  AudioCapture,
  findVisualAudioDeviceId,
  type MediaProvider,
} from "./capture";
import { VISUAL_AUDIO_DEVICE_LABEL } from "../config";

function device(
  partial: Partial<MediaDeviceInfo> & { kind: MediaDeviceKind },
): MediaDeviceInfo {
  return {
    deviceId: "",
    groupId: "",
    label: "",
    toJSON: () => ({}),
    ...partial,
  } as MediaDeviceInfo;
}

function fakeAnalyser(): AnalyserNode {
  return { fftSize: 2048, disconnect: vi.fn() } as unknown as AnalyserNode;
}

function fakeContext(analyser: AnalyserNode) {
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  return {
    state: "running" as AudioContextState,
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return {
    getTracks: () => [track],
    _track: track,
  } as unknown as MediaStream & { _track: { stop: ReturnType<typeof vi.fn> } };
}

describe("findVisualAudioDeviceId", () => {
  it("finds the virtual source by label", () => {
    const devices = [
      device({ kind: "audioinput", deviceId: "a", label: "Built-in Mic" }),
      device({
        kind: "audioinput",
        deviceId: "b",
        label: `${VISUAL_AUDIO_DEVICE_LABEL} (loopback)`,
      }),
    ];
    expect(findVisualAudioDeviceId(devices)).toBe("b");
  });

  it("returns null when the virtual source is absent", () => {
    const devices = [
      device({ kind: "audioinput", deviceId: "a", label: "Built-in Mic" }),
    ];
    expect(findVisualAudioDeviceId(devices)).toBeNull();
  });
});

describe("AudioCapture.start", () => {
  it("activates and exposes an analyser when the device is present", async () => {
    const analyser = fakeAnalyser();
    const stream = fakeStream();
    const media: MediaProvider = {
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([
          device({
            kind: "audioinput",
            deviceId: "b",
            label: VISUAL_AUDIO_DEVICE_LABEL,
          }),
        ]),
      getUserMedia: vi.fn().mockResolvedValue(stream),
      createAudioContext: vi.fn(() => fakeContext(analyser) as unknown as AudioContext),
    };

    const capture = new AudioCapture(media);
    const result = await capture.start();

    expect(result.status).toBe("active");
    if (result.status === "active") expect(result.analyser).toBe(analyser);
    expect(capture.getAnalyser()).toBe(analyser);
  });

  it("reports device-missing when labels are visible but the source is absent", async () => {
    const media: MediaProvider = {
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([
          device({ kind: "audioinput", deviceId: "a", label: "Built-in Mic" }),
        ]),
      getUserMedia: vi.fn(),
      createAudioContext: vi.fn(),
    };
    const capture = new AudioCapture(media);
    const result = await capture.start();
    expect(result.status).toBe("device-missing");
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it("reports denied when getUserMedia rejects with NotAllowedError", async () => {
    const media: MediaProvider = {
      // No labels visible (permission not yet granted) -> proceeds to getUserMedia.
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([device({ kind: "audioinput", deviceId: "" })]),
      getUserMedia: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("no"), { name: "NotAllowedError" }),
        ),
      createAudioContext: vi.fn(),
    };
    const capture = new AudioCapture(media);
    const result = await capture.start();
    expect(result.status).toBe("denied");
  });

  it("reports device-missing when getUserMedia rejects with NotFoundError", async () => {
    const media: MediaProvider = {
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([device({ kind: "audioinput", deviceId: "" })]),
      getUserMedia: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("no"), { name: "NotFoundError" }),
        ),
      createAudioContext: vi.fn(),
    };
    const capture = new AudioCapture(media);
    const result = await capture.start();
    expect(result.status).toBe("device-missing");
  });

  it("stops tracks and closes the context on teardown", async () => {
    const analyser = fakeAnalyser();
    const stream = fakeStream();
    const ctx = fakeContext(analyser);
    const media: MediaProvider = {
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([
          device({
            kind: "audioinput",
            deviceId: "b",
            label: VISUAL_AUDIO_DEVICE_LABEL,
          }),
        ]),
      getUserMedia: vi.fn().mockResolvedValue(stream),
      createAudioContext: vi.fn(() => ctx as unknown as AudioContext),
    };
    const capture = new AudioCapture(media);
    await capture.start();
    await capture.stop();

    expect(stream._track.stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
    expect(capture.getAnalyser()).toBeNull();
  });
});
