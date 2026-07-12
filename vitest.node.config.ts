import { defineConfig } from "vitest/config";
import { rendererViteResolve } from "./config/renderer-vite-shared";

export default defineConfig({
  resolve: rendererViteResolve,
  test: {
    env: { TZ: "UTC" },
    environment: "node",
    include: [
      "config/**/*.test.ts",
      "scripts/**/*.test.ts",
      "src/shared/**/*.test.ts",
      "src/renderer/**/*.node.test.{ts,tsx}",
      "packages/landing/src/**/*.test.ts",
    ],
    exclude: [
      "packages/landing/src/download-cta.test.ts",
      "third_party/**",
    ],
    maxWorkers: 4,
    testTimeout: 30_000,
  },
});
