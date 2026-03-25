import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { render } from "../../../test/dom";
import type { ThreadStageScreenProps } from "../thread-stage-types";

mock.module("./local-conversation-stage-header", () => ({
  ThreadStageHeader: () => createElement("div", { "data-local-conversation-header": "true" }),
}));

mock.module("./local-conversation-footer", () => ({
  LocalConversationFooter: () => createElement("div", { "data-local-conversation-footer": "true" }),
}));

function buildProps(overrides?: Partial<ThreadStageScreenProps["model"]>): ThreadStageScreenProps {
  return {
    model: {
      projectId: "project_1",
      projectWorkspacePath: "/tmp/project",
      conversation: null,
      resumeState: null,
      activeTurn: null,
      isThreadRunning: false,
      isNewThreadTab: true,
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
      title: "New thread",
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
            searchUnits: [],
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
      composerShell: {
        activeRequest: null,
        backgroundRequest: null,
        pendingSteers: [],
        queuedFollowUps: [],
        backgroundAgentRows: [],
        backgroundTerminalRows: [],
        showRequestCards: false,
        showComposer: true,
        showApprovalMode: false,
      },
      ...overrides,
    },
    actions: {
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
      onStartChatGptLogin: async () => ({ type: "apiKey" as const }),
      onStartApiKeyLogin: async () => ({ type: "apiKey" as const }),
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
      onOpenThread: () => {},
      onStopBackgroundTerminals: async () => {},
      onOpenCard: () => {},
    },
  };
}

describe("LocalConversationStageScreen", () => {
  test("renders the stage header, body, and footer from the local-conversation shell", async () => {
    const { LocalConversationStageScreen } = await import("./local-conversation-stage-screen");
    const { container } = render(<LocalConversationStageScreen {...buildProps()} />);

    expect(Boolean(container.querySelector("[data-local-conversation-header='true']"))).toBeTrue();
    expect(Boolean(container.querySelector("[data-local-conversation-thread-body='true']"))).toBeTrue();
    expect(Boolean(container.querySelector("[data-local-conversation-footer='true']"))).toBeTrue();
  });
});
