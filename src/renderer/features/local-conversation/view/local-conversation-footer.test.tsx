import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { installAsyncRequestAnimationFrame } from "../../../test/browser-globals";
import { NodexTooltipProvider as TooltipProvider } from "../../../components/ui/tooltip";
import { render } from "../../../test/dom";
import type { ThreadFooterModel, ThreadStageActions } from "../thread-stage-types";
import type { CodexConversationItem, CodexConversationTurn } from "../../../lib/types";
import {
  EnsureLocalConversationThreadScrollController,
  LocalConversationThreadScrollLayout,
} from "./local-conversation-thread-scroll-controller";

function buildModel(overrides?: Partial<ThreadFooterModel>): ThreadFooterModel {
  return {
    projectId: "project_1",
    projectWorkspacePath: "/tmp/project",
    threadId: "thread_1",
    cwd: "/tmp/project",
    account: null,
    conversation: {
      threadId: "thread_1",
      projectId: "project_1",
      source: null,
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
    },
    resumeState: "resumed",
    activeTurn: null,
    isThreadRunning: false,
    isNewThreadTab: false,
    isCloudNewThreadTarget: false,
    newThreadTarget: null,
    availableModels: [],
    collaborationModes: [],
    selectedCollaborationMode: "default",
    selectedModel: "gpt-5.3-codex",
    selectedReasoningEffort: "high",
    reasoningEffortOptions: [],
    permissionMode: "auto",
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    composerIntent: null,
    dictation: {
      isEnabled: true,
      authMethod: "chatgpt",
      isRealtimeVoiceActive: false,
      shortcutLabel: "Ctrl+M",
    },
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
  };
}

function buildUserItem(overrides?: Partial<CodexConversationItem>): CodexConversationItem {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    itemId: "user_1",
    entryId: "user_1",
    type: "user_message",
    kind: "userMessage",
    semanticKind: "userMessage",
    role: "user",
    markdownText: "Run the checks",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildRenderableTurn(overrides?: Partial<CodexConversationTurn>): CodexConversationTurn {
  return {
    threadId: "thread_1",
    turnId: "turn_1",
    status: "completed",
    itemIds: ["user_1"],
    items: [buildUserItem()],
    ...overrides,
  };
}

function buildModelWithRenderableLatestTurn(): ThreadFooterModel {
  const baseModel = buildModel();
  const latestTurn = buildRenderableTurn();
  if (!baseModel.conversation) return baseModel;

  return buildModel({
    conversation: {
      ...baseModel.conversation,
      turns: [latestTurn],
    },
    body: {
      ...baseModel.body,
      turnCount: 1,
      latestTurnId: latestTurn.turnId,
    },
  });
}

describe("LocalConversationFooter", () => {
  beforeEach(() => {
    installAsyncRequestAnimationFrame();
  });

  test("updates composer mode chrome when the selected collaboration mode changes", async () => {
    const { LocalConversationFooter } = await import("./local-conversation-footer");
    const baseModel = buildModel({
      collaborationModes: [
        { mode: "default", name: "Default", model: null },
        { mode: "plan", name: "Plan", model: null },
      ],
    });
    const actions = buildActions();
    const view = render(
      <TooltipProvider>
        <EnsureLocalConversationThreadScrollController>
          <LocalConversationFooter
            model={{ ...baseModel, selectedCollaborationMode: "default" }}
            actions={actions}
            errorMessage={null}
            onErrorMessage={() => {}}
          />
        </EnsureLocalConversationThreadScrollController>
      </TooltipProvider>,
    );

    expect(view.queryByLabelText("Plan") === null).toBeTrue();

    view.rerender(
      <TooltipProvider>
        <EnsureLocalConversationThreadScrollController>
          <LocalConversationFooter
            model={{ ...baseModel, selectedCollaborationMode: "plan" }}
            actions={actions}
            errorMessage={null}
            onErrorMessage={() => {}}
          />
        </EnsureLocalConversationThreadScrollController>
      </TooltipProvider>,
    );

    const planButton = view.getByLabelText("Plan");
    const formFooter = view.container.querySelector('[data-composer-form-footer="true"]');
    expect(formFooter !== null).toBeTrue();
    expect(Boolean(formFooter?.contains(planButton))).toBeTrue();

    fireEvent.pointerDown(view.getByLabelText("Add files and more"), { button: 0, ctrlKey: false });
    fireEvent.click(view.getByLabelText("Add files and more"));

    await waitFor(() => {
      const planRow = view.container.ownerDocument.body.querySelector('[data-add-context-row="plan-mode"]');
      if (!planRow) {
        throw new Error("Expected the Plan mode row.");
      }
      expect(planRow.querySelector('[data-state="checked"]') !== null).toBeTrue();
    });

    view.rerender(
      <TooltipProvider>
        <EnsureLocalConversationThreadScrollController>
          <LocalConversationFooter
            model={{ ...baseModel, selectedCollaborationMode: "default" }}
            actions={actions}
            errorMessage={null}
            onErrorMessage={() => {}}
          />
        </EnsureLocalConversationThreadScrollController>
      </TooltipProvider>,
    );

    expect(view.queryByLabelText("Plan") === null).toBeTrue();
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

    scrollTopValue = -200;
    fireEvent.scroll(viewport);

    await waitFor(() => {
      expect(Boolean(container.querySelector('[aria-label="Scroll to latest message"]'))).toBeTrue();
    });

    scrollToCalls.length = 0;
    fireEvent.click(getByLabelText("Scroll to latest message"));

    expect(Boolean(container.querySelector(".relative.h-0"))).toBeTrue();
    expect(scrollToCalls.length).toBe(1);
    expect(scrollToCalls[0]?.top).toBe(0);
  });

  test("overlay mode renders portals, latest-turn preview, and composer in fixture order", async () => {
    const { LocalConversationFooter } = await import("./local-conversation-footer");
    const target = document.createElement("div");
    document.body.appendChild(target);

    render(
      <TooltipProvider>
        <EnsureLocalConversationThreadScrollController>
          <LocalConversationFooter
            model={buildModelWithRenderableLatestTurn()}
            actions={buildActions()}
            errorMessage={null}
            onErrorMessage={() => {}}
            rightPanelComposerOverlay={{ enabled: true, target }}
          />
        </EnsureLocalConversationThreadScrollController>
      </TooltipProvider>,
    );

    await waitFor(() => {
      const overlay = target.querySelector('[data-testid="right-panel-composer-overlay"]');
      if (!overlay) throw new Error("Expected right-panel overlay");
      expect(overlay.querySelector("#above-composer-portal") !== null).toBeTrue();
      expect(overlay.querySelector("#above-composer-queue-portal") !== null).toBeTrue();
      expect(overlay.querySelector('[data-right-panel-latest-turn-preview="true"]') !== null).toBeTrue();
      expect(overlay.querySelector('[data-local-conversation-composer-shell="true"]') !== null).toBeTrue();
    });

    const overlay = target.querySelector('[data-testid="right-panel-composer-overlay"]') as HTMLElement;
    const aboveComposerPortal = overlay.querySelector("#above-composer-portal");
    const queuePortal = overlay.querySelector("#above-composer-queue-portal");
    const latestTurnPreview = overlay.querySelector('[data-right-panel-latest-turn-preview="true"]');
    const composerShell = overlay.querySelector('[data-local-conversation-composer-shell="true"]');
    if (!aboveComposerPortal || !queuePortal || !latestTurnPreview || !composerShell) {
      throw new Error("Expected overlay fixture nodes");
    }

    expect(Boolean(aboveComposerPortal.compareDocumentPosition(queuePortal) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTrue();
    expect(Boolean(queuePortal.compareDocumentPosition(latestTurnPreview) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTrue();
    expect(Boolean(latestTurnPreview.compareDocumentPosition(composerShell) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTrue();

    fireEvent.animationEnd(overlay);
    await waitFor(() => {
      expect(overlay.getAttribute("aria-hidden")).toBe("false");
    });

    const previewToggle = latestTurnPreview.querySelector("button");
    expect(previewToggle?.getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerDown(document.body);
    expect(previewToggle?.getAttribute("aria-expanded")).toBe("false");
  });

  test("overlay outside pointerdown collapses preview without globally dismissing tooltips", async () => {
    const { LocalConversationFooter } = await import("./local-conversation-footer");
    const target = document.createElement("div");
    document.body.appendChild(target);
    let tooltipDismissEvents = 0;
    const handleTooltipDismiss = () => {
      tooltipDismissEvents += 1;
    };
    window.addEventListener("codex:dismiss-tooltips", handleTooltipDismiss);

    try {
      render(
        <TooltipProvider>
          <EnsureLocalConversationThreadScrollController>
            <LocalConversationFooter
              model={buildModelWithRenderableLatestTurn()}
              actions={buildActions()}
              errorMessage={null}
              onErrorMessage={() => {}}
              rightPanelComposerOverlay={{ enabled: true, target }}
            />
          </EnsureLocalConversationThreadScrollController>
        </TooltipProvider>,
      );

      const overlay = target.querySelector('[data-testid="right-panel-composer-overlay"]') as HTMLElement;
      fireEvent.animationEnd(overlay);

      await waitFor(() => {
        expect(overlay.getAttribute("aria-hidden")).toBe("false");
      });

      const latestTurnPreview = overlay.querySelector('[data-right-panel-latest-turn-preview="true"]');
      const previewToggle = latestTurnPreview?.querySelector("button");
      expect(previewToggle?.getAttribute("aria-expanded")).toBe("true");

      fireEvent.pointerDown(document.body);

      expect(previewToggle?.getAttribute("aria-expanded")).toBe("false");
      expect(tooltipDismissEvents).toBe(0);
    } finally {
      window.removeEventListener("codex:dismiss-tooltips", handleTooltipDismiss);
    }
  });

  test("resuming active threads keep overlay composer ownership disabled", async () => {
    const { LocalConversationFooter } = await import("./local-conversation-footer");
    const target = document.createElement("div");
    document.body.appendChild(target);

    const { container } = render(
      <TooltipProvider>
        <EnsureLocalConversationThreadScrollController>
          <LocalConversationFooter
            model={buildModel({ resumeState: "needs_resume" })}
            actions={buildActions()}
            errorMessage={null}
            onErrorMessage={() => {}}
            rightPanelComposerOverlay={{ enabled: true, target }}
          />
        </EnsureLocalConversationThreadScrollController>
      </TooltipProvider>,
    );

    expect(target.querySelector('[data-testid="right-panel-composer-overlay"]') === null).toBeTrue();
    expect(container.querySelector('[data-local-conversation-composer-shell="true"]') === null).toBeTrue();
  });
});
