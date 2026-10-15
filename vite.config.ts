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
      "/api": "http://localhost:3000",
      "/uploads": "http://localhost:3000",
    },
  },
});
