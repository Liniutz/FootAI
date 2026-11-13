/** Tests: Guitar Hero scoring + rock meter (pure). */
import { describe, expect, it } from "vitest";
import {
  BASE_HIT_POINTS,
  breakCombo,
  INITIAL_SCORE,
  multiplierForCombo,
  registerHit,
  ROCK_ZONE_COLORS,
  rockZone,
  showFlames,
} from "./scoring";

describe("multiplierForCombo", () => {
  it("steps up x1→x2→x3→x4 at thresholds", () => {
    expect(multiplierForCombo(0)).toBe(1);
    expect(multiplierForCombo(7)).toBe(1);
    expect(multiplierForCombo(8)).toBe(2);
    expect(multiplierForCombo(16)).toBe(3);
    expect(multiplierForCombo(24)).toBe(4);
    expect(multiplierForCombo(100)).toBe(4);
  });
});

describe("registerHit / breakCombo", () => {
  it("increments combo and adds multiplier-scaled points", () => {
    let s = INITIAL_SCORE;
    s = registerHit(s);
    expect(s.combo).toBe(1);
    expect(s.multiplier).toBe(1);
    expect(s.score).toBe(BASE_HIT_POINTS);
  });

  it("scales points once the multiplier climbs", () => {
    let s = INITIAL_SCORE;
    for (let i = 0; i < 8; i++) s = registerHit(s); // reach x2 at combo 8
    expect(s.multiplier).toBe(2);
    const before = s.score;
    s = registerHit(s);
    expect(s.score - before).toBe(BASE_HIT_POINTS * 2);
  });

  it("resets combo + multiplier on break but keeps score", () => {
    let s = INITIAL_SCORE;
    s = registerHit(s);
    s = registerHit(s);
    const score = s.score;
    s = breakCombo(s);
    expect(s.combo).toBe(0);
    expect(s.multiplier).toBe(1);
    expect(s.score).toBe(score);
  });
});

describe("rockZone / flames", () => {
  it("maps flow to zones", () => {
    expect(rockZone(0.05)).toBe("fail");
    expect(rockZone(0.25)).toBe("danger");
    expect(rockZone(0.5)).toBe("ok");
    expect(rockZone(0.7)).toBe("good");
    expect(rockZone(0.95)).toBe("fire");
  });
  it("has a color per zone and shows flames only in fire", () => {
    expect(typeof ROCK_ZONE_COLORS.fire).toBe("string");
    expect(showFlames(0.95)).toBe(true);
    expect(showFlames(0.5)).toBe(false);
  });
});
