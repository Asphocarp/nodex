import { describe, expect, test } from "bun:test";
import { buildCodexConversationSnapshot } from "./codex-conversation-snapshot";
import type { CodexApprovalRequest, CodexThreadDetail } from "../../shared/types";

function buildThreadDetail(overrides?: Partial<CodexThreadDetail>): CodexThreadDetail {
  return {
    threadId: "thread_1",
    projectId: "project_1",
    cardId: "card_1",
    source: null,
    threadName: "Thread",
    threadPreview: "Preview",
    modelProvider: "openai",
    cwd: "/tmp/project",
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-03-22T00:00:00.000Z",
    turns: [
      {
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        itemIds: ["assistant_1", "user_1"],
      },
    ],
    transcript: [
      {
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "assistant_1",
        type: "assistant_message",
        kind: "assistantMessage",
        semanticKind: "assistantMessage",
        role: "assistant",
        sequence: 2,
        markdownText: "Answer",
        createdAt: 2,
        updatedAt: 2,
      },
      {
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "user_1",
        type: "user_message",
        kind: "userMessage",
        semanticKind: "userMessage",
        role: "user",
        sequence: 1,
        markdownText: "Question",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    ...overrides,
  };
}

describe("buildCodexConversationSnapshot", () => {
  test("orders turn items by the canonical turn itemIds instead of transcript sequence", () => {
    const request: CodexApprovalRequest = {
      type: "approval",
      requestId: "approval_1",
      kind: "command",
      projectId: "project_1",
      cardId: "card_1",
      threadId: "thread_1",
      turnId: "turn_1",
      itemId: "assistant_1",
      createdAt: 5,
    };

    const snapshot = buildCodexConversationSnapshot({
      detail: buildThreadDetail(),
      resumeState: "resumed",
      requests: [request],
      capabilityFlags: {
        canEditLastUserTurn: true,
        canForkFromTurn: true,
        canSearch: true,
        canCollapseTurns: true,
      },
    });

    expect(snapshot.turns.length).toBe(1);
    expect(snapshot.turns[0]?.items[0]?.itemId).toBe("assistant_1");
    expect(snapshot.turns[0]?.items[1]?.itemId).toBe("user_1");
    expect(snapshot.requests[0]?.requestId).toBe("approval_1");
    expect(snapshot.capabilityFlags.canSearch).toBeTrue();
  });

  test("appends unknown turn entries after known itemIds using transcript fallback order", () => {
    const snapshot = buildCodexConversationSnapshot({
      detail: buildThreadDetail({
        turns: [
          {
            threadId: "thread_1",
            turnId: "turn_1",
            status: "completed",
            itemIds: ["assistant_1", "user_1"],
          },
        ],
        transcript: [
          ...buildThreadDetail().transcript,
          {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "tool_1",
            type: "function_call",
            kind: "toolCall",
            semanticKind: "toolCall",
            sequence: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      }),
      resumeState: "resumed",
      requests: [],
      capabilityFlags: {
        canEditLastUserTurn: true,
        canForkFromTurn: true,
        canSearch: true,
        canCollapseTurns: true,
      },
    });

    expect(snapshot.turns[0]?.items.length).toBe(3);
    expect(snapshot.turns[0]?.items[0]?.itemId).toBe("assistant_1");
    expect(snapshot.turns[0]?.items[1]?.itemId).toBe("user_1");
    expect(snapshot.turns[0]?.items[2]?.itemId).toBe("tool_1");
  });
});
