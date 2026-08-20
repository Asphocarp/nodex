import path from "node:path";

import { expect, test } from "vitest";

import {
  verifyRequiredStressWorkflowFiles,
  verifyStressWorkflow,
} from "./verify-stress-workflow-contracts";

const filePath = path.resolve(".github/workflows/test.yml");

const stressWorkflow = (steps: readonly Record<string, unknown>[]): Record<string, unknown> => ({
  jobs: {
    "stress-tests": {
      name: "full stress tests",
      steps,
    },
  },
});

test("accepts stress jobs that delegate their complete gate", () => {
  expect(verifyStressWorkflow(filePath, stressWorkflow([
    { uses: "actions/checkout@locked" },
    { uses: "./.github/actions/run-stress-tests" },
  ]))).toBe(1);
});

test("rejects stress jobs that bypass or duplicate the shared gate", () => {
  expect(() => verifyStressWorkflow(filePath, stressWorkflow([
    { uses: "actions/checkout@locked" },
    { run: "pnpm run test:stress" },
  ]))).toThrow("must use ./.github/actions/run-stress-tests exactly once");

  expect(() => verifyStressWorkflow(filePath, stressWorkflow([
    { uses: "./.github/actions/run-stress-tests" },
    { uses: "./.github/actions/setup-playwright" },
  ]))).toThrow("duplicates setup owned by ./.github/actions/run-stress-tests");

  expect(() => verifyStressWorkflow(filePath, stressWorkflow([
    { uses: "./.github/actions/run-stress-tests" },
    { run: "pnpm run build-resources:prepare" },
  ]))).toThrow("duplicates commands owned by ./.github/actions/run-stress-tests");
});

test("rejects workflows that drop a required stress job", () => {
  expect(() => verifyStressWorkflow(filePath, { jobs: {} }, ["stress-tests"]))
    .toThrow("must define stress job stress-tests");
});

test("rejects a missing required stress workflow file", () => {
  expect(() => verifyRequiredStressWorkflowFiles(new Set([
    ".github/workflows/ci-nightly.yml",
    ".github/workflows/ci.yml",
  ]))).toThrow("Required stress workflow is missing: .github/workflows/ci-main.yml");
});
