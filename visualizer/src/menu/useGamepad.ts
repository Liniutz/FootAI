/**
 * Gamepad navigation hook for the Menu (Lane B, controller support).
 *
 * The browser Gamepad API has no reliable event stream for button presses, so
 * we poll `navigator.getGamepads()` inside a `requestAnimationFrame` loop and
 * emit *edge-triggered* actions (fire once per press, not every frame). The
 * mapping targets a standard-layout controller (Xbox / DualShock):
 *
 *   D-pad / left stick  -> up / down / left / right navigation
 *   A (button 0)        -> confirm / toggle
 *   B (button 1)        -> back
 *   Start (button 9)    -> start
 *
 * The hook is intentionally decoupled from the view: it just calls the
 * callbacks you pass. A `pollSource` override makes it unit-testable without a
 * real controller.
 */
import { useEffect, useRef } from "react";

/** Semantic actions a controller can emit. */
export type GamepadAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "start";

export interface GamepadHandlers {
  onUp?: () => void;
  onDown?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  onConfirm?: () => void;
  onBack?: () => void;
  onStart?: () => void;
  /** Fired for connect/disconnect so the UI can show a hint. */
  onConnectionChange?: (connected: boolean) => void;
}

/** Standard-mapping button indices we care about. */
const BUTTON = {
  A: 0,
  B: 1,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

/** Axis deflection past which a stick counts as a direction press. */
const AXIS_THRESHOLD = 0.6;

/** Source of the current gamepad snapshot (overridable for tests). */
export type GamepadPollSource = () => (Gamepad | null)[];

function defaultPollSource(): (Gamepad | null)[] {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads());
}

/**
 * Compute which semantic actions are "pressed" this frame from a raw gamepad.
 * Combines digital D-pad buttons with analog-stick thresholds.
 */
export function readActions(pad: Gamepad): Set<GamepadAction> {
  const active = new Set<GamepadAction>();
  const pressed = (i: number) => pad.buttons[i]?.pressed === true;

  const axisX = pad.axes[0] ?? 0;
  const axisY = pad.axes[1] ?? 0;

  if (pressed(BUTTON.DPAD_UP) || axisY < -AXIS_THRESHOLD) active.add("up");
  if (pressed(BUTTON.DPAD_DOWN) || axisY > AXIS_THRESHOLD) active.add("down");
  if (pressed(BUTTON.DPAD_LEFT) || axisX < -AXIS_THRESHOLD) active.add("left");
  if (pressed(BUTTON.DPAD_RIGHT) || axisX > AXIS_THRESHOLD) active.add("right");
  if (pressed(BUTTON.A)) active.add("confirm");
  if (pressed(BUTTON.B)) active.add("back");
  if (pressed(BUTTON.START)) active.add("start");

  return active;
}

/**
 * Core edge-detection stepper, exported for tests. Given the previous and
 * current active-action sets, it invokes a handler once per newly pressed
 * action (rising edge) and returns the new "previous" set.
 */
export function stepActions(
  prev: Set<GamepadAction>,
  current: Set<GamepadAction>,
  dispatch: (action: GamepadAction) => void,
): Set<GamepadAction> {
  for (const action of current) {
    if (!prev.has(action)) dispatch(action);
  }
  return current;
}

export function useGamepad(handlers: GamepadHandlers): void {
  // Keep the latest handlers in a ref so the RAF loop sees fresh closures
  // without being torn down and recreated on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let raf = 0;
    let prev = new Set<GamepadAction>();
    let connected = false;

    const dispatch = (action: GamepadAction) => {
      const h = handlersRef.current;
      switch (action) {
        case "up":
          h.onUp?.();
          break;
        case "down":
          h.onDown?.();
          break;
        case "left":
          h.onLeft?.();
          break;
        case "right":
          h.onRight?.();
          break;
        case "confirm":
          h.onConfirm?.();
          break;
        case "back":
          h.onBack?.();
          break;
        case "start":
          h.onStart?.();
          break;
      }
    };

    const poll: GamepadPollSource = defaultPollSource;

    const tick = () => {
      const pads = poll().filter((p): p is Gamepad => p != null);
      const nowConnected = pads.length > 0;
      if (nowConnected !== connected) {
        connected = nowConnected;
        handlersRef.current.onConnectionChange?.(connected);
      }

      // Merge actions across all connected pads so any controller works.
      const current = new Set<GamepadAction>();
      for (const pad of pads) {
        for (const action of readActions(pad)) current.add(action);
      }

      prev = stepActions(prev, current, dispatch);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}
