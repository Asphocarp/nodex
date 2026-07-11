import { describe, expect, test } from "vitest";
import type { CodexConversationSnapshot, CodexTurnDiffReviewTarget } from "@/lib/types";
import { connectedReviewDiffPanelTestHelpers } from "./connected-review-diff-panel";

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
    turns: [{
      threadId: "thread-1",
      turnId: "turn-1",
      status: "inProgress",
      itemIds: ["turn-diff:turn-1"],
      items: [{
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
      }],
    }],
    requests: [],
    pendingSteers: [],
    queuedFollowUps: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canEditLastUserTurn: false,
      canForkFromTurn: false,
      canSearch: false,
      canCollapseTurns: false,
    },
  };
}

describe("connected review diff panel", () => {
  test("refreshes the selected turn diff when the underlying patch changes", () => {
    const selected: CodexTurnDiffReviewTarget = {
      type: "turnDiff",
      threadId: "thread-1",
      turnId: "turn-1",
      entryId: "turn-diff:turn-1",
      patch: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+older",
      cwd: "/workspace/nodex",
      showRevertButton: false,
    };

    const refreshed = connectedReviewDiffPanelTestHelpers.refreshSelectedTurnDiffTarget(
      selected,
      buildConversation("--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new"),
      null,
    );

    expect(refreshed?.patch.includes("+new") ?? false).toBe(true);
    expect(refreshed?.showRevertButton ?? false).toBe(true);
  });
});
