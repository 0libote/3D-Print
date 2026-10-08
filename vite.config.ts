import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

export default defineConfig({
  plugins: [
    stylex.vite(),
    react(),
    {
      name: "version-service-worker",
      writeBundle(options, bundle) {
        const buildId = createHash("sha256")
          .update(Object.keys(bundle).sort().join("|"))
          .digest("hex")
          .slice(0, 16);
        const path = `${options.dir || "dist"}/sw.js`;
        writeFileSync(
          path,
          readFileSync(path, "utf8").replace("__BUILD_ID__", buildId),
        );
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
