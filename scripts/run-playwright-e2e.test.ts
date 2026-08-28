import { describe, expect, test } from "vitest";

import { resolvePlaywrightE2eInvocation } from "./run-playwright-e2e";

describe("Playwright E2E runner arguments", () => {
  test("rejects an npm-style standalone separator before doing any work", () => {
    expect(() =>
      resolvePlaywrightE2eInvocation(["default", "--", "tests/e2e/page-files.spec.ts"]),
    ).toThrow(
      "Do not pass a standalone `--` to `vp run test:e2e`. Use: vp run test:e2e tests/e2e/<spec>.spec.ts",
    );
  });

  test("forwards focused files and real Playwright options", () => {
    expect(
      resolvePlaywrightE2eInvocation(["default", "tests/e2e/page-files.spec.ts", "--workers=1"]),
    ).toMatchObject({
      config: "playwright.e2e.config.ts",
      additionalArguments: ["tests/e2e/page-files.spec.ts", "--workers=1"],
    });
  });

  test("keeps subscription and performance policy in the shared runner", () => {
    expect(resolvePlaywrightE2eInvocation(["subscription"])).toMatchObject({
      config: "playwright.subscription.e2e.config.ts",
      environment: {},
      fixedArguments: [],
    });
    expect(resolvePlaywrightE2eInvocation(["performance"])).toMatchObject({
      config: "playwright.e2e.config.ts",
      environment: { NODEX_E2E_INCLUDE_PERFORMANCE: "1" },
      fixedArguments: ["--grep", expect.stringContaining("large-content surfaces")],
    });
  });
});
