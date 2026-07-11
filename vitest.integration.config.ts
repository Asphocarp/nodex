import { defineConfig } from "vitest/config";

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
