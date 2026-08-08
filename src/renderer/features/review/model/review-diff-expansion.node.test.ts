import { describe, expect, test } from "vitest";
import {
  isReviewDiffExpanded,
  reconcileReviewDiffExpansionSource,
  setAllReviewDiffsExpanded,
  setReviewDiffExpanded,
  toggleReviewDiffExpanded,
  type ReviewDiffExpansionState,
} from "./review-diff-expansion";

function buildExpansionState(
  overrides: Partial<ReviewDiffExpansionState> = {},
): ReviewDiffExpansionState {
  return {
    allDiffsExpanded: true,
    diffExpansionOverrides: [],
    diffExpansionSourceKey: "source:a",
    ...overrides,
  };
}

describe("Review diff expansion", () => {
  test("lets a file override the global expansion state without changing the bulk action", () => {
    const collapsed = setAllReviewDiffsExpanded(buildExpansionState(), false);
    const withOneExpanded = setReviewDiffExpanded(collapsed, "src/a.ts", true);

    expect(withOneExpanded.allDiffsExpanded).toBe(false);
    expect(isReviewDiffExpanded(withOneExpanded, "src/a.ts")).toBe(true);
    expect(isReviewDiffExpanded(withOneExpanded, "src/b.ts")).toBe(false);
    expect(toggleReviewDiffExpanded(withOneExpanded, "src/a.ts"))
      .toEqual(collapsed);
  });

  test("makes newly arriving files inherit the current collapse-all state", () => {
    const collapsed = setAllReviewDiffsExpanded(buildExpansionState(), false);
    const reconciled = reconcileReviewDiffExpansionSource(
      collapsed,
      "source:a",
      new Set(["src/a.ts", "src/new.ts"]),
    );

    expect(isReviewDiffExpanded(reconciled, "src/a.ts")).toBe(false);
    expect(isReviewDiffExpanded(reconciled, "src/new.ts")).toBe(false);
  });

  test("supports intrinsically collapsed rows without changing the global action", () => {
    const state = buildExpansionState();
    const expandedDeletedFile = toggleReviewDiffExpanded(
      state,
      "src/deleted.ts",
      false,
    );

    expect(isReviewDiffExpanded(state, "src/deleted.ts", false)).toBe(false);
    expect(expandedDeletedFile.allDiffsExpanded).toBe(true);
    expect(isReviewDiffExpanded(expandedDeletedFile, "src/deleted.ts", false))
      .toBe(true);
  });

  test("resets expansion on source changes and prunes overrides for removed files", () => {
    const state = buildExpansionState({
      allDiffsExpanded: false,
      diffExpansionOverrides: [
        { key: "src/kept.ts", expanded: true },
        { key: "src/removed.ts", expanded: true },
      ],
    });
    const pruned = reconcileReviewDiffExpansionSource(
      state,
      "source:a",
      new Set(["src/kept.ts"]),
    );
    const reset = reconcileReviewDiffExpansionSource(
      pruned,
      "source:b",
      new Set(["src/kept.ts"]),
    );

    expect(pruned.diffExpansionOverrides).toEqual([
      { key: "src/kept.ts", expanded: true },
    ]);
    expect(reset).toEqual({
      allDiffsExpanded: true,
      diffExpansionOverrides: [],
      diffExpansionSourceKey: "source:b",
    });
  });
});
