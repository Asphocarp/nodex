import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CodexConversationItem } from "../../../../lib/types";

const parsePatchFiles = vi.hoisted(() => vi.fn(() => []));

vi.mock("@pierre/diffs", () => ({ parsePatchFiles }));

import {
  TURN_DIFF_MAX_INLINE_LINES,
  buildTurnDiffRows,
} from "./turn-diff-model";

function buildTurnDiffItem(unifiedDiff: string): CodexConversationItem {
  return {
    threadId: "thread-turn-diff-model",
    turnId: "turn-1",
    itemId: "turn-diff-1",
    entryId: "turn-diff-1",
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    status: "completed",
    rawItem: {
      type: "turn-diff",
      unifiedDiff,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("buildTurnDiffRows", () => {
  beforeEach(() => {
    parsePatchFiles.mockClear();
  });

  test("skips full patch parsing when every file exceeds the inline limit", () => {
    const additions = Array.from(
      { length: TURN_DIFF_MAX_INLINE_LINES + 1 },
      (_, index) => `+line ${index + 1}`,
    );
    const unifiedDiff = [
      "diff --git a/src/generated.ts b/src/generated.ts",
      "--- a/src/generated.ts",
      "+++ b/src/generated.ts",
      `@@ -0,0 +1,${additions.length} @@`,
      ...additions,
    ].join("\n");

    const rows = buildTurnDiffRows(
      buildTurnDiffItem(unifiedDiff),
      "/tmp/project",
      undefined,
    );

    expect(parsePatchFiles).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isTooLarge).toBe(true);
    expect(rows[0]?.additions).toBe(TURN_DIFF_MAX_INLINE_LINES + 1);
    expect(rows[0]?.fileDiff).toBe(null);
  });

  test("parses patches when at least one file can render inline", () => {
    const unifiedDiff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-before",
      "+after",
    ].join("\n");

    buildTurnDiffRows(
      buildTurnDiffItem(unifiedDiff),
      "/tmp/project",
      undefined,
    );

    expect(parsePatchFiles).toHaveBeenCalledTimes(1);
    expect(parsePatchFiles).toHaveBeenCalledWith(unifiedDiff);
  });
});
