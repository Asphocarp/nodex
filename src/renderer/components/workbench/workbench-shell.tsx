import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  ChevronDown,
  FolderOpen,
  Globe2,
  PenLine,
  Plus,
  SquareKanban,
  Table2,
  Terminal,
} from "lucide-react";
import { AppShellTabs, type AppShellTabItem } from "./app-shell-tabs";
import {
  CalendarToolbarControls,
  CalendarToolbarMonthLabel,
} from "@/components/kanban/calendar/calendar-toolbar";
import { DbViewToolbar } from "./db-view-toolbar";
import { MainViewHost } from "./main-view-host";
import { CardStage } from "./workbench-card-stage";
import { TerminalPanel } from "./workbench-terminal-panel";
import { SettingsOverlay } from "./workbench-settings-overlay";
import { buildSettingsPath } from "./workbench-settings-routes";
import { ProjectManagerPopover, ProjectMark } from "./left-sidebar-project-manager";
import { LeftSidebarWorkspaceManager } from "./left-sidebar-workspace-manager";
import { NodexDropdownItem, NodexDropdownMenu } from "@/components/ui/dropdown";
import { NodexTooltip, NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  ConnectedThreadStage,
  useCodexAppServerControl,
  useCodexThreadStartProgress,
} from "@/features/local-conversation";
import {
  loadCalendarViewState,
  normalizeCalendarAnchorDate,
  resolveCalendarVisibleDays,
  saveCalendarViewState,
  shiftCalendarAnchorDateByDays,
  type CalendarViewState,
} from "@/lib/calendar-view-state";
import type { CalendarRangeState } from "@/lib/calendar-range";
import { resolveCalendarVisibleDayCount } from "@/lib/calendar-range";
import { KANBAN_STATUS_LABELS } from "@/lib/kanban-options";
import { invoke } from "@/lib/api";
import { useKanban } from "@/lib/use-kanban";
import { cn } from "@/lib/utils";
import {
  makeDefaultSidebarTopLevelSectionsPrefs,
  normalizeSidebarTopLevelSectionOrder,
  type SidebarSectionItemLimit,
  type SidebarTopLevelSectionId,
  type SidebarTopLevelSectionsPrefs,
} from "@/lib/sidebar-section-prefs";
import type { StageRailLayoutMode } from "@/lib/stage-rail-layout-mode";
import {
  readNextPanelPeekPx,
  writeNextPanelPeekPx,
} from "@/lib/stage-rail-peek";
import { buildNewChatProjectSelectorOptions } from "@/lib/new-chat-project-selector";
import {
  readComposerEnterBehavior,
  writeComposerEnterBehavior,
  type ComposerEnterBehavior,
} from "@/lib/composer-enter-behavior";
import {
  readThreadQueueFollowUpsEnabled,
  writeThreadQueueFollowUpsEnabled,
} from "@/lib/thread-composer-follow-up-mode";
import {
  readWorktreeStartMode,
  writeWorktreeStartMode,
} from "@/lib/worktree-start-mode";
import {
  readWorktreeAutoBranchPrefix,
  writeWorktreeAutoBranchPrefix,
} from "@/lib/worktree-branch-prefix";
import {
  readSmartPrefixParsingEnabled,
  readStripSmartPrefixFromTitleEnabled,
  writeSmartPrefixParsingEnabled,
  writeStripSmartPrefixFromTitleEnabled,
} from "@/lib/smart-prefix-parsing";
import type {
  Card,
  CardRunInTarget,
  CardInput,
  CardUpdateMutationResult,
  CodexAccountSnapshot,
  CodexCollaborationModeKind,
  CodexCollaborationModePreset,
  CodexThreadSummary,
  Project,
  ProjectSession,
  ProjectSessionDbView,
  ProjectSessionTab,
  ProjectSessionThreadLink,
  WorktreeStartMode,
  WorktreeEnvironmentOption,
  WorkspaceRecord,
} from "@/lib/types";
import type { ThreadStageActions } from "@/features/local-conversation";
import {
  getDefaultDbViewPrefs,
  viewSupportsDbViewPrefs,
  type DbViewPrefs,
  type SupportedDbView,
} from "@/lib/db-view-prefs";
import type { SpaceRef, WorkbenchView } from "@/lib/use-workbench-state";
import type { CardStageSessionSnapshot } from "@/components/kanban/card-stage/types";
import { ToggleListIcon } from "./toggle-list-icon";
import {
  FLOATING_SIDEBAR_TRANSITION_DURATION_MS,
  FLOATING_SIDEBAR_TRANSITION_TIMING_FUNCTION,
  SIDEBAR_HOVER_KEEP_OPEN_MS,
  SIDEBAR_HOVER_OPEN_DELAY_MS,
  SIDEBAR_HOVER_TRIGGER_WIDTH_PX,
} from "@/lib/floating-sidebar";
import {
  CodexExpandPanelIcon,
  CodexPanelLeftHiddenIcon,
  CodexPanelLeftVisibleIcon,
  CodexPanelRightHiddenIcon,
  CodexPanelRightVisibleIcon,
  CodexRestorePanelIcon,
} from "@/components/shared/icons";
import {
  SidebarNewChatButton,
  SidebarProjectNewChatButton,
} from "./sidebar-new-chat-controls";

const COLLAPSE_CONTROL_TRAFFIC_LIGHT_OFFSET_PX = 90;
const RIGHT_PANEL_DEFAULT_WIDTH = 600;
const RIGHT_PANEL_MIN_WIDTH = 320;
const RIGHT_PANEL_MAIN_MIN_WIDTH = 352;
const TOOLBAR_BUTTON_BASE_CLASS = "border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square justify-center !px-0";
const TOOLBAR_BUTTON_GHOST_CLASS = "text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent";
const TOOLBAR_BUTTON_SECONDARY_CLASS = "text-token-foreground bg-token-foreground/5 enabled:hover:bg-token-foreground/10 data-[state=open]:bg-token-foreground/10 border-transparent";
const RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX = 36;
const DB_VIEW_TABS: Array<{ id: ProjectSessionDbView; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "kanban", label: "Board", icon: SquareKanban },
  { id: "list", label: "Table", icon: Table2 },
  { id: "toggle-list", label: "List", icon: ToggleListIcon },
  { id: "canvas", label: "Canvas", icon: PenLine },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

interface WorkbenchShellProps {
  projects: Project[];
  dbProjectId: string;
  activeView: WorkbenchView;
  activeSearchQuery: string;
  activeDbViewPrefs: DbViewPrefs | null;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  spaces?: SpaceRef[];
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string;
  sidebar?: {
    collapsed: boolean;
    width: number;
    topLevelSectionOrder?: SidebarTopLevelSectionId[];
    topLevelSections?: SidebarTopLevelSectionsPrefs;
  };
  cardStageCloseRef: React.RefObject<(() => Promise<void>) | null>;
  cardStagePersistRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  cardStageSessionSnapshotRef?: React.MutableRefObject<CardStageSessionSnapshot | null>;
  pendingReminderOpen?: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  } | null;
  setDbProject: (projectId: string) => void;
  setSearchQuery: (projectId: string, value: string) => void;
  setDbViewPrefs: (
    projectId: string,
    view: SupportedDbView,
    update: (prev: DbViewPrefs) => DbViewPrefs,
  ) => void;
  openCardStage: (projectId: string, cardId: string, titleSnapshot?: string) => void;
  onReminderHandled?: (payload: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  }) => void;
  onLeaveCardStageCard: (snapshot: CardStageSessionSnapshot) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace?: (name: string, icon?: string | null) => Promise<void>;
  onRenameWorkspace?: (workspaceId: string, name: string, icon?: string | null) => Promise<void>;
  onDeleteWorkspace?: (workspaceId: string) => Promise<void>;
  onCreateProject: (
    id: string,
    name: string,
    description?: string,
    icon?: string,
    workspacePath?: string | null,
  ) => Promise<Project | null>;
  onRenameProject: (
    oldId: string,
    newId: string,
    name?: string,
    icon?: string,
    workspacePath?: string | null,
  ) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onRequestProjectPickerOpen: () => void;
  threadSearchOpenTick: number;
  setSidebarCollapsed?: (collapsed: boolean) => void;
  setSidebarWidth?: (width: number) => void;
  setSidebarTopLevelSectionVisible?: (sectionId: SidebarTopLevelSectionId, visible: boolean) => void;
  setSidebarTopLevelSectionItemLimit?: (sectionId: SidebarTopLevelSectionId, itemLimit: SidebarSectionItemLimit) => void;
  moveSidebarTopLevelSectionBy?: (sectionId: SidebarTopLevelSectionId, direction: -1 | 1) => void;
  setSidebarStageExpanded?: unknown;
  isSidebarStageExpanded?: unknown;
  setSidebarSectionExpanded?: unknown;
  isSidebarSectionExpanded?: unknown;
  setSidebarSectionShowAll?: unknown;
  isSidebarSectionShowAll?: unknown;
  threadsProjectId?: unknown;
  recentCardSessions?: unknown;
  activeRecentSessionId?: unknown;
  focusedStage?: unknown;
  stageNavDirection?: unknown;
  cardsTabs?: unknown;
  activeCardsTabId?: unknown;
  threadsTabs?: unknown;
  activeThreadsTabId?: unknown;
  terminalTabs?: unknown;
  activeTerminalTabId?: unknown;
  filesTabs?: unknown;
  activeFilesTabId?: unknown;
  stagePanelWidths?: unknown;
  stageRailLayoutMode?: StageRailLayoutMode;
  onStageRailLayoutModeChange?: (value: StageRailLayoutMode) => void;
  slidingWindowPaneCount?: unknown;
  terminalPanelOpen?: unknown;
  terminalPanelHeight?: unknown;
  cardStageState?: unknown;
  cardStageCardId?: unknown;
  setActiveThreadsTab?: unknown;
  setThreadsTabs?: unknown;
  setActiveTerminalTab?: unknown;
  setStagePanelWidths?: unknown;
  stepSlidingWindowPaneCount?: unknown;
  setTerminalPanelOpen?: unknown;
  setTerminalPanelHeight?: unknown;
  openProjectTerminalTab?: unknown;
  openCardTerminalTab?: unknown;
  closeTerminalTab?: unknown;
  closeRecentCardSession?: unknown;
  reorderRecentCardSessions?: unknown;
  closeCardStage?: unknown;
  projectPickerOpenTick?: unknown;
  taskSearchOpenTick?: unknown;
  diffSearchOpenTick?: unknown;
  commandPaletteOpenTick?: unknown;
  commandPaletteInitialQuery?: unknown;
  settingsToggleTick?: unknown;
  navigateToStage?: unknown;
  navigateToDbView?: unknown;
  navigateToRecentSession?: unknown;
  navigateToCardsTab?: unknown;
  navigateToThreadTab?: unknown;
  navigateToFilesTab?: unknown;
  canNavigateBack?: unknown;
  canNavigateForward?: unknown;
  onNavigateBack?: unknown;
  onNavigateForward?: unknown;
  onRequestNewWindow?: unknown;
}

export function resolveCardStageSessionTabOrder(
  tabs: readonly { id: string; kind?: string; sessionId?: string; isLabel?: boolean }[],
  activeId: string,
  overId: string,
): string[] {
  const sessionIds = tabs
    .filter((tab) => tab.id !== "history")
    .map((tab) => tab.sessionId ?? tab.id.replace(/^session:/, ""));
  const from = tabs.find((tab) => tab.id === activeId)?.sessionId ?? activeId.replace(/^session:/, "");
  const to = tabs.find((tab) => tab.id === overId)?.sessionId ?? overId.replace(/^session:/, "");
  const fromIndex = sessionIds.indexOf(from);
  const toIndex = sessionIds.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return sessionIds;

  const next = [...sessionIds];
  const [item] = next.splice(fromIndex, 1);
  if (!item) return sessionIds;
  next.splice(toIndex, 0, item);
  return next;
}

export function WorkbenchStageToolbar({
  children,
  showDivider = true,
}: {
  children: ReactNode;
  showDivider?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-3 bg-token-main-surface-primary px-3",
        showDivider && "border-b border-token-border",
      )}
    >
      {children}
    </div>
  );
}

function readInitialExpandedProjects(projects: Project[], activeProjectId: string): Set<string> {
  const initial = new Set<string>();
  if (activeProjectId) initial.add(activeProjectId);
  if (projects.length === 1 && projects[0]) initial.add(projects[0].id);
  return initial;
}

function isProjectSessionDbView(value: string): value is ProjectSessionDbView {
  return DB_VIEW_TABS.some((item) => item.id === value);
}

interface ShortcutTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => Element | null;
}

function isWorkbenchNewChatShortcutTargetEditable(target: EventTarget | null): boolean {
  const element = target as ShortcutTargetLike | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") return true;
  if (!element.closest) return false;
  return Boolean(element.closest(".nfm-editor, .bn-editor, .bn-container, [role='dialog']"));
}

function getTabIcon(kind: ProjectSessionTab["kind"]): ComponentType<{ className?: string }> {
  if (kind === "db_view") return Table2;
  if (kind === "card_stage") return SquareKanban;
  if (kind === "terminal") return Terminal;
  return Globe2;
}

function clampRegularRightPanelWidth(width: number, sessionWidth: number): number {
  const maxWidth = sessionWidth > 0
    ? Math.max(RIGHT_PANEL_MIN_WIDTH, sessionWidth - RIGHT_PANEL_MAIN_MIN_WIDTH)
    : RIGHT_PANEL_DEFAULT_WIDTH;
  return Math.min(maxWidth, Math.max(RIGHT_PANEL_MIN_WIDTH, width));
}

export function WorkbenchShell({
  projects,
  dbProjectId,
  activeView,
  activeSearchQuery,
  activeDbViewPrefs,
  searchByProject,
  dbViewPrefsByProject,
  spaces = [],
  workspaces,
  activeWorkspaceId,
  sidebar,
  cardStageCloseRef,
  cardStagePersistRef,
  cardStageSessionSnapshotRef,
  pendingReminderOpen,
  setDbProject,
  setSearchQuery,
  setDbViewPrefs,
  openCardStage,
  onReminderHandled,
  onLeaveCardStageCard,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onRequestProjectPickerOpen,
  threadSearchOpenTick,
  setSidebarCollapsed,
  setSidebarWidth,
  setSidebarTopLevelSectionVisible,
  stageRailLayoutMode = "sliding-window",
  onStageRailLayoutModeChange,
  settingsToggleTick,
}: WorkbenchShellProps) {
  const fallbackProjectId = projects[0]?.id ?? "default";
  const [activeProjectId, setActiveProjectId] = useState(dbProjectId || fallbackProjectId);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, ProjectSession[]>>({});
  const [expandedProjectIds, setExpandedProjectIds] = useState(() =>
    readInitialExpandedProjects(projects, dbProjectId || fallbackProjectId),
  );
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [sessionContentWidth, setSessionContentWidth] = useState(0);
  const [headerRightWidth, setHeaderRightWidth] = useState(RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX);
  const [rightPanelFullWidthBySessionId, setRightPanelFullWidthBySessionId] = useState<Record<string, boolean>>({});
  const [localSidebarCollapsed, setLocalSidebarCollapsed] = useState(false);
  const [localSidebarWidth, setLocalSidebarWidth] = useState(300);
  const [sidebarVisible, setSidebarVisible] = useState(() => !(sidebar?.collapsed ?? false));
  const [hoverSidebarOpen, setHoverSidebarOpen] = useState(false);
  const sessionContentRef = useRef<HTMLDivElement | null>(null);
  const headerRightProbeRef = useRef<HTMLDivElement | null>(null);
  const sidebarHoverOpenTimeoutRef = useRef<number | null>(null);
  const sidebarHoverCloseTimeoutRef = useRef<number | null>(null);
  const sidebarHideTimeoutRef = useRef<number | null>(null);
  const sidebarCollapsed = sidebar?.collapsed ?? localSidebarCollapsed;
  const sidebarWidth = sidebar?.width ?? localSidebarWidth;
  const lastHandledSettingsToggleTickRef = useRef(settingsToggleTick);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPath, setSettingsPath] = useState(() => buildSettingsPath("general-settings"));
  const [nextPanelPeekPx, setNextPanelPeekPx] = useState(readNextPanelPeekPx);
  const [threadQueueFollowUpsEnabled, setThreadQueueFollowUpsEnabled] = useState(readThreadQueueFollowUpsEnabled);
  const [composerEnterBehavior, setComposerEnterBehavior] = useState<ComposerEnterBehavior>(readComposerEnterBehavior);
  const [worktreeStartMode, setWorktreeStartMode] = useState<WorktreeStartMode>(readWorktreeStartMode);
  const [worktreeAutoBranchPrefix, setWorktreeAutoBranchPrefix] = useState(readWorktreeAutoBranchPrefix);
  const [smartPrefixParsingEnabled, setSmartPrefixParsingEnabled] = useState(readSmartPrefixParsingEnabled);
  const [stripSmartPrefixFromTitleEnabled, setStripSmartPrefixFromTitleEnabled] = useState(
    readStripSmartPrefixFromTitleEnabled,
  );

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const activeSessions = activeProject ? sessionsByProject[activeProject.id] ?? [] : [];
  const activeSession = activeSessions.find((session) => session.id === activeSessionId) ?? activeSessions[0] ?? null;
  const activeTabId = activeSession?.rightPaneLayout.root.type === "leaf"
    ? activeSession.rightPaneLayout.root.activeTabId
    : activeSession?.tabs[0]?.id ?? null;
  const activeTab = activeSession?.tabs.find((tab) => tab.id === activeTabId) ?? activeSession?.tabs[0] ?? null;
  const rightPanelFullWidth = activeSession
    ? !activeSession.rightPaneCollapsed && (rightPanelFullWidthBySessionId[activeSession.id] ?? activeSession.isOverview) === true
    : false;
  const regularRightPanelWidth = clampRegularRightPanelWidth(rightPanelWidth, sessionContentWidth);
  const settingsSidebarTopLevelSectionOrder = normalizeSidebarTopLevelSectionOrder(
    sidebar?.topLevelSectionOrder,
  );
  const settingsSidebarTopLevelSections = sidebar?.topLevelSections ?? makeDefaultSidebarTopLevelSectionsPrefs();

  const openSettings = useCallback(() => {
    setSettingsPath(buildSettingsPath("general-settings"));
    setSettingsOpen(true);
  }, []);

  const openLocalEnvironmentsSettings = useCallback(() => {
    setSettingsPath(buildSettingsPath("local-environments"));
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    if (
      typeof settingsToggleTick !== "number"
      || settingsToggleTick <= 0
      || settingsToggleTick === lastHandledSettingsToggleTickRef.current
    ) {
      return;
    }

    lastHandledSettingsToggleTickRef.current = settingsToggleTick;
    setSettingsOpen((current) => !current);
  }, [settingsToggleTick]);

  const handleNextPanelPeekPxChange = useCallback((value: number) => {
    setNextPanelPeekPx(writeNextPanelPeekPx(value));
  }, []);

  const handleThreadQueueFollowUpsEnabledChange = useCallback((value: boolean) => {
    setThreadQueueFollowUpsEnabled(writeThreadQueueFollowUpsEnabled(value));
  }, []);

  const handleComposerEnterBehaviorChange = useCallback((value: ComposerEnterBehavior) => {
    setComposerEnterBehavior(writeComposerEnterBehavior(value));
  }, []);

  const handleWorktreeStartModeChange = useCallback((value: WorktreeStartMode) => {
    setWorktreeStartMode(writeWorktreeStartMode(value));
  }, []);

  const handleWorktreeAutoBranchPrefixChange = useCallback((value: string) => {
    setWorktreeAutoBranchPrefix(writeWorktreeAutoBranchPrefix(value));
  }, []);

  const handleSmartPrefixParsingEnabledChange = useCallback((value: boolean) => {
    setSmartPrefixParsingEnabled(writeSmartPrefixParsingEnabled(value));
  }, []);

  const handleStripSmartPrefixFromTitleEnabledChange = useCallback((value: boolean) => {
    setStripSmartPrefixFromTitleEnabled(writeStripSmartPrefixFromTitleEnabled(value));
  }, []);

  const refreshProjectSessions = useCallback(async (projectId: string) => {
    const sessions = (await invoke("project-sessions:list", projectId)) as ProjectSession[];
    setSessionsByProject((current) => ({ ...current, [projectId]: sessions }));
    return sessions;
  }, []);

  const refreshAllSessions = useCallback(async () => {
    if (projects.length === 0) return;
    setLoadingSessions(true);
    setSessionError(null);
    try {
      const entries = await Promise.all(
        projects.map(async (project) => [project.id, await refreshProjectSessions(project.id)] as const),
      );
      setSessionsByProject(Object.fromEntries(entries));
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Unable to load project sessions");
    } finally {
      setLoadingSessions(false);
    }
  }, [projects, refreshProjectSessions]);

  useEffect(() => {
    void refreshAllSessions();
  }, [refreshAllSessions]);

  useEffect(() => {
    const contentElement = sessionContentRef.current;
    if (!contentElement) return undefined;

    const measure = () => {
      setSessionContentWidth(contentElement.getBoundingClientRect().width);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
      };
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(contentElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [activeSession?.id]);

  useEffect(() => {
    setRightPanelWidth((current) => clampRegularRightPanelWidth(current, sessionContentWidth));
  }, [sessionContentWidth]);

  useEffect(() => {
    if (!projects.some((project) => project.id === activeProjectId)) {
      const nextProjectId = dbProjectId || fallbackProjectId;
      setActiveProjectId(nextProjectId);
      setExpandedProjectIds((current) => new Set([...current, nextProjectId]));
    }
  }, [activeProjectId, dbProjectId, fallbackProjectId, projects]);

  useEffect(() => {
    if (!activeProject) return;
    if (activeSession && activeSession.projectId === activeProject.id) return;
    const overview = activeSessions.find((session) => session.isOverview) ?? activeSessions[0] ?? null;
    startTransition(() => {
      setActiveSessionId(overview?.id ?? null);
    });
  }, [activeProject, activeSession, activeSessions]);

  const selectProject = useCallback((projectId: string) => {
    startTransition(() => {
      setActiveProjectId(projectId);
      setDbProject(projectId);
      setExpandedProjectIds((current) => new Set([...current, projectId]));
    });
  }, [setDbProject]);

  const selectSession = useCallback((session: ProjectSession) => {
    startTransition(() => {
      setActiveProjectId(session.projectId);
      setActiveSessionId(session.id);
      setDbProject(session.projectId);
      setExpandedProjectIds((current) => new Set([...current, session.projectId]));
    });
  }, [setDbProject]);

  const updateActiveSession = useCallback(async (input: Partial<ProjectSession>) => {
    if (!activeSession) return null;
    const updated = (await invoke("project-sessions:update", activeSession.id, input)) as ProjectSession | null;
    if (!updated) return null;
    await refreshProjectSessions(updated.projectId);
    return updated;
  }, [activeSession, refreshProjectSessions]);

  const setActiveTab = useCallback(async (tabId: string, options?: { openRightPanel?: boolean }) => {
    if (!activeSession || activeSession.rightPaneLayout.root.type !== "leaf") return;
    const layout = {
      ...activeSession.rightPaneLayout,
      root: {
        ...activeSession.rightPaneLayout.root,
        activeTabId: tabId,
      },
    };
    await updateActiveSession({
      rightPaneLayout: layout,
      ...(options?.openRightPanel ? { rightPaneCollapsed: false } : {}),
    });
  }, [activeSession, updateActiveSession]);

  const reorderTabs = useCallback(async (activeId: string, overId: string) => {
    if (!activeSession) return;
    const order = activeSession.tabs.map((tab) => tab.id);
    const fromIndex = order.indexOf(activeId);
    const toIndex = order.indexOf(overId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const next = [...order];
    const [item] = next.splice(fromIndex, 1);
    if (!item) return;
    next.splice(toIndex, 0, item);
    const session = (await invoke("project-session-tabs:reorder", activeSession.id, next)) as ProjectSession | null;
    if (session) await refreshProjectSessions(session.projectId);
  }, [activeSession, refreshProjectSessions]);

  const closeTab = useCallback(async (tabId: string) => {
    if (!activeSession) return;
    await invoke("project-session-tabs:delete", tabId);
    await refreshProjectSessions(activeSession.projectId);
  }, [activeSession, refreshProjectSessions]);

  const ensureActiveRightPanelOpenWithoutRefresh = useCallback(async () => {
    if (!activeSession || !activeSession.rightPaneCollapsed) return;
    await invoke("project-sessions:update", activeSession.id, { rightPaneCollapsed: false });
  }, [activeSession]);

  const openCardTab = useCallback(async (projectId: string, cardId: string, titleSnapshot?: string) => {
    if (!activeSession) {
      openCardStage(projectId, cardId, titleSnapshot);
      return;
    }

    const existing = activeSession.tabs.find((tab) =>
      tab.kind === "card_stage"
      && "cardId" in tab.config
      && tab.config.cardId === cardId
      && tab.config.projectId === projectId,
    );
    if (existing) {
      setRightPanelFullWidthBySessionId((current) => ({ ...current, [activeSession.id]: false }));
      await setActiveTab(existing.id, { openRightPanel: true });
      return;
    }

    await invoke("project-session-tabs:create", {
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
      kind: "card_stage",
      title: titleSnapshot || cardId,
      config: { projectId, cardId, titleSnapshot },
    });
    await ensureActiveRightPanelOpenWithoutRefresh();
    await refreshProjectSessions(activeSession.projectId);
  }, [activeSession, ensureActiveRightPanelOpenWithoutRefresh, openCardStage, refreshProjectSessions, setActiveTab]);

  const ensureBlankSessionForProject = useCallback(async (projectId: string) => {
    const sessions = sessionsByProject[projectId] ?? await refreshProjectSessions(projectId);
    const reusableSession = sessions.find((candidate) => !candidate.thread && !candidate.isOverview) ?? null;

    if (reusableSession) {
      selectSession(reusableSession);
      return reusableSession;
    }

    const session = (await invoke("project-sessions:create", {
      projectId,
      title: "New thread",
    })) as ProjectSession;
    await refreshProjectSessions(projectId);
    selectSession(session);
    return session;
  }, [refreshProjectSessions, selectSession, sessionsByProject]);

  const startNewChatInProject = useCallback(async (projectId: string) => {
    const session = await ensureBlankSessionForProject(projectId);
    setRightPanelFullWidthBySessionId((current) => ({ ...current, [session.id]: false }));
  }, [ensureBlankSessionForProject]);

  useEffect(() => {
    const isMacPlatformForShortcut = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = isMacPlatformForShortcut ? event.metaKey : event.ctrlKey;
      if (!modifier || event.altKey || event.shiftKey || event.key.toLowerCase() !== "n") return;
      if (isWorkbenchNewChatShortcutTargetEditable(event.target)) return;
      event.preventDefault();
      void startNewChatInProject(activeProjectId);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeProjectId, startNewChatInProject]);

  const createManualTab = useCallback(async (kind: ProjectSessionTab["kind"]) => {
    if (!activeSession) return;
    if (kind === "db_view") {
      await invoke("project-session-tabs:create", {
        sessionId: activeSession.id,
        projectId: activeSession.projectId,
        kind,
        title: "DB View",
        config: { projectId: activeSession.projectId, view: "kanban" },
      });
      await ensureActiveRightPanelOpenWithoutRefresh();
      await refreshProjectSessions(activeSession.projectId);
      return;
    }

    if (kind === "terminal") {
      await invoke("project-session-tabs:create", {
        sessionId: activeSession.id,
        projectId: activeSession.projectId,
        kind,
        title: "Terminal",
        config: {
          projectId: activeSession.projectId,
          terminalSessionId: `session:${activeSession.id}:terminal:${Date.now()}`,
          mode: "project",
        },
      });
      await ensureActiveRightPanelOpenWithoutRefresh();
      await refreshProjectSessions(activeSession.projectId);
      return;
    }

    if (kind === "browser_placeholder") {
      await invoke("project-session-tabs:create", {
        sessionId: activeSession.id,
        projectId: activeSession.projectId,
        kind,
        title: "Browser",
        config: {},
      });
      await ensureActiveRightPanelOpenWithoutRefresh();
      await refreshProjectSessions(activeSession.projectId);
      return;
    }

    const cardId = window.prompt("Card id")?.trim();
    if (!cardId) return;
    await openCardTab(activeSession.projectId, cardId, cardId);
  }, [activeSession, ensureActiveRightPanelOpenWithoutRefresh, openCardTab, refreshProjectSessions]);

  const showActiveRightPanel = useCallback(async () => {
    if (!activeSession) return;
    await updateActiveSession({ rightPaneCollapsed: false });
  }, [activeSession, updateActiveSession]);

  const hideActiveRightPanel = useCallback(async () => {
    if (!activeSession) return;
    await updateActiveSession({ rightPaneCollapsed: true });
  }, [activeSession, updateActiveSession]);

  const toggleActiveRightPanelFullWidth = useCallback(() => {
    if (!activeSession) return;
    setRightPanelFullWidthBySessionId((current) => ({
      ...current,
      [activeSession.id]: !(current[activeSession.id] ?? activeSession.isOverview),
    }));
  }, [activeSession]);

  const resizeRightPanel = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = regularRightPanelWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = clampRegularRightPanelWidth(startWidth + startX - moveEvent.clientX, sessionContentWidth);
      setRightPanelWidth(nextWidth);
    };

    const onMouseUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [regularRightPanelWidth, sessionContentWidth]);

  const tabItems = useMemo<AppShellTabItem[]>(() => {
    if (!activeSession) return [];
    return activeSession.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      icon: getTabIcon(tab.kind),
      closable: !activeSession.isOverview || activeSession.tabs.length > 1,
      reorderable: true,
      renderPanel: () => (
        <ProjectSessionTabPanel
          key={`${activeSession.id}:${tab.id}`}
          tab={tab}
          activeSession={activeSession}
          projects={projects}
          activeView={activeView}
          activeSearchQuery={activeSearchQuery}
          activeDbViewPrefs={activeDbViewPrefs}
          searchByProject={searchByProject}
          dbViewPrefsByProject={dbViewPrefsByProject}
          cardStageCloseRef={cardStageCloseRef}
          cardStagePersistRef={cardStagePersistRef}
          cardStageSessionSnapshotRef={cardStageSessionSnapshotRef}
          pendingReminderOpen={pendingReminderOpen}
          setSearchQuery={setSearchQuery}
          setDbViewPrefs={setDbViewPrefs}
          onReminderHandled={onReminderHandled}
          onLeaveCardStageCard={onLeaveCardStageCard}
          onOpenCardTab={openCardTab}
          onRefreshSessions={refreshProjectSessions}
          onCloseTab={closeTab}
        />
      ),
    }));
  }, [
    activeDbViewPrefs,
    activeSearchQuery,
    activeSession,
    activeView,
    cardStageCloseRef,
    cardStagePersistRef,
    cardStageSessionSnapshotRef,
    closeTab,
    onLeaveCardStageCard,
    onReminderHandled,
    openCardTab,
    pendingReminderOpen,
    projects,
    refreshProjectSessions,
    dbViewPrefsByProject,
    searchByProject,
    setActiveTab,
    setDbViewPrefs,
    setSearchQuery,
  ]);

  useEffect(() => {
    if (!sidebarCollapsed) {
      setSidebarVisible(true);
      setHoverSidebarOpen(false);
      return;
    }
    setSidebarVisible(false);
  }, [sidebarCollapsed]);

  const applySidebarCollapsed = useCallback((collapsed: boolean) => {
    if (setSidebarCollapsed) {
      setSidebarCollapsed(collapsed);
    } else {
      setLocalSidebarCollapsed(collapsed);
    }
  }, [setSidebarCollapsed]);

  const applySidebarWidth = useCallback((width: number) => {
    if (setSidebarWidth) {
      setSidebarWidth(width);
    } else {
      setLocalSidebarWidth(Math.min(520, Math.max(240, width)));
    }
  }, [setSidebarWidth]);

  const clearHoverSidebarOpenTimeout = useCallback(() => {
    if (sidebarHoverOpenTimeoutRef.current === null) return;
    window.clearTimeout(sidebarHoverOpenTimeoutRef.current);
    sidebarHoverOpenTimeoutRef.current = null;
  }, []);

  const clearHoverSidebarCloseTimeout = useCallback(() => {
    if (sidebarHoverCloseTimeoutRef.current === null) return;
    window.clearTimeout(sidebarHoverCloseTimeoutRef.current);
    sidebarHoverCloseTimeoutRef.current = null;
  }, []);

  const scheduleHoverSidebarOpen = useCallback(() => {
    if (!sidebarCollapsed || hoverSidebarOpen) return;
    clearHoverSidebarCloseTimeout();
    clearHoverSidebarOpenTimeout();
    sidebarHoverOpenTimeoutRef.current = window.setTimeout(() => {
      sidebarHoverOpenTimeoutRef.current = null;
      setHoverSidebarOpen(true);
    }, SIDEBAR_HOVER_OPEN_DELAY_MS);
  }, [clearHoverSidebarCloseTimeout, clearHoverSidebarOpenTimeout, hoverSidebarOpen, sidebarCollapsed]);

  const scheduleHoverSidebarClose = useCallback(() => {
    if (!sidebarCollapsed) return;
    clearHoverSidebarOpenTimeout();
    clearHoverSidebarCloseTimeout();
    sidebarHoverCloseTimeoutRef.current = window.setTimeout(() => {
      sidebarHoverCloseTimeoutRef.current = null;
      setHoverSidebarOpen(false);
    }, SIDEBAR_HOVER_KEEP_OPEN_MS);
  }, [clearHoverSidebarCloseTimeout, clearHoverSidebarOpenTimeout, sidebarCollapsed]);

  const clearSidebarHideTimeout = useCallback(() => {
    if (sidebarHideTimeoutRef.current === null) return;
    window.clearTimeout(sidebarHideTimeoutRef.current);
    sidebarHideTimeoutRef.current = null;
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    clearHoverSidebarCloseTimeout();
    clearHoverSidebarOpenTimeout();
    clearSidebarHideTimeout();
    applySidebarCollapsed(!sidebarCollapsed);
  }, [
    applySidebarCollapsed,
    clearHoverSidebarCloseTimeout,
    clearHoverSidebarOpenTimeout,
    clearSidebarHideTimeout,
    sidebarCollapsed,
  ]);

  const sidePanelOpen = activeSession ? !activeSession.rightPaneCollapsed : false;
  const toggleActiveSidePanel = useCallback(() => {
    if (!activeSession) return;
    if (activeSession.rightPaneCollapsed) {
      void showActiveRightPanel();
      return;
    }
    void hideActiveRightPanel();
  }, [activeSession, hideActiveRightPanel, showActiveRightPanel]);

  const renderSidePanelHeaderControl = () => {
    if (!activeSession) return null;

    return (
      <ToolbarIconButton label="Toggle side panel" pressed={sidePanelOpen} onClick={toggleActiveSidePanel}>
        {sidePanelOpen ? <CodexPanelRightVisibleIcon className="icon-sm" /> : <CodexPanelRightHiddenIcon className="icon-sm" />}
      </ToolbarIconButton>
    );
  };

  useEffect(() => {
    const controlsElement = headerRightProbeRef.current;
    if (!controlsElement) return undefined;

    const measure = () => {
      const width = Math.ceil(controlsElement.getBoundingClientRect().width);
      setHeaderRightWidth(width > 0 ? width : RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
      };
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(controlsElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [activeSession?.id, sidePanelOpen]);

  const rightPanelTabHeaderStickyControls = activeSession ? (
    <NodexDropdownMenu
      align="end"
      sideOffset={6}
      contentWidth="sm"
      triggerButton={(
        <button
          type="button"
          className={cn(TOOLBAR_BUTTON_BASE_CLASS, TOOLBAR_BUTTON_GHOST_CLASS)}
          title="Open side panel tab"
          aria-label="Open side panel tab"
        >
          <Plus className="icon-xs" />
        </button>
      )}
    >
      <NodexDropdownItem leftSlot={<Table2 className="icon-sm" />} onSelect={() => void createManualTab("db_view")}>
        DB view
      </NodexDropdownItem>
      <NodexDropdownItem leftSlot={<SquareKanban className="icon-sm" />} onSelect={() => void createManualTab("card_stage")}>
        Card Stage
      </NodexDropdownItem>
      <NodexDropdownItem leftSlot={<Terminal className="icon-sm" />} onSelect={() => void createManualTab("terminal")}>
        Terminal
      </NodexDropdownItem>
      <NodexDropdownItem leftSlot={<Globe2 className="icon-sm" />} onSelect={() => void createManualTab("browser_placeholder")}>
        Browser placeholder
      </NodexDropdownItem>
    </NodexDropdownMenu>
  ) : null;

  const rightPanelTabHeaderControls = activeSession ? (
    <>
      <ToolbarIconButton
        label={rightPanelFullWidth ? "Restore panel width" : "Expand panel"}
        pressed={rightPanelFullWidth}
        onClick={toggleActiveRightPanelFullWidth}
      >
        {rightPanelFullWidth ? <CodexExpandPanelIcon className="icon-sm" /> : <CodexRestorePanelIcon className="icon-sm" />}
      </ToolbarIconButton>
      <div
        aria-hidden="true"
        data-testid="right-panel-tab-bar-header-spacer"
        className="pointer-events-none flex h-full shrink-0 items-center"
        style={{ width: headerRightWidth }}
      />
    </>
  ) : null;

  const isMacPlatform = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
  const showFloatingSidebar = sidebarCollapsed;
  const showInlineSidebar = sidebarVisible && !sidebarCollapsed;
  const sidebarCollapseControlButton = (
    <button
      type="button"
      onClick={toggleSidebarCollapsed}
      title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="no-drag inline-flex size-6 items-center justify-center rounded-lg text-(--foreground-secondary) hover:bg-(--background-secondary) hover:text-(--foreground)"
    >
      {sidebarCollapsed ? <CodexPanelLeftHiddenIcon className="size-4" /> : <CodexPanelLeftVisibleIcon className="size-4" />}
    </button>
  );

  return (
    <NodexTooltipProvider>
      <div
        className="relative flex flex-col text-token-text-primary"
        style={{
          "--spacing-token-safe-header-right": "12px",
          width: "calc(100vw / var(--codex-window-zoom, 1))",
          height: "calc(100vh / var(--codex-window-zoom, 1))",
          zoom: "var(--codex-window-zoom, 1)",
        } as React.CSSProperties}
      >
        <header
          data-testid="workbench-global-header"
          className="app-header-tint draggable pointer-events-none fixed inset-x-0 top-0 z-30 flex h-toolbar min-w-0 items-center"
        >
          <div
            ref={headerRightProbeRef}
            aria-hidden="true"
            className="invisible pointer-events-none fixed top-0 left-0 min-w-max pe-2 [&_*]:![view-transition-name:none]"
          >
            <div className="inline-flex h-full items-center gap-1.5 no-drag pointer-events-auto w-auto">
              <div className="no-drag pointer-events-auto flex shrink-0 items-center ms-auto">
                {renderSidePanelHeaderControl()}
              </div>
            </div>
          </div>
          <div
            data-test-id="header-shell-slot"
            className="pointer-events-none relative h-full shrink-0 [container-type:inline-size] ml-auto pe-2"
            style={{ width: 0, minWidth: headerRightWidth }}
          >
            <div className="inline-flex h-full items-center gap-1.5 pointer-events-none w-full">
              <div className="no-drag pointer-events-auto flex shrink-0 items-center ms-auto">
                {renderSidePanelHeaderControl()}
              </div>
            </div>
          </div>
        </header>

        <div className="relative flex max-h-full min-h-0 w-full flex-1">
          {sidebarCollapsed ? (
            <div
              aria-hidden
              data-sidebar-hover-trigger="true"
              className="absolute inset-y-0 left-0 z-40"
              style={{ width: SIDEBAR_HOVER_TRIGGER_WIDTH_PX }}
              onMouseEnter={scheduleHoverSidebarOpen}
              onMouseLeave={clearHoverSidebarOpenTimeout}
            />
          ) : null}

          {showInlineSidebar ? (
            <ProjectSessionSidebar
              projects={projects}
              spaces={spaces}
              workspaces={workspaces}
              activeProjectId={activeProjectId}
              activeSessionId={activeSession?.id ?? null}
              activeWorkspaceId={activeWorkspaceId}
              sessionsByProject={sessionsByProject}
              expandedProjectIds={expandedProjectIds}
              loadingSessions={loadingSessions}
              width={sidebarWidth}
              onResizeWidth={applySidebarWidth}
              onToggleProjectExpanded={(projectId) => {
                setExpandedProjectIds((current) => {
                  const next = new Set(current);
                  if (next.has(projectId)) next.delete(projectId);
                  else next.add(projectId);
                  return next;
                });
              }}
              onSelectProject={selectProject}
              onSelectSession={selectSession}
              onStartNewChatInProject={(projectId) => void startNewChatInProject(projectId)}
              onCreateProject={async (...args) => {
                const project = await onCreateProject(...args);
                await refreshAllSessions();
                return project;
              }}
              onRenameProject={onRenameProject ?? (async () => null)}
              onDeleteProject={onDeleteProject ?? (async () => false)}
              onSelectWorkspace={onSelectWorkspace}
              onCreateWorkspace={onCreateWorkspace ?? (async () => undefined)}
              onRenameWorkspace={onRenameWorkspace ?? (async () => undefined)}
              onDeleteWorkspace={onDeleteWorkspace ?? (async () => undefined)}
              onOpenSettings={openSettings}
            />
          ) : null}

          {showFloatingSidebar ? (
            <div
              aria-hidden={!hoverSidebarOpen}
              className="pointer-events-none absolute inset-y-0 left-0 z-50"
            >
              <div
                data-testid="floating-project-session-sidebar-shell"
                className="absolute inset-y-0 overflow-hidden rounded-r-2xl border border-l-0 border-(--border)"
                style={{
                  width: sidebarWidth,
                  left: hoverSidebarOpen ? 0 : -sidebarWidth,
                  boxShadow: hoverSidebarOpen ? "0 24px 56px rgba(0,0,0,0.24)" : "none",
                  pointerEvents: hoverSidebarOpen ? "auto" : "none",
                  transitionProperty: "left, box-shadow",
                  transitionDuration: `${FLOATING_SIDEBAR_TRANSITION_DURATION_MS}ms`,
                  transitionTimingFunction: FLOATING_SIDEBAR_TRANSITION_TIMING_FUNCTION,
                }}
                onMouseEnter={clearHoverSidebarCloseTimeout}
                onMouseLeave={scheduleHoverSidebarClose}
              >
                <ProjectSessionSidebar
                  projects={projects}
                  spaces={spaces}
                  workspaces={workspaces}
                  activeProjectId={activeProjectId}
                  activeSessionId={activeSession?.id ?? null}
                  activeWorkspaceId={activeWorkspaceId}
                  sessionsByProject={sessionsByProject}
                  expandedProjectIds={expandedProjectIds}
                  loadingSessions={loadingSessions}
                  width={sidebarWidth}
                  onResizeWidth={applySidebarWidth}
                  onToggleProjectExpanded={(projectId) => {
                    setExpandedProjectIds((current) => {
                      const next = new Set(current);
                      if (next.has(projectId)) next.delete(projectId);
                      else next.add(projectId);
                      return next;
                    });
                  }}
                  onSelectProject={selectProject}
                  onSelectSession={selectSession}
                  onStartNewChatInProject={(projectId) => void startNewChatInProject(projectId)}
                  onCreateProject={async (...args) => {
                    const project = await onCreateProject(...args);
                    await refreshAllSessions();
                    return project;
                  }}
                  onRenameProject={onRenameProject ?? (async () => null)}
                  onDeleteProject={onDeleteProject ?? (async () => false)}
                  onSelectWorkspace={onSelectWorkspace}
                  onCreateWorkspace={onCreateWorkspace ?? (async () => undefined)}
                  onRenameWorkspace={onRenameWorkspace ?? (async () => undefined)}
                  onDeleteWorkspace={onDeleteWorkspace ?? (async () => undefined)}
                  onOpenSettings={openSettings}
                />
              </div>
            </div>
          ) : null}

          <main className="main-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {activeSession ? (
              <div ref={sessionContentRef} className="relative flex min-h-0 flex-1 overflow-hidden">
                <section
                  data-testid="session-thread-page"
                  data-session-thread-page-hidden={rightPanelFullWidth ? "true" : "false"}
                  data-app-shell-main-content-layout="thread-edge-scroll"
                  aria-hidden={rightPanelFullWidth ? "true" : undefined}
                  className={cn(
                    "app-shell-main-content-viewport relative flex min-h-0 min-w-0 flex-col",
                    rightPanelFullWidth ? "w-0 flex-none overflow-hidden" : "flex-1",
                  )}
                >
                  <div
                    className="app-shell-main-content-frame relative flex min-h-0 flex-1 flex-col"
                    style={{
                      "--thread-stage-header-right-reserve": sidePanelOpen ? "0px" : `${headerRightWidth}px`,
                    } as React.CSSProperties}
                  >
                    <div
                      aria-hidden="true"
                      data-app-shell-main-content-top-fade="visible"
                      className="app-shell-main-content-top-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-linear-to-b from-token-main-surface-primary to-transparent opacity-0"
                    />
                    {sessionError ? (
                      <div className="border-b border-token-border px-3 py-2 text-xs text-token-text-secondary">{sessionError}</div>
                    ) : null}
                    <SessionThreadPage
                      session={activeSession}
                      project={activeProject}
                      projects={projects}
                      onRefreshProjectSessions={refreshProjectSessions}
                      onEnsureBlankSessionForProject={ensureBlankSessionForProject}
                      onRequestProjectPickerOpen={onRequestProjectPickerOpen}
                      onOpenLocalEnvironmentsSettings={openLocalEnvironmentsSettings}
                      worktreeStartMode={worktreeStartMode}
                      worktreeBranchPrefix={worktreeAutoBranchPrefix}
                      searchOpenTick={threadSearchOpenTick}
                      sidePanelOpen={sidePanelOpen}
                      onOpenCard={(cardId) => {
                        if (!activeProject) return;
                        void openCardTab(activeProject.id, cardId, cardId);
                      }}
                    />
                  </div>
                </section>

                {!activeSession.rightPaneCollapsed ? (
                  <section
                    data-app-shell-focus-area="right-panel"
                    data-testid="session-right-panel"
                    data-right-panel-width-mode={rightPanelFullWidth ? "full" : "regular"}
                    className="relative ml-auto h-full min-h-0 min-w-0 shrink-0 overflow-visible"
                    style={{ width: rightPanelFullWidth ? "100%" : regularRightPanelWidth }}
                  >
                    {!rightPanelFullWidth ? (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize right panel"
                        className="group absolute top-0 bottom-0 left-0 z-40 flex w-4 -translate-x-2 cursor-col-resize touch-none select-none active:cursor-col-resize"
                        onMouseDown={resizeRightPanel}
                      >
                        <div className="pointer-events-none m-auto h-full w-px bg-linear-to-b from-transparent via-token-foreground/25 to-transparent opacity-0 group-hover:opacity-100 group-active:opacity-100" />
                      </div>
                    ) : null}

                    <div className="absolute inset-0 min-w-0 overflow-hidden">
                      <div
                        className={cn(
                          "absolute top-0 bottom-0 left-0 min-w-0 bg-token-main-surface-primary",
                          !rightPanelFullWidth && "border-l border-token-border",
                        )}
                        style={{
                          width: rightPanelFullWidth ? "100%" : regularRightPanelWidth,
                          "--thread-content-top-inset": "calc(var(--spacing) * 8)",
                        } as React.CSSProperties}
                      >
                        {tabItems.length > 0 && activeTab ? (
                          <AppShellTabs
                            tabs={tabItems}
                            activeTabId={activeTab.id}
                            controllerId={`session-${activeSession.id}`}
                            onSelect={(tabId) => void setActiveTab(tabId)}
                            onCloseTab={(tabId) => void closeTab(tabId)}
                            onReorderTab={(dragId, overId) => void reorderTabs(dragId, overId)}
                            afterListSticky={rightPanelTabHeaderStickyControls}
                            afterList={rightPanelTabHeaderControls}
                            headerHeight="toolbar"
                          />
                        ) : (
                          <div className="flex h-full min-h-0 flex-col">
                            <div className="flex h-toolbar min-w-0 shrink-0 items-center bg-token-main-surface-primary px-2">
                              <div className="min-w-0 flex-1" />
                              <div className="ml-1 flex shrink-0 items-center gap-1">{rightPanelTabHeaderStickyControls}</div>
                              <div className="ml-1 flex shrink-0 items-center gap-1">{rightPanelTabHeaderControls}</div>
                            </div>
                            <EmptyRightPane onCreateDbTab={() => void createManualTab("db_view")} />
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-token-text-secondary">
                Select a project session.
              </div>
            )}
          </main>
        </div>

      {isMacPlatform ? (
        <div
          className="fixed z-50 flex items-center justify-center"
          style={{
            left: COLLAPSE_CONTROL_TRAFFIC_LIGHT_OFFSET_PX,
            top: 12,
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties}
        >
          {sidebarCollapseControlButton}
        </div>
      ) : sidebarCollapsed ? (
        <div
          className="fixed left-3 top-3 z-50 flex items-center justify-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {sidebarCollapseControlButton}
        </div>
      ) : null}

        <SettingsOverlay
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          path={settingsPath}
          onPathChange={setSettingsPath}
          onRequestProjectPickerOpen={onRequestProjectPickerOpen}
          projects={projects}
          activeProjectId={activeProject?.id ?? activeProjectId}
          initialLocalEnvironmentProjectId={null}
          initialLocalEnvironmentConfigPath={null}
          sidebarTopLevelSectionOrder={settingsSidebarTopLevelSectionOrder}
          sidebarTopLevelSections={settingsSidebarTopLevelSections}
          onSidebarTopLevelSectionVisibleChange={setSidebarTopLevelSectionVisible ?? (() => undefined)}
          stageRailLayoutMode={stageRailLayoutMode}
          onStageRailLayoutModeChange={onStageRailLayoutModeChange ?? (() => undefined)}
          nextPanelPeekPx={nextPanelPeekPx}
          onNextPanelPeekPxChange={handleNextPanelPeekPxChange}
          threadQueueFollowUpsEnabled={threadQueueFollowUpsEnabled}
          onThreadQueueFollowUpsEnabledChange={handleThreadQueueFollowUpsEnabledChange}
          composerEnterBehavior={composerEnterBehavior}
          onComposerEnterBehaviorChange={handleComposerEnterBehaviorChange}
          worktreeStartMode={worktreeStartMode}
          onWorktreeStartModeChange={handleWorktreeStartModeChange}
          worktreeAutoBranchPrefix={worktreeAutoBranchPrefix}
          onWorktreeAutoBranchPrefixChange={handleWorktreeAutoBranchPrefixChange}
          smartPrefixParsingEnabled={smartPrefixParsingEnabled}
          onSmartPrefixParsingEnabledChange={handleSmartPrefixParsingEnabledChange}
          stripSmartPrefixFromTitleEnabled={stripSmartPrefixFromTitleEnabled}
          onStripSmartPrefixFromTitleEnabledChange={handleStripSmartPrefixFromTitleEnabledChange}
        />
      </div>
    </NodexTooltipProvider>
  );
}

function resolveProjectColorToken(projectId: string, spaces: SpaceRef[]): string | undefined {
  return spaces.find((space) => space.projectId === projectId)?.colorToken;
}

function ProjectSessionSidebar({
  projects,
  spaces,
  workspaces,
  activeProjectId,
  activeSessionId,
  activeWorkspaceId,
  sessionsByProject,
  expandedProjectIds,
  loadingSessions,
  width,
  onResizeWidth,
  onToggleProjectExpanded,
  onSelectProject,
  onSelectSession,
  onStartNewChatInProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onOpenSettings,
}: {
  projects: Project[];
  spaces: SpaceRef[];
  workspaces: WorkspaceRecord[];
  activeProjectId: string;
  activeSessionId: string | null;
  activeWorkspaceId: string;
  sessionsByProject: Record<string, ProjectSession[]>;
  expandedProjectIds: Set<string>;
  loadingSessions: boolean;
  width: number;
  onResizeWidth: (width: number) => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (session: ProjectSession) => void;
  onStartNewChatInProject: (projectId: string) => void | Promise<void>;
  onCreateProject: (
    id: string,
    name: string,
    description?: string,
    icon?: string,
    workspacePath?: string | null,
  ) => Promise<Project | null>;
  onRenameProject: (
    oldId: string,
    newId: string,
    name?: string,
    icon?: string,
    workspacePath?: string | null,
  ) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string, icon?: string | null) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, name: string, icon?: string | null) => Promise<void>;
  onDeleteWorkspace: (workspaceId: string) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const [manageProjectsOpen, setManageProjectsOpen] = useState(false);

  const handleSetProjectWorkspacePath = async (project: Project) => {
    try {
      const pickedPath = (await invoke("pty:pick-cwd")) as string | null;
      if (!pickedPath) return;
      await onRenameProject(project.id, project.id, project.name, undefined, pickedPath);
    } catch {
      setManageProjectsOpen(true);
    }
  };

  const handleResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = width;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (nextEvent: MouseEvent) => {
      onResizeWidth(startWidth + (nextEvent.clientX - startX));
    };

    const onMouseUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <aside
      className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden font-sans text-sm"
      style={{ width }}
      data-testid="project-session-sidebar"
    >
      <div className="draggable h-toolbar w-full shrink-0" data-testid="sidebar-drag-strip" />

      <div className="scrollbar-token min-h-0 flex-1 overflow-y-auto px-(--sidebar-shell-padding-x) py-1">
        <SidebarNewChatButton
          shortcutLabel={typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC") ? "⌘N" : "Ctrl+N"}
          onClick={() => void onStartNewChatInProject(activeProjectId)}
        />
        <section className="mb-2">
          <div
            className={cn(
              "group/top-header flex min-h-7.5 items-center gap-1 rounded-lg pl-(--sidebar-header-padding-x) pr-1 py-(--sidebar-row-padding-tight-y)",
              "text-token-input-placeholder-foreground hover:bg-sidebar-accent hover:text-(--sidebar-foreground) font-medium",
            )}
          >
            <button
              type="button"
              className="mr-auto flex min-w-0 flex-1 items-center gap-2 text-left text-xs outline-none"
              onClick={() => setManageProjectsOpen(true)}
            >
              <span className="truncate">Projects</span>
              <span className="shrink-0 text-[11px]/5 text-(--sidebar-foreground-tertiary)">
                {projects.length}
              </span>
            </button>
            <ProjectManagerPopover
              projects={projects}
              spaces={spaces}
              activeProjectId={activeProjectId}
              onSelectSpace={onSelectProject}
              onCreateProject={onCreateProject}
              onDeleteProject={onDeleteProject}
              onRenameProject={onRenameProject}
              open={manageProjectsOpen}
              onOpenChange={setManageProjectsOpen}
              side="bottom"
              align="end"
              contentClassName="w-80"
              trigger={(
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md outline-none",
                    "text-(--sidebar-foreground-tertiary) hover:bg-[color-mix(in_srgb,var(--sidebar-foreground)_8%,transparent)] hover:text-(--sidebar-foreground)",
                    "focus-visible:ring-2 focus-visible:ring-(--sidebar-ring)/35",
                  )}
                  title="Manage projects"
                  aria-label="Manage projects"
                >
                  <Plus className="size-3.5" />
                </button>
              )}
            />
          </div>

          <div className="mt-px flex min-h-0 flex-col gap-px overflow-hidden">
            {projects.map((project) => {
              const sessions = sessionsByProject[project.id] ?? [];
              const expanded = expandedProjectIds.has(project.id);
              const isActiveProject = project.id === activeProjectId;
              const workspacePath = project.workspacePath?.trim() ?? "";
              const workspaceLabel = workspacePath || "Choose project folder";
              const workspaceTitle = workspacePath || `Choose a workspace folder for ${project.name}`;
              const colorToken = resolveProjectColorToken(project.id, spaces);

              return (
                <div
                  key={project.id}
                  data-active={isActiveProject ? "true" : undefined}
                  className={cn(
                    "group/project group/folder-row rounded-xl pr-(--sidebar-header-padding-x) pl-(--sidebar-row-padding-x) py-1 min-h-7.5",
                    isActiveProject
                      ? "bg-[color-mix(in_srgb,var(--sidebar-accent)_68%,transparent)] text-(--sidebar-foreground)"
                      : "text-(--sidebar-foreground) hover:bg-(--sidebar-accent)",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-start gap-1.5">
                      <button
                        type="button"
                        className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-md text-(--sidebar-foreground-secondary) outline-none hover:bg-(--sidebar-accent) hover:text-(--sidebar-foreground) focus-visible:ring-2 focus-visible:ring-(--sidebar-ring)/35"
                        aria-label={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
                        aria-expanded={expanded}
                        onClick={() => onToggleProjectExpanded(project.id)}
                      >
                        <ChevronDown
                          className={cn(
                            "size-3 shrink-0 transition-all duration-150",
                            !expanded && "-rotate-90",
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectProject(project.id)}
                        className="flex min-w-0 flex-1 items-start gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-(--sidebar-ring)/35"
                      >
                        <span
                          className={cn(
                            "mt-0.5 inline-flex size-4.5 shrink-0 items-center justify-center rounded-md",
                            isActiveProject ? "opacity-100" : "opacity-40 grayscale",
                          )}
                        >
                          <ProjectMark
                            icon={project.icon}
                            colorToken={colorToken}
                            className="text-sm leading-none"
                            dotClassName="h-2.5 w-2.5"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-baseline gap-1.5">
                            <span className="truncate text-sm">{project.name}</span>
                            <span className="shrink-0 text-[11px]/4 text-(--sidebar-foreground-tertiary)">
                              /{project.id}
                            </span>
                          </span>
                        </span>
                      </button>
                      <SidebarProjectNewChatButton
                        label={`Start new chat in ${project.name}`}
                        onClick={() => void onStartNewChatInProject(project.id)}
                      />
                    </div>

                    {isActiveProject ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleSetProjectWorkspacePath(project);
                        }}
                        title={workspaceTitle}
                        aria-label={workspaceTitle}
                        className={cn(
                          "mt-0.5 ml-10 flex min-w-0 max-w-full items-center gap-1 rounded-md text-[11px]/4 outline-none focus-visible:ring-2 focus-visible:ring-(--sidebar-ring)/35",
                          "text-(--sidebar-foreground-secondary) hover:text-(--sidebar-foreground)",
                        )}
                      >
                        <FolderOpen className="size-3 shrink-0" />
                        <span className="truncate">{workspaceLabel}</span>
                      </button>
                    ) : null}

                    {expanded ? (
                      <div className="mt-px flex min-h-0 flex-col gap-px overflow-hidden pl-10">
                        {sessions.map((session) => (
                          <button
                            key={session.id}
                            type="button"
                            data-session-row="true"
                            className={cn(
                              "group/session inline-flex min-h-7 w-full items-center gap-1.5 rounded-lg px-[var(--sidebar-row-padding-x)] py-(--sidebar-row-padding-tight-y) text-left",
                              activeSessionId === session.id
                                ? "bg-[color-mix(in_srgb,var(--sidebar-accent)_85%,transparent)] text-(--sidebar-foreground)"
                                : "text-(--sidebar-foreground-secondary) hover:bg-(--sidebar-accent) hover:text-(--sidebar-foreground)",
                            )}
                            onClick={() => onSelectSession(session)}
                          >
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                session.thread
                                  ? "bg-token-text-link-foreground"
                                  : "bg-[color-mix(in_srgb,var(--sidebar-foreground)_22%,transparent)]",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm">{session.title}</span>
                            {session.isOverview ? (
                              <span className="shrink-0 text-[10px]/4 text-(--sidebar-foreground-tertiary)">default</span>
                            ) : null}
                          </button>
                        ))}
                        {sessions.length === 0 && loadingSessions ? (
                          <div className="px-(--sidebar-row-padding-x) py-1 text-xs text-(--sidebar-foreground-tertiary)">
                            Loading sessions...
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <LeftSidebarWorkspaceManager
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={onSelectWorkspace}
        onOpenSettings={onOpenSettings}
        onCreateWorkspace={onCreateWorkspace}
        onRenameWorkspace={onRenameWorkspace}
        onDeleteWorkspace={onDeleteWorkspace}
      />

      <div
        onMouseDown={handleResizeStart}
        className="group absolute top-0 right-0 bottom-0 z-20 flex w-3 translate-x-1.5 cursor-col-resize touch-none select-none active:cursor-col-resize"
      >
        <div
          aria-hidden
          className="pointer-events-none m-auto h-full w-px bg-linear-to-b from-transparent via-(--border) to-transparent group-hover:via-(--foreground-tertiary) group-active:via-(--foreground-tertiary)"
        />
      </div>
    </aside>
  );
}

function EmptyRightPane({ onCreateDbTab }: { onCreateDbTab: () => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <button
        type="button"
        className="rounded-lg bg-token-foreground/5 px-3 py-2 text-sm text-token-text-secondary hover:bg-token-foreground/10 hover:text-token-text-primary"
        onClick={onCreateDbTab}
      >
        Add DB view
      </button>
    </div>
  );
}

function ToolbarIconButton({
  label,
  pressed,
  className,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <NodexTooltip tooltipContent={label} side="bottom">
      <button
        type="button"
        className={cn(
          TOOLBAR_BUTTON_BASE_CLASS,
          pressed ? TOOLBAR_BUTTON_SECONDARY_CLASS : TOOLBAR_BUTTON_GHOST_CLASS,
          className,
        )}
        title={label}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
      >
        {children}
      </button>
    </NodexTooltip>
  );
}

function SessionThreadPage({
  session,
  project,
  projects,
  onRefreshProjectSessions,
  onEnsureBlankSessionForProject,
  onRequestProjectPickerOpen,
  onOpenLocalEnvironmentsSettings,
  worktreeStartMode,
  worktreeBranchPrefix,
  onOpenCard,
  searchOpenTick,
  sidePanelOpen,
}: {
  session: ProjectSession;
  project: Project | null;
  projects: Project[];
  onRefreshProjectSessions: (projectId: string) => Promise<ProjectSession[]>;
  onEnsureBlankSessionForProject: (projectId: string) => Promise<ProjectSession>;
  onRequestProjectPickerOpen: () => void;
  onOpenLocalEnvironmentsSettings: () => void;
  worktreeStartMode: WorktreeStartMode;
  worktreeBranchPrefix: string;
  onOpenCard: (cardId: string) => void;
  searchOpenTick: number;
  sidePanelOpen: boolean;
}) {
  const projectId = project?.id ?? session.projectId;
  const summary = session.thread ? makeThreadSummary(session.thread) : null;
  const [selectedNewThreadProjectId, setSelectedNewThreadProjectId] = useState(projectId);
  const [selectedNewThreadRunInTarget, setSelectedNewThreadRunInTarget] = useState<CardRunInTarget>("localProject");
  const [selectedNewThreadEnvironmentPath, setSelectedNewThreadEnvironmentPath] = useState<string | null>(null);
  const [newThreadEnvironmentOptions, setNewThreadEnvironmentOptions] = useState<WorktreeEnvironmentOption[]>([]);
  const [newThreadEnvironmentsLoading, setNewThreadEnvironmentsLoading] = useState(false);
  const selectedNewThreadProject = projects.find((candidate) => candidate.id === selectedNewThreadProjectId) ?? project;
  const effectiveProjectId = summary ? projectId : selectedNewThreadProject?.id ?? projectId;
  const codexControl = useCodexAppServerControl(effectiveProjectId);
  const threadStartProgress = useCodexThreadStartProgress(effectiveProjectId, session.id);
  const [collaborationModes, setCollaborationModes] = useState<CodexCollaborationModePreset[]>([]);
  const [selectedCollaborationMode, setSelectedCollaborationMode] = useState<CodexCollaborationModeKind>("default");
  const projectSelectorOptions = useMemo(() => buildNewChatProjectSelectorOptions(projects), [projects]);

  useEffect(() => {
    if (summary) return;
    setSelectedNewThreadProjectId(projectId);
    setSelectedNewThreadRunInTarget("localProject");
    setSelectedNewThreadEnvironmentPath(null);
  }, [projectId, session.id, summary]);

  useEffect(() => {
    if (projects.some((candidate) => candidate.id === selectedNewThreadProjectId)) return;
    setSelectedNewThreadProjectId(projectId);
  }, [projectId, projects, selectedNewThreadProjectId]);

  useEffect(() => {
    void codexControl.loadModels().catch(() => undefined);
    void codexControl.listCollaborationModes()
      .then(setCollaborationModes)
      .catch(() => setCollaborationModes([]));
  }, [codexControl.loadModels, codexControl.listCollaborationModes, effectiveProjectId]);

  const refreshNewThreadEnvironments = useCallback(async () => {
    setNewThreadEnvironmentsLoading(true);
    try {
      const options = await invoke("worktrees:environments:list", effectiveProjectId);
      setNewThreadEnvironmentOptions(options as WorktreeEnvironmentOption[]);
    } catch {
      setNewThreadEnvironmentOptions([]);
    } finally {
      setNewThreadEnvironmentsLoading(false);
    }
  }, [effectiveProjectId]);

  useEffect(() => {
    if (summary || selectedNewThreadRunInTarget !== "newWorktree") return;
    void refreshNewThreadEnvironments();
  }, [refreshNewThreadEnvironments, selectedNewThreadRunInTarget, summary]);

  const actions = useMemo(() => makeSessionThreadStageActions({
    activeThreadId: summary?.threadId ?? null,
    codexControl,
    onOpenCard,
    onEnsureBlankSessionForProject,
    onRefreshProjectSessions,
    currentSessionProjectId: session.projectId,
    projectId: effectiveProjectId,
    onNewThreadProjectChange: setSelectedNewThreadProjectId,
    onRequestNewChatProjectCreate: onRequestProjectPickerOpen,
    onNewThreadStartInTargetChange: (target) => {
      setSelectedNewThreadRunInTarget(target.runInTarget);
      if (target.runInTarget !== "newWorktree") setSelectedNewThreadEnvironmentPath(null);
    },
    onNewThreadStartInEnvironmentChange: setSelectedNewThreadEnvironmentPath,
    onRefreshNewThreadStartInEnvironments: refreshNewThreadEnvironments,
    onOpenNewThreadLocalEnvironmentsSettings: onOpenLocalEnvironmentsSettings,
    selectedCollaborationMode,
    setSelectedCollaborationMode,
  }), [
    codexControl,
    onOpenCard,
    onEnsureBlankSessionForProject,
    onRefreshProjectSessions,
    onRequestProjectPickerOpen,
    onOpenLocalEnvironmentsSettings,
    refreshNewThreadEnvironments,
    effectiveProjectId,
    session.projectId,
    selectedCollaborationMode,
    summary?.threadId,
  ]);

  return (
    <div className="h-full min-h-0">
      <ConnectedThreadStage
        projectId={effectiveProjectId}
        projectWorkspacePath={summary ? project?.workspacePath ?? null : selectedNewThreadProject?.workspacePath ?? null}
        isNewThreadTab={!summary}
        newThreadTarget={summary ? null : {
          projectId: effectiveProjectId,
          projectName: selectedNewThreadProject?.name ?? effectiveProjectId,
          sessionId: session.id,
          threadTitle: "New thread",
          runInTarget: selectedNewThreadRunInTarget,
          runInEnvironmentPath: selectedNewThreadEnvironmentPath,
          worktreeStartMode,
          worktreeBranchPrefix,
        }}
        newThreadProjectSelector={summary ? null : {
          projects: projectSelectorOptions,
          selectedProjectId: effectiveProjectId,
          disabled: false,
          canAddProject: true,
        }}
        showHeaderSeparator={sidePanelOpen}
        newThreadStartInSelector={summary ? null : {
          target: {
            runInTarget: selectedNewThreadRunInTarget,
            runInEnvironmentPath: selectedNewThreadEnvironmentPath,
            worktreeStartMode,
            worktreeBranchPrefix,
          },
          disabled: false,
          worktreeAvailable: Boolean(selectedNewThreadProject?.workspacePath),
          environments: newThreadEnvironmentOptions,
          environmentsLoading: newThreadEnvironmentsLoading,
          selectedEnvironmentPath: selectedNewThreadEnvironmentPath,
          worktreeStartMode,
          worktreeBranchPrefix,
        }}
        threadStartProgress={summary ? null : threadStartProgress}
        activeThreadId={summary?.threadId ?? null}
        activeThreadSummary={summary}
        availableModels={codexControl.availableModels}
        collaborationModes={collaborationModes}
        selectedCollaborationMode={selectedCollaborationMode}
        selectedModel={codexControl.threadSettings.model ?? ""}
        selectedReasoningEffort={codexControl.threadSettings.reasoningEffort ?? "medium"}
        reasoningEffortOptions={codexControl.reasoningEffortOptions}
        permissionMode={codexControl.permissionMode}
        isQueueingEnabled
        composerEnterBehavior="enter"
        searchOpenTick={searchOpenTick}
        actions={actions}
      />
    </div>
  );
}

function makeThreadSummary(thread: ProjectSessionThreadLink): CodexThreadSummary {
  return {
    threadId: thread.threadId,
    projectId: thread.projectId,
    cardId: null,
    source: thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : null,
    threadName: thread.threadName ?? null,
    threadPreview: thread.threadPreview,
    modelProvider: thread.modelProvider,
    cwd: thread.cwd ?? null,
    statusType: thread.statusType as CodexThreadSummary["statusType"],
    statusActiveFlags: thread.statusActiveFlags as CodexThreadSummary["statusActiveFlags"],
    archived: thread.archived,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    linkedAt: thread.linkedAt,
  };
}

function makeNoopThreadStageActions(onOpenCard: (cardId: string) => void): ThreadStageActions {
  const noopAsync = async () => undefined;
  return {
    onCollaborationModeChange: () => undefined,
    onModelChange: () => undefined,
    onReasoningEffortChange: () => undefined,
    onPermissionModeChange: () => undefined,
    onQueueingEnabledChange: () => undefined,
    onRefreshAccount: async () => ({
      isAuthenticated: false,
      authMethod: null,
      account: null,
      requiresOpenAiAuth: false,
    }) as unknown as CodexAccountSnapshot,
    onStartChatGptLogin: async () => ({ type: "apiKey" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: noopAsync,
    onLogout: noopAsync,
    onStartThreadForCard: noopAsync,
    onSendPrompt: noopAsync,
    onSteerPrompt: async () => undefined,
    onInterruptTurn: async () => undefined,
    onRespondApproval: async () => undefined,
    onRespondUserInput: async () => undefined,
    onRespondMcpElicitation: async () => undefined,
    onResolvePlanImplementationRequest: noopAsync,
    onEnqueueQueuedFollowUp: noopAsync,
    onRemoveQueuedFollowUp: noopAsync,
    onReorderQueuedFollowUps: noopAsync,
    onSendQueuedFollowUpNow: noopAsync,
    onEditQueuedFollowUp: noopAsync,
    onEditLastUserTurn: noopAsync,
    onForkFromTurn: noopAsync,
    onOpenTurnDiffReview: () => undefined,
    onConsumeComposerIntent: () => undefined,
    onOpenThread: () => undefined,
    onCleanBackgroundTerminals: async () => undefined,
    onOpenCard,
  };
}

function makeSessionThreadStageActions(input: {
  activeThreadId: string | null;
  codexControl: ReturnType<typeof useCodexAppServerControl>;
  currentSessionProjectId: string;
  onOpenCard: (cardId: string) => void;
  onEnsureBlankSessionForProject: (projectId: string) => Promise<ProjectSession>;
  onRefreshProjectSessions: (projectId: string) => Promise<ProjectSession[]>;
  onNewThreadProjectChange: (projectId: string) => void;
  onRequestNewChatProjectCreate: () => void;
  onNewThreadStartInTargetChange: ThreadStageActions["onNewThreadStartInTargetChange"];
  onNewThreadStartInEnvironmentChange: ThreadStageActions["onNewThreadStartInEnvironmentChange"];
  onRefreshNewThreadStartInEnvironments: NonNullable<ThreadStageActions["onRefreshNewThreadStartInEnvironments"]>;
  onOpenNewThreadLocalEnvironmentsSettings: NonNullable<ThreadStageActions["onOpenNewThreadLocalEnvironmentsSettings"]>;
  projectId: string;
  selectedCollaborationMode: CodexCollaborationModeKind;
  setSelectedCollaborationMode: (mode: CodexCollaborationModeKind) => void;
}): ThreadStageActions {
  const base = makeNoopThreadStageActions(input.onOpenCard);
  return {
    ...base,
    onCollaborationModeChange: input.setSelectedCollaborationMode,
    onModelChange: input.codexControl.setThreadModel,
    onReasoningEffortChange: input.codexControl.setThreadReasoningEffort,
    onPermissionModeChange: (mode) => {
      void input.codexControl.setPermissionMode(input.projectId, mode);
    },
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
    onSendPrompt: async (prompt, opts) => {
      if (!input.activeThreadId) return;
      await input.codexControl.startTurn(input.activeThreadId, prompt, {
        projectId: input.projectId,
        collaborationMode: opts?.collaborationMode,
        promptInput: opts?.promptInput,
      });
    },
    onSteerPrompt: async (steerInput) => {
      if (!input.activeThreadId) return;
      await input.codexControl.steerTurn({
        ...steerInput,
        threadId: input.activeThreadId,
      });
    },
    onInterruptTurn: async (turnId) => {
      if (!input.activeThreadId) return;
      await input.codexControl.interruptTurn(input.activeThreadId, turnId);
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
    onEnqueueQueuedFollowUp: async (threadId, prompt, opts) => {
      await input.codexControl.enqueueQueuedFollowUp(threadId, prompt, {
        projectId: input.projectId,
        collaborationMode: opts?.collaborationMode,
        promptInput: opts?.promptInput,
      });
    },
  };
}

function ProjectSessionTabPanel({
  tab,
  activeSession,
  projects,
  activeView,
  activeSearchQuery,
  activeDbViewPrefs,
  searchByProject,
  dbViewPrefsByProject,
  cardStageCloseRef,
  cardStagePersistRef,
  cardStageSessionSnapshotRef,
  pendingReminderOpen,
  setSearchQuery,
  setDbViewPrefs,
  onReminderHandled,
  onLeaveCardStageCard,
  onOpenCardTab,
  onRefreshSessions,
  onCloseTab,
}: {
  tab: ProjectSessionTab;
  activeSession: ProjectSession;
  projects: Project[];
  activeView: WorkbenchView;
  activeSearchQuery: string;
  activeDbViewPrefs: DbViewPrefs | null;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  cardStageCloseRef: React.RefObject<(() => Promise<void>) | null>;
  cardStagePersistRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  cardStageSessionSnapshotRef?: React.MutableRefObject<CardStageSessionSnapshot | null>;
  pendingReminderOpen?: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  } | null;
  setSearchQuery: (projectId: string, value: string) => void;
  setDbViewPrefs: (
    projectId: string,
    view: SupportedDbView,
    update: (prev: DbViewPrefs) => DbViewPrefs,
  ) => void;
  onReminderHandled?: (payload: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  }) => void;
  onLeaveCardStageCard: (snapshot: CardStageSessionSnapshot) => void;
  onOpenCardTab: (projectId: string, cardId: string, titleSnapshot?: string) => Promise<void>;
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  onCloseTab: (tabId: string) => Promise<void>;
}) {
  if (tab.kind === "db_view" && "view" in tab.config) {
    return (
      <DbViewSessionTab
        tab={tab}
        projects={projects}
        activeView={activeView}
        activeSearchQuery={activeSearchQuery}
        activeDbViewPrefs={activeDbViewPrefs}
        searchByProject={searchByProject}
        dbViewPrefsByProject={dbViewPrefsByProject}
        cardStageCloseRef={cardStageCloseRef}
        pendingReminderOpen={pendingReminderOpen}
        setSearchQuery={setSearchQuery}
        setDbViewPrefs={setDbViewPrefs}
        onReminderHandled={onReminderHandled}
        onOpenCardTab={onOpenCardTab}
        onRefreshSessions={onRefreshSessions}
      />
    );
  }

  if (tab.kind === "card_stage" && "cardId" in tab.config && "projectId" in tab.config) {
    const cardTab = tab as ProjectSessionTab & {
      config: { projectId: string; cardId: string; titleSnapshot?: string };
    };
    return (
      <CardStageSessionTab
        tab={cardTab}
        project={projects.find((item) => item.id === cardTab.config.projectId) ?? null}
        closeRef={cardStageCloseRef}
        persistRef={cardStagePersistRef}
        sessionSnapshotRef={cardStageSessionSnapshotRef}
        onLeaveCard={onLeaveCardStageCard}
        onClose={() => void onCloseTab(tab.id)}
        onOpenTerminal={async (card) => {
          await invoke("project-session-tabs:create", {
            sessionId: activeSession.id,
            projectId: activeSession.projectId,
            kind: "terminal",
            title: `${card.title || card.id} Terminal`,
            config: {
              projectId: cardTab.config.projectId,
              terminalSessionId: `card:${activeSession.id}:${card.id}`,
              mode: "card",
              cardId: card.id,
            },
          });
          await onRefreshSessions(activeSession.projectId);
        }}
      />
    );
  }

  if (tab.kind === "terminal" && "terminalSessionId" in tab.config) {
    return (
      <div className="h-full min-h-0 bg-token-main-surface-primary">
        <TerminalPanel
          projectId={tab.config.projectId}
          cardId={tab.config.cardId ?? tab.config.projectId}
          mode={tab.config.mode}
          sessionId={tab.config.terminalSessionId}
          onClose={() => void onCloseTab(tab.id)}
          panelHeight={Number.MAX_SAFE_INTEGER}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-token-main-surface-primary text-sm text-token-text-secondary">
      Browser tabs are reserved for a future browser stage.
    </div>
  );
}

function DbViewSessionTab({
  tab,
  projects,
  activeView,
  activeSearchQuery,
  activeDbViewPrefs,
  searchByProject,
  dbViewPrefsByProject,
  cardStageCloseRef,
  pendingReminderOpen,
  setSearchQuery,
  setDbViewPrefs,
  onReminderHandled,
  onOpenCardTab,
  onRefreshSessions,
}: {
  tab: ProjectSessionTab;
  projects: Project[];
  activeView: WorkbenchView;
  activeSearchQuery: string;
  activeDbViewPrefs: DbViewPrefs | null;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  cardStageCloseRef: React.RefObject<(() => Promise<void>) | null>;
  pendingReminderOpen?: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  } | null;
  setSearchQuery: (projectId: string, value: string) => void;
  setDbViewPrefs: (
    projectId: string,
    view: SupportedDbView,
    update: (prev: DbViewPrefs) => DbViewPrefs,
  ) => void;
  onReminderHandled?: (payload: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  }) => void;
  onOpenCardTab: (projectId: string, cardId: string, titleSnapshot?: string) => Promise<void>;
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
}) {
  const config = "view" in tab.config ? tab.config : { projectId: tab.projectId, view: activeView };
  const view = isProjectSessionDbView(config.view) ? config.view : activeView;
  const rulesView = viewSupportsDbViewPrefs(view) ? view : null;
  const dbViewPrefs = rulesView
    ? dbViewPrefsByProject[config.projectId]?.[rulesView]
      ?? (config.projectId === tab.projectId && view === activeView ? activeDbViewPrefs : null)
      ?? getDefaultDbViewPrefs(rulesView)
    : null;
  const activeProjectBoard = useKanban({
    projectId: config.projectId,
    sessionId: `${tab.id}:toolbar`,
  }).board;
  const [calendarState, setCalendarState] = useState<CalendarViewState>(() => loadCalendarViewState());
  const [calendarCreateRequestId, setCalendarCreateRequestId] = useState(0);
  const [taskSearchOpen, setTaskSearchOpen] = useState(false);
  const calendarVisibleDays = useMemo(() => resolveCalendarVisibleDays(calendarState), [calendarState]);
  const calendarDayCount = resolveCalendarVisibleDayCount(calendarState.range);
  const taskSearchInputRef = useRef<HTMLInputElement | null>(null);
  const searchQuery = searchByProject[config.projectId] ?? (config.projectId === tab.projectId ? activeSearchQuery : "");
  const availableTags = useMemo(() => {
    if (!activeProjectBoard) return [];
    return Array.from(
      new Set(activeProjectBoard.columns.flatMap((column) => column.cards.flatMap((card) => card.tags))),
    ).sort((left, right) => left.localeCompare(right));
  }, [activeProjectBoard]);

  useEffect(() => {
    saveCalendarViewState(calendarState);
  }, [calendarState]);

  const openTaskSearch = useCallback((selectQuery = false) => {
    setTaskSearchOpen(true);
    window.requestAnimationFrame(() => {
      const input = taskSearchInputRef.current;
      if (!input) return;
      input.focus();
      if (selectQuery) input.select();
    });
  }, []);

  const closeTaskSearch = useCallback(() => {
    setTaskSearchOpen(false);
  }, []);

  const handleCalendarRangeChange = useCallback((range: CalendarRangeState) => {
    setCalendarState((current) => ({ ...current, range }));
  }, []);

  const handleCalendarAnchorDateChange = useCallback((update: (anchorDate: Date) => Date) => {
    setCalendarState((current) => ({
      ...current,
      anchorDate: normalizeCalendarAnchorDate(update(current.anchorDate)),
    }));
  }, []);

  const handleCalendarToday = useCallback(() => {
    setCalendarState((current) => ({
      ...current,
      anchorDate: normalizeCalendarAnchorDate(new Date()),
    }));
  }, []);

  const handleCalendarPrev = useCallback(() => {
    handleCalendarAnchorDateChange((anchorDate) => shiftCalendarAnchorDateByDays(anchorDate, -calendarDayCount));
  }, [calendarDayCount, handleCalendarAnchorDateChange]);

  const handleCalendarNext = useCallback(() => {
    handleCalendarAnchorDateChange((anchorDate) => shiftCalendarAnchorDateByDays(anchorDate, calendarDayCount));
  }, [calendarDayCount, handleCalendarAnchorDateChange]);

  const handleCalendarCreate = useCallback(() => {
    setCalendarCreateRequestId((current) => current + 1);
  }, []);

  const selectView = async (nextView: ProjectSessionDbView) => {
    await invoke("project-session-tabs:update", tab.id, {
      config: {
        projectId: config.projectId,
        view: nextView,
      },
      title: DB_VIEW_TABS.find((item) => item.id === nextView)?.label ?? "DB View",
    });
    await onRefreshSessions(tab.projectId);
  };

  const toolbarItems = DB_VIEW_TABS.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    active: item.id === view,
    onSelect: () => {
      void selectView(item.id);
    },
  }));
  const calendarToolbarControls = view === "calendar" ? (
    <CalendarToolbarControls
      range={calendarState.range}
      onRangeChange={handleCalendarRangeChange}
      onCreate={handleCalendarCreate}
      onToday={handleCalendarToday}
      onPrev={handleCalendarPrev}
      onNext={handleCalendarNext}
    />
  ) : null;
  const calendarToolbarContextLabel = view === "calendar" ? (
    <CalendarToolbarMonthLabel visibleDays={calendarVisibleDays} />
  ) : null;
  const updateDbViewPrefs = rulesView
    ? (update: (prev: DbViewPrefs) => DbViewPrefs) => setDbViewPrefs(config.projectId, rulesView, update)
    : null;
  const searchShortcutLabel =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC") ? "⌘F" : "Ctrl+F";

  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
      <DbViewToolbar
        items={toolbarItems}
        activeSearchQuery={searchQuery}
        taskSearchOpen={taskSearchOpen}
        showSearchControls={view !== "calendar"}
        searchShortcutLabel={searchShortcutLabel}
        taskSearchInputRef={taskSearchInputRef}
        rulesView={rulesView}
        dbViewPrefs={dbViewPrefs}
        availableTags={availableTags}
        viewContextLabel={calendarToolbarContextLabel}
        calendarControls={calendarToolbarControls}
        onUpdateDbViewPrefs={updateDbViewPrefs}
        onSearchQueryChange={(value) => setSearchQuery(config.projectId, value)}
        onOpenTaskSearch={openTaskSearch}
        onCloseTaskSearch={closeTaskSearch}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <MainViewHost
          projectId={config.projectId}
          projects={projects}
          view={view}
          searchQuery={searchQuery}
          dbViewPrefs={dbViewPrefs}
          onUpdateDbViewPrefs={updateDbViewPrefs}
          cardStageCloseRef={cardStageCloseRef}
          pendingReminderOpen={pendingReminderOpen}
          calendarState={calendarState}
          calendarVisibleDays={calendarVisibleDays}
          calendarCreateRequestId={calendarCreateRequestId}
          onCalendarAnchorDateChange={handleCalendarAnchorDateChange}
          onReminderHandled={onReminderHandled}
          openCardStage={(projectId, cardId, titleSnapshot) => {
            void onOpenCardTab(projectId, cardId, titleSnapshot);
          }}
        />
      </div>
    </div>
  );
}

function CardStageSessionTab({
  tab,
  project,
  closeRef,
  persistRef,
  sessionSnapshotRef,
  onLeaveCard,
  onClose,
  onOpenTerminal,
}: {
  tab: ProjectSessionTab & { config: { projectId: string; cardId: string; titleSnapshot?: string } };
  project: Project | null;
  closeRef: React.RefObject<(() => Promise<void>) | null>;
  persistRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  sessionSnapshotRef?: React.MutableRefObject<CardStageSessionSnapshot | null>;
  onLeaveCard: (snapshot: CardStageSessionSnapshot) => void;
  onClose: () => void;
  onOpenTerminal: (card: Card) => Promise<void>;
}) {
  const kanban = useKanban({ projectId: tab.config.projectId, sessionId: tab.id });
  const refreshBoard = kanban.refresh;

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  const card = kanban.cardIndex.get(tab.config.cardId) ?? null;
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const column of kanban.board?.columns ?? []) {
      for (const item of column.cards) {
        item.tags.forEach((tag) => tags.add(tag));
      }
    }
    return [...tags].sort((left, right) => left.localeCompare(right));
  }, [kanban.board?.columns]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-token-text-secondary">
        Project not found.
      </div>
    );
  }

  const columnId = card?.status ?? "draft";
  const columnName = KANBAN_STATUS_LABELS[columnId] ?? columnId;

  return (
    <CardStage
      card={card}
      columnId={columnId}
      columnName={columnName}
      projectId={tab.config.projectId}
      projectWorkspacePath={project.workspacePath ?? null}
      availableTags={availableTags}
      closeRef={closeRef as React.MutableRefObject<(() => Promise<void>) | null>}
      persistRef={persistRef}
      sessionSnapshotRef={sessionSnapshotRef}
      onClose={onClose}
      onLeaveCard={onLeaveCard}
      onPatch={(nextColumnId: string, cardId: string, updates: Partial<CardInput>) => {
        kanban.patchCard(nextColumnId, cardId, updates);
      }}
      onUpdate={async (nextColumnId: string, cardId: string, updates: Partial<CardInput>): Promise<CardUpdateMutationResult> => (
        await kanban.updateCard(nextColumnId, cardId, updates)
      )}
      onDelete={async (nextColumnId: string, cardId: string) => {
        const deleted = await kanban.deleteCard(nextColumnId, cardId);
        if (deleted) onClose();
      }}
      onMove={async (fromStatus, cardId, toStatus) => {
        await kanban.moveCard({ fromStatus, cardId, toStatus });
      }}
      onCompleteOccurrence={async (cardId, occurrenceStart) => {
        await kanban.completeOccurrence({ cardId, occurrenceStart, source: "card-stage" });
      }}
      onSkipOccurrence={async (cardId, occurrenceStart) => {
        await kanban.skipOccurrence({ cardId, occurrenceStart, source: "card-stage" });
      }}
      onOpenTerminalPanel={() => {
        if (!card) return;
        void onOpenTerminal(card);
      }}
      linkedCodexThreads={[]}
    />
  );
}
