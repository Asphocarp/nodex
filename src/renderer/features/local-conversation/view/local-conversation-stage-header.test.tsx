import { describe, expect, mock, test } from "bun:test";
import { Fragment, createElement, type ReactNode } from "react";
import { render, textContent } from "../../../test/dom";
import type { ThreadStageActions, ThreadStageModel } from "../thread-stage-types";

mock.module("./local-conversation-stage-header-deps", () => ({
  CardInfoHoverCard: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  invoke: async () => null,
  AuthPopover: ({ account }: { account: ThreadStageModel["account"] }) => (
    account !== null && account.account === null
      ? createElement("div", null, "Sign in")
      : null
  ),
  ConnectionBadge: ({ connection }: { connection: ThreadStageModel["connection"] }) =>
    createElement("div", null, connection.status === "connected" ? "Connected" : connection.status),
  renderConnectionAccountTooltipContent: () => null,
}));

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
    composerEnterBehavior: "enter",
    searchOpenTick: 0,
    composerIntent: null,
    title: "Thread title",
    openCardTarget: null,
    activeThreadCardColumnId: null,
    body: {
      threadId: "thread_1",
      turns: [],
      isThreadRunning: false,
      activeTurnId: null,
      latestTurnId: null,
      emptyState: { type: "none" },
      showThreadStartProgressPanel: false,
    },
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

function buildActions(): ThreadStageActions {
  return {
    onCollaborationModeChange: () => { },
    onModelChange: () => { },
    onReasoningEffortChange: () => { },
    onPermissionModeChange: () => { },
    onQueueingEnabledChange: () => { },
    onRefreshAccount: async () => ({
      account: null,
      requiresOpenAiAuth: true,
      pendingLogin: null,
      rateLimits: null,
    }),
    onStartChatGptLogin: async () => ({ type: "apiKey" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: async () => { },
    onLogout: async () => { },
    onStartThreadForCard: async () => { },
    onSendPrompt: async () => { },
    onSteerPrompt: async () => { },
    onInterruptTurn: async () => { },
    onRespondApproval: async () => { },
    onRespondUserInput: async () => { },
    onRespondMcpElicitation: async () => { },
    onResolvePlanImplementationRequest: () => { },
    onEnqueueQueuedFollowUp: async () => { },
    onRemoveQueuedFollowUp: async () => { },
    onReorderQueuedFollowUps: async () => { },
    onSendQueuedFollowUpNow: async () => { },
    onEditQueuedFollowUp: async () => { },
    onEditLastUserTurn: async () => { },
    onForkFromTurn: async () => { },
    onConsumeComposerIntent: () => { },
    onOpenThread: () => { },
    onCleanBackgroundTerminals: async () => { },
    onOpenCard: () => { },
  };
}

describe("ThreadStageHeader auth chrome", () => {
  test("does not show sign-in or connected badge before the account snapshot hydrates", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const { container } = render(
      <ThreadStageHeader model={buildModel({ account: null })} actions={buildActions()} onErrorMessage={() => { }} />,
    );

    const content = textContent(container);
    expect(content.includes("Sign in")).toBeFalse();
    expect(content.includes("Connected")).toBeFalse();
  });

  test("shows sign-in without the connected badge when the account snapshot is logged out", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const { container } = render(
      <ThreadStageHeader
        model={buildModel({
          account: {
            account: null,
            requiresOpenAiAuth: true,
            pendingLogin: null,
            rateLimits: null,
          },
        })}
        actions={buildActions()}
        onErrorMessage={() => { }}
      />,
    );

    const content = textContent(container);
    expect(content.includes("Sign in")).toBeTrue();
    expect(content.includes("Connected")).toBeFalse();
  });

  test("shows the connected badge without sign-in when the account snapshot is authenticated", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const { container } = render(
      <ThreadStageHeader
        model={buildModel({
          account: {
            account: { type: "chatgpt", email: "dev@example.com", planType: "Plus" },
            requiresOpenAiAuth: false,
            pendingLogin: null,
            rateLimits: null,
          },
        })}
        actions={buildActions()}
        onErrorMessage={() => { }}
      />,
    );

    const content = textContent(container);
    expect(content.includes("Sign in")).toBeFalse();
    expect(content.includes("Connected")).toBeTrue();
  });
});
