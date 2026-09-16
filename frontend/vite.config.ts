import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: { "/api": { target: "http://127.0.0.1:4000", changeOrigin: true } },
  },
  build: {
    outDir: resolve(__dirname, "../dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});