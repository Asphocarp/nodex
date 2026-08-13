import { defineConfig } from "@playwright/test";
import { baseElectronE2eConfig } from "./playwright.e2e.config";

if (process.env.NODEX_ALLOW_SUBSCRIPTION_E2E !== "1") {
  throw new Error(
    "Authenticated Electron E2E requires explicit user approval: set NODEX_ALLOW_SUBSCRIPTION_E2E=1",
  );
}

export default defineConfig(baseElectronE2eConfig, {
  grep: /@subscription-quota/,
});
