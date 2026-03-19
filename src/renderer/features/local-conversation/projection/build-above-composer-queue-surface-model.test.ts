import { describe, expect, test } from "bun:test";
import type { CodexConversationSnapshot } from "../../../lib/types";
import { buildAboveComposerQueueSurfaceModel } from "./build-above-composer-queue-surface-model";

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

describe("buildAboveComposerQueueSurfaceModel", () => {
  test("projects pending steers and queued follow ups into the queue lane", () => {
    const model = buildAboveComposerQueueSurfaceModel({
      conversation: buildConversationSnapshot({
        pendingSteers: [
          {
            steerId: "steer_1",
            threadId: "thread_1",
            turnId: "turn_1",
            prompt: "Focus on the renderer.",
            createdAt: 10,
          },
        ],
        queuedFollowUps: [
          {
            followUpId: "follow_up_1",
            threadId: "thread_1",
            prompt: "Run validation next.",
            createdAt: 20,
            collaborationMode: "default",
          },
        ],
        backgroundTerminalRows: [
          {
            rowId: "row_1",
            threadId: "thread_2",
            stream: "stdout",
            text: "child agent still running",
            createdAt: 30,
          },
        ],
      }),
    });

    expect(model?.entries.length).toBe(2);
    expect(model?.entries.map((entry) => entry.kind).join(",")).toBe(
      "pendingSteer,queuedFollowUp",
    );
  });

  test("returns null when no queue-lane items exist", () => {
    const model = buildAboveComposerQueueSurfaceModel({
      conversation: buildConversationSnapshot(),
    });

    expect(model).toBe(null);
  });
});
