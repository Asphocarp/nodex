import { playwright } from "vite-plus/test/browser-playwright";
import { defineConfig } from "vite-plus";
import {
  createRendererVitePlugins,
  rendererViteCss,
  rendererViteResolve,
} from "./config/renderer-vite-shared";
import { selectTieredTestFiles } from "./config/vitest-test-tier";

const testFiles = selectTieredTestFiles({
  defaultInclude: ["src/renderer/**/*.browser.test.{ts,tsx}"],
  stressInclude: ["src/renderer/**/*.stress.browser.test.{ts,tsx}"],
});

export default defineConfig({
  plugins: createRendererVitePlugins(),
  resolve: rendererViteResolve,
  css: rendererViteCss,
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright(),
    },
    exclude: testFiles.exclude,
    include: testFiles.include,
    fileParallelism: false,
    passWithNoTests: testFiles.isStress,
    setupFiles: ["./src/renderer/test/setup-browser.ts"],
    ...(testFiles.isStress ? { testTimeout: 60_000 } : {}),
  },
});
