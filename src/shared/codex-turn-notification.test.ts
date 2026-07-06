import { describe, expect, test } from "bun:test";
import {
  hasCodexPendingContinuation,
  isCodexConversationDesktopNotificationEligible,
  parseCodexHeartbeatAssistantMessage,
} from "./codex-turn-notification";
import type { CodexConversationSnapshot } from "./types";

function baseConversation(overrides: Partial<CodexConversationSnapshot> = {}): CodexConversationSnapshot {
  return {
    threadId: "thread-1",
    projectId: "project-1",
    source: null,
    ephemeral: false,
    threadSource: null,
    threadName: null,
    threadPreview: "",
    modelProvider: "openai",
    cwd: "/tmp/project",
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    linkedAt: new Date(0).toISOString(),
    latestCollaborationMode: {
      mode: "default",
      settings: {
        model: "",
        reasoning_effort: null,
        developer_instructions: null,
      },
    },
    latestThreadSettings: null,
    latestTokenUsageInfo: null,
    threadGoal: null,
    completedThreadGoal: null,
    threadGoalResumeConfirmation: null,
    resumeState: "resumed",
    turns: [],
    requests: [],
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canEditLastUserTurn: false,
      canForkFromTurn: false,
      canSearch: true,
      canCollapseTurns: true,
    },
    ...overrides,
  };
}

describe("codex-turn-notification helpers", () => {
  test("parses heartbeat notification decisions and removes heartbeat from visible text", () => {
    const heartbeat = parseCodexHeartbeatAssistantMessage([
      "Visible summary.",
      "<heartbeat>",
      "<decision>NOTIFY</decision>",
      "<message>Review this now</message>",
      "</heartbeat>",
    ].join("\n"));

    expect(heartbeat?.decision).toBe("NOTIFY");
    expect(heartbeat?.notificationMessage).toBe("Review this now");
    expect(heartbeat?.visibleText).toBe("Visible summary.");

    const suppressed = parseCodexHeartbeatAssistantMessage([
      "No user-visible alert.",
      "<heartbeat><decision>DONT_NOTIFY</decision></heartbeat>",
    ].join("\n"));
    expect(suppressed?.decision).toBe("DONT_NOTIFY");
  });

  test("detects notification-ineligible internal and side conversations", () => {
    expect(isCodexConversationDesktopNotificationEligible(baseConversation())).toBeTrue();
    expect(isCodexConversationDesktopNotificationEligible(baseConversation({ ephemeral: true }))).toBeFalse();
    expect(isCodexConversationDesktopNotificationEligible(baseConversation({ threadSource: "system" }))).toBeFalse();
    expect(isCodexConversationDesktopNotificationEligible(baseConversation({
      source: { parentThreadId: "parent", sideConversation: true },
    }))).toBeFalse();
  });

  test("detects pending continuation from queues, steers, and active goals", () => {
    expect(hasCodexPendingContinuation(baseConversation())).toBeFalse();
    expect(hasCodexPendingContinuation(baseConversation({
      queuedFollowUps: [{
        followUpId: "follow-1",
        threadId: "thread-1",
        prompt: "Continue",
        createdAt: 1,
        serviceTier: null,
      }],
    }))).toBeTrue();
    expect(hasCodexPendingContinuation(baseConversation({
      queuedFollowUps: [{
        followUpId: "follow-1",
        threadId: "thread-1",
        prompt: "Continue",
        createdAt: 1,
        serviceTier: null,
        pausedReason: "waiting",
      }],
    }))).toBeFalse();
    expect(hasCodexPendingContinuation(baseConversation({
      pendingSteers: [{
        steerId: "steer-1",
        threadId: "thread-1",
        turnId: "turn-1",
        prompt: "Use this direction",
        createdAt: 1,
      }],
    }))).toBeTrue();
    expect(hasCodexPendingContinuation(baseConversation({
      threadGoal: {
        threadId: "thread-1",
        objective: "Finish the task",
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    }))).toBeTrue();
  });
});
