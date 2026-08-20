import { describe, expect, test } from "vitest";

import { APP_TEST_SUITES, STATIC_GROUPS } from "./ci-gate-plan";
import {
  verifyAppTestMatrixContracts,
  verifyMainCiContracts,
} from "./verify-ci-matrix-contracts";

const mainWorkflow = ({
  appTestSuites = APP_TEST_SUITES,
  staticGroups = STATIC_GROUPS,
}: {
  readonly appTestSuites?: readonly string[];
  readonly staticGroups?: readonly string[];
} = {}): Record<string, unknown> => ({
  jobs: {
    "app-tests": { with: { suites_json: JSON.stringify(appTestSuites) } },
    "static-contracts": { with: { groups_json: JSON.stringify(staticGroups) } },
  },
});

describe("CI matrix contracts", () => {
  test("accepts exhaustive canonical Main matrices", () => {
    expect(() => verifyMainCiContracts(mainWorkflow())).not.toThrow();
  });

  test("rejects omitted, additional, and reordered Main matrix entries", () => {
    expect(() => verifyMainCiContracts(mainWorkflow({ staticGroups: STATIC_GROUPS.slice(1) })))
      .toThrow("Main CI static groups");
    expect(() => verifyMainCiContracts(mainWorkflow({ appTestSuites: [...APP_TEST_SUITES, "new"] })))
      .toThrow("Main CI app test suites");
    expect(() => verifyMainCiContracts(mainWorkflow({ appTestSuites: [...APP_TEST_SUITES].reverse() })))
      .toThrow("Main CI app test suites");
  });

  test("rejects Rust cache variables inherited by non-Rust matrix cells", () => {
    expect(() => verifyAppTestMatrixContracts({ jobs: { test: { env: { CI_TIMING_JOB: "test" } } } }))
      .not.toThrow();
    expect(() => verifyAppTestMatrixContracts({
      jobs: { test: { env: { RUSTC_WRAPPER: "sccache" } } },
    })).toThrow("scope Rust cache variables to Rust-bearing steps");
  });
});
