import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ConnectedThreadComposerDock,
  ConnectedThreadStage,
  useCodexAppServerControl,
  useCodexConversationValue,
  useCodexThreadStartProgress,
  type ThreadActionControllerInput,
  type ThreadStageActions,
} from "@/features/local-conversation";
import type {
  RightPanelComposerOverlayVisibility,
} from "@/features/local-conversation/view/right-panel-composer-overlay";
import { createThreadStageActions } from "@/features/local-conversation/thread-action-controller";
import type {
  NewChatStartInSelectorModel,
  ThreadOpenSideChatInput,
  ThreadPlanSidePanelState,
  ThreadSummaryPanelAuxiliaryRow,
  ThreadSummaryPanelBrowserRow,
  ThreadSummaryPanelComputerUsePipState,
  ThreadSummaryPanelScheduledAutomationRow,
} from "@/features/local-conversation/thread-stage-types";
import { getGitWorkerClient, invoke } from "@/lib/api";
import {
  createCommandKeymapState,
  formatCommandShortcutLabel,
  type CommandKeymapState,
} from "../../../shared/command-keybindings";
import { buildNewChatProjectSelectorOptions } from "@/lib/new-chat-project-selector";
import type { ComposerEnterBehavior } from "@/lib/composer-enter-behavior";
import type {
  CodexCollaborationModeKind,
  CodexCollaborationModePreset,
  CodexComposerIntent,
  PageRunInTarget,
  Project,
  WorktreeEnvironmentOption,
  WorktreeStartMode,
} from "@/lib/types";
import type { WorkbenchSessionRenderProjection } from "@/lib/workbench-session-presentation";
import {
  normalizeProjectPrimaryWorkspaceRoot,
  projectWorkspaceRootOrNull,
} from "@/lib/workbench-workspace-context";
import { resolvePresentedSessionThread } from "./workbench-session-thread-presentation";
import {
  readLocalEnvironmentSelections,
  resolveLocalEnvironmentOptionSelection,
  writeLocalEnvironmentSelection,
} from "./local-environment-selection";
import { projectSessionThreadLinkToSummary } from "./thread-summary-projection";

function ConnectedSessionThread({
  session,
  project,
  projects,
  routeActive,
  threadBodyVisible,
  onRefreshProjectSessions,
  onEnsureBlankSessionForProject,
  onStartNewChatWithPrompt,
  onOpenPendingWorktree,
  newThreadComposerIntent,
  onConsumeNewThreadComposerIntent,
  onRequestProjectPickerOpen,
  onOpenLocalEnvironmentsSettings,
  onOpenHooksSettings,
  threadQueueFollowUpsEnabled,
  composerEnterBehavior,
  onQueueingEnabledChange,
  onOpenThread,
  onOpenSubagentsPanel,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  onOpenSummaryGitReview,
  turnDiffHoverPreviewDisabled,
  onForkSessionFromTurn,
  onForkFromTurnIntoWorktree,
  worktreeStartMode,
  worktreeBranchPrefix,
  searchOpenTick,
  summaryPanelMounted,
  summaryPanelOpen,
  summaryPanelHideImmediately,
  summaryPanelContentShift,
  summarySideChatRows,
  summaryBrowserRows,
  summaryScheduledAutomation,
  summaryComputerUsePip,
  onOpenSummarySideChatRow,
  onOpenSummaryBrowserRow,
  onOpenSummaryScheduledAutomation,
  onOpenSummaryOutputInSidePanel,
  onOpenProcessManager,
  onOpenBackgroundTerminalOutput,
  onToggleSummaryComputerUsePip,
  rightPanelComposerOverlayEnabled,
  rightPanelComposerOverlayCompact,
  rightPanelComposerOverlayTarget,
  rightPanelComposerOverlayVisibility,
  onOpenSideChat,
  onOpenMcpAppSidePanel,
  onOpenPlanInSidePanel,
  onClosePlanSidePanel,
  planSidePanelState,
  onRequestRenameThread,
  onArchiveThread,
  onToggleThreadPin,
  commandKeymapState,
  isMac,
  presentation = "primary",
  composerDock,
  composerScopeIdentity,
  browserUseViewScopeId,
  newThreadStartBlockedReason,
  projectDraftId,
  onMaterializeProjectDraft,
}: {
  session: WorkbenchSessionRenderProjection;
  project: Project | null;
  projects: Project[];
  routeActive: boolean;
  threadBodyVisible: boolean;
  onRefreshProjectSessions: (
    projectId: string | null,
  ) => Promise<WorkbenchSessionRenderProjection[]>;
  onEnsureBlankSessionForProject: (
    projectId: string | null,
  ) => Promise<WorkbenchSessionRenderProjection>;
  onStartNewChatWithPrompt?: NonNullable<
    ThreadStageActions["onStartNewChatWithPrompt"]
  >;
  onOpenPendingWorktree: (clientThreadId: string) => void;
  newThreadComposerIntent?: CodexComposerIntent | null;
  onConsumeNewThreadComposerIntent?:
    ThreadStageActions["onConsumeNewThreadComposerIntent"];
  onRequestProjectPickerOpen: () => void;
  onOpenLocalEnvironmentsSettings: () => void;
  onOpenHooksSettings: NonNullable<
    ThreadStageActions["onOpenHooksSettings"]
  >;
  threadQueueFollowUpsEnabled: boolean;
  composerEnterBehavior: ComposerEnterBehavior;
  onQueueingEnabledChange: ThreadStageActions["onQueueingEnabledChange"];
  onOpenThread: ThreadStageActions["onOpenThread"];
  onOpenSubagentsPanel: ThreadStageActions["onOpenSubagentsPanel"];
  onOpenTurnDiffReview: ThreadStageActions["onOpenTurnDiffReview"];
  onOpenTurnDiffFileInSidePanel:
    ThreadStageActions["onOpenTurnDiffFileInSidePanel"];
  onOpenSummaryGitReview: ThreadStageActions["onOpenSummaryGitReview"];
  turnDiffHoverPreviewDisabled: boolean;
  onForkSessionFromTurn?: ThreadActionControllerInput["onForkSessionFromTurn"];
  onForkFromTurnIntoWorktree: (input: {
    threadId: string;
    targetTurnId: string;
  }) => Promise<void>;
  worktreeStartMode: WorktreeStartMode;
  worktreeBranchPrefix: string;
  searchOpenTick: number;
  summaryPanelMounted: boolean;
  summaryPanelOpen: boolean;
  summaryPanelHideImmediately: boolean;
  summaryPanelContentShift: number;
  summarySideChatRows: readonly ThreadSummaryPanelAuxiliaryRow[];
  summaryBrowserRows: readonly ThreadSummaryPanelBrowserRow[];
  summaryScheduledAutomation:
    ThreadSummaryPanelScheduledAutomationRow | null;
  summaryComputerUsePip: ThreadSummaryPanelComputerUsePipState | null;
  onOpenSummarySideChatRow: NonNullable<
    ThreadStageActions["onOpenSummarySideChatRow"]
  >;
  onOpenSummaryBrowserRow: NonNullable<
    ThreadStageActions["onOpenSummaryBrowserRow"]
  >;
  onOpenSummaryScheduledAutomation: NonNullable<
    ThreadStageActions["onOpenSummaryScheduledAutomation"]
  >;
  onOpenSummaryOutputInSidePanel: NonNullable<
    ThreadStageActions["onOpenSummaryOutputInSidePanel"]
  >;
  onOpenProcessManager?: ThreadStageActions["onOpenProcessManager"];
  onOpenBackgroundTerminalOutput?:
    ThreadStageActions["onOpenBackgroundTerminalOutput"];
  onToggleSummaryComputerUsePip: NonNullable<
    ThreadStageActions["onToggleSummaryComputerUsePip"]
  >;
  rightPanelComposerOverlayEnabled: boolean;
  rightPanelComposerOverlayCompact: boolean;
  rightPanelComposerOverlayTarget: HTMLElement | null;
  rightPanelComposerOverlayVisibility?: RightPanelComposerOverlayVisibility;
  onOpenSideChat?: (
    input?: ThreadOpenSideChatInput & {
      collaborationMode?: CodexCollaborationModeKind;
    },
  ) => Promise<void>;
  onOpenMcpAppSidePanel: ThreadStageActions["onOpenMcpAppSidePanel"];
  onOpenPlanInSidePanel: ThreadStageActions["onOpenPlanInSidePanel"];
  onClosePlanSidePanel: ThreadStageActions["onClosePlanSidePanel"];
  planSidePanelState: ThreadPlanSidePanelState | null;
  onRequestRenameThread: ThreadStageActions["onRequestRenameThread"];
  onArchiveThread: NonNullable<ThreadStageActions["onArchiveThread"]>;
  onToggleThreadPin: NonNullable<
    ThreadStageActions["onToggleThreadPin"]
  >;
  commandKeymapState?: CommandKeymapState | null;
  isMac: boolean;
  presentation?: "primary" | "panel";
  composerDock?: {
    readonly visible: boolean;
    readonly target: HTMLElement | null;
    readonly visibility: RightPanelComposerOverlayVisibility;
    readonly leadingContent: React.ReactNode;
  };
  composerScopeIdentity?: string | null;
  browserUseViewScopeId?: string | null;
  newThreadStartBlockedReason?: string | null;
  projectDraftId?: string | null;
  onMaterializeProjectDraft?: ThreadActionControllerInput["onMaterializeProjectDraft"];
}) {
  const attachedSummary = session.thread
    ? projectSessionThreadLinkToSummary(session.thread)
    : null;
  const [
    selectedNewThreadProjectId,
    setSelectedNewThreadProjectId,
  ] = useState<string | null>(session.projectId);
  const [
    selectedNewThreadRunInTarget,
    setSelectedNewThreadRunInTarget,
  ] = useState<PageRunInTarget>("localProject");
  const [
    selectedNewThreadEnvironmentPath,
    setSelectedNewThreadEnvironmentPath,
  ] = useState<string | null>(null);
  const [
    newThreadEnvironmentOptions,
    setNewThreadEnvironmentOptions,
  ] = useState<WorktreeEnvironmentOption[]>([]);
  const [
    newThreadEnvironmentsLoading,
    setNewThreadEnvironmentsLoading,
  ] = useState(false);
  const [
    canForkCurrentThreadIntoWorktree,
    setCanForkCurrentThreadIntoWorktree,
  ] = useState(false);
  const selectedNewThreadProject = selectedNewThreadProjectId === null
    ? null
    : projects.find(
      (candidate) => candidate.id === selectedNewThreadProjectId,
    ) ?? project ?? null;
  const progressProjectId = attachedSummary
    ? session.projectId
    : selectedNewThreadProject?.id ?? null;
  const threadStartProgress = useCodexThreadStartProgress(
    progressProjectId,
    session.id,
  );
  const attachedConversationHasVisibleTurn = useCodexConversationValue(
    attachedSummary?.threadId ?? null,
    (conversation) => (conversation?.turns.length ?? 0) > 0,
  );
  const summary = resolvePresentedSessionThread(
    attachedSummary,
    {
      rendererLaunchPending:
        threadStartProgress?.rendererLaunchPending ?? false,
      waitForFirstVisibleTurn: threadStartProgress !== null,
      hasVisibleFirstTurn: attachedConversationHasVisibleTurn,
    },
  );
  const startInSelectorProject = summary ? project : selectedNewThreadProject;
  const newThreadEnvironmentWorkspaceRoot = projectWorkspaceRootOrNull(
    startInSelectorProject,
  );
  const effectiveProjectId = summary
    ? session.projectId
    : selectedNewThreadProject?.id ?? null;
  const codexControl = useCodexAppServerControl(effectiveProjectId);
  const loadModels = codexControl.loadModels;
  const listCollaborationModes = codexControl.listCollaborationModes;
  const [collaborationModes, setCollaborationModes] = useState<
    CodexCollaborationModePreset[]
  >([]);
  const [
    selectedCollaborationMode,
    setSelectedCollaborationMode,
  ] = useState<CodexCollaborationModeKind>("default");
  const projectSelectorOptions = useMemo(
    () => buildNewChatProjectSelectorOptions(projects),
    [projects],
  );
  const threadActionShortcuts = useMemo(() => {
    const state = commandKeymapState
      ?? createCommandKeymapState({}, isMac ? "macOS" : "windows");
    return {
      togglePin: formatCommandShortcutLabel(
        state,
        "toggleThreadPin",
        "CmdOrCtrl+Alt+P",
      ),
      rename: formatCommandShortcutLabel(
        state,
        "renameThread",
        "CmdOrCtrl+Alt+R",
      ),
      archive: formatCommandShortcutLabel(
        state,
        "archiveThread",
        "CmdOrCtrl+Shift+A",
      ),
      openSideTask: formatCommandShortcutLabel(
        state,
        "openSideChat",
        "CmdOrCtrl+Alt+S",
      ),
      copyConversationMarkdown: formatCommandShortcutLabel(
        state,
        "copyConversationMarkdown",
      ),
    };
  }, [commandKeymapState, isMac]);

  useEffect(() => {
    if (summary) return;
    setSelectedNewThreadProjectId(session.projectId);
    setSelectedNewThreadRunInTarget("localProject");
    setSelectedNewThreadEnvironmentPath(null);
  }, [session.id, session.projectId, summary]);

  useEffect(() => {
    if (selectedNewThreadProjectId === null) return;
    if (
      projects.some(
        (candidate) => candidate.id === selectedNewThreadProjectId,
      )
    ) {
      return;
    }
    setSelectedNewThreadProjectId(session.projectId);
  }, [
    projects,
    selectedNewThreadProjectId,
    session.projectId,
  ]);

  useEffect(() => {
    void loadModels().catch(() => undefined);
    void listCollaborationModes()
      .then(setCollaborationModes)
      .catch(() => setCollaborationModes([]));
  }, [listCollaborationModes, loadModels]);

  useEffect(() => {
    const cwd = summary?.cwd?.trim();
    if (!cwd || summary?.managedWorktreePath) {
      setCanForkCurrentThreadIntoWorktree(false);
      return;
    }

    let disposed = false;
    setCanForkCurrentThreadIntoWorktree(false);
    void getGitWorkerClient().request({
      method: "branch-metadata",
      params: { cwd },
    })
      .then((state) => {
        if (disposed) return;
        setCanForkCurrentThreadIntoWorktree(Boolean(
          state.currentBranch
          || state.defaultBranch
          || state.branches.length > 0,
        ));
      })
      .catch(() => {
        if (!disposed) setCanForkCurrentThreadIntoWorktree(false);
      });

    return () => {
      disposed = true;
    };
  }, [summary?.cwd, summary?.managedWorktreePath]);

  const refreshNewThreadEnvironments = useCallback(async () => {
    if (effectiveProjectId === null) {
      setNewThreadEnvironmentsLoading(false);
      setNewThreadEnvironmentOptions([]);
      setSelectedNewThreadEnvironmentPath(null);
      return;
    }
    setNewThreadEnvironmentsLoading(true);
    try {
      const options = await invoke(
        "worktrees:environments:list",
        effectiveProjectId,
      ) as WorktreeEnvironmentOption[];
      setNewThreadEnvironmentOptions(options);
      setSelectedNewThreadEnvironmentPath(
        resolveLocalEnvironmentOptionSelection({
          options,
          selectionsByWorkspace: readLocalEnvironmentSelections(),
          workspaceRoot: newThreadEnvironmentWorkspaceRoot,
        }),
      );
    } catch {
      setNewThreadEnvironmentOptions([]);
    } finally {
      setNewThreadEnvironmentsLoading(false);
    }
  }, [effectiveProjectId, newThreadEnvironmentWorkspaceRoot]);

  const changeNewThreadEnvironment = useCallback(
    (configPath: string | null) => {
      setSelectedNewThreadEnvironmentPath(configPath);
      if (!newThreadEnvironmentWorkspaceRoot) return;
      writeLocalEnvironmentSelection({
        workspaceRoot: newThreadEnvironmentWorkspaceRoot,
        configPath,
      });
    },
    [newThreadEnvironmentWorkspaceRoot],
  );

  useEffect(() => {
    if (selectedNewThreadRunInTarget !== "newWorktree") return;
    void refreshNewThreadEnvironments();
  }, [
    refreshNewThreadEnvironments,
    selectedNewThreadRunInTarget,
  ]);

  const startInSelectorModel = useMemo<NewChatStartInSelectorModel>(
    () => ({
      target: {
        runInTarget: selectedNewThreadRunInTarget,
        runInEnvironmentPath: selectedNewThreadEnvironmentPath,
        worktreeStartMode,
        worktreeBranchPrefix,
      },
      disabled: effectiveProjectId === null,
      worktreeAvailable: Boolean(
        normalizeProjectPrimaryWorkspaceRoot(startInSelectorProject),
      ),
      environments: newThreadEnvironmentOptions,
      environmentsLoading: newThreadEnvironmentsLoading,
      selectedEnvironmentPath: selectedNewThreadEnvironmentPath,
      worktreeStartMode,
      worktreeBranchPrefix,
    }),
    [
      newThreadEnvironmentOptions,
      newThreadEnvironmentsLoading,
      effectiveProjectId,
      selectedNewThreadEnvironmentPath,
      selectedNewThreadRunInTarget,
      startInSelectorProject,
      worktreeBranchPrefix,
      worktreeStartMode,
    ],
  );

  const actions = useMemo<ThreadStageActions>(() => ({
    ...createThreadStageActions({
      activeThreadId: summary?.threadId ?? null,
      browserUseViewScopeId,
      codexControl,
      currentSessionId: session.id,
      onEnsureBlankSessionForProject,
      onRefreshProjectSessions,
      onOpenPendingWorktree,
      newThreadStartBlockedReason,
      onQueueingEnabledChange,
      onOpenThread,
      onOpenSubagentsPanel,
      onOpenTurnDiffReview,
      onOpenTurnDiffFileInSidePanel,
      onForkSessionFromTurn,
      currentSessionProjectId: session.projectId,
      projectId: effectiveProjectId,
      onNewThreadProjectChange: setSelectedNewThreadProjectId,
      onRequestNewChatProjectCreate: onRequestProjectPickerOpen,
      onStartNewChatWithPrompt,
      onNewThreadStartInTargetChange: (target) => {
        setSelectedNewThreadRunInTarget(target.runInTarget);
        if (target.runInTarget !== "newWorktree") {
          setSelectedNewThreadEnvironmentPath(null);
        }
      },
      onNewThreadStartInEnvironmentChange: changeNewThreadEnvironment,
      onRefreshNewThreadStartInEnvironments:
        refreshNewThreadEnvironments,
      onOpenNewThreadLocalEnvironmentsSettings:
        onOpenLocalEnvironmentsSettings,
      onOpenHooksSettings,
      ...(onOpenSideChat
        ? {
            onOpenSideChat: async (input: ThreadOpenSideChatInput = {}) => {
              await onOpenSideChat({
                ...input,
                collaborationMode: selectedCollaborationMode,
              });
            },
          }
        : {}),
      onOpenMcpAppSidePanel,
      onOpenPlanInSidePanel,
      onClosePlanSidePanel,
      onOpenSummarySideChatRow,
      onOpenSummaryBrowserRow,
      onOpenSummaryScheduledAutomation,
      onOpenSummaryOutputInSidePanel,
      onOpenSummaryGitReview,
      onOpenProcessManager,
      onOpenBackgroundTerminalOutput,
      onToggleSummaryComputerUsePip,
      onRequestRenameThread,
      onArchiveThread,
      onToggleThreadPin,
      selectedCollaborationMode,
      setSelectedCollaborationMode,
      onMaterializeProjectDraft,
    }),
    ...(onConsumeNewThreadComposerIntent
      ? { onConsumeNewThreadComposerIntent }
      : {}),
  }), [
    browserUseViewScopeId,
    codexControl,
    onEnsureBlankSessionForProject,
    onStartNewChatWithPrompt,
    onRefreshProjectSessions,
    onOpenPendingWorktree,
    newThreadStartBlockedReason,
    onQueueingEnabledChange,
    onOpenThread,
    onOpenSubagentsPanel,
    onOpenTurnDiffReview,
    onOpenTurnDiffFileInSidePanel,
    onForkSessionFromTurn,
    onRequestProjectPickerOpen,
    onOpenLocalEnvironmentsSettings,
    onOpenHooksSettings,
    onOpenSideChat,
    onOpenMcpAppSidePanel,
    onOpenPlanInSidePanel,
    onClosePlanSidePanel,
    onOpenSummarySideChatRow,
    onOpenSummaryBrowserRow,
    onOpenSummaryScheduledAutomation,
    onOpenSummaryOutputInSidePanel,
    onOpenSummaryGitReview,
    onOpenProcessManager,
    onOpenBackgroundTerminalOutput,
    onToggleSummaryComputerUsePip,
    onConsumeNewThreadComposerIntent,
    onRequestRenameThread,
    onArchiveThread,
    onToggleThreadPin,
    session.id,
    session.projectId,
    changeNewThreadEnvironment,
    refreshNewThreadEnvironments,
    effectiveProjectId,
    selectedCollaborationMode,
    onMaterializeProjectDraft,
    summary?.threadId,
  ]);

  const connectedStageProps = {
    projectId: effectiveProjectId,
    sessionId: session.id,
    threadPinned: session.pinned ?? false,
    threadActionShortcuts,
    projectWorkspacePath: summary
      ? projectWorkspaceRootOrNull(project)
      : projectWorkspaceRootOrNull(selectedNewThreadProject),
    isNewThreadTab: !summary,
    newThreadTarget: summary
      ? null
      : {
          projectId: effectiveProjectId,
          projectName: selectedNewThreadProject?.name ?? "No project",
          sessionId: session.id,
          ...(projectDraftId ? { projectDraftId } : {}),
          threadTitle: "New thread",
          runInTarget: selectedNewThreadRunInTarget,
          runInEnvironmentPath: selectedNewThreadEnvironmentPath,
          worktreeStartMode,
          worktreeBranchPrefix,
        },
    newThreadProjectSelector: summary
      ? null
      : {
          projects: projectSelectorOptions,
          selectedProjectId: effectiveProjectId,
          disabled: Boolean(projectDraftId),
          canAddProject: !projectDraftId,
        },
    newThreadStartInSelector: startInSelectorModel,
    newThreadStartBlockedReason,
    newThreadComposerIntent: summary ? null : newThreadComposerIntent ?? null,
    threadStartProgress,
    activeThreadId: summary?.threadId ?? null,
    activeThreadSummary: summary,
    availableModels: codexControl.availableModels,
    agentProviderCatalog: codexControl.agentProviderCatalog,
    agentProviderCatalogLoading: codexControl.agentProviderCatalogLoading,
    selectedExecutionProfile: codexControl.executionProfile,
    collaborationModes,
    selectedCollaborationMode,
    selectedModel: codexControl.threadSettings.model ?? "",
    selectedReasoningEffort:
      codexControl.threadSettings.reasoningEffort ?? "medium",
    selectedPersonality: codexControl.personality,
    reasoningEffortOptions: codexControl.reasoningEffortOptions,
    permissionMode: codexControl.permissionMode,
    isQueueingEnabled: threadQueueFollowUpsEnabled,
    composerEnterBehavior,
    searchOpenTick,
    summarySideChatRows,
    summaryBrowserRows,
    summaryScheduledAutomation,
    summaryComputerUsePip,
    planSidePanelState,
    actions,
  } as const;

  if (composerDock) {
    return (
      <ConnectedThreadComposerDock
        {...connectedStageProps}
        routeActive={routeActive}
        visible={composerDock.visible}
        overlayTarget={composerDock.target}
        overlayVisibility={composerDock.visibility}
        leadingContent={composerDock.leadingContent}
        composerScopeIdentity={composerScopeIdentity}
      />
    );
  }

  return (
    <div className="h-full min-h-0">
      <ConnectedThreadStage
        {...connectedStageProps}
        summaryPanelMounted={summaryPanelMounted}
        summaryPanelOpen={summaryPanelOpen}
        summaryPanelHideImmediately={summaryPanelHideImmediately}
        summaryPanelContentShift={summaryPanelContentShift}
        rightPanelComposerOverlayEnabled={
          rightPanelComposerOverlayEnabled
        }
        rightPanelComposerOverlayCompact={
          rightPanelComposerOverlayCompact
        }
        rightPanelComposerOverlayTarget={
          rightPanelComposerOverlayTarget
        }
        rightPanelComposerOverlayVisibility={
          rightPanelComposerOverlayVisibility
        }
        turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
        routeActive={routeActive}
        threadBodyVisible={threadBodyVisible}
        presentation={presentation}
        onForkFromTurnIntoWorktree={
          canForkCurrentThreadIntoWorktree
            ? onForkFromTurnIntoWorktree
            : undefined
        }
      />
    </div>
  );
}

type ConnectedSessionThreadProps = Parameters<typeof ConnectedSessionThread>[0];

export function SessionThreadPage(
  props: Omit<ConnectedSessionThreadProps, "composerDock" | "composerScopeIdentity" | "projectDraftId" | "onMaterializeProjectDraft">,
) {
  return <ConnectedSessionThread {...props} />;
}

export function SessionThreadComposerDock(
  props: ConnectedSessionThreadProps & {
    readonly composerDock: NonNullable<ConnectedSessionThreadProps["composerDock"]>;
  },
) {
  return <ConnectedSessionThread {...props} />;
}

export function ProjectSessionThreadComposerDock({
  session,
  project,
  projects,
  composerDock,
  composerScopeIdentity,
  browserUseViewScopeId,
  newThreadStartBlockedReason,
  projectDraftId = null,
  onMaterializeProjectDraft,
  onRefreshProjectSessions,
  onEnsureBlankSessionForProject,
  onOpenPendingWorktree,
  onOpenLocalEnvironmentsSettings,
  onOpenHooksSettings,
  threadQueueFollowUpsEnabled,
  composerEnterBehavior,
  onQueueingEnabledChange,
  onOpenThread,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  onForkSessionFromTurn,
  worktreeStartMode,
  worktreeBranchPrefix,
  commandKeymapState,
  isMac,
}: {
  readonly session: WorkbenchSessionRenderProjection;
  readonly project: Project;
  readonly projects: Project[];
  readonly composerDock: NonNullable<ConnectedSessionThreadProps["composerDock"]>;
  readonly composerScopeIdentity: string;
  readonly browserUseViewScopeId: string;
  readonly newThreadStartBlockedReason?: string | null;
  readonly projectDraftId?: string | null;
  readonly onMaterializeProjectDraft?: ThreadActionControllerInput["onMaterializeProjectDraft"];
  readonly onRefreshProjectSessions: ConnectedSessionThreadProps["onRefreshProjectSessions"];
  readonly onEnsureBlankSessionForProject: ConnectedSessionThreadProps["onEnsureBlankSessionForProject"];
  readonly onOpenPendingWorktree: ConnectedSessionThreadProps["onOpenPendingWorktree"];
  readonly onOpenLocalEnvironmentsSettings: ConnectedSessionThreadProps["onOpenLocalEnvironmentsSettings"];
  readonly onOpenHooksSettings: ConnectedSessionThreadProps["onOpenHooksSettings"];
  readonly threadQueueFollowUpsEnabled: boolean;
  readonly composerEnterBehavior: ComposerEnterBehavior;
  readonly onQueueingEnabledChange: ConnectedSessionThreadProps["onQueueingEnabledChange"];
  readonly onOpenThread: ConnectedSessionThreadProps["onOpenThread"];
  readonly onOpenTurnDiffReview?: ConnectedSessionThreadProps["onOpenTurnDiffReview"];
  readonly onOpenTurnDiffFileInSidePanel?: ConnectedSessionThreadProps["onOpenTurnDiffFileInSidePanel"];
  readonly onForkSessionFromTurn?: ConnectedSessionThreadProps["onForkSessionFromTurn"];
  readonly worktreeStartMode: WorktreeStartMode;
  readonly worktreeBranchPrefix: string;
  readonly commandKeymapState?: CommandKeymapState | null;
  readonly isMac: boolean;
}) {
  const noOp = () => undefined;
  const noOpAsync = async () => undefined;

  return (
    <ConnectedSessionThread
      session={session}
      project={project}
      projects={projects}
      routeActive
      threadBodyVisible={false}
      onRefreshProjectSessions={onRefreshProjectSessions}
      onEnsureBlankSessionForProject={onEnsureBlankSessionForProject}
      onOpenPendingWorktree={onOpenPendingWorktree}
      onRequestProjectPickerOpen={noOp}
      onOpenLocalEnvironmentsSettings={onOpenLocalEnvironmentsSettings}
      onOpenHooksSettings={onOpenHooksSettings}
      threadQueueFollowUpsEnabled={threadQueueFollowUpsEnabled}
      composerEnterBehavior={composerEnterBehavior}
      onQueueingEnabledChange={onQueueingEnabledChange}
      onOpenThread={onOpenThread}
      onOpenSubagentsPanel={undefined}
      onOpenTurnDiffReview={onOpenTurnDiffReview}
      onOpenTurnDiffFileInSidePanel={onOpenTurnDiffFileInSidePanel}
      onOpenSummaryGitReview={undefined}
      turnDiffHoverPreviewDisabled
      onForkSessionFromTurn={onForkSessionFromTurn}
      onForkFromTurnIntoWorktree={noOpAsync}
      worktreeStartMode={worktreeStartMode}
      worktreeBranchPrefix={worktreeBranchPrefix}
      searchOpenTick={0}
      summaryPanelMounted={false}
      summaryPanelOpen={false}
      summaryPanelHideImmediately={false}
      summaryPanelContentShift={0}
      summarySideChatRows={[]}
      summaryBrowserRows={[]}
      summaryScheduledAutomation={null}
      summaryComputerUsePip={null}
      onOpenSummarySideChatRow={noOp}
      onOpenSummaryBrowserRow={noOp}
      onOpenSummaryScheduledAutomation={noOp}
      onOpenSummaryOutputInSidePanel={() => false}
      onToggleSummaryComputerUsePip={noOp}
      rightPanelComposerOverlayEnabled={false}
      rightPanelComposerOverlayCompact={false}
      rightPanelComposerOverlayTarget={null}
      onOpenMcpAppSidePanel={undefined}
      onOpenPlanInSidePanel={undefined}
      onClosePlanSidePanel={undefined}
      planSidePanelState={null}
      onRequestRenameThread={undefined}
      onArchiveThread={noOpAsync}
      onToggleThreadPin={noOpAsync}
      commandKeymapState={commandKeymapState}
      isMac={isMac}
      presentation="panel"
      composerDock={composerDock}
      composerScopeIdentity={composerScopeIdentity}
      browserUseViewScopeId={browserUseViewScopeId}
      newThreadStartBlockedReason={newThreadStartBlockedReason}
      projectDraftId={projectDraftId}
      onMaterializeProjectDraft={onMaterializeProjectDraft}
    />
  );
}
