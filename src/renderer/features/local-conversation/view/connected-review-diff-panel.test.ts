import { describe, expect, test } from "vite-plus/test";
import type { CodexConversationSnapshot } from "@/lib/types";
import { connectedReviewDiffPanelTestHelpers } from "./connected-review-diff-panel";
import {
  areReviewConversationProjectionsEqual,
  buildReviewConversationProjection,
  createReviewConversationProjectionSelector,
} from "@/features/review/model/review-conversation-projection";

function buildConversation(unifiedDiff: string): CodexConversationSnapshot {
  return {
    threadId: "thread-1",
    projectId: "project-1",
    source: null,
    resumeState: "resumed",
    threadName: "Thread",
    threadPreview: "",
    modelProvider: "openai",
    cwd: "/workspace/nodex",
    statusType: "active",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "",
    turns: [
      {
        threadId: "thread-1",
        turnId: "turn-1",
        status: "inProgress",
        itemIds: ["turn-diff:turn-1"],
        items: [
          {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "turn-diff:turn-1",
            entryId: "turn-diff:turn-1",
            type: "turn-diff",
            kind: "systemEvent",
            semanticKind: "diff",
            status: "inProgress",
            rawItem: {
              type: "turn-diff",
              unifiedDiff,
              cwd: "/workspace/nodex",
              showRevertButton: true,
            },
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    ],
    requests: [],
    pendingSteers: [],
    queuedFollowUps: {
      status: "ready",
      ledgerRevision: 0,
      projectionRevision: 0,
      entries: [],
      inFlightFollowUpId: null,
      editingFollowUpId: null,
      error: null,
    },
    backgroundTerminalRows: [],
    capabilityFlags: {
      canEditLastUserTurn: false,
      canForkFromTurn: false,
      canSearch: false,
      canCollapseTurns: false,
    },
  };
}

describe("connected review diff panel", () => {
  test("keeps the Review projection stable across unrelated agent prose", () => {
    const patch = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new";
    const before = buildConversation(patch);
    const after = structuredClone(before);
    const existingItem = after.turns[0]?.items[0];
    if (!existingItem) throw new Error("Expected a diff item.");
    after.turns[0]?.items.push({
      ...existingItem,
      itemId: "message-2",
      entryId: "message-2",
      rawItem: { text: "Still editing unrelated files." },
      markdownText: "Still editing unrelated files.",
      createdAt: 3,
      updatedAt: 3,
    });

    expect(
      areReviewConversationProjectionsEqual(
        buildReviewConversationProjection(before),
        buildReviewConversationProjection(after),
      ),
    ).toBe(true);

    const changedDiff = buildConversation(patch.replace("+new", "+newer"));
    expect(
      areReviewConversationProjectionsEqual(
        buildReviewConversationProjection(before),
        buildReviewConversationProjection(changedDiff),
      ),
    ).toBe(false);
  });

  test("returns the same projection object across 100 prose-only appends", () => {
    const selector = createReviewConversationProjectionSelector();
    let conversation = buildConversation(
      "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
    );
    const initial = selector(conversation);

    for (let index = 0; index < 100; index += 1) {
      const turn = conversation.turns[0];
      const template = turn?.items[0];
      if (!template) throw new Error("Expected a template item.");
      const proseItem = {
        ...template,
        itemId: `message-${index}`,
        entryId: `message-${index}`,
        rawItem: { text: `Editing progress ${index}` },
        markdownText: `Editing progress ${index}`,
      };
      conversation = {
        ...conversation,
        turns: [...conversation.turns.slice(0, -1), { ...turn, items: [...turn.items, proseItem] }],
      };
      expect(selector(conversation)).toBe(initial);
    }
  });

  test("keeps the previous completed diff when a new prose-only turn starts", () => {
    const selector = createReviewConversationProjectionSelector();
    const conversation = buildConversation(
      "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
    );
    const initial = selector(conversation);
    const priorTurn = conversation.turns[0];
    const template = priorTurn?.items[0];
    if (!priorTurn || !template) throw new Error("Expected a prior turn.");
    const nextConversation: CodexConversationSnapshot = {
      ...conversation,
      turns: [
        priorTurn,
        {
          ...priorTurn,
          turnId: "turn-2",
          status: "inProgress",
          itemIds: ["message-next"],
          items: [
            {
              ...template,
              turnId: "turn-2",
              itemId: "message-next",
              entryId: "message-next",
              type: "message",
              kind: "assistantMessage",
              semanticKind: "assistantMessage",
              rawItem: { text: "Starting another edit." },
              markdownText: "Starting another edit.",
            },
          ],
        },
      ],
    };

    expect(selector(nextConversation)).toBe(initial);
    expect(initial.lastTurnId).toBe("turn-1");
    expect(initial.lastTurnPatch).toContain("+new");
  });

  test("refreshes the selected turn diff when the underlying patch changes", () => {
    const selected = {
      threadId: "thread-1",
      turnId: "turn-1",
      entryId: "turn-diff:turn-1",
    };

    const refreshed = connectedReviewDiffPanelTestHelpers.refreshSelectedTurnDiffTarget(
      selected,
      buildConversation("--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new"),
      null,
    );

    expect(refreshed?.patch.includes("+new") ?? false).toBe(true);
    expect(refreshed?.showRevertButton ?? false).toBe(true);
  });

  test("applies the projectless output scope to the Review projection", () => {
    const mixed = [
      "diff --git a/output/inside.ts b/output/inside.ts",
      "--- a/output/inside.ts",
      "+++ b/output/inside.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/outside.ts b/src/outside.ts",
      "--- a/src/outside.ts",
      "+++ b/src/outside.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    const projection = buildReviewConversationProjection({
      ...buildConversation(mixed),
      projectId: null,
      projectlessOutputDirectory: "/workspace/nodex/output",
    });

    expect(projection.lastTurnPatch).toContain("output/inside.ts");
    expect(projection.lastTurnPatch).not.toContain("src/outside.ts");
  });

  test("resolves a selected derived turn diff when no transcript item exists", () => {
    const base = buildConversation("");
    const turn = base.turns[0];
    if (!turn) throw new Error("Expected a turn");
    const conversation: CodexConversationSnapshot = {
      ...base,
      turns: [
        {
          ...turn,
          itemIds: [],
          items: [],
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
        },
      ],
    };
    const refreshed = connectedReviewDiffPanelTestHelpers.refreshSelectedTurnDiffTarget(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        entryId: "turn-diff:turn-1",
      },
      conversation,
      null,
    );

    expect(refreshed?.patch).toContain("+new");
  });

  test("falls back to the derived turn diff when a matching item is empty", () => {
    const base = buildConversation("");
    const turn = base.turns[0];
    if (!turn) throw new Error("Expected a turn");
    const conversation: CodexConversationSnapshot = {
      ...base,
      turns: [
        {
          ...turn,
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
          items: [
            {
              ...turn.items[0],
              rawItem: {
                type: "turn-diff",
                unifiedDiff: "",
              },
            },
          ],
        },
      ],
    };

    const refreshed = connectedReviewDiffPanelTestHelpers.refreshSelectedTurnDiffTarget(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        entryId: "turn-diff:turn-1",
      },
      conversation,
      null,
    );

    expect(refreshed?.patch).toContain("+new");
  });
});
