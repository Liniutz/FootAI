import { describe, expect, it, vi } from "vitest";
import { startEngineSession, stopEngineSession } from "./sessionControl";

describe("startEngineSession", () => {
  it("requests a graceful session stop", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ running: false, stopped: true }), { status: 200 }),
    );
    await expect(stopEngineSession(fetcher)).resolves.toEqual({
      running: false,
      stopped: true,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/session/stop", { method: "POST" });
  });

  it("reports an offline controller when stopping", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("offline"));
    const result = await stopEngineSession(fetcher);
    expect(result.running).toBe(false);
    expect(result.error).toMatch(/controller is offline/i);
  });

  it("reports a successful engine start", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ running: true, started: true }), { status: 200 }),
    );
    await expect(startEngineSession("freestyle", fetcher)).resolves.toEqual({
      running: true,
      started: true,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "freestyle" }),
    });
  });

  it("surfaces service-offline guidance", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("offline"));
    const result = await startEngineSession("song", fetcher);
    expect(result.running).toBe(false);
    expect(result.error).toMatch(/session controller is offline/i);
  });

  it("reports an engine startup failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ running: false, error: "Audio device missing" }), {
        status: 500,
      }),
    );
    await expect(startEngineSession("song", fetcher)).resolves.toEqual({
      running: false,
      error: "Audio device missing",
    });
  });
});
