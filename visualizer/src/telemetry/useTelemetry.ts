/**
 * React hook wrapping `TelemetryClient` (spec Task 3, Lane C).
 *
 * Starts the telemetry connection on mount, pushes validated frames and
 * connection-status transitions into the Zustand store, and tears down on
 * unmount. Allows dependency injection for tests.
 */
import { useEffect } from "react";
import { publishTelemetryToPeer } from "../sync";
import { useVisualizerStore } from "../store";
import {
  TelemetryClient,
  type TelemetryClientOptions,
} from "./client";

export type UseTelemetryOptions = Pick<
  TelemetryClientOptions,
  "url" | "socketFactory" | "scheduleReconnect"
>;

export function useTelemetry(options: UseTelemetryOptions = {}): void {
  // Pull stable action references out of the store.
  const setLatestFrame = useVisualizerStore((s) => s.setLatestFrame);
  const setConnectionStatus = useVisualizerStore((s) => s.setConnectionStatus);

  const { url, socketFactory, scheduleReconnect } = options;

  useEffect(() => {
    const client = new TelemetryClient({
      url,
      socketFactory,
      scheduleReconnect,
      onFrame: (frame) => {
        setLatestFrame(frame);
        publishTelemetryToPeer(frame);
      },
      onStatus: setConnectionStatus,
    });
    client.start();
    return () => client.stop();
  }, [url, socketFactory, scheduleReconnect, setLatestFrame, setConnectionStatus]);
}
