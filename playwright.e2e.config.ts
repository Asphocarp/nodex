import { defineConfig } from "@playwright/test";

export const baseElectronE2eConfig = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  use: {
    trace: "retain-on-failure",
  },
});

export default defineConfig(baseElectronE2eConfig, {
  grepInvert: /@subscription-quota/,
});
