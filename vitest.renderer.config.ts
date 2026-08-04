import { defineConfig } from "vitest/config";
import {
  createRendererVitePlugins,
  rendererViteCss,
  rendererViteResolve,
} from "./config/renderer-vite-shared";
import { selectTieredTestFiles } from "./config/vitest-test-tier";

const testFiles = selectTieredTestFiles({
  defaultExclude: [
    "src/renderer/**/*.browser.test.{ts,tsx}",
    "src/renderer/**/*.node.test.{ts,tsx}",
    "src/renderer/**/*.integration.ts",
  ],
  defaultInclude: ["src/renderer/**/*.test.{ts,tsx}"],
  stressInclude: ["src/renderer/**/*.stress.test.{ts,tsx}"],
});

export default defineConfig({
  plugins: createRendererVitePlugins(),
  resolve: rendererViteResolve,
  css: rendererViteCss,
  test: {
    env: { TZ: "UTC" },
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "http://renderer.test/" },
    },
    exclude: testFiles.exclude,
    include: testFiles.include,
    pool: "forks",
    maxWorkers: testFiles.isStress ? 1 : 2,
    fileParallelism: !testFiles.isStress,
    passWithNoTests: testFiles.isStress,
    setupFiles: ["./src/renderer/test/setup.ts"],
    hookTimeout: testFiles.isStress ? 60_000 : 30_000,
    testTimeout: testFiles.isStress ? 60_000 : 30_000,
  },
});
