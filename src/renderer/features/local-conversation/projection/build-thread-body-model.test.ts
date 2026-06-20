import { describe, expect, test } from "bun:test";
import type { CodexConversationItem, CodexConversationSnapshot } from "../../../lib/types";
import { buildThreadBodyModel } from "./build-thread-body-model";

function buildEntry(overrides: Partial<CodexConversationItem>): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "item_1",
    type: "agent_message",
    kind: "assistantMessage",
    semanticKind: "assistantMessage",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildConversation(
  overrides?: Partial<CodexConversationSnapshot>,
): CodexConversationSnapshot {
  return {
    threadId: "thread_1",
    projectId: "project_1",
    source: overrides?.source ?? null,
    threadName: "Thread",
    threadPreview: "Preview",
    modelProvider: "openai",
    cwd: "/tmp/project",
    statusType: "active",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-03-21T00:00:00.000Z",
    resumeState: "resumed",
    turns: [
      {
        threadId: "thread_1",
        turnId: "turn_1",
        status: "inProgress",
        itemIds: ["user_1", "assistant_1"],
        items: [
          buildEntry({
            itemId: "user_1",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            markdownText: "Please refactor this.",
          }),
          buildEntry({
            itemId: "assistant_1",
            type: "assistant_message",
            kind: "assistantMessage",
            role: "assistant",
            markdownText: "Working on it.",
          }),
        ],
      },
    ],
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

describe("buildThreadBodyModel", () => {
  test("returns shell state without eagerly projecting all turn models", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation(),
      parentTurns: [],
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
    });

    expect(model.threadId).toBe("thread_1");
    expect(model.turnCount).toBe(1);
    expect(model.latestTurnId).toBe("turn_1");
    expect(model.activeTurnId).toBe("turn_1");
    expect(model.emptyState.type).toBe("none");
  });

  test("marks active-turn above-composer portal presence without building whole-thread turn arrays", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        turns: [
          {
            threadId: "thread_1",
            turnId: "turn_1",
            status: "inProgress",
            itemIds: ["todo_1", "assistant_1"],
            items: [
              buildEntry({
                itemId: "todo_1",
                type: "todo_list",
                kind: "plan",
                semanticKind: "todoList",
                markdownText: "- [ ] ship it",
              }),
              buildEntry({
                itemId: "assistant_1",
                type: "assistant_message",
                kind: "assistantMessage",
                role: "assistant",
                markdownText: "Still working",
              }),
            ],
          },
        ],
      }),
      parentTurns: [],
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
    });

    expect(model.hasAboveComposerBlocks).toBeTrue();
  });

  test("renders archived threads as restorable instead of resuming", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        archived: true,
        resumeState: "needs_resume",
      }),
      parentTurns: [],
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
    });

    expect(model.threadId).toBe("thread_1");
    expect(model.emptyState.type).toBe("archivedThread");
    if (model.emptyState.type === "archivedThread") {
      expect(model.emptyState.title).toBe("Archived thread");
    }
  });
});
