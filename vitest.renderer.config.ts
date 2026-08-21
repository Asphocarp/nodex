import { defineConfig } from "vitest/config";
import {
  createRendererVitePlugins,
  rendererViteCss,
  rendererViteResolve,
} from "./config/renderer-vite-shared";
import { selectTieredTestFiles } from "./config/vitest-test-tier";
import {
  rendererWorkerAllocation,
  rendererWorkerCount,
} from "./config/renderer-worker-count";

const workbenchShellTestFiles =
  "src/renderer/components/workbench/workbench-shell.*.test.tsx";

const testFiles = selectTieredTestFiles({
  defaultExclude: [
    "src/renderer/**/*.browser.test.{ts,tsx}",
    "src/renderer/**/*.node.test.{ts,tsx}",
    "src/renderer/**/*.integration.ts",
  ],
  defaultInclude: [
    "src/renderer/**/*.test.tsx",
    "src/renderer/**/*.jsdom.test.ts",
  ],
  stressInclude: ["src/renderer/**/*.stress.test.{ts,tsx}"],
});
const isCi = process.env.CI === "true";
const workerAllocation = rendererWorkerAllocation({ ci: isCi });

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
    maxWorkers: rendererWorkerCount({ ci: isCi, stress: testFiles.isStress }),
    fileParallelism: !testFiles.isStress,
    projects: testFiles.isStress
      ? undefined
      : [
          {
            extends: true,
            test: {
              name: "renderer",
              include: testFiles.include,
              exclude: [...testFiles.exclude, workbenchShellTestFiles],
              maxWorkers: workerAllocation.regular,
            },
          },
          {
            extends: true,
            test: {
              name: "renderer-workbench-shell",
              include: [workbenchShellTestFiles],
              exclude: testFiles.exclude,
              fileParallelism: false,
              maxWorkers: workerAllocation.workbenchShell,
            },
          },
        ],
    passWithNoTests: testFiles.isStress,
    setupFiles: ["./src/renderer/test/setup.ts"],
    hookTimeout: testFiles.isStress ? 60_000 : 30_000,
    testTimeout: testFiles.isStress ? 60_000 : 30_000,
  },
});
