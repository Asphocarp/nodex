import { describe, expect, test } from "vite-plus/test";
import {
  REVIEW_CAPPED_MATCH_PAGE_SIZE,
  buildReviewVisibleFiles,
  filterReviewFiles,
  getReviewTotalChangedBytes,
  getReviewTotalChangedLines,
  isReviewLargeDiff,
  isReviewWordDiffEnabled,
  resolveReviewSelectedPath,
} from "./review-diff-model";

const FILES = [
  {
    key: "a",
    displayPath: "src/a.ts",
    patchText: "export const alpha = true;",
    additions: 1,
    deletions: 0,
    changedBytes: 25,
  },
  {
    key: "b",
    displayPath: "src/b.ts",
    patchText: "export const beta = true;",
    additions: 2,
    deletions: 1,
    changedBytes: 24,
  },
  {
    key: "c",
    displayPath: "src/c.ts",
    patchText: "export const gamma = true;",
    additions: 3,
    deletions: 2,
    changedBytes: 25,
  },
];

describe("review diff model", () => {
  test("totals changed lines across files", () => {
    expect(getReviewTotalChangedLines(FILES)).toBe(9);
  });

  test("totals changed bytes from per-file metadata", () => {
    expect(getReviewTotalChangedBytes(FILES)).toBe(74);
  });

  test("detects codex-style large diffs", () => {
    expect(
      isReviewLargeDiff({
        fileCount: 129,
        totalChangedLines: 0,
        totalChangedBytes: 0,
      }),
    ).toBe(true);
    expect(
      isReviewLargeDiff({
        fileCount: 1,
        totalChangedLines: 1,
        totalChangedBytes: 1,
      }),
    ).toBe(false);
    expect(
      isReviewLargeDiff({
        fileCount: 128,
        totalChangedLines: 9_000,
        totalChangedBytes: 12 * 1024 * 1024,
      }),
    ).toBe(false);
    expect(
      isReviewLargeDiff({
        fileCount: 1,
        totalChangedLines: 9_001,
        totalChangedBytes: 0,
      }),
    ).toBe(true);
    expect(
      isReviewLargeDiff({
        fileCount: 1,
        totalChangedLines: 0,
        totalChangedBytes: 12 * 1024 * 1024 + 1,
      }),
    ).toBe(true);
  });

  test("disables word diffs above two thousand changed lines", () => {
    expect(isReviewWordDiffEnabled(2_000, true)).toBe(true);
    expect(isReviewWordDiffEnabled(2_001, true)).toBe(false);
    expect(isReviewWordDiffEnabled(1, false)).toBe(false);
  });

  test("detects codex-style single-file large diffs", () => {
    expect(
      isReviewLargeDiff({
        fileCount: 1,
        totalChangedLines: 1,
        totalChangedBytes: 1,
        largestFileChangedLines: 15_001,
      }),
    ).toBe(true);
    expect(
      isReviewLargeDiff({
        fileCount: 1,
        totalChangedLines: 1,
        totalChangedBytes: 1,
        largestFileChangedLines: 15_000,
      }),
    ).toBe(false);
  });

  test("filters review files by file path only", () => {
    expect(filterReviewFiles(FILES, "src/b").length).toBe(1);
  });

  test("keeps an empty file filter separate from uncapped review visibility", () => {
    expect(filterReviewFiles(FILES, "")).toEqual(FILES);
    expect(
      buildReviewVisibleFiles(FILES, null, false, true, REVIEW_CAPPED_MATCH_PAGE_SIZE),
    ).toEqual(FILES);
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
      changedBytes: 6 + String(index).length,
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
});
