import { describe, expect, test } from "vitest";
import {
  resolveVitestTestTier,
  selectTieredTestFiles,
} from "./vitest-test-tier";

const testFiles = {
  defaultExclude: ["browser.test.ts"],
  defaultInclude: ["**/*.test.ts"],
  stressInclude: ["**/*.stress.test.ts"],
} as const;

describe("Vitest test tiers", () => {
  test("keeps stress files out of the ordinary suite", () => {
    expect(selectTieredTestFiles(testFiles, "default")).toEqual({
      exclude: ["browser.test.ts", "**/*.stress.test.ts"],
      include: ["**/*.test.ts"],
      isStress: false,
    });
  });

  test("runs only stress files with the runtime exclusions preserved", () => {
    expect(selectTieredTestFiles(testFiles, "stress")).toEqual({
      exclude: ["browser.test.ts"],
      include: ["**/*.stress.test.ts"],
      isStress: true,
    });
  });

  test("rejects an unknown tier instead of silently changing the suite", () => {
    expect(() => resolveVitestTestTier("slow")).toThrow(
      'NODEX_TEST_TIER must be "default" or "stress"',
    );
  });
});
