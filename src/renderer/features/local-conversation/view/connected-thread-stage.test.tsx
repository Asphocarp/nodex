import { describe, expect, mock, test } from "bun:test";
import { act, waitFor } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "../../../components/ui/tooltip";
import { installAsyncRequestAnimationFrame, installWindowApi } from "../../../test/browser-globals";
import { render, settleAsyncRender, textContent } from "../../../test/dom";
import { TestQueryProvider } from "../../../test/query";
import type {
  CodexConnectionState,
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexHostMessage,
  CodexThreadSummary,
} from "../../../lib/types";
import type { ThreadStageActions, ThreadStageRouteInput } from "../thread-stage-types";

let invokeCalls: Array<{ channel: string; threadId?: string }> = [];
let hostMessageListener: ((message: CodexHostMessage) => void) | null = null;

mock.module("../local-conversation-deps", () => ({
  invoke: async (channel: string, threadId?: string) => {
    invokeCalls.push({ channel, threadId });
    if (channel === "codex:account:read") {
      return {
        account: null,
        requiresOpenAiAuth: false,
        pendingLogin: null,
        rateLimits: null,
      };
    }

    if (channel === "codex:connection:status") {
      return {
        status: "connected",
        retries: 0,
      } satisfies CodexConnectionState;
    }

    if (channel === "codex:model:list") {
      return [];
    }

    return null;
  },
  subscribeCodexHostMessages: (listener: (message: CodexHostMessage) => void) => {
    hostMessageListener = listener;
    return () => {
      if (hostMessageListener === listener) {
        hostMessageListener = null;
      }
    };
  },
}));

describe("resolveEffectiveThreadStageSettings", () => {
  test("prefers active conversation thread settings over shell fallbacks", async () => {
    const { resolveEffectiveThreadStageSettings } = await import("./connected-thread-stage");
    const settings = resolveEffectiveThreadStageSettings({
      activeThreadId: "thread_1",
      liveThreadSettings: {
        model: "gpt-thread",
        reasoningEffort: "medium",
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-thread",
            reasoning_effort: "medium",
            developer_instructions: null,
          },
        },
      },
      liveMode: null,
      fallbackMode: "default",
      fallbackModel: "gpt-draft",
      fallbackReasoningEffort: "high",
      availableModes: [
        { mode: "default", name: "Default", model: null },
        { mode: "plan", name: "Plan", model: null },
      ],
    });

    expect(settings.selectedCollaborationMode).toBe("plan");
    expect(settings.selectedModel).toBe("gpt-thread");
    expect(settings.selectedReasoningEffort).toBe("medium");
  });

  test("uses shell fallbacks for new-thread drafts", async () => {
    const { resolveEffectiveThreadStageSettings } = await import("./connected-thread-stage");
    const settings = resolveEffectiveThreadStageSettings({
      activeThreadId: null,
      liveThreadSettings: {
        model: "gpt-thread",
        reasoningEffort: "medium",
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-thread",
            reasoning_effort: "medium",
            developer_instructions: null,
          },
        },
      },
      liveMode: null,
      fallbackMode: "default",
      fallbackModel: "gpt-draft",
      fallbackReasoningEffort: "high",
      availableModes: [
        { mode: "default", name: "Default", model: null },
        { mode: "plan", name: "Plan", model: null },
      ],
    });

    expect(settings.selectedCollaborationMode).toBe("default");
    expect(settings.selectedModel).toBe("gpt-draft");
    expect(settings.selectedReasoningEffort).toBe("high");
  });
});

function buildThreadSummary(archived: boolean): CodexThreadSummary {
  return {
    threadId: archived ? "thread_archived" : "thread_active",
    projectId: "project_1",
    source: null,
    threadName: archived ? "Archived" : "Active",
    threadPreview: "",
    modelProvider: "openai",
    cwd: "/tmp/project",
    statusType: "idle",
    statusActiveFlags: [],
    archived,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-03-21T00:00:00.000Z",
  };
}

function buildConversation(threadId: string): CodexConversationSnapshot {
  const userItem: CodexConversationItem = {
    threadId,
    turnId: "turn_ready",
    itemId: "user_ready",
    type: "user_message",
    kind: "userMessage",
    semanticKind: "userMessage",
    role: "user",
    markdownText: "Remove the redundant transitions.",
    createdAt: 1,
    updatedAt: 1,
  };

  return {
    threadId,
    projectId: "project_1",
    source: null,
    threadName: "Ready thread",
    threadPreview: "Remove redundant transitions.",
    modelProvider: "openai",
    cwd: "/tmp/project",
    statusType: "active",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-03-21T00:00:00.000Z",
    resumeState: "resumed",
    turns: [{
      threadId,
      turnId: "turn_ready",
      status: "inProgress",
      itemIds: [userItem.itemId],
      items: [userItem],
    }],
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
  };
}

function buildActions(): ThreadStageActions {
  const noopAsync = async () => undefined;
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
    onCancelLogin: noopAsync,
    onLogout: noopAsync,
    onSendPrompt: noopAsync,
    onSteerPrompt: noopAsync,
    onInterruptTurn: noopAsync,
    onRespondApproval: noopAsync,
    onRespondUserInput: noopAsync,
    onRespondMcpElicitation: noopAsync,
    onResolvePlanImplementationRequest: noopAsync,
    onEnqueueQueuedFollowUp: noopAsync,
    onRemoveQueuedFollowUp: noopAsync,
    onReorderQueuedFollowUps: noopAsync,
    onSendQueuedFollowUpNow: noopAsync,
    onEditQueuedFollowUp: noopAsync,
    onEditLastUserTurn: noopAsync,
    onForkFromTurn: noopAsync,
    onUnarchiveThread: noopAsync,
    onOpenTurnDiffReview: () => {},
    onConsumeComposerIntent: () => {},
    onOpenThread: () => {},
    onCleanBackgroundTerminals: noopAsync,
    onNewThreadProjectChange: () => {},
  };
}

async function renderStage(summary: CodexThreadSummary) {
  const {
    __resetLocalConversationStoreForTests,
    LocalConversationProvider,
  } = await import("../local-conversation-store");
  const { ConnectedThreadStage } = await import("./connected-thread-stage");
  __resetLocalConversationStoreForTests();

  render(
    <TestQueryProvider>
      <TooltipProvider>
        <LocalConversationProvider>
          <ConnectedThreadStage
            projectId="project_1"
            projectWorkspacePath="/tmp/project"
            isNewThreadTab={false}
            newThreadTarget={null}
            newThreadProjectSelector={null}
            newThreadStartInSelector={null}
            threadStartProgress={null}
            activeThreadId={summary.threadId}
            activeThreadSummary={summary}
            availableModels={[]}
            collaborationModes={[]}
            selectedCollaborationMode="default"
            selectedModel=""
            selectedReasoningEffort="medium"
            reasoningEffortOptions={[]}
            permissionMode="auto"
            isQueueingEnabled={false}
            composerEnterBehavior="enter"
            searchOpenTick={0}
            actions={buildActions()}
          />
        </LocalConversationProvider>
      </TooltipProvider>
    </TestQueryProvider>,
  );
  await settleAsyncRender();
}

async function renderNewThreadHome(overrides?: {
  threadStartProgress?: ThreadStageRouteInput["threadStartProgress"];
}) {
  const {
    __resetLocalConversationStoreForTests,
    LocalConversationProvider,
  } = await import("../local-conversation-store");
  const { ConnectedThreadStage } = await import("./connected-thread-stage");
  __resetLocalConversationStoreForTests();
  installWindowApi({
    invoke: async (channel: string) => {
      if (channel === "git:branch:state") {
        return {
          currentBranch: "dev-redesign",
          defaultBranch: "main",
          branches: ["dev-redesign", "main"],
        };
      }
      if (channel === "codex:permission:state:get") {
        return {
          mode: "full-access",
          effectivePreset: "full-access",
          availableModes: ["auto", "full-access", "custom"],
          approvalPolicy: "never",
          approvalsReviewer: "user",
          sandboxMode: "danger-full-access",
          sandbox: { type: "dangerFullAccess" },
          guardianApprovalEnabled: false,
          configTarget: null,
          customDescription: null,
        };
      }
      if (channel === "git:branch:watch:start" || channel === "git:branch:watch:stop") {
        return true;
      }
      return null;
    },
    on: () => () => {},
  });

  const view = render(
    <TestQueryProvider>
      <TooltipProvider>
        <LocalConversationProvider>
          <ConnectedThreadStage
          projectId="project_1"
          projectWorkspacePath="/tmp/nodex"
          isNewThreadTab
          newThreadTarget={{
            projectId: "project_1",
            projectName: "Nodex",
            sessionId: "session_1",
            threadTitle: "New thread",
            runInTarget: "localProject",
          }}
          newThreadProjectSelector={{
            projects: [
              {
                id: "project_1",
                label: "Nodex",
                description: "/tmp/nodex",
                primaryWorkspaceRoot: "/tmp/nodex",
                searchText: "nodex /tmp/nodex",
              },
            ],
            selectedProjectId: "project_1",
            disabled: false,
            canAddProject: true,
          }}
          newThreadStartInSelector={{
            target: {
              runInTarget: "localProject",
              runInEnvironmentPath: null,
              worktreeStartMode: "detachedHead",
              worktreeBranchPrefix: "nodex/",
            },
            disabled: false,
            worktreeAvailable: true,
            environments: [],
            environmentsLoading: false,
            selectedEnvironmentPath: null,
            worktreeStartMode: "detachedHead",
            worktreeBranchPrefix: "nodex/",
          }}
          threadStartProgress={overrides?.threadStartProgress ?? null}
          activeThreadId={null}
          activeThreadSummary={null}
          availableModels={[{
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "5.5",
            description: "",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "xhigh",
            supportedReasoningEfforts: [{ reasoningEffort: "xhigh", description: "Extra High" }],
          }]}
          collaborationModes={[]}
          selectedCollaborationMode="default"
          selectedModel="gpt-5.5"
          selectedReasoningEffort="xhigh"
          reasoningEffortOptions={[{ reasoningEffort: "xhigh", description: "Extra High" }]}
          permissionMode="full-access"
          isQueueingEnabled={false}
          composerEnterBehavior="enter"
          searchOpenTick={0}
          actions={buildActions()}
          />
        </LocalConversationProvider>
      </TooltipProvider>
    </TestQueryProvider>,
  );
  await settleAsyncRender();
  await act(async () => {
    await settleAsyncRender();
  });
  return view;
}

describe("ConnectedThreadStage archived resume behavior", () => {
  test("does not auto-resume archived active thread summaries", async () => {
    installAsyncRequestAnimationFrame();
    invokeCalls = [];
    hostMessageListener = null;

    await renderStage(buildThreadSummary(true));
    await act(async () => {
      await settleAsyncRender();
    });

    expect(
      invokeCalls.some((call) => call.channel === "codex:thread:resume:request"),
    ).toBeFalse();
  });

  test("auto-resumes non-archived active thread summaries", async () => {
    installAsyncRequestAnimationFrame();
    invokeCalls = [];
    hostMessageListener = null;

    await renderStage(buildThreadSummary(false));
    await act(async () => {
      await settleAsyncRender();
    });

    expect(
      invokeCalls.some((call) =>
        call.channel === "codex:thread:resume:request" &&
        call.threadId === "thread_active"),
    ).toBeTrue();
  });
});

describe("ConnectedThreadStage new-chat home", () => {
  test("renders the new-thread hero, composer, and scoped footer without deferred rows", async () => {
    installAsyncRequestAnimationFrame();

    const view = await renderNewThreadHome();
    const home = view.container.querySelector<HTMLElement>("[data-new-thread-home-main='true']");
    const hero = view.container.querySelector<HTMLElement>("[data-new-thread-home-hero='true']");
    const composer = view.container.querySelector<HTMLElement>("[data-new-thread-home-composer='true']");
    const lowerStatusRow = view.container.querySelector<HTMLElement>("[data-composer-lower-status-row='true']");
    const externalFooterSlot = view.container.querySelector<HTMLElement>("[data-composer-external-footer-slot='true']");
    const promptEditor = view.container.querySelector<HTMLElement>("[data-codex-composer='true']");
    const projectTriggers = view.getAllByLabelText("Select project") as HTMLButtonElement[];
    const renderedText = textContent(view.container);

    expect(home !== null).toBeTrue();
    expect(hero !== null).toBeTrue();
    expect(renderedText.includes("What should we build in Nodex?")).toBeTrue();
    expect(composer !== null).toBeTrue();
    expect(promptEditor !== null).toBeTrue();
    expect(projectTriggers.length).toBe(2);
    expect(projectTriggers.some((trigger) => trigger.disabled)).toBeFalse();
    await waitFor(() => {
      if (!view.container.querySelector("[data-placeholder='Do anything']")) {
        throw new Error("Expected Codex composer placeholder.");
      }
    });
    expect(view.getByLabelText("Select Git branch") !== null).toBeTrue();
    expect(lowerStatusRow !== null).toBeTrue();
    expect(externalFooterSlot?.contains(lowerStatusRow)).toBeTrue();
    expect(renderedText.includes("Work locally")).toBeTrue();
    expect(renderedText.includes("Start a new thread")).toBeFalse();
    expect(renderedText.includes("Connect Codex web")).toBeFalse();
    expect(renderedText.includes("Send to cloud")).toBeFalse();
  });

  test("uses ready thread start progress to render the materialized first turn", async () => {
    installAsyncRequestAnimationFrame();
    invokeCalls = [];
    hostMessageListener = null;
    const threadId = "thread_ready";
    const view = await renderNewThreadHome({
      threadStartProgress: {
        runInTarget: "localProject",
        threadId,
        phase: "ready",
        message: "Message sent.",
        outputText: "",
        updatedAt: 10,
      },
    });
    const { dispatchCodexAppServerMessage } = await import("../app-server-message-bus");

    await act(async () => {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: threadId,
        version: 1,
        sourceClientId: null,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: buildConversation(threadId),
        },
      });
      await settleAsyncRender();
    });

    const renderedText = textContent(view.container);
    const home = view.container.querySelector<HTMLElement>("[data-new-thread-home-main='true']");

    expect(home === null).toBeTrue();
    expect(renderedText.includes("What should we build in Nodex?")).toBeFalse();
    expect(renderedText.includes("Remove the redundant transitions.")).toBeTrue();
    expect(renderedText.includes("Thinking")).toBeTrue();
    expect(renderedText.includes("Sending message")).toBeFalse();
    expect(renderedText.includes("Message sent.")).toBeFalse();
    expect(invokeCalls.some((call) =>
      call.channel === "codex:thread:view-active:set" &&
      call.threadId === threadId &&
      call.active === true
    )).toBeTrue();
  });
});
