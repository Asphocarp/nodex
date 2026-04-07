import { beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { NodexTooltipProvider as TooltipProvider } from "../../../components/ui/tooltip";
import { render } from "../../../test/dom";
import type {
  CodexConversationItem,
  CodexConversationTurn,
} from "../../../lib/types";

const renderCounts = new Map<string, number>();

function buildUserEntry(
  turnId: string,
  itemId: string,
  markdownText: string,
): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId,
    itemId,
    type: "user_message",
    kind: "userMessage",
    semanticKind: "userMessage",
    role: "user",
    markdownText,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildAssistantEntry(
  turnId: string,
  itemId: string,
  markdownText: string,
  overrides: Partial<CodexConversationItem> = {},
): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId,
    itemId,
    type: "assistant_message",
    kind: "assistantMessage",
    semanticKind: "assistantMessage",
    role: "assistant",
    markdownText,
    createdAt: 2,
    updatedAt: 2,
    ...overrides,
  };
}

function buildTurn(turnId: string, userText: string, assistantText: string): CodexConversationTurn {
  const userId = `${turnId}_user`;
  const assistantId = `${turnId}_assistant`;
  return {
    threadId: "thread_1",
    turnId,
    status: "completed",
    itemIds: [userId, assistantId],
    items: [
      buildUserEntry(turnId, userId, userText),
      buildAssistantEntry(turnId, assistantId, assistantText),
    ],
  };
}

describe("LocalConversationTurnEntry", () => {
  beforeEach(() => {
    renderCounts.clear();
  });

  test("does not rerender unchanged older turns when a different turn updates", async () => {
    const stableRequests: [] = [];
    const recordRender = (turnId: string) => {
      renderCounts.set(turnId, (renderCounts.get(turnId) ?? 0) + 1);
    };
    const olderTurn = buildTurn("turn_older", "Older request", "Older reply");
    const latestTurn = buildTurn("turn_latest", "Latest request", "Latest reply");
    const nextLatestTurn = buildTurn(
      "turn_latest",
      "Latest request",
      "Latest reply with streamed delta",
    );
    const { LocalConversationTurnEntry } = await import("./local-conversation-turn-entry");

    function Probe({
      older,
      latest,
    }: {
      older: CodexConversationTurn;
      latest: CodexConversationTurn;
    }) {
      return createElement(
        "div",
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: older.turnId,
          turn: older,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: false,
          canEditTurnUserPrefix: false,
          canForkTurnUserPrefix: true,
          onRendered: recordRender,
        }),
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: latest.turnId,
          turn: latest,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: true,
          canEditTurnUserPrefix: true,
          canForkTurnUserPrefix: true,
          onRendered: recordRender,
        }),
      );
    }

    const view = render(
      createElement(
        TooltipProvider,
        null,
        createElement(Probe, { older: olderTurn, latest: latestTurn }),
      ),
    );
    expect(renderCounts.get("turn_older")).toBe(1);
    expect(renderCounts.get("turn_latest")).toBe(1);

    view.rerender(
      createElement(
        TooltipProvider,
        null,
        createElement(Probe, { older: olderTurn, latest: nextLatestTurn }),
      ),
    );

    expect(renderCounts.get("turn_older")).toBe(1);
    expect(renderCounts.get("turn_latest")).toBe(2);
  });

  test("renders assistant before later exec rows inside the agent body when exec arrives after it", async () => {
    const stableRequests: [] = [];
    const { LocalConversationTurnEntry } = await import("./local-conversation-turn-entry");
    const assistantOnlyTurn: CodexConversationTurn = {
      threadId: "thread_1",
      turnId: "turn_latest",
      status: "inProgress",
      itemIds: ["assistant_1"],
      items: [
        buildAssistantEntry("turn_latest", "assistant_1", "Done", {
          assistantPhase: "final_answer",
          status: "inProgress",
        }),
      ],
    };
    const assistantThenExecTurn: CodexConversationTurn = {
      ...assistantOnlyTurn,
      itemIds: ["assistant_1", "exec_1"],
      items: [
        ...assistantOnlyTurn.items,
        {
          threadId: "thread_1",
          turnId: "turn_latest",
          itemId: "exec_1",
          type: "command_execution",
          kind: "commandExecution",
          semanticKind: "exec",
          createdAt: 3,
          updatedAt: 3,
          status: "inProgress",
          toolCall: {
            subtype: "command",
            toolName: "exec_command",
          },
        },
      ],
    };

    const view = render(
      createElement(
        TooltipProvider,
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: assistantOnlyTurn.turnId,
          turn: assistantOnlyTurn,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: true,
          canEditTurnUserPrefix: true,
          canForkTurnUserPrefix: true,
        }),
      ),
    );

    view.rerender(
      createElement(
        TooltipProvider,
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: assistantThenExecTurn.turnId,
          turn: assistantThenExecTurn,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: true,
          canEditTurnUserPrefix: true,
          canForkTurnUserPrefix: true,
        }),
      ),
    );

    const assistantAfter = view.container.querySelector('[data-content-search-unit-key="turn_latest:assistant"]');
    if (!(assistantAfter instanceof HTMLElement)) {
      throw new Error("expected assistant body after exec");
    }
    const execToggle = view.container.querySelector("[data-command-tool-summary-toggle]");
    if (!(execToggle instanceof HTMLElement)) {
      throw new Error("expected exec summary toggle");
    }

    expect(Boolean(view.container.textContent?.includes("Done"))).toBeTrue();
    expect(Boolean(view.container.textContent?.includes("Final message"))).toBeFalse();
    expect(
      Boolean(assistantAfter.compareDocumentPosition(execToggle) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBeTrue();
  });

  test("keeps the latest-assistant search unit when later exploration rows are grouped inline", async () => {
    const stableRequests: [] = [];
    const { LocalConversationTurnEntry } = await import("./local-conversation-turn-entry");
    const assistantOnlyTurn: CodexConversationTurn = {
      threadId: "thread_1",
      turnId: "turn_latest",
      status: "inProgress",
      itemIds: ["assistant_1"],
      items: [
        buildAssistantEntry("turn_latest", "assistant_1", "Done", {
          assistantPhase: "final_answer",
          status: "inProgress",
        }),
      ],
    };
    const assistantThenExploreTurn: CodexConversationTurn = {
      ...assistantOnlyTurn,
      itemIds: ["assistant_1", "exec_1", "reasoning_1"],
      items: [
        ...assistantOnlyTurn.items,
        {
          threadId: "thread_1",
          turnId: "turn_latest",
          itemId: "exec_1",
          type: "command_execution",
          kind: "commandExecution",
          semanticKind: "exec",
          createdAt: 3,
          updatedAt: 3,
          status: "completed",
          commandActions: [{ type: "read", command: "", name: "read", path: "src/app.ts" }],
          toolCall: {
            subtype: "command",
            toolName: "exec_command",
            args: {},
          },
        },
        {
          threadId: "thread_1",
          turnId: "turn_latest",
          itemId: "reasoning_1",
          type: "reasoning",
          kind: "reasoning",
          semanticKind: "reasoning",
          createdAt: 4,
          updatedAt: 4,
          status: "inProgress",
          markdownText: "Checking the file.",
        },
      ],
    };

    const view = render(
      createElement(
        TooltipProvider,
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: assistantOnlyTurn.turnId,
          turn: assistantOnlyTurn,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: true,
          canEditTurnUserPrefix: true,
          canForkTurnUserPrefix: true,
        }),
      ),
    );

    view.rerender(
      createElement(
        TooltipProvider,
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: assistantThenExploreTurn.turnId,
          turn: assistantThenExploreTurn,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: true,
          canEditTurnUserPrefix: true,
          canForkTurnUserPrefix: true,
        }),
      ),
    );

    const assistantAfter = view.container.querySelector('[data-content-search-unit-key="turn_latest:assistant"]');
    if (!(assistantAfter instanceof HTMLElement)) {
      throw new Error("expected assistant body after exploration rows");
    }
    const explorationBody = view.container.querySelector('[data-testid="exploration-accordion-body"]');
    if (!(explorationBody instanceof HTMLElement)) {
      throw new Error("expected exploration accordion body");
    }

    expect(Boolean(view.container.textContent?.includes("Done"))).toBeTrue();
    expect(Boolean(view.container.textContent?.includes("Final message"))).toBeFalse();
  });
});
