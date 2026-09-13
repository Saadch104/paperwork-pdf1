import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.{ts,tsx}", "backend/tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 15000,
    restoreMocks: true,
  },
});
