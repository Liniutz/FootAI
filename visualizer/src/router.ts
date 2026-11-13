/**
 * Minimal dependency-free hash router (spec Task 1 shell).
 *
 * Hash routing is used so each view is a standalone page that can be opened in
 * its own browser window (one per screen) and works under `vite preview` and
 * `file://` without server-side route rewrites.
 *
 *   #/            -> launcher home
 *   #/menu        -> full-page Menu (screen 1)
 *   #/visualizer  -> full-page Visualizer (screen 2)
 */
import { useSyncExternalStore } from "react";
import type { AppView } from "./types";

export type Route = "home" | AppView;

/** Parse the current `location.hash` into a known route. */
export function parseHashRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").toLowerCase();
  if (path === "menu") return "menu";
  if (path === "visualizer") return "visualizer";
  return "home";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function getSnapshot(): Route {
  return parseHashRoute(window.location.hash);
}

/** React hook returning the current route, re-rendering on hash changes. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, () => "home");
}

/** Absolute hash href for a route (for links / window.open targets). */
export function routeHref(route: Route): string {
  return route === "home" ? "#/" : `#/${route}`;
}
