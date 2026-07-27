import {
  GIT_ACTION_COMMIT_OR_PUSH_PROMPT,
  GIT_ACTION_CREATE_PR_PROMPT,
} from "@/lib/git-action-prompts";
import type {
  CodexCollaborationModeKind,
  CodexReasoningEffort,
  CodexThreadGoalMaterializedDraft,
  ProjectSession,
} from "@/lib/types";
import type { useCodexAppServerControl } from "./local-conversation-store";
import { invoke } from "@/lib/api";
import { cleanupMaterializedThreadGoalDraft } from "./thread-goal-materialization";
import type { ThreadStageActions } from "./thread-stage-types";

type CodexControl = ReturnType<typeof useCodexAppServerControl>;

export interface ThreadActionControllerInput {
  activeThreadId: string | null;
  codexControl: CodexControl;
  currentSessionProjectId: string | null;
  projectId: string | null;
  selectedCollaborationMode: CodexCollaborationModeKind;
  setSelectedCollaborationMode: (mode: CodexCollaborationModeKind) => void;
  onOpenThread: ThreadStageActions["onOpenThread"];
  onOpenSubagentsPanel?: ThreadStageActions["onOpenSubagentsPanel"];
  onOpenTurnDiffReview: ThreadStageActions["onOpenTurnDiffReview"];
  onOpenTurnDiffFileInSidePanel?: ThreadStageActions["onOpenTurnDiffFileInSidePanel"];
  onEnsureBlankSessionForProject: (projectId: string | null) => Promise<ProjectSession>;
  cleanupThreadGoalMaterializedDraft?: (
    materialized: CodexThreadGoalMaterializedDraft | null,
  ) => Promise<void>;
  onRefreshProjectSessions: (projectId: string | null) => Promise<ProjectSession[]>;
  onOpenPendingWorktree?: (clientThreadId: string) => void;
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
  onOpenHooksSettings?: ThreadStageActions["onOpenHooksSettings"];
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
  onOpenPlanInSidePanel?: ThreadStageActions["onOpenPlanInSidePanel"];
  onClosePlanSidePanel?: ThreadStageActions["onClosePlanSidePanel"];
  onOpenSummarySideChatRow?: ThreadStageActions["onOpenSummarySideChatRow"];
  onOpenSummaryBrowserRow?: ThreadStageActions["onOpenSummaryBrowserRow"];
  onOpenSummaryScheduledAutomation?: ThreadStageActions["onOpenSummaryScheduledAutomation"];
  onOpenSummaryOutputInSidePanel?: ThreadStageActions["onOpenSummaryOutputInSidePanel"];
  onOpenSummaryGitReview?: ThreadStageActions["onOpenSummaryGitReview"];
  onOpenProcessManager?: ThreadStageActions["onOpenProcessManager"];
  onOpenBackgroundTerminalOutput?: ThreadStageActions["onOpenBackgroundTerminalOutput"];
  onToggleSummaryComputerUsePip?: ThreadStageActions["onToggleSummaryComputerUsePip"];
  onRequestRenameThread?: ThreadStageActions["onRequestRenameThread"];
  onArchiveThread?: ThreadStageActions["onArchiveThread"];
  onToggleThreadPin?: ThreadStageActions["onToggleThreadPin"];
}

function requireActiveThreadId(activeThreadId: string | null, action: string): string {
  if (activeThreadId) {
    return activeThreadId;
  }

  throw new Error(`${action} requires an active thread`);
}

function uniqueThreadIds(threadIds: readonly string[]): string[] {
  return Array.from(new Set(threadIds.map((threadId) => threadId.trim()).filter(Boolean)));
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
    onCollaborationModeChange: (collaborationMode) => {
      updateThreadSettingsOrDraft({ collaborationMode });
    },
    onModelChange: (model) => {
      updateThreadSettingsOrDraft({ model });
    },
    onReasoningEffortChange: (reasoningEffort) => {
      updateThreadSettingsOrDraft({ reasoningEffort });
    },
    onExecutionProfileChange: async (profile, change) => {
      if (input.activeThreadId) {
        await input.codexControl.setConversationThreadSettings(input.activeThreadId, {
          executionProfile: profile,
          ...(change ? { executionProfileChange: change } : {}),
        });
        return;
      }
      input.codexControl.setExecutionProfile(profile);
      input.codexControl.setDefaultServiceTier(profile.serviceTier);
    },
    onProviderCredentialSet: async (providerId, apiKey) => (
      input.codexControl.setProviderCredential({ providerId, apiKey })
    ),
    onProviderCredentialDelete: async (providerId) => (
      input.codexControl.deleteProviderCredential({ providerId })
    ),
    onPersonalityChange: async (personality) => {
      await Promise.all([
        input.codexControl.setPersonality(personality),
        ...(input.activeThreadId
          ? [input.codexControl.setConversationThreadSettings(input.activeThreadId, {
              personality,
            })]
          : []),
      ]);
    },
    onPermissionModeChange: async (mode) => {
      await input.codexControl.setPermissionMode(input.projectId, mode);
    },
    onQueueingEnabledChange: input.onQueueingEnabledChange,
    onStartThreadForSession: async ({
      projectId,
      sessionId,
      prompt,
      promptInput,
      threadGoalDraft,
      threadGoalMaterializedDraft,
      runInTarget,
      runInEnvironmentPath,
      worktreeStartMode,
      worktreeBranchPrefix,
    }) => {
      let targetSession: ProjectSession | null = null;
      if (projectId !== input.currentSessionProjectId) {
        try {
          targetSession = await input.onEnsureBlankSessionForProject(projectId);
        } catch (error) {
          await (input.cleanupThreadGoalMaterializedDraft
            ?? cleanupMaterializedThreadGoalDraft)(threadGoalMaterializedDraft ?? null);
          throw error;
        }
      }
      const projectlessWorkspace = projectId === null
        ? await invoke("codex:projectless-thread-cwd", {
            prompt,
            createSplitDirectories: true,
          })
        : undefined;
      const result = await input.codexControl.startThreadForSession({
        projectId,
        sessionId: targetSession?.id ?? sessionId,
        prompt,
        ...(projectlessWorkspace === undefined ? {} : { projectlessWorkspace }),
        promptInput,
        threadGoalDraft,
        threadGoalMaterializedDraft,
        runInTarget,
        runInEnvironmentPath,
        worktreeStartMode,
        worktreeBranchPrefix: worktreeBranchPrefix ?? undefined,
        collaborationMode: input.selectedCollaborationMode,
      });
      if (result.kind === "pending") {
        if (!input.onOpenPendingWorktree) {
          throw new Error("Pending worktree navigation is unavailable");
        }
        input.onOpenPendingWorktree(result.clientThreadId);
        return;
      }
      await input.onRefreshProjectSessions(projectId);
    },
    onNewThreadProjectChange: input.onNewThreadProjectChange,
    onRequestNewChatProjectCreate: input.onRequestNewChatProjectCreate,
    onNewThreadStartInTargetChange: input.onNewThreadStartInTargetChange,
    onNewThreadStartInEnvironmentChange: input.onNewThreadStartInEnvironmentChange,
    onRefreshNewThreadStartInEnvironments: input.onRefreshNewThreadStartInEnvironments,
    onOpenNewThreadLocalEnvironmentsSettings: input.onOpenNewThreadLocalEnvironmentsSettings,
    ...(input.onOpenSideChat ? { onOpenSideChat: input.onOpenSideChat } : {}),
    ...(input.onOpenSubagentsPanel ? { onOpenSubagentsPanel: input.onOpenSubagentsPanel } : {}),
    ...(input.onOpenMcpAppSidePanel ? { onOpenMcpAppSidePanel: input.onOpenMcpAppSidePanel } : {}),
    ...(input.onOpenPlanInSidePanel ? { onOpenPlanInSidePanel: input.onOpenPlanInSidePanel } : {}),
    ...(input.onClosePlanSidePanel ? { onClosePlanSidePanel: input.onClosePlanSidePanel } : {}),
    ...(input.onOpenSummarySideChatRow ? { onOpenSummarySideChatRow: input.onOpenSummarySideChatRow } : {}),
    ...(input.onOpenSummaryBrowserRow ? { onOpenSummaryBrowserRow: input.onOpenSummaryBrowserRow } : {}),
    ...(input.onOpenSummaryScheduledAutomation ? { onOpenSummaryScheduledAutomation: input.onOpenSummaryScheduledAutomation } : {}),
    ...(input.onOpenSummaryOutputInSidePanel ? { onOpenSummaryOutputInSidePanel: input.onOpenSummaryOutputInSidePanel } : {}),
    ...(input.onOpenSummaryGitReview ? { onOpenSummaryGitReview: input.onOpenSummaryGitReview } : {}),
    onStartSummaryGitAction: async ({ action }) => {
      const threadId = requireActiveThreadId(input.activeThreadId, "Starting a Git action");
      await input.codexControl.startTurn(
        threadId,
        action === "commit-or-push" ? GIT_ACTION_COMMIT_OR_PUSH_PROMPT : GIT_ACTION_CREATE_PR_PROMPT,
        {
          ...(input.projectId === null ? {} : { projectId: input.projectId }),
          collaborationMode: input.selectedCollaborationMode,
        },
      );
    },
    ...(input.onOpenProcessManager ? { onOpenProcessManager: input.onOpenProcessManager } : {}),
    ...(input.onOpenBackgroundTerminalOutput ? { onOpenBackgroundTerminalOutput: input.onOpenBackgroundTerminalOutput } : {}),
    ...(input.onToggleSummaryComputerUsePip ? { onToggleSummaryComputerUsePip: input.onToggleSummaryComputerUsePip } : {}),
    ...(input.onRequestRenameThread ? { onRequestRenameThread: input.onRequestRenameThread } : {}),
    ...(input.onArchiveThread ? { onArchiveThread: input.onArchiveThread } : {}),
    ...(input.onToggleThreadPin ? { onToggleThreadPin: input.onToggleThreadPin } : {}),
    onSendPrompt: async (prompt, opts) => {
      const threadId = requireActiveThreadId(input.activeThreadId, "Sending a prompt");
      await input.codexControl.startTurn(threadId, prompt, {
        ...(input.projectId === null ? {} : { projectId: input.projectId }),
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
    onRespondApproval: async (requestId, response, context) => {
      await input.codexControl.respondApproval(
        requestId,
        response,
        context?.conversationId ?? null,
      );
    },
    onRespondUserInput: async (requestId, answers, context) => {
      await input.codexControl.respondUserInput(requestId, answers, context?.conversationId ?? null);
    },
    onRespondMcpElicitation: async (requestId, response, context) => {
      await input.codexControl.respondMcpElicitation(requestId, response, context?.conversationId ?? null);
    },
    onRespondPermissionRequest: async (requestId, response, context) => {
      await input.codexControl.respondPermissionRequest(requestId, response, context?.conversationId ?? null);
    },
    onRespondNodexAgentAuthorization: async (requestId, response, context) => {
      await input.codexControl.respondNodexAgentAuthorization(
        requestId,
        response,
        context?.conversationId ?? null,
      );
    },
    onRespondOptionPicker: async (requestId, response, context) => {
      const conversationId = context?.conversationId ?? input.activeThreadId;
      if (!conversationId) {
        throw new Error("Responding to an option picker requires an active thread");
      }
      await input.codexControl.respondOptionPicker(conversationId, requestId, response);
    },
    onRespondSetupCodexStep: async (requestId, response, context) => {
      const conversationId = context?.conversationId ?? input.activeThreadId;
      if (!conversationId) {
        throw new Error("Responding to a setup step requires an active thread");
      }
      await input.codexControl.respondSetupCodexStep(conversationId, requestId, response);
    },
    onResolvePlanImplementationRequest: async (threadId, turnId) => {
      await input.codexControl.removePlanImplementationRequest(threadId, turnId);
    },
    onEnqueueQueuedFollowUp: async (threadId, prompt, opts) => {
      await input.codexControl.enqueueQueuedFollowUp(threadId, prompt, {
        ...(input.projectId === null ? {} : { projectId: input.projectId }),
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
      if (result.composerIntent) {
        input.codexControl.setComposerIntent(result.threadId, result.composerIntent);
      }
      await input.codexControl.setConversationCollaborationMode(result.threadId, input.selectedCollaborationMode);
      input.onOpenThread(result.threadId);
    },
    onCompactThread: async (threadId) => {
      await input.codexControl.compactThread(threadId);
    },
    onGetThreadGoal: input.codexControl.getThreadGoal,
    onSetThreadGoal: input.codexControl.setThreadGoal,
    onClearThreadGoal: input.codexControl.clearThreadGoal,
    onDismissThreadGoalResumeConfirmation: input.codexControl.dismissThreadGoalResumeConfirmation,
    onSetThreadMemoryMode: input.codexControl.setThreadMemoryMode,
    onUploadFeedback: input.codexControl.uploadFeedback,
    onUnarchiveThread: async (threadId, projectId) => {
      await input.codexControl.unarchiveThread(threadId, projectId);
      await input.onRefreshProjectSessions(projectId);
    },
    onOpenTurnDiffReview: input.onOpenTurnDiffReview,
    ...(input.onOpenHooksSettings ? { onOpenHooksSettings: input.onOpenHooksSettings } : {}),
    ...(input.onOpenTurnDiffFileInSidePanel ? { onOpenTurnDiffFileInSidePanel: input.onOpenTurnDiffFileInSidePanel } : {}),
    onConsumeComposerIntent: input.codexControl.consumeComposerIntent,
    onOpenThread: async (threadId, context) => {
      await input.onOpenThread(threadId, context);
    },
    onStopBackgroundAgents: async (threadIds) => {
      await Promise.all(uniqueThreadIds(threadIds).map((threadId) => input.codexControl.interruptTurn(threadId)));
    },
    onCleanBackgroundTerminals: async (threadId) => {
      await input.codexControl.cleanBackgroundTerminals(threadId);
    },
  } satisfies ThreadStageActions;

  return actions;
}
