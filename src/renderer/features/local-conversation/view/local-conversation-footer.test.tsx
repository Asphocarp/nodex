import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { installAsyncRequestAnimationFrame } from "../../../test/browser-globals";
import { NodexTooltipProvider as TooltipProvider } from "../../../components/ui/tooltip";
import { render } from "../../../test/dom";
import type { ThreadStageActions, ThreadStageModel } from "../thread-stage-types";
import {
  EnsureLocalConversationThreadScrollController,
  LocalConversationThreadScrollLayout,
} from "./local-conversation-thread-scroll-controller";

function buildModel(overrides?: Partial<ThreadStageModel>): ThreadStageModel {
  return {
    projectId: "project_1",
    projectWorkspacePath: "/tmp/project",
    conversation: {
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
      linkedAt: "2026-04-06T00:00:00.000Z",
      resumeState: "resumed",
      turns: [
        {
          threadId: "thread_1",
          turnId: "turn_1",
          status: "completed",
          itemIds: [],
          items: [],
        },
      ],
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
    } as ThreadStageModel["conversation"],
    resumeState: "resumed",
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
    title: "Thread",
    openCardTarget: null,
    activeThreadCardColumnId: null,
    body: {
      threadId: "thread_1",
      turnCount: 1,
      hasAboveComposerBlocks: false,
      isThreadRunning: false,
      activeTurnId: null,
      latestTurnId: "turn_1",
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
  };
}

describe("LocalConversationFooter", () => {
  beforeEach(() => {
    installAsyncRequestAnimationFrame();
  });

  test("renders the catch-up button inside the footer owner", async () => {
    const { LocalConversationFooter } = await import("./local-conversation-footer");
    const { container, getByLabelText } = render(
      <TooltipProvider>
        <div className="h-96">
          <EnsureLocalConversationThreadScrollController>
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <LocalConversationThreadScrollLayout>
                  <div style={{ height: "1200px" }}>Thread content</div>
                </LocalConversationThreadScrollLayout>
              </div>
              <LocalConversationFooter
                model={buildModel()}
                actions={buildActions()}
                errorMessage={null}
                onErrorMessage={() => {}}
              />
            </div>
          </EnsureLocalConversationThreadScrollController>
        </div>
      </TooltipProvider>,
    );

    const viewport = container.querySelector(
      "[data-local-conversation-thread-body='true']",
    ) as HTMLDivElement | null;
    expect(Boolean(viewport)).toBeTrue();

    if (!viewport) return;

    let scrollTopValue = 0;
    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    const scrollToCalls: Array<{ top?: number; behavior?: ScrollBehavior }> = [];
    Object.defineProperty(viewport, "scrollTo", {
      configurable: true,
      value: ({ top, behavior }: { top?: number; behavior?: ScrollBehavior }) => {
        scrollToCalls.push({ top, behavior });
        if (typeof top === "number") {
          scrollTopValue = top;
        }
      },
    });

    scrollTopValue = 200;
    fireEvent.scroll(viewport);

    await waitFor(() => {
      expect(Boolean(container.querySelector('[aria-label="Scroll to latest message"]'))).toBeTrue();
    });

    scrollToCalls.length = 0;
    fireEvent.click(getByLabelText("Scroll to latest message"));

    expect(Boolean(container.querySelector(".relative.h-0"))).toBeTrue();
    expect(scrollToCalls.length).toBe(1);
    expect(scrollToCalls[0]?.top).toBe(1200);
  });
});
