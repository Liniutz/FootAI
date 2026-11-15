/** Client for the loopback session-control helper used by Start Session. */
export type SessionControlResult = {
  running: boolean;
  error?: string;
  started?: boolean;
  passthroughOnly?: boolean;
};

export interface StartSessionOptions {
  /**
   * Start the engine for guitar monitoring/DSP only: the RNN worker and the
   * generated backing band stay off because a fixed song's stems play in the
   * browser.
   */
  passthroughOnly?: boolean;
}

export async function stopEngineSession(
  fetcher: typeof fetch = fetch,
): Promise<SessionControlResult> {
  let response: Response;
  try {
    response = await fetcher("/api/session/stop", { method: "POST" });
  } catch {
    return {
      running: false,
      error: "Session controller is offline; stop the engine from its terminal.",
    };
  }
  const result = (await response.json().catch(() => ({}))) as SessionControlResult;
  if (!response.ok || result.running) {
    return {
      running: true,
      error: result.error ?? `Could not stop the session (HTTP ${response.status})`,
    };
  }
  return result;
}

export async function startEngineSession(
  mode: "freestyle" | "song" = "song",
  fetcher: typeof fetch = fetch,
  options: StartSessionOptions = {},
): Promise<SessionControlResult> {
  let response: Response;
  try {
    response = await fetcher("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        ...(options.passthroughOnly ? { passthrough_only: true } : {}),
      }),
    });
  } catch {
    return {
      running: false,
      error: "Session controller is offline. Start it with .venv/bin/python scripts/session_control.py",
    };
  }

  const result = (await response.json().catch(() => ({}))) as SessionControlResult;
  if (!response.ok || !result.running) {
    return {
      running: false,
      error: result.error ?? `Engine could not start (HTTP ${response.status})`,
    };
  }
  return result;
}
