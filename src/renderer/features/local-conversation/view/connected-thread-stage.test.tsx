import { describe, expect, mock, test } from "bun:test";
import { act } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "../../../components/ui/tooltip";
import { installAsyncRequestAnimationFrame } from "../../../test/browser-globals";
import { render, settleAsyncRender } from "../../../test/dom";
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
