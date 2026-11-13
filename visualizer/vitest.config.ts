import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest config per spec Task 1: jsdom environment for headless React tests.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
