import { defineConfig } from "vitest/config";
import {
  createRendererVitePlugins,
  rendererViteCss,
  rendererViteResolve,
} from "./config/renderer-vite-shared";

export default defineConfig({
  plugins: createRendererVitePlugins(),
  resolve: rendererViteResolve,
  css: rendererViteCss,
  test: {
    env: { TZ: "UTC" },
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "http://localhost:51283/" },
    },
    exclude: [
      "src/renderer/**/*.browser.test.{ts,tsx}",
      "src/renderer/**/*.node.test.{ts,tsx}",
      "src/renderer/**/*.integration.ts",
    ],
    include: ["src/renderer/**/*.test.{ts,tsx}"],
    pool: "forks",
    maxWorkers: 3,
    setupFiles: ["./src/renderer/test/setup.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
