import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppShellHeaderContentRegistrar } from "@/lib/workbench-ui-scopes";
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
import { selectPrimaryBackgroundConversationRequest } from "../conversation-request-helpers";
import { copyConversationMarkdown } from "../copy-conversation-markdown";
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
  setLocalConversationThreadPresented,
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
  useConversationStreamRole,
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
import { resolveEffectiveAgentExecutionProfile } from "@/lib/agent-execution-profile";
import type { AgentExecutionProfile } from "../../../../shared/agent-runtime";

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

function usePresentedConversationIds(
  conversationIds: readonly string[],
): void {
  const currentIdsRef = useRef<ReadonlySet<string>>(new Set());
  const updateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const updatePresentedIds = useEffectEvent((nextIds: readonly string[]) => {
    const next = new Set(
      nextIds.map((conversationId) => conversationId.trim()).filter(Boolean),
    );
    const current = currentIdsRef.current;
    const removed = [...current].filter((conversationId) =>
      !next.has(conversationId)
    );
    const added = [...next].filter((conversationId) =>
      !current.has(conversationId)
    );
    currentIdsRef.current = next;
    updateQueueRef.current = updateQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        for (const conversationId of removed) {
          await setLocalConversationThreadPresented(
            conversationId,
            false,
          ).catch(() => undefined);
        }
        for (const conversationId of added) {
          await setLocalConversationThreadPresented(
            conversationId,
            true,
          ).catch(() => undefined);
        }
      });
  });

  useEffect(() => {
    updatePresentedIds(conversationIds);
  }, [conversationIds]);

  useEffect(() => () => {
    updatePresentedIds([]);
  }, []);
}

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
  threadExecutionProfile,
  availableModes,
}: {
  activeThreadId: string | null;
  liveThreadSettings: CodexConversationThreadSettings | null;
  liveMode: CodexCollaborationModeState | null;
  fallbackMode: CodexCollaborationModeKind;
  fallbackModel: string;
  fallbackReasoningEffort: ConnectedThreadStageInput["selectedReasoningEffort"];
  threadExecutionProfile?: AgentExecutionProfile | null;
  availableModes: ConnectedThreadStageInput["collaborationModes"];
}): {
  selectedCollaborationMode: CodexCollaborationModeKind;
  selectedModel: string;
  selectedReasoningEffort: ConnectedThreadStageInput["selectedReasoningEffort"];
} {
  const candidateMode = liveThreadSettings?.collaborationMode?.mode ?? liveMode?.mode;
  const fallback = {
    selectedCollaborationMode: fallbackMode,
    selectedModel: threadExecutionProfile?.modelId ?? fallbackModel,
    selectedReasoningEffort:
      threadExecutionProfile?.reasoningEffort ?? fallbackReasoningEffort,
  };
  if (!activeThreadId || !isKnownCollaborationMode(candidateMode)) {
    return fallback;
  }

  const selectedCollaborationMode = availableModes.length === 0 || availableModes.some((mode) => mode.mode === candidateMode)
    ? candidateMode
    : fallbackMode;
  return {
    selectedCollaborationMode,
    selectedModel:
      normalizeSelectedModel(liveThreadSettings?.model)
      ?? threadExecutionProfile?.modelId
      ?? fallbackModel,
    selectedReasoningEffort:
      liveThreadSettings?.reasoningEffort
      ?? threadExecutionProfile?.reasoningEffort
      ?? fallbackReasoningEffort,
  };
}

interface ConnectedThreadStageProps extends ConnectedThreadStageInput {
  actions: ThreadStageActions;
  composerScopeIdentity?: string | null;
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
  routeActive?: boolean;
  threadBodyVisible?: boolean;
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
  const summaryFields = useConversationSummaryFields(activeThreadId);
  const cwd = useConversationCwd(activeThreadId);
  const parentConversationId = useConversationParentThreadId(activeThreadId);
  const title = resolveThreadTitle(input, summaryFields);
  const handleCopyConversationMarkdown = useCallback(async () => {
    if (!activeThreadId) return;
    await copyConversationMarkdown({
      conversationId: activeThreadId,
      parentConversationId,
      title,
    });
  }, [activeThreadId, parentConversationId, title]);

  const headerActions = useMemo<ThreadStageActions>(() => ({
    ...actions,
    ...(activeThreadId ? { onCopyConversationMarkdown: handleCopyConversationMarkdown } : {}),
  }), [actions, activeThreadId, handleCopyConversationMarkdown]);

  const model = useMemo<ThreadStageHeaderModel>(
    () => ({
      projectId: summaryFields.projectId ?? input.projectId,
      sessionId: input.sessionId ?? null,
      threadId: summaryFields.threadId ?? input.activeThreadSummary?.threadId ?? activeThreadId,
      title,
      cwd,
      pinned: input.threadPinned,
      shortcuts: input.threadActionShortcuts,
      showSideChatAction: Boolean(activeThreadId && !input.sideChatContext && actions.onOpenSideChat),
    }),
    [
      activeThreadId,
      actions.onOpenSideChat,
      cwd,
      input,
      summaryFields,
      title,
    ],
  );

  return <ThreadStageHeader model={model} actions={headerActions} onErrorMessage={onErrorMessage} />;
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
  transcriptVisible = true,
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
  transcriptVisible?: boolean;
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
      sessionId: input.sessionId ?? null,
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
      input.sessionId,
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
      transcriptVisible={transcriptVisible}
      planSidePanelState={input.planSidePanelState ?? null}
      turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
    />
  );
}

function ConnectedThreadStageFooter({
  activeThreadId,
  input,
  actions,
  composerScopeIdentity,
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
  composerScopeIdentity: string | null;
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
  const executionProfile = useMemo(() => resolveEffectiveAgentExecutionProfile({
    catalog: input.agentProviderCatalog,
    activeThreadId,
    threadProfile: input.activeThreadSummary?.executionProfile,
    threadModelProvider:
      liveThreadSettings?.modelProvider
      ?? input.activeThreadSummary?.modelProvider,
    liveModel: liveThreadSettings?.model,
    liveReasoningEffort: liveThreadSettings?.reasoningEffort,
    liveServiceTier: liveThreadSettings?.serviceTier,
    draftProfile: input.selectedExecutionProfile,
  }), [
    activeThreadId,
    input.activeThreadSummary?.executionProfile,
    input.activeThreadSummary?.modelProvider,
    input.agentProviderCatalog,
    input.selectedExecutionProfile,
    liveThreadSettings?.model,
    liveThreadSettings?.modelProvider,
    liveThreadSettings?.reasoningEffort,
    liveThreadSettings?.serviceTier,
  ]);
  const effectiveSettings = resolveEffectiveThreadStageSettings({
    activeThreadId,
    liveThreadSettings,
    liveMode: liveCollaborationMode,
    fallbackMode: input.selectedCollaborationMode,
    fallbackModel: input.selectedModel,
    fallbackReasoningEffort: input.selectedReasoningEffort,
    threadExecutionProfile: executionProfile,
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
      agentProviderCatalog: input.agentProviderCatalog ?? null,
      agentProviderCatalogLoading: input.agentProviderCatalogLoading ?? false,
      executionProfile,
      executionIdentityLocked: Boolean(activeThreadId && executionProfile),
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
      composerScopeIdentity,
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
      composerScopeIdentity,
      input.newThreadComposerIntent,
      dictation,
      composerShell,
      cwd,
      input.availableModels,
      input.agentProviderCatalog,
      input.agentProviderCatalogLoading,
      input.collaborationModes,
      input.composerEnterBehavior,
      input.activeThreadSummary,
      executionProfile,
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
  composerScopeIdentity = null,
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
  routeActive = true,
  threadBodyVisible = routeActive,
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
  const resumeState = useConversationResumeState(activeThreadId);
  const streamRole = useConversationStreamRole(activeThreadId);
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
  const visibleBackgroundRequestConversationId = useMemo(() => {
    if (backgroundAgentDetail) return null;
    for (const membership of childMemberships) {
      const conversation = knownConversationsById[membership.threadId];
      if (selectPrimaryBackgroundConversationRequest(conversation ?? null)) {
        return membership.threadId;
      }
    }
    return null;
  }, [
    backgroundAgentDetail,
    childMemberships,
    knownConversationsById,
  ]);
  const presentedConversationIds = useMemo(() => {
    const requestSurfaceVisible = threadBodyVisible
      || rightPanelComposerOverlayEnabled;
    if (!routeActive || !requestSurfaceVisible) return [];
    return [...new Set([
      activeThreadId,
      visibleBackgroundRequestConversationId,
    ].filter((conversationId): conversationId is string =>
      typeof conversationId === "string" && conversationId.length > 0
    ))];
  }, [
    activeThreadId,
    rightPanelComposerOverlayEnabled,
    routeActive,
    threadBodyVisible,
    visibleBackgroundRequestConversationId,
  ]);
  usePresentedConversationIds(presentedConversationIds);
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
  const threadLifecycleActive = routeActive || activeThreadHasRuntimeWork;
  const newestCanonicalRequest = conversation?.canonicalRequests?.at(-1) ?? null;
  const latestTurn = turns.at(-1) ?? null;
  const latestTurnKey = latestTurn
    ? buildCodexTurnOccurrenceKey(latestTurn.turnId, turns.length - 1)
    : null;
  const markActiveConversationAsRead = useCallback((requireWindowFocus: boolean) => {
    if (!routeActive || !threadBodyVisible || !activeThreadId || !conversation?.hasUnreadTurn) return;
    if (requireWindowFocus && typeof document !== "undefined" && !document.hasFocus()) return;
    void markLocalConversationAsRead(activeThreadId).catch(() => {});
  }, [activeThreadId, conversation?.hasUnreadTurn, routeActive, threadBodyVisible]);
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
    routeActive,
    threadBodyVisible,
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
    if (nextResumeState === "resuming") {
      return;
    }
    if (
      nextResumeState === "resumed"
      && (streamRole === "owner" || streamRole === "follower")
    ) {
      return;
    }

    void requestLocalConversationResume(input.activeThreadId).catch(() => {});
  }, [
    isActiveThreadArchived,
    isSideChat,
    resumeState,
    streamRole,
    input.activeThreadId,
    input.isNewThreadTab,
    threadLifecycleActive,
  ]);

  if (isNewThreadHome) {
    return (
      <LocalConversationNewThreadHomeScreen
        hero={<NewThreadHomeHero input={input} actions={actions} />}
        body={showNewThreadHomeBody && threadBodyVisible ? (
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
            transcriptVisible={threadBodyVisible}
            turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
          />
        ) : null}
        footer={(
          <ConnectedThreadStageFooter
            activeThreadId={activeThreadId}
            input={input}
            actions={actions}
            composerScopeIdentity={composerScopeIdentity}
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

  const ownsAppShellHeader = !isSideChat && !backgroundAgentDetail;
  const threadHeaderContent = ownsAppShellHeader ? (
    <ConnectedThreadStageHeader
      activeThreadId={activeThreadId}
      input={input}
      actions={actions}
      onErrorMessage={setErrorMessage}
    />
  ) : null;

  return (
    <>
      {ownsAppShellHeader ? (
        <AppShellHeaderContentRegistrar content={threadHeaderContent} />
      ) : null}
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
            footer={backgroundAgentDetail ? null : (
              <ConnectedThreadStageFooter
                activeThreadId={activeThreadId}
                input={input}
                actions={actions}
                composerScopeIdentity={composerScopeIdentity}
                errorMessage={errorMessage}
                onErrorMessage={setErrorMessage}
                rightPanelComposerOverlayEnabled={rightPanelComposerOverlayEnabled && !isSideChat}
                rightPanelComposerOverlayTarget={rightPanelComposerOverlayTarget}
                turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
              />
            )}
            initialUiState={initialUiState}
            transcriptVisible={threadBodyVisible}
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
