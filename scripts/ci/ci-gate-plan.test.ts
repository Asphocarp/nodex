import { describe, expect, test } from "vitest";

import {
  APP_TEST_SUITES,
  assertCiGatePlan,
  requiredJobIdsForGatePlan,
  STATIC_GROUPS,
  type CiGatePlan,
} from "./ci-gate-plan";

const fullPlan: CiGatePlan = {
  allGates: true,
  appTestSuites: APP_TEST_SUITES,
  browser: true,
  dependencyKind: "source",
  docsOnly: false,
  electronE2e: true,
  landingOnly: false,
  protocolContracts: true,
  releaseTransition: false,
  runtimeMac: true,
  rustFast: true,
  rustMigration: true,
  staticGroups: STATIC_GROUPS,
  stress: true,
};

describe("CI gate plan contract", () => {
  test("derives every required workflow job from the full plan", () => {
    expect(requiredJobIdsForGatePlan(fullPlan)).toEqual([
      "static-contracts",
      "app-tests",
      "rust-pr",
      "rust-migration",
      "stress-tests",
      "browser-tests",
      "electron-e2e",
      "runtime-contracts",
    ]);
  });

  test("rejects unknown fields and protocol plans without a Rust owner", () => {
    expect(() => assertCiGatePlan({ ...fullPlan, surprise: true })).toThrow("unknown fields");
    expect(() => assertCiGatePlan({ ...fullPlan, rustFast: false })).toThrow("execution owner");
  });

  test("keeps release transition isolated from ordinary jobs", () => {
    expect(requiredJobIdsForGatePlan({ ...fullPlan, releaseTransition: true }))
      .toEqual(["release-transition"]);
    expect(() => assertCiGatePlan({ ...fullPlan, releaseTransition: true })).toThrow("ordinary gates");
  });
});
