// Vitest setup: DOM matchers and a deterministic localStorage shim for jsdom.
import "@testing-library/jest-dom/vitest";

if (typeof globalThis.localStorage === "undefined") {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(String(key)) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(String(key)); },
    setItem(key, value) { values.set(String(key), String(value)); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
}
