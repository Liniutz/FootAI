/**
 * TEMPORARY debug panel (spec Task 2 demo).
 *
 * Renders `connectionStatus` and `selection` from the store to prove the data
 * layer is wired. Scheduled for removal in Task 10 (status UX replaces it).
 */
import { useVisualizerStore } from "../store";

export function DebugPanel() {
  const connectionStatus = useVisualizerStore((s) => s.connectionStatus);
  const audioStatus = useVisualizerStore((s) => s.audioStatus);
  const selection = useVisualizerStore((s) => s.selection);

  return (
    <aside className="debug-panel" aria-label="Debug panel">
      <strong>debug</strong>
      <span data-testid="debug-connection">ws: {connectionStatus}</span>
      <span data-testid="debug-audio">audio: {audioStatus}</span>
      <span data-testid="debug-selection">
        selection: {selection.songId ?? "none"} /{" "}
        {selection.instrumentIds.length} instrument(s)
      </span>
    </aside>
  );
}
