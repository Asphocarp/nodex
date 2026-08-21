import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/effect-codex-app-server/src/**/*.test.ts"],
    maxWorkers: 2,
  },
});
