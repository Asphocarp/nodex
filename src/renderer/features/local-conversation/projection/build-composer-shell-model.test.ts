import { describe, expect, test } from "bun:test";
import type { CodexConversationSnapshot } from "../../../lib/types";
import { buildComposerShellModel } from "./build-composer-shell-model";

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
    statusType: "active",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 1,
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

describe("buildComposerShellModel", () => {
  test("merges queue rows, background terminals, active request, and first child approval", () => {
    const model = buildComposerShellModel({
      conversation: buildConversationSnapshot({
        requests: [
          {
            type: "userInput",
            requestId: "user_input_active",
            projectId: "project_1",
            cardId: "card_1",
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "item_1",
            createdAt: 10,
            questions: [],
          },
        ],
        pendingSteers: [
          {
            steerId: "steer_1",
            threadId: "thread_1",
            turnId: "turn_1",
            prompt: "Focus on the renderer.",
            createdAt: 20,
          },
        ],
        queuedFollowUps: [
          {
            followUpId: "follow_up_1",
            threadId: "thread_1",
            prompt: "Run validation next.",
            createdAt: 30,
            collaborationMode: "default",
          },
        ],
        backgroundTerminalRows: [
          {
            rowId: "row_1",
            threadId: "thread_2",
            stream: "stdout",
            text: "child agent still running",
            createdAt: 40,
          },
        ],
        childMemberships: [
          {
            threadId: "thread_2",
            parentThreadId: "thread_1",
            role: "backgroundChild",
            actorName: "Worker 1",
          },
        ],
      }),
      knownConversationsById: {
        thread_1: buildConversationSnapshot(),
        thread_2: buildConversationSnapshot({
          threadId: "thread_2",
          requests: [
            {
              type: "approval",
              requestId: "approval_background",
              kind: "command",
              projectId: "project_1",
              cardId: "card_1",
              threadId: "thread_2",
              turnId: "turn_2",
              itemId: "item_2",
              createdAt: 5,
            },
          ],
          statusActiveFlags: ["waitingOnApproval"],
        }),
      },
    });

    expect(model.activeRequest?.request.requestId).toBe("user_input_active");
    expect(model.backgroundRequest?.request.requestId).toBe("approval_background");
    expect(model.pendingSteers.length).toBe(1);
    expect(model.queuedFollowUps.length).toBe(1);
    expect(model.backgroundTerminalRows.length).toBe(1);
    expect(model.backgroundAgentRows.length).toBe(1);
    expect(model.backgroundAgentRows[0]?.status).toBe("waiting");
    expect(model.showRequestCards).toBeTrue();
    expect(model.showComposer).toBeFalse();
  });

  test("keeps child approval selection in membership order", () => {
    const model = buildComposerShellModel({
      conversation: buildConversationSnapshot({
        childMemberships: [
          {
            threadId: "thread_b",
            parentThreadId: "thread_1",
            role: "childApproval",
            actorName: "Worker B",
          },
          {
            threadId: "thread_a",
            parentThreadId: "thread_1",
            role: "childApproval",
            actorName: "Worker A",
          },
        ],
      }),
      knownConversationsById: {
        thread_b: buildConversationSnapshot({
          threadId: "thread_b",
          requests: [
            {
              type: "approval",
              requestId: "approval_b",
              kind: "command",
              projectId: "project_1",
              cardId: "card_1",
              threadId: "thread_b",
              turnId: "turn_b",
              itemId: "item_b",
              createdAt: 2,
            },
          ],
        }),
        thread_a: buildConversationSnapshot({
          threadId: "thread_a",
          requests: [
            {
              type: "approval",
              requestId: "approval_a",
              kind: "command",
              projectId: "project_1",
              cardId: "card_1",
              threadId: "thread_a",
              turnId: "turn_a",
              itemId: "item_a",
              createdAt: 1,
            },
          ],
        }),
      },
    });

    expect(model.backgroundRequest?.request.requestId).toBe("approval_b");
  });
});
