import { describe, expect, it, vi } from "vitest";
import { startEngineSession } from "./sessionControl";

describe("startEngineSession", () => {
  it("reports a successful engine start", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ running: true, started: true }), { status: 200 }),
    );
    await expect(startEngineSession(fetcher)).resolves.toEqual({
      running: true,
      started: true,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/session/start", { method: "POST" });
  });

  it("surfaces service-offline guidance", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("offline"));
    const result = await startEngineSession(fetcher);
    expect(result.running).toBe(false);
    expect(result.error).toMatch(/session controller is offline/i);
  });

  it("reports an engine startup failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ running: false, error: "Audio device missing" }), {
        status: 500,
      }),
    );
    await expect(startEngineSession(fetcher)).resolves.toEqual({
      running: false,
      error: "Audio device missing",
    });
  });
});
