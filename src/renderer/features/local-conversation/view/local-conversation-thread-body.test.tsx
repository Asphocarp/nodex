import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "../../../components/ui/tooltip";
import { installAsyncRequestAnimationFrame } from "../../../test/browser-globals";
import { render, settleAsyncRender } from "../../../test/dom";
import type {
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexConversationTurn,
} from "../../../lib/types";
import type { ThreadBodySurfaceModel, ThreadStageActions } from "../thread-stage-types";
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

function buildDynamicCreateThreadEntry(
  overrides?: Partial<CodexConversationItem>,
): CodexConversationItem {
  const dynamicToolCall: NonNullable<CodexConversationItem["dynamicToolCall"]> = {
    callId: "dynamic_create_thread",
    namespace: "codex_app",
    tool: "create_thread",
    arguments: {
      prompt: "Continue in a background chat",
      target: { type: "projectless" },
    },
    status: "completed",
    contentItems: [{ type: "inputText", text: "{\"threadId\":\"thread-created\"}" }],
    success: true,
    durationMs: 8,
    completed: true,
  };

  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "dynamic_create_thread",
    entryId: "dynamic_create_thread",
    type: "dynamicToolCall",
    kind: "toolCall",
    semanticKind: "dynamicToolCall",
    status: "completed",
    toolCall: {
      subtype: "dynamic",
      toolName: dynamicToolCall.tool,
      server: dynamicToolCall.namespace ?? undefined,
      args: dynamicToolCall.arguments,
      result: dynamicToolCall.contentItems ?? undefined,
    },
    dynamicToolCall,
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
    source: overrides?.source ?? null,
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

function buildModel(overrides?: {
  conversation?: CodexConversationSnapshot | null;
  body?: ThreadBodySurfaceModel["body"];
  searchOpenTick?: number;
  projectWorkspacePath?: string | null;
  threadStartProgress?: ThreadBodySurfaceModel["threadStartProgress"];
}): ThreadBodySurfaceModel {
  const conversation = overrides?.conversation ?? buildConversation();
  const body =
    overrides?.body ??
    buildThreadBodyModel({
      activeThreadId: conversation?.threadId ?? null,
      threadId: conversation?.threadId ?? null,
      turns: conversation?.turns ?? [],
      requests: conversation?.requests ?? [],
      resumeState: conversation?.resumeState ?? null,
      statusType: conversation?.statusType ?? null,
      archived: conversation?.archived ?? false,
      capabilityFlags: conversation?.capabilityFlags ?? {
        canEditLastUserTurn: false,
        canForkFromTurn: false,
        canSearch: false,
        canCollapseTurns: false,
      },
      parentTurns: [],
      isNewThreadTab: false,
      newThreadTarget: null,
      isCloudNewThreadTarget: false,
      threadStartProgress: overrides?.threadStartProgress ?? null,
    });

  return {
    projectId: conversation?.projectId ?? "project_1",
    threadId: conversation?.threadId ?? null,
    cwd: conversation?.cwd ?? null,
    turns: conversation?.turns ?? [],
    requests: conversation?.requests ?? [],
    resumeState: conversation?.resumeState ?? null,
    statusType: conversation?.statusType ?? null,
    capabilityFlags: conversation?.capabilityFlags ?? {
      canEditLastUserTurn: false,
      canForkFromTurn: false,
      canSearch: false,
      canCollapseTurns: false,
    },
    body,
    parentTurns: [],
    projectWorkspacePath: overrides?.projectWorkspacePath ?? "/tmp/project",
    searchOpenTick: overrides?.searchOpenTick ?? 0,
    threadStartProgress: overrides?.threadStartProgress ?? null,
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
    onUnarchiveThread: async () => {},
    onOpenTurnDiffReview: () => {},
    onConsumeComposerIntent: () => {},
    onOpenThread: () => {},
    onCleanBackgroundTerminals: async () => {},
    ...overrides,
  };
}

describe("LocalConversationThreadBody", () => {
  beforeEach(() => {
    installAsyncRequestAnimationFrame();
  });

  test("does not render the retired in-thread sticky search input", async () => {
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

    await settleAsyncRender();
    expect(
      Boolean(container.querySelector('input[aria-label="Find in thread"]')),
    ).toBeFalse();
  });

  test("opens the created chat from a create_thread tool card through stage actions", async () => {
    const openedThreads: string[] = [];
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const dynamicEntry = buildDynamicCreateThreadEntry();
    const conversation = buildConversation({
      turns: [
        buildTurn({
          itemIds: ["user_1", dynamicEntry.itemId, "assistant_1"],
          items: [buildUserEntry(), dynamicEntry, buildAssistantEntry()],
        }),
      ],
    });

    const view = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({ conversation })}
          actions={buildActions({
            onOpenThread: (threadId) => {
              openedThreads.push(threadId);
            },
          })}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    fireEvent.click(view.getByRole("button", { name: "Open chat" }));

    expect(openedThreads.join(",")).toBe("thread-created");
  });

  test("lets the shared scroll layout own viewport and content wrappers", async () => {
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
    const motionWrapper = viewport?.firstElementChild as HTMLDivElement | null;
    const widthWrapper = motionWrapper?.firstElementChild as HTMLDivElement | null;

    expect(Boolean(viewport)).toBeTrue();

    expect(Boolean(motionWrapper)).toBeTrue();
    expect(Boolean(widthWrapper)).toBeTrue();
    expect(widthWrapper?.contains(contentRoot)).toBeTrue();

    expect(Boolean(contentRoot)).toBeTrue();
  });

  test("shows a restoring placeholder instead of rendering turn content while the active thread is resuming", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const model = buildModel({
      conversation: null,
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
    const resumingModel: ThreadBodySurfaceModel = {
      ...model,
      threadId: "thread_1",
      resumeState: "resuming",
    };

    const { getByRole, queryByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={resumingModel}
          actions={buildActions()}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    expect(Boolean(getByRole("status", { name: /Restoring thread/i }))).toBeTrue();
    expect(Boolean(queryByText("Assistant message"))).toBeFalse();
  });

  test("renders compact local-project thread start progress without worktree steps", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { getByText, queryByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({
            conversation: buildConversation({ turns: [] }),
            threadStartProgress: {
              runInTarget: "localProject",
              threadId: "thread_1",
              phase: "startingThread",
              message: "Sending message…",
              outputText: "",
              updatedAt: 10,
            },
          })}
          actions={buildActions()}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    expect(Boolean(getByText("Sending message…"))).toBeTrue();
    expect(Boolean(queryByText("Worktree"))).toBeFalse();
    expect(Boolean(queryByText("Setup"))).toBeFalse();
    expect(Boolean(queryByText("No messages yet"))).toBeFalse();
  });

  test("keeps the new-worktree start progress steps and log output", async () => {
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { getByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({
            conversation: buildConversation({ turns: [] }),
            threadStartProgress: {
              runInTarget: "newWorktree",
              threadId: "thread_1",
              phase: "runningSetup",
              message: "Preparing worktree…",
              outputText: "setup log\n",
              updatedAt: 10,
            },
          })}
          actions={buildActions()}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    expect(Boolean(getByText("Worktree"))).toBeTrue();
    expect(Boolean(getByText("Setup"))).toBeTrue();
    expect(Boolean(getByText("Thread"))).toBeTrue();
    expect(Boolean(getByText("setup log"))).toBeTrue();
  });

  test("shows archived thread restore action without rendering transcript content", async () => {
    const restoreCalls: Array<{ threadId: string; projectId: string }> = [];
    const { LocalConversationThreadBody } = await import("./local-conversation-thread-body");
    const { getByRole, queryByText } = render(
      <TooltipProvider>
        <LocalConversationThreadBody
          model={buildModel({
            conversation: buildConversation({
              archived: true,
              resumeState: "needs_resume",
            }),
          })}
          actions={buildActions({
            onUnarchiveThread: async (threadId, projectId) => {
              restoreCalls.push({ threadId, projectId });
            },
          })}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>,
    );

    expect(Boolean(queryByText("Assistant message"))).toBeFalse();
    expect(Boolean(queryByText("Archived thread"))).toBeTrue();

    fireEvent.click(getByRole("button", { name: "Restore" }));
    await settleAsyncRender();

    expect(restoreCalls.length).toBe(1);
    expect(restoreCalls[0]?.threadId).toBe("thread_1");
    expect(restoreCalls[0]?.projectId).toBe("project_1");
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

    fireEvent.click(getAllByLabelText("Fork from this point")[0]!);
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
          durationMs: 125_000,
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

    expect(Boolean(getByRole("button", { name: /Worked for 2m 5s/i }))).toBeTrue();
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
