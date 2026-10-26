import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import { versionServiceWorker } from "./scripts/version-service-worker.ts";

export default defineConfig({
  plugins: [
    stylex.vite(),
    react(),
    {
      name: "version-service-worker",
      writeBundle(options) {
        versionServiceWorker(options.dir || "dist");
      },
    },
  ],
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: false },
      "/uploads": { target: "http://localhost:3000", changeOrigin: false },
    },
  },
});
