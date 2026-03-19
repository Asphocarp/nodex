import { describe, expect, test } from "bun:test";
import type { CodexConversationSnapshot } from "../../../lib/types";
import { buildPendingRequestSurfaceModel } from "./build-pending-request-surface-model";

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

describe("buildPendingRequestSurfaceModel", () => {
  test("keeps only inline request cards on the pending request surface", () => {
    const model = buildPendingRequestSurfaceModel({
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
        }),
      },
    });

    expect(model?.entries.length).toBe(2);
    expect(model?.entries.map((entry) => entry.kind).join(",")).toBe("request,request");

    const requestEntries = model?.entries.filter((entry) => entry.kind === "request") ?? [];
    expect(requestEntries.map((entry) => entry.request.requestId).join(",")).toBe(
      "user_input_active,approval_background",
    );
    expect(model?.backgroundRequestCount).toBe(1);
    expect(model?.activeRequestCount).toBe(1);
    expect(model?.showComposer).toBeFalse();
  });

  test("keeps child approval selection in membership order", () => {
    const model = buildPendingRequestSurfaceModel({
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

    const backgroundRequest = model?.entries.find((entry) =>
      entry.kind === "request" && entry.surface === "backgroundThread");

    if (!backgroundRequest || backgroundRequest.kind !== "request") {
      throw new Error("expected background request entry");
    }

    expect(backgroundRequest.request.requestId).toBe("approval_b");
  });
});
