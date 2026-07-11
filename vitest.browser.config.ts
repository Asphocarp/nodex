import { playwright } from "@vitest/browser-playwright";
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
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright(),
    },
    include: ["src/renderer/**/*.browser.test.{ts,tsx}"],
    setupFiles: ["./src/renderer/test/setup-browser.ts"],
  },
});
