import { describe, expect, test } from "bun:test";
import {
  createInitialLocalConversationStoreState,
  localConversationStoreReducer,
} from "./local-conversation-store";
import type { CodexConversationSnapshot } from "../../lib/types";

function buildConversationSnapshot(
  overrides?: Partial<CodexConversationSnapshot>,
): CodexConversationSnapshot {
  return {
    threadId: "thread_1",
    projectId: "project_1",
    cardId: "card_1",
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
    resumeState: "resumed",
    turns: [],
    requests: [],
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canEditLastUserTurn: true,
      canForkFromTurn: true,
      canSearch: true,
      canCollapseTurns: true,
    },
    ...overrides,
  };
}

describe("local-conversation-store", () => {
  test("stores snapshots from host messages and keeps project thread order", () => {
    const initial = createInitialLocalConversationStoreState();

    const withFirst = localConversationStoreReducer(initial, {
      type: "hostMessage",
      message: {
        type: "conversationSnapshot",
        conversation: buildConversationSnapshot(),
      },
    });

    const withSecond = localConversationStoreReducer(withFirst, {
      type: "hostMessage",
      message: {
        type: "conversationSnapshot",
        conversation: buildConversationSnapshot({
          threadId: "thread_2",
          threadName: "Second",
          updatedAt: 10,
        }),
      },
    });

    expect(withSecond.conversationsById.thread_1?.threadId).toBe("thread_1");
    expect(withSecond.threadSummariesByProject.project_1?.[0]?.threadId).toBe("thread_2");
    expect(withSecond.threadSummariesByProject.project_1?.length).toBe(2);
  });

  test("mirrors connection and error host messages", () => {
    const initial = createInitialLocalConversationStoreState();

    const withConnection = localConversationStoreReducer(initial, {
      type: "hostMessage",
      message: {
        type: "connection",
        connection: {
          status: "connected",
          retries: 1,
        },
      },
    });

    const withError = localConversationStoreReducer(withConnection, {
      type: "hostMessage",
      message: {
        type: "error",
        message: "Could not sync conversation",
        detail: "network timeout",
      },
    });

    expect(withError.connection.status).toBe("connected");
    expect(withError.errorMessage).toBe("Could not sync conversation: network timeout");
  });

  test("merges rate-limit host messages into the account snapshot instead of keeping duplicate state", () => {
    const initial = localConversationStoreReducer(createInitialLocalConversationStoreState(), {
      type: "hostMessage",
      message: {
        type: "account",
        account: {
          account: { type: "chatgpt", email: "dev@example.com", planType: "Plus" },
          requiresOpenAiAuth: false,
          pendingLogin: null,
          rateLimits: null,
        },
      },
    });

    const next = localConversationStoreReducer(initial, {
      type: "hostMessage",
      message: {
        type: "rateLimits",
        rateLimits: {
          primary: {
            usedPercent: 50,
            windowDurationMins: 60,
            resetsAt: 1_742_732_800_000,
          },
        },
      },
    });

    expect(next.account?.rateLimits?.primary?.usedPercent).toBe(50);
  });

  test("stores and consumes one-shot composer intents by thread id", () => {
    const withIntent = localConversationStoreReducer(createInitialLocalConversationStoreState(), {
      type: "setComposerIntent",
      threadId: "thread_1",
      composerIntent: {
        prompt: "Refine this answer",
        focusNonce: 42,
      },
    });

    expect(withIntent.composerIntentsByThread.thread_1?.prompt).toBe("Refine this answer");

    const consumed = localConversationStoreReducer(withIntent, {
      type: "consumeComposerIntent",
      threadId: "thread_1",
      focusNonce: 42,
    });

    expect(Boolean(consumed.composerIntentsByThread.thread_1)).toBeFalse();
  });
});
