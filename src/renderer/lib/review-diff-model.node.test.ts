import { describe, expect, test } from "vitest";
import {
  REVIEW_DEFERRED_RENDER_FALLBACK_COUNT,
  REVIEW_CAPPED_MATCH_PAGE_SIZE,
  buildReviewRenderPlan,
  buildReviewSearchMatches,
  buildReviewVisibleFiles,
  filterReviewFiles,
  getReviewContainIntrinsicSize,
  getReviewTotalChangedBytes,
  getReviewTotalChangedLines,
  isReviewLargeDiff,
  resolveReviewSelectedPath,
} from "./review-diff-model";

const FILES = [
  {
    key: "a",
    displayPath: "src/a.ts",
    patchText: "export const alpha = true;",
    additions: 1,
    deletions: 0,
  },
  {
    key: "b",
    displayPath: "src/b.ts",
    patchText: "export const beta = true;",
    additions: 2,
    deletions: 1,
  },
  {
    key: "c",
    displayPath: "src/c.ts",
    patchText: "export const gamma = true;",
    additions: 3,
    deletions: 2,
  },
];

describe("review diff model", () => {
  test("totals changed lines across files", () => {
    expect(getReviewTotalChangedLines(FILES)).toBe(9);
  });

  test("totals changed bytes from patch text", () => {
    expect(getReviewTotalChangedBytes("hello")).toBe(5);
  });

  test("detects codex-style large diffs", () => {
    expect(isReviewLargeDiff({
      fileCount: 129,
      totalChangedLines: 0,
      totalChangedBytes: 0,
    })).toBe(true);
    expect(isReviewLargeDiff({
      fileCount: 1,
      totalChangedLines: 1,
      totalChangedBytes: 1,
    })).toBe(false);
  });

  test("detects codex-style single-file large diffs", () => {
    expect(isReviewLargeDiff({
      fileCount: 1,
      totalChangedLines: 1,
      totalChangedBytes: 1,
      largestFileChangedLines: 15_001,
    })).toBe(true);
    expect(isReviewLargeDiff({
      fileCount: 1,
      totalChangedLines: 1,
      totalChangedBytes: 1,
      largestFileChangedLines: 15_000,
    })).toBe(false);
  });

  test("filters review files by file path only", () => {
    expect(filterReviewFiles(FILES, "src/b").length).toBe(1);
  });

  test("builds review search matches from loaded file contents", () => {
    const result = buildReviewSearchMatches(FILES, "gamma", {
      "src/c.ts": {
        oldText: "",
        newText: "gamma",
      },
    });

    expect(result.length).toBe(1);
  });

  test("resolves capped selected path to the first visible file", () => {
    expect(resolveReviewSelectedPath(FILES, null, true)).toBe("src/a.ts");
  });

  test("shows only the selected file in capped mode without active search", () => {
    const result = buildReviewVisibleFiles(
      FILES,
      "src/b.ts",
      true,
      false,
      REVIEW_CAPPED_MATCH_PAGE_SIZE,
    );

    expect(result.length).toBe(1);
    expect(result[0]?.displayPath).toBe("src/b.ts");
  });

  test("loads more capped search matches in pages of twenty", () => {
    const manyFiles = Array.from({ length: 25 }, (_, index) => ({
      key: `file-${index}`,
      displayPath: `src/file-${index}.ts`,
      patchText: `file-${index}`,
      additions: 1,
      deletions: 0,
    }));

    const result = buildReviewVisibleFiles(
      manyFiles,
      null,
      true,
      true,
      REVIEW_CAPPED_MATCH_PAGE_SIZE,
    );

    expect(result.length).toBe(20);
  });

  test("defers non-capped review rendering after the first two files", () => {
    const plan = buildReviewRenderPlan(FILES, false);

    expect(plan.shouldDefer).toBe(true);
    expect(plan.visibleFiles.length).toBe(3);
    expect(plan.fallbackFiles.length).toBe(REVIEW_DEFERRED_RENDER_FALLBACK_COUNT);
  });

  test("does not defer capped review rendering", () => {
    const plan = buildReviewRenderPlan(FILES, true);

    expect(plan.shouldDefer).toBe(false);
    expect(plan.fallbackFiles.length).toBe(3);
  });

  test("estimates intrinsic row height using Codex review constants", () => {
    expect(getReviewContainIntrinsicSize(2, 1, "unified")).toBe("auto 116px");
    expect(getReviewContainIntrinsicSize(2, 1, "split")).toBe("auto 176px");
  });
});
