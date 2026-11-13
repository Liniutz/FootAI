/**
 * Helpers for opening the Menu and Visualizer in separate browser windows
 * (two-screen setup).
 *
 * Browsers only allow `window.open` from a user gesture; an unprompted call on
 * page load is usually suppressed by the popup blocker. The launcher therefore
 * ATTEMPTS an automatic open on mount and falls back to a manual button when
 * the attempt is blocked (decision 1=b).
 */
import { routeHref, type Route } from "./router";

export type OpenWindowsResult = "opened" | "blocked" | "unsupported";

/** Build an absolute URL for a route, based on the current origin + path. */
export function routeUrl(route: Route): string {
  if (typeof window === "undefined") return routeHref(route);
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${routeHref(route)}`;
}

/**
 * Open both screens as separate windows. Returns:
 *   - "opened"       both windows were created,
 *   - "blocked"      the browser blocked at least one popup,
 *   - "unsupported"  `window.open` is unavailable (SSR / test env).
 *
 * Each window is named so repeated calls re-focus the existing window instead
 * of spawning duplicates.
 */
export function openBothScreens(): OpenWindowsResult {
  if (typeof window === "undefined" || typeof window.open !== "function") {
    return "unsupported";
  }

  const menu = window.open(routeUrl("menu"), "cyberjam-menu");
  const visualizer = window.open(routeUrl("visualizer"), "cyberjam-visualizer");

  if (!menu || !visualizer) {
    return "blocked";
  }
  return "opened";
}
