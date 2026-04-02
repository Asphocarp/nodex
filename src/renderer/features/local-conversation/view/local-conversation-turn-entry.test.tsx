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
          isMatched: false,
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
          isMatched: false,
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
});
