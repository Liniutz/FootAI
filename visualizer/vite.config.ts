import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api/session": {
        target: "http://127.0.0.1:8765",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api\/session/, ""),
      },
    },
  },
});
