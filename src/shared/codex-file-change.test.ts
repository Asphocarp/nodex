import { describe, expect, test } from "bun:test";

import {
  buildCodexFileChangeFromProtocol,
  buildCodexFileChangeMap,
  buildCodexFileChangeUnifiedDiff,
  buildCodexTurnDiffFromPatchBatches,
  getCodexFileChangeEntries,
  hasCodexFileChangeEntries,
  resolveCodexPatchSuccess,
} from "./codex-file-change";
import type { CodexFileChangeMap, CodexTurnDiffPatchBatch } from "./types";

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
    expect(diff.includes("diff --git a/src/app.ts b/src/old-app.ts")).toBeTrue();
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

  test("builds path-keyed patch maps with duplicate paths overwriting earlier changes", () => {
    const changes = buildCodexFileChangeMap([
      {
        path: "src/app.ts",
        type: "add",
        content: "first\n",
      },
      {
        path: "src/app.ts",
        type: "update",
        movePath: null,
        unifiedDiff: "@@ -1 +1 @@\n-first\n+second",
      },
    ]);
    const entries = getCodexFileChangeEntries(changes);

    expect(entries.length).toBe(1);
    expect(entries[0]?.[0] ?? "").toBe("src/app.ts");
    expect(entries[0]?.[1].type ?? "").toBe("update");
  });

  test("keeps empty update diffs as renderable patch rows", () => {
    const change = buildCodexFileChangeFromProtocol({
      path: "src/app.ts",
      kind: "update",
      diff: "",
    });
    const diff = change ? buildCodexFileChangeUnifiedDiff(change) : null;

    expect(change?.type ?? null).toBe("update");
    expect(diff?.startsWith("diff --git a/src/app.ts b/src/app.ts") ?? false).toBeTrue();
    expect(diff?.includes("--- a/src/app.ts\n+++ b/src/app.ts") ?? false).toBeTrue();
  });

  test("filters non-canonical patch map entries before rendering", () => {
    const malformedMap = {
      "src/good.ts": { type: "add", content: "ok\n" },
      "": { type: "add", content: "missing path\n" },
      "0": { path: "src/raw.ts", kind: { type: "update" }, diff: "@@ -1 +1 @@" },
    } as unknown as CodexFileChangeMap;
    const rawProtocolArray = [
      { path: "src/raw.ts", kind: { type: "update" }, diff: "@@ -1 +1 @@" },
    ] as unknown as CodexFileChangeMap;

    const entries = getCodexFileChangeEntries(malformedMap);

    expect(entries.length).toBe(1);
    expect(entries[0]?.[0] ?? "").toBe("src/good.ts");
    expect(hasCodexFileChangeEntries(malformedMap)).toBeTrue();
    expect(getCodexFileChangeEntries(rawProtocolArray).length).toBe(0);
    expect(hasCodexFileChangeEntries(rawProtocolArray)).toBeFalse();
  });

  test("builds Codex-style unified diffs from patch map entries", () => {
    const movedDiff = buildCodexFileChangeUnifiedDiff("src/app.ts", {
      type: "update",
      movePath: "src/app-renamed.ts",
      unifiedDiff: "@@ -1 +1 @@\n-old\n+new",
    });
    const emptyCreateDiff = buildCodexFileChangeUnifiedDiff("empty.txt", {
      type: "add",
      content: "",
    });

    expect(Boolean(movedDiff?.startsWith("diff --git a/src/app.ts b/src/app-renamed.ts"))).toBeTrue();
    expect(Boolean(movedDiff?.includes("--- a/src/app.ts\n+++ b/src/app-renamed.ts"))).toBeTrue();
    expect(Boolean(emptyCreateDiff?.includes("new file mode 100644"))).toBeTrue();
    expect(Boolean(emptyCreateDiff?.includes("@@"))).toBeFalse();
  });

  test("maps file-change item status to patch success", () => {
    expect(resolveCodexPatchSuccess("inProgress")).toBe(null);
    expect(resolveCodexPatchSuccess("completed")).toBe(true);
    expect(resolveCodexPatchSuccess("failed")).toBe(false);
    expect(resolveCodexPatchSuccess("declined")).toBe(false);
  });
});
