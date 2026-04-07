import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "../../../components/ui/tooltip";
import { installAsyncRequestAnimationFrame } from "../../../test/browser-globals";
import { render, settleAsyncRender } from "../../../test/dom";
import type {
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexConversationTurn,
} from "../../../lib/types";
import type { ThreadStageActions, ThreadStageModel } from "../thread-stage-types";
import { buildThreadBodyModel } from "../projection/build-thread-body-model";

function buildAssistantEntry(
  overrides?: Partial<CodexConversationItem>,
): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "assistant_1",
    type: "assistant_message",
    kind: "assistantMessage",
    semanticKind: "assistantMessage",
    role: "assistant",
    markdownText: "Assistant message",
    createdAt: 2,
    updatedAt: 2,
    ...overrides,
  };
}

function buildUserEntry(
  overrides?: Partial<CodexConversationItem>,
): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "user_1",
    type: "user_message",
    kind: "userMessage",
    semanticKind: "userMessage",
    role: "user",
    markdownText: "run `bun test`",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildTurn(
  overrides?: Partial<CodexConversationTurn>,
): CodexConversationTurn {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    status: "completed",
    itemIds: ["user_1", "assistant_1"],
    items: [buildUserEntry(), buildAssistantEntry()],
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
    statusType: "active",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-03-21T00:00:00.000Z",
    resumeState: "resumed",
    turns: [buildTurn()],
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

function buildModel(overrides?: Partial<ThreadStageModel>): ThreadStageModel {
  const conversation = overrides?.conversation ?? buildConversation();
  const body =
    overrides?.body ??
    buildThreadBodyModel({
      activeThreadId: conversation.threadId,
      conversation,
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: null,
    });

  return {
    projectId: "project_1",
    projectWorkspacePath: "/tmp/project",
    conversation,
    resumeState: conversation.resumeState,
    activeTurn: conversation.turns[0] ?? null,
    isThreadRunning: false,
    isNewThreadTab: false,
    isCloudNewThreadTarget: false,
    newThreadTarget: null,
    threadStartProgress: null,
    connection: { status: "connected", retries: 0 },
    account: null,
    availableModels: [],
    collaborationModes: [],
    selectedCollaborationMode: "default",
    selectedModel: "gpt-5.3-codex",
    selectedReasoningEffort: "high",
    reasoningEffortOptions: [],
    permissionMode: "sandbox",
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    searchOpenTick: 0,
    composerIntent: null,
    title: "Thread",
    openCardTarget: null,
    activeThreadCardColumnId: null,
    body,
    composerShell: {
      activeRequest: null,
      backgroundRequest: null,
      pendingSteerRows: [],
      queuedFollowUpRows: [],
      backgroundAgentRows: [],
      backgroundTerminalRows: [],
      showRequestCards: false,
      showComposer: true,
      showApprovalMode: false,
    },
    ...overrides,
  };
}

function buildActions(overrides?: Partial<ThreadStageActions>): ThreadStageActions {
  return {
    onCollaborationModeChange: () => {},
    onModelChange: () => {},
    onReasoningEffortChange: () => {},
    onPermissionModeChange: () => {},
    onQueueingEnabledChange: () => {},
    onRefreshAccount: async () => ({
      account: null,
      requiresOpenAiAuth: false,
      pendingLogin: null,
      rateLimits: null,
    }),
    onStartChatGptLogin: async () => ({ type: "apiKey" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: async () => {},
    onLogout: async () => {},
    onStartThreadForCard: async () => {},
    onSendPrompt: async () => {},
    onSteerPrompt: async () => {},
    onInterruptTurn: async () => {},
    onRespondApproval: async () => {},
    onRespondUserInput: async () => {},
    onRespondMcpElicitation: async () => {},
    onResolvePlanImplementationRequest: async () => {},
    onEnqueueQueuedFollowUp: async () => {},
    onRemoveQueuedFollowUp: async () => {},
    onReorderQueuedFollowUps: async () => {},
    onSendQueuedFollowUpNow: async () => {},
    onEditQueuedFollowUp: async () => {},
    onEditLastUserTurn: async () => {},
    onForkFromTurn: async () => {},
    onOpenTurnDiffReview: () => {},
    onConsumeComposerIntent: () => {},
    onOpenThread: () => {},
    onCleanBackgroundTerminals: async () => {},
    onOpenCard: () => {},
    ...overrides,
  };
}

describe("LocalConversationThreadBody", () => {
  beforeEach(() => {
    installAsyncRequestAnimationFrame();
  });

  test("keeps find-in-thread hidden until cmd+f opens it", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { container, rerender } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel()}
          actions={buildActions()}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    expect(
      Boolean(container.querySelector('input[aria-label="Find in thread"]')),
    ).toBeFalse();

    rerender(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({ searchOpenTick: 1 })}
          actions={buildActions()}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    await waitFor(() => {
      const searchInput = container.querySelector(
        'input[aria-label="Find in thread"]',
      ) as HTMLInputElement | null;
      expect(Boolean(searchInput)).toBeTrue();
    });
  });

  test("lets the shared scroll layout own viewport padding and width shell geometry", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { container } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel()}
          actions={buildActions()}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    const viewport = container.querySelector(
      "[data-local-conversation-thread-body='true']",
    ) as HTMLDivElement | null;
    const contentRoot = container.querySelector(
      "[data-thread-find-target='conversation']",
    ) as HTMLDivElement | null;
    const widthWrapper = viewport?.firstElementChild as HTMLDivElement | null;

    expect(Boolean(viewport)).toBeTrue();
    expect(viewport?.className.includes("pb-8") ?? false).toBeTrue();
    expect(viewport?.className.includes("px-panel") ?? false).toBeFalse();

    expect(Boolean(widthWrapper)).toBeTrue();
    expect(
      widthWrapper?.className.includes("max-w-[var(--thread-content-max-width)]") ?? false,
    ).toBeTrue();
    expect(widthWrapper?.className.includes("px-2.5") ?? false).toBeTrue();
    expect(widthWrapper?.className.includes("md:px-panel") ?? false).toBeTrue();

    expect(Boolean(contentRoot)).toBeTrue();
    expect(contentRoot?.className.includes("h-full") ?? false).toBeFalse();
    expect(contentRoot?.className.includes("min-h-full") ?? false).toBeFalse();
    expect(contentRoot?.className.includes("max-w-[") ?? false).toBeFalse();
    expect(contentRoot?.className.includes("px-2.5") ?? false).toBeFalse();
  });

  test("shows a restoring placeholder instead of rendering turn content while the active thread is resuming", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const model = buildModel({
      conversation: null,
      resumeState: "resuming",
      activeTurn: null,
      body: {
        threadId: "thread_1",
        turnCount: 0,
        hasAboveComposerBlocks: false,
        isThreadRunning: false,
        activeTurnId: null,
        latestTurnId: null,
        emptyState: {
          type: "resumingThread",
          title: "Restoring thread",
          description:
            "Loading the latest conversation state before rendering the thread.",
          status: "resuming",
        },
        showThreadStartProgressPanel: false,
      },
    });

    const { getByRole, queryByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={model}
          actions={buildActions()}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    expect(Boolean(getByRole("status", { name: /Restoring thread/i }))).toBeTrue();
    expect(Boolean(queryByText("Assistant message"))).toBeFalse();
  });

  test("opens an older-turn fork confirm before invoking the manager action", async () => {
    const onForkFromTurnCalls: Array<{
      threadId: string;
      turnId: string;
      message: string;
    }> = [];
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { getAllByLabelText, getByText, queryByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({
            conversation: buildConversation({
              turns: [
                buildTurn({
                  turnId: "turn_older",
                  status: "completed",
                  items: [
                    buildUserEntry({
                      turnId: "turn_older",
                      itemId: "user_older",
                      markdownText: "Fork me",
                    }),
                    buildAssistantEntry({
                      turnId: "turn_older",
                      itemId: "assistant_older",
                    }),
                  ],
                }),
                buildTurn({
                  turnId: "turn_latest",
                  status: "completed",
                  items: [
                    buildUserEntry({
                      turnId: "turn_latest",
                      itemId: "user_latest",
                      markdownText: "Latest turn",
                    }),
                    buildAssistantEntry({
                      turnId: "turn_latest",
                      itemId: "assistant_latest",
                    }),
                  ],
                }),
              ],
            }),
          })}
          actions={buildActions({
            onForkFromTurn: async (input) => {
              onForkFromTurnCalls.push(input);
            },
          })}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    fireEvent.click(getAllByLabelText("Fork from this message")[0]!);
    await settleAsyncRender();
    expect(Boolean(queryByText("Fork thread"))).toBeTrue();

    fireEvent.click(getByText("Fork thread"));
    await settleAsyncRender();

    expect(onForkFromTurnCalls.length).toBe(1);
    expect(onForkFromTurnCalls[0]?.turnId).toBe("turn_older");
  });

  test("opens an inline edit prompt in place and only edits on send", async () => {
    const onEditLastUserTurnCalls: Array<{
      threadId: string;
      turnId: string;
      message: string;
    }> = [];
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { getByDisplayValue, getByLabelText, getByRole, queryByDisplayValue } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel()}
          actions={buildActions({
            onEditLastUserTurn: async (input) => {
              onEditLastUserTurnCalls.push(input);
            },
          })}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    fireEvent.click(getByLabelText("Edit message"));

    expect(onEditLastUserTurnCalls.length).toBe(0);
    const textarea = getByDisplayValue("run `bun test`") as HTMLTextAreaElement;
    textarea.value = "run `bun test --bail`";
    fireEvent.input(textarea);
    await settleAsyncRender();
    fireEvent.click(getByRole("button", { name: "Send" }));
    await settleAsyncRender();

    expect(Boolean(queryByDisplayValue("run `bun test --bail`"))).toBeFalse();
    expect(onEditLastUserTurnCalls.length).toBe(1);
    expect(onEditLastUserTurnCalls[0]?.message).toBe("run `bun test --bail`");
  });

  test("renders a worked-for toggle for the latest completed turn when a persisted collapse state exists", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const conversation = buildConversation({
      statusType: "idle",
      turns: [
        buildTurn({
          status: "completed",
          itemIds: ["user_1", "exec_1", "commentary_1", "assistant_1"],
          items: [
            buildUserEntry(),
            buildAssistantEntry({
              itemId: "exec_1",
              type: "command_execution",
              kind: "commandExecution",
              semanticKind: "exec",
              markdownText: "",
              toolCall: { subtype: "command", toolName: "exec_command" },
            }),
            buildAssistantEntry({
              itemId: "commentary_1",
              assistantPhase: "commentary",
              markdownText: "Working",
              createdAt: 2,
              updatedAt: 2,
            }),
            buildAssistantEntry({
              itemId: "assistant_1",
              assistantPhase: "final_answer",
              markdownText: "Done",
              createdAt: 3,
              updatedAt: 3,
            }),
          ],
        }),
      ],
    });

    const { getByRole, queryByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({ conversation })}
          actions={buildActions()}
          onErrorMessage={() => {}}
          initialUiState={{ collapsedAgentBodyByTurnId: { turn_1: true } }}
        />
      </TooltipProvider>,
    );

    expect(Boolean(getByRole("button", { name: /Worked for/i }))).toBeTrue();
    expect(Boolean(queryByText("Working"))).toBeFalse();
  });

  test("defers mounting long threads before rendering the virtualized transcript", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const longTurns = Array.from({ length: 40 }, (_, index) =>
      buildTurn({
        turnId: `turn_${index + 1}`,
        items: [
          buildUserEntry({
            turnId: `turn_${index + 1}`,
            itemId: `user_${index + 1}`,
            markdownText: `Request ${index + 1}`,
            createdAt: index * 10 + 1,
            updatedAt: index * 10 + 1,
          }),
          buildAssistantEntry({
            turnId: `turn_${index + 1}`,
            itemId: `assistant_${index + 1}`,
            markdownText: `Assistant turn ${index + 1}`,
            createdAt: index * 10 + 2,
            updatedAt: index * 10 + 2,
          }),
        ],
      }),
    );

    const { queryByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({
            conversation: buildConversation({
              turns: longTurns,
            }),
          })}
          actions={buildActions()}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    expect(Boolean(queryByText("Assistant turn 1"))).toBeFalse();
    await settleAsyncRender();
    expect(Boolean(queryByText("Assistant turn 1"))).toBeTrue();
  });
});
