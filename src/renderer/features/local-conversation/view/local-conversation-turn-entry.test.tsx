import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
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

function buildSteeringEntry(
  turnId: string,
  itemId: string,
  markdownText: string,
  steeringStatus: "pending" | "accepted",
): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId,
    itemId,
    entryId: itemId,
    type: "steeringUserMessage",
    kind: "userMessage",
    semanticKind: "userMessage",
    status: "completed",
    role: "user",
    markdownText,
    steeringStatus,
    createdAt: 3,
    updatedAt: 3,
  };
}

function buildSteeredEntry(turnId: string, itemId: string): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId,
    itemId,
    entryId: itemId,
    type: "steered",
    kind: "systemEvent",
    semanticKind: "steered",
    status: "completed",
    markdownText: "Steered conversation",
    createdAt: 4,
    updatedAt: 4,
  };
}

function buildTurn(
  turnId: string,
  userText: string,
  assistantText: string,
  overrides: Partial<CodexConversationTurn> = {},
): CodexConversationTurn {
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
    ...overrides,
  };
}

describe("LocalConversationTurnEntry", () => {
  beforeEach(() => {
    renderCounts.clear();
  });

  test("renders user copy time and optional edit without a user fork action", async () => {
    const stableRequests: [] = [];
    const { LocalConversationTurnEntry } = await import("./local-conversation-turn-entry");
    const sentAtMs = 180_000;
    const staleStartedAtMs = 999_000;
    const turn = buildTurn("turn_actions", "Copy this request", "Done", {
      turnStartedAtMs: sentAtMs,
      startedAt: staleStartedAtMs,
      completedAt: 999_000,
    });
    const expectedTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(sentAtMs));
    const staleStartedTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(staleStartedAtMs));
    const view = render(
      createElement(
        TooltipProvider,
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: turn.turnId,
          turn,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: true,
          canEditTurnUserPrefix: true,
          canForkTurn: true,
        }),
      ),
    );

    expect(view.getAllByLabelText("Copy message").length > 0).toBeTrue();
    expect(Boolean(view.getByLabelText("Edit message"))).toBeTrue();
    expect(view.queryByLabelText("Fork from this message") === null).toBeTrue();
    expect(Boolean(view.container.textContent?.includes(expectedTime))).toBeTrue();
    expect(Boolean(view.container.textContent?.includes(staleStartedTime))).toBeFalse();
  });

  test("renders pending and accepted steering surfaces separately", async () => {
    const stableRequests: [] = [];
    const { LocalConversationTurnEntry } = await import("./local-conversation-turn-entry");
    const turn: CodexConversationTurn = {
      ...buildTurn("turn_steer", "Initial request", "Working"),
      status: "inProgress",
      itemIds: ["turn_steer_user", "turn_steer_assistant", "steer_pending", "steer_accepted", "steered_accepted"],
      items: [
        buildUserEntry("turn_steer", "turn_steer_user", "Initial request"),
        buildAssistantEntry("turn_steer", "turn_steer_assistant", "Working", { status: "inProgress" }),
        buildSteeringEntry("turn_steer", "steer_pending", "Try the compact path.", "pending"),
        buildSteeringEntry("turn_steer", "steer_accepted", "Tighten the layout.", "accepted"),
        buildSteeredEntry("turn_steer", "steered_accepted"),
      ],
    };

    const view = render(
      createElement(
        TooltipProvider,
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: turn.turnId,
          turn,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: true,
          canEditTurnUserPrefix: false,
          canForkTurn: false,
        }),
      ),
    );

    expect(Boolean(view.container.textContent?.includes("Steering conversation"))).toBeTrue();
    expect(Boolean(view.container.textContent?.includes("Try the compact path."))).toBeTrue();
    expect(Boolean(view.container.textContent?.includes("Tighten the layout."))).toBeTrue();
    expect(view.getAllByText("Steered conversation").length).toBe(2);
  });

  test("renders assistant actions in Codex order and forks with an empty composer draft", async () => {
    const stableRequests: [] = [];
    const forkInputs: Array<{ threadId: string; turnId: string; message: string; isLatestTurn: boolean }> = [];
    const { LocalConversationTurnEntry } = await import("./local-conversation-turn-entry");
    const sentAtMs = 180_000;
    const staleCompletedAtMs = 999_000;
    const turn = buildTurn("turn_assistant_actions", "Request", "Assistant reply", {
      turnStartedAtMs: 90_000,
      finalAssistantStartedAtMs: sentAtMs,
      completedAt: staleCompletedAtMs,
    });
    const expectedTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(sentAtMs));
    const staleCompletedTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(staleCompletedAtMs));
    const view = render(
      createElement(
        TooltipProvider,
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: turn.turnId,
          turn,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: false,
          canEditTurnUserPrefix: false,
          canForkTurn: true,
          onForkTurnMessage: (input) => {
            forkInputs.push(input);
          },
        }),
      ),
    );

    const labels = Array.from(view.container.querySelectorAll("button[aria-label]"))
      .map((button) => button.getAttribute("aria-label") ?? "");
    const assistantCopyIndex = labels.lastIndexOf("Copy message");
    const thumbsUpIndex = labels.indexOf("Good response");
    const thumbsDownIndex = labels.indexOf("Bad response");
    const forkIndex = labels.indexOf("Fork from this point");

    expect(assistantCopyIndex >= 0).toBeTrue();
    expect(thumbsUpIndex > assistantCopyIndex).toBeTrue();
    expect(thumbsDownIndex > thumbsUpIndex).toBeTrue();
    expect(forkIndex > thumbsDownIndex).toBeTrue();
    expect(Boolean(view.container.textContent?.includes(expectedTime))).toBeTrue();
    expect(Boolean(view.container.textContent?.includes(staleCompletedTime))).toBeFalse();

    fireEvent.click(view.getByLabelText("Fork from this point"));
    expect(forkInputs.length).toBe(1);
    expect(forkInputs[0]?.turnId).toBe("turn_assistant_actions");
    expect(forkInputs[0]?.message).toBe("");
    expect(forkInputs[0]?.isLatestTurn).toBeFalse();
  });

  test("suppresses assistant copy and rating while streaming or empty", async () => {
    const stableRequests: [] = [];
    const { LocalConversationTurnEntry } = await import("./local-conversation-turn-entry");
    const streamingTurn: CodexConversationTurn = {
      ...buildTurn("turn_streaming", "Request", "Streaming reply"),
      status: "inProgress",
      items: [
        buildUserEntry("turn_streaming", "turn_streaming_user", "Request"),
        buildAssistantEntry("turn_streaming", "turn_streaming_assistant", "Streaming reply", {
          status: "inProgress",
        }),
      ],
    };
    const emptyTurn = buildTurn("turn_empty", "Request", "");
    const view = render(
      createElement(
        TooltipProvider,
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: streamingTurn.turnId,
          turn: streamingTurn,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: true,
          canEditTurnUserPrefix: false,
          canForkTurn: true,
        }),
      ),
    );

    expect(view.queryByLabelText("Good response") === null).toBeTrue();
    expect(view.queryByLabelText("Bad response") === null).toBeTrue();
    expect(view.queryByLabelText("Fork from this point") === null).toBeTrue();

    view.rerender(
      createElement(
        TooltipProvider,
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: emptyTurn.turnId,
          turn: emptyTurn,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: true,
          canEditTurnUserPrefix: false,
          canForkTurn: true,
        }),
      ),
    );

    expect(view.queryByLabelText("Good response") === null).toBeTrue();
    expect(view.queryByLabelText("Bad response") === null).toBeTrue();
    expect(Boolean(view.getByLabelText("Fork from this point"))).toBeTrue();
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
          canForkTurn: true,
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
          canForkTurn: true,
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

  test("renders user image attachments in a strip before the message bubble", async () => {
    const stableRequests: [] = [];
    const { LocalConversationTurnEntry } = await import("./local-conversation-turn-entry");
    const turn: CodexConversationTurn = {
      threadId: "thread_1",
      turnId: "turn_images",
      status: "completed",
      itemIds: ["user_images", "assistant_images"],
      items: [
        {
          ...buildUserEntry("turn_images", "user_images", "Inspect these images"),
          userAttachments: [
            {
              type: "file",
              id: "user_images:file:0",
              label: "notes.md",
              path: "/tmp/notes.md",
              sourceKind: "mention",
            },
            {
              type: "image",
              id: "user_images:image:0",
              source: "data:image/png;base64,aW1hZ2U=",
              sourceKind: "local",
              caption: "diagram",
            },
          ],
        },
        buildAssistantEntry("turn_images", "assistant_images", "Done"),
      ],
    };

    const view = render(
      createElement(
        TooltipProvider,
        null,
        createElement(LocalConversationTurnEntry, {
          conversationId: "thread_1",
          turnSearchKey: turn.turnId,
          turn,
          requests: stableRequests,
          cwd: "/tmp/project",
          isMostRecentTurn: true,
          canEditTurnUserPrefix: true,
          canForkTurn: true,
        }),
      ),
    );

    const strip = view.container.querySelector("[data-user-attachment-strip]");
    const bubble = view.container.querySelector('[data-content-search-unit-key="turn_images:user:0"]');
    if (!(strip instanceof HTMLElement) || !(bubble instanceof HTMLElement)) {
      throw new Error("expected attachment strip and user bubble");
    }

    expect(Boolean(strip.textContent?.includes("notes.md"))).toBeTrue();
    expect(Boolean(bubble.textContent?.includes("Inspect these images"))).toBeTrue();
    expect(Boolean(strip.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTrue();
    expect(strip.querySelector("img")?.className.includes("object-cover") ?? false).toBeTrue();

    const previewTrigger = view.getByLabelText("Open image preview");
    fireEvent.click(previewTrigger);
    const preview = document.body.querySelector('[data-slot="codex-dialog-content"] img');
    if (!(preview instanceof HTMLImageElement)) {
      throw new Error("expected image preview dialog");
    }
    expect(preview.src.startsWith("data:image/png;base64")).toBeTrue();
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
          canForkTurn: true,
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
          canForkTurn: true,
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
          canForkTurn: true,
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
          canForkTurn: true,
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
