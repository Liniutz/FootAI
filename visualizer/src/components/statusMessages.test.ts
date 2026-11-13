/** Spec Task 10 tests: operator-facing status message mapping. */
import { describe, expect, it } from "vitest";
import {
  audioStatusView,
  midiStatusView,
  primaryHint,
  telemetryStatusView,
} from "./statusMessages";

describe("telemetryStatusView", () => {
  it("reports engine live when open", () => {
    const v = telemetryStatusView("open");
    expect(v.tone).toBe("ok");
    expect(v.hint).toBeUndefined();
  });

  it("gives offline guidance referencing run_session.py when closed/error", () => {
    for (const s of ["closed", "error"] as const) {
      const v = telemetryStatusView(s);
      expect(v.tone).toBe("error");
      expect(v.hint).toMatch(/run_session\.py/);
    }
  });

  it("is pending while connecting", () => {
    expect(telemetryStatusView("connecting").tone).toBe("pending");
  });
});

describe("audioStatusView", () => {
  it("is ok when active", () => {
    expect(audioStatusView("active").tone).toBe("ok");
  });

  it("warns with the pipewire-loopback hint when device missing", () => {
    const v = audioStatusView("device-missing");
    expect(v.tone).toBe("warn");
    expect(v.hint).toMatch(/--pipewire-loopback/);
  });

  it("warns on denied permission", () => {
    expect(audioStatusView("denied").tone).toBe("warn");
  });
});

describe("midiStatusView", () => {
  it("warns with the band port hint when the port is missing", () => {
    const v = midiStatusView("port-missing");
    expect(v.tone).toBe("warn");
    expect(v.hint).toMatch(/CyberJam_Band/);
  });

  it("is ok when active", () => {
    expect(midiStatusView("active").tone).toBe("ok");
  });
});

describe("primaryHint", () => {
  it("prioritizes an offline engine over audio/midi warnings", () => {
    const hint = primaryHint("closed", "device-missing", "port-missing");
    expect(hint).toMatch(/Engine offline/);
  });

  it("falls through to audio when the engine is live", () => {
    const hint = primaryHint("open", "device-missing", "port-missing");
    expect(hint).toMatch(/--pipewire-loopback/);
  });

  it("falls through to midi when engine + audio are fine", () => {
    const hint = primaryHint("open", "active", "port-missing");
    expect(hint).toMatch(/CyberJam_Band/);
  });

  it("returns null when everything is healthy", () => {
    expect(primaryHint("open", "active", "active")).toBeNull();
  });
});
