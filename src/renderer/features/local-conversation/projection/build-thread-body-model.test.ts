import { describe, expect, test } from "bun:test";
import type { CodexConversationItem, CodexConversationSnapshot } from "../../../lib/types";
import { buildThreadBodyModel } from "./build-thread-body-model";
import type { ThreadTranscriptBlockModel } from "../thread-stage-types";

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

function buildConversation(overrides?: Partial<CodexConversationSnapshot>): CodexConversationSnapshot {
  return {
    threadId: "thread_1",
    projectId: "project_1",
    cardId: "card_1",
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
  test("suppresses the live status placeholder when the streaming turn is blocked by a pending request", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        requests: [
          {
            type: "approval",
            requestId: "approval_1",
            kind: "command",
            projectId: "project_1",
            cardId: "card_1",
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant_1",
            createdAt: 10,
          },
        ],
      }),
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
      pendingRequestSurface: null,
    });

    expect(model.turns.length).toBe(1);
    expect(model.turns[0]?.isBlocked).toBeTrue();
    expect(model.turns[0]?.blocks.some((block) => block.type === "thinkingPlaceholder")).toBeFalse();
  });

  test("keeps completed reasoning blocks visible in the mounted thread body", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        statusType: "idle",
        turns: [
          {
            threadId: "thread_1",
            turnId: "turn_1",
            status: "completed",
            itemIds: ["reasoning_1", "assistant_1"],
            items: [
              buildEntry({
                itemId: "reasoning_1",
                type: "reasoning",
                kind: "reasoning",
                semanticKind: "reasoning",
                status: "completed",
                markdownText: "Private chain of thought",
              }),
              buildEntry({
                itemId: "assistant_1",
                type: "assistant_message",
                kind: "assistantMessage",
                role: "assistant",
                markdownText: "Public answer",
              }),
            ],
          },
        ],
      }),
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
      pendingRequestSurface: null,
    });

    expect(model.turns.length).toBe(1);
    expect(model.turns[0]?.blocks.map((block) => block.type).join(",")).toBe("reasoning,assistantMessage");
  });

  test("treats incomplete MCP elicitation items as blocked turn state", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        turns: [
          {
            threadId: "thread_1",
            turnId: "turn_1",
            status: "inProgress",
            itemIds: ["elicitation_1", "assistant_1"],
            items: [
              buildEntry({
                itemId: "elicitation_1",
                type: "mcp_server_elicitation",
                kind: "toolCall",
                semanticKind: "mcpServerElicitation",
                status: "inProgress",
                toolCall: {
                  subtype: "mcp",
                  toolName: "ask_server",
                },
              }),
              buildEntry({
                itemId: "assistant_1",
                type: "assistant_message",
                kind: "assistantMessage",
                role: "assistant",
                markdownText: "Waiting on server input.",
              }),
            ],
          },
        ],
      }),
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
      pendingRequestSurface: null,
    });

    expect(model.turns.length).toBe(1);
    expect(model.turns[0]?.isBlocked).toBeTrue();
    expect(model.turns[0]?.blocks.some((block) => block.type === "thinkingPlaceholder")).toBeFalse();
  });

  test("keeps commentary and worked-for ahead of the final assistant like Codex Electron", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        turns: [
          {
            threadId: "thread_1",
            turnId: "turn_1",
            status: "completed",
            itemIds: ["user_1", "exec_1", "commentary_1", "assistant_1"],
            items: [
              buildEntry({
                itemId: "user_1",
                createdAt: 1_000,
                updatedAt: 1_000,
                type: "user_message",
                kind: "userMessage",
                semanticKind: "userMessage",
                role: "user",
                markdownText: "run bun test",
              }),
              buildEntry({
                itemId: "exec_1",
                createdAt: 2_000,
                updatedAt: 2_000,
                type: "command_execution",
                kind: "commandExecution",
                semanticKind: "exec",
                toolCall: {
                  subtype: "command",
                  toolName: "exec_command",
                },
              }),
              buildEntry({
                itemId: "commentary_1",
                createdAt: 3_000,
                updatedAt: 3_000,
                type: "assistant_message",
                kind: "assistantMessage",
                semanticKind: "assistantMessage",
                assistantPhase: "commentary",
                role: "assistant",
                markdownText: "Running the test suite.",
              }),
              buildEntry({
                itemId: "assistant_1",
                createdAt: 4_000,
                updatedAt: 4_000,
                type: "assistant_message",
                kind: "assistantMessage",
                semanticKind: "assistantMessage",
                assistantPhase: "final_answer",
                role: "assistant",
                markdownText: "`bun test` passed.",
              }),
            ],
          },
        ],
      }),
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
      pendingRequestSurface: null,
    });

    expect(model.turns[0]?.blocks.map((block) => block.type).join(",")).toBe(
      "userMessage,exec,assistantMessage,workedFor,assistantMessage",
    );
    const assistantBlocks = model.turns[0]?.blocks.filter((block) => block.type === "assistantMessage") as
      ThreadTranscriptBlockModel[] | undefined;
    expect(assistantBlocks?.[0]?.id ?? "").toBe("commentary_1");
    expect(assistantBlocks?.[1]?.id ?? "").toBe("assistant_1");
    const workedForBlock = model.turns[0]?.blocks.find((block) => block.type === "workedFor") as
      ThreadTranscriptBlockModel | undefined;
    expect(workedForBlock?.entry.timeLabel ?? "").toBe("3s");
  });

  test("shows assistant copy actions only on the final assistant lane", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        statusType: "idle",
        turns: [
          {
            threadId: "thread_1",
            turnId: "turn_1",
            status: "completed",
            itemIds: ["user_1", "commentary_1", "assistant_1"],
            items: [
              buildEntry({
                itemId: "user_1",
                type: "user_message",
                kind: "userMessage",
                semanticKind: "userMessage",
                role: "user",
                markdownText: "Summarize the diff.",
              }),
              buildEntry({
                itemId: "commentary_1",
                type: "assistant_message",
                kind: "assistantMessage",
                semanticKind: "assistantMessage",
                assistantPhase: "commentary",
                role: "assistant",
                markdownText: "Inspecting the patch.",
              }),
              buildEntry({
                itemId: "assistant_1",
                type: "assistant_message",
                kind: "assistantMessage",
                semanticKind: "assistantMessage",
                assistantPhase: "final_answer",
                role: "assistant",
                markdownText: "Here is the summary.",
              }),
            ],
          },
        ],
      }),
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
      pendingRequestSurface: null,
    });

    const assistantBlocks = model.turns[0]?.blocks.filter(
      (block): block is ThreadTranscriptBlockModel => block.type === "assistantMessage",
    ) ?? [];

    expect(assistantBlocks.length).toBe(2);
    expect(Boolean(assistantBlocks[0]?.showAssistantMessageActions)).toBeFalse();
    expect(assistantBlocks[1]?.showAssistantMessageActions).toBeTrue();
  });

  test("does not show assistant copy actions when a later user follow-up displaces the final-assistant lane", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        statusType: "idle",
        turns: [
          {
            threadId: "thread_1",
            turnId: "turn_1",
            status: "completed",
            itemIds: ["user_1", "assistant_1", "user_follow_up"],
            items: [
              buildEntry({
                itemId: "user_1",
                type: "user_message",
                kind: "userMessage",
                semanticKind: "userMessage",
                role: "user",
                markdownText: "Refactor the view model.",
              }),
              buildEntry({
                itemId: "assistant_1",
                type: "assistant_message",
                kind: "assistantMessage",
                semanticKind: "assistantMessage",
                assistantPhase: "final_answer",
                role: "assistant",
                markdownText: "Refactor complete.",
              }),
              buildEntry({
                itemId: "user_follow_up",
                type: "user_message",
                kind: "userMessage",
                semanticKind: "userMessage",
                role: "user",
                markdownText: "Also tighten the tests.",
              }),
            ],
          },
        ],
      }),
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
      pendingRequestSurface: null,
    });

    const assistantBlock = model.turns[0]?.blocks.find(
      (block): block is ThreadTranscriptBlockModel => block.type === "assistantMessage",
    );

    expect(assistantBlock?.id).toBe("assistant_1");
    expect(Boolean(assistantBlock?.showAssistantMessageActions)).toBeFalse();
  });

  test("assigns edit only to the latest eligible user message and fork to every eligible completed user message", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        statusType: "idle",
        turns: [
          {
            threadId: "thread_1",
            turnId: "turn_older",
            status: "completed",
            itemIds: ["user_older_1", "assistant_older"],
            items: [
              buildEntry({
                itemId: "user_older_1",
                type: "user_message",
                kind: "userMessage",
                semanticKind: "userMessage",
                role: "user",
                markdownText: "Older user message",
              }),
              buildEntry({
                itemId: "assistant_older",
                type: "assistant_message",
                kind: "assistantMessage",
                semanticKind: "assistantMessage",
                role: "assistant",
                markdownText: "Older answer",
              }),
            ],
          },
          {
            threadId: "thread_1",
            turnId: "turn_latest",
            status: "completed",
            itemIds: ["user_latest_1", "user_latest_2", "assistant_latest"],
            items: [
              buildEntry({
                itemId: "user_latest_1",
                turnId: "turn_latest",
                type: "user_message",
                kind: "userMessage",
                semanticKind: "userMessage",
                role: "user",
                markdownText: "First latest user message",
              }),
              buildEntry({
                itemId: "user_latest_2",
                turnId: "turn_latest",
                type: "user_message",
                kind: "userMessage",
                semanticKind: "userMessage",
                role: "user",
                markdownText: "Second latest user message",
              }),
              buildEntry({
                itemId: "assistant_latest",
                turnId: "turn_latest",
                type: "assistant_message",
                kind: "assistantMessage",
                semanticKind: "assistantMessage",
                role: "assistant",
                markdownText: "Latest answer",
              }),
            ],
          },
        ],
      }),
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
      pendingRequestSurface: null,
    });

    const olderTurnUserBlock = model.turns[0]?.blocks.find((block): block is ThreadTranscriptBlockModel => block.type === "userMessage");
    const latestTurnUserBlocks = model.turns[1]?.blocks.filter(
      (block): block is ThreadTranscriptBlockModel => block.type === "userMessage",
    ) ?? [];

    expect(olderTurnUserBlock?.userMessageActions?.canFork).toBeTrue();
    expect(olderTurnUserBlock?.userMessageActions?.canEdit).toBeFalse();
    expect(latestTurnUserBlocks[0]?.userMessageActions?.canFork).toBeTrue();
    expect(latestTurnUserBlocks[0]?.userMessageActions?.canEdit).toBeFalse();
    expect(latestTurnUserBlocks[1]?.userMessageActions?.canFork).toBeTrue();
    expect(latestTurnUserBlocks[1]?.userMessageActions?.canEdit).toBeTrue();
  });

  test("keeps file-edit patch rows in the turn body while porting turn diff above the composer", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        turns: [
          {
            threadId: "thread_1",
            turnId: "turn_1",
            status: "inProgress",
            itemIds: ["todo_1", "plan_1", "patch_1", "diff_1"],
            items: [
              buildEntry({
                itemId: "todo_1",
                type: "plan",
                kind: "plan",
                semanticKind: "todoList",
                markdownText: "- [ ] Audit above-composer lanes",
              }),
              buildEntry({
                itemId: "plan_1",
                type: "plan",
                kind: "plan",
                semanticKind: "proposedPlan",
                markdownText: "1. Split the lanes",
              }),
              buildEntry({
                itemId: "patch_1",
                type: "file_change",
                kind: "fileChange",
                semanticKind: "patch",
                toolCall: {
                  subtype: "fileChange",
                  toolName: "file_change",
                  result: {
                    diff: "@@ -1 +1 @@\n-old\n+new",
                  },
                },
              }),
              buildEntry({
                itemId: "diff_1",
                type: "turn_diff",
                kind: "systemEvent",
                semanticKind: "diff",
                rawItem: {
                  type: "turn-diff",
                  unifiedDiff: "@@ -1 +1 @@\n-old\n+new",
                },
              }),
            ],
          },
        ],
      }),
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
      pendingRequestSurface: null,
    });

    expect(model.turns[0]?.aboveComposerBlocks?.map((block) => block.type).join(",")).toBe("todoList,turnDiff");
    expect(model.turns[0]?.blocks.map((block) => block.type).join(",")).toBe("patch,proposedPlan");
  });

  test("shows user actions only on the leading user-message prefix, not on later steer messages", () => {
    const model = buildThreadBodyModel({
      activeThreadId: "thread_1",
      conversation: buildConversation({
        statusType: "idle",
        turns: [
          {
            threadId: "thread_1",
            turnId: "turn_latest",
            status: "completed",
            itemIds: ["user_initial", "exec_1", "user_steer", "assistant_final"],
            items: [
              buildEntry({
                itemId: "user_initial",
                turnId: "turn_latest",
                type: "user_message",
                kind: "userMessage",
                semanticKind: "userMessage",
                role: "user",
                markdownText: "Initial prompt",
              }),
              buildEntry({
                itemId: "exec_1",
                turnId: "turn_latest",
                type: "command_execution",
                kind: "commandExecution",
                semanticKind: "exec",
                role: "assistant",
                markdownText: "Ran tests",
              }),
              buildEntry({
                itemId: "user_steer",
                turnId: "turn_latest",
                type: "user_message",
                kind: "userMessage",
                semanticKind: "userMessage",
                role: "user",
                markdownText: "Actually tighten the spacing too.",
              }),
              buildEntry({
                itemId: "assistant_final",
                turnId: "turn_latest",
                type: "assistant_message",
                kind: "assistantMessage",
                semanticKind: "assistantMessage",
                role: "assistant",
                markdownText: "Done.",
              }),
            ],
          },
        ],
      }),
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
      pendingRequestSurface: null,
    });

    const userBlocks = model.turns[0]?.blocks.filter(
      (block): block is ThreadTranscriptBlockModel => block.type === "userMessage",
    ) ?? [];

    expect(userBlocks.length).toBe(2);
    expect(userBlocks[0]?.entry.itemId).toBe("user_initial");
    expect(userBlocks[0]?.userMessageActions?.canEdit).toBeTrue();
    expect(userBlocks[0]?.userMessageActions?.canFork).toBeTrue();
    expect(userBlocks[1]?.entry.itemId).toBe("user_steer");
    expect(Boolean(userBlocks[1]?.userMessageActions)).toBeFalse();
  });
});
