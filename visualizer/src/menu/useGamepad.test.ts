/** Controller support tests: pure action-reading + edge detection. */
import { describe, expect, it, vi } from "vitest";
import {
  readActions,
  stepActions,
  type GamepadAction,
} from "./useGamepad";

/** Build a minimal fake Gamepad with given pressed buttons + axes. */
function fakePad(
  pressed: number[],
  axes: number[] = [0, 0],
): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: pressed.includes(i),
    touched: false,
    value: pressed.includes(i) ? 1 : 0,
  }));
  return {
    axes,
    buttons: buttons as unknown as readonly GamepadButton[],
    connected: true,
    id: "fake",
    index: 0,
    mapping: "standard",
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

describe("readActions", () => {
  it("reads D-pad buttons as directions", () => {
    expect(readActions(fakePad([12]))).toContain("up");
    expect(readActions(fakePad([13]))).toContain("down");
    expect(readActions(fakePad([14]))).toContain("left");
    expect(readActions(fakePad([15]))).toContain("right");
  });

  it("maps face/menu buttons to semantic actions", () => {
    expect(readActions(fakePad([0]))).toContain("confirm");
    expect(readActions(fakePad([1]))).toContain("back");
    expect(readActions(fakePad([9]))).toContain("start");
  });

  it("reads analog stick past the threshold as directions", () => {
    expect(readActions(fakePad([], [0, -0.9]))).toContain("up");
    expect(readActions(fakePad([], [0, 0.9]))).toContain("down");
    expect(readActions(fakePad([], [-0.9, 0]))).toContain("left");
    expect(readActions(fakePad([], [0.9, 0]))).toContain("right");
  });

  it("ignores small stick drift below the threshold", () => {
    const actions = readActions(fakePad([], [0.2, -0.3]));
    expect(actions.size).toBe(0);
  });
});

describe("stepActions (edge detection)", () => {
  it("fires only on the rising edge of a press", () => {
    const dispatch = vi.fn();
    let prev = new Set<GamepadAction>();

    // Frame 1: confirm newly pressed -> fires.
    prev = stepActions(prev, new Set(["confirm"]), dispatch);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("confirm");

    // Frame 2: confirm still held -> does NOT fire again.
    prev = stepActions(prev, new Set(["confirm"]), dispatch);
    expect(dispatch).toHaveBeenCalledTimes(1);

    // Frame 3: released then re-pressed -> fires once more.
    prev = stepActions(prev, new Set(), dispatch);
    prev = stepActions(prev, new Set(["confirm"]), dispatch);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("dispatches multiple distinct new actions in one frame", () => {
    const dispatch = vi.fn();
    stepActions(new Set(), new Set(["down", "confirm"]), dispatch);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith("down");
    expect(dispatch).toHaveBeenCalledWith("confirm");
  });
});
