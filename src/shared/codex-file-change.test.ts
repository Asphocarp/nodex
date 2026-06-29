import { describe, expect, test } from "bun:test";

import { buildCodexTurnDiffFromPatchBatches } from "./codex-file-change";
import type { CodexTurnDiffPatchBatch } from "./types";

function countDiffGitSections(diff: string, path: string): number {
  return diff.split("\n").filter((line) => line === `diff --git a/${path} b/${path}`).length;
}

describe("codex file change turn diff synthesis", () => {
  test("folds repeated update changes for the same cwd and path into one diff section", () => {
    const batches: CodexTurnDiffPatchBatch[] = [
      {
        cwd: "/repo",
        changes: [{
          type: "update",
          path: "src/app.ts",
          movePath: null,
          unifiedDiff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+intermediate",
        }],
      },
      {
        cwd: "/repo",
        changes: [{
          type: "update",
          path: "src/app.ts",
          movePath: null,
          unifiedDiff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -3 +3 @@\n-before\n+final",
        }],
      },
    ];

    const diff = buildCodexTurnDiffFromPatchBatches(batches);

    expect(countDiffGitSections(diff, "src/app.ts")).toBe(1);
    expect(diff.includes("+intermediate")).toBeTrue();
    expect(diff.includes("+final")).toBeTrue();
    expect(diff.endsWith("\n")).toBeTrue();
  });

  test("keeps identical paths in different cwd scopes separate", () => {
    const batches: CodexTurnDiffPatchBatch[] = [
      {
        cwd: "/repo-a",
        changes: [{
          type: "update",
          path: "src/app.ts",
          movePath: null,
          unifiedDiff: "@@ -1 +1 @@\n-a\n+b",
        }],
      },
      {
        cwd: "/repo-b",
        changes: [{
          type: "update",
          path: "src/app.ts",
          movePath: null,
          unifiedDiff: "@@ -1 +1 @@\n-c\n+d",
        }],
      },
    ];

    const diff = buildCodexTurnDiffFromPatchBatches(batches);

    expect(countDiffGitSections(diff, "src/app.ts")).toBe(2);
  });

  test("does not merge add delete or moved update sections into ordinary updates", () => {
    const batches: CodexTurnDiffPatchBatch[] = [{
      cwd: "/repo",
      changes: [
        {
          type: "update",
          path: "src/app.ts",
          movePath: null,
          unifiedDiff: "@@ -1 +1 @@\n-old\n+new",
        },
        {
          type: "add",
          path: "src/app.ts",
          content: "created\n",
        },
        {
          type: "update",
          path: "src/app.ts",
          movePath: "src/old-app.ts",
          unifiedDiff: "@@ -1 +1 @@\n-before\n+after",
        },
      ],
    }];

    const diff = buildCodexTurnDiffFromPatchBatches(batches);

    expect(countDiffGitSections(diff, "src/app.ts")).toBe(2);
    expect(diff.includes("diff --git a/src/old-app.ts b/src/app.ts")).toBeTrue();
  });

  test("ignores empty invalid changes and returns an empty diff for no material patches", () => {
    const batches: CodexTurnDiffPatchBatch[] = [
      {
        cwd: "/repo",
        changes: [
          { type: "update", path: "src/app.ts", movePath: null, unifiedDiff: "" },
          { type: "unknown", path: "src/app.ts", content: "ignored" },
          null,
        ],
      },
    ];

    expect(buildCodexTurnDiffFromPatchBatches(batches)).toBe("");
  });
});
