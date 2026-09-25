import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";

export default defineConfig({
  plugins: [stylex.vite(), react()],
  server: { proxy: { "/api": "http://localhost:3000", "/uploads": "http://localhost:3000" } }
});
