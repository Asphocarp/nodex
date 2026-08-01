import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useMotionValue, useReducedMotion, useTransform, type MotionStyle } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { PanelTabPresentationRegistry } from "./panel-tab-presentation-registry";
import {
  WorkbenchSidebar,
  type WorkbenchSidebarBodyProps,
} from "./workbench-sidebar";
import {
  WorkbenchEmptyRoute,
  WorkbenchRouteHost,
} from "./workbench-route-host";
import { WorkbenchAutomationDetailRail } from "./workbench-automation-detail-rail";
import { WorkbenchThreadSummaryHeader } from "./workbench-thread-summary-header";
import {
  ToolbarIconButton,
  WindowNavigationToolbarButton,
} from "./workbench-panel-controls";
import {
  PageStageSessionTab,
  type OpenPageTabHandler,
  type PageStageHistoryModalContext,
} from "./workbench-page-stage-panel";
import {
  HeaderAction,
  HeaderActionProvider,
  HeaderInlineActionRail,
  HeaderShellSlot,
} from "./workbench-header-actions";
import { HistoryPanel } from "./workbench-history-panel";
import {
  terminalSessionStore,
  useTerminalSessionStoreVersion,
} from "@/lib/terminal-session-store";
import { BrowserSidebarHiddenWebviewHosts } from "@/features/browser-sidebar/browser-sidebar-hidden-webview-hosts";
import { BrowserSidebarPanel } from "@/features/browser-sidebar/browser-sidebar-panel";
import {
  WorkspaceFilesPanel,
  type WorkspaceFilesTab,
} from "@/features/workspace-files";
import {
  workspaceTextDocumentRegistry,
} from "@/features/workspace-files/workspace-text-document-controller";
import { DesktopNotificationController } from "@/features/local-conversation/desktop-notification-controller";
import {
  getBrowserDocumentBottomKey,
  useBrowserDocumentBottom,
} from "@/features/browser-sidebar/browser-document-bottom-store";
import {
  ContentSearchProvider,
  type ContentSearchOpenRequest,
} from "@/features/content-search/content-search-context";
import { ContentSearchSurface } from "@/features/content-search/content-search-surface";
import { buildSettingsPath } from "./workbench-settings-routes";
import type { BrowserSettingsDestination } from "@/features/browser-sidebar/browser-settings-pages";
import {
  buildCodexHooksSettingsPath,
  type CodexHooksSettingsTarget,
} from "@/lib/codex-hooks-route";
import { buildAutomationsPath } from "./workbench-automations-routes";
import type { LibraryRouteTarget } from "../../../shared/library-module";
import type { LibraryResourceTarget } from "../library/library-resource-actions";
import { WorkbenchProcessManagerDialog } from "./workbench-process-manager-dialog";
import {
  ProjectAgentDockLeadingRow,
  ProjectAgentDockUnavailableOverlay,
} from "./project-agent-dock";
import type { OpenPageStageOptions } from "@/components/kanban/open-page-stage";
import { NodexTooltip, NodexTooltipProvider } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { appScope, useScopeHandle } from "@/lib/maitai";
import { openModal } from "@/lib/modal-registry";
import {
  useCodexAppServerControl,
  ConnectedReviewDiffPanel,
  useConversationSubset,
  useLocalConversationAccount,
  useLocalConversationConnection,
} from "@/features/local-conversation";
import {
  APP_SHELL_GLOBAL_HEADER_LAYER_CLASS,
} from "@/lib/app-shell-layers";
import {
  invoke,
  subscribeCodexPendingWorktreesChanged,
  subscribeCodexPendingWorktreeWarnings,
} from "@/lib/api";
import { useCodexScheduledAutomations } from "@/lib/use-codex-scheduled-automations";
import { useKanban } from "@/lib/use-kanban";
import {
  createPageStageTabTitleStore,
} from "@/lib/page-stage-tab-title-store";
import { cn } from "@/lib/utils";
import {
  type SidebarCollapsibleSectionId,
  type SidebarCollapsibleSectionsState,
} from "@/lib/sidebar-section-prefs";
import { useWorkbenchSidebarState } from "@/lib/use-workbench-sidebar-state";
import {
  makePageEditorSessionKey,
  pageEditorSessionRegistry,
} from "@/lib/page-editor-session-registry";
import {
  canvasSceneSurfaceRegistry,
  makeCanvasSceneSurfaceKey,
} from "@/lib/canvas-scene-surface-runtime";
import type { WorkbenchCommandPort } from "@/lib/use-workbench-command-ingress";
import {
  APP_SHELL_ROUTE_THREAD_SCOPE_DESCRIPTOR,
  SelectedAppShellHeaderContent,
  WorkbenchSessionScopePath,
  createThreadScopeIdentityRegistry,
  resolvePendingThreadScopeDescriptor,
  resolveProjectDraftThreadScopeDescriptor,
  resolveProjectSessionThreadScopeDescriptor,
} from "@/lib/workbench-ui-scopes";
import {
  applyForkBrowserTransferToWorkbenchScene,
  makeWorkbenchSceneKey,
  materializeInitialWorkbenchScene,
  type WorkbenchSceneOwner,
  type WorkbenchSceneSnapshot,
  type WorkbenchSurfaceDescriptor,
} from "../../../shared/workbench-scene";
import {
  findWorkbenchPanelLeafForTab,
  listWorkbenchPanelLeaves,
} from "../../../shared/workbench-panel-layout";
import {
  applyWorkbenchSurfacePatch,
  presentWorkbenchSessionDomainWithScene,
  workbenchSurfaceFromCreateInput,
  type WorkbenchSurfaceUpdatePatch,
} from "@/lib/workbench-scene-presentation";
import {
  projectSessionProjectionsByProject,
  useWorkbenchSessionCatalog,
} from "@/lib/use-workbench-session-catalog";
import {
  createWorkbenchSceneNavigator,
  type PresentWorkbenchPanelSurfaceInput,
  type WorkbenchSurfaceOpenRequest,
} from "@/lib/workbench-scene-navigator";
import {
  projectDetailQueryOptions,
  projectSessionDetailQueryOptions,
} from "@/lib/query-options";
import { useWorkbenchPanelController } from "@/lib/use-workbench-panel-controller";
import { useWorkbenchPanelLifecycle } from "@/lib/use-workbench-panel-lifecycle";
import {
  useWorkbenchPanelOpeners,
  type OpenCanvasStageHandler,
} from "@/lib/use-workbench-panel-openers";
import { useWorkbenchPanelCommandRouter } from "@/lib/use-workbench-panel-command-router";
import { useWorkbenchSessionCommands } from "@/lib/use-workbench-session-commands";
import {
  useWorkbenchPanelProjection,
  type PanelGroupTabsByPanel,
} from "./use-workbench-panel-projection";
import { useWorkbenchSidebarController } from "./use-workbench-sidebar-controller";
import { useWorkbenchSidebarChrome } from "./use-workbench-sidebar-chrome";
import { WorkbenchSessionScene } from "./workbench-session-scene";
import { ProjectSessionThreadComposerDock } from "./workbench-session-thread-route";
import { WorkbenchSceneFrame } from "./workbench-scene-frame";
import { DbViewSessionTab } from "./workbench-db-view-panel";
import { WorkbenchCanvasStagePanel } from "./workbench-canvas-stage-panel";
import { TerminalPanel } from "./workbench-terminal-panel";
import { buildWorkbenchScenePanels } from "./workbench-scene-panels";
import { useWorkbenchRouteSurfaces } from "./use-workbench-route-surfaces";
import { WorkbenchCommandPaletteHost } from "./workbench-command-palette-host";
import { useWorkbenchChromeLayout } from "./use-workbench-chrome-layout";
import {
  AUTOMATION_DETAIL_RAIL_DEFAULT_WIDTH,
  clampAutomationDetailRailWidth,
  useWorkbenchChromeCommands,
} from "@/lib/use-workbench-chrome-commands";
import {
  useWorkbenchThreadSummary,
  type WorkbenchThreadSummaryCommands,
} from "@/lib/use-workbench-thread-summary";
import {
  presentWorkbenchSession,
  type WorkbenchSessionRenderProjection,
} from "@/lib/workbench-session-presentation";
import {
  projectSessionToSummary,
} from "@/lib/project-session-query-cache";
import {
  buildProjectAgentDockPendingWorktreeModel,
  buildProjectAgentDockModel,
  resolveProjectAgentDockPendingWorktree,
  type ProjectAgentDockTargetRow,
} from "@/lib/project-agent-dock-model";
import {
  createProjectAgentDockDraftSession,
  createProjectAgentDockMaterializer,
} from "@/lib/project-agent-dock-controller";
import type { CodexPendingWorktreeEntry } from "../../../shared/codex-pending-worktree";
import { useBrowserUsePresentationCoordinator } from "@/lib/use-browser-use-presentation-coordinator";
import { useWorkbenchPreferences } from "./use-workbench-preferences";
import {
  useWorkbenchWindowState,
} from "@/lib/use-workbench-window-state";
import {
  getWorkbenchSceneReturnLocation,
  type WorkbenchLayoutSnapshotV5,
  type WorkbenchLibraryLocationTarget as WorkbenchLibraryRoute,
} from "../../../shared/workbench-layout";
import type {
  CodexComposerIntent,
  PanelId,
  Project,
  ProjectCreateInput,
  ProjectLifecycleMutationResult,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
  ProjectUpdateInput,
  ProjectSession as ProjectSessionDomain,
  WorkbenchTabProjection,
  WorkbenchTabCreateInput,
} from "@/lib/types";

type ProjectSession = WorkbenchSessionRenderProjection;

import {
  type DbViewPrefs,
  type SupportedDbView,
} from "@/lib/db-view-prefs";
import {
  type RecentPageSession,
  type WorkbenchView,
} from "@/lib/use-workbench-profile-preferences";
import type { PageStageSessionSnapshot } from "@/components/kanban/page-stage/types";
import {
  CODEX_SIDEBAR_FLOATING_HEADER_CLASS,
  getCodexSidebarFloatingOuterClassName,
  getCodexSidebarFloatingTransition,
} from "@/lib/codex-sidebar-auto-reveal";
import {
  useSyncedMotionValue,
} from "@/lib/resize-observer-motion-values";
import {
  CodexCloseIcon,
  CodexExpandPanelIcon,
  CodexPanelBottomHiddenIcon,
  CodexPanelBottomVisibleIcon,
  CodexPanelRightHiddenIcon,
  CodexPanelRightVisibleIcon,
  CodexRestorePanelIcon,
  CodexSidebarHiddenIcon,
  CodexSidebarVisibleIcon,
} from "@/components/shared/icons";
import {
  SIDEBAR_COLLAPSED_CHROME_BUTTON_CLASS,
  SidebarCompactNewChatButton,
} from "./sidebar-new-chat-controls";
import { useCodexAccountActions } from "@/lib/use-codex-account-actions";
import {
  filterAvailablePanelActions,
  PANEL_NEW_TAB_ACTIONS,
} from "@/lib/workbench-panel-actions";
import {
  readPageStagePanelTabPageRef,
} from "@/lib/workbench-panel-placement";
import {
  isRootThreadRightPanelComposerOverlayEligibleTab,
} from "@/lib/workbench-panel-tab-model";
import {
  buildSessionPanelRenderModel,
  collectMountedBrowserTabIds,
} from "@/lib/workbench-panel-projection";
import {
  makeWorkbenchPanelSlotKey,
} from "@/lib/workbench-panel-slot-key";
import {
  panelTabCycleRequestDirectionToOffset,
} from "@/lib/workbench-panel-tab-cycle";
import {
  type PanelTabCycleScope,
} from "@/lib/workbench-panel-shortcut-scope";
import {
  projectWorkspaceRootOrNull,
} from "@/lib/workbench-workspace-context";
import {
  buildStableWorktreeCreateInput,
  listStableWorktrees,
  type StableWorktreeEntry,
} from "./stable-worktree-production";
import {
  StableWorktreeStatusDialog,
  type StableWorktreeStatusDialogTransport,
} from "./stable-worktree-status-dialog";
import {
  buildCancelledPendingWorktreeComposerIntent,
  resolveCancelledPendingWorktreeProjectId,
} from "./pending-worktree-cancel-recovery";
import { useSidebarThreadSyncModel } from "@/lib/use-sidebar-thread-sync-model";
import {
  resolveWorkbenchNavigationShortcutLabel,
  WORKBENCH_NAVIGATION_COMMANDS,
  type WorkbenchNavigationCommandState,
} from "../../../shared/window-navigation";
import {
  TOGGLE_BOTTOM_PANEL_COMMAND_ID,
  type WorkbenchCommandInvocation,
} from "../../../shared/workbench-commands";
import {
  type CommandKeymapState,
} from "../../../shared/command-keybindings";
import type {
  CommandMenuMode,
} from "@/lib/command-palette";
import type {
  CodexBackgroundTerminalProcessThreadRef,
} from "@/lib/codex-background-terminal-processes";
import { primaryCanvasBlockId } from "../../../shared/block-documents";

const RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX = 70;
const RIGHT_PANEL_HEADER_FALLBACK_RAIL_WIDTH_PX = 62;

function createProjectAgentDockDraftId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const ELECTRON_STABLE_WORKTREE_STATUS_TRANSPORT: StableWorktreeStatusDialogTransport = {
  list: () => invoke("codex:pending-worktrees:list"),
  subscribe: subscribeCodexPendingWorktreesChanged,
  clearAttention: (hostId, pendingWorktreeId) =>
    invoke("codex:pending-worktree:clear-attention", hostId, pendingWorktreeId),
  cancel: (hostId, pendingWorktreeId) =>
    invoke("codex:pending-worktree:cancel", hostId, pendingWorktreeId),
  autoFix: (hostId, pendingWorktreeId, agentMode) =>
    invoke("codex:pending-worktree:auto-fix", hostId, pendingWorktreeId, agentMode),
  retry: (hostId, pendingWorktreeId) =>
    invoke("codex:pending-worktree:retry", hostId, pendingWorktreeId),
};
export interface WorkbenchRuntimeProps {
  windowSessionId: string;
  initialWindowLayoutSnapshot: WorkbenchLayoutSnapshotV5;
  libraryWorkspaceEnabled: boolean;
  projects: Project[];
  hasMoreProjects?: boolean;
  loadingMoreProjects?: boolean;
  onLoadMoreProjects?: () => Promise<void>;
  projectCatalogError?: string | null;
  onRetryProjects?: () => Promise<void> | void;
  onSceneMutation?: (
    owner: WorkbenchSceneOwner,
    previous: WorkbenchSceneSnapshot,
    next: WorkbenchSceneSnapshot,
  ) => void;
  activeView: WorkbenchView;
  activeDbViewPrefs: DbViewPrefs | null;
  dbViewPrefsByProject: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  sidebar?: {
    collapsed: boolean;
    width: number;
    collapsibleSections?: SidebarCollapsibleSectionsState;
  };
  pageStageCloseRef: React.RefObject<(() => Promise<void>) | null>;
  pageStagePersistRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  pageStageSessionSnapshotRef?: React.MutableRefObject<PageStageSessionSnapshot | null>;
  pendingReminderOpen?: {
    projectId: string;
    pageId: string;
    occurrenceStart: string;
  } | null;
  pendingPageDeepLinkOpen?: {
    projectId: string;
    pageId: string;
  } | null;
  pendingViewDeepLinkOpen?: {
    projectId: string;
    viewId: string;
  } | null;
  onPageDeepLinkHandled?: (payload: {
    projectId: string;
    pageId: string;
  }) => void;
  onViewDeepLinkHandled?: (payload: {
    projectId: string;
    viewId: string;
  }) => void;
  pendingSessionOpen?: {
    projectId: string | null;
    sessionId: string;
  } | null;
  setSearchQuery?: (projectId: string, value: string) => void;
  setDbViewPrefs: (
    projectId: string,
    view: SupportedDbView,
    update: (prev: DbViewPrefs) => DbViewPrefs,
  ) => void;
  openPageStage: (
    projectId: string,
    pageId: string,
    titleSnapshot?: string,
    options?: OpenPageStageOptions,
  ) => void;
  onReminderHandled?: (payload: {
    projectId: string;
    pageId: string;
    occurrenceStart: string;
  }) => void;
  onOpenProjectSessionInNewWindow?: (session: ProjectSession) => Promise<void>;
  onLeavePageStage: (snapshot: PageStageSessionSnapshot) => void;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onArchiveProject: (projectId: string) => Promise<ProjectLifecycleMutationResult>;
  onReorderProjects: (input: ProjectOrderInput) => Promise<void>;
  onSetProjectPinned: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onSetPinnedProjectOrder: (input: ProjectPinnedOrderInput) => Promise<void>;
  onRequestProjectPickerOpen: () => void;
  threadSearchOpenTick: number;
  contentSearchOpenRequest?: ContentSearchOpenRequest | null;
  setSidebarCollapsed?: (collapsed: boolean) => void;
  setSidebarWidth?: (width: number) => void;
  setSidebarCollapsibleSectionCollapsed?: (sectionId: SidebarCollapsibleSectionId, collapsed: boolean) => void;
  recentPageSessions?: RecentPageSession[];
  projectPickerOpenTick?: number;
  taskSearchOpenTick?: number;
  onNavigationStateChange?: (state: WorkbenchNavigationCommandState) => void;
  onRegisterCommandPort?: (port: WorkbenchCommandPort) => () => void;
  commandKeymapState?: CommandKeymapState | null;
}

export function WorkbenchRuntime({
  windowSessionId,
  initialWindowLayoutSnapshot,
  libraryWorkspaceEnabled,
  projects,
  hasMoreProjects = false,
  loadingMoreProjects = false,
  onLoadMoreProjects,
  projectCatalogError = null,
  onRetryProjects,
  onSceneMutation,
  activeView,
  activeDbViewPrefs,
  dbViewPrefsByProject,
  recentPageSessions = [],
  sidebar,
  pageStageCloseRef,
  pageStagePersistRef,
  pageStageSessionSnapshotRef,
  pendingReminderOpen,
  pendingPageDeepLinkOpen,
  pendingViewDeepLinkOpen,
  onPageDeepLinkHandled,
  onViewDeepLinkHandled,
  pendingSessionOpen,
  setSearchQuery: observeSearchQueryMutation,
  setDbViewPrefs,
  openPageStage,
  onReminderHandled,
  onOpenProjectSessionInNewWindow,
  onLeavePageStage,
  onCreateProject,
  onUpdateProject,
  onArchiveProject,
  onReorderProjects,
  onSetProjectPinned,
  onSetPinnedProjectOrder,
  onRequestProjectPickerOpen,
  projectPickerOpenTick = 0,
  taskSearchOpenTick = 0,
  threadSearchOpenTick,
  contentSearchOpenRequest = null,
  setSidebarCollapsed,
  setSidebarWidth,
  setSidebarCollapsibleSectionCollapsed,
  onNavigationStateChange,
  onRegisterCommandPort,
  commandKeymapState,
}: WorkbenchRuntimeProps) {
  const queryClient = useQueryClient();
  const appHandle = useScopeHandle(appScope);
  const workbenchWindow = useWorkbenchWindowState(
    initialWindowLayoutSnapshot,
  );
  const sceneLocation = getWorkbenchSceneReturnLocation(
    workbenchWindow.location,
  );
  const activeProjectId = sceneLocation.kind === "project"
    ? sceneLocation.projectId
    : sceneLocation.kind === "session"
      ? sceneLocation.projectContextId
      : null;
  const activeSessionId =
    sceneLocation.kind === "session" ? sceneLocation.sessionId : null;
  const searchByProject = workbenchWindow.databaseSearchByProject;
  const activeSearchQuery = activeProjectId
    ? searchByProject[activeProjectId] ?? ""
    : "";
  const setSearchQuery = useCallback((
    projectId: string,
    value: string,
  ) => {
    workbenchWindow.setDatabaseSearch(projectId, value);
    observeSearchQueryMutation?.(projectId, value);
  }, [observeSearchQueryMutation, workbenchWindow]);
  const settingsPath =
    workbenchWindow.location.kind === "settings"
      ? workbenchWindow.location.path
      : null;
  const automationsPath =
    workbenchWindow.location.kind === "automations"
      ? workbenchWindow.location.path
      : null;
  const libraryRoute =
    workbenchWindow.location.kind === "library"
      ? workbenchWindow.location.target
      : null;
  const pendingWorktreeClientThreadId =
    workbenchWindow.location.kind === "pending-worktree"
      ? workbenchWindow.location.clientThreadId
      : null;
  const setSettingsPath = useCallback((
    update:
      | string
      | null
      | ((current: string | null) => string | null),
  ) => {
    const next = typeof update === "function"
      ? update(settingsPath)
      : update;
    if (next === null) {
      if (workbenchWindow.location.kind === "settings") {
        workbenchWindow.closeRoute();
      }
      return;
    }
    if (workbenchWindow.location.kind === "settings") {
      workbenchWindow.navigate({
        ...workbenchWindow.location,
        path: next,
      }, { record: false });
      return;
    }
    workbenchWindow.openRoute({ kind: "settings", path: next });
  }, [settingsPath, workbenchWindow]);
  const setAutomationsPath = useCallback((path: string | null) => {
    if (path === null) {
      if (workbenchWindow.location.kind === "automations") {
        workbenchWindow.closeRoute();
      }
      return;
    }
    if (workbenchWindow.location.kind === "automations") {
      workbenchWindow.navigate({
        ...workbenchWindow.location,
        path,
      }, { record: false });
      return;
    }
    workbenchWindow.openRoute({ kind: "automations", path });
  }, [workbenchWindow]);
  const setLibraryRoute = useCallback((
    target: WorkbenchLibraryRoute | null,
  ) => {
    if (target === null) {
      if (workbenchWindow.location.kind === "library") {
        workbenchWindow.closeRoute();
      }
      return;
    }
    if (workbenchWindow.location.kind === "library") {
      workbenchWindow.navigate({
        ...workbenchWindow.location,
        target,
      }, { record: false });
      return;
    }
    workbenchWindow.openRoute({ kind: "library", target });
  }, [workbenchWindow]);
  const setPendingWorktreeClientThreadId = useCallback((
    clientThreadId: string | null,
  ) => {
    if (clientThreadId === null) {
      if (workbenchWindow.location.kind === "pending-worktree") {
        workbenchWindow.closeRoute();
      }
      return;
    }
    if (workbenchWindow.location.kind === "pending-worktree") {
      workbenchWindow.navigate({
        ...workbenchWindow.location,
        clientThreadId,
      }, { record: false });
      return;
    }
    workbenchWindow.openRoute({
      kind: "pending-worktree",
      clientThreadId,
    });
  }, [workbenchWindow]);
  const sidebarState = useWorkbenchSidebarState({
    projects,
    activeProjectId,
    collapsibleSections: sidebar?.collapsibleSections,
    setCollapsibleSectionCollapsed: setSidebarCollapsibleSectionCollapsed,
  });
  const {
    expandedProjectIds,
    toggleProjectExpanded,
    contextMenuSessionId,
    togglePinnedSection: togglePinnedProjectsSectionCollapsed,
    toggleLibrarySection: toggleLibrarySectionCollapsed,
    toggleProjectsSection: toggleProjectsSectionCollapsed,
    toggleChatsSection: toggleChatsSectionCollapsed,
  } = sidebarState;
  const sessionCatalog = useWorkbenchSessionCatalog({
    projects,
    expandedProjectIds,
    window: workbenchWindow,
  });
  const selectedProjectSceneId = sceneLocation.kind === "project"
    ? sceneLocation.projectId
    : null;
  const selectedProjectQuery = useQuery({
    ...projectDetailQueryOptions(selectedProjectSceneId ?? ""),
    enabled: selectedProjectSceneId !== null,
  });
  useEffect(() => {
    if (
      !selectedProjectSceneId
      || !selectedProjectQuery.isSuccess
      || selectedProjectQuery.data !== null
    ) {
      return;
    }
    workbenchWindow.removeScene({
      kind: "project",
      projectId: selectedProjectSceneId,
    });
    workbenchWindow.selectProject(null);
  }, [
    selectedProjectQuery.data,
    selectedProjectQuery.isSuccess,
    selectedProjectSceneId,
    workbenchWindow,
  ]);
  const projectSceneOwner = useMemo(() => selectedProjectSceneId
    ? { kind: "project" as const, projectId: selectedProjectSceneId }
    : null, [selectedProjectSceneId]);
  const projectSceneKey = projectSceneOwner
    ? makeWorkbenchSceneKey(projectSceneOwner)
    : null;
  const activeProjectScene = projectSceneOwner && projectSceneKey
    ? workbenchWindow.scenesByOwnerKey[projectSceneKey]
      ?? materializeInitialWorkbenchScene(projectSceneOwner)
    : null;
  useEffect(() => {
    if (!projectSceneOwner || !projectSceneKey || !activeProjectScene) return;
    if (workbenchWindow.scenesByOwnerKey[projectSceneKey]) return;
    workbenchWindow.setScene(projectSceneOwner, activeProjectScene);
  }, [
    activeProjectScene,
    projectSceneKey,
    projectSceneOwner,
    workbenchWindow,
  ]);
  const projectAgentDockBoundSessionId =
    activeProjectScene?.agentDock?.binding.kind === "session"
      ? activeProjectScene.agentDock.binding.sessionId
      : null;
  const projectAgentDockSessionQuery = useQuery({
    ...projectSessionDetailQueryOptions(
      projectAgentDockBoundSessionId ?? "",
    ),
    enabled: projectAgentDockBoundSessionId !== null,
  });
  const sessionCollectionsByProject = sessionCatalog.collectionsByProject;
  const projectlessSessionCollection = sessionCatalog.projectlessCollection;
  const sessionsByProject = useMemo<Record<string, ProjectSession[]>>(
    () => projectSessionProjectionsByProject(sessionCollectionsByProject),
    [sessionCollectionsByProject],
  );
  const projectlessSessions = useMemo(
    () => [...projectlessSessionCollection.projections],
    [projectlessSessionCollection.projections],
  );
  const selectedSessionDetailReady = sessionCatalog.selectedDetailReady;
  const selectedSessionDetailError = sessionCatalog.selectedDetailError;
  const loadMoreProjectSessionSummaries = sessionCatalog.loadMore;
  const resolveSessionScene = sessionCatalog.resolveScene;
  const resolveProjectDefaultDatabaseViewId =
    sessionCatalog.resolveDefaultDatabaseViewId;
  const mutateScene = useCallback((
    owner: WorkbenchSceneOwner,
    mutation: (scene: WorkbenchSceneSnapshot) => WorkbenchSceneSnapshot,
  ): WorkbenchSceneSnapshot => {
    let next = materializeInitialWorkbenchScene(owner);
    workbenchWindow.setScene(owner, (stored) => {
      const previous = stored ?? materializeInitialWorkbenchScene(owner);
      next = mutation(previous);
      onSceneMutation?.(owner, previous, next);
      return next;
    });
    return next;
  }, [onSceneMutation, workbenchWindow]);
  const panelController = useWorkbenchPanelController({
    mutateScene,
  });
  const panelControllerRef = useRef(panelController);
  panelControllerRef.current = panelController;
  const workbenchWindowRef = useRef(workbenchWindow);
  workbenchWindowRef.current = workbenchWindow;
  const sessionCatalogRef = useRef(sessionCatalog);
  sessionCatalogRef.current = sessionCatalog;
  const sceneNavigator = useMemo(() => createWorkbenchSceneNavigator({
    setScene(owner, update) {
      workbenchWindowRef.current.setScene(owner, update);
    },
    selectOwner(owner, projectContextId) {
      if (owner.kind === "project") {
        workbenchWindowRef.current.selectProject(owner.projectId);
        return;
      }
      workbenchWindowRef.current.selectSession({
        id: owner.sessionId,
        projectId: projectContextId ?? null,
      });
    },
  }), []);
  const {
    previewTabsByPanel,
    sideChatTabsBySession,
    sideChatActiveTabByPanel,
    mcpAppTabsBySession,
    mcpAppActiveTabByPanel,
    planTabsBySession,
    planActiveTabByPanel,
    automationTabsBySession,
    automationActiveTabByPanel,
    backgroundAgentTabsBySession,
    backgroundAgentActiveTabByPanel,
    processOutputTabsBySession,
    processOutputActiveTabByPanel,
    activePlanKeyBySession,
    panelCollapsedOverrides,
  } = panelController;
  const [pageStageTabTitleStore] = useState(createPageStageTabTitleStore);
  const [panelTabPresentationRegistry] = useState(
    () => new PanelTabPresentationRegistry(),
  );
  const panelTabPresentationControllerKeysRef = useRef(new Set<string>());
  const [headerLeftWidth, setHeaderLeftWidth] = useState(0);
  const [, setHeaderLeftRailWidth] = useState(0);
  const [headerRightWidth, setHeaderRightWidth] = useState(RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX);
  const [, setHeaderRightRailWidth] = useState(RIGHT_PANEL_HEADER_FALLBACK_RAIL_WIDTH_PX);
  const [automationsDetailRailOpen, setAutomationsDetailRailOpen] = useState(false);
  const automationsDetailRailRequestedWidth = useMotionValue(AUTOMATION_DETAIL_RAIL_DEFAULT_WIDTH);
  const [threadScopeIdentityRegistry] = useState(createThreadScopeIdentityRegistry);
  const [projectAgentDockMaterializer] = useState(
    createProjectAgentDockMaterializer,
  );
  const [projectAgentDockQuery, setProjectAgentDockQuery] = useState("");
  const [automationsDetailRailPortalElement, setAutomationsDetailRailPortalElement] = useState<HTMLDivElement | null>(null);
  const [rightPanelComposerOverlayTarget, setRightPanelComposerOverlayTarget] = useState<HTMLElement | null>(null);
  const terminalSessionVersion = useTerminalSessionStoreVersion();
  const {
    threadSummaryPanelPinnedOpen,
    toggleThreadSummaryPanelPinnedOpen,
    threadQueueFollowUpsEnabled,
    handleThreadQueueFollowUpsEnabledChange,
    composerEnterBehavior,
    handleComposerEnterBehaviorChange,
    worktreeStartMode,
    handleWorktreeStartModeChange,
    worktreeAutoBranchPrefix,
    handleWorktreeAutoBranchPrefixChange,
    smartPrefixParsingEnabled,
    handleSmartPrefixParsingEnabledChange,
    stripSmartPrefixFromTitleEnabled,
    handleStripSmartPrefixFromTitleEnabledChange,
  } = useWorkbenchPreferences();
  useEffect(() => () => {
    panelTabPresentationRegistry.dispose();
  }, [panelTabPresentationRegistry]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteOpenRequest, setCommandPaletteOpenRequest] = useState({
    tick: 0,
    mode: "root" as CommandMenuMode,
    initialQuery: "",
  });
  const [commandContentSearchOpenRequest, setCommandContentSearchOpenRequest] =
    useState<ContentSearchOpenRequest | null>(null);
  const workbenchRootRef = useRef<HTMLDivElement | null>(null);
  const pinningPreviewTabIdsRef = useRef<Set<string>>(new Set());
  const focusedPanelGroupRef = useRef<PanelTabCycleScope | null>(null);
  const panelGroupTabsRef = useRef<PanelGroupTabsByPanel>({
    right: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
    bottom: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
  });
  const panelTabMruByLeafRef = useRef<Record<string, string[]>>({});
  const openCanvasStageRef = useRef<OpenCanvasStageHandler | null>(null);
  const openProjectCanvasStageRef = useRef<OpenCanvasStageHandler | null>(null);
  const pendingWorkbenchCommandInvocationsRef = useRef<
    WorkbenchCommandInvocation[]
  >([]);
  const shellAtMediumWidthRef = useRef(false);
  const shellAtNarrowWidthRef = useRef(false);
  const pinnedProjectsSectionCollapsed = sidebarState.sections.pinned;
  const librarySectionCollapsed = sidebarState.sections.library;
  const projectsSectionCollapsed = sidebarState.sections.projects;
  const chatsSectionCollapsed = sidebarState.sections.chats;
  const [pendingWorktrees, setPendingWorktrees] = useState<CodexPendingWorktreeEntry[]>([]);
  const [pendingStableWorktrees, setPendingStableWorktrees] = useState<StableWorktreeEntry[]>([]);
  const [reopenStableWorktreeAfterSettingsId, setReopenStableWorktreeAfterSettingsId] =
    useState<string | null>(null);
  const [reopenPendingWorktreeAfterSettingsClientThreadId, setReopenPendingWorktreeAfterSettingsClientThreadId] =
    useState<string | null>(null);
  const closePendingWorktreeRoute = useCallback(() => {
    setPendingWorktreeClientThreadId(null);
  }, [setPendingWorktreeClientThreadId]);
  useEffect(() => {
    let disposed = false;
    let receivedSubscription = false;
    const applyEntries = (entries: readonly CodexPendingWorktreeEntry[]) => {
      if (disposed) return;
      setPendingWorktrees([...entries]);
      setPendingStableWorktrees(listStableWorktrees(entries));
    };
    const unsubscribe = subscribeCodexPendingWorktreesChanged((entries) => {
      receivedSubscription = true;
      applyEntries(entries);
    });
    void invoke("codex:pending-worktrees:list")
      .then((entries) => {
        if (receivedSubscription) return;
        applyEntries(entries);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  useEffect(() => subscribeCodexPendingWorktreeWarnings((event) => {
    toast.danger(event.message);
  }), []);
  const [localEnvironmentSettingsInitial, setLocalEnvironmentSettingsInitial] = useState<{
    projectId: string | null;
    configPath: string | null;
  } | null>(null);
  const [newThreadComposerIntentsBySessionId, setNewThreadComposerIntentsBySessionId] =
    useState<Record<string, CodexComposerIntent>>({});
  const [processManagerOpen, setProcessManagerOpen] = useState(false);
  const codexAccount = useLocalConversationAccount();
  const codexConnection = useLocalConversationConnection();
  const codexAccountActions = useCodexAccountActions();
  const reducedMotion = useReducedMotion();
  const sidebarChrome = useWorkbenchSidebarChrome({
    persistedCollapsed: sidebar?.collapsed,
    persistedWidth: sidebar?.width,
    reducedMotion,
    workbenchRootRef,
    onCollapsedChange: setSidebarCollapsed,
    onWidthChange: setSidebarWidth,
  });
  const {
    applySidebarWidth,
    floatingSidebarResizing,
    floatingSidebarVisible,
    getWindowZoom,
    motion: realSidebarMotion,
    setFloatingSidebarFocusActive,
    setFloatingSidebarHoverSurfaceActive,
    setFloatingSidebarResizing,
    setSidebarCollapsed: setSidebarCollapsedWithCodexState,
    setSidebarClickInFlight,
    setSidebarHoverSuppressed,
    setSidebarTriggerHovered,
    showRealSidebarFromFloatingPanel,
    sidebarAnimating,
    sidebarClickInFlight,
    sidebarLogicalCollapsed,
    sidebarOpen,
    sidebarWidth,
    toggleSidebarCollapsed,
  } = sidebarChrome;

  const activeProject = selectedProjectSceneId
    ? selectedProjectQuery.isSuccess
      ? selectedProjectQuery.data
      : projects.find((project) => project.id === selectedProjectSceneId)
        ?? null
    : sessionCatalog.activeProject;
  const projectAgentDockCollection = selectedProjectSceneId
    ? sessionCollectionsByProject[selectedProjectSceneId] ?? null
    : null;
  const projectAgentDockExactSession =
    projectAgentDockSessionQuery.data?.projectId === selectedProjectSceneId
    && !projectAgentDockSessionQuery.data.archived
      ? projectAgentDockSessionQuery.data
      : null;
  const projectAgentDockPendingWorktree = useMemo(
    () => resolveProjectAgentDockPendingWorktree(
      pendingWorktrees,
      projectAgentDockBoundSessionId,
      Boolean(projectAgentDockExactSession?.thread),
    ),
    [
      pendingWorktrees,
      projectAgentDockBoundSessionId,
      projectAgentDockExactSession?.thread,
    ],
  );
  const projectAgentDockPendingWorktreeModel = useMemo(
    () => projectAgentDockPendingWorktree
      ? buildProjectAgentDockPendingWorktreeModel(
          projectAgentDockPendingWorktree,
        )
      : null,
    [projectAgentDockPendingWorktree],
  );
  const projectAgentDockModel = useMemo(() => {
    if (
      !selectedProjectSceneId
      || !activeProjectScene?.agentDock
      || !projectAgentDockCollection
    ) {
      return null;
    }
    return buildProjectAgentDockModel({
      projectId: selectedProjectSceneId,
      dock: activeProjectScene.agentDock,
      summaries: projectAgentDockCollection.presentations.map(
        (presentation) => projectSessionToSummary(presentation.domain),
      ),
      exactSelectedSession: projectAgentDockExactSession
        ? projectSessionToSummary(projectAgentDockExactSession)
        : null,
      collectionState: projectAgentDockCollection.state,
      hasMore: projectAgentDockCollection.hasMore,
      query: projectAgentDockQuery,
    });
  }, [
    activeProjectScene?.agentDock,
    projectAgentDockCollection,
    projectAgentDockExactSession,
    projectAgentDockQuery,
    selectedProjectSceneId,
  ]);
  const projectAgentDockSession = useMemo(() => {
    if (!activeProjectScene?.agentDock || !selectedProjectSceneId) return null;
    if (activeProjectScene.agentDock.binding.kind === "new") {
      const domain = createProjectAgentDockDraftSession(
        selectedProjectSceneId,
        activeProjectScene.agentDock.newDraftId,
      );
      return presentWorkbenchSession({
        domain,
        scene: materializeInitialWorkbenchScene({
          kind: "session",
          sessionId: domain.id,
        }),
      });
    }
    if (!projectAgentDockExactSession) return null;
    return presentWorkbenchSession({
      domain: projectAgentDockExactSession,
      scene: resolveSessionScene(projectAgentDockExactSession),
    });
  }, [
    activeProjectScene?.agentDock,
    projectAgentDockExactSession,
    resolveSessionScene,
    selectedProjectSceneId,
  ]);
  const projectAgentDockThreadScope = useMemo(() => {
    if (!activeProjectScene?.agentDock) return null;
    if (activeProjectScene.agentDock.binding.kind === "new") {
      return resolveProjectDraftThreadScopeDescriptor(
        threadScopeIdentityRegistry,
        activeProjectScene.agentDock.newDraftId,
      );
    }
    if (!projectAgentDockExactSession) return null;
    return resolveProjectSessionThreadScopeDescriptor(
      threadScopeIdentityRegistry,
      projectAgentDockExactSession,
      projectAgentDockPendingWorktree?.clientThreadId ?? null,
    );
  }, [
    activeProjectScene?.agentDock,
    projectAgentDockExactSession,
    projectAgentDockPendingWorktree?.clientThreadId,
    threadScopeIdentityRegistry,
  ]);
  const updateProjectAgentDock = useCallback((
    projectId: string,
    update: (
      dock: NonNullable<WorkbenchSceneSnapshot["agentDock"]>,
    ) => NonNullable<WorkbenchSceneSnapshot["agentDock"]>,
  ) => {
    const owner = { kind: "project", projectId } as const;
    workbenchWindow.setScene(owner, (stored) => {
      const scene = stored ?? materializeInitialWorkbenchScene(owner);
      if (!scene.agentDock) return scene;
      return {
        ...scene,
        agentDock: update(scene.agentDock),
      };
    }, { recordHistory: false });
  }, [workbenchWindow]);
  const setProjectAgentDockVisible = useCallback((visible: boolean) => {
    if (!selectedProjectSceneId) return;
    updateProjectAgentDock(selectedProjectSceneId, (dock) =>
      dock.visible === visible ? dock : { ...dock, visible }
    );
  }, [selectedProjectSceneId, updateProjectAgentDock]);
  const selectProjectAgentDockTarget = useCallback((
    row: ProjectAgentDockTargetRow,
  ) => {
    if (!selectedProjectSceneId) return;
    updateProjectAgentDock(selectedProjectSceneId, (dock) => ({
      ...dock,
      binding: row.kind === "new"
        ? { kind: "new" }
        : { kind: "session", sessionId: row.sessionId! },
    }));
  }, [selectedProjectSceneId, updateProjectAgentDock]);
  const materializeProjectAgentDockDraft = useCallback(async (input: {
    readonly projectId: string;
    readonly draftId: string;
  }): Promise<ProjectSessionDomain> => projectAgentDockMaterializer.materialize(
    input,
    {
      createBlank: async (projectId) => (
        await sessionCatalogRef.current.createBlank(projectId)
      ).domain,
      promoteDraftIdentity: ({ draftId, sessionId }) => {
        threadScopeIdentityRegistry.register(`draft:${draftId}`, {
          draftId,
          projectSessionId: sessionId,
        });
      },
      commitMaterializedSession: ({ projectId, draftId, sessionId }) => {
        const owner = { kind: "project", projectId } as const;
        workbenchWindowRef.current.setScene(owner, (stored) => {
          const scene = stored ?? materializeInitialWorkbenchScene(owner);
          const dock = scene.agentDock;
          if (!dock || dock.newDraftId !== draftId) return scene;
          return {
            ...scene,
            agentDock: {
              ...dock,
              newDraftId: createProjectAgentDockDraftId(),
              binding: dock.binding.kind === "new"
                ? { kind: "session", sessionId }
                : dock.binding,
            },
          };
        }, { recordHistory: false });
      },
    },
  ), [projectAgentDockMaterializer, threadScopeIdentityRegistry]);
  useEffect(() => {
    if (!selectedProjectSceneId || !projectAgentDockBoundSessionId) return;
    if (!projectAgentDockSessionQuery.isSuccess) return;
    if (projectAgentDockExactSession) return;
    updateProjectAgentDock(selectedProjectSceneId, (dock) => ({
      ...dock,
      binding: { kind: "new" },
    }));
  }, [
    projectAgentDockBoundSessionId,
    projectAgentDockExactSession,
    projectAgentDockSessionQuery.isSuccess,
    selectedProjectSceneId,
    updateProjectAgentDock,
  ]);
  useEffect(() => {
    setProjectAgentDockQuery("");
  }, [selectedProjectSceneId]);
  const activeSessions = useMemo(
    () => activeProject ? sessionsByProject[activeProject.id] ?? [] : [],
    [activeProject, sessionsByProject],
  );
  const activeSession = sessionCatalog.activeProjection;
  const createSessionViewTab = useCallback((
    input: WorkbenchTabCreateInput,
  ): WorkbenchTabProjection | null => {
    if (!activeSession || input.sessionId !== activeSession.id) return null;
    const tab = workbenchSurfaceFromCreateInput(input);
    const next = panelControllerRef.current.durable.createTab(
      activeSession,
      {
        panelId: input.panelId,
        targetLeafId: input.targetLeafId,
        tab,
      },
    );
    return presentWorkbenchSessionDomainWithScene(
      activeSession,
      next,
    ).tabs
      .find((candidate) => candidate.id === tab.id) ?? null;
  }, [activeSession]);
  const updateSessionViewTab = useCallback((
    tabId: string,
    patch: WorkbenchSurfaceUpdatePatch,
  ): WorkbenchTabProjection | null => {
    if (!activeSession) return null;
    const current = resolveSessionScene(activeSession);
    const surface = current.panelSurfacesById[tabId];
    if (!surface) return null;
    const nextSurface = applyWorkbenchSurfacePatch(surface, patch);
    const next = panelControllerRef.current.durable.updateTab(
      activeSession,
      tabId,
      nextSurface,
    );
    return presentWorkbenchSessionDomainWithScene(
      activeSession,
      next,
    ).tabs
      .find((candidate) => candidate.id === tabId) ?? null;
  }, [activeSession, resolveSessionScene]);
  const activeRenderSession = activeSession;
  const forkTransferTargetConversationId = activeRenderSession?.thread?.threadId ?? null;
  const forkTransferTargetSessionId = activeRenderSession?.id ?? null;
  const consumedForkTransferTargetsRef = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (!forkTransferTargetConversationId || !forkTransferTargetSessionId) return;
    const targetKey = `${forkTransferTargetConversationId}\0${forkTransferTargetSessionId}`;
    if (consumedForkTransferTargetsRef.current.has(targetKey)) return;
    consumedForkTransferTargetsRef.current.add(targetKey);
    void invoke("codex:fork-side-panel-transfer:consume", {
      routeKind: "local-thread",
      targetConversationId: forkTransferTargetConversationId,
      targetProjectSessionId: forkTransferTargetSessionId,
      targetBrowserViewScopeId: windowSessionId,
    }).then((snapshot) => {
      if (!snapshot || !activeRenderSession) return;
      panelControllerRef.current.durable.apply(
        activeRenderSession,
        (scene) => applyForkBrowserTransferToWorkbenchScene(scene, snapshot),
      );
    }).catch(() => {
      consumedForkTransferTargetsRef.current.delete(targetKey);
    });
  }, [
    activeRenderSession,
    forkTransferTargetConversationId,
    forkTransferTargetSessionId,
    windowSessionId,
  ]);
  const scheduledAutomationsQuery = useCodexScheduledAutomations();
  const {
    applySnapshot: applySidebarThreadSnapshot,
    model: sidebarThreadModel,
    refresh: refreshSidebarThreadSnapshot,
    reorderPinned: reorderPinnedSidebarThreads,
    setPinned: setSidebarThreadPinned,
  } = useSidebarThreadSyncModel({
    projects,
  });
  const sidebarArchivePendingKeys = sidebarState.archivePendingKeys;
  const knownSessions = useMemo(
    () => [...Object.values(sessionsByProject).flat(), ...projectlessSessions],
    [projectlessSessions, sessionsByProject],
  );
  const processManagerThreads = useMemo<CodexBackgroundTerminalProcessThreadRef[]>(() => {
    const seen = new Set<string>();
    const refs: CodexBackgroundTerminalProcessThreadRef[] = [];
    for (const session of knownSessions) {
      const threadId = session.thread?.threadId;
      if (!threadId || seen.has(threadId)) {
        continue;
      }
      seen.add(threadId);
      refs.push({
        threadId,
        title: session.displayTitle || threadId,
      });
    }
    return refs;
  }, [knownSessions]);
  const processManagerThreadIds = useMemo(
    () => processManagerThreads.map((thread) => thread.threadId),
    [processManagerThreads],
  );
  const processManagerConversationsById = useConversationSubset(processManagerThreadIds);
  const workbenchCodexControl = useCodexAppServerControl(activeProject?.id ?? activeProjectId);
  const activeProjectKanban = useKanban({
    projectId: activeProject?.id ?? activeProjectId ?? "",
    enabled: Boolean(activeProject?.id ?? activeProjectId),
    sessionId: activeSession ? `${activeSession.id}:right-panel-actions` : "right-panel-actions",
  });
  const [pageStageHistoryModal, setPageStageHistoryModal] = useState<PageStageHistoryModalContext | null>(null);
  const activeSessionPanelModel = useMemo(() => activeRenderSession ? buildSessionPanelRenderModel({
    session: activeRenderSession,
    previewTabsByPanel,
    sideChatTabsBySession,
    sideChatActiveTabByPanel,
    mcpAppTabsBySession,
    mcpAppActiveTabByPanel,
    planTabsBySession,
    planActiveTabByPanel,
    automationTabsBySession,
    automationActiveTabByPanel,
    backgroundAgentTabsBySession,
    backgroundAgentActiveTabByPanel,
    processOutputTabsBySession,
    processOutputActiveTabByPanel,
    panelCollapsedOverrides,
    activePlanKeyBySession,
  }) : null, [
    activePlanKeyBySession,
    activeRenderSession,
    automationActiveTabByPanel,
    automationTabsBySession,
    backgroundAgentActiveTabByPanel,
    backgroundAgentTabsBySession,
    mcpAppActiveTabByPanel,
    mcpAppTabsBySession,
    panelCollapsedOverrides,
    planActiveTabByPanel,
    planTabsBySession,
    previewTabsByPanel,
    processOutputActiveTabByPanel,
    processOutputTabsBySession,
    sideChatActiveTabByPanel,
    sideChatTabsBySession,
  ]);
  const activePanelOwnerKey = projectSceneKey
    ?? (activeSession
      ? makeWorkbenchSceneKey({
          kind: "session",
          sessionId: activeSession.id,
        })
      : null);
  const rightPanel = activeProjectScene?.panels.right
    ?? activeSessionPanelModel?.rightPanel
    ?? null;
  const bottomPanel = activeProjectScene?.panels.bottom
    ?? activeSessionPanelModel?.bottomPanel
    ?? null;
  const rightPanelCollapsed = rightPanel && activePanelOwnerKey
    ? panelCollapsedOverrides[
        makeWorkbenchPanelSlotKey(activePanelOwnerKey, "right")
      ] ?? rightPanel.collapsed
    : true;
  const bottomPanelCollapsed = bottomPanel && activePanelOwnerKey
    ? panelCollapsedOverrides[
        makeWorkbenchPanelSlotKey(activePanelOwnerKey, "bottom")
      ] ?? bottomPanel.collapsed
    : true;
  const sidePanelOpen = !rightPanelCollapsed;
  const bottomPanelOpen = !bottomPanelCollapsed;
  useEffect(() => {
    setPageStageHistoryModal((current) => {
      if (!current) return current;
      if (!activeSession || activeSession.id !== current.sessionId) return null;

      const ownerTab = activeSession.tabs.find((tab) => tab.id === current.tabId);
      const pageRef = readPageStagePanelTabPageRef(ownerTab);
      if (!pageRef) return null;
      if (pageRef.projectId !== current.projectId || pageRef.pageId !== current.pageId) return null;

      return current;
    });
  }, [activeSession]);
  const closePageStageHistoryModal = useCallback(() => {
    setPageStageHistoryModal(null);
  }, []);
  const togglePageStageHistoryModal = useCallback((context: PageStageHistoryModalContext) => {
    setPageStageHistoryModal((current) => {
      if (
        current
        && current.sessionId === context.sessionId
        && current.tabId === context.tabId
        && current.projectId === context.projectId
        && current.pageId === context.pageId
      ) {
        return null;
      }
      return context;
    });
  }, []);
  const pageStageHistoryModalProject = useMemo(
    () => pageStageHistoryModal
      ? projects.find((project) => project.id === pageStageHistoryModal.projectId) ?? null
      : null,
    [pageStageHistoryModal, projects],
  );
  const pageStageHistoryPanelProjectId = pageStageHistoryModal?.projectId ?? activeProject?.id ?? null;
  const rightPanelFullWidth = sidePanelOpen
    && (rightPanel?.size.fullWidth ?? false);
  const rightActiveRenderableTab = activeSessionPanelModel?.rightActiveRenderableTab ?? null;
  const rightPanelComposerOverlayEnabled = Boolean(
    activeSession?.thread
    && sidePanelOpen
    && rightPanelFullWidth
    && rightPanelComposerOverlayTarget
    && isRootThreadRightPanelComposerOverlayEligibleTab(rightActiveRenderableTab),
  );
  const rightPanelComposerOverlayCompact =
    rightPanelComposerOverlayEnabled
    && rightActiveRenderableTab !== null
    && "kind" in rightActiveRenderableTab
    && rightActiveRenderableTab.kind === "browser";
  const rightPanelComposerOverlayBrowserTabId =
    rightPanelComposerOverlayCompact && rightActiveRenderableTab
      ? rightActiveRenderableTab.id
      : null;
  const rightPanelComposerOverlayBrowserIdentity =
    rightPanelComposerOverlayBrowserTabId && activeSession
      ? {
          browserConversationId: activeSession.id,
          browserViewScopeId: windowSessionId,
          browserTabId: rightPanelComposerOverlayBrowserTabId,
        }
      : null;
  const rightPanelComposerOverlayAtDocumentBottom =
    useBrowserDocumentBottom(rightPanelComposerOverlayBrowserIdentity);
  const rightPanelComposerOverlayDocumentBottomKey =
    getBrowserDocumentBottomKey(rightPanelComposerOverlayBrowserIdentity);
  const shellCanNavigateBack = workbenchWindow.canNavigateBack;
  const shellCanNavigateForward = workbenchWindow.canNavigateForward;
  const isMacPlatform =
    typeof navigator !== "undefined"
    && navigator.platform.toUpperCase().includes("MAC");
  const {
    appShellHeaderEdgeScroll,
    appShellMainContentFrameBorderVisible,
    appShellMainContentLayout,
    bottomPanelAnimatedHeightCss,
    bottomPanelHeight,
    bottomPanelMotion,
    bottomPanelRequestedHeight,
    effectiveHeaderLeftWidth,
    headerLeftFallbackRailWidth,
    headerLeftFallbackWidth,
    headerLeftShellSlotMinWidth,
    headerLeftShellSlotWidth,
    realSidebarMounted,
    regularRightPanelWidth,
    rightHeaderShellSlotWidth,
    rightPanelMotion,
    rightPanelRequestedWidth,
    rightPanelTargetWidth,
    safeHeaderLeftWidth,
    shellBodySize,
    shellMainContentWidth,
    shellWidthClass,
    threadSummaryPanelLayoutMode,
  } = useWorkbenchChromeLayout({
    activeSessionId: activeSession?.id ?? null,
    automationsRouteOpen: Boolean(automationsPath),
    bottomPanelOpen,
    bottomPanelRequestedHeight:
      bottomPanel?.size.heightPx ?? null,
    headerLeftWidth,
    isMacPlatform,
    reducedMotion,
    rightPanelFullWidth,
    rightPanelOpen: sidePanelOpen,
    rightPanelRequestedWidth: rightPanel?.size.widthPx ?? null,
    rootRef: workbenchRootRef,
    sidebarLogicalCollapsed,
    sidebarMotion: realSidebarMotion,
    sidebarOpen,
  });
  useEffect(() => {
    onNavigationStateChange?.({
      canNavigateBack: shellCanNavigateBack,
      canNavigateForward: shellCanNavigateForward,
    });
  }, [onNavigationStateChange, shellCanNavigateBack, shellCanNavigateForward]);

  useEffect(() => {
    if (!pendingWorktreeClientThreadId) return;
    setSettingsPath(null);
    setLocalEnvironmentSettingsInitial(null);
    setAutomationsPath(null);
  }, [pendingWorktreeClientThreadId, setAutomationsPath, setSettingsPath]);

  const handleCodexAccountLogout = useCallback(async () => {
    await codexAccountActions.logout();
  }, [codexAccountActions]);
  const handleCodexAccountErrorMessage = useCallback((message: string | null) => {
    if (!message) return;
    toast.danger(message);
  }, []);
  useEffect(() => {
    if (!activePanelOwnerKey || !rightPanel || !bottomPanel) {
      panelControllerRef.current.updatePanelCollapsedOverrides((current) => Object.keys(current).length === 0 ? current : {});
      return;
    }

    const rightKey = makeWorkbenchPanelSlotKey(activePanelOwnerKey, "right");
    const bottomKey = makeWorkbenchPanelSlotKey(activePanelOwnerKey, "bottom");
    panelControllerRef.current.updatePanelCollapsedOverrides((current) => {
      const rightMatches = current[rightKey] === rightPanel.collapsed;
      const bottomMatches = current[bottomKey] === bottomPanel.collapsed;
      if (!rightMatches && !bottomMatches) {
        return current;
      }

      const next = { ...current };
      if (rightMatches) delete next[rightKey];
      if (bottomMatches) delete next[bottomKey];
      return next;
    });
  }, [
    activePanelOwnerKey,
    bottomPanel,
    rightPanel,
  ]);

  const openSettings = useCallback(() => {
    closePendingWorktreeRoute();
    setAutomationsPath(null);
    setLibraryRoute(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setLocalEnvironmentSettingsInitial(null);
    setSettingsPath(buildSettingsPath("general-settings"));
  }, [closePendingWorktreeRoute, setAutomationsPath, setLibraryRoute, setSettingsPath]);

  const openBrowserSettings = useCallback((sectionId: BrowserSettingsDestination) => {
    closePendingWorktreeRoute();
    setAutomationsPath(null);
    setLibraryRoute(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setLocalEnvironmentSettingsInitial(null);
    setSettingsPath(buildSettingsPath(sectionId));
  }, [closePendingWorktreeRoute, setAutomationsPath, setLibraryRoute, setSettingsPath]);

  const openKeyboardShortcutsSettings = useCallback(() => {
    closePendingWorktreeRoute();
    setAutomationsPath(null);
    setLibraryRoute(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setLocalEnvironmentSettingsInitial(null);
    setSettingsPath(buildSettingsPath("keyboard-shortcuts"));
  }, [closePendingWorktreeRoute, setAutomationsPath, setLibraryRoute, setSettingsPath]);

  const toggleSettings = useCallback(() => {
    setAutomationsPath(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setLocalEnvironmentSettingsInitial(null);
    setSettingsPath((current) =>
      current ? null : buildSettingsPath("general-settings"));
  }, [setAutomationsPath, setSettingsPath]);

  const openLocalEnvironmentsSettings = useCallback((input?: {
    projectId?: string | null;
    configPath?: string | null;
    reopenStableWorktreeId?: string | null;
    reopenPendingWorktreeClientThreadId?: string | null;
  }) => {
    closePendingWorktreeRoute();
    setAutomationsPath(null);
    setLibraryRoute(null);
    setReopenStableWorktreeAfterSettingsId(input?.reopenStableWorktreeId ?? null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(
      input?.reopenPendingWorktreeClientThreadId ?? null,
    );
    setLocalEnvironmentSettingsInitial({
      projectId: input?.projectId ?? null,
      configPath: input?.configPath ?? null,
    });
    setSettingsPath(buildSettingsPath("local-environments"));
  }, [closePendingWorktreeRoute, setAutomationsPath, setLibraryRoute, setSettingsPath]);

  const openStableWorktreeStatus = useCallback((pendingWorktreeId: string) => {
    openModal(appHandle, StableWorktreeStatusDialog, {
      pendingWorktreeId,
      agentMode: workbenchCodexControl.permissionMode,
      transport: ELECTRON_STABLE_WORKTREE_STATUS_TRANSPORT,
      onEditEnvironment: (entry) => {
        const sourceProject = projects.find((project) =>
          project.primaryWorkspaceRoot === entry.sourceWorkspaceRoot
          || project.sources.some((source) => source.root === entry.sourceWorkspaceRoot)
        ) ?? null;
        openLocalEnvironmentsSettings({
          projectId: sourceProject?.id ?? null,
          configPath: entry.localEnvironmentConfigPath ?? null,
          reopenStableWorktreeId: entry.id,
        });
      },
      onOpenPendingWorktree: (clientThreadId) => {
        setSettingsPath(null);
        setLocalEnvironmentSettingsInitial(null);
        setAutomationsPath(null);
        setPendingWorktreeClientThreadId(clientThreadId);
      },
      onActionError: (error) => {
        toast.danger(error instanceof Error ? error.message : "Worktree action failed");
      },
    });
  }, [appHandle, openLocalEnvironmentsSettings, projects, setAutomationsPath, setPendingWorktreeClientThreadId, setSettingsPath, workbenchCodexControl.permissionMode]);

  const createStableWorktree = useCallback(async (
    project: Project,
    projectName: string,
  ) => {
    const sourceWorkspaceRoot = project.primaryWorkspaceRoot?.trim();
    if (!sourceWorkspaceRoot) {
      throw new Error("This project has no source workspace root.");
    }
    const result = await invoke("codex:pending-worktree:create", buildStableWorktreeCreateInput({
      sourceWorkspaceRoot,
      label: projectName,
    }));
    openStableWorktreeStatus(result.pendingWorktreeId);
  }, [openStableWorktreeStatus]);

  const openHooksSettings = useCallback((target: CodexHooksSettingsTarget) => {
    closePendingWorktreeRoute();
    setAutomationsPath(null);
    setLibraryRoute(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setLocalEnvironmentSettingsInitial(null);
    setSettingsPath(buildCodexHooksSettingsPath(target));
  }, [closePendingWorktreeRoute, setAutomationsPath, setLibraryRoute, setSettingsPath]);

  const closeSettings = useCallback(() => {
    setSettingsPath(null);
    setLocalEnvironmentSettingsInitial(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    if (
      reopenStableWorktreeAfterSettingsId
      && pendingStableWorktrees.some((entry) => entry.id === reopenStableWorktreeAfterSettingsId)
    ) {
      openStableWorktreeStatus(reopenStableWorktreeAfterSettingsId);
      return;
    }
    if (
      reopenPendingWorktreeAfterSettingsClientThreadId
      && pendingWorktrees.some((entry) =>
        "clientThreadId" in entry
        && entry.clientThreadId === reopenPendingWorktreeAfterSettingsClientThreadId
      )
    ) {
      setPendingWorktreeClientThreadId(reopenPendingWorktreeAfterSettingsClientThreadId);
    }
  }, [openStableWorktreeStatus, pendingStableWorktrees, pendingWorktrees, reopenPendingWorktreeAfterSettingsClientThreadId, reopenStableWorktreeAfterSettingsId, setPendingWorktreeClientThreadId, setSettingsPath]);

  const openAutomations = useCallback((path = buildAutomationsPath()) => {
    closePendingWorktreeRoute();
    setSettingsPath(null);
    setLibraryRoute(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setAutomationsPath(path);
  }, [closePendingWorktreeRoute, setAutomationsPath, setLibraryRoute, setSettingsPath]);

  const navigateToLibraryRoute = useCallback((route: WorkbenchLibraryRoute) => {
    if (!libraryWorkspaceEnabled) return;
    closePendingWorktreeRoute();
    setSettingsPath(null);
    setAutomationsPath(null);
    setLibraryRoute(route);
  }, [closePendingWorktreeRoute, libraryWorkspaceEnabled, setAutomationsPath, setLibraryRoute, setSettingsPath]);

  const openLibrary = useCallback(() => {
    navigateToLibraryRoute({ kind: "home" });
  }, [navigateToLibraryRoute]);

  const openLibraryTarget = useCallback((target: LibraryRouteTarget) => {
    if (target.kind === "canvas") {
      const projectId = activeSession?.projectId ?? activeProjectId;
      if (!projectId) {
        navigateToLibraryRoute(target);
        return;
      }
      setLibraryRoute(null);
      if (activeSession?.projectId === projectId && openCanvasStageRef.current) {
        void openCanvasStageRef.current(projectId, target.canvasId, "Canvas");
        return;
      }
      workbenchWindow.selectProject(projectId);
      void openProjectCanvasStageRef.current?.(
        projectId,
        target.canvasId,
        "Canvas",
      );
      return;
    }
    navigateToLibraryRoute(target);
  }, [
    activeProjectId,
    activeSession?.projectId,
    navigateToLibraryRoute,
    setLibraryRoute,
    workbenchWindow,
  ]);

  const sidebarController = useWorkbenchSidebarController({
    projects,
    projectlessSessions,
    knownSessions,
    activeProject,
    activeSessionId,
    activeSessions,
    pendingSessionOpen,
    pendingWorktreeClientThreadId,
    windowSessionId,
    catalog: sessionCatalog,
    window: workbenchWindow,
    panelController,
    codexControl: workbenchCodexControl,
    sidebarState,
    sidebarSync: {
      applySnapshot: applySidebarThreadSnapshot,
      refresh: refreshSidebarThreadSnapshot,
      setPinned: setSidebarThreadPinned,
    },
    sidebarThreadModel,
    queryClient,
    appHandle,
    setSettingsPath,
    setAutomationsPath,
    setPendingWorktreeClientThreadId,
    setLocalEnvironmentSettingsInitial,
    closePendingWorktreeRoute,
    onOpenProjectSessionInNewWindow,
  });
  const {
    archiveSession,
    archiveSidebarThreadItem,
    archiveSidebarThreadItemQuiet,
    handlePendingWorktreeTitleDoubleClick,
    handleSessionTitleDoubleClick,
    markSidebarThreadItemRead,
    moveSidebarThreadForSidebar,
    openRenameSessionDialog,
    openSessionContextMenu,
    prefetchSidebarSession,
    refreshProjectSessions,
    reorderChatsThreadsForSidebar,
    reorderProjectThreadsForSidebar,
    resolveForkLocalEnvironmentConfigPath,
    selectProject,
    selectSession,
    selectSidebarThread,
    toggleSessionPin,
    toggleSidebarThreadPinned,
  } = sidebarController;

  useEffect(() => {
    if (
      activeProjectId !== null
      && !projects.some((project) => project.id === activeProjectId)
    ) {
      workbenchWindow.selectProject(null);
    }
  }, [activeProjectId, projects, workbenchWindow]);

  const panelLifecycle = useWorkbenchPanelLifecycle({
    activeSession,
    controller: panelController,
    createSessionViewTab,
    codexControl: workbenchCodexControl,
    panelGroupTabsRef,
    panelTabMruByLeafRef,
    pinningPreviewTabIdsRef,
    windowSessionId,
  });
  const {
    updateActivePanel,
    setActivePanelCollapsed,
    setActivePanelTab,
    pinPreviewTab,
    selectPanelTab,
    closePlanSidePanel,
  } = panelLifecycle;
  const updateActiveWorkbenchPanel = useCallback(async (
    panelId: PanelId,
    input: Partial<WorkbenchSceneSnapshot["panels"][PanelId]>,
  ) => {
    if (!projectSceneOwner) {
      return await updateActivePanel(panelId, input);
    }
    return panelControllerRef.current.sceneDurable?.patchPanel(
      projectSceneOwner,
      panelId,
      {
        ...(input.collapsed === undefined
          ? {}
          : { collapsed: input.collapsed }),
        ...(input.size === undefined ? {} : { size: input.size }),
      },
    ) ?? null;
  }, [projectSceneOwner, updateActivePanel]);
  const setActiveWorkbenchPanelCollapsed = useCallback(async (
    panelId: PanelId,
    collapsed: boolean,
  ) => {
    if (projectSceneOwner && panelId === "right" && collapsed) {
      return activeProjectScene?.panels.right ?? null;
    }
    if (!projectSceneOwner || !projectSceneKey) {
      return await setActivePanelCollapsed(panelId, collapsed);
    }
    const overrideKey = makeWorkbenchPanelSlotKey(projectSceneKey, panelId);
    panelControllerRef.current.updatePanelCollapsedOverrides((current) => ({
      ...current,
      [overrideKey]: collapsed,
    }));
    try {
      return await updateActiveWorkbenchPanel(panelId, { collapsed });
    } finally {
      panelControllerRef.current.updatePanelCollapsedOverrides((current) => {
        if (!(overrideKey in current)) return current;
        const next = { ...current };
        delete next[overrideKey];
        return next;
      });
    }
  }, [
    projectSceneKey,
    projectSceneOwner,
    activeProjectScene?.panels.right,
    setActivePanelCollapsed,
    updateActiveWorkbenchPanel,
  ]);
  const presentProjectSceneSurface = useCallback(async (
    projectId: string,
    request: WorkbenchSurfaceOpenRequest,
    options: {
      readonly panelId?: PanelId;
      readonly targetLeafId?: string;
      readonly placement?: PresentWorkbenchPanelSurfaceInput["target"]["placement"];
    } = {},
  ): Promise<boolean> => {
    const result = await sceneNavigator.presentPanelSurface({
      owner: { kind: "project", projectId },
      request,
      target: {
        panelId: options.panelId ?? "right",
        ...(options.targetLeafId
          ? { leafId: options.targetLeafId }
          : {}),
        ...(options.placement
          ? { placement: options.placement }
          : {}),
      },
      mode: "durable",
      navigation: "background",
    });
    return result.status === "presented";
  }, [sceneNavigator]);
  const openProjectScenePage = useCallback<OpenPageTabHandler>(async (
    projectId,
    pageId,
    titleSnapshot = "Page",
    options,
  ) => {
    await presentProjectSceneSurface(projectId, {
      kind: "page_stage",
      projectId,
      pageId,
      titleSnapshot,
    }, options?.sourceTabId
      ? {
          placement: {
            kind: "adjacent-right",
            sourceSurfaceId: options.sourceTabId,
          },
        }
      : {});
  }, [presentProjectSceneSurface]);
  const openProjectSceneCanvas: OpenCanvasStageHandler = useCallback(async (
    projectId,
    canvasBlockId,
    titleSnapshot = "Canvas",
    options,
  ) => await presentProjectSceneSurface(projectId, {
      kind: "canvas_stage",
      projectId,
      canvasBlockId,
      titleSnapshot,
    }, {
      panelId: options?.targetPanelId,
      targetLeafId: options?.targetLeafId,
    }), [presentProjectSceneSurface]);
  const openProjectSceneManualSurface = useCallback(async (
    projectId: string,
    kind: "browser" | "files" | "review" | "terminal",
    options: {
      readonly panelId: PanelId;
      readonly targetLeafId?: string;
      readonly path?: string;
      readonly url?: string;
    },
  ): Promise<boolean> => {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return false;
    const panelOptions = {
      panelId: options.panelId,
      targetLeafId: options.targetLeafId,
    };
    if (kind === "browser") {
      return await presentProjectSceneSurface(projectId, {
        kind,
        config: {
          ...(options.url ? { url: options.url } : {}),
        },
      }, panelOptions);
    }
    if (kind === "terminal") {
      return await presentProjectSceneSurface(projectId, {
        kind,
        config: {
          context: { kind: "project", projectId },
        },
      }, panelOptions);
    }
    if (kind === "review") {
      return await presentProjectSceneSurface(projectId, {
        kind,
        config: {
          projectId,
          context: { kind: "project", projectId },
        },
      }, panelOptions);
    }
    const workspaceRoot = projectWorkspaceRootOrNull(project);
    return await presentProjectSceneSurface(projectId, {
      kind,
      titleSnapshot: options.path?.split(/[\\/]/).pop() || "Files",
      config: {
        projectId,
        hostId: "local",
        workspaceRoot,
        cwd: workspaceRoot,
        ...(options.path ? { path: options.path } : {}),
      },
    }, panelOptions);
  }, [presentProjectSceneSurface, projects]);
  const browserUsePresentation =
    useBrowserUsePresentationCoordinator({
      activeSession,
      catalog: sessionCatalog,
      controller: panelController,
      createSessionViewTab,
      pinPreviewTab,
      setActivePanelCollapsed,
      setActivePanelTab,
      windowSessionId,
    });

  const panelOpeners = useWorkbenchPanelOpeners({
    activeProjectId,
    activeSession,
    controller: panelController,
    lifecycle: panelLifecycle,
    codexControl: workbenchCodexControl,
    projects,
    rightPanelFullWidth,
    createSessionViewTab,
    refreshProjectSessions,
    openPageStage,
    pendingPageDeepLinkOpen,
    onPageDeepLinkHandled,
  });
  const {
    openSideChat,
    openMcpAppSidePanel,
    openPlanSidePanel,
    openAutomationSidePanel,
    openCanvasStage,
  } = panelOpeners;
  openCanvasStageRef.current = openCanvasStage;
  openProjectCanvasStageRef.current = openProjectSceneCanvas;

  const sessionCommands = useWorkbenchSessionCommands({
    activeProject,
    activeProjectId,
    activeSession,
    projects,
    sessionsByProject,
    projectlessSessions,
    knownSessions,
    catalog: sessionCatalog,
    controller: panelController,
    lifecycle: panelLifecycle,
    panelOpeners,
    createSessionViewTab,
    codexControl: workbenchCodexControl,
    processManagerConversationsById,
    threadScopeIdentityRegistry,
    selectSession,
    archiveSession,
    toggleSessionPin,
    refreshProjectSessions,
    resolveForkLocalEnvironmentConfigPath,
    closePendingWorktreeRoute,
    setPendingWorktreeClientThreadId,
    setSettingsPath,
    setAutomationsPath,
    onOpenProjectSessionInNewWindow,
    windowSessionId,
    commandKeymapState,
    setCommandPaletteOpen,
    setCommandPaletteOpenRequest,
    setCommandContentSearchOpenRequest,
    setLocalEnvironmentSettingsInitial,
    setNewThreadComposerIntentsBySessionId,
    setProcessManagerOpen,
  });
  const {
    ensureBlankSessionForProject,
    startNewChatInProject,
    startNewChatWithPrompt,
    openScheduledAutomationChatCreate,
    startScheduledAutomationTemplateChat,
    openSidebarCommandPalette,
    openCommandPalette,
    requestContentSearchOpen,
    showSidebarUnavailableProduct,
    activateReviewTab,
    openSubagentsPanelTab,
    openAttachedThreadSession,
    openAttachedThreadSessionById,
    openResolvedPendingThreadSession,
    openAutomationHistoryThreadSessionById,
    openProcessOutputInCurrentSession,
    openProcessManagerOutput,
    openTurnDiffFileInSidePanel,
    openSummaryOutputInSidePanel,
    consumeNewThreadComposerIntent,
    forkSessionFromTurn,
    forkSessionFromTurnIntoWorktree,
  } = sessionCommands;
  const panelCommands = useWorkbenchPanelCommandRouter({
    activeSession,
    projects,
    windowSessionId,
    isMacPlatform,
    sidePanelOpen,
    bottomPanelOpen,
    controller: panelController,
    lifecycle: panelLifecycle,
    panelOpeners,
    sessionCommands,
    createSessionViewTab,
    resolveProjectDefaultDatabaseViewId,
    openPageStage,
    commandKeymapState,
    focusedPanelGroupRef,
    panelGroupTabsRef,
  });
  const {
    cycleFocusedPanelTab,
    closeFocusedPanelTab,
    focusOrCreateDatabaseViewTab,
  } = panelCommands;

  const openPendingViewDeepLink = useEffectEvent(async (
    request: { projectId: string; viewId: string },
  ) => {
    const opened = await focusOrCreateDatabaseViewTab(
      request.viewId,
      "right",
    );
    if (!opened) return;
    onViewDeepLinkHandled?.(request);
  });

  useEffect(() => {
    if (!pendingViewDeepLinkOpen) return;
    if (pendingViewDeepLinkOpen.projectId !== activeProjectId) return;

    void openPendingViewDeepLink(pendingViewDeepLinkOpen);
  }, [
    activeProjectId,
    activeSession?.id,
    pendingViewDeepLinkOpen,
  ]);

  const chromeCommands = useWorkbenchChromeCommands({
    activePanelOwner: activePanelOwnerKey && rightPanel && bottomPanel
      ? {
          key: activePanelOwnerKey,
          panels: { right: rightPanel, bottom: bottomPanel },
        }
      : null,
    rightPanelFullWidth,
    controller: panelController,
    lifecycle: {
      setActivePanelCollapsed: setActiveWorkbenchPanelCollapsed,
      updateActivePanel: updateActiveWorkbenchPanel,
    },
    navigateBack: workbenchWindow.navigateBack,
    navigateForward: workbenchWindow.navigateForward,
    workbenchRootRef,
    shellMainContentWidth,
    shellBodyHeight: shellBodySize.height,
    regularRightPanelWidth,
    rightPanelRequestedWidth,
    bottomPanelHeight,
    bottomPanelRequestedHeight,
    automationsDetailRailRequestedWidth,
  });
  const {
    showActiveRightPanel,
    hideActiveRightPanel,
    showActiveBottomPanel,
    hideActiveBottomPanel,
    toggleActiveRightPanelFullWidth,
    executeShellNavigation,
    resizeRightPanel,
    resizeAutomationDetailRail,
    resizeBottomPanel,
  } = chromeCommands;

  const {
    panelGroupTabs,
    browserRetentionTabs,
    visibleBrowserTabIds,
  } = useWorkbenchPanelProjection({
    activeRenderSession,
    activeSessionPanelModel,
    projects,
    pageStageTabTitleStore,
    panelTabPresentationRegistry,
    panelTabPresentationControllerKeysRef,
    panelGroupTabsRef,
    panelTabMruByLeafRef,
    terminalSessionVersion,
    browserBoundsSyncTriggerByPanel: {
      right: rightPanelMotion.animatedSize,
      bottom: bottomPanelMotion.animatedSize,
    },
    lifecycle: panelLifecycle,
    openers: panelOpeners,
    sessionCommands,
    panelCommands,
    controller: panelController,
    surface: {
      activeDbViewPrefs,
      activeSearchQuery,
      activeView,
      browserViewScopeId: windowSessionId,
      onOpenBrowserSettings: openBrowserSettings,
      windowSessionId,
      dbViewPrefsByProject,
      onLeavePageStage,
      onReminderHandled,
      pageStageCloseRef,
      pageStageHistoryModal,
      pageStagePersistRef,
      pageStageSessionSnapshotRef,
      pendingReminderOpen,
      searchByProject,
      setDbViewPrefs,
      setSearchQuery,
      taskSearchOpenTick,
    },
    conversation: {
      composerEnterBehavior,
      threadQueueFollowUpsEnabled,
      onOpenHooksSettings: openHooksSettings,
      onQueueingEnabledChange: handleThreadQueueFollowUpsEnabledChange,
      onRefreshSessions: refreshProjectSessions,
    },
    automation: {
      onOpenAutomations: openAutomations,
      onOpenLocalEnvironmentsSettings: openLocalEnvironmentsSettings,
    },
    onTogglePageStageHistoryModal: togglePageStageHistoryModal,
    onUpdateSessionViewTab: updateSessionViewTab,
  });
  const mountedBrowserTabIds = useMemo(
    () => (
      activeRenderSession && activeSessionPanelModel
        ? collectMountedBrowserTabIds(
            activeRenderSession,
            activeSessionPanelModel,
            {
              right: rightPanelMotion.mounted,
              bottom: bottomPanelMotion.mounted,
            },
          )
        : new Set<string>()
    ),
    [
      activeRenderSession,
      activeSessionPanelModel,
      bottomPanelMotion.mounted,
      rightPanelMotion.mounted,
    ],
  );
  const projectBrowserRetentionTabs = useMemo<WorkbenchTabProjection[]>(() => {
    if (!activeProjectScene || !activeProject || !projectSceneKey) return [];
    return Object.values(activeProjectScene.panelSurfacesById).flatMap(
      (surface, index) => surface.kind === "browser"
        ? [{
            id: surface.id,
            sessionId: projectSceneKey,
            projectId: activeProject.id,
            panelId: findWorkbenchPanelLeafForTab(
              activeProjectScene.panels.right.layout,
              surface.id,
            ) ? "right" as const : "bottom" as const,
            title: surface.titleSnapshot,
            order: index,
            stateKey: surface.stateKey,
            state: surface.state,
            createdAt: activeProjectScene.touchedAt,
            updatedAt: activeProjectScene.touchedAt,
            kind: "browser" as const,
            browserTabId: surface.config.browserTabId,
            config: {
              projectId: activeProject.id,
              ...surface.config,
            },
          }]
        : [],
    );
  }, [activeProject, activeProjectScene, projectSceneKey]);
  const visibleProjectBrowserTabIds = useMemo(() => {
    const visible = new Set<string>();
    if (!activeProjectScene) return visible;
    for (const panelId of ["right", "bottom"] as const) {
      const panel = activeProjectScene.panels[panelId];
      if (panel.collapsed) continue;
      for (const leaf of listWorkbenchPanelLeaves(panel.layout)) {
        const surface = leaf.activeTabId
          ? activeProjectScene.panelSurfacesById[leaf.activeTabId]
          : null;
        if (surface?.kind === "browser") visible.add(surface.id);
      }
    }
    return visible;
  }, [activeProjectScene]);

  useEffect(() => {
    const atMediumWidth = shellWidthClass !== "wide";
    const atNarrowWidth = shellWidthClass === "narrow";
    const crossedMediumWidth = atMediumWidth !== shellAtMediumWidthRef.current;
    const crossedNarrowWidth = atNarrowWidth !== shellAtNarrowWidthRef.current;
    if (!crossedMediumWidth && !crossedNarrowWidth) return;

    shellAtMediumWidthRef.current = atMediumWidth;
    shellAtNarrowWidthRef.current = atNarrowWidth;

    if (!activePanelOwnerKey || !rightPanel) return;

    const shouldClearRightPanel =
      (crossedMediumWidth && atMediumWidth && sidebarOpen && sidePanelOpen)
      || (crossedNarrowWidth && atNarrowWidth && sidePanelOpen);
    if (shouldClearRightPanel) {
      setFloatingSidebarFocusActive(false);
      const overrideKey = makeWorkbenchPanelSlotKey(activePanelOwnerKey, "right");
      panelControllerRef.current.updatePanelCollapsedOverrides((current) => ({ ...current, [overrideKey]: true }));
      void updateActiveWorkbenchPanel("right", {
        collapsed: true,
        size: {
          ...rightPanel.size,
          fullWidth: false,
        },
      }).catch((error) => {
        toast.danger(error instanceof Error ? error.message : "Unable to update panel");
      }).finally(() => {
        panelControllerRef.current.updatePanelCollapsedOverrides((current) => {
          if (!(overrideKey in current)) return current;
          const next = { ...current };
          delete next[overrideKey];
          return next;
        });
      });
    }

    if (crossedNarrowWidth && atNarrowWidth && sidebarOpen) {
      setSidebarCollapsedWithCodexState(true, {
        animate: false,
        suppressHoverOpen: true,
      });
    }
  }, [
    activePanelOwnerKey,
    rightPanel,
    setFloatingSidebarFocusActive,
    setSidebarCollapsedWithCodexState,
    sidePanelOpen,
    sidebarOpen,
    shellWidthClass,
    updateActiveWorkbenchPanel,
  ]);

  const toggleThreadSummaryPanel = useCallback(() => {
    toggleThreadSummaryPanelPinnedOpen();
  }, [toggleThreadSummaryPanelPinnedOpen]);
  const threadSummaryCommands = useMemo<WorkbenchThreadSummaryCommands>(
    () => ({
      selectPanelTab,
      setPanelCollapsed: setActivePanelCollapsed,
      openAutomationSidePanel,
      openAutomations,
      openSummaryOutputInSidePanel,
      openProcessOutput: openProcessOutputInCurrentSession,
      openProcessManager: () => {
        setProcessManagerOpen(true);
      },
      presentBrowserTab: browserUsePresentation.presentBrowserTab,
    }),
    [
      openAutomationSidePanel,
      openAutomations,
      openProcessOutputInCurrentSession,
      openSummaryOutputInSidePanel,
      browserUsePresentation.presentBrowserTab,
      selectPanelTab,
      setActivePanelCollapsed,
    ],
  );
  const threadSummary = useWorkbenchThreadSummary({
    activeSession,
    windowSessionId,
    layoutMode: threadSummaryPanelLayoutMode,
    rightPanelFullWidth,
    pinnedOpen: threadSummaryPanelPinnedOpen,
    sideChatTabs: activeSession
      ? sideChatTabsBySession[activeSession.id] ?? []
      : [],
    previewTabsByPanel,
    scheduledAutomations: scheduledAutomationsQuery.data ?? [],
    commands: threadSummaryCommands,
  });
  const {
    mounted: threadSummaryPanelMounted,
    open: threadSummaryPanelOpen,
    hideImmediately: threadSummaryPanelHideImmediately,
    contentShift: threadSummaryPanelContentShift,
    sideChatRows: threadSummarySideChatRows,
    browserRows: threadSummaryBrowserRows,
    scheduledAutomation: threadSummaryScheduledAutomation,
    onOpenSideChatRow: openSummarySideChatRow,
    onOpenBrowserRow: openSummaryBrowserRow,
    onOpenScheduledAutomation: openSummaryScheduledAutomation,
    onOpenProcessManager: openSummaryProcessManager,
    onOpenBackgroundTerminalOutput:
      openSummaryBackgroundTerminalOutput,
  } = threadSummary;
  const threadSummaryHeaderAction = (
    <WorkbenchThreadSummaryHeader
      activeProject={activeProject}
      activeSession={activeSession}
      pinnedOpen={threadSummaryPanelPinnedOpen}
      onTogglePinnedOpen={toggleThreadSummaryPanel}
      summary={threadSummary}
    />
  );

  const toggleActiveSidePanel = useCallback(() => {
    if (!activePanelOwnerKey || projectSceneOwner) return;
    if (!sidePanelOpen) {
      void showActiveRightPanel();
      return;
    }
    void hideActiveRightPanel();
  }, [activePanelOwnerKey, hideActiveRightPanel, projectSceneOwner, showActiveRightPanel, sidePanelOpen]);

  const toggleActiveBottomPanel = useCallback(() => {
    if (!activePanelOwnerKey) return;
    if (!bottomPanelOpen) {
      void showActiveBottomPanel();
      return;
    }
    void hideActiveBottomPanel();
  }, [activePanelOwnerKey, bottomPanelOpen, hideActiveBottomPanel, showActiveBottomPanel]);

  const executeWorkbenchCommand = useCallback(({ commandId }: WorkbenchCommandInvocation) => {
    if (commandId !== TOGGLE_BOTTOM_PANEL_COMMAND_ID) return;
    toggleActiveBottomPanel();
  }, [toggleActiveBottomPanel]);

  const commandPort = useMemo<WorkbenchCommandPort>(() => ({
    navigate: (direction) => {
      executeShellNavigation(direction);
    },
    toggleSidebar: () => {
      toggleSidebarCollapsed();
    },
    renameThread: () => {
      if (!activeSession) return;
      openRenameSessionDialog(activeSession);
    },
    openContentSearch: (source, preferredDomain) => {
      requestContentSearchOpen(source, preferredDomain);
    },
    cyclePanelTab: (direction) => {
      cycleFocusedPanelTab(
        panelTabCycleRequestDirectionToOffset(direction),
        null,
        { respectActiveElementGuard: true },
      );
    },
    closePanelTab: () => {
      closeFocusedPanelTab(null, { respectActiveElementGuard: true });
    },
    execute: (commandId, source) => {
      if (!selectedSessionDetailReady) {
        pendingWorkbenchCommandInvocationsRef.current.push({
          commandId,
          source,
        });
        return;
      }
      executeWorkbenchCommand({ commandId, source });
    },
    openCommandPalette,
    toggleSettings,
    openKeyboardShortcuts: openKeyboardShortcutsSettings,
  }), [
    activeSession,
    closeFocusedPanelTab,
    cycleFocusedPanelTab,
    executeShellNavigation,
    executeWorkbenchCommand,
    openCommandPalette,
    openKeyboardShortcutsSettings,
    openRenameSessionDialog,
    requestContentSearchOpen,
    selectedSessionDetailReady,
    toggleSettings,
    toggleSidebarCollapsed,
  ]);

  useEffect(() => {
    if (!onRegisterCommandPort) return undefined;
    return onRegisterCommandPort(commandPort);
  }, [commandPort, onRegisterCommandPort]);

  useEffect(() => {
    if (!selectedSessionDetailReady) return;
    const pending =
      pendingWorkbenchCommandInvocationsRef.current.splice(0);
    for (const invocation of pending) {
      executeWorkbenchCommand(invocation);
    }
  }, [executeWorkbenchCommand, selectedSessionDetailReady]);

  const sidebarCollapseControlLabel = sidebarLogicalCollapsed ? "Show sidebar" : "Hide sidebar";
  const sidebarCollapseControlButton = (
    <NodexTooltip
      delayOpen
      tooltipContent="Toggle sidebar"
      side="bottom"
      disabled={sidebarAnimating || sidebarClickInFlight}
    >
      <button
        type="button"
        onClick={() => {
          setSidebarClickInFlight(true);
          toggleSidebarCollapsed();
        }}
        onPointerEnter={() => setSidebarTriggerHovered(true)}
        onPointerLeave={() => {
          setSidebarTriggerHovered(false);
          setSidebarHoverSuppressed(false);
          setSidebarClickInFlight(false);
        }}
        title="Toggle sidebar"
        aria-label={sidebarCollapseControlLabel}
        className={SIDEBAR_COLLAPSED_CHROME_BUTTON_CLASS}
        style={{ viewTransitionName: "sidebar-trigger" }}
      >
        {sidebarLogicalCollapsed ? <CodexSidebarHiddenIcon className="icon-xs" /> : <CodexSidebarVisibleIcon className="icon-xs" />}
      </button>
    </NodexTooltip>
  );
  const backCommand = WORKBENCH_NAVIGATION_COMMANDS.back;
  const forwardCommand = WORKBENCH_NAVIGATION_COMMANDS.forward;
  const backShortcutLabel = resolveWorkbenchNavigationShortcutLabel("back", isMacPlatform);
  const forwardShortcutLabel = resolveWorkbenchNavigationShortcutLabel("forward", isMacPlatform);
  const windowNavigationChrome = (
    <div className="flex items-center gap-1" data-testid="workbench-window-navigation-chrome">
      {sidebarCollapseControlButton}
      <WindowNavigationToolbarButton
        label={backCommand.label}
        shortcutLabel={backShortcutLabel}
        disabled={!shellCanNavigateBack}
        onClick={() => void executeShellNavigation("back")}
      >
        <ArrowLeft className="icon-xs" />
      </WindowNavigationToolbarButton>
      <WindowNavigationToolbarButton
        label={forwardCommand.label}
        shortcutLabel={forwardShortcutLabel}
        disabled={!shellCanNavigateForward}
        onClick={() => void executeShellNavigation("forward")}
      >
        <ArrowLeft className="icon-xs -scale-x-100" />
      </WindowNavigationToolbarButton>
    </div>
  );

  const sidebarHeaderActions = (
    <>
      <HeaderAction
        actionId="workbench-window-navigation-chrome"
        slotPosition="left"
        align="start"
        order={100}
      >
        {windowNavigationChrome}
      </HeaderAction>
      {sidebarLogicalCollapsed ? (
        <HeaderAction
          actionId="workbench-sidebar-new-chat"
          slotPosition="left"
          align="start"
          order={110}
        >
          <SidebarCompactNewChatButton
            label="New chat"
            onClick={() => void startNewChatInProject(activeProjectId)}
          />
        </HeaderAction>
      ) : null}
    </>
  );

  const panelHeaderActions = activePanelOwnerKey ? (
    <>
      <HeaderAction
        actionId="workbench-bottom-panel-toggle"
        slotPosition="right"
        align="end"
        order={200}
      >
        <ToolbarIconButton
          label="Toggle bottom panel"
          pressed={bottomPanelOpen}
          onClick={() => executeWorkbenchCommand({
            commandId: TOGGLE_BOTTOM_PANEL_COMMAND_ID,
            source: "toolbar",
          })}
        >
          {bottomPanelOpen ? <CodexPanelBottomVisibleIcon className="icon-sm" /> : <CodexPanelBottomHiddenIcon className="icon-sm" />}
        </ToolbarIconButton>
      </HeaderAction>
      {!projectSceneOwner ? (
        <HeaderAction
          actionId="workbench-side-panel-toggle"
          slotPosition="right"
          align="end"
          order={300}
        >
          <ToolbarIconButton label="Toggle side panel" pressed={sidePanelOpen} onClick={toggleActiveSidePanel}>
            {sidePanelOpen ? <CodexPanelRightVisibleIcon className="icon-sm" /> : <CodexPanelRightHiddenIcon className="icon-sm" />}
          </ToolbarIconButton>
        </HeaderAction>
      ) : null}
    </>
  ) : null;

  const headerActions = (
    <>
      {sidebarHeaderActions}
      {threadSummaryHeaderAction ? (
        <HeaderAction
          actionId="local-thread-summary-panel-toggle"
          slotPosition="center"
          align="end"
          order={250}
        >
          {threadSummaryHeaderAction}
        </HeaderAction>
      ) : null}
      {panelHeaderActions}
    </>
  );

  const rightPanelHeaderStartInsetWidth = activePanelOwnerKey && rightPanelFullWidth && sidebarLogicalCollapsed
    ? effectiveHeaderLeftWidth
    : 0;
  const panelTabScrollEndPaddingPx = activePanelOwnerKey ? 28 : 0;
  const bottomPanelGlobalHeaderInsetWidth = activePanelOwnerKey ? 40 : 0;

  const rightPanelHeaderAfterList = activePanelOwnerKey ? (
    <>
      {!projectSceneOwner ? (
        <div className="no-drag pointer-events-auto flex h-full shrink-0 items-center">
          <ToolbarIconButton
            label={rightPanelFullWidth ? "Restore panel width" : "Expand panel"}
            pressed={rightPanelFullWidth}
            onClick={toggleActiveRightPanelFullWidth}
          >
            {rightPanelFullWidth ? <CodexRestorePanelIcon className="icon-xs" /> : <CodexExpandPanelIcon className="icon-xs" />}
          </ToolbarIconButton>
        </div>
      ) : null}
      <div
        aria-hidden="true"
        data-testid="right-panel-tab-bar-header-spacer"
        className="no-drag pointer-events-none h-full shrink-0"
        style={{ width: `calc(${headerRightWidth}px)` }}
      />
    </>
  ) : null;

  const bottomPanelGlobalHeaderControls = activePanelOwnerKey ? (
    <div className="pointer-events-auto flex h-full shrink-0 items-center">
      <ToolbarIconButton
        label="Close"
        onClick={hideActiveBottomPanel}
      >
        <CodexCloseIcon className="icon-xs" />
      </ToolbarIconButton>
    </div>
  ) : null;

  const showFloatingSidebar = sidebarLogicalCollapsed
    && !realSidebarMounted
    && (floatingSidebarVisible || floatingSidebarResizing);
  const showInlineSidebar = realSidebarMounted;
  const floatingSidebarTransition = getCodexSidebarFloatingTransition(Boolean(reducedMotion));
  const floatingSidebarExitX = reducedMotion ? 0 : -8;
  const floatingSidebarHeaderExitX = reducedMotion ? 0 : 8;
  const applicationMenuBarEnabled = typeof document !== "undefined"
    && document.documentElement.getAttribute("data-codex-window-chrome") === "application-menu";
  const floatingSidebarOuterClassName = getCodexSidebarFloatingOuterClassName(applicationMenuBarEnabled);
  const floatingSidebarHeader = (
    <motion.div
      className={CODEX_SIDEBAR_FLOATING_HEADER_CLASS}
      initial={reducedMotion ? false : { x: 8 }}
      animate={{ x: 0 }}
      exit={{ x: floatingSidebarHeaderExitX }}
      transition={floatingSidebarTransition}
    >
      <NodexTooltip delayOpen tooltipContent="Toggle sidebar" side="bottom">
        <button
          type="button"
          onClick={showRealSidebarFromFloatingPanel}
          title="Toggle sidebar"
          aria-label="Show sidebar"
          className={SIDEBAR_COLLAPSED_CHROME_BUTTON_CLASS}
          style={{ viewTransitionName: "sidebar-trigger" }}
        >
          <CodexSidebarHiddenIcon className="icon-xs" />
        </button>
      </NodexTooltip>
    </motion.div>
  );
  const openLibraryTargetInProject = useCallback(async (
    projectId: string,
    target: LibraryResourceTarget,
    title: string,
  ) => {
    if (!libraryWorkspaceEnabled) return;
    selectProject(projectId);
    if (target.kind === "page") {
      setLibraryRoute(null);
      await openProjectScenePage(projectId, target.pageId, title);
      return;
    }
    setLibraryRoute({
      ...target,
      accessProjectId: projectId,
    });
  }, [
    libraryWorkspaceEnabled,
    openProjectScenePage,
    selectProject,
    setLibraryRoute,
  ]);
  const handOffCancelledPendingWorktree = useCallback(async (
    entry: CodexPendingWorktreeEntry,
  ) => {
    const targetProjectId = resolveCancelledPendingWorktreeProjectId(
      entry,
      new Set(projects.map((project) => project.id)),
    );
    const session = await ensureBlankSessionForProject(targetProjectId);
    setSettingsPath(null);
    setAutomationsPath(null);
    setNewThreadComposerIntentsBySessionId((current) => ({
      ...current,
      [session.id]: buildCancelledPendingWorktreeComposerIntent(entry, Date.now()),
    }));
  }, [ensureBlankSessionForProject, projects, setAutomationsPath, setSettingsPath]);
  const {
    automationsRouteShell,
    libraryRouteShell,
    pendingWorktreeRouteShell,
    settingsRouteShell,
  } = useWorkbenchRouteSurfaces({
    settings: {
      path: settingsPath,
      props: {
        onPathChange: setSettingsPath,
        onBackToApp: closeSettings,
        onRequestProjectPickerOpen,
        projects,
        activeProjectId: activeProject?.id ?? activeProjectId,
        initialLocalEnvironmentProjectId:
          localEnvironmentSettingsInitial?.projectId ?? null,
        initialLocalEnvironmentConfigPath:
          localEnvironmentSettingsInitial?.configPath ?? null,
        threadQueueFollowUpsEnabled,
        onThreadQueueFollowUpsEnabledChange:
          handleThreadQueueFollowUpsEnabledChange,
        composerEnterBehavior,
        onComposerEnterBehaviorChange:
          handleComposerEnterBehaviorChange,
        worktreeStartMode,
        onWorktreeStartModeChange:
          handleWorktreeStartModeChange,
        worktreeAutoBranchPrefix,
        onWorktreeAutoBranchPrefixChange:
          handleWorktreeAutoBranchPrefixChange,
        smartPrefixParsingEnabled,
        onSmartPrefixParsingEnabledChange:
          handleSmartPrefixParsingEnabledChange,
        stripSmartPrefixFromTitleEnabled,
        onStripSmartPrefixFromTitleEnabledChange:
          handleStripSmartPrefixFromTitleEnabledChange,
      },
    },
    library: {
      enabled: libraryWorkspaceEnabled,
      route: libraryRoute,
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
      })),
      onOpenHome: openLibrary,
      onOpenTarget: openLibraryTarget,
      onOpenTargetInProject: openLibraryTargetInProject,
    },
    automations: {
      path: automationsPath,
      props: {
        projects,
        externalHeader: true,
        detailRailPortalTarget:
          automationsDetailRailPortalElement,
        onDetailRailOpenChange:
          setAutomationsDetailRailOpen,
        onPathChange: setAutomationsPath,
        onOpenThread:
          openAutomationHistoryThreadSessionById,
        onCreateWithChat:
          openScheduledAutomationChatCreate,
        onPersonalizeTemplate:
          startScheduledAutomationTemplateChat,
        onOpenLocalEnvironmentsSettings:
          openLocalEnvironmentsSettings,
      },
    },
    pendingWorktree: {
      clientThreadId: pendingWorktreeClientThreadId,
      props: {
        agentMode: workbenchCodexControl.permissionMode,
        externalHeader: true,
        onClose: closePendingWorktreeRoute,
        onOpenThread: async (threadId) => {
          if (!pendingWorktreeClientThreadId) return;
          return await openResolvedPendingThreadSession(
            pendingWorktreeClientThreadId,
            threadId,
          );
        },
        onOpenPendingWorktree:
          setPendingWorktreeClientThreadId,
        onCancelToSource: handOffCancelledPendingWorktree,
        onEditEnvironment: (entry) => {
          void openLocalEnvironmentsSettings({
            projectId:
              entry.launchMode === "start-conversation"
                ? entry.startConversationParamsInput
                    .projectAssignment?.projectId ?? null
                : entry.launchMode === "fork-conversation"
                  ? entry.projectAssignment?.projectId ?? null
                  : null,
            configPath:
              entry.localEnvironmentConfigPath ?? null,
            reopenPendingWorktreeClientThreadId:
              pendingWorktreeClientThreadId,
          });
        },
      },
    },
  });
  const appShellHeaderCenterVisible = settingsRouteShell == null
    && libraryRouteShell == null
    && (
      activePanelOwnerKey != null
      || automationsRouteShell != null
      || pendingWorktreeRouteShell != null
    );
  const appShellHeaderActions = settingsPath
    ? null
    : pendingWorktreeRouteShell
      ? null
      : automationsPath || libraryRoute
        ? sidebarHeaderActions
        : headerActions;
  const automationsDetailRailMounted = Boolean(automationsRouteShell && automationsDetailRailOpen);
  const automationsDetailRailOpenValue = useSyncedMotionValue(automationsDetailRailMounted ? 1 : 0);
  const automationsDetailRailResolvedWidth = useTransform(
    [automationsDetailRailOpenValue, automationsDetailRailRequestedWidth, shellMainContentWidth],
    ([latestOpen, latestRequestedWidth, latestShellWidth]) => Number(latestOpen) > 0
      ? clampAutomationDetailRailWidth(
          Number(latestRequestedWidth),
          Number(latestShellWidth),
        )
      : 0,
  );

  const commandPalette = (
    <WorkbenchCommandPaletteHost
      open={commandPaletteOpen}
      openRequest={commandPaletteOpenRequest}
      projects={projects}
      activeProjectId={activeProject?.id ?? activeProjectId}
      activeSession={activeSession}
      recentPageSessions={recentPageSessions}
      canNavigateBack={shellCanNavigateBack}
      canNavigateForward={shellCanNavigateForward}
      canOpenSessionInNewWindow={Boolean(
        onOpenProjectSessionInNewWindow,
      )}
      commandKeymapState={commandKeymapState}
      sessionCommands={sessionCommands}
      panelCommands={panelCommands}
      panelOpeners={panelOpeners}
      sidebarCommands={sidebarController}
      setOpen={setCommandPaletteOpen}
      executeNavigation={executeShellNavigation}
      executeWorkbenchCommand={executeWorkbenchCommand}
      toggleSidebar={toggleSidebarCollapsed}
      toggleSidePanel={toggleActiveSidePanel}
      openAutomations={openAutomations}
      openProcessManager={() => setProcessManagerOpen(true)}
      openSettings={openSettings}
      openKeyboardShortcuts={openKeyboardShortcutsSettings}
      onOpenSessionInNewWindow={
        onOpenProjectSessionInNewWindow
      }
    />
  );

  const activeSessionProject = activeRenderSession?.projectId
    ? projects.find(
        (project) => project.id === activeRenderSession.projectId,
      ) ?? activeProject
    : null;
  const renderProjectSceneSurface = useCallback((
    surface: WorkbenchSurfaceDescriptor,
    context: { readonly active: boolean; readonly panelId: PanelId },
  ) => {
    if (!activeProjectScene || !activeProject || !projectSceneKey) return null;
    const leafId = findWorkbenchPanelLeafForTab(
      activeProjectScene.panels[context.panelId].layout,
      surface.id,
    )?.id ?? activeProjectScene.panels[context.panelId].layout.activeLeafId;
    const common = {
      id: surface.id,
      sessionId: projectSceneKey,
      projectId: activeProject.id,
      panelId: context.panelId,
      title: surface.titleSnapshot,
      order: 0,
      stateKey: surface.stateKey,
      state: surface.state,
      createdAt: activeProjectScene.touchedAt,
      updatedAt: activeProjectScene.touchedAt,
      browserTabId: null,
    };

    if (surface.kind === "db_view") {
      const databaseViewId = surface.config.target.kind === "project-default"
        ? activeProject.defaultDatabaseViewId
        : surface.config.target.databaseViewId;
      if (!databaseViewId) {
        return (
          <div className="flex h-full items-center justify-center text-sm text-token-text-secondary">
            Database View is unavailable
          </div>
        );
      }
      const tab: WorkbenchTabProjection = {
        ...common,
        kind: "db_view",
        config: {
          projectId: surface.config.projectId,
          databaseViewId,
          view: surface.config.view,
        },
      };
      return (
        <DbViewSessionTab
          sessionId={`${windowSessionId}:${projectSceneKey}:${surface.id}`}
          tab={tab}
          projects={projects}
          activeView={activeView}
          activeSearchQuery={activeSearchQuery}
          activeDbViewPrefs={activeDbViewPrefs}
          searchByProject={searchByProject}
          dbViewPrefsByProject={dbViewPrefsByProject}
          activePanelPageStagePageIdsByProject={new Map()}
          pageStageCloseRef={pageStageCloseRef}
          pendingReminderOpen={pendingReminderOpen}
          taskSearchOpenTick={taskSearchOpenTick}
          setSearchQuery={setSearchQuery}
          setDbViewPrefs={setDbViewPrefs}
          onReminderHandled={onReminderHandled}
          onOpenPageTab={openProjectScenePage}
          onOpenCanvasStage={openProjectSceneCanvas}
          targetLeafId={leafId}
          onUpdateTab={(surfaceId, patch) => {
            if (!projectSceneOwner) return null;
            const nextView = patch.config && "view" in patch.config
              ? patch.config.view
              : surface.config.view;
            panelControllerRef.current.sceneDurable?.updateSurface(
              projectSceneOwner,
              surfaceId,
              {
                ...(patch.title === undefined
                  ? {}
                  : { titleSnapshot: patch.title }),
                ...(patch.stateKey === undefined
                  ? {}
                  : { stateKey: patch.stateKey }),
                ...(!("state" in patch) ? {} : { state: patch.state }),
                config: {
                  ...surface.config,
                  view: nextView,
                },
              },
            );
            return {
              ...tab,
              ...(patch.title === undefined ? {} : { title: patch.title }),
              config: { ...tab.config, view: nextView },
            };
          }}
        />
      );
    }

    if (surface.kind === "canvas_stage") {
      const tab: WorkbenchTabProjection = {
        ...common,
        kind: "canvas_stage",
        config: surface.config,
      };
      return (
        <WorkbenchCanvasStagePanel
          tab={tab}
          windowSessionId={windowSessionId}
          projectSessionId={projectSceneKey}
          isActivePanelTab={context.active}
          onClose={() => {
            if (!projectSceneOwner) return;
            panelControllerRef.current.sceneDurable?.removeSurface(
              projectSceneOwner,
              surface.id,
            );
          }}
          onTitleChange={(title) => {
            if (!projectSceneOwner) return;
            panelControllerRef.current.sceneDurable?.updateSurface(
              projectSceneOwner,
              surface.id,
              { titleSnapshot: title },
            );
          }}
        />
      );
    }

    if (surface.kind === "page_stage") {
      const tab: WorkbenchTabProjection = {
        ...common,
        kind: "page_stage",
        config: surface.config,
      };
      return (
        <PageStageSessionTab
          tab={tab}
          project={projects.find((item) =>
            item.id === surface.config.projectId
          ) ?? null}
          closeRef={pageStageCloseRef}
          persistRef={pageStagePersistRef}
          sessionSnapshotRef={pageStageSessionSnapshotRef}
          sessionId={projectSceneKey}
          sessionThread={null}
          canStartThreadInSession={false}
          titleStore={pageStageTabTitleStore}
          onLeavePage={onLeavePageStage}
          onClose={() => {
            if (!projectSceneOwner) return;
            panelControllerRef.current.sceneDurable?.removeSurface(
              projectSceneOwner,
              surface.id,
            );
          }}
          onOpenTerminal={async () => {
            await openProjectSceneManualSurface(activeProject.id, "terminal", {
              panelId: "bottom",
              targetLeafId: activeProjectScene.panels.bottom.layout.activeLeafId,
            });
          }}
          onEnsureBlankSessionForProject={ensureBlankSessionForProject}
          onRefreshSessions={refreshProjectSessions}
          onOpenPageTab={openProjectScenePage}
          onOpenCanvasStage={openProjectSceneCanvas}
          onOpenThread={openAttachedThreadSessionById}
          historyPanelActive={Boolean(
            pageStageHistoryModal
            && pageStageHistoryModal.sessionId === projectSceneKey
            && pageStageHistoryModal.tabId === surface.id
          )}
          onToggleHistoryPanel={togglePageStageHistoryModal}
          isActivePanelTab={context.active}
        />
      );
    }

    if (surface.kind === "files") {
      const tab: WorkbenchTabProjection = {
        ...common,
        kind: "files",
        config: surface.config,
      };
      return (
        <WorkspaceFilesPanel
          tab={tab as WorkspaceFilesTab}
          presentationOwnerId={projectSceneKey}
          project={projects.find((item) =>
            item.id === surface.config.projectId
          ) ?? activeProject}
          onOpenFileTab={async (input) => openProjectSceneManualSurface(
            activeProject.id,
            "files",
            {
              panelId: input.panelId,
              path: input.path,
            },
          )}
          onUpdateTabState={(state) => {
            if (!projectSceneOwner) return;
            panelControllerRef.current.sceneDurable?.updateSurface(
              projectSceneOwner,
              surface.id,
              { state },
            );
          }}
        />
      );
    }

    if (surface.kind === "browser") {
      const tab: WorkbenchTabProjection = {
        ...common,
        kind: "browser",
        browserTabId: surface.config.browserTabId,
        config: {
          projectId: activeProject.id,
          ...surface.config,
        },
      };
      return (
        <BrowserSidebarPanel
          tab={tab}
          surfaceContext={{
            browserConversationId: projectSceneKey,
            codexSessionId: null,
          }}
          browserViewScopeId={windowSessionId}
          onRefreshSessions={refreshProjectSessions}
          onUpdateTab={(_surfaceId, patch) => {
            const patchConfig = patch.config;
            const nextConfig = {
              ...surface.config,
              ...(patchConfig && "url" in patchConfig
                ? { url: patchConfig.url }
                : {}),
              ...(patchConfig && "title" in patchConfig
                ? { title: patchConfig.title }
                : {}),
              ...(patchConfig && "faviconUrl" in patchConfig
                ? { faviconUrl: patchConfig.faviconUrl }
                : {}),
              ...(patchConfig && "deviceToolbarVisible" in patchConfig
                ? { deviceToolbarVisible: patchConfig.deviceToolbarVisible }
                : {}),
              ...(patchConfig && "deviceToolbarState" in patchConfig
                ? { deviceToolbarState: patchConfig.deviceToolbarState }
                : {}),
            };
            if (projectSceneOwner) {
              panelControllerRef.current.sceneDurable?.updateSurface(
                projectSceneOwner,
                surface.id,
                {
                  ...(patch.title === undefined
                    ? {}
                    : { titleSnapshot: patch.title }),
                  ...(!("state" in patch) ? {} : { state: patch.state }),
                  config: nextConfig,
                },
              );
            }
            return {
              ...tab,
              ...(patch.title === undefined ? {} : { title: patch.title }),
              config: {
                projectId: activeProject.id,
                ...nextConfig,
              },
            };
          }}
          onOpenNewTab={(request) => {
            void openProjectSceneManualSurface(activeProject.id, "browser", {
              panelId: context.panelId,
              targetLeafId: leafId,
              url: request.url,
            });
          }}
          boundsSyncTrigger={context.panelId === "right"
            ? rightPanelMotion.animatedSize
            : bottomPanelMotion.animatedSize}
          onOpenBrowserSettings={openBrowserSettings}
          activeForContentSearch={context.active}
          isVisible={context.active}
        />
      );
    }

    if (surface.kind === "terminal") {
      const contextProjectId = surface.config.context?.kind === "project"
        ? surface.config.context.projectId
        : activeProject.id;
      const terminalProject = projects.find((item) =>
        item.id === contextProjectId
      ) ?? activeProject;
      const cwd = projectWorkspaceRootOrNull(terminalProject);
      if (!cwd) {
        return (
          <div className="flex h-full items-center justify-center text-sm text-token-text-secondary">
            Terminal workspace is unavailable
          </div>
        );
      }
      return (
        <TerminalPanel
          terminalId={surface.config.terminalSessionId}
          cwd={cwd}
          conversationId={null}
          projectSessionId={null}
          onNewTerminalTab={() => {
            void openProjectSceneManualSurface(activeProject.id, "terminal", {
              panelId: context.panelId,
              targetLeafId: leafId,
            });
          }}
        />
      );
    }

    if (surface.kind === "review") {
      const reviewProject = projects.find((item) =>
        item.id === surface.config.projectId
      ) ?? null;
      return (
        <ConnectedReviewDiffPanel
          threadId={null}
          projectWorkspacePath={projectWorkspaceRootOrNull(reviewProject)}
          searchOpenTick={0}
        />
      );
    }

    return null;
  }, [
    activeDbViewPrefs,
    activeProject,
    activeProjectScene,
    activeSearchQuery,
    activeView,
    bottomPanelMotion.animatedSize,
    dbViewPrefsByProject,
    ensureBlankSessionForProject,
    onLeavePageStage,
    onReminderHandled,
    openAttachedThreadSessionById,
    openBrowserSettings,
    openProjectSceneCanvas,
    openProjectSceneManualSurface,
    openProjectScenePage,
    pageStageCloseRef,
    pageStageHistoryModal,
    pageStagePersistRef,
    pageStageSessionSnapshotRef,
    pageStageTabTitleStore,
    pendingReminderOpen,
    projectSceneKey,
    projectSceneOwner,
    projects,
    refreshProjectSessions,
    searchByProject,
    setDbViewPrefs,
    setSearchQuery,
    taskSearchOpenTick,
    togglePageStageHistoryModal,
    rightPanelMotion.animatedSize,
    windowSessionId,
  ]);
  const closeProjectSceneSurfaceRuntime = useCallback(async (
    surface: WorkbenchSurfaceDescriptor,
  ): Promise<boolean> => {
    if (!projectSceneKey) return false;
    if (surface.kind === "files") {
      const saved = await workspaceTextDocumentRegistry.flush(surface.id);
      if (!saved) {
        toast.danger("Resolve the file conflict before closing this tab");
      }
      return saved;
    }
    if (surface.kind === "terminal") {
      terminalSessionStore.release(surface.config.terminalSessionId);
      return true;
    }
    if (surface.kind === "page_stage") {
      await pageEditorSessionRegistry.dispose(
        makePageEditorSessionKey(projectSceneKey, surface.id),
      );
      return true;
    }
    if (surface.kind === "canvas_stage") {
      try {
        await canvasSceneSurfaceRegistry.dispose(
          makeCanvasSceneSurfaceKey(
            windowSessionId,
            projectSceneKey,
            surface.id,
          ),
        );
        return true;
      } catch {
        toast.danger("Canvas changes could not be saved locally");
        return false;
      }
    }
    if (surface.kind === "browser") {
      try {
        await invoke("browser-sidebar-command", {
          type: "close-tab",
          browserConversationId: projectSceneKey,
          browserViewScopeId: windowSessionId,
          browserTabId: surface.config.browserTabId,
        });
      } catch {
        // Browser runtime cleanup is best effort; the durable descriptor still closes.
      }
    }
    return true;
  }, [projectSceneKey, windowSessionId]);
  const projectScenePanels = (
    activeProjectScene
    && activeProject
    && panelController.sceneDurable
  ) ? buildWorkbenchScenePanels({
    scene: activeProjectScene,
    project: activeProject,
    projects,
    commands: panelController.sceneDurable,
    isMac: isMacPlatform,
    commandKeymapState,
    availableActions: PANEL_NEW_TAB_ACTIONS.filter((action) =>
      action.kind !== "side_chat"
    ),
    currentProjectDbViewExists: activeProjectScene.primary.kind === "db_view"
      || Object.values(activeProjectScene.panelSurfacesById).some(
        (surface) => surface.kind === "db_view",
      ),
    rightPanelHeaderAfterList,
    rightPanelHeaderStartInsetWidth,
    bottomPanelGlobalHeaderInsetWidth,
    panelTabScrollEndPaddingPx,
    renderSurface: renderProjectSceneSurface,
    onCloseSurface: closeProjectSceneSurfaceRuntime,
    onOpenAction: (panelId, leafId, action) => {
      if (action === "canvas_stage") {
        void openProjectSceneCanvas(
          activeProject.id,
          primaryCanvasBlockId(activeProject.id),
          "Canvas",
          { targetPanelId: panelId, targetLeafId: leafId },
        );
        return;
      }
      if (
        action === "browser"
        || action === "files"
        || action === "review"
        || action === "terminal"
      ) {
        void openProjectSceneManualSurface(activeProject.id, action, {
          panelId,
          targetLeafId: leafId,
        });
        return;
      }
      if (action !== "db_view" || !activeProject.defaultDatabaseViewId) return;
      void presentProjectSceneSurface(activeProject.id, {
        kind: "db_view",
        config: {
          projectId: activeProject.id,
          target: { kind: "project-default" },
          view: activeView,
        },
      }, { panelId, targetLeafId: leafId });
    },
    onOpenDestination: async (panelId, leafId, destination) => {
      if (destination.kind === "page") {
        await presentProjectSceneSurface(activeProject.id, {
          kind: "page_stage",
          projectId: destination.projectId,
          pageId: destination.pageId,
          titleSnapshot: destination.titleSnapshot,
        }, { panelId, targetLeafId: leafId });
        return;
      }
      await presentProjectSceneSurface(activeProject.id, {
        kind: "db_view",
        config: {
          projectId: destination.projectId,
          target: {
            kind: "database-view",
            databaseViewId: destination.databaseViewId,
          },
          view: activeView,
        },
      }, { panelId, targetLeafId: leafId });
    },
  }) : null;
  const projectAgentDockLeadingContent = (
    projectAgentDockModel
    && selectedProjectSceneId
  ) ? (
    <ProjectAgentDockLeadingRow
      model={projectAgentDockModel}
      query={projectAgentDockQuery}
      onQueryChange={setProjectAgentDockQuery}
      onSelect={selectProjectAgentDockTarget}
      onLoadMore={() => {
        void loadMoreProjectSessionSummaries(selectedProjectSceneId);
      }}
      onRetry={() => {
        void sessionCatalog.retryCollection(selectedProjectSceneId);
        if (projectAgentDockBoundSessionId) {
          void projectAgentDockSessionQuery.refetch();
        }
      }}
      onOpenTask={() => {
        const sessionId = projectAgentDockModel.trigger.sessionId;
        if (!sessionId) return;
        workbenchWindow.selectSession({
          id: sessionId,
          projectId: selectedProjectSceneId,
        });
      }}
      pendingWorktree={projectAgentDockPendingWorktreeModel}
      onOpenPendingWorktreeDetails={() => {
        if (!projectAgentDockPendingWorktreeModel) return;
        setPendingWorktreeClientThreadId(
          projectAgentDockPendingWorktreeModel.clientThreadId,
        );
      }}
    />
  ) : null;
  const projectAgentDockAttention = projectAgentDockPendingWorktreeModel
    ? projectAgentDockPendingWorktreeModel.attention
    : projectAgentDockModel?.trigger.attention ?? "none";
  const projectAgentDock = (
    selectedProjectSceneId
    && projectSceneKey
    && activeProjectScene?.agentDock
    && activeProject
    && projectAgentDockModel
    && projectAgentDockLeadingContent
  ) ? projectAgentDockSession && projectAgentDockThreadScope ? (
    <WorkbenchSessionScopePath
      thread={projectAgentDockThreadScope}
      route={{
        routeKey: `/project/${encodeURIComponent(selectedProjectSceneId)}/agent-dock`,
        kind: "thread",
      }}
      selected={false}
    >
      <ProjectSessionThreadComposerDock
        session={projectAgentDockSession}
        project={activeProject}
        projects={projects}
        composerDock={{
          visible: activeProjectScene.agentDock.visible,
          target: rightPanelComposerOverlayTarget,
          visibility: {
            kind: "controlled",
            visible: activeProjectScene.agentDock.visible,
            attention: projectAgentDockAttention,
            onVisibleChange: setProjectAgentDockVisible,
          },
          leadingContent: projectAgentDockLeadingContent,
        }}
        composerScopeIdentity={projectAgentDockThreadScope.stableKey}
        browserUseViewScopeId={windowSessionId}
        newThreadStartBlockedReason={
          projectAgentDockPendingWorktreeModel?.composerBlockedReason ?? null
        }
        projectDraftId={
          activeProjectScene.agentDock.binding.kind === "new"
            ? activeProjectScene.agentDock.newDraftId
            : null
        }
        onMaterializeProjectDraft={materializeProjectAgentDockDraft}
        onRefreshProjectSessions={refreshProjectSessions}
        onEnsureBlankSessionForProject={ensureBlankSessionForProject}
        onOpenPendingWorktree={(clientThreadId) => {
          threadScopeIdentityRegistry.register(
            projectAgentDockThreadScope.stableKey,
            {
              projectSessionId:
                projectAgentDockThreadScope.projectSessionId,
              clientThreadId,
            },
          );
        }}
        onOpenLocalEnvironmentsSettings={openLocalEnvironmentsSettings}
        onOpenHooksSettings={openHooksSettings}
        threadQueueFollowUpsEnabled={threadQueueFollowUpsEnabled}
        composerEnterBehavior={composerEnterBehavior}
        onQueueingEnabledChange={handleThreadQueueFollowUpsEnabledChange}
        onOpenThread={openAttachedThreadSession}
        worktreeStartMode={worktreeStartMode}
        worktreeBranchPrefix={worktreeAutoBranchPrefix}
        commandKeymapState={commandKeymapState}
        isMac={isMacPlatform}
      />
    </WorkbenchSessionScopePath>
  ) : (
    <ProjectAgentDockUnavailableOverlay
      target={rightPanelComposerOverlayTarget}
      visible={activeProjectScene.agentDock.visible}
      attention={projectAgentDockAttention}
      onVisibleChange={setProjectAgentDockVisible}
      leadingContent={projectAgentDockLeadingContent}
      message={projectAgentDockSessionQuery.isError
        ? "This task couldn’t be loaded. Retry or choose another target."
        : "Loading task…"}
    />
  ) : null;
  const projectSceneRoute = (
    selectedProjectSceneId
    && projectSceneKey
    && activeProjectScene
    && activeProject
  ) ? (
    <>
      <WorkbenchSceneFrame
        ownerKey={projectSceneKey}
        primary={null}
        primaryTestId="project-database-surface"
        primaryHidden
        rightPanelTestId="project-right-panel"
        bottomPanelTestId="project-bottom-panel"
        layout={{
          appShellMainContentLayout: "default",
          frameBorderVisible: appShellMainContentFrameBorderVisible,
          rightPanelTargetWidth,
          bottomPanelHeight,
          rightPanel: {
            ...rightPanelMotion,
            open: sidePanelOpen,
            fullWidth: rightPanelFullWidth,
            content: projectScenePanels?.right ?? null,
          },
          bottomPanel: {
            ...bottomPanelMotion,
            open: bottomPanelOpen,
            content: projectScenePanels?.bottom ?? null,
          },
        }}
        chrome={{
          bottomPanelGlobalHeaderControls,
          setRightPanelComposerOverlayTarget,
          resizeRightPanel,
          resizeBottomPanel,
        }}
      />
      {projectAgentDock}
    </>
  ) : null;
  const activeSessionRoute =
    activeRenderSession && activeSessionPanelModel ? (
      <WorkbenchSessionScene
        session={activeRenderSession}
        model={activeSessionPanelModel}
        projects={projects}
        project={activeSessionProject}
        sessionError={selectedSessionDetailError}
        threadScopeIdentityRegistry={threadScopeIdentityRegistry}
        activateReviewTab={activateReviewTab}
        panelGroupTabs={panelGroupTabs}
        panelLifecycle={panelLifecycle}
        panelCommands={panelCommands}
        layout={{
          appShellMainContentLayout,
          frameBorderVisible: appShellMainContentFrameBorderVisible,
          rightPanelTargetWidth,
          bottomPanelHeight,
          rightPanel: rightPanelMotion,
          bottomPanel: bottomPanelMotion,
          rightPanelHeaderStartInsetWidth,
          panelTabScrollEndPaddingPx,
          bottomPanelGlobalHeaderInsetWidth,
        }}
        chrome={{
          isMac: isMacPlatform,
          commandKeymapState,
          rightPanelHeaderAfterList,
          bottomPanelGlobalHeaderControls,
          setRightPanelComposerOverlayTarget,
          resizeRightPanel,
          resizeBottomPanel,
        }}
        threadPageProps={{
          session: activeRenderSession,
          browserUseViewScopeId: windowSessionId,
          project: activeSessionProject,
          projects,
          routeActive: true,
          threadBodyVisible:
            !activeSessionPanelModel.rightPanelFullWidth,
          onRefreshProjectSessions: refreshProjectSessions,
          onEnsureBlankSessionForProject:
            ensureBlankSessionForProject,
          onStartNewChatWithPrompt: startNewChatWithPrompt,
          onOpenPendingWorktree:
            setPendingWorktreeClientThreadId,
          newThreadComposerIntent:
            newThreadComposerIntentsBySessionId[
              activeRenderSession.id
            ] ?? null,
          onConsumeNewThreadComposerIntent:
            consumeNewThreadComposerIntent,
          onRequestProjectPickerOpen,
          onOpenLocalEnvironmentsSettings:
            openLocalEnvironmentsSettings,
          onOpenHooksSettings: openHooksSettings,
          threadQueueFollowUpsEnabled,
          composerEnterBehavior,
          onQueueingEnabledChange:
            handleThreadQueueFollowUpsEnabledChange,
          onOpenThread: openAttachedThreadSession,
          onOpenSubagentsPanel: () => {
            const rootThreadId =
              activeRenderSession.thread?.threadId;
            if (!rootThreadId) return;
            void openSubagentsPanelTab(rootThreadId);
          },
          onOpenTurnDiffFileInSidePanel:
            openTurnDiffFileInSidePanel,
          turnDiffHoverPreviewDisabled:
            activeSessionPanelModel.sidePanelOpen,
          onForkSessionFromTurn: forkSessionFromTurn,
          onForkFromTurnIntoWorktree:
            forkSessionFromTurnIntoWorktree,
          worktreeStartMode,
          worktreeBranchPrefix: worktreeAutoBranchPrefix,
          searchOpenTick: threadSearchOpenTick,
          summaryPanelMounted: threadSummaryPanelMounted,
          summaryPanelOpen: threadSummaryPanelOpen,
          summaryPanelHideImmediately:
            threadSummaryPanelHideImmediately,
          summaryPanelContentShift:
            threadSummaryPanelContentShift,
          summarySideChatRows: threadSummarySideChatRows,
          summaryBrowserRows: threadSummaryBrowserRows,
          summaryScheduledAutomation:
            threadSummaryScheduledAutomation,
          summaryComputerUsePip:
            threadSummary.summaryComputerUsePip,
          onOpenSummarySideChatRow: openSummarySideChatRow,
          onOpenSummaryBrowserRow: openSummaryBrowserRow,
          onOpenSummaryScheduledAutomation:
            openSummaryScheduledAutomation,
          onOpenSummaryOutputInSidePanel:
            openSummaryOutputInSidePanel,
          onOpenProcessManager: openSummaryProcessManager,
          onOpenBackgroundTerminalOutput:
            openSummaryBackgroundTerminalOutput,
          onToggleSummaryComputerUsePip:
            threadSummary.onToggleSummaryComputerUsePip,
          rightPanelComposerOverlayEnabled,
          rightPanelComposerOverlayCompact,
          rightPanelComposerOverlayAtDocumentBottom,
          rightPanelComposerOverlayDocumentBottomKey,
          rightPanelComposerOverlayTarget,
          onOpenSideChat: filterAvailablePanelActions(
            PANEL_NEW_TAB_ACTIONS,
            activeRenderSession.tabs,
            "right",
            activeRenderSession.projectId,
            Boolean(activeRenderSession.thread),
            activeRenderSession.thread?.cwd,
            projectWorkspaceRootOrNull(activeSessionProject),
          ).some((action) => action.kind === "side_chat")
            ? (input) => openSideChat({
                ...input,
                targetPanelId: "right",
              })
            : undefined,
          onOpenMcpAppSidePanel: openMcpAppSidePanel,
          onOpenPlanInSidePanel: openPlanSidePanel,
          onClosePlanSidePanel: closePlanSidePanel,
          planSidePanelState:
            activeSessionPanelModel.threadPlanSidePanelState,
          onRequestRenameThread: () => {
            openRenameSessionDialog(activeRenderSession);
          },
          onArchiveThread: async () => {
            await archiveSession(activeRenderSession);
          },
          onToggleThreadPin: async () => {
            await toggleSessionPin(activeRenderSession);
          },
          commandKeymapState,
          isMac: isMacPlatform,
        }}
      />
    ) : null;

  const sidebarBody: WorkbenchSidebarBodyProps = {
    libraryWorkspaceEnabled,
    hasMoreProjects,
    loadingMoreProjects,
    onLoadMoreProjects,
    activeProjectId,
    activeSessionId: activeSession?.id ?? null,
    activePendingClientThreadId: pendingWorktreeClientThreadId,
    contextMenuSessionId,
    sessionCollectionsByProject,
    projectlessSessionCollection,
    sidebarThreadModel,
    pendingStableWorktrees,
    expandedProjectIds,
    pinnedProjectsSectionCollapsed,
    librarySectionCollapsed,
    projectsSectionCollapsed,
    chatsSectionCollapsed,
    onLoadMoreTaskWindow: loadMoreProjectSessionSummaries,
    onRetryTaskWindow: sessionCatalog.retryCollection,
    width: sidebarWidth,
    getWindowZoom,
    onResizeWidth: applySidebarWidth,
    onTogglePinnedProjectsSectionCollapsed: togglePinnedProjectsSectionCollapsed,
    onToggleLibrarySectionCollapsed: toggleLibrarySectionCollapsed,
    onToggleProjectsSectionCollapsed: toggleProjectsSectionCollapsed,
    onToggleChatsSectionCollapsed: toggleChatsSectionCollapsed,
    onToggleProjectExpanded: toggleProjectExpanded,
    onSelectProject: (projectId) => {
      closePendingWorktreeRoute();
      setAutomationsPath(null);
      setLibraryRoute(null);
      selectProject(projectId);
    },
    onSelectSidebarThread: (item) => {
      closePendingWorktreeRoute();
      setAutomationsPath(null);
      setLibraryRoute(null);
      void selectSidebarThread(item);
    },
    onPreviewSidebarThread: prefetchSidebarSession,
    onOpenSessionContextMenu: openSessionContextMenu,
    onSessionTitleDoubleClick: handleSessionTitleDoubleClick,
    onPendingWorktreeTitleDoubleClick: handlePendingWorktreeTitleDoubleClick,
    onArchiveSidebarThread: archiveSidebarThreadItem,
    onArchiveThreadItem: archiveSidebarThreadItemQuiet,
    onMarkThreadItemRead: markSidebarThreadItemRead,
    onThreadsChanged: refreshSidebarThreadSnapshot,
    onToggleSessionPinned: toggleSessionPin,
    onToggleSidebarThreadPinned: toggleSidebarThreadPinned,
    onStartNewChatInProject: (projectId) => {
      closePendingWorktreeRoute();
      setAutomationsPath(null);
      setLibraryRoute(null);
      void startNewChatInProject(projectId);
    },
    onOpenStableWorktree: openStableWorktreeStatus,
    onCreateStableWorktree: createStableWorktree,
    onOpenCommandPalette: openSidebarCommandPalette,
    onShowUnavailableProduct: showSidebarUnavailableProduct,
    onOpenAutomations: openAutomations,
    onOpenLibrary: openLibrary,
    onOpenLibraryTarget: openLibraryTarget,
    onOpenLibraryTargetInProject: openLibraryTargetInProject,
    activeLibraryTarget: libraryRoute?.kind === "home" ? null : libraryRoute,
    automationsActive: Boolean(automationsPath),
    projectPickerOpenTick,
    onCreateProject: async (input) => await onCreateProject(input),
    onUpdateProject: onUpdateProject ?? (async () => null),
    onArchiveProject: onArchiveProject ?? (async () => ({ kind: "not-found" })),
    onReorderProjects,
    onSetProjectPinned,
    onSetPinnedProjectOrder,
    onReorderProjectThreads: reorderProjectThreadsForSidebar,
    onReorderChatsThreads: reorderChatsThreadsForSidebar,
    onMoveSidebarThread: moveSidebarThreadForSidebar,
    onReorderPinnedThreads: reorderPinnedSidebarThreads,
    onOpenSettings: openSettings,
    account: codexAccount,
    connection: codexConnection,
    onRefreshAccount: codexAccountActions.refreshAccount,
    onConsumeRateLimitReset: codexAccountActions.consumeRateLimitReset,
    onStartChatGptLogin: codexAccountActions.startChatGptLogin,
    onStartApiKeyLogin: codexAccountActions.startApiKeyLogin,
    onCancelLogin: codexAccountActions.cancelLogin,
    onLogout: handleCodexAccountLogout,
    onAccountErrorMessage: handleCodexAccountErrorMessage,
    sidebarArchivePendingKeys,
  };

  return (
    <HeaderActionProvider actions={appShellHeaderActions}>
      <NodexTooltipProvider>
        <ContentSearchProvider
          openRequest={
            contentSearchOpenRequest ?? commandContentSearchOpenRequest
          }
        >
          <ContentSearchSurface />
          {commandPalette}
          <DesktopNotificationController
            activeThreadId={
              activeSession?.thread?.threadId ?? null
            }
            onOpenThread={(threadId) => {
              void openAttachedThreadSessionById(threadId);
            }}
          />
          <WorkbenchProcessManagerDialog
            open={processManagerOpen}
            activeThreadId={activeSession?.thread?.threadId ?? null}
            threads={processManagerThreads}
            control={workbenchCodexControl}
            onOpenChange={setProcessManagerOpen}
            onOpenThread={openAttachedThreadSession}
            onOpenOutput={openProcessManagerOutput}
          />
          <motion.div
            ref={workbenchRootRef}
            className="relative flex flex-col text-token-text-primary"
            style={{
              "--spacing-token-safe-header-left": `${safeHeaderLeftWidth}px`,
              "--spacing-token-safe-header-right": "12px",
              "--app-shell-bottom-panel-height": bottomPanelAnimatedHeightCss,
              width: "calc(100vw / var(--codex-window-zoom, 1))",
              height: "calc(100vh / var(--codex-window-zoom, 1))",
              zoom: "var(--codex-window-zoom, 1)",
            } as MotionStyle}
          >
            {activeRenderSession ? (
              <BrowserSidebarHiddenWebviewHosts
                sessionId={activeRenderSession.id}
                browserViewScopeId={windowSessionId}
                tabs={browserRetentionTabs}
                mountedTabIds={mountedBrowserTabIds}
                visibleTabIds={visibleBrowserTabIds}
              />
            ) : activeProjectScene && projectSceneKey ? (
              <BrowserSidebarHiddenWebviewHosts
                sessionId={projectSceneKey}
                browserViewScopeId={windowSessionId}
                tabs={projectBrowserRetentionTabs}
                mountedTabIds={visibleProjectBrowserTabIds}
                visibleTabIds={visibleProjectBrowserTabIds}
              />
            ) : null}
            <header
            data-testid="workbench-global-header"
            data-app-shell-header-edge-scroll={appShellHeaderEdgeScroll ? "true" : "false"}
            className={cn(
              "app-header-tint draggable pointer-events-none fixed inset-x-0 top-0 flex h-toolbar min-w-0 items-center",
              APP_SHELL_GLOBAL_HEADER_LAYER_CLASS,
            )}
          >
            <HeaderShellSlot
              side="left"
              slotWidth={headerLeftShellSlotWidth}
              minWidth={headerLeftShellSlotMinWidth}
              fallbackWidth={headerLeftFallbackWidth}
              fallbackRailWidth={headerLeftFallbackRailWidth}
              onMeasuredWidthChange={setHeaderLeftWidth}
              onMeasuredRailWidthChange={setHeaderLeftRailWidth}
            />
            {appShellHeaderCenterVisible ? (
              <motion.div
                aria-hidden={automationsRouteShell == null && rightPanelFullWidth ? "true" : undefined}
                data-testid="app-shell-header-context-menu-surface"
                className={cn(
                  "pointer-events-none ms-4 flex h-full min-w-0 flex-1 isolate items-center gap-1.5 overflow-hidden [contain:layout_paint] pe-2",
                  automationsRouteShell == null && rightPanelFullWidth && "invisible",
                )}
                style={{ marginRight: automationsDetailRailResolvedWidth }}
              >
                <div
                  data-testid="thread-stage-header-content"
                  className="pointer-events-none w-full min-w-0 flex-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto"
                >
                  {selectedProjectSceneId
                    ? null
                    : <SelectedAppShellHeaderContent />}
                </div>
                {!automationsRouteShell ? (
                  <HeaderInlineActionRail
                    slotPosition="center"
                    data-testid="thread-stage-header-summary-actions"
                    className="ms-auto"
                  />
                ) : null}
              </motion.div>
            ) : null}
            <HeaderShellSlot
              side="right"
              slotWidth={rightHeaderShellSlotWidth}
              minWidth={automationsRouteShell ? 0 : headerRightWidth}
              fallbackWidth={automationsRouteShell ? 0 : RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX}
              fallbackRailWidth={automationsRouteShell ? 0 : RIGHT_PANEL_HEADER_FALLBACK_RAIL_WIDTH_PX}
              onMeasuredWidthChange={setHeaderRightWidth}
              onMeasuredRailWidthChange={setHeaderRightRailWidth}
            />
          </header>

        <div
          ref={shellBodySize.ref}
          data-app-shell-summary-layout={threadSummaryPanelLayoutMode}
          data-app-shell-width-class={shellWidthClass}
          className="relative flex max-h-full min-h-0 w-full flex-1"
        >
          <WorkbenchRouteHost
            location={workbenchWindow.location}
            sidebarMounted={realSidebarMounted}
            settings={settingsRouteShell}
            sidebar={(
              <WorkbenchSidebar
                body={sidebarBody}
                inline={{
                  visible: showInlineSidebar,
                  animatedWidth: realSidebarMotion.animatedWidth,
                  contentOpacity: realSidebarMotion.opacity,
                  resizeDisabled: sidebarAnimating,
                }}
                floating={{
                  visible: showFloatingSidebar,
                  header: floatingSidebarHeader,
                  outerClassName: floatingSidebarOuterClassName,
                  resizing: floatingSidebarResizing,
                  reducedMotion: Boolean(reducedMotion),
                  exitX: floatingSidebarExitX,
                  transition: floatingSidebarTransition,
                  onResizeActiveChange: setFloatingSidebarResizing,
                  onHoverSurfaceOpenChange: setFloatingSidebarHoverSurfaceActive,
                }}
              />
            )}
            pendingWorktree={{
              content: () => (
              <WorkbenchSessionScopePath
                thread={resolvePendingThreadScopeDescriptor(
                  threadScopeIdentityRegistry,
                  pendingWorktreeClientThreadId!,
                )}
                route={{
                  routeKey: `/pending-worktree?clientThreadId=${encodeURIComponent(pendingWorktreeClientThreadId!)}`,
                  kind: "pending-worktree",
                }}
                selected
              >
                {pendingWorktreeRouteShell}
              </WorkbenchSessionScopePath>
              ),
            }}
            library={{ content: () => libraryRouteShell }}
            automations={{
              content: () => (
                <WorkbenchSessionScopePath
                  thread={APP_SHELL_ROUTE_THREAD_SCOPE_DESCRIPTOR}
                  route={{ routeKey: automationsPath!, kind: "automations" }}
                  selected
                >
                  {automationsRouteShell}
                </WorkbenchSessionScopePath>
              ),
              afterMain: (
                <WorkbenchAutomationDetailRail
                  mounted={automationsDetailRailMounted}
                  width={automationsDetailRailResolvedWidth}
                  onResizePointerDown={resizeAutomationDetailRail}
                  onPortalElementChange={setAutomationsDetailRailPortalElement}
                />
              ),
            }}
            session={{
              content: () => projectSceneRoute ?? activeSessionRoute ?? (
                <WorkbenchEmptyRoute
                  activeProjectId={activeProjectId}
                  projectCatalogError={projectCatalogError}
                  onRetryProjects={onRetryProjects}
                  onStartProjectlessChat={() => {
                    void startNewChatInProject(null);
                  }}
                />
              ),
              afterMain: pageStageHistoryPanelProjectId ? (
                <HistoryPanel
                  projectId={pageStageHistoryPanelProjectId}
                  pageId={pageStageHistoryModal?.pageId ?? null}
                  pageTitle={pageStageHistoryModal?.pageTitle}
                  pageNfm={pageStageHistoryModal?.pageNfm}
                  projectWorkspacePath={projectWorkspaceRootOrNull(pageStageHistoryModalProject)}
                  open={pageStageHistoryModal !== null}
                  onClose={closePageStageHistoryModal}
                  onPageMutated={() => {
                    void activeProjectKanban.refresh();
                  }}
                />
              ) : null,
            }}
          />
        </div>
          </motion.div>
        </ContentSearchProvider>
      </NodexTooltipProvider>
    </HeaderActionProvider>
  );
}
