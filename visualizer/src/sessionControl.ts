/** Client for the loopback session-control helper used by Start Session. */
export type SessionControlResult = { running: boolean; error?: string };

export async function startEngineSession(
  fetcher: typeof fetch = fetch,
): Promise<SessionControlResult> {
  let response: Response;
  try {
    response = await fetcher("/api/session/start", { method: "POST" });
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
