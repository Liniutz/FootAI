/** Beginner-mode chord diagram rendering tests. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChordDiagram } from "./ChordDiagram";
import { getChord } from "./chords";

afterEach(cleanup);

describe("ChordDiagram", () => {
  it("labels the current chord by name", () => {
    render(<ChordDiagram chord={getChord("Em")!} />);
    expect(screen.getByTestId("chord-name")).toHaveTextContent("Now: Em");
  });

  it("labels a preview chord as Next", () => {
    render(<ChordDiagram chord={getChord("G")!} preview />);
    expect(screen.getByTestId("chord-name")).toHaveTextContent("Next: G");
  });

  it("draws open/muted markers and finger dots for the shape", () => {
    // C = [X, fret3, fret2, O, fret1, O] (low-E first)
    render(<ChordDiagram chord={getChord("C")!} />);
    // String 0 muted -> marker X; string 3 open -> marker O.
    expect(screen.getByTestId("marker-0")).toHaveTextContent("X");
    expect(screen.getByTestId("marker-3")).toHaveTextContent("O");
    // String 1 is fretted -> a dot, not a marker.
    expect(screen.getByTestId("dot-1")).toBeInTheDocument();
    expect(screen.queryByTestId("marker-1")).not.toBeInTheDocument();
  });
});
