/** Tests for the hash router parsing helpers. */
import { describe, expect, it } from "vitest";
import { parseHashRoute, routeHref } from "./router";

describe("parseHashRoute", () => {
  it("maps empty / root hashes to home", () => {
    expect(parseHashRoute("")).toBe("home");
    expect(parseHashRoute("#")).toBe("home");
    expect(parseHashRoute("#/")).toBe("home");
  });

  it("maps #/menu and #/visualizer to their routes", () => {
    expect(parseHashRoute("#/menu")).toBe("menu");
    expect(parseHashRoute("#/visualizer")).toBe("visualizer");
  });

  it("is case-insensitive and tolerates a missing slash", () => {
    expect(parseHashRoute("#MENU")).toBe("menu");
    expect(parseHashRoute("#/Visualizer")).toBe("visualizer");
  });

  it("falls back to home for unknown routes", () => {
    expect(parseHashRoute("#/nope")).toBe("home");
  });
});

describe("routeHref", () => {
  it("builds hash hrefs", () => {
    expect(routeHref("home")).toBe("#/");
    expect(routeHref("menu")).toBe("#/menu");
    expect(routeHref("visualizer")).toBe("#/visualizer");
  });
});
