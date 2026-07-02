import { describe, expect, test } from "bun:test";
import type { CodexConversationSnapshot } from "@/lib/types";
import { resolveContextWindowIndicatorState } from "./codex-context-window";

function makeConversation(): CodexConversationSnapshot {
  return {
    threadId: "thr_context",
    projectId: "project-1",
    source: null,
    threadName: "Context thread",
    threadPreview: "",
    modelProvider: "openai",
    cwd: "/tmp/project",
    statusType: "active",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: new Date(0).toISOString(),
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
  };
}

describe("codex context window indicator", () => {
  test("keeps the raw token count when usage exceeds the model context window", () => {
    const conversation = makeConversation();
    conversation.latestTokenUsageInfo = {
      total: {
        totalTokens: 300_000,
        inputTokens: 260_000,
        cachedInputTokens: 10_000,
        outputTokens: 40_000,
        reasoningOutputTokens: 5_000,
      },
      last: {
        totalTokens: 300_000,
        inputTokens: 260_000,
        cachedInputTokens: 10_000,
        outputTokens: 40_000,
        reasoningOutputTokens: 5_000,
      },
      modelContextWindow: 258_000,
    };

    const state = resolveContextWindowIndicatorState(conversation);

    expect(state.status).toBe("ready");
    expect(state.percentFull).toBe(100);
    expect(state.usedTokens).toBe(300_000);
    expect(state.windowTokens).toBe(258_000);
  });

  test("ignores stale token usage while conversation is not resumed", () => {
    const conversation = makeConversation();
    conversation.resumeState = "needs_resume";
    conversation.latestTokenUsageInfo = {
      total: {
        totalTokens: 100,
        inputTokens: 70,
        cachedInputTokens: 0,
        outputTokens: 30,
        reasoningOutputTokens: 5,
      },
      last: {
        totalTokens: 100,
        inputTokens: 70,
        cachedInputTokens: 0,
        outputTokens: 30,
        reasoningOutputTokens: 5,
      },
      modelContextWindow: 1000,
    };

    const state = resolveContextWindowIndicatorState(conversation);

    expect(state.status).toBe("unavailable");
    expect(state.usedTokens).toBe(null);
  });
});
