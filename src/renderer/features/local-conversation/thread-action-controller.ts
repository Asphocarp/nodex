import type { useCodexAccountActions } from "@/lib/use-codex-account-actions";
import type {
  CodexCollaborationModeKind,
  CodexReasoningEffort,
  ProjectSession,
} from "@/lib/types";
import type { useCodexAppServerControl } from "./local-conversation-store";
import type { ThreadStageActions } from "./thread-stage-types";

type AccountActions = ReturnType<typeof useCodexAccountActions>;
type CodexControl = ReturnType<typeof useCodexAppServerControl>;

export interface ThreadActionControllerInput {
  activeThreadId: string | null;
  accountActions: AccountActions;
  codexControl: CodexControl;
  currentSessionProjectId: string;
  projectId: string;
  selectedCollaborationMode: CodexCollaborationModeKind;
  setSelectedCollaborationMode: (mode: CodexCollaborationModeKind) => void;
  onOpenThread: (threadId: string) => void;
  onOpenTurnDiffReview: ThreadStageActions["onOpenTurnDiffReview"];
  onOpenTurnDiffFileInSidePanel?: ThreadStageActions["onOpenTurnDiffFileInSidePanel"];
  onEnsureBlankSessionForProject: (projectId: string) => Promise<ProjectSession>;
  onRefreshProjectSessions: (projectId: string) => Promise<ProjectSession[]>;
  onForkSessionFromTurn?: (input: {
    threadId: string;
    turnId: string;
    message: string;
    collaborationMode: CodexCollaborationModeKind;
  }) => Promise<void>;
  onQueueingEnabledChange: ThreadStageActions["onQueueingEnabledChange"];
  onNewThreadProjectChange: NonNullable<ThreadStageActions["onNewThreadProjectChange"]>;
  onRequestNewChatProjectCreate: NonNullable<ThreadStageActions["onRequestNewChatProjectCreate"]>;
  onNewThreadStartInTargetChange: NonNullable<ThreadStageActions["onNewThreadStartInTargetChange"]>;
  onNewThreadStartInEnvironmentChange: NonNullable<ThreadStageActions["onNewThreadStartInEnvironmentChange"]>;
  onRefreshNewThreadStartInEnvironments: NonNullable<ThreadStageActions["onRefreshNewThreadStartInEnvironments"]>;
  onOpenNewThreadLocalEnvironmentsSettings: NonNullable<ThreadStageActions["onOpenNewThreadLocalEnvironmentsSettings"]>;
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
  onOpenPlanInSidePanel?: ThreadStageActions["onOpenPlanInSidePanel"];
  onClosePlanSidePanel?: ThreadStageActions["onClosePlanSidePanel"];
  onRequestRenameThread?: ThreadStageActions["onRequestRenameThread"];
}

function requireActiveThreadId(activeThreadId: string | null, action: string): string {
  if (activeThreadId) {
    return activeThreadId;
  }

  throw new Error(`${action} requires an active thread`);
}

export function createThreadStageActions(input: ThreadActionControllerInput): ThreadStageActions {
  const updateThreadSettingsOrDraft = (patch: {
    collaborationMode?: CodexCollaborationModeKind;
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
  }) => {
    if (input.activeThreadId) {
      void input.codexControl.setConversationThreadSettings(input.activeThreadId, patch);
      return;
    }

    if (patch.collaborationMode) {
      input.setSelectedCollaborationMode(patch.collaborationMode);
    }
    if (patch.model) {
      input.codexControl.setThreadModel(patch.model);
    }
    if (patch.reasoningEffort) {
      input.codexControl.setThreadReasoningEffort(patch.reasoningEffort);
    }
  };

  const actions = {
    onRefreshAccount: input.accountActions.refreshAccount,
    onStartChatGptLogin: input.accountActions.startChatGptLogin,
    onStartApiKeyLogin: input.accountActions.startApiKeyLogin,
    onCancelLogin: async (loginId) => {
      await input.accountActions.cancelLogin(loginId);
    },
    onLogout: async () => {
      await input.accountActions.logout();
    },
    onCollaborationModeChange: (collaborationMode) => {
      updateThreadSettingsOrDraft({ collaborationMode });
    },
    onModelChange: (model) => {
      updateThreadSettingsOrDraft({ model });
    },
    onReasoningEffortChange: (reasoningEffort) => {
      updateThreadSettingsOrDraft({ reasoningEffort });
    },
    onPermissionModeChange: (mode) => {
      void input.codexControl.setPermissionMode(input.projectId, mode);
    },
    onQueueingEnabledChange: input.onQueueingEnabledChange,
    onStartThreadForSession: async ({
      projectId,
      sessionId,
      prompt,
      promptInput,
      runInTarget,
      runInEnvironmentPath,
      worktreeStartMode,
      worktreeBranchPrefix,
    }) => {
      const targetSession = projectId === input.currentSessionProjectId
        ? null
        : await input.onEnsureBlankSessionForProject(projectId);
      await input.codexControl.startThreadForSession({
        projectId,
        sessionId: targetSession?.id ?? sessionId,
        prompt,
        promptInput,
        runInTarget,
        runInEnvironmentPath,
        worktreeStartMode,
        worktreeBranchPrefix: worktreeBranchPrefix ?? undefined,
        collaborationMode: input.selectedCollaborationMode,
      });
      await input.onRefreshProjectSessions(projectId);
    },
    onNewThreadProjectChange: input.onNewThreadProjectChange,
    onRequestNewChatProjectCreate: input.onRequestNewChatProjectCreate,
    onNewThreadStartInTargetChange: input.onNewThreadStartInTargetChange,
    onNewThreadStartInEnvironmentChange: input.onNewThreadStartInEnvironmentChange,
    onRefreshNewThreadStartInEnvironments: input.onRefreshNewThreadStartInEnvironments,
    onOpenNewThreadLocalEnvironmentsSettings: input.onOpenNewThreadLocalEnvironmentsSettings,
    ...(input.onOpenSideChat ? { onOpenSideChat: input.onOpenSideChat } : {}),
    ...(input.onOpenMcpAppSidePanel ? { onOpenMcpAppSidePanel: input.onOpenMcpAppSidePanel } : {}),
    ...(input.onOpenPlanInSidePanel ? { onOpenPlanInSidePanel: input.onOpenPlanInSidePanel } : {}),
    ...(input.onClosePlanSidePanel ? { onClosePlanSidePanel: input.onClosePlanSidePanel } : {}),
    ...(input.onRequestRenameThread ? { onRequestRenameThread: input.onRequestRenameThread } : {}),
    onSendPrompt: async (prompt, opts) => {
      const threadId = requireActiveThreadId(input.activeThreadId, "Sending a prompt");
      await input.codexControl.startTurn(threadId, prompt, {
        projectId: input.projectId,
        collaborationMode: opts?.collaborationMode,
        promptInput: opts?.promptInput,
      });
    },
    onSteerPrompt: async (steerInput) => {
      const threadId = requireActiveThreadId(input.activeThreadId, "Steering a prompt");
      await input.codexControl.steerTurn({
        ...steerInput,
        threadId,
      });
    },
    onInterruptTurn: async (turnId) => {
      const threadId = requireActiveThreadId(input.activeThreadId, "Stopping Codex");
      await input.codexControl.interruptTurn(threadId, turnId);
    },
    onRespondApproval: async (requestId, decision) => {
      await input.codexControl.respondApproval(requestId, decision);
    },
    onRespondUserInput: async (requestId, answers) => {
      await input.codexControl.respondUserInput(requestId, answers);
    },
    onRespondMcpElicitation: async (requestId, action) => {
      await input.codexControl.respondMcpElicitation(requestId, action);
    },
    onResolvePlanImplementationRequest: async (threadId, turnId) => {
      await input.codexControl.removePlanImplementationRequest(threadId, turnId);
    },
    onEnqueueQueuedFollowUp: async (threadId, prompt, opts) => {
      await input.codexControl.enqueueQueuedFollowUp(threadId, prompt, {
        projectId: input.projectId,
        collaborationMode: opts?.collaborationMode,
        promptInput: opts?.promptInput,
      });
    },
    onRemoveQueuedFollowUp: async (threadId, followUpId) => {
      await input.codexControl.removeQueuedFollowUp(threadId, followUpId);
    },
    onReorderQueuedFollowUps: async (threadId, orderedFollowUpIds) => {
      await input.codexControl.reorderQueuedFollowUps(threadId, orderedFollowUpIds);
    },
    onSendQueuedFollowUpNow: async (threadId, followUpId) => {
      await input.codexControl.sendQueuedFollowUpNow(threadId, followUpId);
    },
    onEditQueuedFollowUp: async ({ threadId, followUpId, prompt, promptInput }) => {
      await input.codexControl.removeQueuedFollowUp(threadId, followUpId);
      input.codexControl.setComposerIntent(threadId, {
        prompt,
        ...(promptInput ? { promptInput } : {}),
        focusNonce: Date.now(),
      });
    },
    onEditLastUserTurn: async ({ threadId, turnId, message }) => {
      await input.codexControl.editLastUserTurn(threadId, turnId, message);
      await input.codexControl.requestThreadStreamSnapshot(threadId);
    },
    onForkFromTurn: async ({ threadId, turnId, message }) => {
      if (input.onForkSessionFromTurn) {
        await input.onForkSessionFromTurn({
          threadId,
          turnId,
          message,
          collaborationMode: input.selectedCollaborationMode,
        });
        return;
      }

      const result = await input.codexControl.forkConversationFromTurn(threadId, turnId, message);
      await input.codexControl.requestThreadStreamSnapshot(result.threadId);
      input.codexControl.setComposerIntent(result.threadId, result.composerIntent);
      await input.codexControl.setConversationCollaborationMode(result.threadId, input.selectedCollaborationMode);
      input.onOpenThread(result.threadId);
    },
    onCompactThread: async (threadId) => {
      await input.codexControl.compactThread(threadId);
    },
    onGetThreadGoal: input.codexControl.getThreadGoal,
    onSetThreadGoal: input.codexControl.setThreadGoal,
    onClearThreadGoal: input.codexControl.clearThreadGoal,
    onSetThreadMemoryMode: input.codexControl.setThreadMemoryMode,
    onUploadFeedback: input.codexControl.uploadFeedback,
    onUnarchiveThread: async (threadId, projectId) => {
      await input.codexControl.unarchiveThread(threadId, projectId);
      await input.onRefreshProjectSessions(projectId);
    },
    onOpenTurnDiffReview: input.onOpenTurnDiffReview,
    ...(input.onOpenTurnDiffFileInSidePanel ? { onOpenTurnDiffFileInSidePanel: input.onOpenTurnDiffFileInSidePanel } : {}),
    onConsumeComposerIntent: input.codexControl.consumeComposerIntent,
    onOpenThread: input.onOpenThread,
    onCleanBackgroundTerminals: async (threadId) => {
      await input.codexControl.cleanBackgroundTerminals(threadId);
    },
  } satisfies ThreadStageActions;

  return actions;
}
