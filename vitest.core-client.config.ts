import { defineConfig } from "vitest/config";
import { rendererViteResolve } from "./config/renderer-vite-shared";
import { selectTieredTestFiles } from "./config/vitest-test-tier";

const testFiles = selectTieredTestFiles({
  defaultInclude: ["src/main/core-client/**/*.node.test.ts"],
  stressInclude: ["src/main/core-client/**/*.stress.node.test.ts"],
});

export default defineConfig({
  resolve: rendererViteResolve,
  test: {
    env: { TZ: "UTC" },
    environment: "node",
    include: testFiles.include,
    exclude: testFiles.exclude,
    maxWorkers: testFiles.isStress ? 1 : 4,
    fileParallelism: !testFiles.isStress,
    passWithNoTests: testFiles.isStress,
    testTimeout: testFiles.isStress ? 60_000 : 30_000,
  },
});
