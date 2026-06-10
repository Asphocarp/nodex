import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@/lib/api";
import { useThreadHeaderPortalTarget } from "@/lib/thread-header-portal";
import type {
  CodexCollaborationModeKind,
  CodexCollaborationModeState,
} from "@/lib/types";
import { buildComposerShellModel } from "../projection/build-composer-shell-model";
import { buildThreadBodyModel } from "../projection/build-thread-body-model";
import type {
  ThreadBodySurfaceModel,
  ThreadBodyUiStateOverrides,
  ThreadFooterModel,
  ThreadOpenCardTarget,
  ThreadStageActions,
  ThreadStageHeaderModel,
  ThreadStageRouteInput,
} from "../thread-stage-types";
import {
  requestLocalConversationResume,
  useComposerIntent,
  useConversationBackgroundTerminalRows,
  useConversationCapabilityFlags,
  useConversationChildMemberships,
  useConversation,
  useConversationCollaborationMode,
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
import { resolveThreadCardStatus } from "./shared/thread-card-fetch";
import {
  ThreadFloatingSummaryPanel,
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
  | "activeThreadCardColumnId"
>;

function isKnownCollaborationMode(mode: string | null | undefined): mode is CodexCollaborationModeKind {
  return mode === "default" || mode === "plan";
}

function resolveEffectiveCollaborationMode({
  activeThreadId,
  liveMode,
  fallbackMode,
  availableModes,
}: {
  activeThreadId: string | null;
  liveMode: CodexCollaborationModeState | null;
  fallbackMode: CodexCollaborationModeKind;
  availableModes: ConnectedThreadStageInput["collaborationModes"];
}): CodexCollaborationModeKind {
  if (!activeThreadId || !isKnownCollaborationMode(liveMode?.mode)) {
    return fallbackMode;
  }

  if (availableModes.length === 0) {
    return liveMode.mode;
  }

  return availableModes.some((mode) => mode.mode === liveMode.mode)
    ? liveMode.mode
    : fallbackMode;
}

interface ConnectedThreadStageProps extends ConnectedThreadStageInput {
  actions: ThreadStageActions;
  initialUiState?: ThreadBodyUiStateOverrides;
  rightPanelComposerOverlayEnabled?: boolean;
  rightPanelComposerOverlayTarget?: HTMLElement | null;
  summaryPanelMounted?: boolean;
  summaryPanelOpen?: boolean;
  summaryPanelHideImmediately?: boolean;
  summaryPanelContentShift?: number;
}

function resolveThreadTitle(input: ConnectedThreadStageInput, summary: ReturnType<typeof useConversationSummaryFields>): string {
  if (input.sideChatContext?.tabTitle) {
    return input.sideChatContext.tabTitle;
  }

  return (
    summary.threadName ||
    summary.threadPreview ||
    input.activeThreadSummary?.threadName ||
    input.activeThreadSummary?.threadPreview ||
    input.newThreadTarget?.threadTitle ||
    (input.isNewThreadTab ? "New thread" : "No thread")
  );
}

function resolveOpenCardTarget(input: ConnectedThreadStageInput, summary: ReturnType<typeof useConversationSummaryFields>, activeThreadCardColumnId: string | null): ThreadOpenCardTarget | null {
  if (input.sideChatContext) {
    return null;
  }

  if (summary.cardId) {
    return {
      cardId: summary.cardId,
      title: summary.threadName?.trim() || summary.threadPreview || summary.cardId,
      columnId: activeThreadCardColumnId,
    };
  }

  if (input.activeThreadSummary?.cardId) {
    return {
      cardId: input.activeThreadSummary.cardId,
      title:
        input.activeThreadSummary.threadName?.trim()
        || input.activeThreadSummary.threadPreview
        || input.activeThreadSummary.cardId,
      columnId: activeThreadCardColumnId,
    };
  }

  if (input.isNewThreadTab && input.newThreadTarget?.cardId && input.newThreadTarget.cardTitle) {
    return {
      cardId: input.newThreadTarget.cardId,
      title: input.newThreadTarget.cardTitle,
      columnId: input.newThreadTarget.columnId ?? null,
    };
  }

  return null;
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
  const [activeThreadCardColumnId, setActiveThreadCardColumnId] = useState<string | null>(null);

  useEffect(() => {
    const activeThreadCardId = summaryFields.cardId;
    const activeThreadProjectId = summaryFields.projectId ?? input.projectId;
    if (!activeThreadCardId || !activeThreadProjectId) {
      setActiveThreadCardColumnId(null);
      return;
    }

    let cancelled = false;
    void invoke("card:get", activeThreadProjectId, activeThreadCardId)
      .then((result) => {
        if (cancelled) return;
        setActiveThreadCardColumnId(resolveThreadCardStatus(result));
      })
      .catch(() => {
        if (cancelled) return;
        setActiveThreadCardColumnId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [input.projectId, summaryFields.cardId, summaryFields.projectId]);

  const model = useMemo<ThreadStageHeaderModel>(
    () => ({
      projectId: summaryFields.projectId ?? input.projectId,
      threadId: summaryFields.threadId ?? input.activeThreadSummary?.threadId ?? activeThreadId,
      cardId: summaryFields.cardId ?? input.activeThreadSummary?.cardId ?? input.newThreadTarget?.cardId ?? null,
      title: resolveThreadTitle(input, summaryFields),
      openCardTarget: resolveOpenCardTarget(input, summaryFields, activeThreadCardColumnId),
      activeThreadCardColumnId,
      connection,
      account,
      showSideChatAction: Boolean(activeThreadId && !input.sideChatContext && actions.onOpenSideChat),
    }),
    [
      account,
      activeThreadCardColumnId,
      activeThreadId,
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
  onErrorMessage,
  contentShiftX,
  footer,
  initialUiState,
}: {
  activeThreadId: string | null;
  input: ConnectedThreadStageInput;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
  contentShiftX?: number;
  footer?: ReactNode;
  initialUiState?: ThreadBodyUiStateOverrides;
}) {
  const turns = useConversationTurns(activeThreadId);
  const requests = useConversationRequests(activeThreadId);
  const cwd = useConversationCwd(activeThreadId);
  const resumeState = useConversationResumeState(activeThreadId);
  const statusType = useConversationStatusType(activeThreadId);
  const summaryFields = useConversationSummaryFields(activeThreadId);
  const archived = input.activeThreadSummary?.archived === true || summaryFields.archived;
  const capabilityFlags = useConversationCapabilityFlags(activeThreadId);
  const parentThreadId = useConversationParentThreadId(activeThreadId);
  const parentTurns = useConversationTurns(parentThreadId);

  const body = useMemo(
    () =>
      buildThreadBodyModel({
        activeThreadId,
        threadId: activeThreadId,
        turns,
        requests,
        resumeState,
        statusType,
        archived,
        capabilityFlags,
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
      capabilityFlags,
      input.isNewThreadTab,
      input.newThreadTarget,
      input.threadStartProgress,
      parentTurns,
      requests,
      resumeState,
      statusType,
      turns,
    ],
  );

  const model = useMemo<ThreadBodySurfaceModel>(
    () => ({
      projectId: input.projectId,
      threadId: activeThreadId,
      cwd,
      turns,
      requests,
      resumeState,
      statusType,
      capabilityFlags,
      body,
      parentTurns,
      projectWorkspacePath: input.projectWorkspacePath ?? null,
      searchOpenTick: input.searchOpenTick,
      threadStartProgress: input.threadStartProgress,
    }),
    [
      activeThreadId,
      body,
      capabilityFlags,
      cwd,
      input.projectId,
      input.projectWorkspacePath,
      input.searchOpenTick,
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
      onErrorMessage={onErrorMessage}
      contentShiftX={contentShiftX}
      footer={footer}
      initialUiState={initialUiState}
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
}: {
  activeThreadId: string | null;
  input: ConnectedThreadStageInput;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
  variant?: "thread" | "newThreadHome";
  rightPanelComposerOverlayEnabled?: boolean;
  rightPanelComposerOverlayTarget?: HTMLElement | null;
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
  const composerIntent = useComposerIntent(activeThreadId);
  const primaryRequest = useConversationPrimaryRequest(activeThreadId);
  const liveCollaborationMode = useConversationCollaborationMode(activeThreadId);
  const account = useLocalConversationAccount();
  const dictation = useCodexDictationState();
  const childThreadIds = useMemo(
    () => childMemberships.map((membership) => membership.threadId),
    [childMemberships],
  );
  const knownConversationsById = useConversationSubset(childThreadIds);

  const composerShell = useMemo(
    () =>
      buildComposerShellModel({
        threadId: activeThreadId,
        turns,
        requests,
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
  const selectedCollaborationMode = resolveEffectiveCollaborationMode({
    activeThreadId,
    liveMode: liveCollaborationMode,
    fallbackMode: input.selectedCollaborationMode,
    availableModes: input.collaborationModes,
  });
  const body = useMemo(
    () =>
      buildThreadBodyModel({
        activeThreadId,
        threadId: activeThreadId,
        turns,
        requests,
        resumeState,
        statusType,
        archived,
        capabilityFlags: {
          canEditLastUserTurn: false,
          canForkFromTurn: false,
          canSearch: true,
          canCollapseTurns: true,
        },
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
      input.isNewThreadTab,
      input.newThreadTarget,
      input.threadStartProgress,
      requests,
      resumeState,
      statusType,
      turns,
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
            cardId: input.activeThreadSummary?.cardId ?? input.newThreadTarget?.cardId ?? "",
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
      selectedModel: input.selectedModel,
      availableModels: input.availableModels,
      selectedReasoningEffort: input.selectedReasoningEffort,
      reasoningEffortOptions: input.reasoningEffortOptions,
      permissionMode: input.permissionMode,
      isQueueingEnabled: input.isQueueingEnabled,
      composerEnterBehavior: input.composerEnterBehavior,
      composerIntent,
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
      input.projectId,
      input.projectWorkspacePath,
      input.reasoningEffortOptions,
      input.selectedModel,
      input.selectedReasoningEffort,
      liveCollaborationMode,
      pendingSteers,
      queuedFollowUps,
      requests,
      selectedCollaborationMode,
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
  initialUiState,
  rightPanelComposerOverlayEnabled = false,
  rightPanelComposerOverlayTarget = null,
  summaryPanelMounted = false,
  summaryPanelOpen = false,
  summaryPanelHideImmediately = false,
  summaryPanelContentShift = 0,
  ...input
}: ConnectedThreadStageProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeThreadId = input.activeThreadId && !input.isNewThreadTab
    ? input.activeThreadId
    : null;
  const isSideChat = Boolean(input.sideChatContext);
  const isNewThreadHome = input.isNewThreadTab && activeThreadId === null && !isSideChat;
  const threadHeaderPortalTarget = useThreadHeaderPortalTarget();
  const resumeState = useConversationResumeState(activeThreadId);
  const summaryFields = useConversationSummaryFields(activeThreadId);
  const turns = useConversationTurns(activeThreadId);
  const backgroundTerminalRows = useConversationBackgroundTerminalRows(activeThreadId);
  const cwd = useConversationCwd(activeThreadId);
  const isActiveThreadArchived = input.activeThreadSummary?.archived === true || summaryFields.archived;
  const summaryPanelContentProps = useMemo(
    () => ({
      activeThreadId,
      cwd,
      projectWorkspacePath: input.projectWorkspacePath ?? null,
      turns,
      backgroundTerminalRows,
      sideChatRows: input.summarySideChatRows ?? [],
      browserRows: input.summaryBrowserRows ?? [],
      newThreadStartInSelector: input.newThreadStartInSelector,
      onErrorMessage: setErrorMessage,
    }),
    [
      activeThreadId,
      backgroundTerminalRows,
      input.summaryBrowserRows,
      input.summarySideChatRows,
      cwd,
      input.newThreadStartInSelector,
      input.projectWorkspacePath,
      turns,
    ],
  );
  useEffect(() => {
    if (!input.activeThreadId || input.isNewThreadTab || isSideChat) {
      return;
    }
    if (isActiveThreadArchived) {
      return;
    }

    const nextResumeState = resumeState ?? "needs_resume";
    if (nextResumeState === "resuming" || nextResumeState === "resumed") {
      return;
    }

    void requestLocalConversationResume(input.activeThreadId).catch(() => {});
  }, [isActiveThreadArchived, isSideChat, resumeState, input.activeThreadId, input.isNewThreadTab]);

  if (isNewThreadHome) {
    return (
      <LocalConversationNewThreadHomeScreen
        hero={<NewThreadHomeHero input={input} actions={actions} />}
        body={input.threadStartProgress ? (
          <ConnectedThreadStageBody
            activeThreadId={activeThreadId}
            input={input}
            actions={actions}
            onErrorMessage={setErrorMessage}
            initialUiState={initialUiState}
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
          />
        )}
        floatingContent={(
          <ThreadFloatingSummaryPanel
            hideImmediately={summaryPanelHideImmediately}
            mounted={summaryPanelMounted}
            open={summaryPanelOpen}
            {...summaryPanelContentProps}
          />
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
        header={null}
        body={(
          <ConnectedThreadStageBody
            activeThreadId={activeThreadId}
            input={input}
            actions={actions}
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
              />
            )}
            initialUiState={initialUiState}
          />
        )}
        floatingContent={(
          <ThreadFloatingSummaryPanel
            hideImmediately={summaryPanelHideImmediately}
            mounted={summaryPanelMounted}
            open={summaryPanelOpen}
            {...summaryPanelContentProps}
          />
        )}
      />
    </>
  );
}
