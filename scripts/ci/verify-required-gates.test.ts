import { describe, expect, test } from "vitest";

import { verifyRequiredGates } from "./verify-required-gates";

describe("required CI gate verification", () => {
  test("accepts successful selected gates and ignores unselected skipped jobs", () => {
    expect(() => verifyRequiredGates({
      classifierResult: "success",
      results: {
        "app-tests": "success",
        "release-transition": "skipped",
        "rust-pr": "skipped",
      },
      selectedGates: ["app-tests"],
    })).not.toThrow();
  });

  test.each(["failure", "cancelled", "skipped"] as const)(
    "rejects a selected gate with %s result",
    (result) => {
      expect(() => verifyRequiredGates({
        classifierResult: "success",
        results: { "app-tests": result },
        selectedGates: ["app-tests"],
      })).toThrow(`app-tests finished with ${result}`);
    },
  );

  test("rejects classifier failure and missing selected results", () => {
    expect(() => verifyRequiredGates({
      classifierResult: "failure",
      results: {},
      selectedGates: [],
    })).toThrow("classify finished with failure");
    expect(() => verifyRequiredGates({
      classifierResult: "success",
      results: {},
      selectedGates: ["release-transition"],
    })).toThrow("release-transition has no GitHub job result");
  });

  test("supports the narrow release transition mode", () => {
    expect(() => verifyRequiredGates({
      classifierResult: "success",
      results: { "release-transition": "success" },
      selectedGates: ["release-transition"],
    })).not.toThrow();
  });
});
