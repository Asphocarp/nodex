import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import type {
  PageStageHistoryModalContext,
} from "./workbench-page-stage-panel";
import {
  HeaderAction,
  HeaderActionProvider,
  HeaderInlineActionRail,
  HeaderShellSlot,
} from "./workbench-header-actions";
import { HistoryPanel } from "./workbench-history-panel";
import { useTerminalSessionStoreVersion } from "@/lib/terminal-session-store";
import { BrowserSidebarHiddenWebviewHosts } from "@/features/browser-sidebar/browser-sidebar-hidden-webview-hosts";
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
import type { OpenPageStageOptions } from "@/components/kanban/open-page-stage";
import { NodexTooltip, NodexTooltipProvider } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { appScope, useScopeHandle } from "@/lib/maitai";
import { openModal } from "@/lib/modal-registry";
import {
  useCodexAppServerControl,
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
import type { WorkbenchCommandPort } from "@/lib/use-workbench-command-ingress";
import {
  APP_SHELL_ROUTE_THREAD_SCOPE_DESCRIPTOR,
  SelectedAppShellHeaderContent,
  WorkbenchSessionScopePath,
  createThreadScopeIdentityRegistry,
  resolvePendingThreadScopeDescriptor,
} from "@/lib/workbench-ui-scopes";
import {
  type WorkbenchSessionViewSnapshot,
} from "../../../shared/workbench-session-view";
import {
  applyForkBrowserTransferToWorkbenchView,
  applyWorkbenchViewTabPatch,
  presentWorkbenchSessionDomainWithView,
  workbenchViewTabFromCreateInput,
} from "@/lib/window-session-view-adapter";
import { useWorkbenchSessionCatalog } from "@/lib/use-workbench-session-catalog";
import { useWorkbenchPanelController } from "@/lib/use-workbench-panel-controller";
import { useWorkbenchPanelLifecycle } from "@/lib/use-workbench-panel-lifecycle";
import { useWorkbenchPanelOpeners } from "@/lib/use-workbench-panel-openers";
import { useWorkbenchPanelCommandRouter } from "@/lib/use-workbench-panel-command-router";
import { useWorkbenchSessionCommands } from "@/lib/use-workbench-session-commands";
import {
  useWorkbenchPanelProjection,
  type PanelGroupTabsByPanel,
} from "./use-workbench-panel-projection";
import { useWorkbenchSidebarController } from "./use-workbench-sidebar-controller";
import { useWorkbenchSidebarChrome } from "./use-workbench-sidebar-chrome";
import { WorkbenchPanelNewTabButton } from "./workbench-panel-new-tab-button";
import { WorkbenchActiveSession } from "./workbench-active-session";
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
  type WorkbenchSessionRenderProjection,
} from "@/lib/workbench-session-presentation";
import type { CodexPendingWorktreeEntry } from "../../../shared/codex-pending-worktree";
import { buildBrowserUseRouteCaptureCommand } from "@/lib/browser-use-route-capture";
import { useBrowserUsePresentationCoordinator } from "@/lib/use-browser-use-presentation-coordinator";
import { useWorkbenchPreferences } from "./use-workbench-preferences";
import {
  useWorkbenchWindowState,
} from "@/lib/use-workbench-window-state";
import {
  getWorkbenchSessionReturnLocation,
  type WorkbenchLayoutSnapshotV4,
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

const RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX = 70;
const RIGHT_PANEL_HEADER_FALLBACK_RAIL_WIDTH_PX = 62;
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
  initialWindowLayoutSnapshot: WorkbenchLayoutSnapshotV4;
  libraryWorkspaceEnabled: boolean;
  projects: Project[];
  hasMoreProjects?: boolean;
  loadingMoreProjects?: boolean;
  onLoadMoreProjects?: () => Promise<void>;
  projectCatalogError?: string | null;
  onRetryProjects?: () => Promise<void> | void;
  setSessionView?: (
    sessionId: string,
    update:
      | WorkbenchSessionViewSnapshot
      | ((previous: WorkbenchSessionViewSnapshot | undefined) => WorkbenchSessionViewSnapshot),
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
  onPageDeepLinkHandled?: (payload: {
    projectId: string;
    pageId: string;
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
  setSessionView: observeSessionViewMutation,
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
  onPageDeepLinkHandled,
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
  const sessionLocation = getWorkbenchSessionReturnLocation(
    workbenchWindow.location,
  );
  const activeProjectId = sessionLocation.activeProjectId;
  const activeSessionId =
    sessionLocation.kind === "session" ? sessionLocation.sessionId : null;
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
    observeSessionViewMutation,
  });
  const sessionsByProject =
    sessionCatalog.projectionsByProject as Record<string, ProjectSession[]>;
  const projectlessSessions =
    sessionCatalog.projectlessProjections as ProjectSession[];
  const loadingSessions = sessionCatalog.loading;
  const taskWindowHasMoreByScope = sessionCatalog.hasMoreByScope;
  const sessionsReady = sessionCatalog.ready;
  const sessionError = sessionCatalog.error;
  const loadMoreProjectSessionSummaries = sessionCatalog.loadMore;
  const resolveSessionView = sessionCatalog.resolveView;
  const resolveProjectDefaultDatabaseViewId =
    sessionCatalog.resolveDefaultDatabaseViewId;
  const mutateSessionView = sessionCatalog.mutateView;
  const panelController = useWorkbenchPanelController({
    mutateView: mutateSessionView,
  });
  const panelControllerRef = useRef(panelController);
  panelControllerRef.current = panelController;
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

  const activeProject = sessionCatalog.activeProject;
  const activeSessions = useMemo(
    () => activeProject ? sessionsByProject[activeProject.id] ?? [] : [],
    [activeProject, sessionsByProject],
  );
  const activeSession = sessionCatalog.activeProjection;
  const createSessionViewTab = useCallback((
    input: WorkbenchTabCreateInput,
  ): WorkbenchTabProjection | null => {
    if (!activeSession || input.sessionId !== activeSession.id) return null;
    const tab = workbenchViewTabFromCreateInput(input);
    const next = panelControllerRef.current.durable.createTab(
      activeSession,
      {
        panelId: input.panelId,
        targetLeafId: input.targetLeafId,
        tab,
      },
    );
    return presentWorkbenchSessionDomainWithView(activeSession, next).tabs
      .find((candidate) => candidate.id === tab.id) ?? null;
  }, [activeSession]);
  const updateSessionViewTab = useCallback((
    tabId: string,
    patch: Parameters<typeof applyWorkbenchViewTabPatch>[1],
  ): WorkbenchTabProjection | null => {
    if (!activeSession) return null;
    const current = resolveSessionView(activeSession);
    const tab = current.tabsById[tabId];
    if (!tab) return null;
    const nextTab = applyWorkbenchViewTabPatch(tab, patch);
    const next = panelControllerRef.current.durable.updateTab(
      activeSession,
      tabId,
      nextTab,
    );
    return presentWorkbenchSessionDomainWithView(activeSession, next).tabs
      .find((candidate) => candidate.id === tabId) ?? null;
  }, [activeSession, resolveSessionView]);
  const activeRenderSession = activeSession;
  const activeBrowserRouteConversationId = activeRenderSession?.id ?? null;
  const activeBrowserRouteCodexSessionId =
    activeRenderSession?.thread?.threadId ?? activeBrowserRouteConversationId;
  const activeBrowserRouteProjectId = activeRenderSession?.projectId ?? null;
  useEffect(() => {
    const command = buildBrowserUseRouteCaptureCommand({
      browserConversationId: activeBrowserRouteConversationId,
      browserViewScopeId: windowSessionId,
      codexSessionId: activeBrowserRouteCodexSessionId,
      projectId: activeBrowserRouteProjectId,
    });
    if (!command) return;
    void invoke("browser-sidebar-command", command);
  }, [
    activeBrowserRouteCodexSessionId,
    activeBrowserRouteConversationId,
    activeBrowserRouteProjectId,
    windowSessionId,
  ]);
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
        (view) => applyForkBrowserTransferToWorkbenchView(view, snapshot),
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
  const rightPanel = activeSessionPanelModel?.rightPanel ?? null;
  const bottomPanel = activeSessionPanelModel?.bottomPanel ?? null;
  const sidePanelOpen = activeSessionPanelModel?.sidePanelOpen ?? false;
  const bottomPanelOpen = activeSessionPanelModel?.bottomPanelOpen ?? false;
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
  const rightPanelFullWidth = activeSessionPanelModel?.rightPanelFullWidth ?? false;
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
    if (!activeSession) {
      panelControllerRef.current.updatePanelCollapsedOverrides((current) => Object.keys(current).length === 0 ? current : {});
      return;
    }

    const rightKey = makeWorkbenchPanelSlotKey(activeSession.id, "right");
    const bottomKey = makeWorkbenchPanelSlotKey(activeSession.id, "bottom");
    panelControllerRef.current.updatePanelCollapsedOverrides((current) => {
      const rightMatches = current[rightKey] === activeSession.panels.right.collapsed;
      const bottomMatches = current[bottomKey] === activeSession.panels.bottom.collapsed;
      if (!rightMatches && !bottomMatches) {
        return current;
      }

      const next = { ...current };
      if (rightMatches) delete next[rightKey];
      if (bottomMatches) delete next[bottomKey];
      return next;
    });
  }, [
    activeSession,
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
    navigateToLibraryRoute(target);
  }, [navigateToLibraryRoute]);

  const sidebarController = useWorkbenchSidebarController({
    projects,
    sessionsByProject,
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
    activatePanelGroup,
  } = panelLifecycle;
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
    openPageTab,
  } = panelOpeners;

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
  } = panelCommands;

  const chromeCommands = useWorkbenchChromeCommands({
    activeSession,
    rightPanelFullWidth,
    controller: panelController,
    lifecycle: panelLifecycle,
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

  useEffect(() => {
    const atMediumWidth = shellWidthClass !== "wide";
    const atNarrowWidth = shellWidthClass === "narrow";
    const crossedMediumWidth = atMediumWidth !== shellAtMediumWidthRef.current;
    const crossedNarrowWidth = atNarrowWidth !== shellAtNarrowWidthRef.current;
    if (!crossedMediumWidth && !crossedNarrowWidth) return;

    shellAtMediumWidthRef.current = atMediumWidth;
    shellAtNarrowWidthRef.current = atNarrowWidth;

    if (!activeSession) return;

    const shouldClearRightPanel =
      (crossedMediumWidth && atMediumWidth && sidebarOpen && sidePanelOpen)
      || (crossedNarrowWidth && atNarrowWidth && sidePanelOpen);
    if (shouldClearRightPanel) {
      setFloatingSidebarFocusActive(false);
      const overrideKey = makeWorkbenchPanelSlotKey(activeSession.id, "right");
      panelControllerRef.current.updatePanelCollapsedOverrides((current) => ({ ...current, [overrideKey]: true }));
      void updateActivePanel("right", {
        collapsed: true,
        size: {
          ...activeSession.panels.right.size,
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
    activeSession,
    setFloatingSidebarFocusActive,
    setSidebarCollapsedWithCodexState,
    sidePanelOpen,
    sidebarOpen,
    shellWidthClass,
    updateActivePanel,
    updateSessionViewTab,
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
    if (!activeSession) return;
    if (!sidePanelOpen) {
      void showActiveRightPanel();
      return;
    }
    void hideActiveRightPanel();
  }, [activeSession, hideActiveRightPanel, showActiveRightPanel, sidePanelOpen]);

  const toggleActiveBottomPanel = useCallback(() => {
    if (!activeSession) return;
    if (!bottomPanelOpen) {
      void showActiveBottomPanel();
      return;
    }
    void hideActiveBottomPanel();
  }, [activeSession, bottomPanelOpen, hideActiveBottomPanel, showActiveBottomPanel]);

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
      if (!sessionsReady) {
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
    sessionsReady,
    toggleSettings,
    toggleSidebarCollapsed,
  ]);

  useEffect(() => {
    if (!onRegisterCommandPort) return undefined;
    return onRegisterCommandPort(commandPort);
  }, [commandPort, onRegisterCommandPort]);

  useEffect(() => {
    if (!sessionsReady) return;
    const pending =
      pendingWorkbenchCommandInvocationsRef.current.splice(0);
    for (const invocation of pending) {
      executeWorkbenchCommand(invocation);
    }
  }, [executeWorkbenchCommand, sessionsReady]);

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

  const panelHeaderActions = activeSession ? (
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

  const renderPanelNewTabButton = (
    session: ProjectSession,
    panelId: PanelId,
    leafId: string,
  ) => (
    <WorkbenchPanelNewTabButton
      session={session}
      projects={projects}
      panelId={panelId}
      leafId={leafId}
      isMac={isMacPlatform}
      commandKeymapState={commandKeymapState}
      commands={{ ...panelCommands, activatePanelGroup }}
    />
  );

  const rightPanelHeaderStartInsetWidth = activeSession && rightPanelFullWidth && sidebarLogicalCollapsed
    ? effectiveHeaderLeftWidth
    : 0;
  const panelTabScrollEndPaddingPx = activeSession ? 28 : 0;
  const bottomPanelGlobalHeaderInsetWidth = activeSession ? 40 : 0;

  const rightPanelHeaderAfterList = activeSession ? (
    <>
      <div className="no-drag pointer-events-auto flex h-full shrink-0 items-center">
        <ToolbarIconButton
          label={rightPanelFullWidth ? "Restore panel width" : "Expand panel"}
          pressed={rightPanelFullWidth}
          onClick={toggleActiveRightPanelFullWidth}
        >
          {rightPanelFullWidth ? <CodexRestorePanelIcon className="icon-xs" /> : <CodexExpandPanelIcon className="icon-xs" />}
        </ToolbarIconButton>
      </div>
      <div
        aria-hidden="true"
        data-testid="right-panel-tab-bar-header-spacer"
        className="no-drag pointer-events-none h-full shrink-0"
        style={{ width: `calc(${headerRightWidth}px)` }}
      />
    </>
  ) : null;

  const bottomPanelGlobalHeaderControls = activeSession ? (
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
      await openPageTab(projectId, target.pageId, title, {
        openMode: "durable",
      });
      return;
    }
    setLibraryRoute({
      ...target,
      accessProjectId: projectId,
    });
  }, [libraryWorkspaceEnabled, openPageTab, selectProject, setLibraryRoute]);
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
      activeSession != null
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
  const activeSessionRoute =
    activeRenderSession && activeSessionPanelModel ? (
      <WorkbenchActiveSession
        session={activeRenderSession}
        model={activeSessionPanelModel}
        projects={projects}
        project={activeSessionProject}
        sessionError={sessionError}
        threadScopeIdentityRegistry={threadScopeIdentityRegistry}
        activateReviewTab={activateReviewTab}
        panelGroupTabs={panelGroupTabs}
        panelLifecycle={panelLifecycle}
        panelCommands={panelCommands}
        renderPanelNewTabButton={renderPanelNewTabButton}
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
          project: activeSessionProject,
          projects,
          routeActive: true,
          threadBodyVisible:
            !activeSessionPanelModel.rightPanelFullWidth,
          onRefreshProjectSessions: refreshProjectSessions,
          onEnsureBlankSessionForProject:
            ensureBlankSessionForProject,
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
    sessionsByProject,
    projectlessSessions,
    sidebarThreadModel,
    pendingStableWorktrees,
    expandedProjectIds,
    pinnedProjectsSectionCollapsed,
    librarySectionCollapsed,
    projectsSectionCollapsed,
    chatsSectionCollapsed,
    loadingSessions,
    taskWindowHasMoreByScope,
    onLoadMoreTaskWindow: loadMoreProjectSessionSummaries,
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
                codexSessionId={
                  activeRenderSession.thread?.threadId ?? activeRenderSession.id
                }
                browserViewScopeId={windowSessionId}
                tabs={browserRetentionTabs}
                mountedTabIds={mountedBrowserTabIds}
                visibleTabIds={visibleBrowserTabIds}
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
                  <SelectedAppShellHeaderContent />
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
              content: () => activeSessionRoute ?? (
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
