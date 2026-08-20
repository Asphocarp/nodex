import { describe, expect, test } from "vitest";

import { APP_TEST_SUITES } from "./ci-gate-plan";
import { parseAppTestSuite, planAppTestSuite } from "./app-test-suite";

describe("application CI suite planning", () => {
  test("maps every suite to one canonical package script", () => {
    expect(APP_TEST_SUITES.map((suite) => [suite, planAppTestSuite(suite)])).toEqual([
      ["unit", { needsRust: false, needsXvfb: false, packageScript: "test:unit" }],
      ["core-client", { needsRust: true, needsXvfb: false, packageScript: "test:core-client" }],
      ["main", { needsRust: true, needsXvfb: true, packageScript: "test:main" }],
      ["renderer", { needsRust: false, needsXvfb: false, packageScript: "test:renderer" }],
      ["integration", { needsRust: true, needsXvfb: true, packageScript: "test:integration:ci" }],
    ]);
  });

  test("rejects unknown matrix values", () => {
    expect(() => parseAppTestSuite("surprise")).toThrow("Unknown application test suite");
  });
});
