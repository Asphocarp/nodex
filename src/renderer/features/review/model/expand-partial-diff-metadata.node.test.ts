import { describe, expect, test } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { expandPartialDiffMetadata } from "./expand-partial-diff-metadata";

const PATCH = [
  "diff --git a/example.ts b/example.ts",
  "index 1111111..2222222 100644",
  "--- a/example.ts",
  "+++ b/example.ts",
  "@@ -2,3 +2,3 @@",
  " a",
  "-b",
  "+B",
  " c",
  "@@ -6,2 +6,2 @@",
  " d",
  "-tail",
  "+tail2",
  "",
].join("\n");

const DELETION_LINES = [
  "zero\n",
  "a\n",
  "b\n",
  "c\n",
  "middle\n",
  "d\n",
  "tail\n",
  "after\n",
];
const ADDITION_LINES = [
  "zero\n",
  "a\n",
  "B\n",
  "c\n",
  "middle\n",
  "d\n",
  "tail2\n",
  "after\n",
];

function parseMetadata(): FileDiffMetadata {
  const metadata = parsePatchFiles(PATCH).flatMap((patch) => patch.files)[0];
  if (!metadata) throw new Error("Expected the test patch to contain one file");
  return metadata;
}

describe("expandPartialDiffMetadata", () => {
  test("expands partial hunk indices without recomputing a full-file diff", () => {
    const metadata = parseMetadata();
    const result = expandPartialDiffMetadata(
      metadata,
      DELETION_LINES,
      ADDITION_LINES,
    );

    expect(result).not.toBeNull();
    expect(result?.isPartial).toBe(false);
    expect(result?.deletionLines).toEqual(DELETION_LINES);
    expect(result?.additionLines).toEqual(ADDITION_LINES);
    expect(result?.cacheKey).toBe(
      `${metadata.cacheKey ?? metadata.name}:full:${metadata.prevObjectId ?? "none"}:${metadata.newObjectId ?? "none"}`,
    );
    expect(result?.hunks.map((hunk) => ({
      additionLineIndex: hunk.additionLineIndex,
      deletionLineIndex: hunk.deletionLineIndex,
      collapsedBefore: hunk.collapsedBefore,
      splitLineStart: hunk.splitLineStart,
      unifiedLineStart: hunk.unifiedLineStart,
    }))).toEqual([
      {
        additionLineIndex: 1,
        deletionLineIndex: 1,
        collapsedBefore: 1,
        splitLineStart: 1,
        unifiedLineStart: 1,
      },
      {
        additionLineIndex: 5,
        deletionLineIndex: 5,
        collapsedBefore: 1,
        splitLineStart: 5,
        unifiedLineStart: 6,
      },
    ]);
    expect(result?.splitLineCount).toBe(8);
    expect(result?.unifiedLineCount).toBe(10);
  });

  test("rejects mismatched collapsed and trailing context", () => {
    const metadata = parseMetadata();

    expect(expandPartialDiffMetadata(
      metadata,
      DELETION_LINES,
      ["different", ...ADDITION_LINES.slice(1)],
    )).toBeNull();
    expect(expandPartialDiffMetadata(
      metadata,
      DELETION_LINES,
      [...ADDITION_LINES.slice(0, -1), "different-tail\n"],
    )).toBeNull();
    expect(expandPartialDiffMetadata(
      metadata,
      [...DELETION_LINES, "old-only"],
      ADDITION_LINES,
    )).toBeNull();
  });

  test("rejects partial hunk content that does not match the full files", () => {
    const metadata = parseMetadata();
    const changedDeletionLines = [...DELETION_LINES];
    changedDeletionLines[2] = "not-the-deleted-line";

    expect(expandPartialDiffMetadata(
      metadata,
      changedDeletionLines,
      ADDITION_LINES,
    )).toBeNull();
  });

  test("optionally ignores whitespace while validating context and hunks", () => {
    const metadata = parseMetadata();
    const whitespaceDeletionLines = DELETION_LINES.map((line) => `  ${line.trimEnd()}\t\n`);
    const whitespaceAdditionLines = ADDITION_LINES.map((line) => `${line.trimEnd()} \n`);

    expect(expandPartialDiffMetadata(
      metadata,
      whitespaceDeletionLines,
      whitespaceAdditionLines,
    )).toBeNull();
    expect(expandPartialDiffMetadata(
      metadata,
      whitespaceDeletionLines,
      whitespaceAdditionLines,
      { ignoreWhitespace: true },
    )).not.toBeNull();
  });
});
