import { defineConfig } from "vitest/config";
import { assertElectronTestRuntime } from "./config/electron-test-runtime";

assertElectronTestRuntime("integration");

export default defineConfig({
  test: {
    env: { TZ: "UTC" },
    environment: "node",
    include: [
      "src/main/**/*.integration.ts",
      "src/renderer/**/*.integration.ts",
    ],
    pool: "forks",
    testTimeout: 20_000,
  },
});
