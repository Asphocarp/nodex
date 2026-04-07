import { describe, expect, test } from "bun:test";
import type {
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexConversationTurn,
} from "../../lib/types";
import {
  selectConversationTurnRequestsByTurnId,
  selectPrimaryConversationRequest,
} from "./conversation-request-helpers";
import {
  selectBlockedTurnIds,
  selectConversationLiveRequests,
  selectConversationSearchUnits,
  selectPlanImplementationRequest,
  selectVisibleConversationTurnEntries,
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
    source: overrides?.source ?? null,
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
  test("derives implement-plan requests from the live planImplementation item", () => {
    const conversation = buildConversation({
      requests: [{
        type: "implementPlan",
        requestId: "implement-plan:turn_1",
        projectId: "project_1",
        cardId: "card_1",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "implement-plan:turn_1",
        planContent: "- step 1\n- step 2",
        createdAt: 10,
      }],
      turns: [
        buildTurn({
          turnId: "turn_1",
          items: [
            buildItem({
              itemId: "implement-plan:turn_1",
              type: "planImplementation",
              kind: "planImplementation",
              semanticKind: "planImplementation",
              markdownText: "- step 1\n- step 2",
              updatedAt: 10,
              status: "inProgress",
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

  test("synthesizes an implement-plan request even when the raw request-plane entry is missing", () => {
    const conversation = buildConversation({
      turns: [
        buildTurn({
          turnId: "turn_1",
          items: [
            buildItem({
              itemId: "implement-plan:turn_1",
              type: "planImplementation",
              kind: "planImplementation",
              semanticKind: "planImplementation",
              markdownText: "- step 1\n- step 2",
              updatedAt: 10,
              status: "inProgress",
            }),
          ],
        }),
      ],
    });

    const request = selectPlanImplementationRequest(conversation);
    expect(request?.type).toBe("implementPlan");
    expect(request?.requestId).toBe("implement-plan:turn_1");
    expect(request?.planContent).toBe("- step 1\n- step 2");
  });

  test("does not surface an implement-plan request once the backing item is completed", () => {
    const conversation = buildConversation({
      requests: [{
        type: "implementPlan",
        requestId: "implement-plan:turn_1",
        projectId: "project_1",
        cardId: "card_1",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "implement-plan:turn_1",
        planContent: "- step 1\n- step 2",
        createdAt: 10,
      }],
      turns: [
        buildTurn({
          turnId: "turn_1",
          items: [
            buildItem({
              itemId: "implement-plan:turn_1",
              type: "planImplementation",
              kind: "planImplementation",
              semanticKind: "planImplementation",
              markdownText: "- step 1\n- step 2",
              updatedAt: 10,
              status: "completed",
            }),
          ],
        }),
      ],
    });

    expect(selectPlanImplementationRequest(conversation)).toBe(null);
  });

  test("marks approval and elicitation turns as blocked", () => {
    const conversation = buildConversation({
      turns: [
        buildTurn({ turnId: "turn_1" }),
        buildTurn({ turnId: "turn_2" }),
      ],
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

    expect(selectBlockedTurnIds(conversation).join(",")).toBe("turn_2,turn_1");
    expect(selectConversationLiveRequests(conversation).length).toBe(2);
  });

  test("prioritizes request-user-input ahead of approval in the live request order", () => {
    const conversation = buildConversation({
      turns: [
        buildTurn({ turnId: "turn_1" }),
        buildTurn({ turnId: "turn_2" }),
      ],
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
          createdAt: 1,
        },
        {
          type: "userInput",
          requestId: "user_input_1",
          projectId: "project_1",
          cardId: "card_1",
          threadId: "thread_1",
          turnId: "turn_2",
          itemId: "item_2",
          createdAt: 2,
          questions: [],
        },
      ],
    });

    const liveRequests = selectConversationLiveRequests(conversation);
    expect(liveRequests[0]?.type).toBe("userInput");
    expect(liveRequests[1]?.type).toBe("approval");
  });

  test("filters resumed child turns that already exist in the parent thread", () => {
    const duplicateTurn = buildTurn({
      turnId: "turn_shared",
      items: [
        buildItem({
          turnId: "turn_shared",
          itemId: "shared_item",
          markdownText: "Shared turn",
        }),
      ],
    });
    const uniqueTurn = buildTurn({
      turnId: "turn_child_unique",
      items: [
        buildItem({
          turnId: "turn_child_unique",
          itemId: "unique_item",
          markdownText: "Unique turn",
        }),
      ],
    });
    const conversation = buildConversation({
      threadId: "thread_child",
      resumeState: "resumed",
      turns: [duplicateTurn, uniqueTurn],
    });
    const parentTurns = [
      buildTurn({
        threadId: "thread_parent",
        turnId: "turn_shared",
        items: [
          buildItem({
            threadId: "thread_parent",
            turnId: "turn_shared",
            itemId: "parent_shared",
            markdownText: "Parent shared",
          }),
        ],
      }),
      buildTurn({
        threadId: "thread_parent",
        turnId: "turn_parent_only",
        items: [
          buildItem({
            threadId: "thread_parent",
            turnId: "turn_parent_only",
            itemId: "parent_only",
            markdownText: "Parent only",
          }),
        ],
      }),
    ];

    const entries = selectVisibleConversationTurnEntries({
      conversation,
      parentTurns,
    });

    expect(entries.length).toBe(1);
    expect(entries[0]?.turnId).toBe("turn_child_unique");
  });

  test("keeps visible turn entry references stable across unrelated conversation updates", () => {
    const turn = buildTurn({ turnId: "turn_1" });
    const requests = [{
      type: "approval" as const,
      requestId: "approval_1",
      kind: "command" as const,
      projectId: "project_1",
      cardId: "card_1",
      threadId: "thread_1",
      turnId: "turn_1",
      itemId: "item_1",
      createdAt: 1,
    }];
    const conversationA = buildConversation({
      turns: [turn],
      requests,
      cwd: "/tmp/project-a",
    });
    const conversationB = {
      ...conversationA,
      cwd: "/tmp/project-b",
    };

    const parentTurns: CodexConversationTurn[] = [];
    const entriesA = selectVisibleConversationTurnEntries({
      conversation: conversationA,
      parentTurns,
    });
    const entriesB = selectVisibleConversationTurnEntries({
      conversation: conversationB,
      parentTurns,
    });

    expect(entriesA === entriesB).toBeTrue();
    expect(entriesA[0] === entriesB[0]).toBeTrue();
  });

  test("prefers the newest turn when selecting the primary live request", () => {
    const conversation = buildConversation({
      turns: [
        buildTurn({ turnId: "turn_1" }),
        buildTurn({ turnId: "turn_2" }),
      ],
      requests: [
        {
          type: "userInput",
          requestId: "user_input_1",
          projectId: "project_1",
          cardId: "card_1",
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_1",
          createdAt: 2,
          questions: [],
        },
        {
          type: "approval",
          requestId: "approval_2",
          kind: "command",
          projectId: "project_1",
          cardId: "card_1",
          threadId: "thread_1",
          turnId: "turn_2",
          itemId: "item_2",
          createdAt: 1,
        },
      ],
    });

    expect(selectPrimaryConversationRequest(conversation)?.type).toBe("approval");
  });

  test("prefers a newer implement-plan request over older request surfaces", () => {
    const conversation = buildConversation({
      turns: [
        buildTurn({ turnId: "turn_1" }),
        buildTurn({
          turnId: "turn_2",
          items: [
            buildItem({
              turnId: "turn_2",
              itemId: "implement-plan:turn_2",
              type: "planImplementation",
              kind: "planImplementation",
              semanticKind: "planImplementation",
              markdownText: "- step 1",
              updatedAt: 10,
              status: "inProgress",
            }),
          ],
        }),
      ],
      requests: [
        {
          type: "userInput",
          requestId: "user_input_1",
          projectId: "project_1",
          cardId: "card_1",
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_1",
          createdAt: 2,
          questions: [],
        },
      ],
    });

    const primaryRequest = selectPrimaryConversationRequest(conversation);
    expect(primaryRequest?.type).toBe("implementPlan");
    expect(primaryRequest?.turnId).toBe("turn_2");
  });

  test("reuses per-turn request arrays when the conversation inputs are unchanged", () => {
    const conversation = buildConversation({
      turns: [
        buildTurn({ turnId: "turn_1" }),
        buildTurn({ turnId: "turn_2" }),
      ],
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
          createdAt: 1,
        },
      ],
    });

    const firstSelection = selectConversationTurnRequestsByTurnId(conversation);
    const secondSelection = selectConversationTurnRequestsByTurnId(conversation);

    expect(firstSelection === secondSelection).toBeTrue();
    expect(firstSelection.get("turn_1") === secondSelection.get("turn_1")).toBeTrue();
    expect((firstSelection.get("turn_2") ?? null) === (secondSelection.get("turn_2") ?? null)).toBeTrue();
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
