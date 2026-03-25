import { describe, expect, test } from "bun:test";
import type {
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexConversationTurn,
} from "../../lib/types";
import {
  selectBlockedTurnIds,
  selectConversationLiveRequests,
  selectConversationSearchUnits,
  selectPlanImplementationRequest,
} from "./selectors";

function buildItem(overrides: Partial<CodexConversationItem>): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "item_1",
    type: "assistant_message",
    kind: "assistantMessage",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildTurn(overrides: Partial<CodexConversationTurn>): CodexConversationTurn {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    status: "completed",
    itemIds: [],
    items: [],
    ...overrides,
  };
}

function buildConversation(
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

describe("local-conversation selectors", () => {
  test("derives implement-plan requests from the latest completed plan turn", () => {
    const conversation = buildConversation({
      turns: [
        buildTurn({
          turnId: "turn_1",
          items: [
            buildItem({
              itemId: "plan_1",
              type: "plan",
              kind: "plan",
              markdownText: "- step 1\n- step 2",
              updatedAt: 10,
            }),
          ],
        }),
      ],
    });

    const request = selectPlanImplementationRequest(conversation);
    expect(request?.type).toBe("implementPlan");
    expect(request?.turnId).toBe("turn_1");
    expect(request?.planContent).toBe("- step 1\n- step 2");
  });

  test("marks approval and elicitation turns as blocked", () => {
    const conversation = buildConversation({
      requests: [
        {
          type: "approval",
          requestId: "approval_1",
          kind: "command",
          projectId: "project_1",
          cardId: "card_1",
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_1",
          createdAt: 2,
        },
        {
          type: "mcpServerElicitation",
          requestId: "elicitation_1",
          projectId: "project_1",
          cardId: "card_1",
          threadId: "thread_1",
          turnId: "turn_2",
          itemId: "item_2",
          kind: "generic",
          mode: "form",
          serverName: "Context7",
          message: "Need more input",
          createdAt: 3,
        },
      ],
    });

    expect(selectBlockedTurnIds(conversation).join(",")).toBe("turn_1,turn_2");
    expect(selectConversationLiveRequests(conversation).length).toBe(2);
  });

  test("builds searchable user and assistant units from visible turns", () => {
    const conversation = buildConversation({
      turns: [
        buildTurn({
          items: [
            buildItem({
              itemId: "user_1",
              type: "user_message",
              kind: "userMessage",
              role: "user",
              markdownText: "Need a refactor.",
            }),
            buildItem({
              itemId: "assistant_1",
              type: "assistant_message",
              kind: "assistantMessage",
              role: "assistant",
              markdownText: "I will rewrite the shell.",
            }),
          ],
        }),
      ],
    });

    const units = selectConversationSearchUnits(conversation);
    expect(units.length).toBe(2);
    expect(units[0]?.key).toBe("turn_1:user_1");
    expect(units[1]?.role).toBe("assistant");
  });
});
