import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ConnectedThreadStage,
  useCodexAppServerControl,
  useCodexThreadStartProgress,
  type ThreadActionControllerInput,
  type ThreadStageActions,
} from "@/features/local-conversation";
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
import { invoke } from "@/lib/api";
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
import {
  readLocalEnvironmentSelections,
  resolveLocalEnvironmentOptionSelection,
  writeLocalEnvironmentSelection,
} from "./local-environment-selection";
import { projectSessionThreadLinkToSummary } from "./thread-summary-projection";

export function SessionThreadPage({
  session,
  project,
  projects,
  routeActive,
  threadBodyVisible,
  onRefreshProjectSessions,
  onEnsureBlankSessionForProject,
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
  rightPanelComposerOverlayAtDocumentBottom,
  rightPanelComposerOverlayDocumentBottomKey,
  rightPanelComposerOverlayTarget,
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
  onOpenSubagentsPanel: NonNullable<
    ThreadStageActions["onOpenSubagentsPanel"]
  >;
  onOpenTurnDiffReview: ThreadStageActions["onOpenTurnDiffReview"];
  onOpenTurnDiffFileInSidePanel: NonNullable<
    ThreadStageActions["onOpenTurnDiffFileInSidePanel"]
  >;
  onOpenSummaryGitReview: NonNullable<
    ThreadStageActions["onOpenSummaryGitReview"]
  >;
  turnDiffHoverPreviewDisabled: boolean;
  onForkSessionFromTurn: NonNullable<
    ThreadActionControllerInput["onForkSessionFromTurn"]
  >;
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
  rightPanelComposerOverlayAtDocumentBottom: boolean;
  rightPanelComposerOverlayDocumentBottomKey: string | null;
  rightPanelComposerOverlayTarget: HTMLElement | null;
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
}) {
  const summary = session.thread
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
  const threadStartProgress = useCodexThreadStartProgress(
    effectiveProjectId,
    session.id,
  );
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
    void invoke("git:branch:state", cwd)
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
      codexControl,
      onEnsureBlankSessionForProject,
      onRefreshProjectSessions,
      onOpenPendingWorktree,
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
    }),
    ...(onConsumeNewThreadComposerIntent
      ? { onConsumeNewThreadComposerIntent }
      : {}),
  }), [
    codexControl,
    onEnsureBlankSessionForProject,
    onRefreshProjectSessions,
    onOpenPendingWorktree,
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
    session.projectId,
    changeNewThreadEnvironment,
    refreshNewThreadEnvironments,
    effectiveProjectId,
    selectedCollaborationMode,
    summary?.threadId,
  ]);

  return (
    <div className="h-full min-h-0">
      <ConnectedThreadStage
        projectId={effectiveProjectId}
        sessionId={session.id}
        threadPinned={session.pinned ?? false}
        threadActionShortcuts={threadActionShortcuts}
        projectWorkspacePath={summary
          ? projectWorkspaceRootOrNull(project)
          : projectWorkspaceRootOrNull(selectedNewThreadProject)}
        isNewThreadTab={!summary}
        newThreadTarget={summary
          ? null
          : {
              projectId: effectiveProjectId,
              projectName: selectedNewThreadProject?.name ?? "No project",
              sessionId: session.id,
              threadTitle: "New thread",
              runInTarget: selectedNewThreadRunInTarget,
              runInEnvironmentPath: selectedNewThreadEnvironmentPath,
              worktreeStartMode,
              worktreeBranchPrefix,
            }}
        newThreadProjectSelector={summary
          ? null
          : {
              projects: projectSelectorOptions,
              selectedProjectId: effectiveProjectId,
              disabled: false,
              canAddProject: true,
            }}
        newThreadStartInSelector={startInSelectorModel}
        newThreadComposerIntent={
          summary ? null : newThreadComposerIntent ?? null
        }
        threadStartProgress={threadStartProgress}
        activeThreadId={summary?.threadId ?? null}
        activeThreadSummary={summary}
        availableModels={codexControl.availableModels}
        agentProviderCatalog={codexControl.agentProviderCatalog}
        agentProviderCatalogLoading={
          codexControl.agentProviderCatalogLoading
        }
        selectedExecutionProfile={codexControl.executionProfile}
        collaborationModes={collaborationModes}
        selectedCollaborationMode={selectedCollaborationMode}
        selectedModel={codexControl.threadSettings.model ?? ""}
        selectedReasoningEffort={
          codexControl.threadSettings.reasoningEffort ?? "medium"
        }
        selectedPersonality={codexControl.personality}
        reasoningEffortOptions={codexControl.reasoningEffortOptions}
        permissionMode={codexControl.permissionMode}
        isQueueingEnabled={threadQueueFollowUpsEnabled}
        composerEnterBehavior={composerEnterBehavior}
        searchOpenTick={searchOpenTick}
        summaryPanelMounted={summaryPanelMounted}
        summaryPanelOpen={summaryPanelOpen}
        summaryPanelHideImmediately={summaryPanelHideImmediately}
        summaryPanelContentShift={summaryPanelContentShift}
        summarySideChatRows={summarySideChatRows}
        summaryBrowserRows={summaryBrowserRows}
        summaryScheduledAutomation={summaryScheduledAutomation}
        summaryComputerUsePip={summaryComputerUsePip}
        planSidePanelState={planSidePanelState}
        rightPanelComposerOverlayEnabled={
          rightPanelComposerOverlayEnabled
        }
        rightPanelComposerOverlayCompact={
          rightPanelComposerOverlayCompact
        }
        rightPanelComposerOverlayAtDocumentBottom={
          rightPanelComposerOverlayAtDocumentBottom
        }
        rightPanelComposerOverlayDocumentBottomKey={
          rightPanelComposerOverlayDocumentBottomKey
        }
        rightPanelComposerOverlayTarget={
          rightPanelComposerOverlayTarget
        }
        turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
        routeActive={routeActive}
        threadBodyVisible={threadBodyVisible}
        actions={actions}
        onForkFromTurnIntoWorktree={
          canForkCurrentThreadIntoWorktree
            ? onForkFromTurnIntoWorktree
            : undefined
        }
      />
    </div>
  );
}
