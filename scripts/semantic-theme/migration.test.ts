import { describe, expect, test } from "vite-plus/test";

import { collectSemanticMigrationViolations } from "./migration";

describe("semantic theme migration ratchet", () => {
  test("checks class tokens in JSX and class composition without matching prose fragments", () => {
    const policy = {
      path: "fixture.tsx",
      forbiddenClassNames: ["text-token-error-foreground"],
    } as const;
    const violations = collectSemanticMigrationViolations(
      `
      const prose = "prefix-text-token-error-foreground-suffix";
      export const View = () => (
        <div className={cn("flex", failed && "text-token-error-foreground")} />
      );
    `,
      policy,
    );

    expect(violations).toEqual([
      expect.objectContaining({
        className: "text-token-error-foreground",
        line: 4,
      }),
    ]);
  });
});
