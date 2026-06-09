import { describe, expect, mock, test } from "bun:test";
import { act, waitFor } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "../../../components/ui/tooltip";
import { installAsyncRequestAnimationFrame, installWindowApi } from "../../../test/browser-globals";
import { render, settleAsyncRender, textContent } from "../../../test/dom";
import type {
  CodexConnectionState,
  CodexHostMessage,
  CodexThreadSummary,
} from "../../../lib/types";
import type { ThreadStageActions } from "../thread-stage-types";

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

function buildThreadSummary(archived: boolean): CodexThreadSummary {
  return {
    threadId: archived ? "thread_archived" : "thread_active",
    projectId: "project_1",
    cardId: null,
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
    onStartThreadForCard: noopAsync,
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
    onOpenCard: () => {},
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
    <TooltipProvider>
      <LocalConversationProvider>
        <ConnectedThreadStage
          projectId="project_1"
          projectWorkspacePath="/tmp/project"
          isNewThreadTab={false}
          newThreadTarget={null}
          newThreadProjectSelector={null}
          newThreadStartInSelector={null}
          showHeaderSeparator={false}
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
    </TooltipProvider>,
  );
  await settleAsyncRender();
}

async function renderNewThreadHome() {
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
                workspacePath: "/tmp/nodex",
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
          showHeaderSeparator={false}
          threadStartProgress={null}
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
    </TooltipProvider>,
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
  test("renders the Codex-style hero, composer, and scoped footer without deferred rows", async () => {
    installAsyncRequestAnimationFrame();

    const view = await renderNewThreadHome();
    const home = view.container.querySelector<HTMLElement>("[data-new-thread-home-main='true']");
    const hero = view.container.querySelector<HTMLElement>("[data-new-thread-home-hero='true']");
    const composer = view.container.querySelector<HTMLElement>("[data-new-thread-home-composer='true']");
    const lowerStatusRow = view.container.querySelector<HTMLElement>("[data-composer-lower-status-row='true']");
    const promptEditor = view.container.querySelector<HTMLElement>("[data-codex-composer='true']");
    const projectTriggers = view.getAllByLabelText("Select project") as HTMLButtonElement[];
    const renderedText = textContent(view.container);

    expect(home !== null).toBeTrue();
    expect(Boolean(hero?.className.includes("h-[39%]"))).toBeTrue();
    expect(Boolean(hero?.className.includes("w-[min(100%,var(--thread-content-max-width))]"))).toBeTrue();
    expect(renderedText.includes("What should we build in Nodex?")).toBeTrue();
    expect(Boolean(composer?.className.includes("sticky top-0 z-10"))).toBeTrue();
    expect(Boolean(composer?.className.includes("pt-5"))).toBeTrue();
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
    expect(renderedText.includes("Work locally")).toBeTrue();
    expect(renderedText.includes("Start a new thread")).toBeFalse();
    expect(renderedText.includes("Connect Codex web")).toBeFalse();
    expect(renderedText.includes("Send to cloud")).toBeFalse();
  });
});
