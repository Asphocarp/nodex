import type { ThreadStageModel, ThreadStageModelInput } from "../thread-stage-types";
import { buildAboveComposerQueueSurfaceModel } from "./build-above-composer-queue-surface-model";
import { buildPendingRequestSurfaceModel } from "./build-pending-request-surface-model";
import { buildThreadBodyModel } from "./build-thread-body-model";

export function buildThreadStageModel(input: ThreadStageModelInput): ThreadStageModel {
  const resumeState = input.conversation?.resumeState ?? null;
  const activeTurn = input.conversation
    ? [...input.conversation.turns].reverse().find((turn) => turn.status === "inProgress") ?? null
    : null;
  const isThreadRunning = Boolean(
    input.conversation && (input.conversation.statusType === "active" || activeTurn !== null),
  );
  const isCloudNewThreadTarget = Boolean(input.isNewThreadTab && input.newThreadTarget?.runInTarget === "cloud");
  const pendingRequestSurface = buildPendingRequestSurfaceModel({
    conversation: input.conversation,
    knownConversationsById: input.knownConversationsById,
    dismissedPlanImplementationTurnIdByThread: input.dismissedPlanImplementationTurnIdByThread,
  });
  const aboveComposerQueueSurface = buildAboveComposerQueueSurfaceModel({
    conversation: input.conversation,
  });
  const body = buildThreadBodyModel({
    activeThreadId: input.activeThreadId,
    conversation: input.conversation,
    dismissedPlanImplementationTurnIdByThread: input.dismissedPlanImplementationTurnIdByThread,
    isNewThreadTab: input.isNewThreadTab,
    newThreadTarget: input.newThreadTarget,
    isCloudNewThreadTarget,
    threadStartProgress: input.threadStartProgress,
    pendingRequestSurface,
  });

  return {
    projectId: input.projectId,
    projectWorkspacePath: input.projectWorkspacePath ?? null,
    conversation: input.conversation,
    resumeState,
    activeTurn,
    isThreadRunning,
    isNewThreadTab: input.isNewThreadTab,
    isCloudNewThreadTarget,
    newThreadTarget: input.newThreadTarget,
    threadStartProgress: input.threadStartProgress,
    connection: input.connection,
    account: input.account,
    availableModels: input.availableModels,
    collaborationModes: input.collaborationModes,
    selectedCollaborationMode: input.selectedCollaborationMode,
    selectedModel: input.selectedModel,
    selectedReasoningEffort: input.selectedReasoningEffort,
    reasoningEffortOptions: input.reasoningEffortOptions,
    permissionMode: input.permissionMode,
    isQueueingEnabled: input.isQueueingEnabled,
    promptSubmitShortcut: input.promptSubmitShortcut,
    searchOpenTick: input.searchOpenTick,
    composerIntent: input.composerIntent,
    title:
      input.conversation?.threadName ||
      input.conversation?.threadPreview ||
      input.activeThreadSummary?.threadName ||
      input.activeThreadSummary?.threadPreview ||
      (input.isNewThreadTab ? "New thread" : "No thread"),
    openCardTarget: input.conversation
      ? {
          cardId: input.conversation.cardId,
          title:
            input.conversation.threadName?.trim()
            || input.conversation.threadPreview
            || input.conversation.cardId,
          columnId: input.activeThreadCardColumnId,
        }
      : input.activeThreadSummary
        ? {
            cardId: input.activeThreadSummary.cardId,
            title:
              input.activeThreadSummary.threadName?.trim()
              || input.activeThreadSummary.threadPreview
              || input.activeThreadSummary.cardId,
            columnId: input.activeThreadCardColumnId,
          }
      : input.isNewThreadTab && input.newThreadTarget
        ? {
            cardId: input.newThreadTarget.cardId,
            title: input.newThreadTarget.cardTitle,
            columnId: input.newThreadTarget.columnId,
          }
        : null,
    activeThreadCardColumnId: input.activeThreadCardColumnId,
    body,
    pendingRequestSurface,
    aboveComposerQueueSurface,
  };
}
