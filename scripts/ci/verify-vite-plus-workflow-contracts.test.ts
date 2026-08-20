import { describe, expect, test } from "vite-plus/test";

import { verifyCommandSteps, verifyStaticCheckSteps } from "./verify-vite-plus-workflow-contracts";

describe("Vite+ CI command ownership", () => {
  test("accepts direct vp commands after the shared setup action", () => {
    expect(
      verifyCommandSteps(
        "workflow.job",
        [
          { uses: "./.github/actions/setup-vite-plus" },
          { run: "vp install --frozen-lockfile" },
          { run: "vp run test" },
        ],
        true,
      ),
    ).toBe(2);
  });

  test("rejects package-manager indirection", () => {
    expect(() =>
      verifyCommandSteps(
        "workflow.job",
        [{ uses: "./.github/actions/setup-vite-plus" }, { run: "pnpm exec vp run test" }],
        true,
      ),
    ).toThrow(/invokes pnpm directly/u);
  });

  test("rejects vp commands before setup", () => {
    expect(() => verifyCommandSteps("workflow.job", [{ run: "vp run test" }], true)).toThrow(
      /invokes vp before/u,
    );
  });

  test("requires CI to run the integrated check before static contracts", () => {
    expect(() =>
      verifyStaticCheckSteps("workflow.static-contracts", [
        { run: "vp exec tsx scripts/ci/run-timed.ts -- vp check" },
        { run: "vp exec tsx scripts/ci/run-timed.ts -- vp run verify:static:contracts" },
      ]),
    ).not.toThrow();

    expect(() =>
      verifyStaticCheckSteps("workflow.static-contracts", [
        { run: "vp run verify:static:contracts" },
      ]),
    ).toThrow(/must run vp check directly/u);

    expect(() =>
      verifyStaticCheckSteps("workflow.static-contracts", [
        { run: "vp run verify:static:contracts" },
        { run: "vp check" },
      ]),
    ).toThrow(/before static contracts/u);
  });
});
