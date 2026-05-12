import { describe, expect, test } from "bun:test";
import type { CodexConversationItem, CodexConversationTurn } from "../../../lib/types";
import { buildTurnRenderModel } from "./build-turn-render-model";

const LIVE_DIFF = [
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,3 @@",
  "-old",
  "+new",
  "+next",
].join("\n");

function buildTurn(overrides: Partial<CodexConversationTurn> = {}): CodexConversationTurn {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    status: "inProgress",
    itemIds: [],
    items: [],
    ...overrides,
  };
}

function buildTurnDiffItem(overrides: Partial<CodexConversationItem> = {}): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "turn-diff:turn_1",
    entryId: "turn-diff:turn_1",
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    status: "inProgress",
    rawItem: {
      type: "turn-diff",
      unifiedDiff: LIVE_DIFF,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildFileChangeItem(overrides: Partial<CodexConversationItem> = {}): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "patch_live",
    entryId: "patch_live",
    type: "file_change",
    kind: "fileChange",
    semanticKind: "patch",
    status: "inProgress",
    fileChange: {
      paths: ["src/app.ts"],
      changes: [{
        type: "add",
        path: "src/app.ts",
        content: "new",
      }],
      diffs: [],
      label: "Created src/app.ts",
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("buildTurnRenderModel", () => {
  test("derives live turn-diff from turn.diff before any fileChange item exists", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({ diff: LIVE_DIFF, itemIds: [], items: [] }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });

    expect(model.aboveComposerBlocks?.map((block) => block.type).join(",") ?? "").toBe("turnDiff");
    expect(model.blocks.map((block) => block.type).join(",")).toBe("thinkingPlaceholder");
    expect(model.searchableText.includes("+next")).toBeFalse();
    const rawItem = model.aboveComposerBlocks?.[0]?.type === "turnDiff"
      ? model.aboveComposerBlocks[0].entry.rawItem as { unifiedDiff?: unknown } | undefined
      : null;
    expect(String(rawItem?.unifiedDiff ?? "").includes("+next")).toBeTrue();
  });

  test("does not duplicate a transcript turn-diff when turn.diff is also present", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        diff: LIVE_DIFF,
        itemIds: ["turn-diff:turn_1"],
        items: [buildTurnDiffItem()],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });

    expect(model.aboveComposerBlocks?.map((block) => block.id).join(",") ?? "").toBe("turn-diff:turn_1");
  });

  test("does not derive the live turn-diff banner when a live fileChange row already represents the draft edit", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        diff: LIVE_DIFF,
        itemIds: ["patch_live"],
        items: [buildFileChangeItem()],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: true,
    });

    expect(model.aboveComposerBlocks?.length ?? 0).toBe(0);
    expect(model.blocks.map((block) => block.type).join(",")).toBe("collapsedToolActivity");
  });

  test("keeps completed derived turn-diff in the trailing body", () => {
    const model = buildTurnRenderModel({
      turn: buildTurn({
        status: "completed",
        diff: LIVE_DIFF,
        itemIds: [],
        items: [],
      }),
      requests: [],
      isLatestTurn: true,
      isStreamingTurn: false,
    });

    expect(model.aboveComposerBlocks?.length ?? 0).toBe(0);
    expect(model.blocks.map((block) => block.type).join(",")).toBe("turnDiff");
  });
});
