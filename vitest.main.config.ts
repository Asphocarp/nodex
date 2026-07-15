import { defineConfig } from "vitest/config";
import { assertElectronTestRuntime } from "./config/electron-test-runtime";

assertElectronTestRuntime("main");

export default defineConfig({
  test: {
    env: { TZ: "UTC" },
    environment: "node",
    exclude: ["src/main/**/*.integration.ts"],
    include: ["src/main/**/*.test.ts"],
    maxWorkers: 4,
    pool: "forks",
    testTimeout: 20_000,
  },
});
