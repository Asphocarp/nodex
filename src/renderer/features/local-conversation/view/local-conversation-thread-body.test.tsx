import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { render, settleAsyncRender } from "../../../test/dom";
import type { CodexConversationItem } from "../../../lib/types";
import type { ThreadStageActions, ThreadStageModel } from "../thread-stage-types";

function buildModel(overrides?: Partial<ThreadStageModel>): ThreadStageModel {
  return {
    projectId: "project_1",
    projectWorkspacePath: "/tmp/project",
    conversation: null,
    resumeState: null,
    activeTurn: null,
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
    promptSubmitShortcut: "enter",
    searchOpenTick: 0,
    composerIntent: null,
    title: "Thread",
    openCardTarget: null,
    activeThreadCardColumnId: null,
    body: {
      threadId: "thread_1",
      turns: [
        {
          turnId: "turn_1",
          turn: null,
          buckets: {
            userItems: [],
            assistantItem: null,
            systemEventItem: null,
            approvalItems: [],
            userInputItems: [],
            implementPlanItem: null,
            mcpServerElicitationItems: [],
            todoListItem: null,
            unifiedDiffItem: null,
            proposedPlanItem: null,
            postAssistantItems: [],
            agentItems: [],
            remoteTaskCreatedItems: [],
            personalityChangedItems: [],
            forkedFromConversationItems: [],
            modelChangedItems: [],
            modelReroutedItems: [],
            thinkingPlaceholderItem: null,
          },
          leadingBlocks: [],
          agentBodyEntries: [],
          trailingBlocks: [],
          blocks: [],
          isLatestTurn: true,
          isStreamingTurn: false,
          isBlocked: false,
          searchableText: "Needle result",
          searchUnits: [
            {
              key: "turn_1:assistant",
              turnId: "turn_1",
              text: "Needle result",
              blockType: "assistantMessage",
            },
          ],
          hasRenderableAgentBodyEntries: false,
          defaultAgentBodyCollapsed: false,
          collapsedMessageCount: 0,
          workedForTimeLabel: null,
        },
      ],
      isThreadRunning: false,
      activeTurnId: null,
      latestTurnId: "turn_1",
      emptyState: { type: "none" },
      showThreadStartProgressPanel: false,
    },
    pendingRequestSurface: null,
    aboveComposerQueueSurface: null,
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
    onResolvePlanImplementationRequest: () => {},
    onEnqueueQueuedFollowUp: async () => {},
    onRemoveQueuedFollowUp: async () => {},
    onReorderQueuedFollowUps: async () => {},
    onSendQueuedFollowUpNow: async () => {},
    onEditQueuedFollowUp: async () => {},
    onEditLastUserTurn: async () => {},
    onForkFromTurn: async () => {},
    onConsumeComposerIntent: () => {},
    onOpenCard: () => {},
    ...overrides,
  };
}

function buildAssistantEntry(overrides?: Partial<CodexConversationItem>): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "assistant_1",
    type: "agent_message",
    kind: "assistantMessage",
    semanticKind: "assistantMessage",
    role: "assistant",
    markdownText: "Assistant message",
    createdAt: 2,
    updatedAt: 2,
    ...overrides,
  };
}

describe("LocalConversationThreadBody", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof globalThis.requestAnimationFrame;
  });

  test("keeps find-in-thread hidden until cmd+f opens it", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { container, rerender } = render(
      <TooltipProvider>
        <LocalConversationThreadBody model={buildModel()} actions={buildActions()} onErrorMessage={() => {}} />
      </TooltipProvider>,
    );

    expect(Boolean(container.querySelector('input[aria-label="Find in thread"]'))).toBeFalse();

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
      const searchInput = container.querySelector('input[aria-label="Find in thread"]') as HTMLInputElement | null;
      expect(Boolean(searchInput)).toBeTrue();
    });
  });

  test("shows a restoring placeholder instead of rendering turn content while the active thread is resuming", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { getByText, queryByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({
            resumeState: "resuming",
            body: {
              ...buildModel().body,
              threadId: "thread_1",
              turns: [],
              emptyState: {
                type: "resumingThread",
                title: "Restoring thread",
                description: "Loading the latest conversation state before rendering the thread.",
                status: "resuming",
              },
            },
          })}
          actions={buildActions()}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    expect(Boolean(getByText("Restoring thread"))).toBeTrue();
    expect(Boolean(queryByText("Needle result"))).toBeFalse();
  });

  test("opens an older-turn fork confirm before invoking the manager action", async () => {
    const onForkFromTurnCalls: Array<{ threadId: string; turnId: string; message: string }> = [];
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { getByLabelText, getByText, queryByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({
            body: {
              ...buildModel().body,
              turns: [
                {
                  ...buildModel().body.turns[0]!,
                  isLatestTurn: false,
                  leadingBlocks: [
                    {
                      id: "user_1",
                      turnId: "turn_1",
                      createdAt: 1,
                      updatedAt: 1,
                      searchableText: "Fork me",
                      type: "userMessage",
                      entry: {
                        threadId: "thread_1",
                        turnId: "turn_1",
                        itemId: "user_1",
                        type: "user_message",
                        kind: "userMessage",
                        semanticKind: "userMessage",
                        role: "user",
                        markdownText: "Fork me",
                        createdAt: 1,
                        updatedAt: 1,
                      },
                      userMessageActions: {
                        canEdit: false,
                        canFork: true,
                      },
                    },
                  ],
                  blocks: [
                    {
                      id: "user_1",
                      turnId: "turn_1",
                      createdAt: 1,
                      updatedAt: 1,
                      searchableText: "Fork me",
                      type: "userMessage",
                      entry: {
                        threadId: "thread_1",
                        turnId: "turn_1",
                        itemId: "user_1",
                        type: "user_message",
                        kind: "userMessage",
                        semanticKind: "userMessage",
                        role: "user",
                        markdownText: "Fork me",
                        createdAt: 1,
                        updatedAt: 1,
                      },
                      userMessageActions: {
                        canEdit: false,
                        canFork: true,
                      },
                    },
                  ],
                },
              ],
            },
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

    fireEvent.click(getByLabelText("Fork from this message"));
    expect(Boolean(queryByText("Fork thread"))).toBeTrue();

    fireEvent.click(getByText("Fork thread"));
    await settleAsyncRender();

    expect(onForkFromTurnCalls.length).toBe(1);
    expect(onForkFromTurnCalls[0]?.turnId).toBe("turn_1");
  });

  test("opens an inline edit prompt in place and only edits on send", async () => {
    const onEditLastUserTurnCalls: Array<{ threadId: string; turnId: string; message: string }> = [];
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { getByDisplayValue, getByLabelText, getByRole, queryByDisplayValue } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({
            body: {
              ...buildModel().body,
              turns: [
                {
                  ...buildModel().body.turns[0]!,
                  leadingBlocks: [
                    {
                      id: "user_1",
                      turnId: "turn_1",
                      createdAt: 1,
                      updatedAt: 1,
                      searchableText: "run bun test",
                      type: "userMessage",
                      entry: {
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
                      },
                      userMessageActions: {
                        canEdit: true,
                        canFork: false,
                      },
                      searchUnitKey: "turn_1:0:user",
                    },
                  ],
                  blocks: [
                    {
                      id: "user_1",
                      turnId: "turn_1",
                      createdAt: 1,
                      updatedAt: 1,
                      searchableText: "run bun test",
                      type: "userMessage",
                      entry: {
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
                      },
                      userMessageActions: {
                        canEdit: true,
                        canFork: false,
                      },
                      searchUnitKey: "turn_1:0:user",
                    },
                  ],
                },
              ],
            },
          })}
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
    expect(Boolean(textarea.getAttribute("class")?.includes("resize-none"))).toBeTrue();

    textarea.value = "run `bun test --bail`";
    fireEvent.input(textarea);
    await settleAsyncRender();
    fireEvent.click(getByRole("button", { name: "Send" }));
    await settleAsyncRender();

    expect(Boolean(queryByDisplayValue("run `bun test --bail`"))).toBeFalse();
    expect(onEditLastUserTurnCalls.length).toBe(1);
    expect(onEditLastUserTurnCalls[0]?.message).toBe("run `bun test --bail`");
  });

  test("keeps the inline edit prompt open when the edit action fails", async () => {
    const errorMessages: string[] = [];
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { getByDisplayValue, getByLabelText, getByRole } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({
            body: {
              ...buildModel().body,
              turns: [
                {
                  ...buildModel().body.turns[0]!,
                  leadingBlocks: [
                    {
                      id: "user_1",
                      turnId: "turn_1",
                      createdAt: 1,
                      updatedAt: 1,
                      searchableText: "run bun test",
                      type: "userMessage",
                      entry: {
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
                      },
                      userMessageActions: {
                        canEdit: true,
                        canFork: false,
                      },
                    },
                  ],
                  blocks: [
                    {
                      id: "user_1",
                      turnId: "turn_1",
                      createdAt: 1,
                      updatedAt: 1,
                      searchableText: "run bun test",
                      type: "userMessage",
                      entry: {
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
                      },
                      userMessageActions: {
                        canEdit: true,
                        canFork: false,
                      },
                    },
                  ],
                },
              ],
            },
          })}
          actions={buildActions({
            onEditLastUserTurn: async () => {
              throw new Error("Edit failed");
            },
          })}
          onErrorMessage={(message) => {
            if (!message) return;
            errorMessages.push(message);
          }}
        />
      </TooltipProvider>,
    );

    fireEvent.click(getByLabelText("Edit message"));
    const textarea = getByDisplayValue("run `bun test`") as HTMLTextAreaElement;
    textarea.value = "run `bun test --watch`";
    fireEvent.input(textarea);
    await settleAsyncRender();
    fireEvent.click(getByRole("button", { name: "Send" }));
    await settleAsyncRender();

    expect(Boolean(getByDisplayValue("run `bun test --watch`"))).toBeTrue();
    expect(errorMessages[0]).toBe("Edit failed");
  });

  test("renders the previous-messages chevron pointing right when collapsed and down when expanded", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const model = buildModel({
      body: {
        ...buildModel().body,
        turns: [
          {
            ...buildModel().body.turns[0]!,
            isLatestTurn: false,
            hasRenderableAgentBodyEntries: true,
            defaultAgentBodyCollapsed: true,
            collapsedMessageCount: 2,
            workedForTimeLabel: null,
            agentBodyEntries: [
              {
                id: "assistant_agent_1",
                turnId: "turn_1",
                createdAt: 2,
                updatedAt: 2,
                searchableText: "Working",
                type: "assistantMessage",
                entry: buildAssistantEntry({ itemId: "assistant_agent_1", markdownText: "Working" }),
              },
            ],
            trailingBlocks: [
              {
                id: "assistant_final_1",
                turnId: "turn_1",
                createdAt: 3,
                updatedAt: 3,
                searchableText: "Done",
                type: "assistantMessage",
                entry: buildAssistantEntry({ itemId: "assistant_final_1", markdownText: "Done", createdAt: 3, updatedAt: 3 }),
              },
            ],
          },
        ],
      },
    });

    const { getByRole } = render(
      <TooltipProvider>
        <LocalConversationThreadBody model={model} actions={buildActions()} onErrorMessage={() => {}} />
      </TooltipProvider>,
    );

    const toggle = getByRole("button", { name: "2 previous messages" });
    const collapsedChevron = toggle.querySelector("svg");
    expect(Boolean(collapsedChevron?.getAttribute("class")?.includes("-rotate-90"))).toBeTrue();

    fireEvent.click(toggle);
    await settleAsyncRender();

    const expandedChevron = getByRole("button", { name: "2 previous messages" }).querySelector("svg");
    expect(Boolean(expandedChevron?.getAttribute("class")?.includes("rotate-0"))).toBeTrue();
  });

  test("does not render a worked-for toggle for the latest completed turn without persisted collapse state", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const model = buildModel({
      body: {
        ...buildModel().body,
        turns: [
          {
            ...buildModel().body.turns[0]!,
            isLatestTurn: true,
            hasRenderableAgentBodyEntries: true,
            defaultAgentBodyCollapsed: false,
            collapsedMessageCount: 2,
            workedForTimeLabel: "3s",
            agentBodyEntries: [
              {
                id: "assistant_agent_1",
                turnId: "turn_1",
                createdAt: 2,
                updatedAt: 2,
                searchableText: "Working",
                type: "assistantMessage",
                entry: buildAssistantEntry({ itemId: "assistant_agent_1", markdownText: "Working" }),
              },
            ],
          },
        ],
      },
    });

    const { queryByRole, getByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody model={model} actions={buildActions()} onErrorMessage={() => {}} />
      </TooltipProvider>,
    );

    expect(Boolean(queryByRole("button", { name: "Worked for 3s" }))).toBeFalse();
    expect(Boolean(getByText("Working"))).toBeTrue();
  });

  test("renders a worked-for toggle for the latest completed turn when a persisted collapse state exists", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const model = buildModel({
      body: {
        ...buildModel().body,
        turns: [
          {
            ...buildModel().body.turns[0]!,
            isLatestTurn: true,
            hasRenderableAgentBodyEntries: true,
            defaultAgentBodyCollapsed: false,
            collapsedMessageCount: 2,
            workedForTimeLabel: "3s",
            agentBodyEntries: [
              {
                id: "assistant_agent_1",
                turnId: "turn_1",
                createdAt: 2,
                updatedAt: 2,
                searchableText: "Working",
                type: "assistantMessage",
                entry: buildAssistantEntry({ itemId: "assistant_agent_1", markdownText: "Working" }),
              },
            ],
          },
        ],
      },
    });

    const { getByRole, queryByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={model}
          actions={buildActions()}
          onErrorMessage={() => {}}
          initialUiState={{ collapsedAgentBodyByTurnId: { turn_1: true } }}
        />
      </TooltipProvider>,
    );

    expect(Boolean(getByRole("button", { name: "Worked for 3s" }))).toBeTrue();
    expect(Boolean(queryByText("Working"))).toBeFalse();
  });
});
