import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CodexConversationItem } from "../../../../lib/types";

const parsePatchFiles = vi.hoisted(() => vi.fn(() => []));

vi.mock("@pierre/diffs", () => ({ parsePatchFiles }));

import {
  TURN_DIFF_MAX_INLINE_LINES,
  TURN_DIFF_MAX_INLINE_BYTES,
  buildTurnDiffModel,
  classifyInlineTurnDiff,
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

describe("buildTurnDiffModel", () => {
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

    const model = buildTurnDiffModel(
      buildTurnDiffItem(unifiedDiff),
      "/tmp/project",
      undefined,
    );

    expect(parsePatchFiles).not.toHaveBeenCalled();
    expect(model.kind).toBe("tooLarge");
    expect(model.summary.additions).toBe(TURN_DIFF_MAX_INLINE_LINES + 1);
    expect(model.rows).toHaveLength(0);
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

    const model = buildTurnDiffModel(
      buildTurnDiffItem(unifiedDiff),
      "/tmp/project",
      undefined,
    );

    expect(parsePatchFiles).toHaveBeenCalledTimes(1);
    expect(parsePatchFiles).toHaveBeenCalledWith(unifiedDiff);
    expect(model.kind).toBe("inline");
  });

  test("skips parsing when bytes exceed the inline budget before the line budget", () => {
    const unifiedDiff = [
      "diff --git a/src/large.ts b/src/large.ts",
      "--- a/src/large.ts",
      "+++ b/src/large.ts",
      "@@ -0,0 +1 @@",
      `+${"x".repeat(TURN_DIFF_MAX_INLINE_BYTES)}`,
    ].join("\n");

    const model = buildTurnDiffModel(
      buildTurnDiffItem(unifiedDiff),
      "/tmp/project",
      undefined,
    );

    expect(model.kind).toBe("tooLarge");
    expect(model.kind === "tooLarge" ? model.budget.reason : null).toBe("bytes");
    expect(parsePatchFiles).not.toHaveBeenCalled();
  });

  test("keeps byte and line limits inclusive", () => {
    expect(classifyInlineTurnDiff("x".repeat(TURN_DIFF_MAX_INLINE_BYTES)).kind).toBe("withinBudget");
    const byteOverflow = classifyInlineTurnDiff("x".repeat(TURN_DIFF_MAX_INLINE_BYTES + 1));
    expect(byteOverflow.kind).toBe("tooLarge");
    expect(byteOverflow.kind === "tooLarge" ? byteOverflow.reason : null).toBe("bytes");

    const exactLines = `${"x\n".repeat(TURN_DIFF_MAX_INLINE_LINES - 1)}x`;
    expect(classifyInlineTurnDiff(exactLines).kind).toBe("withinBudget");
    const lineOverflow = classifyInlineTurnDiff(`${exactLines}\nx`);
    expect(lineOverflow.kind).toBe("tooLarge");
    expect(lineOverflow.kind === "tooLarge" ? lineOverflow.reason : null).toBe("lines");
  });
});
