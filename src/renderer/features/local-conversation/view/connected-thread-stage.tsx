import { useCallback, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useThreadHeaderPortalTarget } from "@/lib/thread-header-portal";
import { resolveCodexElectronDisplayThreadTitle } from "../../../../shared/codex-thread-title";
import { buildCodexTurnOccurrenceKey } from "../../../../shared/codex-turn-identity";
import type {
  CodexCollaborationModeKind,
  CodexCollaborationModeState,
  CodexConversationChildMembership,
  CodexConversationThreadSettings,
} from "@/lib/types";
import { buildComposerShellModel } from "../projection/build-composer-shell-model";
import { buildBackgroundSubagentRows } from "../projection/background-subagent-row-model";
import {
  buildThreadBodyModel,
  resolveThreadStartProgressPresentation,
} from "../projection/build-thread-body-model";
import type {
  ThreadBodySurfaceModel,
  ThreadBodyUiStateOverrides,
  ThreadFooterModel,
  ThreadStageActions,
  ThreadStageHeaderModel,
  ThreadStageRouteInput,
} from "../thread-stage-types";
import {
  requestLocalConversationResume,
  markLocalConversationAsRead,
  markLocalSubagentThreadOpened,
  setLocalConversationThreadViewActive,
  useComposerIntent,
  useConversationBackgroundTerminalRows,
  useConversationCapabilityFlags,
  useConversationChildMemberships,
  useConversation,
  useConversationCollaborationMode,
  useConversationThreadSettings,
  useConversationCwd,
  useConversationPendingSteers,
  useConversationPrimaryRequest,
  useConversationQueuedFollowUps,
  useConversationRequests,
  useConversationResumeState,
  useConversationStatusActiveFlags,
  useConversationStatusType,
  useConversationSubset,
  useConversationSummaryFields,
  useConversationTurns,
  useCodexDictationState,
  useCodexAppServerManagerForConversationId,
  useCodexPermissionState,
  useConversationParentThreadId,
  useLocalConversationAccount,
  useLocalConversationConnection,
} from "../local-conversation-store";
import { LocalConversationFooter } from "./local-conversation-footer";
import { LocalConversationNewThreadHomeScreen } from "./local-conversation-new-thread-home-screen";
import { LocalConversationStageScreen } from "./local-conversation-stage-screen";
import { ThreadStageHeader } from "./local-conversation-stage-header";
import { LocalConversationThreadBody } from "./local-conversation-thread-body";
import { NewChatProjectSelector } from "./composer/new-chat-project-selector";
import {
  ThreadFloatingSummaryPanel,
  ThreadSummaryPanelRenderBoundary,
  ThreadSummaryPanelRenderErrorFallback,
} from "./summary-panel";

type ConnectedThreadStageInput = Omit<
  ThreadStageRouteInput,
  | "conversation"
  | "parentTurns"
  | "knownConversationsById"
  | "connection"
  | "account"
  | "composerIntent"
  | "primaryRequest"
>;

function isKnownCollaborationMode(mode: string | null | undefined): mode is CodexCollaborationModeKind {
  return mode === "default" || mode === "plan";
}

function normalizeSelectedModel(model: string | null | undefined): string | null {
  const normalized = model?.trim();
  return normalized ? normalized : null;
}

export function resolveChildConversationIds(
  activeThreadId: string | null,
  memberships: readonly CodexConversationChildMembership[],
): string[] {
  return Array.from(new Set(
    memberships
      .map((membership) => membership.threadId.trim())
      .filter((threadId) => threadId.length > 0 && threadId !== activeThreadId),
  ));
}

export function resolveEffectiveThreadStageSettings({
  activeThreadId,
  liveThreadSettings,
  liveMode,
  fallbackMode,
  fallbackModel,
  fallbackReasoningEffort,
  availableModes,
}: {
  activeThreadId: string | null;
  liveThreadSettings: CodexConversationThreadSettings | null;
  liveMode: CodexCollaborationModeState | null;
  fallbackMode: CodexCollaborationModeKind;
  fallbackModel: string;
  fallbackReasoningEffort: ConnectedThreadStageInput["selectedReasoningEffort"];
  availableModes: ConnectedThreadStageInput["collaborationModes"];
}): {
  selectedCollaborationMode: CodexCollaborationModeKind;
  selectedModel: string;
  selectedReasoningEffort: ConnectedThreadStageInput["selectedReasoningEffort"];
} {
  const candidateMode = liveThreadSettings?.collaborationMode?.mode ?? liveMode?.mode;
  const fallback = {
    selectedCollaborationMode: fallbackMode,
    selectedModel: fallbackModel,
    selectedReasoningEffort: fallbackReasoningEffort,
  };
  if (!activeThreadId || !isKnownCollaborationMode(candidateMode)) {
    return fallback;
  }

  const selectedCollaborationMode = availableModes.length === 0 || availableModes.some((mode) => mode.mode === candidateMode)
    ? candidateMode
    : fallbackMode;
  return {
    selectedCollaborationMode,
    selectedModel: normalizeSelectedModel(liveThreadSettings?.model) ?? fallbackModel,
    selectedReasoningEffort: liveThreadSettings?.reasoningEffort ?? fallbackReasoningEffort,
  };
}

interface ConnectedThreadStageProps extends ConnectedThreadStageInput {
  actions: ThreadStageActions;
  onForkFromTurnIntoWorktree?: (input: {
    threadId: string;
    targetTurnId: string;
  }) => Promise<void>;
  initialUiState?: ThreadBodyUiStateOverrides;
  backgroundAgentDetail?: boolean;
  rightPanelComposerOverlayEnabled?: boolean;
  rightPanelComposerOverlayTarget?: HTMLElement | null;
  turnDiffHoverPreviewDisabled?: boolean;
  summaryPanelMounted?: boolean;
  summaryPanelOpen?: boolean;
  summaryPanelHideImmediately?: boolean;
  summaryPanelContentShift?: number;
  threadViewportActive?: boolean;
}

function resolveThreadTitle(input: ConnectedThreadStageInput, summary: ReturnType<typeof useConversationSummaryFields>): string {
  if (input.sideChatContext?.tabTitle) {
    return input.sideChatContext.tabTitle;
  }

  return resolveCodexElectronDisplayThreadTitle({
    threadName: summary.threadName || input.activeThreadSummary?.threadName,
    threadPreview: summary.threadPreview || input.activeThreadSummary?.threadPreview || input.newThreadTarget?.threadTitle,
    fallback: input.isNewThreadTab ? "New thread" : "No thread",
  });
}

function resolveConnectedStageActiveThreadId(input: ConnectedThreadStageInput): string | null {
  if (input.activeThreadId && !input.isNewThreadTab) {
    return input.activeThreadId;
  }

  if (!input.isNewThreadTab || input.threadStartProgress?.phase !== "ready") {
    return null;
  }

  const readyThreadId = input.threadStartProgress.threadId?.trim();
  return readyThreadId ? readyThreadId : null;
}

function ConnectedThreadStageHeader({
  activeThreadId,
  input,
  actions,
  onErrorMessage,
}: {
  activeThreadId: string | null;
  input: ConnectedThreadStageInput;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
}) {
  const connection = useLocalConversationConnection();
  const account = useLocalConversationAccount();
  const summaryFields = useConversationSummaryFields(activeThreadId);

  const model = useMemo<ThreadStageHeaderModel>(
    () => ({
      projectId: summaryFields.projectId ?? input.projectId,
      threadId: summaryFields.threadId ?? input.activeThreadSummary?.threadId ?? activeThreadId,
      title: resolveThreadTitle(input, summaryFields),
      connection,
      account,
      showSideChatAction: Boolean(activeThreadId && !input.sideChatContext && actions.onOpenSideChat),
    }),
    [
      account,
      activeThreadId,
      actions.onOpenSideChat,
      connection,
      input,
      summaryFields,
    ],
  );

  return <ThreadStageHeader model={model} actions={actions} onErrorMessage={onErrorMessage} />;
}

function ConnectedThreadStageBody({
  activeThreadId,
  input,
  actions,
  onForkFromTurnIntoWorktree,
  isWorktreeThread,
  onErrorMessage,
  contentShiftX,
  footer,
  initialUiState,
  turnDiffHoverPreviewDisabled = false,
}: {
  activeThreadId: string | null;
  input: ConnectedThreadStageInput;
  actions: ThreadStageActions;
  onForkFromTurnIntoWorktree?: (input: {
    threadId: string;
    targetTurnId: string;
  }) => Promise<void>;
  isWorktreeThread: boolean;
  onErrorMessage: (message: string | null) => void;
  contentShiftX?: number;
  footer?: ReactNode;
  initialUiState?: ThreadBodyUiStateOverrides;
  turnDiffHoverPreviewDisabled?: boolean;
}) {
  const turns = useConversationTurns(activeThreadId);
  const hostId = useCodexAppServerManagerForConversationId(activeThreadId).getHostId();
  const conversationSnapshot = useConversation(activeThreadId);
  const requests = useConversationRequests(activeThreadId);
  const cwd = useConversationCwd(activeThreadId);
  const resumeState = useConversationResumeState(activeThreadId);
  const statusType = useConversationStatusType(activeThreadId);
  const summaryFields = useConversationSummaryFields(activeThreadId);
  const archived = input.activeThreadSummary?.archived === true || summaryFields.archived;
  const capabilityFlags = useConversationCapabilityFlags(activeThreadId);
  const parentThreadId = useConversationParentThreadId(activeThreadId);
  const parentTurns = useConversationTurns(parentThreadId);
  const childMemberships = useConversationChildMemberships(activeThreadId);
  const childThreadIds = useMemo(
    () => resolveChildConversationIds(activeThreadId, childMemberships),
    [activeThreadId, childMemberships],
  );
  const knownConversationsById = useConversationSubset(childThreadIds);
  const backgroundAgentRows = useMemo(
    () => buildBackgroundSubagentRows({
      childMemberships,
      knownConversationsById,
      parentTurns: turns,
    }),
    [childMemberships, knownConversationsById, turns],
  );

  const body = useMemo(
    () =>
      buildThreadBodyModel({
        activeThreadId,
        conversation: conversationSnapshot,
        activeThreadArchived: archived,
        parentTurns,
        isNewThreadTab: input.isNewThreadTab,
        newThreadTarget: input.newThreadTarget,
        isCloudNewThreadTarget: Boolean(
          input.isNewThreadTab && input.newThreadTarget?.runInTarget === "cloud",
        ),
        threadStartProgress: input.threadStartProgress,
      }),
    [
      activeThreadId,
      archived,
      conversationSnapshot,
      input.isNewThreadTab,
      input.newThreadTarget,
      input.threadStartProgress,
      parentTurns,
    ],
  );

  const model = useMemo<ThreadBodySurfaceModel>(
    () => ({
      projectId: input.projectId,
      hostId,
      threadId: activeThreadId,
      isSideChat: Boolean(input.sideChatContext),
      cwd,
      turns,
      turnPagination: conversationSnapshot?.turnPagination ?? null,
      requests,
      canonicalRequests: conversationSnapshot?.canonicalRequests ?? [],
      resumeState,
      statusType,
      capabilityFlags,
      body,
      parentTurns,
      childMemberships,
      backgroundAgentRows,
      projectWorkspacePath: input.projectWorkspacePath ?? null,
      searchOpenTick: input.searchOpenTick,
      threadStartProgress: input.threadStartProgress,
    }),
    [
      activeThreadId,
      body,
      backgroundAgentRows,
      capabilityFlags,
      childMemberships,
      conversationSnapshot?.turnPagination,
      conversationSnapshot?.canonicalRequests,
      cwd,
      input.projectId,
      hostId,
      input.projectWorkspacePath,
      input.searchOpenTick,
      input.sideChatContext,
      input.threadStartProgress,
      parentTurns,
      requests,
      resumeState,
      statusType,
      turns,
    ],
  );

  return (
    <LocalConversationThreadBody
      model={model}
      actions={actions}
      isWorktreeThread={isWorktreeThread}
      onForkFromTurnIntoWorktree={onForkFromTurnIntoWorktree}
      onErrorMessage={onErrorMessage}
      contentShiftX={contentShiftX}
      footer={footer}
      initialUiState={initialUiState}
      planSidePanelState={input.planSidePanelState ?? null}
      turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
    />
  );
}

function ConnectedThreadStageFooter({
  activeThreadId,
  input,
  actions,
  errorMessage,
  onErrorMessage,
  variant = "thread",
  rightPanelComposerOverlayEnabled = false,
  rightPanelComposerOverlayTarget = null,
  turnDiffHoverPreviewDisabled = false,
}: {
  activeThreadId: string | null;
  input: ConnectedThreadStageInput;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
  variant?: "thread" | "newThreadHome";
  rightPanelComposerOverlayEnabled?: boolean;
  rightPanelComposerOverlayTarget?: HTMLElement | null;
  turnDiffHoverPreviewDisabled?: boolean;
}) {
  const turns = useConversationTurns(activeThreadId);
  const conversationSnapshot = useConversation(activeThreadId);
  const requests = useConversationRequests(activeThreadId);
  const cwd = useConversationCwd(activeThreadId);
  const resumeState = useConversationResumeState(activeThreadId);
  const statusType = useConversationStatusType(activeThreadId);
  const statusActiveFlags = useConversationStatusActiveFlags(activeThreadId);
  const summaryFields = useConversationSummaryFields(activeThreadId);
  const archived = input.activeThreadSummary?.archived === true || summaryFields.archived;
  const childMemberships = useConversationChildMemberships(activeThreadId);
  const pendingSteers = useConversationPendingSteers(activeThreadId);
  const queuedFollowUps = useConversationQueuedFollowUps(activeThreadId);
  const backgroundTerminalRows = useConversationBackgroundTerminalRows(activeThreadId);
  const activeThreadComposerIntent = useComposerIntent(activeThreadId);
  const composerIntent = activeThreadId ? activeThreadComposerIntent : input.newThreadComposerIntent ?? null;
  const primaryRequest = useConversationPrimaryRequest(activeThreadId);
  const liveCollaborationMode = useConversationCollaborationMode(activeThreadId);
  const liveThreadSettings = useConversationThreadSettings(activeThreadId);
  const account = useLocalConversationAccount();
  const dictation = useCodexDictationState();
  const permissionState = useCodexPermissionState(input.projectId);
  const childThreadIds = useMemo(
    () => resolveChildConversationIds(activeThreadId, childMemberships),
    [activeThreadId, childMemberships],
  );
  const knownConversationsById = useConversationSubset(childThreadIds);

  const composerShell = useMemo(
    () =>
      buildComposerShellModel({
        threadId: activeThreadId,
        turns,
        requests,
        canonicalRequests: conversationSnapshot?.canonicalRequests ?? [],
        pendingSteers,
        queuedFollowUps,
        backgroundTerminalRows,
        childMemberships,
        statusType,
        statusActiveFlags,
        knownConversationsById,
        primaryRequest,
      }),
    [
      activeThreadId,
      backgroundTerminalRows,
      childMemberships,
      conversationSnapshot?.canonicalRequests,
      knownConversationsById,
      pendingSteers,
      primaryRequest,
      queuedFollowUps,
      requests,
      statusActiveFlags,
      statusType,
      turns,
    ],
  );

  const activeTurn = useMemo(
    () => [...turns].reverse().find((turn) => turn.status === "inProgress") ?? null,
    [turns],
  );
  const effectiveSettings = resolveEffectiveThreadStageSettings({
    activeThreadId,
    liveThreadSettings,
    liveMode: liveCollaborationMode,
    fallbackMode: input.selectedCollaborationMode,
    fallbackModel: input.selectedModel,
    fallbackReasoningEffort: input.selectedReasoningEffort,
    availableModes: input.collaborationModes,
  });
  const {
    selectedCollaborationMode,
    selectedModel,
    selectedReasoningEffort,
  } = effectiveSettings;
  const body = useMemo(
    () =>
      buildThreadBodyModel({
        activeThreadId,
        conversation: conversationSnapshot,
        activeThreadArchived: archived,
        parentTurns: [],
        isNewThreadTab: input.isNewThreadTab,
        newThreadTarget: input.newThreadTarget,
        isCloudNewThreadTarget: Boolean(
          input.isNewThreadTab && input.newThreadTarget?.runInTarget === "cloud",
        ),
        threadStartProgress: input.threadStartProgress,
      }),
    [
      activeThreadId,
      archived,
      conversationSnapshot,
      input.isNewThreadTab,
      input.newThreadTarget,
      input.threadStartProgress,
    ],
  );
  const model = useMemo<ThreadFooterModel>(
    () => ({
      projectId: input.projectId,
      projectWorkspacePath: input.projectWorkspacePath ?? null,
      threadId: activeThreadId,
      cwd,
      account,
      conversation: activeThreadId
        ? {
            ...(conversationSnapshot ?? {}),
            threadId: activeThreadId,
            projectId: input.projectId,
            source: conversationSnapshot?.source ?? null,
            threadName: input.activeThreadSummary?.threadName ?? null,
            threadPreview: input.activeThreadSummary?.threadPreview ?? "",
            modelProvider: input.activeThreadSummary?.modelProvider ?? "",
            cwd,
            statusType: statusType ?? "notLoaded",
            statusActiveFlags,
            archived,
            createdAt: input.activeThreadSummary?.createdAt ?? 0,
            updatedAt: input.activeThreadSummary?.updatedAt ?? 0,
            linkedAt: input.activeThreadSummary?.linkedAt ?? "",
            latestCollaborationMode: liveCollaborationMode ?? undefined,
            latestThreadSettings: liveThreadSettings,
            resumeState: resumeState ?? "needs_resume",
            turns,
            requests,
            queuedFollowUps,
            pendingSteers,
            backgroundTerminalRows,
            childMemberships,
            capabilityFlags: {
              canEditLastUserTurn: false,
              canForkFromTurn: false,
              canSearch: true,
              canCollapseTurns: true,
            },
            ephemeral: conversationSnapshot?.ephemeral,
          }
        : null,
      resumeState,
      activeTurn,
      isThreadRunning: Boolean(activeTurn || statusType === "active"),
      isNewThreadTab: input.isNewThreadTab,
      isCloudNewThreadTarget: Boolean(
        input.isNewThreadTab && input.newThreadTarget?.runInTarget === "cloud",
      ),
      newThreadTarget: input.newThreadTarget,
      newThreadProjectSelector: input.newThreadProjectSelector ?? null,
      newThreadStartInSelector: input.newThreadStartInSelector ?? null,
      composerShell,
      body,
      collaborationModes: input.collaborationModes,
      selectedCollaborationMode,
      selectedModel,
      availableModels: input.availableModels,
      selectedReasoningEffort,
      selectedPersonality:
        liveThreadSettings?.personality ?? input.selectedPersonality ?? "friendly",
      reasoningEffortOptions: input.reasoningEffortOptions,
      permissionMode: input.permissionMode,
      permissionState,
      isQueueingEnabled: input.isQueueingEnabled,
      composerEnterBehavior: input.composerEnterBehavior,
      composerIntent,
      newThreadComposerIntent: input.newThreadComposerIntent ?? null,
      dictation,
    }),
    [
      activeThreadId,
      activeTurn,
      archived,
      account,
      body,
      backgroundTerminalRows,
      childMemberships,
      conversationSnapshot,
      composerIntent,
      input.newThreadComposerIntent,
      dictation,
      composerShell,
      cwd,
      input.availableModels,
      input.collaborationModes,
      input.composerEnterBehavior,
      input.activeThreadSummary,
      input.isNewThreadTab,
      input.isQueueingEnabled,
      input.newThreadProjectSelector,
      input.newThreadStartInSelector,
      input.newThreadTarget,
      input.permissionMode,
      permissionState,
      input.projectId,
      input.projectWorkspacePath,
      input.reasoningEffortOptions,
      input.selectedPersonality,
      liveCollaborationMode,
      liveThreadSettings,
      pendingSteers,
      queuedFollowUps,
      requests,
      selectedCollaborationMode,
      selectedModel,
      selectedReasoningEffort,
      resumeState,
      statusActiveFlags,
      statusType,
      turns,
    ],
  );

  return (
    <LocalConversationFooter
      model={model}
      actions={actions}
      errorMessage={errorMessage}
      onErrorMessage={onErrorMessage}
      variant={variant}
      rightPanelComposerOverlay={{
        enabled: rightPanelComposerOverlayEnabled,
        target: rightPanelComposerOverlayTarget,
      }}
      planSidePanelState={input.planSidePanelState ?? null}
      turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
    />
  );
}

function NewThreadHomeHero({
  input,
  actions,
}: {
  input: ConnectedThreadStageInput;
  actions: ThreadStageActions;
}) {
  const projectName = input.newThreadTarget?.projectName ?? "this project";

  return (
    <div className="heading-xl flex max-w-full min-w-0 items-end justify-center text-center font-normal whitespace-pre-wrap text-token-foreground select-none">
      <span className="group/title inline-block max-w-full">
        {"What should we build in "}
        {input.newThreadProjectSelector ? (
          <NewChatProjectSelector
            model={input.newThreadProjectSelector}
            actions={actions}
            variant="heading"
          />
        ) : (
          projectName
        )}
        ?
      </span>
    </div>
  );
}

export function ConnectedThreadStage({
  actions,
  onForkFromTurnIntoWorktree,
  initialUiState,
  backgroundAgentDetail = false,
  rightPanelComposerOverlayEnabled = false,
  rightPanelComposerOverlayTarget = null,
  turnDiffHoverPreviewDisabled = false,
  summaryPanelMounted = false,
  summaryPanelOpen = false,
  summaryPanelHideImmediately = false,
  summaryPanelContentShift = 0,
  threadViewportActive = true,
  ...input
}: ConnectedThreadStageProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeThreadId = resolveConnectedStageActiveThreadId(input);
  const isSideChat = Boolean(input.sideChatContext);
  const isNewThreadHome = input.isNewThreadTab && activeThreadId === null && !isSideChat;
  const showNewThreadHomeBody = Boolean(
    input.threadStartProgress &&
    resolveThreadStartProgressPresentation(input.threadStartProgress) === "panel",
  );
  const threadHeaderPortalTarget = useThreadHeaderPortalTarget();
  const resumeState = useConversationResumeState(activeThreadId);
  const summaryFields = useConversationSummaryFields(activeThreadId);
  const requests = useConversationRequests(activeThreadId);
  const statusType = useConversationStatusType(activeThreadId);
  const statusActiveFlags = useConversationStatusActiveFlags(activeThreadId);
  const primaryRequest = useConversationPrimaryRequest(activeThreadId);
  const turns = useConversationTurns(activeThreadId);
  const conversation = useConversation(activeThreadId);
  const backgroundTerminalRows = useConversationBackgroundTerminalRows(activeThreadId);
  const cwd = useConversationCwd(activeThreadId);
  const childMemberships = useConversationChildMemberships(activeThreadId);
  const childThreadIds = useMemo(
    () => resolveChildConversationIds(activeThreadId, childMemberships),
    [activeThreadId, childMemberships],
  );
  const knownConversationsById = useConversationSubset(childThreadIds);
  const isActiveThreadArchived = input.activeThreadSummary?.archived === true || summaryFields.archived;
  const activeThreadProjectless = summaryFields.threadId
    ? summaryFields.projectId === null
    : input.activeThreadSummary?.projectId === null;
  const activeThreadTitle = resolveThreadTitle(input, summaryFields);
  const activeThreadIsManagedWorktree = Boolean(
    summaryFields.managedWorktreePath
    ?? input.activeThreadSummary?.managedWorktreePath,
  );
  const activeThreadHasRuntimeWork = Boolean(
    (statusType ?? input.activeThreadSummary?.statusType) === "active"
    || statusActiveFlags.length > 0
    || (input.activeThreadSummary?.statusActiveFlags.length ?? 0) > 0
    || requests.length > 0
    || primaryRequest,
  );
  const threadLifecycleActive = threadViewportActive || activeThreadHasRuntimeWork;
  const newestCanonicalRequest = conversation?.canonicalRequests?.at(-1) ?? null;
  const latestTurn = turns.at(-1) ?? null;
  const latestTurnKey = latestTurn
    ? buildCodexTurnOccurrenceKey(latestTurn.turnId, turns.length - 1)
    : null;
  const markActiveConversationAsRead = useCallback((requireWindowFocus: boolean) => {
    if (!threadViewportActive || !activeThreadId || !conversation?.hasUnreadTurn) return;
    if (requireWindowFocus && typeof document !== "undefined" && !document.hasFocus()) return;
    void markLocalConversationAsRead(activeThreadId).catch(() => {});
  }, [activeThreadId, conversation?.hasUnreadTurn, threadViewportActive]);
  const markActiveConversationAsReadOnFocus = useEffectEvent(() => {
    markActiveConversationAsRead(true);
  });
  const summaryPanelContentProps = useMemo(
    () => ({
      activeThreadId,
      activeThreadTitle,
      activeThreadIsManagedWorktree,
      activeThreadProjectless,
      cwd,
      projectlessOutputDirectory: summaryFields.projectlessOutputDirectory,
      projectWorkspacePath: input.projectWorkspacePath ?? null,
      turns,
      backgroundTerminalRows,
      childMemberships,
      knownConversationsById,
      sideChatRows: input.summarySideChatRows ?? [],
      browserRows: input.summaryBrowserRows ?? [],
      scheduledAutomation: input.summaryScheduledAutomation ?? null,
      computerUsePip: input.summaryComputerUsePip ?? null,
      newThreadStartInSelector: input.newThreadStartInSelector,
      actions,
      onOpenThread: actions.onOpenThread,
      onErrorMessage: setErrorMessage,
    }),
    [
      activeThreadId,
      activeThreadTitle,
      activeThreadIsManagedWorktree,
      activeThreadProjectless,
      backgroundTerminalRows,
      childMemberships,
      input.summaryComputerUsePip,
      input.summaryBrowserRows,
      input.summaryScheduledAutomation,
      input.summarySideChatRows,
      knownConversationsById,
      cwd,
      summaryFields.projectlessOutputDirectory,
      input.newThreadStartInSelector,
      input.projectWorkspacePath,
      actions,
      turns,
    ],
  );
  useEffect(() => {
    if (!activeThreadId) return;
    if (!threadLifecycleActive) return;

    void setLocalConversationThreadViewActive(activeThreadId, true).catch(() => {});
    return () => {
      void setLocalConversationThreadViewActive(activeThreadId, false).catch(() => {});
    };
  }, [activeThreadId, threadLifecycleActive]);

  useEffect(() => {
    if (!backgroundAgentDetail || !activeThreadId) return;

    void markLocalSubagentThreadOpened(activeThreadId).catch(() => {});
  }, [activeThreadId, backgroundAgentDetail]);

  useEffect(() => {
    void latestTurn?.status;
    void latestTurnKey;
    void newestCanonicalRequest;
    const handleFocus = () => markActiveConversationAsReadOnFocus();
    window.addEventListener("focus", handleFocus);
    if (document.hasFocus()) handleFocus();
    return () => window.removeEventListener("focus", handleFocus);
  }, [
    activeThreadId,
    latestTurn?.status,
    latestTurnKey,
    newestCanonicalRequest,
    threadViewportActive,
  ]);

  useEffect(() => {
    if (!input.activeThreadId || input.isNewThreadTab || isSideChat) {
      return;
    }
    if (isActiveThreadArchived) {
      return;
    }
    if (!threadLifecycleActive) {
      return;
    }

    const nextResumeState = resumeState ?? "needs_resume";
    if (nextResumeState === "resuming" || nextResumeState === "resumed") {
      return;
    }

    void requestLocalConversationResume(input.activeThreadId).catch(() => {});
  }, [
    isActiveThreadArchived,
    isSideChat,
    resumeState,
    input.activeThreadId,
    input.isNewThreadTab,
    threadLifecycleActive,
  ]);

  if (isNewThreadHome) {
    return (
      <LocalConversationNewThreadHomeScreen
        hero={<NewThreadHomeHero input={input} actions={actions} />}
        body={showNewThreadHomeBody ? (
          <ConnectedThreadStageBody
            activeThreadId={activeThreadId}
            input={input}
            actions={actions}
            isWorktreeThread={activeThreadIsManagedWorktree}
            onForkFromTurnIntoWorktree={activeThreadIsManagedWorktree
              ? undefined
              : onForkFromTurnIntoWorktree}
            onErrorMessage={setErrorMessage}
            initialUiState={initialUiState}
            turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
          />
        ) : null}
        footer={(
          <ConnectedThreadStageFooter
            activeThreadId={activeThreadId}
            input={input}
            actions={actions}
            errorMessage={errorMessage}
            onErrorMessage={setErrorMessage}
            variant="newThreadHome"
            rightPanelComposerOverlayEnabled={false}
            rightPanelComposerOverlayTarget={null}
            turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
          />
        )}
        floatingContent={(
          <ThreadSummaryPanelRenderBoundary
            fallback={({ resetError }) => (
              <ThreadSummaryPanelRenderErrorFallback
                hideImmediately={summaryPanelHideImmediately}
                mounted={summaryPanelMounted}
                onRetry={resetError}
                open={summaryPanelOpen}
              />
            )}
            resetKey={activeThreadId}
          >
            <ThreadFloatingSummaryPanel
              hideImmediately={summaryPanelHideImmediately}
              mounted={summaryPanelMounted}
              open={summaryPanelOpen}
              {...summaryPanelContentProps}
            />
          </ThreadSummaryPanelRenderBoundary>
        )}
        contentShiftX={summaryPanelContentShift}
      />
    );
  }

  const threadHeaderPortal = !isSideChat && threadHeaderPortalTarget
    ? createPortal(
        <ConnectedThreadStageHeader
          activeThreadId={activeThreadId}
          input={input}
          actions={actions}
          onErrorMessage={setErrorMessage}
        />,
        threadHeaderPortalTarget,
      )
    : null;

  return (
    <>
      {threadHeaderPortal}
      <LocalConversationStageScreen
        onReadInteraction={() => markActiveConversationAsRead(false)}
        header={null}
        body={(
          <ConnectedThreadStageBody
            activeThreadId={activeThreadId}
            input={input}
            actions={actions}
            isWorktreeThread={activeThreadIsManagedWorktree}
            onForkFromTurnIntoWorktree={activeThreadIsManagedWorktree
              ? undefined
              : onForkFromTurnIntoWorktree}
            onErrorMessage={setErrorMessage}
            contentShiftX={summaryPanelContentShift}
            footer={(
              <ConnectedThreadStageFooter
                activeThreadId={activeThreadId}
                input={input}
                actions={actions}
                errorMessage={errorMessage}
                onErrorMessage={setErrorMessage}
                rightPanelComposerOverlayEnabled={rightPanelComposerOverlayEnabled && !isSideChat}
                rightPanelComposerOverlayTarget={rightPanelComposerOverlayTarget}
                turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
              />
            )}
            initialUiState={initialUiState}
            turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
          />
        )}
        floatingContent={(
          <ThreadSummaryPanelRenderBoundary
            fallback={({ resetError }) => (
              <ThreadSummaryPanelRenderErrorFallback
                hideImmediately={summaryPanelHideImmediately}
                mounted={summaryPanelMounted}
                onRetry={resetError}
                open={summaryPanelOpen}
              />
            )}
            resetKey={activeThreadId}
          >
            <ThreadFloatingSummaryPanel
              hideImmediately={summaryPanelHideImmediately}
              mounted={summaryPanelMounted}
              open={summaryPanelOpen}
              {...summaryPanelContentProps}
            />
          </ThreadSummaryPanelRenderBoundary>
        )}
      />
    </>
  );
}
