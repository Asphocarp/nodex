import {
  Fragment,
  forwardRef,
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion, useTransform, type MotionStyle, type MotionValue } from "motion/react";
import {
  ArrowLeft,
  CalendarDays,
  Globe2,
  PenLine,
  SquareKanban,
  Table2,
} from "lucide-react";
import type { AppShellTabItem } from "./app-shell-tabs";
import { PanelGroupTree } from "./panel-group-tree";
import {
  HeaderAction,
  HeaderActionProvider,
  HeaderShellSlot,
} from "./workbench-header-actions";
import {
  CalendarToolbarControls,
  CalendarToolbarMonthLabel,
} from "@/components/kanban/calendar/calendar-toolbar";
import { DbViewToolbar } from "./db-view-toolbar";
import { MainViewHost } from "./main-view-host";
import { CardStage } from "./workbench-card-stage";
import { HistoryPanel } from "./workbench-history-panel";
import { TerminalPanel } from "./workbench-terminal-panel";
import { BrowserSidebarHiddenWebviewHosts } from "@/features/browser-sidebar/browser-sidebar-hidden-webview-hosts";
import { BrowserSidebarPanel } from "@/features/browser-sidebar/browser-sidebar-panel";
import {
  WorkspaceFilesPanel,
  getWorkspaceFileDomTabId,
  getWorkspaceFileName,
  type WorkspaceFilesTab,
} from "@/features/workspace-files";
import { CommandPalette } from "./workbench-shell-deps";
import { SettingsRouteShell } from "./workbench-settings-overlay";
import { buildSettingsPath } from "./workbench-settings-routes";
import { LeftSidebarFooter } from "./left-sidebar-footer";
import { SidebarProjectAddMenu } from "./sidebar-project-add-menu";
import {
  NodexDropdownFlyoutSubmenuItem,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSeparator,
} from "@/components/ui/dropdown";
import { NodexButton } from "@/components/ui/button";
import {
  NodexDialog,
  NodexDialogContent,
  NodexDialogFooter,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { ShortcutKeycaps } from "@/components/ui/shortcut-keycaps";
import { NodexTooltip, NodexTooltipProvider } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import {
  ConnectedThreadStage,
  ConnectedReviewDiffPanel,
  ThreadSummaryPanelHeaderAction,
  useCodexAppServerControl,
  useConversation,
  useCodexThreadStartProgress,
  useLocalConversationAccount,
  useLocalConversationConnection,
} from "@/features/local-conversation";
import { createThreadStageActions } from "@/features/local-conversation/thread-action-controller";
import { McpCapabilityViewFrame } from "@/features/local-conversation/view/shared/tools/mcp-capability-view-frame";
import {
  loadCalendarViewState,
  normalizeCalendarAnchorDate,
  resolveCalendarVisibleDays,
  saveCalendarViewState,
  shiftCalendarAnchorDateByDays,
  type CalendarViewState,
} from "@/lib/calendar-view-state";
import {
  APP_SHELL_GLOBAL_HEADER_LAYER_CLASS,
  APP_SHELL_RIGHT_PANEL_LAYER_CLASS,
} from "@/lib/app-shell-layers";
import type { CalendarRangeState } from "@/lib/calendar-range";
import { resolveCalendarVisibleDayCount } from "@/lib/calendar-range";
import { KANBAN_STATUS_LABELS } from "@/lib/kanban-options";
import { invoke, subscribeProjectSessionChanges } from "@/lib/api";
import { useKanban } from "@/lib/use-kanban";
import { useCardDetail } from "@/lib/card-detail-store";
import { cn } from "@/lib/utils";
import {
  makeDefaultSidebarTopLevelSectionsPrefs,
  normalizeSidebarTopLevelSectionOrder,
  type SidebarSectionItemLimit,
  type SidebarTopLevelSectionId,
  type SidebarTopLevelSectionsPrefs,
} from "@/lib/sidebar-section-prefs";
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
import { ThreadHeaderPortalProvider } from "@/lib/thread-header-portal";
import {
  CODEX_SHELL_MEDIUM_WIDTH_PX,
  CODEX_SHELL_NARROW_WIDTH_PX,
  resolveCodexAnimatedPanelSize,
  resolveCodexHeaderEdgeScroll,
  resolveCodexMainContentFrameBorder,
  resolveCodexMainContentTargetWidth,
  resolveCodexSummaryContentShift,
  resolveCodexSummaryPanelLayoutMode,
  useCodexAnimatedPanelState,
  type ThreadSummaryPanelLayoutMode,
} from "@/lib/codex-panel-motion";
import {
  findNearestProjectSessionPanelLeafToRight,
  findProjectSessionPanelLeaf,
  findProjectSessionPanelLeafForTab,
  getProjectSessionPanelActiveLeaf,
  listProjectSessionPanelLeaves,
} from "../../../shared/project-session-panel-layout";
import { resolveSameLeafInsertionIndex } from "./panel-tab-dnd";
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
import { PROJECT_SESSION_SINGLETON_TAB_KINDS } from "@/lib/types";
import type {
  Card,
  CardSummary,
  CardRunInTarget,
  CardInput,
  CardUpdateMutationResult,
  CodexAccountSnapshot,
  CodexCollaborationModeKind,
  CodexConnectionState,
  CodexCollaborationModePreset,
  CodexThreadSummary,
  CodexTurnDiffReviewTarget,
  CodexPromptInput,
  PanelId,
  Project,
  ProjectCreateInput,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
  ProjectUpdateInput,
  ProjectSession,
  ProjectSessionDbView,
  ProjectSessionForkResult,
  ProjectSessionTab,
  ProjectSessionTabCreateInput,
  ProjectSessionThreadLink,
  ProjectSessionPanelSplitSide,
  WorktreeStartMode,
  WorktreeEnvironmentOption,
} from "@/lib/types";
import type { ThreadActionControllerInput, ThreadStageActions } from "@/features/local-conversation";
import type {
  ThreadMcpAppSidePanelInput,
  ThreadSummaryPanelAuxiliaryRow,
} from "@/features/local-conversation/thread-stage-types";
import {
  getDefaultDbViewPrefs,
  viewSupportsDbViewPrefs,
  type DbViewPrefs,
  type SupportedDbView,
} from "@/lib/db-view-prefs";
import type { RecentCardSession, SpaceRef, StageId, WorkbenchView } from "@/lib/use-workbench-state";
import type { CardStageSessionSnapshot } from "@/components/kanban/card-stage/types";
import { buildSessionDeepLink } from "@/lib/card-deeplink";
import { writeTextToClipboard } from "@/lib/clipboard";
import { showNativeContextMenu } from "@/lib/native-context-menu";
import {
  SESSION_CONTEXT_MENU_ACTION_IDS,
  buildSessionContextMenuItems,
  canForkSessionLocally,
  resolveSessionRevealPath,
  type SessionContextMenuActionId,
} from "./session-context-menu-model";
import { ToggleListIcon } from "./toggle-list-icon";
import {
  CODEX_SIDEBAR_FLOATING_ASIDE_CLASS,
  CODEX_SIDEBAR_FLOATING_HEADER_CLASS,
  CODEX_SIDEBAR_POINTER_DEFAULT,
  CODEX_SIDEBAR_WIDTH_DEFAULT_PX,
  clampCodexSidebarWidth,
  deriveCodexSidebarFloatingVisibility,
  getCodexSidebarFloatingOuterClassName,
  getCodexSidebarFloatingTransition,
  normalizeCodexSidebarPointer,
  shouldAnimateCodexSidebarToggle,
  shouldCollapseCodexSidebarResizeWidth,
  shouldClearCodexSidebarHoverSuppression,
  shouldSuppressCodexSidebarHoverOpen,
  type CodexSidebarPointerSnapshot,
} from "@/lib/codex-sidebar-auto-reveal";
import {
  CodexAutomationsIcon,
  CodexCloseIcon,
  CodexExpandPanelIcon,
  CodexPanelBottomHiddenIcon,
  CodexPanelBottomVisibleIcon,
  CodexPanelRightHiddenIcon,
  CodexPanelRightVisibleIcon,
  CodexRestorePanelIcon,
  CodexSidebarHiddenIcon,
  CodexSidebarVisibleIcon,
  CodexSidePanelBrowserIcon,
  CodexSidePanelFilesIcon,
  CodexSidePanelPlusIcon,
  CodexSidePanelReviewIcon,
  CodexSidePanelSideChatIcon,
  CodexSidePanelTerminalIcon,
  ComposerPluginsIcon,
  SearchIcon,
  SpinnerIcon,
} from "@/components/shared/icons";
import {
  SIDEBAR_COLLAPSED_CHROME_BUTTON_CLASS,
  SidebarCompactNewChatButton,
  SidebarNewChatButton,
} from "./sidebar-new-chat-controls";
import { useCodexAccountActions } from "@/lib/use-codex-account-actions";
import {
  CodexProjectRow,
  CodexProjectSessionList,
  CodexSidebarSection,
  CodexSidebarTopAction,
  CodexThreadRow,
  resolveCodexCommandPaletteShortcutLabel,
  resolveCodexNewChatShortcutLabel,
} from "./codex-sidebar";
import {
  replaceVisibleOrder,
  SidebarDropIndicator,
  SidebarProjectDndProvider,
  SidebarProjectSortableContext,
  usePinnedProjectDroppable,
  useSidebarGroupReorderController,
  type SidebarGroupDndController,
} from "./sidebar-project-group-dnd";
import {
  resolveWorkbenchNavigationShortcutLabel,
  WORKBENCH_NAVIGATION_COMMANDS,
  type WorkbenchNavigationCommandRequest,
  type WorkbenchNavigationCommandState,
  type WorkbenchPanelTabCloseCommandRequest,
  type WorkbenchPanelTabCycleCommandRequest,
  type WorkbenchPanelTabCycleDirection,
  type WorkbenchSidebarToggleCommandSource,
} from "../../../shared/window-navigation";
import {
  navigateBackInWorkbenchShellHistory,
  navigateForwardInWorkbenchShellHistory,
  readWorkbenchShellNavigationHistoryState,
  recordWorkbenchShellNavigationTransition,
  writeWorkbenchShellNavigationHistoryState,
  type WorkbenchShellNavigationSnapshot,
} from "@/lib/workbench-shell-navigation-history";

const MAC_TRAFFIC_LIGHT_SAFE_HEADER_LEFT_PX = 82;
const NON_MAC_SAFE_HEADER_LEFT_PX = 12;
const RIGHT_PANEL_DEFAULT_WIDTH = 600;
const RIGHT_PANEL_MIN_WIDTH = 320;
const RIGHT_PANEL_MAIN_MIN_WIDTH = 352;
const BOTTOM_PANEL_DEFAULT_HEIGHT = 280;
const BOTTOM_PANEL_MIN_HEIGHT = 160;
const TOOLBAR_BUTTON_BASE_CLASS = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square justify-center !px-0";
const TOOLBAR_BUTTON_GHOST_CLASS = "text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent";
const TOOLBAR_BUTTON_SECONDARY_CLASS = "text-token-foreground bg-token-foreground/5 enabled:hover:bg-token-foreground/10 data-[state=open]:bg-token-foreground/10 border-transparent";
const RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX = 70;
const RIGHT_PANEL_HEADER_FALLBACK_RAIL_WIDTH_PX = 62;
const LEFT_HEADER_COLLAPSED_RAIL_FALLBACK_WIDTH_PX = 126;
const THREAD_SUMMARY_PANEL_STORAGE_KEY = "nodex:thread-summary-panel:pinned-open";
const PROJECT_SESSION_SINGLETON_TAB_KIND_SET = new Set<string>(PROJECT_SESSION_SINGLETON_TAB_KINDS);
type SidebarResizePhase = "live" | "end" | "reset";
type SidebarResizeSurface = "inline" | "floating";
const PREVIEWABLE_PROJECT_SESSION_TAB_KIND_SET = new Set<ProjectSessionTab["kind"]>([
  "browser",
  "files",
]);
const PANEL_ACTION_ROW_CLASS = "cursor-interaction flex min-h-10 w-full items-center gap-2 rounded-md bg-token-bg-secondary px-2.5 py-2 text-left hover:bg-token-list-hover-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-token-border-xstrong";
const PANEL_ACTION_KBD_CLASS = "inline-flex !rounded-md !border-0 !bg-current/10 !font-sans !text-xs !text-current !shadow-none !px-1.5 !py-0.5 !leading-none";
type PanelNewTabActionKind = ProjectSessionTab["kind"] | "side_chat";

const CODEX_PANEL_OPTION_ACTION_ORDER: PanelNewTabActionKind[] = [
  "review",
  "terminal",
  "browser",
  "files",
  "side_chat",
];
const NODEX_PANEL_OPTION_ACTION_ORDER: ProjectSessionTab["kind"][] = [
  "db_view",
  "card_stage",
];
const NODEX_PANEL_OPTION_ACTION_KIND_SET = new Set<ProjectSessionTab["kind"]>(
  NODEX_PANEL_OPTION_ACTION_ORDER,
);
const DB_VIEW_TABS: Array<{ id: ProjectSessionDbView; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "kanban", label: "Board", icon: SquareKanban },
  { id: "list", label: "Table", icon: Table2 },
  { id: "toggle-list", label: "List", icon: ToggleListIcon },
  { id: "canvas", label: "Canvas", icon: PenLine },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

type PanelActionShortcut = "mod+shift+e" | "mod+t" | "ctrl+shift+g" | "ctrl+backquote" | "alt+mod+s";

interface PanelNewTabAction {
  kind: PanelNewTabActionKind;
  defaultPanelId: PanelId;
  targetPanelIds?: readonly PanelId[];
  label: string;
  description: string;
  shortcut?: PanelActionShortcut;
  Icon: ComponentType<{ className?: string }>;
}

type ProjectSessionPreviewTab = ProjectSessionTab & {
  preview: true;
};

type DurableProjectSessionRenderableTab = ProjectSessionTab & {
  preview?: true;
};

type SideChatPanelTabStatus = "loading" | "ready" | "expired";

interface SideChatPanelTab {
  sideChat: true;
  id: string;
  sessionId: string;
  projectId: string;
  panelId: PanelId;
  leafId?: string;
  parentThreadId: string;
  parentNavigationPath: string;
  threadId: string | null;
  title: string;
  status: SideChatPanelTabStatus;
  stateKey: number;
}

interface McpAppPanelTab {
  mcpApp: true;
  id: string;
  sessionId: string;
  projectId: string;
  panelId: PanelId;
  leafId?: string;
  title: string;
  stateKey: number;
  app: ThreadMcpAppSidePanelInput;
}

type ProjectSessionRenderableTab = DurableProjectSessionRenderableTab | SideChatPanelTab | McpAppPanelTab;

interface CardStageHistoryModalContext {
  sessionId: string;
  tabId: string;
  projectId: string;
  cardId: string;
  cardTitle?: string;
}

type ProjectSessionTabDraft = Pick<ProjectSessionTabCreateInput, "kind" | "title" | "config">;

const PANEL_NEW_TAB_ACTIONS: PanelNewTabAction[] = [
  {
    kind: "files",
    defaultPanelId: "right",
    targetPanelIds: ["right", "bottom"],
    label: "Files",
    description: "Browse project files",
    shortcut: "mod+shift+e",
    Icon: CodexSidePanelFilesIcon,
  },
  {
    kind: "side_chat",
    defaultPanelId: "right",
    targetPanelIds: ["right", "bottom"],
    label: "Side chat",
    description: "Start a side conversation",
    shortcut: "alt+mod+s",
    Icon: CodexSidePanelSideChatIcon,
  },
  {
    kind: "browser",
    defaultPanelId: "right",
    targetPanelIds: ["right", "bottom"],
    label: "Browser",
    description: "Open a website",
    shortcut: "mod+t",
    Icon: CodexSidePanelBrowserIcon,
  },
  {
    kind: "review",
    defaultPanelId: "right",
    targetPanelIds: ["right", "bottom"],
    label: "Review",
    description: "View code changes",
    shortcut: "ctrl+shift+g",
    Icon: CodexSidePanelReviewIcon,
  },
  {
    kind: "terminal",
    defaultPanelId: "bottom",
    targetPanelIds: ["right", "bottom"],
    label: "Terminal",
    description: "Start an interactive shell",
    shortcut: "ctrl+backquote",
    Icon: CodexSidePanelTerminalIcon,
  },
  {
    kind: "db_view",
    defaultPanelId: "right",
    label: "DB View",
    description: "Open the project database",
    Icon: Table2,
  },
  {
    kind: "card_stage",
    defaultPanelId: "right",
    label: "Card Stage",
    description: "Open a project card",
    Icon: SquareKanban,
  },
];

function readThreadSummaryPanelPinnedOpen(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const raw = localStorage.getItem(THREAD_SUMMARY_PANEL_STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

function writeThreadSummaryPanelPinnedOpen(open: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(THREAD_SUMMARY_PANEL_STORAGE_KEY, open ? "true" : "false");
  } catch {
    // Ignore storage failures; the in-memory state remains authoritative for this session.
  }
}

function readRendererPlatform(): NodeJS.Platform | "browser" {
  if (typeof navigator === "undefined") return "browser";
  const platform = navigator.platform.toUpperCase();
  if (platform.includes("MAC")) return "darwin";
  if (platform.includes("WIN")) return "win32";
  if (platform.includes("LINUX")) return "linux";
  return "browser";
}

function sortProjectSessionsForSidebar(sessions: ProjectSession[]): ProjectSession[] {
  return [...sessions].sort((a, b) => {
    const rank = (session: ProjectSession) => session.isOverview ? 0 : session.pinned ? 1 : 2;
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    if (a.pinned || b.pinned) {
      const aPinnedOrder = a.pinnedOrder ?? Number.MAX_SAFE_INTEGER;
      const bPinnedOrder = b.pinnedOrder ?? Number.MAX_SAFE_INTEGER;
      if (aPinnedOrder !== bPinnedOrder) return aPinnedOrder - bPinnedOrder;
    }
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function sortPinnedProjectsForSidebar(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const orderDelta = (a.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (b.pinnedOrder ?? Number.MAX_SAFE_INTEGER);
    if (orderDelta !== 0) return orderDelta;
    return a.created.getTime() - b.created.getTime();
  });
}

function orderProjectsByIds(projects: readonly Project[], projectIds: readonly string[]): Project[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const ordered = projectIds
    .map((projectId) => byId.get(projectId))
    .filter((project): project is Project => Boolean(project));
  const orderedIds = new Set(ordered.map((project) => project.id));
  const missing = projects.filter((project) => !orderedIds.has(project.id));
  return [...ordered, ...missing];
}

function renderProjectRowsWithDropIndicator({
  projects,
  dropIndicatorIndex,
  renderProject,
}: {
  projects: Project[];
  dropIndicatorIndex: number | null;
  renderProject: (project: Project) => ReactNode;
}): ReactNode[] {
  const rows: ReactNode[] = [];
  projects.forEach((project, index) => {
    if (dropIndicatorIndex === index) {
      rows.push(<SidebarDropIndicator key={`drop-indicator-${project.id}`} />);
    }
    rows.push(renderProject(project));
  });
  if (dropIndicatorIndex === projects.length) {
    rows.push(<SidebarDropIndicator key="drop-indicator-end" />);
  }
  return rows;
}

interface WorkbenchShellProps {
  projects: Project[];
  dbProjectId: string;
  initialActiveProjectSessionId?: string | null;
  onActiveProjectSessionChange?: (sessionId: string | null) => void;
  activeView: WorkbenchView;
  activeSearchQuery: string;
  activeDbViewPrefs: DbViewPrefs | null;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  spaces?: SpaceRef[];
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
  pendingSessionOpen?: {
    projectId: string;
    sessionId: string;
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
  onOpenProjectSessionInNewWindow?: (session: ProjectSession) => Promise<void>;
  onLeaveCardStageCard: (snapshot: CardStageSessionSnapshot) => void;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onReorderProjects: (input: ProjectOrderInput) => Promise<Project[]>;
  onSetProjectPinned: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onSetPinnedProjectOrder: (input: ProjectPinnedOrderInput) => Promise<Project[]>;
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
  recentCardSessions?: RecentCardSession[];
  activeRecentSessionId?: unknown;
  focusedStage?: StageId;
  stageNavDirection?: unknown;
  cardsTabs?: unknown;
  activeCardsTabId?: unknown;
  threadsTabs?: unknown;
  activeThreadsTabId?: unknown;
  filesTabs?: unknown;
  activeFilesTabId?: unknown;
  stagePanelWidths?: unknown;
  slidingWindowPaneCount?: unknown;
  cardStageState?: unknown;
  cardStageCardId?: unknown;
  setActiveThreadsTab?: unknown;
  setThreadsTabs?: unknown;
  setStagePanelWidths?: unknown;
  stepSlidingWindowPaneCount?: unknown;
  closeRecentCardSession?: unknown;
  reorderRecentCardSessions?: unknown;
  closeCardStage?: unknown;
  projectPickerOpenTick?: number;
  taskSearchOpenTick?: unknown;
  diffSearchOpenTick?: unknown;
  commandPaletteOpenTick?: number;
  commandPaletteInitialQuery?: string;
  settingsToggleTick?: unknown;
  sidebarToggleRequestTick?: number;
  sidebarToggleRequestSource?: WorkbenchSidebarToggleCommandSource;
  navigationCommandRequest?: WorkbenchNavigationCommandRequest | null;
  panelTabCycleRequest?: WorkbenchPanelTabCycleCommandRequest | null;
  panelTabCloseRequest?: WorkbenchPanelTabCloseCommandRequest | null;
  onNavigationStateChange?: (state: WorkbenchNavigationCommandState) => void;
  navigateToStage?: (projectId: string, stageId: StageId) => void;
  navigateToDbView?: (projectId: string, view: WorkbenchView) => void;
  navigateToRecentSession?: unknown;
  navigateToCardsTab?: unknown;
  navigateToThreadTab?: unknown;
  navigateToFilesTab?: unknown;
  onRequestNewWindow?: () => void;
}

interface OpenCardTabOptions {
  sourceTabId?: string;
  openMode?: "preview" | "durable";
}

type OpenCardTabHandler = (
  projectId: string,
  cardId: string,
  titleSnapshot?: string,
  options?: OpenCardTabOptions,
) => Promise<void>;

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

type PanelTabCycleDirection = -1 | 1;

interface PanelTabCycleScope {
  panelId: PanelId;
  leafId: string;
}

const PANEL_FOCUS_AREA_SELECTOR = "[data-app-shell-focus-area=\"right-panel\"], [data-app-shell-focus-area=\"bottom-panel\"]";
const PANEL_GROUP_LEAF_SELECTOR = "[data-panel-group-leaf-id]";

function isWorkbenchNewChatShortcutTargetEditable(target: EventTarget | null): boolean {
  const element = target as ShortcutTargetLike | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") return true;
  if (!element.closest) return false;
  return Boolean(element.closest(".nfm-editor, .bn-editor, .bn-container, [role='dialog']"));
}

function isFocusedPanelTabShortcutTargetBlocked(target: EventTarget | null): boolean {
  const element = target as ShortcutTargetLike | null;
  if (!element) return false;
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") return true;
  if (!element.closest) return Boolean(element.isContentEditable);
  if (element.closest("[role='dialog']")) return true;
  if (element.closest(".nfm-editor")) return false;
  return Boolean(element.isContentEditable) || Boolean(element.closest(".bn-editor, .bn-container"));
}

function getTabIcon(kind: ProjectSessionTab["kind"]): ComponentType<{ className?: string }> {
  if (kind === "db_view") return Table2;
  if (kind === "card_stage") return SquareKanban;
  if (kind === "terminal") return CodexSidePanelTerminalIcon;
  if (kind === "browser") return CodexSidePanelBrowserIcon;
  if (kind === "review") return CodexSidePanelReviewIcon;
  if (kind === "files") return CodexSidePanelFilesIcon;
  return Globe2;
}

function makeBrowserFaviconIcon(faviconUrl: string): ComponentType<{ className?: string }> {
  return function BrowserFaviconIcon({ className }: { className?: string }) {
    return (
      <img
        src={faviconUrl}
        alt=""
        className={cn("rounded-[2px] object-contain", className)}
      />
    );
  };
}

function getBrowserTabIcon(tab: ProjectSessionTab): ComponentType<{ className?: string }> {
  if (
    tab.kind === "browser"
    && "faviconUrl" in tab.config
    && typeof tab.config.faviconUrl === "string"
    && tab.config.faviconUrl.trim().length > 0
  ) {
    return makeBrowserFaviconIcon(tab.config.faviconUrl);
  }
  return getTabIcon(tab.kind);
}

function resolveCardStageTabChromeContext(
  tab: ProjectSessionRenderableTab,
  activeSession: ProjectSession,
  projects: readonly Project[],
): Pick<AppShellTabItem, "contextLabel" | "titleLabel" | "tooltip"> {
  if (isSideChatPanelTab(tab) || isMcpAppPanelTab(tab)) return {};
  if (tab.kind !== "card_stage") return {};
  if (!("projectId" in tab.config)) return {};

  const targetProjectId = tab.config.projectId;
  if (targetProjectId === activeSession.projectId) return {};

  const targetProject = projects.find((project) => project.id === targetProjectId);
  const projectLabel = targetProject?.name.trim() || targetProjectId;

  return {
    contextLabel: projectLabel,
    titleLabel: `${projectLabel} project, ${tab.title}`,
    tooltip: (
      <div className="flex max-w-80 flex-col gap-0.5">
        <div className="truncate font-medium">{tab.title}</div>
        <div className="truncate text-xs text-token-description-foreground">
          Project: {projectLabel}
        </div>
      </div>
    ),
  };
}

function isPanelActionTargetAllowed(action: PanelNewTabAction, panelId: PanelId): boolean {
  return action.targetPanelIds?.includes(panelId) ?? action.defaultPanelId === panelId;
}

function isProjectSessionTabKind(kind: PanelNewTabActionKind): kind is ProjectSessionTab["kind"] {
  return kind !== "side_chat";
}

function filterAvailablePanelActions(
  actions: readonly PanelNewTabAction[],
  tabs: readonly ProjectSessionTab[],
  panelId: PanelId,
): PanelNewTabAction[] {
  const actionsByKind = new Map(actions.map((action) => [action.kind, action]));
  const orderedKinds = [
    ...CODEX_PANEL_OPTION_ACTION_ORDER,
    ...NODEX_PANEL_OPTION_ACTION_ORDER,
  ];
  return orderedKinds.flatMap((kind) => {
    const action = actionsByKind.get(kind);
    if (!action) return [];
    if (!isPanelActionTargetAllowed(action, panelId)) return [];
    if (
      isProjectSessionTabKind(action.kind)
      && PROJECT_SESSION_SINGLETON_TAB_KIND_SET.has(action.kind)
      && tabs.some((tab) => tab.kind === action.kind)
    ) {
      return [];
    }
    return [action];
  });
}

function isNodexPanelOptionAction(action: PanelNewTabAction): boolean {
  return isProjectSessionTabKind(action.kind) && NODEX_PANEL_OPTION_ACTION_KIND_SET.has(action.kind);
}

function normalizeOptionalPath(value: string | null | undefined): string | undefined {
  const trimmedValue = value?.trim();
  if (!trimmedValue) return undefined;
  return trimmedValue;
}

function normalizeProjectPrimaryWorkspaceRoot(project: Project | null | undefined): string | undefined {
  return normalizeOptionalPath(project?.primaryWorkspaceRoot)
    ?? normalizeOptionalPath(project?.sources[0]?.root);
}

function projectWorkspaceRootOrNull(project: Project | null | undefined): string | null {
  return normalizeProjectPrimaryWorkspaceRoot(project) ?? null;
}

function resolveSessionTerminalCwd(
  session: ProjectSession,
  tab: ProjectSessionTab,
  projects: readonly Project[],
): string | undefined {
  const threadCwd = normalizeOptionalPath(session.thread?.cwd);
  if (threadCwd) return threadCwd;

  const tabProjectId = "projectId" in tab.config ? tab.config.projectId : session.projectId;
  return normalizeProjectPrimaryWorkspaceRoot(projects.find((project) => project.id === tabProjectId))
    ?? normalizeProjectPrimaryWorkspaceRoot(projects.find((project) => project.id === session.projectId));
}

function resolvePanelShortcutLabel(shortcut: PanelActionShortcut | undefined, isMac: boolean): string | null {
  if (!shortcut) return null;
  if (shortcut === "mod+shift+e") return isMac ? "⇧⌘E" : "Ctrl+Shift+E";
  if (shortcut === "mod+t") return isMac ? "⌘T" : "Ctrl+T";
  if (shortcut === "ctrl+shift+g") return "⌃⇧G";
  if (shortcut === "alt+mod+s") return isMac ? "⌥⌘S" : "Alt+Ctrl+S";
  return "⌃`";
}

function matchesPanelShortcut(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  shortcut: PanelActionShortcut,
  isMac: boolean,
): boolean {
  const key = event.key.toLowerCase();
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  if (shortcut === "mod+shift+e") return modifier && !event.altKey && event.shiftKey && key === "e";
  if (shortcut === "mod+t") return modifier && !event.altKey && !event.shiftKey && key === "t";
  if (shortcut === "ctrl+shift+g") {
    return event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey && key === "g";
  }
  if (shortcut === "alt+mod+s") {
    return modifier && event.altKey && !event.shiftKey && key === "s";
  }
  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === "`" || event.code === "Backquote");
}

function resolvePanelTabCycleDirection(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  isMac: boolean,
): PanelTabCycleDirection | null {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  if (!modifier || event.altKey || !event.shiftKey) return null;
  if (event.code === "BracketLeft" || event.key === "[" || event.key === "{") return -1;
  if (event.code === "BracketRight" || event.key === "]" || event.key === "}") return 1;
  return null;
}

function resolvePanelTabCloseShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  isMac: boolean,
): boolean {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  return modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "w";
}

function resolveFocusedPanelTabCycleScope(target: EventTarget | null): PanelTabCycleScope | null {
  const element = target as ShortcutTargetLike | null;
  if (!element?.closest) return null;

  const focusArea = element.closest(PANEL_FOCUS_AREA_SELECTOR);
  const focusAreaId = focusArea?.getAttribute("data-app-shell-focus-area");
  const panelId = focusAreaId === "right-panel"
    ? "right"
    : focusAreaId === "bottom-panel"
      ? "bottom"
      : null;
  if (!panelId) return null;

  const leafId = element.closest(PANEL_GROUP_LEAF_SELECTOR)?.getAttribute("data-panel-group-leaf-id") ?? null;
  if (!leafId) return null;
  return { panelId, leafId };
}

function isDocumentLevelShortcutTarget(target: EventTarget | null): boolean {
  if (typeof document === "undefined") return false;
  return target === document || target === document.body || target === document.documentElement;
}

function resolveNextPanelTabId(
  tabs: readonly AppShellTabItem[],
  activeTabId: string | null,
  direction: PanelTabCycleDirection,
): string | null {
  if (tabs.length <= 1) return null;
  if (!activeTabId) return null;

  const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  if (currentIndex < 0) return null;

  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  return tabs[nextIndex]?.id ?? null;
}

function panelTabCycleRequestDirectionToOffset(
  direction: WorkbenchPanelTabCycleDirection,
): PanelTabCycleDirection {
  return direction === "previous" ? -1 : 1;
}

function clampRegularRightPanelWidth(width: number, sessionWidth: number): number {
  const maxWidth = sessionWidth > 0
    ? Math.max(RIGHT_PANEL_MIN_WIDTH, sessionWidth - RIGHT_PANEL_MAIN_MIN_WIDTH)
    : RIGHT_PANEL_DEFAULT_WIDTH;
  return Math.min(maxWidth, Math.max(RIGHT_PANEL_MIN_WIDTH, width));
}

function readCodexWindowZoom(root: HTMLElement | null): number {
  const rawZoom = root ? window.getComputedStyle(root).getPropertyValue("--codex-window-zoom") : "";
  const parsedZoom = Number.parseFloat(rawZoom);
  return Number.isFinite(parsedZoom) && parsedZoom > 0 ? parsedZoom : 1;
}

function readCodexViewportWidth(root: HTMLElement | null): number {
  if (typeof window === "undefined") return 0;
  return window.innerWidth / readCodexWindowZoom(root);
}

function readCodexRootFontSize(): number {
  if (typeof window === "undefined") return 16;
  const parsedFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(parsedFontSize) && parsedFontSize > 0 ? parsedFontSize : 16;
}

function clampBottomPanelHeight(height: number, sessionHeight: number): number {
  const maxHeight = sessionHeight > 0
    ? Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.floor(sessionHeight / 2))
    : BOTTOM_PANEL_DEFAULT_HEIGHT;
  return Math.min(maxHeight, Math.max(BOTTOM_PANEL_MIN_HEIGHT, height));
}

function getDefaultPanelIdForTabKind(kind: ProjectSessionTab["kind"]): PanelId {
  return PANEL_NEW_TAB_ACTIONS.find((action) => action.kind === kind)?.defaultPanelId ?? "right";
}

function makePanelPreviewKey(sessionId: string, panelId: PanelId, leafId?: string | null): string {
  return leafId ? `${sessionId}:${panelId}:${leafId}` : `${sessionId}:${panelId}`;
}

function makeClientProjectSessionTabId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `tab:${randomId}`;
  return `tab:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`;
}

function hasDurablePanelTabInLeaf(
  session: ProjectSession,
  panelId: PanelId,
  leafId: string,
  tabId: string,
): boolean {
  const leaf = findProjectSessionPanelLeaf(session.panels[panelId].layout, leafId);
  if (!leaf?.tabIds.includes(tabId)) return false;
  return session.tabs.some((tab) => tab.id === tabId && tab.panelId === panelId);
}

function getRenderablePanelPreviewTab(
  session: ProjectSession,
  panelId: PanelId,
  leafId: string,
  previewTabsByPanel: Record<string, ProjectSessionPreviewTab>,
): ProjectSessionPreviewTab | null {
  const activeLeafId = resolveSessionPanelActiveLeafId(session, panelId);
  const previewTab = previewTabsByPanel[makePanelPreviewKey(session.id, panelId, leafId)]
    ?? (leafId === activeLeafId ? previewTabsByPanel[makePanelPreviewKey(session.id, panelId)] : null)
    ?? null;
  if (!previewTab) return null;
  if (hasDurablePanelTabInLeaf(session, panelId, leafId, previewTab.id)) return null;
  return previewTab;
}

function makeSideChatPanelKey(sessionId: string, panelId: PanelId, leafId?: string | null): string {
  return leafId ? `${sessionId}:${panelId}:${leafId}` : `${sessionId}:${panelId}`;
}

function makeMcpAppPanelKey(sessionId: string, panelId: PanelId, leafId?: string | null): string {
  return leafId ? `${sessionId}:${panelId}:${leafId}` : `${sessionId}:${panelId}`;
}

function isSideChatPanelTab(tab: ProjectSessionRenderableTab): tab is SideChatPanelTab {
  return "sideChat" in tab && tab.sideChat === true;
}

function isMcpAppPanelTab(tab: ProjectSessionRenderableTab): tab is McpAppPanelTab {
  return "mcpApp" in tab && tab.mcpApp === true;
}

function isRootThreadRightPanelComposerOverlayEligibleTab(
  tab: ProjectSessionRenderableTab | null,
): boolean {
  if (!tab) return false;
  if (isSideChatPanelTab(tab) || isMcpAppPanelTab(tab)) return false;

  return (
    tab.kind === "review"
    || tab.kind === "browser"
    || tab.kind === "db_view"
    || tab.kind === "card_stage"
  );
}

function getSideChatTabTitle(index: number): string {
  return index === 1 ? "Side chat" : `Side chat ${index}`;
}

function buildSideChatParentNavigationPath(session: ProjectSession, parentThreadId: string): string {
  return `project:${session.projectId}/session:${session.id}/thread:${parentThreadId}`;
}

function isPreviewableProjectSessionTabKind(kind: ProjectSessionTab["kind"]): boolean {
  return PREVIEWABLE_PROJECT_SESSION_TAB_KIND_SET.has(kind);
}

function makeProjectSessionTabDraft(
  session: ProjectSession,
  kind: ProjectSessionTab["kind"],
): ProjectSessionTabDraft | null {
  if (kind === "db_view") {
    return {
      kind,
      title: "DB View",
      config: { projectId: session.projectId, view: "kanban" },
    };
  }

  if (kind === "files") {
    return {
      kind,
      title: "Files",
      config: { projectId: session.projectId, hostId: "local", workspaceRoot: "" },
    };
  }

  if (kind === "browser") {
    return {
      kind,
      title: "Browser",
      config: { projectId: session.projectId },
    };
  }

  if (kind === "review") {
    return {
      kind,
      title: "Review",
      config: { projectId: session.projectId },
    };
  }

  if (kind === "terminal") {
    return {
      kind,
      title: "Terminal",
      config: {
        projectId: session.projectId,
        terminalSessionId: `session:${session.id}:terminal:${Date.now()}`,
      },
    };
  }

  return null;
}

function makePreviewProjectSessionTab(
  session: ProjectSession,
  panelId: PanelId,
  draft: ProjectSessionTabDraft,
): ProjectSessionPreviewTab {
  const now = new Date().toISOString();
  return {
    id: `preview:${session.id}:${panelId}:${draft.kind}`,
    sessionId: session.id,
    projectId: session.projectId,
    panelId,
    kind: draft.kind,
    title: draft.title,
    order: session.tabs.filter((tab) => tab.panelId === panelId).length,
    config: draft.config,
    stateKey: 0,
    state: {},
    preview: true,
    createdAt: now,
    updatedAt: now,
  };
}

function makePreviewWorkspaceFileTab(
  session: ProjectSession,
  panelId: PanelId,
  input: { path: string; title: string; workspaceRoot: string },
): ProjectSessionPreviewTab {
  const now = new Date().toISOString();
  return {
    id: `preview:${session.id}:${panelId}:files:${input.path}`,
    sessionId: session.id,
    projectId: session.projectId,
    panelId,
    kind: "files",
    title: input.title,
    order: session.tabs.filter((tab) => tab.panelId === panelId).length,
    config: {
      projectId: session.projectId,
      hostId: "local",
      workspaceRoot: input.workspaceRoot,
      path: input.path,
    },
    stateKey: 0,
    state: {},
    preview: true,
    createdAt: now,
    updatedAt: now,
  };
}

function makePreviewCardStageTab(
  session: ProjectSession,
  panelId: PanelId,
  leafId: string,
  input: { projectId: string; cardId: string; titleSnapshot?: string },
): ProjectSessionPreviewTab {
  const now = new Date().toISOString();
  const title = input.titleSnapshot || input.cardId;
  return {
    id: makeClientProjectSessionTabId(),
    sessionId: session.id,
    projectId: session.projectId,
    panelId,
    kind: "card_stage",
    title,
    order: session.tabs.filter((tab) => tab.panelId === panelId).length,
    config: {
      projectId: input.projectId,
      cardId: input.cardId,
      ...(input.titleSnapshot ? { titleSnapshot: input.titleSnapshot } : {}),
    },
    stateKey: 0,
    state: {},
    preview: true,
    createdAt: now,
    updatedAt: now,
  };
}

function resolveSessionPanelActiveTabId(session: ProjectSession, panelId: PanelId): string | null {
  const panel = session.panels[panelId];
  return getProjectSessionPanelActiveLeaf(panel.layout).activeTabId
    ?? session.tabs.find((tab) => tab.panelId === panelId)?.id
    ?? null;
}

function resolveSessionPanelActiveLeafId(session: ProjectSession, panelId: PanelId): string {
  return getProjectSessionPanelActiveLeaf(session.panels[panelId].layout).id;
}

function resolveLeafIdForPanelTab(session: ProjectSession, panelId: PanelId, tabId: string): string {
  return findProjectSessionPanelLeafForTab(session.panels[panelId].layout, tabId)?.id
    ?? resolveSessionPanelActiveLeafId(session, panelId);
}

function resolveCardTabTargetLeafId(session: ProjectSession, sourceTabId: string | undefined): string | undefined {
  if (!sourceTabId) return undefined;
  const sourceTab = session.tabs.find((tab) => tab.id === sourceTabId && tab.panelId === "right");
  if (!sourceTab) return undefined;
  const sourceLeafId = findProjectSessionPanelLeafForTab(session.panels.right.layout, sourceTab.id)?.id;
  if (!sourceLeafId) return undefined;
  return findNearestProjectSessionPanelLeafToRight(session.panels.right.layout, sourceLeafId) ?? undefined;
}

function readCardStagePanelTabCardRef(tab: ProjectSessionTab | null | undefined): {
  projectId: string;
  cardId: string;
} | null {
  if (!tab || tab.kind !== "card_stage") return null;
  if (!("projectId" in tab.config) || !("cardId" in tab.config)) return null;

  return {
    projectId: tab.config.projectId,
    cardId: tab.config.cardId,
  };
}

function buildShellNavigationSnapshot(input: {
  activeProjectId: string;
  activeSession: ProjectSession | null;
  activeView: WorkbenchView;
  rightActiveTabId?: string | null;
  bottomActiveTabId?: string | null;
  rightPanelCollapsed?: boolean;
  bottomPanelCollapsed?: boolean;
  rightPanelFullWidth?: boolean;
}): WorkbenchShellNavigationSnapshot {
  const { activeProjectId, activeSession, activeView } = input;
  return {
    activeProjectId,
    activeSessionId: activeSession?.id ?? null,
    activeView,
    rightActiveTabId: input.rightActiveTabId
      ?? (activeSession ? resolveSessionPanelActiveTabId(activeSession, "right") : null),
    bottomActiveTabId: input.bottomActiveTabId
      ?? (activeSession ? resolveSessionPanelActiveTabId(activeSession, "bottom") : null),
    rightPanelCollapsed: input.rightPanelCollapsed ?? activeSession?.panels.right.collapsed ?? true,
    bottomPanelCollapsed: input.bottomPanelCollapsed ?? activeSession?.panels.bottom.collapsed ?? true,
    rightPanelFullWidth: input.rightPanelFullWidth ?? activeSession?.panels.right.size.fullWidth ?? false,
  };
}

export function WorkbenchShell({
  projects,
  dbProjectId,
  initialActiveProjectSessionId = null,
  onActiveProjectSessionChange,
  activeView,
  activeSearchQuery,
  activeDbViewPrefs,
  searchByProject,
  dbViewPrefsByProject,
  spaces = [],
  recentCardSessions = [],
  focusedStage = "db",
  sidebar,
  cardStageCloseRef,
  cardStagePersistRef,
  cardStageSessionSnapshotRef,
  pendingReminderOpen,
  pendingSessionOpen,
  setDbProject,
  setSearchQuery,
  setDbViewPrefs,
  openCardStage,
  onReminderHandled,
  onOpenProjectSessionInNewWindow,
  onLeaveCardStageCard,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onReorderProjects,
  onSetProjectPinned,
  onSetPinnedProjectOrder,
  onRequestProjectPickerOpen,
  projectPickerOpenTick = 0,
  threadSearchOpenTick,
  commandPaletteOpenTick = 0,
  commandPaletteInitialQuery = "",
  setSidebarCollapsed,
  setSidebarWidth,
  setSidebarTopLevelSectionVisible,
  settingsToggleTick,
  sidebarToggleRequestTick = 0,
  sidebarToggleRequestSource = "keyboard_shortcut",
  navigationCommandRequest = null,
  panelTabCycleRequest = null,
  panelTabCloseRequest = null,
  onNavigationStateChange,
  onRequestNewWindow,
  navigateToStage,
  navigateToDbView,
}: WorkbenchShellProps) {
  const fallbackProjectId = projects[0]?.id ?? "default";
  const [activeProjectId, setActiveProjectId] = useState(dbProjectId || fallbackProjectId);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialActiveProjectSessionId);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, ProjectSession[]>>({});
  const [expandedProjectIds, setExpandedProjectIds] = useState(() =>
    readInitialExpandedProjects(projects, dbProjectId || fallbackProjectId),
  );
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [contextMenuSessionId, setContextMenuSessionId] = useState<string | null>(null);
  const [renameSession, setRenameSession] = useState<ProjectSession | null>(null);
  const [renameSessionTitle, setRenameSessionTitle] = useState("");
  const [renamingSession, setRenamingSession] = useState(false);
  const [previewTabsByPanel, setPreviewTabsByPanel] = useState<Record<string, ProjectSessionPreviewTab>>({});
  const [sideChatTabsBySession, setSideChatTabsBySession] = useState<Record<string, SideChatPanelTab[]>>({});
  const [sideChatActiveTabByPanel, setSideChatActiveTabByPanel] = useState<Record<string, string>>({});
  const [mcpAppTabsBySession, setMcpAppTabsBySession] = useState<Record<string, McpAppPanelTab[]>>({});
  const [mcpAppActiveTabByPanel, setMcpAppActiveTabByPanel] = useState<Record<string, string>>({});
  const [panelCollapsedOverrides, setPanelCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [rightPanelDragWidth, setRightPanelDragWidth] = useState<number | null>(null);
  const [bottomPanelDragHeight, setBottomPanelDragHeight] = useState<number | null>(null);
  const [sessionContentWidth, setSessionContentWidth] = useState(0);
  const [sessionContentHeight, setSessionContentHeight] = useState(0);
  const [appShellWidth, setAppShellWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  const [rootFontSizePx, setRootFontSizePx] = useState(readCodexRootFontSize);
  const [headerLeftWidth, setHeaderLeftWidth] = useState(0);
  const [, setHeaderLeftRailWidth] = useState(0);
  const [headerRightWidth, setHeaderRightWidth] = useState(RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX);
  const [, setHeaderRightRailWidth] = useState(RIGHT_PANEL_HEADER_FALLBACK_RAIL_WIDTH_PX);
  const [threadHeaderPortalElement, setThreadHeaderPortalElement] = useState<HTMLDivElement | null>(null);
  const [rightPanelComposerOverlayTarget, setRightPanelComposerOverlayTarget] = useState<HTMLElement | null>(null);
  const [threadSummaryPanelPinnedOpen, setThreadSummaryPanelPinnedOpen] = useState(readThreadSummaryPanelPinnedOpen);
  const [threadSummaryPanelPopoverOpen, setThreadSummaryPanelPopoverOpen] = useState(false);
  const [localSidebarCollapsed, setLocalSidebarCollapsed] = useState(false);
  const [localSidebarWidth, setLocalSidebarWidth] = useState(CODEX_SIDEBAR_WIDTH_DEFAULT_PX);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteOpenRequest, setCommandPaletteOpenRequest] = useState({
    tick: 0,
    initialQuery: "",
  });
  const [floatingSidebarVisible, setFloatingSidebarVisible] = useState(false);
  const [floatingSidebarResizing, setFloatingSidebarResizing] = useState(false);
  const [sidebarHoverSuppressed, setSidebarHoverSuppressed] = useState(false);
  const [sidebarTriggerHovered, setSidebarTriggerHovered] = useState(false);
  const [sidebarClickInFlight, setSidebarClickInFlight] = useState(false);
  const [sidebarAnimateLayout, setSidebarAnimateLayout] = useState(true);
  const [floatingSidebarFocusActive, setFloatingSidebarFocusActive] = useState(false);
  const [sidebarTaskSearchOpenTick, setSidebarTaskSearchOpenTick] = useState(0);
  const [pinnedProjectsSectionCollapsed, setPinnedProjectsSectionCollapsed] = useState(false);
  const [projectsSectionCollapsed, setProjectsSectionCollapsed] = useState(false);
  const [sidebarDragWidth, setSidebarDragWidth] = useState<number | null>(null);
  const [shellNavigationHistory, setShellNavigationHistory] = useState(readWorkbenchShellNavigationHistoryState);
  const workbenchRootRef = useRef<HTMLDivElement | null>(null);
  const sessionContentRef = useRef<HTMLDivElement | null>(null);
  const pinningPreviewTabIdsRef = useRef<Set<string>>(new Set());
  const sidebarPointerRef = useRef<CodexSidebarPointerSnapshot>(CODEX_SIDEBAR_POINTER_DEFAULT);
  // Non-pointer inputs for sidebar auto-reveal, mirrored into a ref so the
  // high-frequency `pointermove` handler can recompute visibility WITHOUT
  // storing the pointer in React state. Keeping the pointer out of state is
  // what prevents a full workbench re-render on every mouse move (which would
  // cascade into the editor and remount the BlockNote drag handle mid-gesture).
  const sidebarVisibilityInputsRef = useRef({
    sidebarWidth: CODEX_SIDEBAR_WIDTH_DEFAULT_PX,
    sidebarCollapsed: false,
    sidebarAnimating: false,
    floatingSidebarFocusActive: false,
    sidebarHoverSuppressed: false,
    sidebarTriggerHovered: false,
  });
  const lastHandledSidebarToggleRequestTickRef = useRef(sidebarToggleRequestTick);
  const lastHandledNavigationCommandTickRef = useRef(navigationCommandRequest?.tick ?? 0);
  const lastHandledPanelTabCycleRequestTickRef = useRef(panelTabCycleRequest?.tick ?? 0);
  const lastHandledPanelTabCloseRequestTickRef = useRef(panelTabCloseRequest?.tick ?? 0);
  const lastHandledCommandPaletteOpenTickRef = useRef(commandPaletteOpenTick);
  const currentShellNavigationSnapshotRef = useRef<WorkbenchShellNavigationSnapshot | null>(null);
  const focusedPanelGroupRef = useRef<PanelTabCycleScope | null>(null);
  const applyingShellNavigationRef = useRef(false);
  const shellAtMediumWidthRef = useRef(false);
  const shellAtNarrowWidthRef = useRef(false);
  const sidebarCollapsed = sidebar?.collapsed ?? localSidebarCollapsed;
  const persistedSidebarWidth = sidebar?.width ?? localSidebarWidth;
  const sidebarWidth = sidebarDragWidth ?? persistedSidebarWidth;
  const lastHandledSettingsToggleTickRef = useRef(settingsToggleTick);
  const [settingsPath, setSettingsPath] = useState<string | null>(null);
  const [threadQueueFollowUpsEnabled, setThreadQueueFollowUpsEnabled] = useState(readThreadQueueFollowUpsEnabled);
  const [composerEnterBehavior, setComposerEnterBehavior] = useState<ComposerEnterBehavior>(readComposerEnterBehavior);
  const [worktreeStartMode, setWorktreeStartMode] = useState<WorktreeStartMode>(readWorktreeStartMode);
  const [worktreeAutoBranchPrefix, setWorktreeAutoBranchPrefix] = useState(readWorktreeAutoBranchPrefix);
  const [smartPrefixParsingEnabled, setSmartPrefixParsingEnabled] = useState(readSmartPrefixParsingEnabled);
  const [stripSmartPrefixFromTitleEnabled, setStripSmartPrefixFromTitleEnabled] = useState(
    readStripSmartPrefixFromTitleEnabled,
  );
  const [selectedTurnDiffReviewTarget, setSelectedTurnDiffReviewTarget] =
    useState<CodexTurnDiffReviewTarget | null>(null);
  const codexAccount = useLocalConversationAccount();
  const codexConnection = useLocalConversationConnection();
  const codexAccountActions = useCodexAccountActions();
  const reducedMotion = useReducedMotion();
  const realSidebarMotion = useCodexAnimatedPanelState({
    open: !sidebarCollapsed,
    targetSize: sidebarWidth,
    reducedMotion,
    animateLayout: sidebarAnimateLayout,
  });
  const sidebarAnimating = realSidebarMotion.animating;

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const activeSessions = activeProject ? sessionsByProject[activeProject.id] ?? [] : [];
  const selectedActiveSession = activeSessions.find((session) => session.id === activeSessionId) ?? null;
  const activeSession = selectedActiveSession ?? activeSessions[0] ?? null;
  const workbenchCodexControl = useCodexAppServerControl(activeProject?.id ?? activeProjectId);
  const activeProjectKanban = useKanban({
    projectId: activeProject?.id ?? activeProjectId,
    sessionId: activeSession ? `${activeSession.id}:right-panel-actions` : "right-panel-actions",
  });
  const [cardStageHistoryModal, setCardStageHistoryModal] = useState<CardStageHistoryModalContext | null>(null);
  const rightPanel = activeSession?.panels.right ?? null;
  const bottomPanel = activeSession?.panels.bottom ?? null;
  const rightPanelTabs = activeSession?.tabs.filter((tab) => tab.panelId === "right") ?? [];
  const bottomPanelTabs = activeSession?.tabs.filter((tab) => tab.panelId === "bottom") ?? [];
  const rightActiveLeafId = activeSession ? resolveSessionPanelActiveLeafId(activeSession, "right") : "main";
  const bottomActiveLeafId = activeSession ? resolveSessionPanelActiveLeafId(activeSession, "bottom") : "main";
  const rightPreviewTab = activeSession
    ? getRenderablePanelPreviewTab(activeSession, "right", rightActiveLeafId, previewTabsByPanel)
    : null;
  const bottomPreviewTab = activeSession
    ? getRenderablePanelPreviewTab(activeSession, "bottom", bottomActiveLeafId, previewTabsByPanel)
    : null;
  const activeSessionSideChatTabs = activeSession ? sideChatTabsBySession[activeSession.id] ?? [] : [];
  const rightSideChatTabs = activeSessionSideChatTabs.filter((tab) => tab.panelId === "right");
  const bottomSideChatTabs = activeSessionSideChatTabs.filter((tab) => tab.panelId === "bottom");
  const activeSessionMcpAppTabs = activeSession ? mcpAppTabsBySession[activeSession.id] ?? [] : [];
  const rightMcpAppTabs = activeSessionMcpAppTabs.filter((tab) => tab.panelId === "right");
  const bottomMcpAppTabs = activeSessionMcpAppTabs.filter((tab) => tab.panelId === "bottom");
  const rightRenderableTabs: ProjectSessionRenderableTab[] = rightPreviewTab
    ? [...rightPanelTabs, ...rightSideChatTabs, ...rightMcpAppTabs, rightPreviewTab]
    : [...rightPanelTabs, ...rightSideChatTabs, ...rightMcpAppTabs];
  const bottomRenderableTabs: ProjectSessionRenderableTab[] = bottomPreviewTab
    ? [...bottomPanelTabs, ...bottomSideChatTabs, ...bottomMcpAppTabs, bottomPreviewTab]
    : [...bottomPanelTabs, ...bottomSideChatTabs, ...bottomMcpAppTabs];
  const rightSideChatActiveTabId = activeSession
    ? sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, "right", rightActiveLeafId)]
      ?? sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, "right")]
      ?? null
    : null;
  const bottomSideChatActiveTabId = activeSession
    ? sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, "bottom", bottomActiveLeafId)]
      ?? sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, "bottom")]
      ?? null
    : null;
  const rightMcpAppActiveTabId = activeSession
    ? mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, "right", rightActiveLeafId)]
      ?? mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, "right")]
      ?? null
    : null;
  const bottomMcpAppActiveTabId = activeSession
    ? mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, "bottom", bottomActiveLeafId)]
      ?? mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, "bottom")]
      ?? null
    : null;
  const rightActiveTabId = rightPreviewTab?.id
    ?? (rightMcpAppActiveTabId && rightRenderableTabs.some((tab) => tab.id === rightMcpAppActiveTabId)
      ? rightMcpAppActiveTabId
      : null)
    ?? (rightSideChatActiveTabId && rightRenderableTabs.some((tab) => tab.id === rightSideChatActiveTabId)
      ? rightSideChatActiveTabId
      : rightPanel ? getProjectSessionPanelActiveLeaf(rightPanel.layout).activeTabId : null)
    ?? rightRenderableTabs[0]?.id
    ?? null;
  const bottomActiveTabId = bottomPreviewTab?.id
    ?? (bottomMcpAppActiveTabId && bottomRenderableTabs.some((tab) => tab.id === bottomMcpAppActiveTabId)
      ? bottomMcpAppActiveTabId
      : null)
    ?? (bottomSideChatActiveTabId && bottomRenderableTabs.some((tab) => tab.id === bottomSideChatActiveTabId)
      ? bottomSideChatActiveTabId
      : bottomPanel ? getProjectSessionPanelActiveLeaf(bottomPanel.layout).activeTabId : null)
    ?? bottomRenderableTabs[0]?.id
    ?? null;
  const rightPanelCollapsed = activeSession
    ? panelCollapsedOverrides[makePanelPreviewKey(activeSession.id, "right")] ?? rightPanel?.collapsed ?? true
    : true;
  const bottomPanelCollapsed = activeSession
    ? panelCollapsedOverrides[makePanelPreviewKey(activeSession.id, "bottom")] ?? bottomPanel?.collapsed ?? true
    : true;
  const sidePanelOpen = activeSession ? !rightPanelCollapsed : false;
  const bottomPanelOpen = activeSession ? !bottomPanelCollapsed : false;
  useEffect(() => {
    setCardStageHistoryModal((current) => {
      if (!current) return current;
      if (!activeSession || activeSession.id !== current.sessionId) return null;

      const ownerTab = activeSession.tabs.find((tab) => tab.id === current.tabId);
      const cardRef = readCardStagePanelTabCardRef(ownerTab);
      if (!cardRef) return null;
      if (cardRef.projectId !== current.projectId || cardRef.cardId !== current.cardId) return null;

      return current;
    });
  }, [activeSession]);
  const closeCardStageHistoryModal = useCallback(() => {
    setCardStageHistoryModal(null);
  }, []);
  const toggleCardStageHistoryModal = useCallback((context: CardStageHistoryModalContext) => {
    setCardStageHistoryModal((current) => {
      if (
        current
        && current.sessionId === context.sessionId
        && current.tabId === context.tabId
        && current.projectId === context.projectId
        && current.cardId === context.cardId
      ) {
        return null;
      }
      return context;
    });
  }, []);
  const cardStageHistoryModalProject = useMemo(
    () => cardStageHistoryModal
      ? projects.find((project) => project.id === cardStageHistoryModal.projectId) ?? null
      : null,
    [cardStageHistoryModal, projects],
  );
  const rightPanelFullWidth = Boolean(
    activeSession && sidePanelOpen && (rightPanel?.size.fullWidth ?? activeSession.isOverview),
  );
  const rightActiveRenderableTab = rightActiveTabId
    ? rightRenderableTabs.find((tab) => tab.id === rightActiveTabId) ?? null
    : null;
  const rightPanelComposerOverlayEnabled = Boolean(
    activeSession?.thread
    && sidePanelOpen
    && rightPanelFullWidth
    && rightPanelComposerOverlayTarget
    && isRootThreadRightPanelComposerOverlayEligibleTab(rightActiveRenderableTab),
  );
  const shellCanNavigateBack = shellNavigationHistory.backStack.length > 0;
  const shellCanNavigateForward = shellNavigationHistory.forwardStack.length > 0;
  const currentShellNavigationSnapshot = useMemo<WorkbenchShellNavigationSnapshot | null>(() => {
    if (!activeProject) return null;
    return buildShellNavigationSnapshot({
      activeProjectId: activeProject.id,
      activeSession,
      activeView,
      rightActiveTabId,
      bottomActiveTabId,
      rightPanelCollapsed,
      bottomPanelCollapsed,
      rightPanelFullWidth,
    });
  }, [
    activeProject,
    activeSession,
    activeView,
    bottomActiveTabId,
    bottomPanelCollapsed,
    rightActiveTabId,
    rightPanelCollapsed,
    rightPanelFullWidth,
  ]);
  const shellMainContentWidth = Math.max(
    0,
    appShellWidth - (sidebarCollapsed ? 0 : sidebarWidth),
  );
  const rightPanelSizingWidth = Math.max(sessionContentWidth, shellMainContentWidth);
  const regularRightPanelWidth = clampRegularRightPanelWidth(
    rightPanelDragWidth ?? rightPanel?.size.widthPx ?? rightPanelWidth,
    rightPanelSizingWidth,
  );
  const bottomPanelHeight = clampBottomPanelHeight(
    bottomPanelDragHeight ?? bottomPanel?.size.heightPx ?? BOTTOM_PANEL_DEFAULT_HEIGHT,
    sessionContentHeight,
  );
  const rightPanelTargetWidth = rightPanelFullWidth
    ? Math.max(sessionContentWidth, regularRightPanelWidth)
    : regularRightPanelWidth;
  const rightPanelMotion = useCodexAnimatedPanelState({
    open: sidePanelOpen,
    targetSize: rightPanelTargetWidth,
    reducedMotion,
    resetKey: activeSession?.id ?? null,
  });
  const bottomPanelMotion = useCodexAnimatedPanelState({
    open: bottomPanelOpen,
    targetSize: bottomPanelHeight,
    reducedMotion,
    resetKey: activeSession?.id ?? null,
  });
  const rightPanelAnimatedWidth = useTransform(
    [rightPanelMotion.progress, rightPanelMotion.targetSize],
    ([latestProgress, latestTargetSize]) =>
      rightPanelFullWidth
        ? 0
        : resolveCodexAnimatedPanelSize(Number(latestProgress), Number(latestTargetSize)),
  );
  const bottomPanelAnimatedHeightCss = useTransform(
    bottomPanelMotion.animatedSize,
    (latestHeight) => `${latestHeight}px`,
  );
  const mainContentTargetWidth = activeSession
    ? resolveCodexMainContentTargetWidth({
        shellWidth: appShellWidth,
        leftSidebarOpen: !sidebarCollapsed,
        leftSidebarWidth: sidebarWidth,
        rightPanelOpen: sidePanelOpen,
        rightPanelWidth: regularRightPanelWidth,
        rightPanelFullWidth,
      })
    : 0;
  const appShellMainContentLayout = "thread-edge-scroll" as const;
  const appShellHeaderEdgeScroll = resolveCodexHeaderEdgeScroll({
    layout: appShellMainContentLayout,
    mainContentWidth: mainContentTargetWidth,
    rootFontSizePx,
    rightPanelFullWidth,
  });
  const appShellMainContentFrameBorderVisible = resolveCodexMainContentFrameBorder({
    rightPanelOpen: sidePanelOpen,
    headerEdgeScroll: appShellHeaderEdgeScroll,
  });
  const threadSummaryPanelLayoutMode: ThreadSummaryPanelLayoutMode =
    resolveCodexSummaryPanelLayoutMode(mainContentTargetWidth);
  const settingsSidebarTopLevelSectionOrder = normalizeSidebarTopLevelSectionOrder(
    sidebar?.topLevelSectionOrder,
  );
  const settingsSidebarTopLevelSections = sidebar?.topLevelSections ?? makeDefaultSidebarTopLevelSectionsPrefs();
  useEffect(() => {
    currentShellNavigationSnapshotRef.current = currentShellNavigationSnapshot;
  }, [currentShellNavigationSnapshot]);

  useEffect(() => {
    if (commandPaletteOpenTick <= 0 || commandPaletteOpenTick === lastHandledCommandPaletteOpenTickRef.current) {
      return;
    }

    lastHandledCommandPaletteOpenTickRef.current = commandPaletteOpenTick;
    setCommandPaletteOpenRequest((current) => ({
      tick: current.tick + 1,
      initialQuery: commandPaletteInitialQuery,
    }));
    setCommandPaletteOpen(true);
  }, [commandPaletteInitialQuery, commandPaletteOpenTick]);

  useEffect(() => {
    writeWorkbenchShellNavigationHistoryState(shellNavigationHistory);
  }, [shellNavigationHistory]);

  useEffect(() => {
    onNavigationStateChange?.({
      canNavigateBack: shellCanNavigateBack,
      canNavigateForward: shellCanNavigateForward,
    });
  }, [onNavigationStateChange, shellCanNavigateBack, shellCanNavigateForward]);

  const handleCodexAccountLogout = useCallback(async () => {
    await codexAccountActions.logout();
  }, [codexAccountActions]);
  const handleCodexAccountErrorMessage = useCallback((message: string | null) => {
    if (!message) return;
    toast.danger(message);
  }, []);
  const activeProjectCardOptions = useMemo(() => {
    const cards: Array<{ card: CardSummary; columnName: string }> = [];
    for (const column of activeProjectKanban.board?.columns ?? []) {
      const columnName = KANBAN_STATUS_LABELS[column.id] ?? column.name;
      for (const card of column.cards) {
        cards.push({ card, columnName });
      }
    }
    return cards;
  }, [activeProjectKanban.board?.columns]);
  const isMacPlatform = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
  const availableRightPanelActions = useMemo(
    () => filterAvailablePanelActions(PANEL_NEW_TAB_ACTIONS, activeSession?.tabs ?? [], "right"),
    [activeSession?.tabs],
  );
  const availableBottomPanelActions = useMemo(
    () => filterAvailablePanelActions(PANEL_NEW_TAB_ACTIONS, activeSession?.tabs ?? [], "bottom"),
    [activeSession?.tabs],
  );
  const safeHeaderLeftWidth = isMacPlatform
    ? MAC_TRAFFIC_LIGHT_SAFE_HEADER_LEFT_PX
    : NON_MAC_SAFE_HEADER_LEFT_PX;
  const collapsedHeaderLeftFallbackWidth = safeHeaderLeftWidth + LEFT_HEADER_COLLAPSED_RAIL_FALLBACK_WIDTH_PX;
  const effectiveHeaderLeftWidth = sidebarCollapsed
    ? Math.max(headerLeftWidth, collapsedHeaderLeftFallbackWidth)
    : Math.max(headerLeftWidth, safeHeaderLeftWidth + 24);
  const realSidebarMounted = realSidebarMotion.mounted;
  const headerLeftShellSlotWidth = sidebarCollapsed && rightPanelFullWidth
    ? 0
    : realSidebarMounted
      ? realSidebarMotion.animatedSize
      : effectiveHeaderLeftWidth;
  const headerLeftShellSlotMinWidth = realSidebarMounted
    ? sidebarCollapsed
      ? effectiveHeaderLeftWidth
      : Math.max(headerLeftWidth, safeHeaderLeftWidth + 24)
    : effectiveHeaderLeftWidth;

  useEffect(() => {
    if (!activeSession) {
      setPanelCollapsedOverrides((current) => Object.keys(current).length === 0 ? current : {});
      return;
    }

    const rightKey = makePanelPreviewKey(activeSession.id, "right");
    const bottomKey = makePanelPreviewKey(activeSession.id, "bottom");
    setPanelCollapsedOverrides((current) => {
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
    setSettingsPath(buildSettingsPath("general-settings"));
  }, []);

  const openLocalEnvironmentsSettings = useCallback(() => {
    setSettingsPath(buildSettingsPath("local-environments"));
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsPath(null);
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
    setSettingsPath((current) => current ? null : buildSettingsPath("general-settings"));
  }, [settingsToggleTick]);

  useEffect(() => {
    void activeProjectKanban.refresh();
  }, [activeProjectKanban.refresh, activeProject?.id, activeSession?.id]);

  useEffect(() => {
    if (!selectedTurnDiffReviewTarget) return;
    if (activeSession?.thread?.threadId === selectedTurnDiffReviewTarget.threadId) return;
    setSelectedTurnDiffReviewTarget(null);
  }, [activeSession?.thread?.threadId, selectedTurnDiffReviewTarget]);

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

  const mergeSessionInState = useCallback((session: ProjectSession) => {
    setSessionsByProject((current) => {
      const sessions = current[session.projectId];
      if (!sessions) return current;
      return {
        ...current,
        [session.projectId]: sortProjectSessionsForSidebar(
          sessions.map((candidate) => candidate.id === session.id ? session : candidate),
        ),
      };
    });
  }, []);

  const resolveSessionHasGitRepository = useCallback(async (session: ProjectSession): Promise<boolean> => {
    if (!canForkSessionLocally(session)) return false;
    const cwd = session.thread?.cwd?.trim();
    if (!cwd) return false;
    try {
      const state = await invoke("git:branch:state", cwd) as {
        currentBranch?: string | null;
        defaultBranch?: string | null;
        branches?: string[];
      };
      return Boolean(state.currentBranch || state.defaultBranch || (state.branches?.length ?? 0) > 0);
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!activeProject?.id) return;
    return subscribeProjectSessionChanges(activeProject.id, () => {
      void refreshProjectSessions(activeProject.id);
    });
  }, [activeProject?.id, refreshProjectSessions]);

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
      const rect = contentElement.getBoundingClientRect();
      setSessionContentWidth(rect.width);
      setSessionContentHeight(rect.height);
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
    const measure = () => {
      setAppShellWidth(readCodexViewportWidth(workbenchRootRef.current));
      setRootFontSizePx(readCodexRootFontSize());
    };

    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    setRightPanelWidth((current) => clampRegularRightPanelWidth(current, rightPanelSizingWidth));
  }, [rightPanelSizingWidth]);

  useEffect(() => {
    const nextProjectId = projects.some((project) => project.id === dbProjectId)
      ? dbProjectId
      : fallbackProjectId;
    if (nextProjectId === activeProjectId) return;
    setActiveProjectId(nextProjectId);
    setExpandedProjectIds((current) => new Set([...current, nextProjectId]));
  }, [activeProjectId, dbProjectId, fallbackProjectId, projects]);

  useEffect(() => {
    if (!activeProject) return;
    if (
      activeSession
      && activeSession.projectId === activeProject.id
      && activeSession.id === activeSessionId
    ) {
      return;
    }
    const overview = activeSessions.find((session) => session.isOverview) ?? activeSessions[0] ?? null;
    startTransition(() => {
      setActiveSessionId(overview?.id ?? null);
    });
  }, [activeProject, activeSession, activeSessionId, activeSessions]);

  useEffect(() => {
    onActiveProjectSessionChange?.(activeSession?.id ?? null);
  }, [activeSession?.id, onActiveProjectSessionChange]);

  const buildSnapshotForSession = useCallback((session: ProjectSession | null, projectId?: string) =>
    buildShellNavigationSnapshot({
      activeProjectId: projectId ?? session?.projectId ?? activeProjectId,
      activeSession: session,
      activeView,
    }), [activeProjectId, activeView]);

  const recordShellNavigation = useCallback((nextSnapshot: WorkbenchShellNavigationSnapshot) => {
    if (applyingShellNavigationRef.current) return;
    const currentSnapshot = currentShellNavigationSnapshotRef.current;
    if (!currentSnapshot) return;
    setShellNavigationHistory((current) =>
      recordWorkbenchShellNavigationTransition(current, currentSnapshot, nextSnapshot)
    );
  }, []);

  const selectProject = useCallback((projectId: string) => {
    const sessions = sessionsByProject[projectId] ?? [];
    const overview = sessions.find((session) => session.isOverview) ?? sessions[0] ?? null;
    recordShellNavigation(buildSnapshotForSession(overview, projectId));
    startTransition(() => {
      setActiveProjectId(projectId);
      setDbProject(projectId);
      setExpandedProjectIds((current) => new Set([...current, projectId]));
    });
  }, [buildSnapshotForSession, recordShellNavigation, sessionsByProject, setDbProject]);

  const selectSession = useCallback((session: ProjectSession) => {
    recordShellNavigation(buildSnapshotForSession(session));
    startTransition(() => {
      setActiveProjectId(session.projectId);
      setActiveSessionId(session.id);
      setDbProject(session.projectId);
      setExpandedProjectIds((current) => new Set([...current, session.projectId]));
    });
    if (session.unread) {
      void invoke("project-sessions:mark-unread", session.id, { unread: false })
        .then((updated) => {
          if (!updated) return;
          mergeSessionInState(updated as ProjectSession);
        })
        .catch(() => undefined);
    }
  }, [buildSnapshotForSession, mergeSessionInState, recordShellNavigation, setDbProject]);

  useEffect(() => {
    if (!pendingSessionOpen) return;
    if (pendingSessionOpen.projectId !== activeProject?.id) return;
    const targetSession = activeSessions.find((session) => session.id === pendingSessionOpen.sessionId);
    if (!targetSession) return;
    selectSession(targetSession);
  }, [activeProject?.id, activeSessions, pendingSessionOpen, selectSession]);

  const toggleSessionPin = useCallback(async (session: ProjectSession) => {
    const previousSessions = sessionsByProject[session.projectId] ?? [];
    const nextPinned = !session.pinned;
    const nextPinnedOrder = nextPinned
      ? Math.max(-1, ...previousSessions.map((candidate) => candidate.pinnedOrder ?? -1)) + 1
      : null;
    const optimisticSession: ProjectSession = {
      ...session,
      pinned: nextPinned,
      pinnedOrder: nextPinnedOrder,
    };

    setSessionsByProject((current) => ({
      ...current,
      [session.projectId]: sortProjectSessionsForSidebar(
        (current[session.projectId] ?? previousSessions)
          .map((candidate) => candidate.id === session.id ? optimisticSession : candidate),
      ),
    }));

    try {
      const updated = await invoke("project-sessions:set-pinned", session.id, { pinned: nextPinned }) as ProjectSession | null;
      if (updated) mergeSessionInState(updated);
      await refreshProjectSessions(session.projectId);
    } catch {
      setSessionsByProject((current) => ({ ...current, [session.projectId]: previousSessions }));
      toast.danger(nextPinned ? "Failed to pin chat" : "Failed to unpin chat");
    }
  }, [mergeSessionInState, refreshProjectSessions, sessionsByProject]);

  const openRenameSessionDialog = useCallback((session: ProjectSession) => {
    setRenameSession(session);
    setRenameSessionTitle(session.title);
  }, []);

  const archiveSession = useCallback(async (session: ProjectSession) => {
    try {
      await invoke("project-sessions:archive", session.id);
      const sessions = await refreshProjectSessions(session.projectId);
      if (activeSessionId === session.id) {
        const fallbackSession = sessions.find((candidate) => candidate.isOverview) ?? sessions[0] ?? null;
        if (fallbackSession) {
          selectSession(fallbackSession);
        } else {
          setActiveSessionId(null);
        }
      }
    } catch {
      toast.danger("Failed to archive chat");
    }
  }, [activeSessionId, refreshProjectSessions, selectSession]);

  const markSessionUnread = useCallback(async (session: ProjectSession) => {
    try {
      const updated = await invoke("project-sessions:mark-unread", session.id, { unread: true }) as ProjectSession | null;
      if (updated) mergeSessionInState(updated);
    } catch {
      toast.danger("Failed to mark chat unread");
    }
  }, [mergeSessionInState]);

  const revealSession = useCallback(async (session: ProjectSession) => {
    const project = projects.find((candidate) => candidate.id === session.projectId) ?? null;
    const revealPath = resolveSessionRevealPath({
      session,
      projectWorkspacePath: projectWorkspaceRootOrNull(project),
    });
    if (!revealPath) return;
    try {
      const opened = await invoke("shell:open-file-link", { path: revealPath }, "fileManager") as boolean;
      if (!opened) toast.danger("Failed to reveal chat folder");
    } catch {
      toast.danger("Failed to reveal chat folder");
    }
  }, [projects]);

  const copySessionText = useCallback(async (text: string, successMessage: string, errorMessage: string) => {
    const copied = await writeTextToClipboard(text);
    if (copied) {
      toast.success(successMessage);
      return;
    }
    toast.danger(errorMessage);
  }, []);

  const forkSession = useCallback(async (
    session: ProjectSession,
    target: "local" | "newWorktree",
  ) => {
    try {
      const result = await invoke("project-sessions:fork", session.id, {
        target,
        ...(target === "newWorktree"
          ? {
              worktreeStartMode,
              worktreeBranchPrefix: worktreeAutoBranchPrefix,
            }
          : {}),
      }) as ProjectSessionForkResult;
      await refreshProjectSessions(result.session.projectId);
      selectSession(result.session);
    } catch {
      toast.danger(target === "newWorktree" ? "Failed to fork chat into new worktree" : "Failed to fork chat");
    }
  }, [refreshProjectSessions, selectSession, worktreeAutoBranchPrefix, worktreeStartMode]);

  const handleSessionContextMenuAction = useCallback(async (
    session: ProjectSession,
    actionId: SessionContextMenuActionId,
  ) => {
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.togglePin) {
      await toggleSessionPin(session);
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.rename) {
      openRenameSessionDialog(session);
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.archive) {
      await archiveSession(session);
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.markUnread) {
      await markSessionUnread(session);
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.reveal) {
      await revealSession(session);
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.copyWorkingDirectory) {
      await copySessionText(
        session.thread?.cwd ?? "",
        "Copied working directory",
        "Failed to copy working directory",
      );
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.copySessionId) {
      await copySessionText(session.id, "Copied session ID", "Failed to copy session ID");
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.copyDeeplink) {
      await copySessionText(
        buildSessionDeepLink({ sessionId: session.id }),
        "Copied deeplink",
        "Failed to copy deeplink",
      );
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.forkLocal) {
      await forkSession(session, "local");
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.forkNewWorktree) {
      await forkSession(session, "newWorktree");
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.openInNewWindow) {
      await onOpenProjectSessionInNewWindow?.(session);
    }
  }, [
    archiveSession,
    copySessionText,
    forkSession,
    markSessionUnread,
    onOpenProjectSessionInNewWindow,
    openRenameSessionDialog,
    revealSession,
    toggleSessionPin,
  ]);

  const openSessionContextMenu = useCallback(async (
    session: ProjectSession,
    event: ReactMouseEvent<HTMLElement>,
  ) => {
    if (session.isOverview) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX > 0 ? event.clientX : rect.right;
    const y = event.clientY > 0 ? event.clientY : rect.bottom;
    const project = projects.find((candidate) => candidate.id === session.projectId) ?? null;
    const isGitRepository = await resolveSessionHasGitRepository(session);
    const items = buildSessionContextMenuItems({
      session,
      projectWorkspacePath: projectWorkspaceRootOrNull(project),
      platform: readRendererPlatform(),
      isGitRepository,
    });

    setContextMenuSessionId(session.id);
    try {
      const selectedId = await showNativeContextMenu(items, { x, y });
      if (!selectedId) return;
      await handleSessionContextMenuAction(session, selectedId as SessionContextMenuActionId);
    } catch {
      toast.danger("Native context menu is unavailable");
    } finally {
      setContextMenuSessionId(null);
    }
  }, [handleSessionContextMenuAction, projects, resolveSessionHasGitRepository]);

  const submitRenameSession = useCallback(async () => {
    if (!renameSession) return;
    const title = renameSessionTitle.trim();
    if (!title) return;

    setRenamingSession(true);
    try {
      const updated = await invoke("project-sessions:update", renameSession.id, { title }) as ProjectSession | null;
      if (!updated) throw new Error("Session was not found");
      mergeSessionInState(updated);
      await refreshProjectSessions(updated.projectId);
      setRenameSession(null);
      setRenameSessionTitle("");
    } catch {
      toast.danger("Failed to rename chat");
    } finally {
      setRenamingSession(false);
    }
  }, [mergeSessionInState, refreshProjectSessions, renameSession, renameSessionTitle]);

  const updateSessionPanel = useCallback(async (
    sessionId: string,
    panelId: PanelId,
    input: Partial<ProjectSession["panels"][PanelId]>,
    options?: { refresh?: boolean },
  ) => {
    const updated = (await invoke("project-session-panels:update", sessionId, panelId, input)) as ProjectSession | null;
    if (!updated) return null;
    if (options?.refresh !== false) await refreshProjectSessions(updated.projectId);
    return updated;
  }, [refreshProjectSessions]);

  const updateActivePanel = useCallback(async (
    panelId: PanelId,
    input: Partial<ProjectSession["panels"][PanelId]>,
    options?: { refresh?: boolean },
  ) => {
    if (!activeSession) return null;
    return updateSessionPanel(activeSession.id, panelId, input, options);
  }, [activeSession, updateSessionPanel]);

  const setActivePanelCollapsed = useCallback(async (panelId: PanelId, collapsed: boolean) => {
    if (!activeSession) return null;
    const currentSnapshot = currentShellNavigationSnapshotRef.current;
    if (currentSnapshot) {
      recordShellNavigation({
        ...currentSnapshot,
        ...(panelId === "right"
          ? { rightPanelCollapsed: collapsed }
          : { bottomPanelCollapsed: collapsed }),
      });
    }
    const sessionId = activeSession.id;
    const overrideKey = makePanelPreviewKey(sessionId, panelId);
    setPanelCollapsedOverrides((current) => ({ ...current, [overrideKey]: collapsed }));

    try {
      const updated = await updateActivePanel(panelId, { collapsed });
      setPanelCollapsedOverrides((current) => {
        if (!(overrideKey in current)) return current;
        const next = { ...current };
        delete next[overrideKey];
        return next;
      });
      return updated;
    } catch (error) {
      setPanelCollapsedOverrides((current) => {
        if (!(overrideKey in current)) return current;
        const next = { ...current };
        delete next[overrideKey];
        return next;
      });
      toast.danger(error instanceof Error ? error.message : "Unable to update panel");
      return null;
    }
  }, [activeSession, recordShellNavigation, updateActivePanel]);

  const clearPanelPreviewTab = useCallback((sessionId: string, panelId: PanelId, leafId?: string | null) => {
    setPreviewTabsByPanel((current) => {
      const keys = leafId
        ? [makePanelPreviewKey(sessionId, panelId, leafId), makePanelPreviewKey(sessionId, panelId)]
        : [makePanelPreviewKey(sessionId, panelId)];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }, []);

  const setActivePanelTab = useCallback(async (panelId: PanelId, tabId: string, options?: { openPanel?: boolean; leafId?: string }) => {
    if (!activeSession) return;
    const leafId = options?.leafId ?? resolveLeafIdForPanelTab(activeSession, panelId, tabId);
    clearPanelPreviewTab(activeSession.id, panelId, leafId);
    const currentSnapshot = currentShellNavigationSnapshotRef.current;
    if (currentSnapshot) {
      recordShellNavigation({
        ...currentSnapshot,
        ...(panelId === "right"
          ? {
              rightActiveTabId: tabId,
              ...(options?.openPanel ? { rightPanelCollapsed: false } : {}),
            }
          : {
              bottomActiveTabId: tabId,
              ...(options?.openPanel ? { bottomPanelCollapsed: false } : {}),
            }),
      });
    }
    const session = (await invoke("project-session-panels:activate", {
      sessionId: activeSession.id,
      panelId,
      leafId,
      tabId,
    })) as ProjectSession | null;
    if (options?.openPanel) {
      await updateActivePanel(panelId, { collapsed: false }, { refresh: false });
    }
    if (session) await refreshProjectSessions(session.projectId);
  }, [activeSession, clearPanelPreviewTab, recordShellNavigation, refreshProjectSessions, updateActivePanel]);

  const reorderTabs = useCallback(async (panelId: PanelId, tabId: string, targetIndex: number, leafId?: string) => {
    if (!activeSession) return;
    const panel = activeSession.panels[panelId];
    const leaf = leafId ? findProjectSessionPanelLeaf(panel.layout, leafId) : null;
    const order = leaf?.tabIds ?? activeSession.tabs.filter((tab) => tab.panelId === panelId).map((tab) => tab.id);
    const fromIndex = order.indexOf(tabId);
    const normalizedTargetIndex = resolveSameLeafInsertionIndex({
      tabIds: order,
      sourceTabId: tabId,
      targetIndex,
    });
    if (fromIndex < 0 || normalizedTargetIndex === null) return;
    const next = [...order];
    const [item] = next.splice(fromIndex, 1);
    if (!item) return;
    next.splice(normalizedTargetIndex, 0, item);
    const session = (await invoke("project-session-tabs:reorder", {
      sessionId: activeSession.id,
      panelId,
      leafId,
      orderedTabIds: next,
    })) as ProjectSession | null;
    if (session) await refreshProjectSessions(session.projectId);
  }, [activeSession, refreshProjectSessions]);

  const getPanelVisibleLeafTabCount = useCallback((
    panelId: PanelId,
    leafId: string,
    options: { excludingTabId?: string } = {},
  ): number => {
    if (!activeSession) return 0;
    const excludedTabId = options.excludingTabId ?? null;
    const activeLeafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const leaf = findProjectSessionPanelLeaf(activeSession.panels[panelId].layout, leafId);
    const durableCount = (leaf?.tabIds ?? []).filter((tabId) => {
      if (tabId === excludedTabId) return false;
      return activeSession.tabs.some((tab) => tab.id === tabId && tab.panelId === panelId);
    }).length;
    const sideChatCount = (sideChatTabsBySession[activeSession.id] ?? []).filter((tab) => {
      if (tab.id === excludedTabId) return false;
      return tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leafId;
    }).length;
    const mcpAppCount = (mcpAppTabsBySession[activeSession.id] ?? []).filter((tab) => {
      if (tab.id === excludedTabId) return false;
      return tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leafId;
    }).length;
    const previewTab = getRenderablePanelPreviewTab(activeSession, panelId, leafId, previewTabsByPanel);
    const previewCount = previewTab && previewTab.id !== excludedTabId ? 1 : 0;
    return durableCount + sideChatCount + mcpAppCount + previewCount;
  }, [activeSession, mcpAppTabsBySession, previewTabsByPanel, sideChatTabsBySession]);

  const getPanelVisibleTabCount = useCallback((
    panelId: PanelId,
    options: { excludingTabId?: string } = {},
  ): number => {
    if (!activeSession) return 0;
    return listProjectSessionPanelLeaves(activeSession.panels[panelId].layout).reduce(
      (count, leaf) => count + getPanelVisibleLeafTabCount(panelId, leaf.id, options),
      0,
    );
  }, [activeSession, getPanelVisibleLeafTabCount]);

  const getPreserveEmptyLeafIdsAfterDurableRemoval = useCallback((
    panelId: PanelId,
    leafId: string,
    tabId: string,
  ): string[] => {
    return getPanelVisibleLeafTabCount(panelId, leafId, { excludingTabId: tabId }) > 0 ? [leafId] : [];
  }, [getPanelVisibleLeafTabCount]);

  const removeEmptyVisiblePanelLeaf = useCallback(async (
    panelId: PanelId,
    leafId: string,
    options: { excludingTabId?: string } = {},
  ) => {
    if (!activeSession) return;
    const leaves = listProjectSessionPanelLeaves(activeSession.panels[panelId].layout);
    if (leaves.length <= 1) return;
    if (getPanelVisibleLeafTabCount(panelId, leafId, options) > 0) return;
    const session = (await invoke("project-session-panels:merge", {
      sessionId: activeSession.id,
      panelId,
      leafId,
    })) as ProjectSession | null;
    if (session) await refreshProjectSessions(session.projectId);
  }, [activeSession, getPanelVisibleLeafTabCount, refreshProjectSessions]);

  const closeTab = useCallback(async (tabId: string, options: { preserveEmptyLeafIds?: string[] } = {}) => {
    if (!activeSession) return;
    await invoke(
      "project-session-tabs:delete",
      options.preserveEmptyLeafIds && options.preserveEmptyLeafIds.length > 0
        ? { tabId, preserveEmptyLeafIds: options.preserveEmptyLeafIds }
        : tabId,
    );
    await refreshProjectSessions(activeSession.projectId);
  }, [activeSession, refreshProjectSessions]);

  const closePreviewTab = useCallback(async (panelId: PanelId, leafId?: string) => {
    if (!activeSession) return;
    const targetLeafId = leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    const previewTab = previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId, targetLeafId)]
      ?? previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId)]
      ?? null;
    clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
    if (previewTab && getPanelVisibleLeafTabCount(panelId, targetLeafId, { excludingTabId: previewTab.id }) === 0) {
      await removeEmptyVisiblePanelLeaf(panelId, targetLeafId, { excludingTabId: previewTab.id });
    }
    if (getPanelVisibleTabCount(panelId, { excludingTabId: previewTab?.id }) > 0) return;
    await updateActivePanel(panelId, { collapsed: true });
  }, [
    activeSession,
    clearPanelPreviewTab,
    getPanelVisibleLeafTabCount,
    getPanelVisibleTabCount,
    previewTabsByPanel,
    removeEmptyVisiblePanelLeaf,
    updateActivePanel,
  ]);

  const closeSideChatPanelTab = useCallback(async (panelId: PanelId, tabId: string) => {
    if (!activeSession) return;
    const sideChatTab = (sideChatTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (!sideChatTab) return;

    setSideChatTabsBySession((current) => {
      const tabs = current[activeSession.id] ?? [];
      const nextTabs = tabs.filter((tab) => tab.id !== tabId);
      return {
        ...current,
        [activeSession.id]: nextTabs,
      };
    });
    setSideChatActiveTabByPanel((current) => {
      const keys = [
        makeSideChatPanelKey(activeSession.id, panelId, sideChatTab.leafId),
        makeSideChatPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => current[key] === tabId)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });

    if (sideChatTab.threadId) {
      void workbenchCodexControl.discardSideChat(sideChatTab.threadId).catch((error) => {
        console.warn("[side-chat:discard]", error);
      });
    }
    const targetLeafId = sideChatTab.leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    if (getPanelVisibleLeafTabCount(panelId, targetLeafId, { excludingTabId: tabId }) === 0) {
      await removeEmptyVisiblePanelLeaf(panelId, targetLeafId, { excludingTabId: tabId });
    }
    if (getPanelVisibleTabCount(panelId, { excludingTabId: tabId }) > 0) return;
    await updateActivePanel(panelId, { collapsed: true });
  }, [
    activeSession,
    getPanelVisibleLeafTabCount,
    getPanelVisibleTabCount,
    removeEmptyVisiblePanelLeaf,
    sideChatTabsBySession,
    updateActivePanel,
    workbenchCodexControl,
  ]);

  const closeMcpAppPanelTab = useCallback(async (panelId: PanelId, tabId: string) => {
    if (!activeSession) return;
    const mcpAppTab = (mcpAppTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (!mcpAppTab) return;

    setMcpAppTabsBySession((current) => {
      const tabs = current[activeSession.id] ?? [];
      return {
        ...current,
        [activeSession.id]: tabs.filter((tab) => tab.id !== tabId),
      };
    });
    setMcpAppActiveTabByPanel((current) => {
      const keys = [
        makeMcpAppPanelKey(activeSession.id, panelId, mcpAppTab.leafId),
        makeMcpAppPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => current[key] === tabId)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });

    const targetLeafId = mcpAppTab.leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    if (getPanelVisibleLeafTabCount(panelId, targetLeafId, { excludingTabId: tabId }) === 0) {
      await removeEmptyVisiblePanelLeaf(panelId, targetLeafId, { excludingTabId: tabId });
    }
    if (getPanelVisibleTabCount(panelId, { excludingTabId: tabId }) > 0) return;
    await updateActivePanel(panelId, { collapsed: true });
  }, [
    activeSession,
    getPanelVisibleLeafTabCount,
    getPanelVisibleTabCount,
    mcpAppTabsBySession,
    removeEmptyVisiblePanelLeaf,
    updateActivePanel,
  ]);

  const closePanelTab = useCallback(async (panelId: PanelId, tabId: string, leafId?: string) => {
    if (!activeSession) return;
    const targetLeafId = leafId ?? resolveLeafIdForPanelTab(activeSession, panelId, tabId);
    const previewTab = getRenderablePanelPreviewTab(activeSession, panelId, targetLeafId, previewTabsByPanel);
    if (previewTab?.id === tabId) {
      await closePreviewTab(panelId, targetLeafId);
      return;
    }
    if ((sideChatTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      await closeSideChatPanelTab(panelId, tabId);
      return;
    }
    if ((mcpAppTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      await closeMcpAppPanelTab(panelId, tabId);
      return;
    }

    const preserveEmptyLeafIds = getPreserveEmptyLeafIdsAfterDurableRemoval(panelId, targetLeafId, tabId);
    await closeTab(tabId, { preserveEmptyLeafIds });
    if (preserveEmptyLeafIds.length > 0) {
      await updateActivePanel(panelId, { collapsed: false });
    }
  }, [
    activeSession,
    closePreviewTab,
    closeMcpAppPanelTab,
    closeSideChatPanelTab,
    closeTab,
    getPreserveEmptyLeafIdsAfterDurableRemoval,
    mcpAppTabsBySession,
    previewTabsByPanel,
    sideChatTabsBySession,
    updateActivePanel,
  ]);

  const selectPanelTab = useCallback(async (panelId: PanelId, tabId: string, leafId?: string) => {
    if (!activeSession) return;
    const targetLeafId = leafId ?? resolveLeafIdForPanelTab(activeSession, panelId, tabId);
    const previewTab = getRenderablePanelPreviewTab(activeSession, panelId, targetLeafId, previewTabsByPanel);
    if (previewTab?.id === tabId) return;
    if ((sideChatTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
      setMcpAppActiveTabByPanel((current) => {
        const keys = [
          makeMcpAppPanelKey(activeSession.id, panelId, targetLeafId),
          makeMcpAppPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
      setSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeSideChatPanelKey(activeSession.id, panelId, targetLeafId)]: tabId,
      }));
      return;
    }
    if ((mcpAppTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
      setSideChatActiveTabByPanel((current) => {
        const keys = [
          makeSideChatPanelKey(activeSession.id, panelId, targetLeafId),
          makeSideChatPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
      setMcpAppActiveTabByPanel((current) => ({
        ...current,
        [makeMcpAppPanelKey(activeSession.id, panelId, targetLeafId)]: tabId,
      }));
      return;
    }
    setMcpAppActiveTabByPanel((current) => {
      const keys = [
        makeMcpAppPanelKey(activeSession.id, panelId, targetLeafId),
        makeMcpAppPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    setSideChatActiveTabByPanel((current) => {
      const keys = [
        makeSideChatPanelKey(activeSession.id, panelId, targetLeafId),
        makeSideChatPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    await setActivePanelTab(panelId, tabId, { leafId: targetLeafId });
  }, [activeSession, clearPanelPreviewTab, mcpAppTabsBySession, previewTabsByPanel, setActivePanelTab, sideChatTabsBySession]);

  const pinPreviewTab = useCallback(async (panelId: PanelId, tabId: string, leafId?: string) => {
    if (!activeSession) return;
    const targetLeafId = leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    const previewTab = previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId, targetLeafId)]
      ?? previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId)];
    if (!previewTab || previewTab.id !== tabId) return;
    if (pinningPreviewTabIdsRef.current.has(tabId)) return;

    pinningPreviewTabIdsRef.current.add(tabId);
    try {
      await invoke("project-session-panels:activate", {
        sessionId: activeSession.id,
        panelId,
        leafId: targetLeafId,
      });
      const createInput: ProjectSessionTabCreateInput = {
        sessionId: activeSession.id,
        projectId: activeSession.projectId,
        panelId,
        targetLeafId,
        ...(previewTab.kind === "card_stage" ? { clientTabId: previewTab.id } : {}),
        kind: previewTab.kind,
        title: previewTab.title,
        config: previewTab.config,
      };
      await invoke("project-session-tabs:create", createInput);
      if (previewTab.kind === "card_stage") {
        await refreshProjectSessions(activeSession.projectId);
        clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
        return;
      }
      clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
      await refreshProjectSessions(activeSession.projectId);
    } finally {
      pinningPreviewTabIdsRef.current.delete(tabId);
    }
  }, [activeSession, clearPanelPreviewTab, previewTabsByPanel, refreshProjectSessions]);

  const moveTabToPanel = useCallback(async (
    tabId: string,
    targetPanelId: string,
    targetLeafId?: string,
    targetIndex?: number,
    splitTarget?: { leafId: string; side: ProjectSessionPanelSplitSide },
  ) => {
    if (!activeSession) return;
    if (targetPanelId !== "right" && targetPanelId !== "bottom") return;
    const sideChatTab = (sideChatTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (sideChatTab) {
      const nextLeafId = targetLeafId ?? resolveSessionPanelActiveLeafId(activeSession, targetPanelId);
      setSideChatTabsBySession((current) => {
        const tabs = current[activeSession.id] ?? [];
        return {
          ...current,
          [activeSession.id]: tabs.map((tab) =>
            tab.id === tabId
              ? { ...tab, panelId: targetPanelId, leafId: nextLeafId, stateKey: tab.stateKey + 1 }
              : tab
          ),
        };
      });
      setSideChatActiveTabByPanel((current) => {
        const next = { ...current };
        if (sideChatTab.leafId) delete next[makeSideChatPanelKey(activeSession.id, sideChatTab.panelId, sideChatTab.leafId)];
        delete next[makeSideChatPanelKey(activeSession.id, sideChatTab.panelId)];
        next[makeSideChatPanelKey(activeSession.id, targetPanelId, nextLeafId)] = tabId;
        return next;
      });
      await updateActivePanel(targetPanelId, { collapsed: false });
      return;
    }
    const mcpAppTab = (mcpAppTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (mcpAppTab) {
      const nextLeafId = targetLeafId ?? resolveSessionPanelActiveLeafId(activeSession, targetPanelId);
      setMcpAppTabsBySession((current) => {
        const tabs = current[activeSession.id] ?? [];
        return {
          ...current,
          [activeSession.id]: tabs.map((tab) =>
            tab.id === tabId
              ? { ...tab, panelId: targetPanelId, leafId: nextLeafId, stateKey: tab.stateKey + 1 }
              : tab
          ),
        };
      });
      setMcpAppActiveTabByPanel((current) => {
        const next = { ...current };
        if (mcpAppTab.leafId) delete next[makeMcpAppPanelKey(activeSession.id, mcpAppTab.panelId, mcpAppTab.leafId)];
        delete next[makeMcpAppPanelKey(activeSession.id, mcpAppTab.panelId)];
        next[makeMcpAppPanelKey(activeSession.id, targetPanelId, nextLeafId)] = tabId;
        return next;
      });
      await updateActivePanel(targetPanelId, { collapsed: false });
      return;
    }
    const durableTab = activeSession.tabs.find((tab) => tab.id === tabId) ?? null;
    const sourceLeafId = durableTab ? resolveLeafIdForPanelTab(activeSession, durableTab.panelId, tabId) : null;
    const preserveEmptyLeafIds = durableTab && sourceLeafId
      ? getPreserveEmptyLeafIdsAfterDurableRemoval(durableTab.panelId, sourceLeafId, tabId)
      : [];
    const session = (await invoke("project-session-tabs:move", {
      tabId,
      targetPanelId,
      targetLeafId,
      targetIndex,
      preserveEmptyLeafIds,
      splitTarget,
    })) as ProjectSession | null;
    if (session && preserveEmptyLeafIds.length > 0) {
      await updateActivePanel(durableTab?.panelId ?? targetPanelId, { collapsed: false }, { refresh: false });
    }
    if (session) await refreshProjectSessions(session.projectId);
  }, [
    activeSession,
    getPreserveEmptyLeafIdsAfterDurableRemoval,
    mcpAppTabsBySession,
    refreshProjectSessions,
    sideChatTabsBySession,
    updateActivePanel,
  ]);

  const splitPanelGroup = useCallback(async (
    panelId: PanelId,
    leafId: string,
    side: ProjectSessionPanelSplitSide,
    tabId?: string,
  ) => {
    if (!activeSession) return;
    if (!tabId) return;
    const leaf = findProjectSessionPanelLeaf(activeSession.panels[panelId].layout, leafId);
    if (!leaf || leaf.tabIds.length <= 1 || !leaf.tabIds.includes(tabId)) return;
    const session = (await invoke("project-session-panels:split", {
      sessionId: activeSession.id,
      panelId,
      leafId,
      side,
      tabId,
    })) as ProjectSession | null;
    if (session) await refreshProjectSessions(session.projectId);
  }, [activeSession, refreshProjectSessions]);

  const activatePanelGroup = useCallback(async (panelId: PanelId, leafId: string, tabId?: string | null) => {
    if (!activeSession) return;
    const session = (await invoke("project-session-panels:activate", {
      sessionId: activeSession.id,
      panelId,
      leafId,
      tabId,
    })) as ProjectSession | null;
    if (session) await refreshProjectSessions(session.projectId);
  }, [activeSession, refreshProjectSessions]);

  const resizePanelGroup = useCallback(async (panelId: PanelId, branchId: string, ratio: number) => {
    if (!activeSession) return;
    const session = (await invoke("project-session-panels:resize", {
      sessionId: activeSession.id,
      panelId,
      branchId,
      ratio,
    })) as ProjectSession | null;
    if (session) await refreshProjectSessions(session.projectId);
  }, [activeSession, refreshProjectSessions]);

  const ensureActivePanelOpenWithoutRefresh = useCallback(async (panelId: PanelId) => {
    if (!activeSession || !activeSession.panels[panelId].collapsed) return;
    await invoke("project-session-panels:update", activeSession.id, panelId, { collapsed: false });
  }, [activeSession]);

  const openSideChat = useCallback(async (
    input: {
      targetPanelId?: PanelId;
      targetLeafId?: string;
      prompt?: string;
      promptInput?: CodexPromptInput;
      collaborationMode?: CodexCollaborationModeKind;
    } = {},
  ) => {
    if (!activeSession?.thread) {
      toast.danger("Failed to open side chat", { id: "side-chat-open-failed" });
      return;
    }

    const panelId = input.targetPanelId ?? "right";
    const leafId = input.targetLeafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    const parentThreadId = activeSession.thread.threadId;
    const existingPanelSideChats = (sideChatTabsBySession[activeSession.id] ?? []).filter((tab) =>
      tab.panelId === panelId
    );
    const index = existingPanelSideChats.length + 1;
    const title = getSideChatTabTitle(index);
    const loadingTabId = `sidechat-loading:${parentThreadId}:${index}`;
    const parentNavigationPath = buildSideChatParentNavigationPath(activeSession, parentThreadId);
    const loadingTab: SideChatPanelTab = {
      sideChat: true,
      id: loadingTabId,
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
      panelId,
      leafId,
      parentThreadId,
      parentNavigationPath,
      threadId: null,
      title,
      status: "loading",
      stateKey: Date.now(),
    };

    setSideChatTabsBySession((current) => ({
      ...current,
      [activeSession.id]: [...(current[activeSession.id] ?? []), loadingTab],
    }));
    setSideChatActiveTabByPanel((current) => ({
      ...current,
      [makeSideChatPanelKey(activeSession.id, panelId, leafId)]: loadingTabId,
    }));
    clearPanelPreviewTab(activeSession.id, panelId, leafId);
    await ensureActivePanelOpenWithoutRefresh(panelId);

    try {
      const result = await workbenchCodexControl.startSideChat({
        projectId: activeSession.projectId,
        parentThreadId,
        parentNavigationPath,
        prompt: input.prompt,
        promptInput: input.promptInput,
        collaborationMode: input.collaborationMode,
      });
      const readyTabId = `sidechat:${result.threadId}`;
      setSideChatTabsBySession((current) => {
        const tabs = current[activeSession.id] ?? [];
        return {
          ...current,
          [activeSession.id]: tabs.map((tab) =>
            tab.id === loadingTabId
              ? {
                  ...tab,
                  id: readyTabId,
                  threadId: result.threadId,
                  status: "ready",
                  stateKey: tab.stateKey + 1,
                }
              : tab
          ),
        };
      });
      setSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeSideChatPanelKey(activeSession.id, panelId, leafId)]: readyTabId,
      }));
    } catch {
      setSideChatTabsBySession((current) => {
        const tabs = current[activeSession.id] ?? [];
        return {
          ...current,
          [activeSession.id]: tabs.filter((tab) => tab.id !== loadingTabId),
        };
      });
      setSideChatActiveTabByPanel((current) => {
        const key = makeSideChatPanelKey(activeSession.id, panelId);
        const leafKey = makeSideChatPanelKey(activeSession.id, panelId, leafId);
        if (current[leafKey] !== loadingTabId && current[key] !== loadingTabId) return current;
        const next = { ...current };
        delete next[leafKey];
        delete next[key];
        return next;
      });
      toast.danger("Failed to open side chat", { id: "side-chat-open-failed" });
    }
  }, [
    activeSession,
    clearPanelPreviewTab,
    ensureActivePanelOpenWithoutRefresh,
    sideChatTabsBySession,
    workbenchCodexControl,
  ]);

  const openMcpAppSidePanel = useCallback(async (input: ThreadMcpAppSidePanelInput) => {
    if (!activeSession) return;

    const panelId: PanelId = "right";
    const leafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const tabId = `mcp-app:${input.mcpAppId}`;
    const tab: McpAppPanelTab = {
      mcpApp: true,
      id: tabId,
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
      panelId,
      leafId,
      title: input.title.trim() || input.server,
      stateKey: Date.now(),
      app: input,
    };

    setMcpAppTabsBySession((current) => {
      const tabs = current[activeSession.id] ?? [];
      const existingIndex = tabs.findIndex((candidate) => candidate.id === tabId);
      if (existingIndex < 0) {
        return {
          ...current,
          [activeSession.id]: [...tabs, tab],
        };
      }
      return {
        ...current,
        [activeSession.id]: tabs.map((candidate) =>
          candidate.id === tabId
            ? { ...candidate, ...tab, stateKey: candidate.stateKey + 1 }
            : candidate
        ),
      };
    });
    clearPanelPreviewTab(activeSession.id, panelId, leafId);
    setSideChatActiveTabByPanel((current) => {
      const keys = [
        makeSideChatPanelKey(activeSession.id, panelId, leafId),
        makeSideChatPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    setMcpAppActiveTabByPanel((current) => ({
      ...current,
      [makeMcpAppPanelKey(activeSession.id, panelId, leafId)]: tabId,
    }));
    await ensureActivePanelOpenWithoutRefresh(panelId);
  }, [activeSession, clearPanelPreviewTab, ensureActivePanelOpenWithoutRefresh]);

  const recreateSideChatPanelTab = useCallback(async (tabId: string) => {
    if (!activeSession) return;
    const existingTab = (sideChatTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (!existingTab) return;

    const titleIndexMatch = existingTab.title.match(/(\d+)$/u);
    const titleIndex = titleIndexMatch ? Number.parseInt(titleIndexMatch[1] ?? "1", 10) : 1;
    const safeIndex = Number.isFinite(titleIndex) && titleIndex > 0 ? titleIndex : 1;
    const loadingTabId = `sidechat-loading:${existingTab.parentThreadId}:${safeIndex}`;
    setSideChatTabsBySession((current) => {
      const tabs = current[activeSession.id] ?? [];
      return {
        ...current,
        [activeSession.id]: tabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                id: loadingTabId,
                threadId: null,
                status: "loading",
                stateKey: tab.stateKey + 1,
              }
            : tab
        ),
      };
    });
    setSideChatActiveTabByPanel((current) => ({
      ...current,
      [makeSideChatPanelKey(activeSession.id, existingTab.panelId, existingTab.leafId)]: loadingTabId,
    }));

    try {
      const result = await workbenchCodexControl.startSideChat({
        projectId: existingTab.projectId,
        parentThreadId: existingTab.parentThreadId,
        parentNavigationPath: existingTab.parentNavigationPath,
      });
      const readyTabId = `sidechat:${result.threadId}`;
      setSideChatTabsBySession((current) => {
        const tabs = current[activeSession.id] ?? [];
        return {
          ...current,
          [activeSession.id]: tabs.map((tab) =>
            tab.id === loadingTabId
              ? {
                  ...tab,
                  id: readyTabId,
                  threadId: result.threadId,
                  status: "ready",
                  stateKey: tab.stateKey + 1,
                }
              : tab
          ),
        };
      });
      setSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeSideChatPanelKey(activeSession.id, existingTab.panelId, existingTab.leafId)]: readyTabId,
      }));
    } catch {
      setSideChatTabsBySession((current) => {
        const tabs = current[activeSession.id] ?? [];
        return {
          ...current,
          [activeSession.id]: tabs.map((tab) =>
            tab.id === loadingTabId
              ? {
                  ...existingTab,
                  status: "expired",
                  stateKey: existingTab.stateKey + 1,
                }
              : tab
          ),
        };
      });
      setSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeSideChatPanelKey(activeSession.id, existingTab.panelId, existingTab.leafId)]: existingTab.id,
      }));
      toast.danger("Failed to start a new side chat", { id: "side-chat-recreate-failed" });
    }
  }, [activeSession, sideChatTabsBySession, workbenchCodexControl]);

  const openPreviewTab = useCallback(async (
    kind: ProjectSessionTab["kind"],
    targetPanelId?: PanelId,
    targetLeafId?: string,
  ) => {
    if (!activeSession) return;
    if (!isPreviewableProjectSessionTabKind(kind)) return;

    const panelId = targetPanelId ?? getDefaultPanelIdForTabKind(kind);
    const leafId = targetLeafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    const draft = makeProjectSessionTabDraft(activeSession, kind);
    if (!draft) return;

    setPreviewTabsByPanel((current) => ({
      ...current,
      [makePanelPreviewKey(activeSession.id, panelId, leafId)]: makePreviewProjectSessionTab(activeSession, panelId, draft),
    }));
    await ensureActivePanelOpenWithoutRefresh(panelId);
    await refreshProjectSessions(activeSession.projectId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh, refreshProjectSessions]);

  const openWorkspaceFileTab = useCallback(async (input: {
    path: string;
    title: string;
    panelId: PanelId;
  }) => {
    if (!activeSession) return;
    const project = projects.find((candidate) => candidate.id === activeSession.projectId) ?? null;
    const workspaceRoot = normalizeProjectPrimaryWorkspaceRoot(project) ?? "";
    const existing = activeSession.tabs.find((tab) =>
      tab.kind === "files"
      && tab.panelId === input.panelId
      && "path" in tab.config
      && tab.config.path === input.path,
    );
    if (existing) {
      await setActivePanelTab(input.panelId, existing.id, { openPanel: true });
      return;
    }

    const leafId = resolveSessionPanelActiveLeafId(activeSession, input.panelId);
    setPreviewTabsByPanel((current) => ({
      ...current,
      [makePanelPreviewKey(activeSession.id, input.panelId, leafId)]: makePreviewWorkspaceFileTab(activeSession, input.panelId, {
        path: input.path,
        title: input.title || getWorkspaceFileName(input.path),
        workspaceRoot,
      }),
    }));
    await ensureActivePanelOpenWithoutRefresh(input.panelId);
    await refreshProjectSessions(activeSession.projectId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh, projects, refreshProjectSessions, setActivePanelTab]);

  const openCardTab = useCallback<OpenCardTabHandler>(async (projectId, cardId, titleSnapshot, options) => {
    if (!activeSession) {
      openCardStage(projectId, cardId, titleSnapshot);
      return;
    }

    const existing = activeSession.tabs.find((tab) =>
      tab.kind === "card_stage"
      && tab.panelId === "right"
      && "cardId" in tab.config
      && tab.config.cardId === cardId
      && tab.config.projectId === projectId,
    );
    if (existing) {
      const existingLeafId = resolveLeafIdForPanelTab(activeSession, "right", existing.id);
      clearPanelPreviewTab(activeSession.id, "right", existingLeafId);
      await updateActivePanel("right", { collapsed: false });
      await setActivePanelTab("right", existing.id, { leafId: existingLeafId, openPanel: true });
      return;
    }

    const targetLeafId = resolveCardTabTargetLeafId(activeSession, options?.sourceTabId);
    const previewLeafId = targetLeafId ?? resolveSessionPanelActiveLeafId(activeSession, "right");
    const matchingPreviewTab = getRenderablePanelPreviewTab(activeSession, "right", previewLeafId, previewTabsByPanel);
    if (
      options?.openMode !== "preview"
      && matchingPreviewTab?.kind === "card_stage"
      && "cardId" in matchingPreviewTab.config
      && matchingPreviewTab.config.cardId === cardId
      && matchingPreviewTab.config.projectId === projectId
    ) {
      await pinPreviewTab("right", matchingPreviewTab.id, previewLeafId);
      return;
    }

    if (options?.openMode === "preview") {
      setPreviewTabsByPanel((current) => ({
        ...current,
        [makePanelPreviewKey(activeSession.id, "right", previewLeafId)]: makePreviewCardStageTab(
          activeSession,
          "right",
          previewLeafId,
          { projectId, cardId, titleSnapshot },
        ),
      }));
      await ensureActivePanelOpenWithoutRefresh("right");
      await refreshProjectSessions(activeSession.projectId);
      return;
    }

    await invoke("project-session-tabs:create", {
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
      panelId: "right",
      ...(targetLeafId ? { targetLeafId } : {}),
      kind: "card_stage",
      title: titleSnapshot || cardId,
      config: { projectId, cardId, titleSnapshot },
    });
    await ensureActivePanelOpenWithoutRefresh("right");
    await refreshProjectSessions(activeSession.projectId);
  }, [
    activeSession,
    clearPanelPreviewTab,
    ensureActivePanelOpenWithoutRefresh,
    openCardStage,
    pinPreviewTab,
    previewTabsByPanel,
    refreshProjectSessions,
    setActivePanelTab,
    updateActivePanel,
  ]);

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
    await invoke("project-session-panels:update", session.id, "right", {
      size: { ...session.panels.right.size, fullWidth: false },
    });
    await refreshProjectSessions(projectId);
  }, [ensureBlankSessionForProject, refreshProjectSessions]);

  const openSidebarTaskSearch = useCallback(() => {
    setSidebarTaskSearchOpenTick((current) => current + 1);
    if (!activeSession?.panels.right.collapsed) return;
    void updateActivePanel("right", { collapsed: false });
  }, [activeSession?.panels.right.collapsed, updateActivePanel]);

  const openSidebarCommandPalette = useCallback(() => {
    setCommandPaletteOpenRequest((current) => ({
      tick: current.tick + 1,
      initialQuery: "",
    }));
    setCommandPaletteOpen(true);
  }, []);

  const showSidebarUnavailableProduct = useCallback((label: string) => {
    toast.info(`${label} is not available in Nodex yet.`, {
      id: `sidebar-${label.toLowerCase()}-unavailable`,
    });
  }, []);

  const toggleProjectsSectionCollapsed = useCallback(() => {
    setProjectsSectionCollapsed((current) => !current);
  }, []);

  const togglePinnedProjectsSectionCollapsed = useCallback(() => {
    setPinnedProjectsSectionCollapsed((current) => !current);
  }, []);

  const toggleProjectExpanded = useCallback((projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

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

  const createManualTab = useCallback(async (kind: ProjectSessionTab["kind"], targetPanelId?: PanelId) => {
    if (!activeSession) return;
    const panelId = targetPanelId ?? getDefaultPanelIdForTabKind(kind);
    const draft = makeProjectSessionTabDraft(activeSession, kind);
    if (!draft) return;

    await invoke("project-session-tabs:create", {
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
      panelId,
      ...draft,
    });
    await ensureActivePanelOpenWithoutRefresh(panelId);
    await refreshProjectSessions(activeSession.projectId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh, refreshProjectSessions]);

  const openAttachedThreadSession = useCallback((threadId: string) => {
    const session = Object.values(sessionsByProject)
      .flat()
      .find((candidate) => candidate.thread?.threadId === threadId);
    if (!session) {
      toast.info("That thread is not attached to a chat in this workspace", {
        id: `thread-open-unattached-${threadId}`,
      });
      return;
    }

    selectSession(session);
  }, [selectSession, sessionsByProject]);

  const openTurnDiffReview = useCallback((target: CodexTurnDiffReviewTarget) => {
    setSelectedTurnDiffReviewTarget(target);
    void createManualTab("review", "right");
  }, [createManualTab]);

  const forkSessionFromTurn = useCallback(async (input: {
    threadId: string;
    turnId: string;
    message: string;
    collaborationMode: CodexCollaborationModeKind;
  }) => {
    const sourceSession = Object.values(sessionsByProject)
      .flat()
      .find((candidate) => candidate.thread?.threadId === input.threadId);
    if (!sourceSession) {
      throw new Error("This thread is not attached to a project session");
    }

    const result = await invoke("project-sessions:fork", sourceSession.id, {
      target: "local",
      turnId: input.turnId,
      message: input.message,
      collaborationMode: input.collaborationMode,
    }) as ProjectSessionForkResult;
    await refreshProjectSessions(result.session.projectId);
    selectSession(result.session);
    if (result.composerIntent) {
      workbenchCodexControl.setComposerIntent(result.threadId, result.composerIntent);
    }
    await workbenchCodexControl.requestThreadStreamSnapshot(result.threadId);
  }, [refreshProjectSessions, selectSession, sessionsByProject, workbenchCodexControl]);

  const createBrowserTabToRight = useCallback(async (sourceTab: ProjectSessionTab, duplicate: boolean) => {
    if (!activeSession) return;
    const panelId = sourceTab.panelId;
    const panelTabs = activeSession.tabs.filter((tab) => tab.panelId === panelId);
    const sourceIndex = panelTabs.findIndex((tab) => tab.id === sourceTab.id);
    const sourceConfig = sourceTab.kind === "browser" && "projectId" in sourceTab.config
      ? sourceTab.config
      : { projectId: activeSession.projectId };
    const created = await invoke("project-session-tabs:create", {
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
      panelId,
      kind: "browser",
      title: duplicate ? sourceTab.title || "Browser" : "Browser",
      config: duplicate
        ? {
            projectId: activeSession.projectId,
            ...("url" in sourceConfig && typeof sourceConfig.url === "string" ? { url: sourceConfig.url } : {}),
            ...("title" in sourceConfig && typeof sourceConfig.title === "string" ? { title: sourceConfig.title } : {}),
            ...("faviconUrl" in sourceConfig && typeof sourceConfig.faviconUrl === "string" ? { faviconUrl: sourceConfig.faviconUrl } : {}),
            ...("deviceToolbarVisible" in sourceConfig && typeof sourceConfig.deviceToolbarVisible === "boolean"
              ? { deviceToolbarVisible: sourceConfig.deviceToolbarVisible }
              : {}),
          }
        : { projectId: activeSession.projectId },
    }) as ProjectSessionTab;

    if (sourceIndex >= 0) {
      await invoke("project-session-tabs:move", {
        tabId: created.id,
        targetPanelId: panelId,
        targetIndex: sourceIndex + 1,
      });
    }
    await setActivePanelTab(panelId, created.id, { openPanel: true });
    await refreshProjectSessions(activeSession.projectId);
  }, [activeSession, refreshProjectSessions, setActivePanelTab]);

  const reloadBrowserTab = useCallback((tabId: string) => {
    void invoke("browser-sidebar-command", { type: "reload", tabId });
  }, []);

  const focusOrCreateSessionTerminalTab = useCallback(async () => {
    if (!activeSession) return;
    const existing =
      activeSession.tabs.find((tab) => tab.kind === "terminal" && tab.panelId === "bottom")
      ?? activeSession.tabs.find((tab) => tab.kind === "terminal");
    if (existing) {
      await setActivePanelTab(existing.panelId, existing.id, { openPanel: true });
      return;
    }
    await createManualTab("terminal", "bottom");
  }, [activeSession, createManualTab, setActivePanelTab]);

  const openCardStageFromPicker = useCallback(async (card: CardSummary) => {
    if (!activeSession) return;
    await openCardTab(activeSession.projectId, card.id, card.title || card.id);
  }, [activeSession, openCardTab]);

  const rememberFocusedPanelGroup = useCallback((panelId: PanelId, leafId: string) => {
    focusedPanelGroupRef.current = { panelId, leafId };
  }, []);

  useEffect(() => {
    focusedPanelGroupRef.current = null;
  }, [activeSession?.id]);

  const cycleFocusedPanelTab = useEffectEvent((
    direction: PanelTabCycleDirection,
    scope: PanelTabCycleScope | null,
    options: { respectActiveElementGuard?: boolean } = {},
  ): boolean => {
    if (!activeSession) return false;
    if (
      options.respectActiveElementGuard
      && typeof document !== "undefined"
      && isFocusedPanelTabShortcutTargetBlocked(document.activeElement)
    ) {
      return false;
    }

    const targetScope = scope ?? focusedPanelGroupRef.current;
    if (!targetScope) return false;

    const panelTabs = panelGroupTabs[targetScope.panelId];
    if (!(targetScope.leafId in panelTabs.itemsByLeafId)) return false;

    const tabs = panelTabs.itemsByLeafId[targetScope.leafId] ?? [];
    const activeTabId = panelTabs.activeTabIdsByLeafId[targetScope.leafId] ?? null;
    const nextTabId = resolveNextPanelTabId(tabs, activeTabId, direction);
    if (nextTabId) {
      void selectPanelTab(targetScope.panelId, nextTabId, targetScope.leafId);
    }
    return true;
  });

  const closeFocusedPanelTab = useEffectEvent((
    scope: PanelTabCycleScope | null,
    options: { respectActiveElementGuard?: boolean } = {},
  ): boolean => {
    if (!activeSession) return false;
    if (
      options.respectActiveElementGuard
      && typeof document !== "undefined"
      && isFocusedPanelTabShortcutTargetBlocked(document.activeElement)
    ) {
      return false;
    }

    const targetScope = scope ?? focusedPanelGroupRef.current;
    if (!targetScope) return false;

    const panelTabs = panelGroupTabs[targetScope.panelId];
    if (!(targetScope.leafId in panelTabs.itemsByLeafId)) return false;

    const tabs = panelTabs.itemsByLeafId[targetScope.leafId] ?? [];
    const activeTabId = panelTabs.activeTabIdsByLeafId[targetScope.leafId] ?? null;
    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
    if (activeTab?.closable === true) {
      void closePanelTab(targetScope.panelId, activeTab.id, targetScope.leafId);
    }
    return true;
  });

  const handleRightPanelShortcut = useEffectEvent((event: KeyboardEvent): boolean => {
    if (!activeSession) return false;

    const cycleDirection = resolvePanelTabCycleDirection(event, isMacPlatform);
    if (cycleDirection) {
      if (isFocusedPanelTabShortcutTargetBlocked(event.target)) return false;
      const scope = resolveFocusedPanelTabCycleScope(event.target);
      if (scope) {
        rememberFocusedPanelGroup(scope.panelId, scope.leafId);
        return cycleFocusedPanelTab(cycleDirection, scope);
      }
      if (!isDocumentLevelShortcutTarget(event.target)) return false;
      return cycleFocusedPanelTab(cycleDirection, null);
    }

    if (resolvePanelTabCloseShortcut(event, isMacPlatform)) {
      if (isFocusedPanelTabShortcutTargetBlocked(event.target)) return false;
      const scope = resolveFocusedPanelTabCycleScope(event.target);
      if (scope) {
        rememberFocusedPanelGroup(scope.panelId, scope.leafId);
        return closeFocusedPanelTab(scope);
      }
      if (!isDocumentLevelShortcutTarget(event.target)) return false;
      return closeFocusedPanelTab(null);
    }

    if (isWorkbenchNewChatShortcutTargetEditable(event.target)) return false;

    const action = PANEL_NEW_TAB_ACTIONS.find((candidate) =>
      candidate.shortcut ? matchesPanelShortcut(event, candidate.shortcut, isMacPlatform) : false,
    );
    if (!action) return false;

    if (action.kind === "terminal") {
      void focusOrCreateSessionTerminalTab();
      return true;
    }

    if (action.kind === "side_chat") {
      void openSideChat({ targetPanelId: action.defaultPanelId });
      return true;
    }

    if (!isProjectSessionTabKind(action.kind)) return true;

    if (isPreviewableProjectSessionTabKind(action.kind)) {
      void openPreviewTab(action.kind, action.defaultPanelId);
      return true;
    }

    void createManualTab(action.kind, action.defaultPanelId);
    return true;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!handleRightPanelShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const showActiveRightPanel = useCallback(async () => {
    if (!activeSession) return;
    await setActivePanelCollapsed("right", false);
  }, [activeSession, setActivePanelCollapsed]);

  const hideActiveRightPanel = useCallback(async () => {
    if (!activeSession) return;
    await setActivePanelCollapsed("right", true);
  }, [activeSession, setActivePanelCollapsed]);

  const showActiveBottomPanel = useCallback(async () => {
    if (!activeSession) return;
    await setActivePanelCollapsed("bottom", false);
  }, [activeSession, setActivePanelCollapsed]);

  const hideActiveBottomPanel = useCallback(async () => {
    if (!activeSession) return;
    await setActivePanelCollapsed("bottom", true);
  }, [activeSession, setActivePanelCollapsed]);

  const toggleActiveRightPanelFullWidth = useCallback(() => {
    if (!activeSession) return;
    const currentSnapshot = currentShellNavigationSnapshotRef.current;
    if (currentSnapshot) {
      recordShellNavigation({
        ...currentSnapshot,
        rightPanelCollapsed: false,
        rightPanelFullWidth: !rightPanelFullWidth,
      });
    }
    const overrideKey = makePanelPreviewKey(activeSession.id, "right");
    setPanelCollapsedOverrides((current) => ({ ...current, [overrideKey]: false }));
    void (async () => {
      try {
        await updateActivePanel("right", {
          collapsed: false,
          size: {
            ...activeSession.panels.right.size,
            fullWidth: !rightPanelFullWidth,
          },
        });
      } catch (error) {
        toast.danger(error instanceof Error ? error.message : "Unable to update panel");
      } finally {
        setPanelCollapsedOverrides((current) => {
          if (!(overrideKey in current)) return current;
          const next = { ...current };
          delete next[overrideKey];
          return next;
        });
      }
    })();
  }, [activeSession, recordShellNavigation, rightPanelFullWidth, updateActivePanel]);

  const applyPanelNavigationSnapshot = useCallback(async (
    session: ProjectSession,
    panelId: PanelId,
    activeTabId: string | null,
    collapsed: boolean,
    fullWidth?: boolean,
  ) => {
    const panel = session.panels[panelId];
    if (activeTabId) {
      await invoke("project-session-panels:activate", {
        sessionId: session.id,
        panelId,
        leafId: resolveLeafIdForPanelTab(session, panelId, activeTabId),
        tabId: activeTabId,
      });
    }
    await updateSessionPanel(
      session.id,
      panelId,
      {
        collapsed,
        ...(panelId === "right"
          ? { size: { ...panel.size, fullWidth: fullWidth ?? false } }
          : {}),
      },
      { refresh: false },
    );
  }, [updateSessionPanel]);

  const applyShellNavigationSnapshot = useCallback(async (snapshot: WorkbenchShellNavigationSnapshot) => {
    if (!projects.some((candidate) => candidate.id === snapshot.activeProjectId)) return;

    applyingShellNavigationRef.current = true;
    let overrideSessionId: string | null = null;
    try {
      setActiveProjectId(snapshot.activeProjectId);
      setDbProject(snapshot.activeProjectId);
      setExpandedProjectIds((current) => new Set([...current, snapshot.activeProjectId]));

      const projectSessions = sessionsByProject[snapshot.activeProjectId] ?? await refreshProjectSessions(snapshot.activeProjectId);
      const targetSession =
        projectSessions.find((session) => session.id === snapshot.activeSessionId)
        ?? projectSessions.find((session) => session.isOverview)
        ?? projectSessions[0]
        ?? null;

      setActiveSessionId(targetSession?.id ?? null);
      if (!targetSession) return;

      overrideSessionId = targetSession.id;
      setPanelCollapsedOverrides((current) => ({
        ...current,
        [makePanelPreviewKey(targetSession.id, "right")]: snapshot.rightPanelCollapsed,
        [makePanelPreviewKey(targetSession.id, "bottom")]: snapshot.bottomPanelCollapsed,
      }));
      await applyPanelNavigationSnapshot(
        targetSession,
        "right",
        snapshot.rightActiveTabId,
        snapshot.rightPanelCollapsed,
        snapshot.rightPanelFullWidth,
      );
      await applyPanelNavigationSnapshot(
        targetSession,
        "bottom",
        snapshot.bottomActiveTabId,
        snapshot.bottomPanelCollapsed,
      );
      await refreshProjectSessions(targetSession.projectId);
    } finally {
      if (overrideSessionId) {
        const sessionId = overrideSessionId;
        setPanelCollapsedOverrides((current) => {
          const next = { ...current };
          delete next[makePanelPreviewKey(sessionId, "right")];
          delete next[makePanelPreviewKey(sessionId, "bottom")];
          return next;
        });
      }
      applyingShellNavigationRef.current = false;
    }
  }, [applyPanelNavigationSnapshot, projects, refreshProjectSessions, sessionsByProject, setDbProject]);

  const executeShellNavigation = useCallback(async (direction: "back" | "forward") => {
    const currentSnapshot = currentShellNavigationSnapshotRef.current;
    if (!currentSnapshot) return;
    const result = direction === "back"
      ? navigateBackInWorkbenchShellHistory(shellNavigationHistory, currentSnapshot)
      : navigateForwardInWorkbenchShellHistory(shellNavigationHistory, currentSnapshot);
    if (!result.snapshot) return;
    setShellNavigationHistory(result.historyState);
    await applyShellNavigationSnapshot(result.snapshot);
  }, [applyShellNavigationSnapshot, shellNavigationHistory]);

  useEffect(() => {
    if (!navigationCommandRequest) return;
    if (navigationCommandRequest.tick <= 0) return;
    if (lastHandledNavigationCommandTickRef.current === navigationCommandRequest.tick) return;
    lastHandledNavigationCommandTickRef.current = navigationCommandRequest.tick;
    void executeShellNavigation(navigationCommandRequest.direction);
  }, [executeShellNavigation, navigationCommandRequest]);

  useEffect(() => {
    if (!panelTabCycleRequest) return;
    if (panelTabCycleRequest.tick <= 0) return;
    if (lastHandledPanelTabCycleRequestTickRef.current === panelTabCycleRequest.tick) return;
    lastHandledPanelTabCycleRequestTickRef.current = panelTabCycleRequest.tick;
    cycleFocusedPanelTab(
      panelTabCycleRequestDirectionToOffset(panelTabCycleRequest.direction),
      null,
      { respectActiveElementGuard: true },
    );
  }, [cycleFocusedPanelTab, panelTabCycleRequest]);

  useEffect(() => {
    if (!panelTabCloseRequest) return;
    if (panelTabCloseRequest.tick <= 0) return;
    if (lastHandledPanelTabCloseRequestTickRef.current === panelTabCloseRequest.tick) return;
    lastHandledPanelTabCloseRequestTickRef.current = panelTabCloseRequest.tick;
    closeFocusedPanelTab(null, { respectActiveElementGuard: true });
  }, [closeFocusedPanelTab, panelTabCloseRequest]);

  const resizeRightPanel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const root = workbenchRootRef.current;
    const windowZoom = readCodexWindowZoom(root);
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    const sizingWidth = rightPanelSizingWidth;
    const startX = event.clientX / windowZoom;
    const startWidth = regularRightPanelWidth;

    let latestWidth = startWidth;
    let closedByResize = false;
    setRightPanelDragWidth(startWidth);
    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      if (closedByResize) return;
      const pointerX = moveEvent.clientX / windowZoom;
      const rawWidth = startWidth + startX - pointerX;
      if (rawWidth < RIGHT_PANEL_MIN_WIDTH) {
        closedByResize = true;
        latestWidth = RIGHT_PANEL_MIN_WIDTH;
        setRightPanelDragWidth(null);
        void setActivePanelCollapsed("right", true);
        return;
      }

      const nextWidth = clampRegularRightPanelWidth(rawWidth, sizingWidth);
      latestWidth = nextWidth;
      setRightPanelDragWidth(nextWidth);
      setRightPanelWidth(nextWidth);
    };

    const cleanupPointerResize = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      if (resizeHandle.hasPointerCapture?.(pointerId)) {
        resizeHandle.releasePointerCapture(pointerId);
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      upEvent.preventDefault();
      cleanupPointerResize();
      void (async () => {
        try {
          if (!activeSession || closedByResize) return;
          await updateActivePanel("right", {
            size: {
              ...activeSession.panels.right.size,
              widthPx: latestWidth,
            },
          });
        } finally {
          setRightPanelDragWidth(null);
        }
      })();
    };
    const onPointerCancel = () => {
      cleanupPointerResize();
      setRightPanelDragWidth(null);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }, [activeSession, regularRightPanelWidth, rightPanelSizingWidth, setActivePanelCollapsed, updateActivePanel]);

  const resizeBottomPanel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const root = workbenchRootRef.current;
    const windowZoom = readCodexWindowZoom(root);
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY / windowZoom;
    const startHeight = bottomPanelHeight;
    let latestHeight = startHeight;
    let closedByResize = false;
    setBottomPanelDragHeight(startHeight);

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      if (closedByResize) return;
      const pointerY = moveEvent.clientY / windowZoom;
      const rawHeight = startHeight + startY - pointerY;
      if (rawHeight < BOTTOM_PANEL_MIN_HEIGHT) {
        closedByResize = true;
        latestHeight = BOTTOM_PANEL_MIN_HEIGHT;
        setBottomPanelDragHeight(null);
        void setActivePanelCollapsed("bottom", true);
        return;
      }

      const nextHeight = clampBottomPanelHeight(rawHeight, sessionContentHeight);
      latestHeight = nextHeight;
      setBottomPanelDragHeight(nextHeight);
    };

    const cleanupPointerResize = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      if (resizeHandle.hasPointerCapture?.(pointerId)) {
        resizeHandle.releasePointerCapture(pointerId);
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      upEvent.preventDefault();
      cleanupPointerResize();
      void (async () => {
        try {
          if (!activeSession || closedByResize) return;
          await updateActivePanel("bottom", {
            size: {
              ...activeSession.panels.bottom.size,
              heightPx: latestHeight,
            },
          });
        } finally {
          setBottomPanelDragHeight(null);
        }
      })();
    };
    const onPointerCancel = () => {
      cleanupPointerResize();
      setBottomPanelDragHeight(null);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }, [activeSession, bottomPanelHeight, sessionContentHeight, setActivePanelCollapsed, updateActivePanel]);

  const activePanelCardStageCardIdsByProject = useMemo<ReadonlyMap<string, ReadonlySet<string>>>(() => {
    const byProject = new Map<string, Set<string>>();
    if (!activeSession) return byProject;

    const durableById = new Map(activeSession.tabs.map((tab) => [tab.id, tab]));
    const collectPanelVisibleCardStageCards = (panelId: PanelId, panelOpen: boolean) => {
      if (!panelOpen) return;

      const panel = activeSession.panels[panelId];
      const panelActiveLeafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
      const leaves = listProjectSessionPanelLeaves(panel.layout);
      const visibleLeaves = panel.layout.maximizedLeafId
        ? leaves.filter((leaf) => leaf.id === panel.layout.maximizedLeafId)
        : leaves;

      for (const leaf of visibleLeaves) {
        const previewTab = getRenderablePanelPreviewTab(activeSession, panelId, leaf.id, previewTabsByPanel);

        const durableTabs = leaf.tabIds.flatMap((tabId) => {
          const tab = durableById.get(tabId);
          return tab && tab.panelId === panelId ? [tab] : [];
        });
        const sideChatTabs = (sideChatTabsBySession[activeSession.id] ?? []).filter((tab) =>
          tab.panelId === panelId && (tab.leafId ?? panelActiveLeafId) === leaf.id
        );
        const mcpAppTabs = (mcpAppTabsBySession[activeSession.id] ?? []).filter((tab) =>
          tab.panelId === panelId && (tab.leafId ?? panelActiveLeafId) === leaf.id
        );
        const renderableTabs: ProjectSessionRenderableTab[] = [
          ...durableTabs,
          ...sideChatTabs,
          ...mcpAppTabs,
          ...(previewTab ? [previewTab] : []),
        ];
        const sideChatActiveTabId = sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === panelActiveLeafId ? sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const mcpAppActiveTabId = mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === panelActiveLeafId ? mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const activeTabId = previewTab?.id
          ?? (mcpAppActiveTabId && renderableTabs.some((tab) => tab.id === mcpAppActiveTabId)
            ? mcpAppActiveTabId
            : null)
          ?? (sideChatActiveTabId && renderableTabs.some((tab) => tab.id === sideChatActiveTabId)
            ? sideChatActiveTabId
            : leaf.activeTabId)
          ?? renderableTabs[0]?.id
          ?? null;
        const activeTab = activeTabId ? renderableTabs.find((tab) => tab.id === activeTabId) : null;
        if (!activeTab || isSideChatPanelTab(activeTab) || isMcpAppPanelTab(activeTab)) continue;

        const cardRef = readCardStagePanelTabCardRef(activeTab);
        if (!cardRef) continue;

        const cardIds = byProject.get(cardRef.projectId) ?? new Set<string>();
        cardIds.add(cardRef.cardId);
        byProject.set(cardRef.projectId, cardIds);
      }
    };

    collectPanelVisibleCardStageCards("right", sidePanelOpen);
    collectPanelVisibleCardStageCards("bottom", bottomPanelOpen);
    return byProject;
  }, [
    activeSession,
    bottomPanelOpen,
    mcpAppActiveTabByPanel,
    mcpAppTabsBySession,
    previewTabsByPanel,
    sideChatActiveTabByPanel,
    sideChatTabsBySession,
    sidePanelOpen,
  ]);

  const panelGroupTabs = useMemo<Record<PanelId, {
    itemsByLeafId: Record<string, AppShellTabItem[]>;
    activeTabIdsByLeafId: Record<string, string | null>;
  }>>(() => {
    const empty = {
      right: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
      bottom: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
    } satisfies Record<PanelId, {
      itemsByLeafId: Record<string, AppShellTabItem[]>;
      activeTabIdsByLeafId: Record<string, string | null>;
    }>;
    if (!activeSession) return empty;
    const makeItem = (tab: ProjectSessionRenderableTab): AppShellTabItem => {
      const chromeContext = resolveCardStageTabChromeContext(tab, activeSession, projects);

      return {
        id: tab.id,
        domTabId: !isSideChatPanelTab(tab) && !isMcpAppPanelTab(tab) && tab.kind === "files" && "path" in tab.config
          ? getWorkspaceFileDomTabId("hostId" in tab.config ? tab.config.hostId : "local", tab.config.path)
          : undefined,
        title: tab.title,
        ...chromeContext,
        icon: isSideChatPanelTab(tab)
          ? CodexSidePanelSideChatIcon
          : isMcpAppPanelTab(tab)
            ? ComposerPluginsIcon
            : getBrowserTabIcon(tab),
        closable: isSideChatPanelTab(tab)
          ? tab.status !== "loading"
          : isMcpAppPanelTab(tab)
            ? true
            : tab.preview === true || !activeSession.isOverview || activeSession.tabs.length > 1,
        preview: isSideChatPanelTab(tab) || isMcpAppPanelTab(tab) ? undefined : tab.preview,
        reorderable: isSideChatPanelTab(tab) || isMcpAppPanelTab(tab) ? false : tab.preview === true ? false : true,
        splittable: !isSideChatPanelTab(tab) && !isMcpAppPanelTab(tab) && tab.preview !== true,
        contextMenuItems: !isSideChatPanelTab(tab) && !isMcpAppPanelTab(tab) && tab.kind === "browser"
          ? [
              {
                id: "browser-new-tab-right",
                label: "New tab to the right",
                onSelect: () => void createBrowserTabToRight(tab, false),
              },
              {
                id: "browser-reload",
                label: "Reload",
                onSelect: () => reloadBrowserTab(tab.id),
              },
              {
                id: "browser-duplicate",
                label: "Duplicate",
                onSelect: () => void createBrowserTabToRight(tab, true),
              },
            ]
          : undefined,
        renderPanel: () => {
          if (isSideChatPanelTab(tab)) {
            return (
              <SideChatSessionTab
                key={`${activeSession.id}:${tab.id}:${tab.stateKey}`}
                tab={tab}
                activeSession={activeSession}
                projects={projects}
                onOpenCardTab={openCardTab}
                onRefreshSessions={refreshProjectSessions}
                onRecreateSideChat={() => void recreateSideChatPanelTab(tab.id)}
                onOpenMcpAppSidePanel={openMcpAppSidePanel}
                onQueueingEnabledChange={handleThreadQueueFollowUpsEnabledChange}
                onOpenThread={openAttachedThreadSession}
                onOpenTurnDiffReview={openTurnDiffReview}
              />
            );
          }
          if (isMcpAppPanelTab(tab)) {
            return <McpAppSessionTab key={`${activeSession.id}:${tab.id}:${tab.stateKey}`} tab={tab} />;
          }
          return (
            <ProjectSessionTabPanel
              key={`${activeSession.id}:${tab.id}:${tab.stateKey}`}
              tab={tab}
              activeSession={activeSession}
              projects={projects}
              activeView={activeView}
              activeSearchQuery={activeSearchQuery}
              activeDbViewPrefs={activeDbViewPrefs}
              searchByProject={searchByProject}
              dbViewPrefsByProject={dbViewPrefsByProject}
              activePanelCardStageCardIdsByProject={activePanelCardStageCardIdsByProject}
              cardStageCloseRef={cardStageCloseRef}
              cardStagePersistRef={cardStagePersistRef}
              cardStageSessionSnapshotRef={cardStageSessionSnapshotRef}
              pendingReminderOpen={pendingReminderOpen}
              taskSearchOpenTick={sidebarTaskSearchOpenTick}
              setSearchQuery={setSearchQuery}
              setDbViewPrefs={setDbViewPrefs}
              onReminderHandled={onReminderHandled}
              onLeaveCardStageCard={onLeaveCardStageCard}
              onOpenCardTab={openCardTab}
              onOpenFileTab={openWorkspaceFileTab}
              onRefreshSessions={refreshProjectSessions}
              onCloseTab={closeTab}
              cardStageHistoryModal={cardStageHistoryModal}
              onToggleCardStageHistoryModal={toggleCardStageHistoryModal}
              selectedTurnDiffReviewTarget={selectedTurnDiffReviewTarget}
              browserBoundsSyncTrigger={tab.panelId === "bottom"
                ? bottomPanelMotion.animatedSize
                : rightPanelMotion.animatedSize}
            />
          );
        },
      };
    };
    const durableById = new Map(activeSession.tabs.map((tab) => [tab.id, tab]));
    const buildPanelTabs = (panelId: PanelId) => {
      const panel = activeSession.panels[panelId];
      const leaves = listProjectSessionPanelLeaves(panel.layout);
      const activeLeafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
      const itemsByLeafId: Record<string, AppShellTabItem[]> = {};
      const activeTabIdsByLeafId: Record<string, string | null> = {};

      for (const leaf of leaves) {
        const durableTabs = leaf.tabIds.flatMap((tabId) => {
          const tab = durableById.get(tabId);
          return tab && tab.panelId === panelId ? [tab] : [];
        });
        const sideChatTabs = (sideChatTabsBySession[activeSession.id] ?? []).filter((tab) =>
          tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leaf.id
        );
        const mcpAppTabs = (mcpAppTabsBySession[activeSession.id] ?? []).filter((tab) =>
          tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leaf.id
        );
        const previewTab = getRenderablePanelPreviewTab(activeSession, panelId, leaf.id, previewTabsByPanel);
        const renderableTabs: ProjectSessionRenderableTab[] = previewTab
          ? [...durableTabs, ...sideChatTabs, ...mcpAppTabs, previewTab]
          : [...durableTabs, ...sideChatTabs, ...mcpAppTabs];
        const sideChatActiveTabId = sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === activeLeafId ? sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const mcpAppActiveTabId = mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === activeLeafId ? mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const activeTabId = previewTab?.id
          ?? (mcpAppActiveTabId && renderableTabs.some((tab) => tab.id === mcpAppActiveTabId)
            ? mcpAppActiveTabId
            : null)
          ?? (sideChatActiveTabId && renderableTabs.some((tab) => tab.id === sideChatActiveTabId)
            ? sideChatActiveTabId
            : leaf.activeTabId)
          ?? renderableTabs[0]?.id
          ?? null;

        itemsByLeafId[leaf.id] = renderableTabs.map(makeItem);
        activeTabIdsByLeafId[leaf.id] = activeTabId;
      }

      return { itemsByLeafId, activeTabIdsByLeafId };
    };

    return {
      right: buildPanelTabs("right"),
      bottom: buildPanelTabs("bottom"),
    };
  }, [
    activeDbViewPrefs,
    activePanelCardStageCardIdsByProject,
    activeSearchQuery,
    activeSession,
    activeView,
    bottomPanelMotion.animatedSize,
    cardStageCloseRef,
    cardStageHistoryModal,
    cardStagePersistRef,
    cardStageSessionSnapshotRef,
    closeTab,
    createBrowserTabToRight,
    mcpAppActiveTabByPanel,
    mcpAppTabsBySession,
    onLeaveCardStageCard,
    onReminderHandled,
    openSideChat,
    openMcpAppSidePanel,
    openCardTab,
    openWorkspaceFileTab,
    handleThreadQueueFollowUpsEnabledChange,
    openAttachedThreadSession,
    openTurnDiffReview,
    pendingReminderOpen,
    projects,
    recreateSideChatPanelTab,
    refreshProjectSessions,
    reloadBrowserTab,
    rightPanelMotion.animatedSize,
    sidebarTaskSearchOpenTick,
    dbViewPrefsByProject,
    searchByProject,
    setDbViewPrefs,
    setSearchQuery,
    sideChatActiveTabByPanel,
    sideChatTabsBySession,
    selectedTurnDiffReviewTarget,
    toggleCardStageHistoryModal,
    previewTabsByPanel,
  ]);

  const browserRetentionTabs = useMemo<ProjectSessionTab[]>(() => {
    if (!activeSession) return [];
    const durableBrowserTabs = activeSession.tabs.filter((tab) => tab.kind === "browser");
    const previewBrowserTabs = Object.values(previewTabsByPanel).filter((tab): tab is ProjectSessionPreviewTab =>
      tab.sessionId === activeSession.id && tab.kind === "browser"
    );
    return [...durableBrowserTabs, ...previewBrowserTabs];
  }, [activeSession, previewTabsByPanel]);

  const visibleBrowserTabIds = useMemo<ReadonlySet<string>>(() => {
    const visibleIds = new Set<string>();
    if (!activeSession) return visibleIds;
    const browserTabIds = new Set(browserRetentionTabs.map((tab) => tab.id));
    const collectPanelVisibleTabs = (panelId: PanelId, panelOpen: boolean) => {
      if (!panelOpen) return;
      const layout = activeSession.panels[panelId].layout;
      const leafIds = layout.maximizedLeafId
        ? [layout.maximizedLeafId]
        : listProjectSessionPanelLeaves(layout).map((leaf) => leaf.id);
      for (const leafId of leafIds) {
        const tabId = panelGroupTabs[panelId].activeTabIdsByLeafId[leafId];
        if (tabId && browserTabIds.has(tabId)) visibleIds.add(tabId);
      }
    };

    collectPanelVisibleTabs("right", sidePanelOpen);
    collectPanelVisibleTabs("bottom", bottomPanelOpen);
    return visibleIds;
  }, [activeSession, bottomPanelOpen, browserRetentionTabs, panelGroupTabs, sidePanelOpen]);

  const applySidebarCollapsed = useCallback((collapsed: boolean) => {
    if (setSidebarCollapsed) {
      setSidebarCollapsed(collapsed);
    } else {
      setLocalSidebarCollapsed(collapsed);
    }
  }, [setSidebarCollapsed]);

  const setSidebarCollapsedWithCodexState = useCallback((
    collapsed: boolean,
    options: { animate?: boolean; suppressHoverOpen?: boolean } = {},
  ) => {
    const nextOpen = !collapsed;
    const suppressHoverOpen = shouldSuppressCodexSidebarHoverOpen({
      nextOpen,
      suppressHoverOpen: options.suppressHoverOpen,
    });
    const shouldAnimate = shouldAnimateCodexSidebarToggle({
      animate: options.animate,
      reducedMotion,
    });
    setSidebarTriggerHovered(false);
    setSidebarHoverSuppressed(suppressHoverOpen);
    setFloatingSidebarVisible(false);
    setSidebarAnimateLayout(shouldAnimate);
    applySidebarCollapsed(collapsed);
  }, [applySidebarCollapsed, reducedMotion]);

  const applySidebarWidth = useCallback((
    width: number,
    phase: SidebarResizePhase = "end",
    surface: SidebarResizeSurface = "inline",
  ) => {
    if (surface === "inline" && shouldCollapseCodexSidebarResizeWidth(width)) {
      setSidebarDragWidth(null);
      setSidebarCollapsedWithCodexState(true);
      return;
    }

    const nextWidth = clampCodexSidebarWidth(width);
    realSidebarMotion.targetSize.set(nextWidth);
    if (surface === "floating") {
      setFloatingSidebarVisible(true);
    }
    if (phase === "live") {
      setSidebarDragWidth(nextWidth);
      return;
    }

    setSidebarDragWidth(null);
    if (setSidebarWidth) {
      setSidebarWidth(nextWidth);
    } else {
      setLocalSidebarWidth(nextWidth);
    }
  }, [realSidebarMotion.targetSize, setSidebarCollapsedWithCodexState, setSidebarWidth]);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsedWithCodexState(!sidebarCollapsed);
  }, [
    setSidebarCollapsedWithCodexState,
    sidebarCollapsed,
  ]);

  const showRealSidebarFromFloatingPanel = useCallback(() => {
    setSidebarCollapsedWithCodexState(false, {
      animate: false,
      suppressHoverOpen: false,
    });
  }, [setSidebarCollapsedWithCodexState]);

  useEffect(() => {
    if (lastHandledSidebarToggleRequestTickRef.current === sidebarToggleRequestTick) return;
    lastHandledSidebarToggleRequestTickRef.current = sidebarToggleRequestTick;
    setSidebarCollapsedWithCodexState(!sidebarCollapsed);
  }, [
    setSidebarCollapsedWithCodexState,
    sidebarCollapsed,
    sidebarToggleRequestSource,
    sidebarToggleRequestTick,
  ]);

  useEffect(() => {
    if (sidebarCollapsed) return;
    setFloatingSidebarVisible(false);
    setSidebarHoverSuppressed(false);
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (appShellWidth <= 0) return;
    const atMediumWidth = appShellWidth <= CODEX_SHELL_MEDIUM_WIDTH_PX;
    const atNarrowWidth = appShellWidth <= CODEX_SHELL_NARROW_WIDTH_PX;
    const crossedMediumWidth = atMediumWidth !== shellAtMediumWidthRef.current;
    const crossedNarrowWidth = atNarrowWidth !== shellAtNarrowWidthRef.current;
    if (!crossedMediumWidth && !crossedNarrowWidth) return;

    shellAtMediumWidthRef.current = atMediumWidth;
    shellAtNarrowWidthRef.current = atNarrowWidth;

    if (!activeSession) return;

    const shouldClearRightPanel =
      (crossedMediumWidth && atMediumWidth && !sidebarCollapsed && sidePanelOpen)
      || (crossedNarrowWidth && atNarrowWidth && sidePanelOpen);
    if (shouldClearRightPanel) {
      const currentSnapshot = currentShellNavigationSnapshotRef.current;
      if (currentSnapshot) {
        recordShellNavigation({
          ...currentSnapshot,
          rightPanelCollapsed: true,
          rightPanelFullWidth: false,
        });
      }
      setFloatingSidebarFocusActive(false);
      const overrideKey = makePanelPreviewKey(activeSession.id, "right");
      setPanelCollapsedOverrides((current) => ({ ...current, [overrideKey]: true }));
      void updateActivePanel("right", {
        collapsed: true,
        size: {
          ...activeSession.panels.right.size,
          fullWidth: false,
        },
      }).catch((error) => {
        toast.danger(error instanceof Error ? error.message : "Unable to update panel");
      }).finally(() => {
        setPanelCollapsedOverrides((current) => {
          if (!(overrideKey in current)) return current;
          const next = { ...current };
          delete next[overrideKey];
          return next;
        });
      });
    }

    if (crossedNarrowWidth && atNarrowWidth && !sidebarCollapsed) {
      setSidebarCollapsedWithCodexState(true, {
        suppressHoverOpen: true,
      });
    }
  }, [
    activeSession,
    appShellWidth,
    recordShellNavigation,
    setSidebarCollapsedWithCodexState,
    sidePanelOpen,
    sidebarCollapsed,
    updateActivePanel,
  ]);

  const getWindowZoom = useCallback(() => {
    const root = workbenchRootRef.current;
    if (!root) return 1;
    const raw = window.getComputedStyle(root).getPropertyValue("--codex-window-zoom");
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }, []);

  // Single source of truth for sidebar auto-reveal visibility. Reads the latest
  // pointer X (passed in) plus non-pointer inputs from a ref, so it can be
  // invoked from both the pointermove handler and the input-change effect below.
  // `setFloatingSidebarVisible`/`setSidebarHoverSuppressed` no-op when their
  // value is unchanged, so calling this on every pointer move does not re-render
  // unless the reveal state actually flips.
  const recomputeFloatingSidebarVisibility = useCallback((pointerX: number | null) => {
    const inputs = sidebarVisibilityInputsRef.current;
    if (inputs.sidebarHoverSuppressed) {
      if (!shouldClearCodexSidebarHoverSuppression({
        pointerX,
        triggerHovered: inputs.sidebarTriggerHovered,
      })) {
        setFloatingSidebarVisible(false);
        return;
      }
      setSidebarHoverSuppressed(false);
      return;
    }

    setFloatingSidebarVisible((current) => deriveCodexSidebarFloatingVisibility({
      pointerX,
      leftPanelWidthPx: inputs.sidebarWidth,
      sidebarOpen: !inputs.sidebarCollapsed,
      sidebarAnimating: inputs.sidebarAnimating,
      hoverSuppressed: false,
      focusOverride: inputs.floatingSidebarFocusActive,
      currentlyVisible: current,
    }));
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const nextPointer = normalizeCodexSidebarPointer(
        {
          clientX: event.clientX,
          clientY: event.clientY,
          updatedAt: event.timeStamp || performance.now(),
        },
        sidebarPointerRef.current,
        getWindowZoom(),
      );
      sidebarPointerRef.current = nextPointer;
      recomputeFloatingSidebarVisibility(nextPointer.x);
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [getWindowZoom, recomputeFloatingSidebarVisibility]);

  useEffect(() => {
    const updateFloatingSidebarFocusActive = () => {
      const activeElement = document.activeElement;
      setFloatingSidebarFocusActive(
        activeElement instanceof HTMLElement
          && Boolean(activeElement.closest('[data-sidebar-floating-focus-area="true"]')),
      );
    };

    document.addEventListener("focusin", updateFloatingSidebarFocusActive);
    document.addEventListener("focusout", updateFloatingSidebarFocusActive);
    updateFloatingSidebarFocusActive();
    return () => {
      document.removeEventListener("focusin", updateFloatingSidebarFocusActive);
      document.removeEventListener("focusout", updateFloatingSidebarFocusActive);
    };
  }, []);

  useEffect(() => {
    // Keep the ref the pointermove handler reads in sync, then recompute once
    // for this input change (pointer comes from the ref — auto-reveal still
    // reacts when width/collapse/focus change without the mouse moving).
    sidebarVisibilityInputsRef.current = {
      sidebarWidth,
      sidebarCollapsed,
      sidebarAnimating,
      floatingSidebarFocusActive,
      sidebarHoverSuppressed,
      sidebarTriggerHovered,
    };
    recomputeFloatingSidebarVisibility(sidebarPointerRef.current.x);
  }, [
    floatingSidebarFocusActive,
    recomputeFloatingSidebarVisibility,
    sidebarAnimating,
    sidebarCollapsed,
    sidebarHoverSuppressed,
    sidebarTriggerHovered,
    sidebarWidth,
  ]);

  const headerShellSlotWidth = rightPanelAnimatedWidth;
  const threadSummaryPanelAvailable = Boolean(activeSession?.thread);
  const threadSummaryPanelSuppressed = rightPanelFullWidth;
  const threadSummaryPanelMounted = threadSummaryPanelAvailable
    && !threadSummaryPanelSuppressed;
  const threadSummaryPanelOpen = threadSummaryPanelMounted
    && threadSummaryPanelLayoutMode !== "overlay"
    && threadSummaryPanelPinnedOpen;
  const threadSummaryPanelMode = !threadSummaryPanelAvailable
    ? "hidden"
    : threadSummaryPanelSuppressed
      ? "hidden"
      : threadSummaryPanelLayoutMode === "overlay"
        ? "popover"
        : "pinned";
  const threadSummaryPanelHideImmediately = threadSummaryPanelLayoutMode === "overlay"
    && threadSummaryPanelPopoverOpen;
  const threadSummaryPanelContentShift = resolveCodexSummaryContentShift({
    layoutMode: threadSummaryPanelLayoutMode,
    pinnedOpen: threadSummaryPanelOpen,
  });
  useEffect(() => {
    if (threadSummaryPanelMode === "popover") return;
    setThreadSummaryPanelPopoverOpen(false);
  }, [threadSummaryPanelMode]);
  const threadSummarySideChatRows = useMemo<ThreadSummaryPanelAuxiliaryRow[]>(() => {
    if (!activeSession) return [];
    return (sideChatTabsBySession[activeSession.id] ?? []).map((tab) => ({
      id: tab.id,
      title: tab.title,
      status: tab.status === "ready" ? "Open" : tab.status === "loading" ? "Starting" : "Expired",
    }));
  }, [activeSession, sideChatTabsBySession]);
  const threadSummaryBrowserRows = useMemo<ThreadSummaryPanelAuxiliaryRow[]>(() => {
    if (!activeSession) return [];
    const browserTabs = activeSession.tabs
      .filter((tab) => tab.kind === "browser")
      .map((tab) => ({
        id: tab.id,
        title: tab.title,
        status: tab.panelId === "right" ? "Right panel" : "Bottom panel",
      }));
    const browserPreviewTabs = Object.values(previewTabsByPanel)
      .filter((tab) => tab.sessionId === activeSession.id && tab.kind === "browser")
      .map((tab) => ({
        id: tab.id,
        title: tab.title,
        status: "Preview",
      }));
    return [...browserTabs, ...browserPreviewTabs];
  }, [activeSession, previewTabsByPanel]);

  const toggleThreadSummaryPanel = useCallback(() => {
    setThreadSummaryPanelPinnedOpen((current) => {
      const next = !current;
      writeThreadSummaryPanelPinnedOpen(next);
      return next;
    });
  }, []);
  const threadSummaryHeaderAction = threadSummaryPanelMode !== "hidden" && activeSession ? (
    <ThreadSummaryPanelHeaderAction
      activeThreadId={activeSession.thread?.threadId ?? null}
      onPopoverOpenChange={setThreadSummaryPanelPopoverOpen}
      projectWorkspacePath={projectWorkspaceRootOrNull(activeProject)}
      mode={threadSummaryPanelMode}
      pinnedOpen={threadSummaryPanelPinnedOpen}
      onPinnedOpenToggle={toggleThreadSummaryPanel}
      popoverOpen={threadSummaryPanelPopoverOpen}
    />
  ) : null;

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

  const sidebarCollapseControlLabel = sidebarCollapsed ? "Show sidebar" : "Hide sidebar";
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
        {sidebarCollapsed ? <CodexSidebarHiddenIcon className="icon-xs" /> : <CodexSidebarVisibleIcon className="icon-xs" />}
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
      {sidebarCollapsed ? (
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
        <ToolbarIconButton label="Toggle bottom panel" pressed={bottomPanelOpen} onClick={toggleActiveBottomPanel}>
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
      {panelHeaderActions}
    </>
  );

  const renderPanelNewTabButton = (panelId: PanelId, leafId: string) => {
    if (!activeSession) return null;
    const actions = panelId === "right" ? availableRightPanelActions : availableBottomPanelActions;
    const title = panelId === "right" ? "Open side panel tab" : "Open bottom panel tab";
    return (
      <NodexDropdownMenu
        align="start"
        sideOffset={6}
        contentWidth="menuWide"
        triggerButton={(
          <button
            type="button"
            className={cn(TOOLBAR_BUTTON_BASE_CLASS, TOOLBAR_BUTTON_GHOST_CLASS)}
            title={title}
            aria-label={title}
          >
            <CodexSidePanelPlusIcon className="icon-xs" />
          </button>
        )}
      >
        {actions.map((action, index) => {
          const Icon = action.Icon;
          const showNodexSeparator = isNodexPanelOptionAction(action)
            && !isNodexPanelOptionAction(actions[index - 1] ?? action);
          const item = (() => {
            if (action.kind === "card_stage") {
              return (
                <NodexDropdownFlyoutSubmenuItem
                  label={action.label}
                  leftSlot={<Icon className="icon-sm" />}
                  contentClassName="w-[336px]"
                >
                  <RightPanelCardStagePicker
                    cards={activeProjectCardOptions}
                    onOpenCard={(card) => {
                      void (async () => {
                        await activatePanelGroup(panelId, leafId);
                        await openCardStageFromPicker(card);
                      })();
                    }}
                  />
                </NodexDropdownFlyoutSubmenuItem>
              );
            }

            return (
              <NodexDropdownItem
                leftSlot={<Icon className="icon-sm" />}
                keyboardShortcut={resolvePanelShortcutLabel(action.shortcut, isMacPlatform)}
                onSelect={() => {
                  if (action.kind === "side_chat") {
                    void openSideChat({ targetPanelId: panelId, targetLeafId: leafId });
                    return;
                  }
                  if (!isProjectSessionTabKind(action.kind)) return;
                  if (isPreviewableProjectSessionTabKind(action.kind)) {
                    void openPreviewTab(action.kind, panelId, leafId);
                    return;
                  }
                  const durableKind = action.kind;
                  void (async () => {
                    await activatePanelGroup(panelId, leafId);
                    await createManualTab(durableKind, panelId);
                  })();
                }}
              >
                {action.label}
              </NodexDropdownItem>
            );
          })();
          return (
            <Fragment key={action.kind}>
              {showNodexSeparator ? <NodexDropdownSeparator /> : null}
              {item}
            </Fragment>
          );
        })}
      </NodexDropdownMenu>
    );
  };

  const rightPanelHeaderStartInsetWidth = activeSession && rightPanelFullWidth && sidebarCollapsed
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

  const showFloatingSidebar = sidebarCollapsed
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
  const settingsRouteShell = settingsPath ? (
    <SettingsRouteShell
      path={settingsPath}
      onPathChange={setSettingsPath}
      onBackToApp={closeSettings}
      onRequestProjectPickerOpen={onRequestProjectPickerOpen}
      projects={projects}
      activeProjectId={activeProject?.id ?? activeProjectId}
      initialLocalEnvironmentProjectId={null}
      initialLocalEnvironmentConfigPath={null}
      sidebarTopLevelSectionOrder={settingsSidebarTopLevelSectionOrder}
      sidebarTopLevelSections={settingsSidebarTopLevelSections}
      onSidebarTopLevelSectionVisibleChange={setSidebarTopLevelSectionVisible ?? (() => undefined)}
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
  ) : null;
  const appShellHeaderCenterVisible = activeSession != null && settingsRouteShell == null;

  const renameSessionDialog = (
    <NodexDialog
      open={Boolean(renameSession)}
      onOpenChange={(open) => {
        if (open) return;
        setRenameSession(null);
        setRenameSessionTitle("");
      }}
    >
      <NodexDialogContent className="max-w-sm gap-5 rounded-2xl p-5">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submitRenameSession();
          }}
        >
          <NodexDialogHeader className="gap-1">
            <NodexDialogTitle className="text-base">Rename chat</NodexDialogTitle>
          </NodexDialogHeader>
          <input
            autoFocus
            className="h-9 rounded-lg border border-token-border bg-token-main-surface-primary px-3 text-sm text-token-foreground outline-none focus-visible:ring-2 focus-visible:ring-token-focus"
            value={renameSessionTitle}
            onChange={(event) => setRenameSessionTitle(event.target.value)}
          />
          <NodexDialogFooter>
            <NodexButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRenameSession(null);
                setRenameSessionTitle("");
              }}
            >
              Cancel
            </NodexButton>
            <NodexButton
              type="submit"
              size="sm"
              disabled={renamingSession || renameSessionTitle.trim().length === 0}
            >
              Rename
            </NodexButton>
          </NodexDialogFooter>
        </form>
      </NodexDialogContent>
    </NodexDialog>
  );
  const commandPaletteProjectId = activeProject?.id ?? activeProjectId;
  const commandPalette = (
    <CommandPalette
      open={commandPaletteOpen}
      openTriggerTick={commandPaletteOpenRequest.tick}
      initialQuery={commandPaletteOpenRequest.initialQuery}
      projects={projects}
      activeProjectId={commandPaletteProjectId}
      activeView={activeView}
      focusedStage={focusedStage}
      recentCardSessions={recentCardSessions}
      onOpenChange={setCommandPaletteOpen}
      onOpenCard={(projectId, cardId, titleSnapshot) => {
        void openCardTab(projectId, cardId, titleSnapshot);
      }}
      onFocusStage={(stageId) => {
        navigateToStage?.(commandPaletteProjectId, stageId);
      }}
      onSetView={(view) => {
        navigateToDbView?.(commandPaletteProjectId, view);
      }}
      onOpenProjectPicker={onRequestProjectPickerOpen}
      onOpenTaskSearch={openSidebarTaskSearch}
      onToggleTerminal={() => {
        void focusOrCreateSessionTerminalTab();
      }}
      onToggleSidebar={() => {
        toggleSidebarCollapsed();
      }}
      onOpenSettings={openSettings}
      canGoBack={shellCanNavigateBack}
      canGoForward={shellCanNavigateForward}
      onGoBack={() => {
        void executeShellNavigation("back");
      }}
      onGoForward={() => {
        void executeShellNavigation("forward");
      }}
      onRequestNewWindow={onRequestNewWindow}
    />
  );

  return (
    <HeaderActionProvider actions={settingsPath ? null : headerActions}>
      <NodexTooltipProvider>
        {renameSessionDialog}
        {commandPalette}
        <ThreadHeaderPortalProvider target={threadHeaderPortalElement}>
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
            {activeSession ? (
              <BrowserSidebarHiddenWebviewHosts
                sessionId={activeSession.id}
                tabs={browserRetentionTabs}
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
              fallbackWidth={collapsedHeaderLeftFallbackWidth}
              fallbackRailWidth={LEFT_HEADER_COLLAPSED_RAIL_FALLBACK_WIDTH_PX}
              onMeasuredWidthChange={setHeaderLeftWidth}
              onMeasuredRailWidthChange={setHeaderLeftRailWidth}
            />
            {appShellHeaderCenterVisible ? (
              <div
                aria-hidden={rightPanelFullWidth ? "true" : undefined}
                data-testid="app-shell-header-context-menu-surface"
                className={cn(
                  "pointer-events-none ms-4 flex h-full min-w-0 flex-1 isolate items-center gap-1.5 overflow-hidden [contain:layout_paint] pe-1.5",
                  rightPanelFullWidth && "invisible",
                )}
              >
                <div
                  ref={setThreadHeaderPortalElement}
                  data-testid="thread-stage-header-portal-target"
                  className="pointer-events-none w-full min-w-0 flex-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto"
                />
                {threadSummaryHeaderAction ? (
                  <div
                    data-testid="thread-stage-header-summary-actions"
                    className="ms-auto flex shrink-0 items-center gap-1.5"
                  >
                    <div className="no-drag pointer-events-auto flex shrink-0 items-center">
                      {threadSummaryHeaderAction}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <HeaderShellSlot
              side="right"
              slotWidth={headerShellSlotWidth}
              minWidth={headerRightWidth}
              fallbackWidth={RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX}
              fallbackRailWidth={RIGHT_PANEL_HEADER_FALLBACK_RAIL_WIDTH_PX}
              onMeasuredWidthChange={setHeaderRightWidth}
              onMeasuredRailWidthChange={setHeaderRightRailWidth}
            />
          </header>

        <div className="relative flex max-h-full min-h-0 w-full flex-1">
          {settingsRouteShell ? (
            settingsRouteShell
          ) : (
            <>
          {showInlineSidebar ? (
            <ProjectSessionSidebar
              projects={projects}
              spaces={spaces}
              activeProjectId={activeProjectId}
              activeSessionId={activeSession?.id ?? null}
              contextMenuSessionId={contextMenuSessionId}
              sessionsByProject={sessionsByProject}
              expandedProjectIds={expandedProjectIds}
              pinnedProjectsSectionCollapsed={pinnedProjectsSectionCollapsed}
              projectsSectionCollapsed={projectsSectionCollapsed}
              loadingSessions={loadingSessions}
              width={sidebarWidth}
              animatedWidth={realSidebarMotion.animatedSize}
              contentOpacity={realSidebarMotion.opacity}
              resizeDisabled={sidebarAnimating}
              getWindowZoom={getWindowZoom}
              onResizeWidth={applySidebarWidth}
              onTogglePinnedProjectsSectionCollapsed={togglePinnedProjectsSectionCollapsed}
              onToggleProjectsSectionCollapsed={toggleProjectsSectionCollapsed}
              onToggleProjectExpanded={toggleProjectExpanded}
              onSelectProject={selectProject}
              onSelectSession={selectSession}
              onOpenSessionContextMenu={openSessionContextMenu}
              onToggleSessionPinned={toggleSessionPin}
              onStartNewChatInProject={(projectId) => void startNewChatInProject(projectId)}
              onOpenCommandPalette={openSidebarCommandPalette}
              onShowUnavailableProduct={showSidebarUnavailableProduct}
              projectPickerOpenTick={projectPickerOpenTick}
              onCreateProject={async (input) => {
                const project = await onCreateProject(input);
                await refreshAllSessions();
                return project;
              }}
              onUpdateProject={onUpdateProject ?? (async () => null)}
              onDeleteProject={onDeleteProject ?? (async () => false)}
              onReorderProjects={onReorderProjects}
              onSetProjectPinned={onSetProjectPinned}
              onSetPinnedProjectOrder={onSetPinnedProjectOrder}
              onOpenSettings={openSettings}
              account={codexAccount}
              connection={codexConnection}
              onRefreshAccount={codexAccountActions.refreshAccount}
              onLogout={handleCodexAccountLogout}
              onAccountErrorMessage={handleCodexAccountErrorMessage}
            />
          ) : null}

          <AnimatePresence initial={false}>
            {showFloatingSidebar ? (
              <motion.div
                key="codex-floating-left-panel"
                data-sidebar-floating-focus-area="true"
                data-testid="floating-project-session-sidebar-shell"
                className={cn(
                  floatingSidebarOuterClassName,
                  floatingSidebarResizing && "cursor-col-resize",
                )}
                style={{ width: sidebarWidth }}
                initial={reducedMotion ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: floatingSidebarExitX }}
                transition={floatingSidebarTransition}
              >
                <ProjectSessionSidebar
                  floating
                  header={floatingSidebarHeader}
                  projects={projects}
                  spaces={spaces}
                  activeProjectId={activeProjectId}
                  activeSessionId={activeSession?.id ?? null}
                  contextMenuSessionId={contextMenuSessionId}
                  sessionsByProject={sessionsByProject}
                  expandedProjectIds={expandedProjectIds}
                  pinnedProjectsSectionCollapsed={pinnedProjectsSectionCollapsed}
                  projectsSectionCollapsed={projectsSectionCollapsed}
                  loadingSessions={loadingSessions}
                  width={sidebarWidth}
                  getWindowZoom={getWindowZoom}
                  onResizeWidth={applySidebarWidth}
                  onResizeActiveChange={setFloatingSidebarResizing}
                  onTogglePinnedProjectsSectionCollapsed={togglePinnedProjectsSectionCollapsed}
                  onToggleProjectsSectionCollapsed={toggleProjectsSectionCollapsed}
                  onToggleProjectExpanded={toggleProjectExpanded}
                  onSelectProject={selectProject}
                  onSelectSession={selectSession}
                  onOpenSessionContextMenu={openSessionContextMenu}
                  onToggleSessionPinned={toggleSessionPin}
                  onStartNewChatInProject={(projectId) => void startNewChatInProject(projectId)}
                  onOpenCommandPalette={openSidebarCommandPalette}
                  onShowUnavailableProduct={showSidebarUnavailableProduct}
                  projectPickerOpenTick={projectPickerOpenTick}
                  onCreateProject={async (input) => {
                    const project = await onCreateProject(input);
                    await refreshAllSessions();
                    return project;
                  }}
                  onUpdateProject={onUpdateProject ?? (async () => null)}
                  onDeleteProject={onDeleteProject ?? (async () => false)}
                  onReorderProjects={onReorderProjects}
                  onSetProjectPinned={onSetProjectPinned}
                  onSetPinnedProjectOrder={onSetPinnedProjectOrder}
                  onOpenSettings={openSettings}
                  account={codexAccount}
                  connection={codexConnection}
                  onRefreshAccount={codexAccountActions.refreshAccount}
                  onLogout={handleCodexAccountLogout}
                  onAccountErrorMessage={handleCodexAccountErrorMessage}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <main
            className={cn(
              "main-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              realSidebarMounted ? "rounded-s-2xl" : "!rounded-l-none",
            )}
          >
            {activeSession ? (
              <div ref={sessionContentRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                  <section
                    data-testid="session-thread-page"
                    data-session-thread-page-hidden={rightPanelFullWidth ? "true" : "false"}
                    data-app-shell-main-content-layout={appShellMainContentLayout}
                    aria-hidden={rightPanelFullWidth ? "true" : undefined}
                    className={cn(
                      "app-shell-main-content-viewport relative flex min-h-0 min-w-0 flex-col",
                      rightPanelFullWidth ? "w-0 flex-none overflow-hidden" : "flex-1",
                    )}
                  >
                    <div
                      className={cn(
                        "app-shell-main-content-frame relative mt-(--app-shell-main-content-frame-top-offset) flex min-h-0 flex-1 flex-col border-t",
                        appShellMainContentFrameBorderVisible
                          ? "border-token-border-default"
                          : "border-transparent",
                      )}
                    >
                      <div
                        aria-hidden="true"
                        data-app-shell-main-content-top-fade="full-bleed"
                        className="app-shell-main-content-top-fade pointer-events-none absolute inset-x-0 top-0 z-20 h-4 bg-gradient-to-b from-token-main-surface-primary opacity-0 transition-opacity duration-200 browser:hidden"
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
                        onQueueingEnabledChange={handleThreadQueueFollowUpsEnabledChange}
                        onOpenThread={openAttachedThreadSession}
                        onOpenTurnDiffReview={openTurnDiffReview}
                        onForkSessionFromTurn={forkSessionFromTurn}
                        accountActions={codexAccountActions}
                        worktreeStartMode={worktreeStartMode}
                        worktreeBranchPrefix={worktreeAutoBranchPrefix}
                        searchOpenTick={threadSearchOpenTick}
                        summaryPanelMounted={threadSummaryPanelMounted}
                        summaryPanelOpen={threadSummaryPanelOpen}
                        summaryPanelHideImmediately={threadSummaryPanelHideImmediately}
                        summaryPanelContentShift={threadSummaryPanelContentShift}
                        summarySideChatRows={threadSummarySideChatRows}
                        summaryBrowserRows={threadSummaryBrowserRows}
                        rightPanelComposerOverlayEnabled={rightPanelComposerOverlayEnabled}
                        rightPanelComposerOverlayTarget={rightPanelComposerOverlayTarget}
                        onOpenCard={(cardId) => {
                          if (!activeProject) return;
                          void openCardTab(activeProject.id, cardId, cardId);
                        }}
                        onOpenSideChat={(input) => openSideChat({ ...input, targetPanelId: "right" })}
                        onOpenMcpAppSidePanel={openMcpAppSidePanel}
                      />
                    </div>
                  </section>

                  {rightPanelMotion.mounted ? (
                    <motion.aside
                      data-app-shell-focus-area="right-panel"
                      data-testid="session-right-panel"
                      data-right-panel-width-mode={rightPanelFullWidth ? "full" : "regular"}
                      className={cn(
                        "relative ml-auto h-full min-h-0 min-w-0 shrink-0 overflow-visible",
                        APP_SHELL_RIGHT_PANEL_LAYER_CLASS,
                      )}
                      style={{
                        opacity: rightPanelMotion.opacity,
                        width: rightPanelMotion.animatedSize,
                      }}
                    >
                      {sidePanelOpen && !rightPanelFullWidth ? (
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label="Resize right panel"
                          className="group absolute top-0 bottom-0 left-0 z-40 flex w-4 -translate-x-2 cursor-col-resize touch-none select-none active:cursor-col-resize"
                          onPointerDown={resizeRightPanel}
                        >
                          <div className="pointer-events-none m-auto h-full w-px bg-linear-to-b from-transparent via-token-foreground/25 to-transparent opacity-0 group-hover:opacity-100 group-active:opacity-100" />
                        </div>
                      ) : null}

                      <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
                        <div
                          ref={setRightPanelComposerOverlayTarget}
                          data-right-panel-composer-overlay-host="true"
                          className={cn(
                            "absolute top-0 bottom-0 left-0 min-w-0 bg-token-main-surface-primary",
                            !rightPanelFullWidth && "border-l border-token-border",
                          )}
                          style={{
                            width: rightPanelTargetWidth,
                            minWidth: rightPanelTargetWidth,
                            "--thread-content-top-inset": "calc(var(--spacing) * 8)",
                          } as React.CSSProperties}
                        >
                          <PanelGroupTree
                            sessionId={activeSession.id}
                            panelId="right"
                            layout={activeSession.panels.right.layout}
                            tabItemsByLeafId={panelGroupTabs.right.itemsByLeafId}
                            activeTabIdsByLeafId={panelGroupTabs.right.activeTabIdsByLeafId}
                            renderAfterTabs={(leafId) => renderPanelNewTabButton("right", leafId)}
                            renderAfterList={() => rightPanelHeaderAfterList}
                            headerStartInsetPx={rightPanelHeaderStartInsetWidth}
                            tabScrollEndPaddingPx={panelTabScrollEndPaddingPx}
                            renderEmptyLeaf={(leafId) => (
                              <EmptyRightPane
                                actions={availableRightPanelActions}
                                cards={activeProjectCardOptions}
                                isMac={isMacPlatform}
                                onAction={(kind) => {
                                  if (kind === "side_chat") {
                                    void openSideChat({ targetPanelId: "right", targetLeafId: leafId });
                                    return;
                                  }
                                  if (!isProjectSessionTabKind(kind)) return;
                                  if (isPreviewableProjectSessionTabKind(kind)) {
                                    void openPreviewTab(kind, "right", leafId);
                                    return;
                                  }
                                  void (async () => {
                                    await activatePanelGroup("right", leafId);
                                    await createManualTab(kind, "right");
                                  })();
                                }}
                                onOpenCard={(card) => {
                                  void (async () => {
                                    await activatePanelGroup("right", leafId);
                                    await openCardStageFromPicker(card);
                                  })();
                                }}
                              />
                            )}
                            onSelectTab={(leafId, tabId) => void selectPanelTab("right", tabId, leafId)}
                            onCloseTab={(leafId, tabId) => void closePanelTab("right", tabId, leafId)}
                            onPinTab={(leafId, tabId) => void pinPreviewTab("right", tabId, leafId)}
                            onReorderTab={(leafId, tabId, targetIndex) => void reorderTabs("right", tabId, targetIndex, leafId)}
                            onMoveTab={(tabId, targetPanelId, targetLeafId, targetIndex, splitTarget) =>
                              void moveTabToPanel(tabId, targetPanelId, targetLeafId, targetIndex, splitTarget)}
                            onSplitGroup={(leafId, side, tabId) => void splitPanelGroup("right", leafId, side, tabId)}
                            onFocusGroup={(leafId) => rememberFocusedPanelGroup("right", leafId)}
                            onActivateGroup={(leafId, tabId) => void activatePanelGroup("right", leafId, tabId)}
                            onResizeGroup={(branchId, ratio) => void resizePanelGroup("right", branchId, ratio)}
                          />
                        </div>
                      </div>
                    </motion.aside>
                  ) : null}
                </div>

                {bottomPanelMotion.mounted ? (
                  <motion.section
                    data-app-shell-focus-area="bottom-panel"
                    data-testid="session-bottom-panel"
                    className="relative min-h-0 w-full shrink-0 overflow-visible"
                    style={{
                      opacity: bottomPanelMotion.opacity,
                      height: bottomPanelMotion.animatedSize,
                    }}
                  >
                    {bottomPanelOpen ? (
                      <div
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label="Resize bottom panel"
                        className="group absolute top-0 left-0 right-0 z-40 flex h-4 -translate-y-2 cursor-row-resize touch-none select-none active:cursor-row-resize"
                        onPointerDown={resizeBottomPanel}
                      >
                        <div className="pointer-events-none mx-auto h-px w-full bg-linear-to-r from-transparent via-token-foreground/25 to-transparent opacity-0 group-hover:opacity-100 group-active:opacity-100" />
                      </div>
                    ) : null}
                    <div className="absolute inset-0 min-h-0 overflow-hidden">
                      <div
                        className="absolute inset-x-0 top-0 min-h-0 border-t border-token-border bg-token-main-surface-primary"
                        style={{
                          height: bottomPanelHeight,
                          minHeight: bottomPanelHeight,
                        }}
                      >
                        <PanelGroupTree
                          sessionId={activeSession.id}
                          panelId="bottom"
                          layout={activeSession.panels.bottom.layout}
                          tabItemsByLeafId={panelGroupTabs.bottom.itemsByLeafId}
                          activeTabIdsByLeafId={panelGroupTabs.bottom.activeTabIdsByLeafId}
                          renderAfterTabs={(leafId) => renderPanelNewTabButton("bottom", leafId)}
                          tabScrollEndPaddingPx={panelTabScrollEndPaddingPx}
                          headerEndInsetPx={bottomPanelGlobalHeaderInsetWidth}
                          renderEmptyLeaf={(leafId) => (
                            <EmptyRightPane
                              actions={availableBottomPanelActions}
                              cards={[]}
                              isMac={isMacPlatform}
                              onAction={(kind) => {
                                if (kind === "side_chat") {
                                  void openSideChat({ targetPanelId: "bottom", targetLeafId: leafId });
                                  return;
                                }
                                if (!isProjectSessionTabKind(kind)) return;
                                if (isPreviewableProjectSessionTabKind(kind)) {
                                  void openPreviewTab(kind, "bottom", leafId);
                                  return;
                                }
                                void (async () => {
                                  await activatePanelGroup("bottom", leafId);
                                  await createManualTab(kind, "bottom");
                                })();
                              }}
                              onOpenCard={(card) => {
                                void (async () => {
                                  await activatePanelGroup("bottom", leafId);
                                  await openCardStageFromPicker(card);
                                })();
                              }}
                            />
                          )}
                          onSelectTab={(leafId, tabId) => void selectPanelTab("bottom", tabId, leafId)}
                          onCloseTab={(leafId, tabId) => void closePanelTab("bottom", tabId, leafId)}
                          onPinTab={(leafId, tabId) => void pinPreviewTab("bottom", tabId, leafId)}
                          onReorderTab={(leafId, tabId, targetIndex) => void reorderTabs("bottom", tabId, targetIndex, leafId)}
                          onMoveTab={(tabId, targetPanelId, targetLeafId, targetIndex, splitTarget) =>
                            void moveTabToPanel(tabId, targetPanelId, targetLeafId, targetIndex, splitTarget)}
                          onSplitGroup={(leafId, side, tabId) => void splitPanelGroup("bottom", leafId, side, tabId)}
                          onFocusGroup={(leafId) => rememberFocusedPanelGroup("bottom", leafId)}
                          onActivateGroup={(leafId, tabId) => void activatePanelGroup("bottom", leafId, tabId)}
                          onResizeGroup={(branchId, ratio) => void resizePanelGroup("bottom", branchId, ratio)}
                        />
                        {bottomPanelGlobalHeaderControls ? (
                          <div
                            data-testid="bottom-panel-global-header-actions"
                            className="pointer-events-none absolute top-0 right-0 z-30 flex h-toolbar items-center justify-end pr-2"
                          >
                            <div className="pointer-events-none flex h-full items-center gap-1">
                              {bottomPanelGlobalHeaderControls}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </motion.section>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-token-text-secondary">
                Select a project session.
              </div>
            )}
          </main>
          <HistoryPanel
            projectId={cardStageHistoryModal?.projectId ?? activeProjectId}
            cardId={cardStageHistoryModal?.cardId ?? null}
            cardTitle={cardStageHistoryModal?.cardTitle}
            projectWorkspacePath={projectWorkspaceRootOrNull(cardStageHistoryModalProject)}
            open={cardStageHistoryModal !== null}
            onClose={closeCardStageHistoryModal}
            onCardMutated={() => {
              void activeProjectKanban.refresh();
            }}
          />
            </>
          )}
        </div>
          </motion.div>
        </ThreadHeaderPortalProvider>
      </NodexTooltipProvider>
    </HeaderActionProvider>
  );
}

function SidebarProjectGroupSections({
  projects,
  activeProjectId,
  activeSessionId,
  contextMenuSessionId,
  sessionsByProject,
  expandedProjectIds,
  pinnedProjectsSectionCollapsed,
  projectsSectionCollapsed,
  loadingSessions,
  onTogglePinnedProjectsSectionCollapsed,
  onToggleProjectsSectionCollapsed,
  onToggleProjectExpanded,
  onSelectProject,
  onSelectSession,
  onOpenSessionContextMenu,
  onToggleSessionPinned,
  onStartNewChatInProject,
  projectPickerOpenTick,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onReorderProjects,
  onSetProjectPinned,
  onSetPinnedProjectOrder,
}: {
  projects: Project[];
  activeProjectId: string;
  activeSessionId: string | null;
  contextMenuSessionId?: string | null;
  sessionsByProject: Record<string, ProjectSession[]>;
  expandedProjectIds: Set<string>;
  pinnedProjectsSectionCollapsed: boolean;
  projectsSectionCollapsed: boolean;
  loadingSessions: boolean;
  onTogglePinnedProjectsSectionCollapsed: () => void;
  onToggleProjectsSectionCollapsed: () => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (session: ProjectSession) => void;
  onOpenSessionContextMenu?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onToggleSessionPinned?: (session: ProjectSession) => void | Promise<void>;
  onStartNewChatInProject: (projectId: string) => void | Promise<void>;
  projectPickerOpenTick: number;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onReorderProjects: (input: ProjectOrderInput) => Promise<Project[]>;
  onSetProjectPinned: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onSetPinnedProjectOrder: (input: ProjectPinnedOrderInput) => Promise<Project[]>;
}) {
  const projectOrderIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const pinnedProjects = useMemo(
    () => sortPinnedProjectsForSidebar(projects.filter((project) => project.pinned)),
    [projects],
  );
  const unpinnedProjects = useMemo(
    () => projects.filter((project) => !project.pinned),
    [projects],
  );
  const pinnedProjectIds = useMemo(() => pinnedProjects.map((project) => project.id), [pinnedProjects]);
  const unpinnedProjectIds = useMemo(() => unpinnedProjects.map((project) => project.id), [unpinnedProjects]);
  const pinnedDroppable = usePinnedProjectDroppable();

  const handleUnpinnedProjectOrderChange = useCallback(async (nextProjectIds: string[]) => {
    const orderedProjectIds = replaceVisibleOrder(projectOrderIds, unpinnedProjectIds, nextProjectIds);
    try {
      await onReorderProjects({ orderedProjectIds });
    } catch {
      toast.danger("Failed to reorder projects");
    }
  }, [onReorderProjects, projectOrderIds, unpinnedProjectIds]);

  const handlePinnedProjectOrderChange = useCallback(async (orderedProjectIds: string[]) => {
    try {
      await onSetPinnedProjectOrder({ orderedProjectIds });
    } catch {
      toast.danger("Failed to reorder pinned projects");
    }
  }, [onSetPinnedProjectOrder]);

  const pinnedReorder = useSidebarGroupReorderController({
    groupIds: pinnedProjectIds,
    reorderGroups: handlePinnedProjectOrderChange,
  });
  const unpinnedReorder = useSidebarGroupReorderController({
    groupIds: unpinnedProjectIds,
    reorderGroups: handleUnpinnedProjectOrderChange,
  });
  const displayedPinnedProjects = useMemo(
    () => orderProjectsByIds(pinnedProjects, pinnedReorder.groupIds),
    [pinnedProjects, pinnedReorder.groupIds],
  );
  const displayedUnpinnedProjects = useMemo(
    () => orderProjectsByIds(unpinnedProjects, unpinnedReorder.groupIds),
    [unpinnedProjects, unpinnedReorder.groupIds],
  );

  const renderProjectRow = useCallback((project: Project, controller: SidebarGroupDndController) => {
    const sessions = sessionsByProject[project.id] ?? [];
    const expanded = expandedProjectIds.has(project.id);
    const isActiveProject = project.id === activeProjectId;

    return (
      <CodexProjectRow
        key={project.id}
        project={project}
        active={isActiveProject}
        expanded={expanded}
        groupDndController={controller}
        allowProjectReorder
        onActivate={() => onToggleProjectExpanded(project.id)}
        onSelectProject={() => onSelectProject(project.id)}
        onStartNewChat={() => void onStartNewChatInProject(project.id)}
        onUpdateProject={onUpdateProject}
        onDeleteProject={onDeleteProject}
        onSetProjectPinned={onSetProjectPinned}
      >
        <CodexProjectSessionList project={project}>
          {sessions.map((session) => (
            <CodexThreadRow
              key={session.id}
              session={session}
              active={activeSessionId === session.id}
              contextMenuOpen={contextMenuSessionId === session.id}
              onSelect={() => onSelectSession(session)}
              onOpenContextMenu={onOpenSessionContextMenu}
              onTogglePinned={onToggleSessionPinned}
            />
          ))}
          {sessions.length === 0 && loadingSessions ? (
            <div className="px-row-x py-row-y text-sm text-token-description-foreground">
              Loading sessions...
            </div>
          ) : null}
        </CodexProjectSessionList>
      </CodexProjectRow>
    );
  }, [
    activeProjectId,
    activeSessionId,
    contextMenuSessionId,
    expandedProjectIds,
    loadingSessions,
    onDeleteProject,
    onOpenSessionContextMenu,
    onSelectProject,
    onSelectSession,
    onSetProjectPinned,
    onStartNewChatInProject,
    onToggleProjectExpanded,
    onToggleSessionPinned,
    onUpdateProject,
    sessionsByProject,
  ]);

  return (
    <>
      {displayedPinnedProjects.length > 0 ? (
        <div ref={pinnedDroppable.setNodeRef} className="relative">
          <CodexSidebarSection
            heading="Pinned"
            collapsed={pinnedProjectsSectionCollapsed}
            onToggle={onTogglePinnedProjectsSectionCollapsed}
          >
            <div className="isolate flex flex-col [contain:layout]">
              <SidebarProjectSortableContext groupIds={pinnedReorder.groupIds}>
                <div className="flex flex-col" role="list" aria-label="Pinned">
                  {renderProjectRowsWithDropIndicator({
                    projects: displayedPinnedProjects,
                    dropIndicatorIndex: pinnedReorder.dropIndicatorIndex,
                    renderProject: (project) => renderProjectRow(project, pinnedReorder.controller),
                  })}
                </div>
              </SidebarProjectSortableContext>
            </div>
          </CodexSidebarSection>
        </div>
      ) : pinnedDroppable.projectDragActive ? (
        <div
          ref={pinnedDroppable.setNodeRef}
          className="absolute inset-x-0 top-0 px-row-x"
        >
          <SidebarDropIndicator />
          <div className="h-4" />
        </div>
      ) : null}

      <CodexSidebarSection
        heading="Projects"
        collapsed={projectsSectionCollapsed}
        onToggle={onToggleProjectsSectionCollapsed}
        actions={(
          <SidebarProjectAddMenu
            onCreateProject={onCreateProject}
            openSetupTick={projectPickerOpenTick}
          />
        )}
      >
        <div className="isolate flex flex-col [contain:layout]">
          <SidebarProjectSortableContext groupIds={unpinnedReorder.groupIds}>
            <div className="flex flex-col" role="list" aria-label="Projects">
              {renderProjectRowsWithDropIndicator({
                projects: displayedUnpinnedProjects,
                dropIndicatorIndex: unpinnedReorder.dropIndicatorIndex,
                renderProject: (project) => renderProjectRow(project, unpinnedReorder.controller),
              })}
            </div>
          </SidebarProjectSortableContext>
        </div>
      </CodexSidebarSection>
    </>
  );
}

function ProjectSessionSidebar({
  floating = false,
  header,
  projects,
  activeProjectId,
  activeSessionId,
  contextMenuSessionId,
  sessionsByProject,
  expandedProjectIds,
  pinnedProjectsSectionCollapsed,
  projectsSectionCollapsed,
  loadingSessions,
  width,
  animatedWidth,
  contentOpacity,
  resizeDisabled = false,
  getWindowZoom,
  onResizeWidth,
  onResizeActiveChange,
  onTogglePinnedProjectsSectionCollapsed,
  onToggleProjectsSectionCollapsed,
  onToggleProjectExpanded,
  onSelectProject,
  onSelectSession,
  onOpenSessionContextMenu,
  onToggleSessionPinned,
  onStartNewChatInProject,
  onOpenCommandPalette,
  onShowUnavailableProduct,
  projectPickerOpenTick = 0,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onReorderProjects,
  onSetProjectPinned,
  onSetPinnedProjectOrder,
  onOpenSettings,
  account,
  connection,
  onRefreshAccount,
  onLogout,
  onAccountErrorMessage,
}: {
  floating?: boolean;
  header?: ReactNode;
  projects: Project[];
  spaces: SpaceRef[];
  activeProjectId: string;
  activeSessionId: string | null;
  contextMenuSessionId?: string | null;
  sessionsByProject: Record<string, ProjectSession[]>;
  expandedProjectIds: Set<string>;
  pinnedProjectsSectionCollapsed: boolean;
  projectsSectionCollapsed: boolean;
  loadingSessions: boolean;
  width: number;
  animatedWidth?: MotionValue<number>;
  contentOpacity?: MotionValue<number>;
  resizeDisabled?: boolean;
  getWindowZoom?: () => number;
  onResizeWidth: (width: number, phase?: SidebarResizePhase, surface?: SidebarResizeSurface) => void;
  onResizeActiveChange?: (active: boolean) => void;
  onTogglePinnedProjectsSectionCollapsed: () => void;
  onToggleProjectsSectionCollapsed: () => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (session: ProjectSession) => void;
  onOpenSessionContextMenu?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onToggleSessionPinned?: (session: ProjectSession) => void | Promise<void>;
  onStartNewChatInProject: (projectId: string) => void | Promise<void>;
  onOpenCommandPalette: () => void;
  onShowUnavailableProduct: (label: string) => void;
  projectPickerOpenTick?: number;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onReorderProjects: (input: ProjectOrderInput) => Promise<Project[]>;
  onSetProjectPinned: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onSetPinnedProjectOrder: (input: ProjectPinnedOrderInput) => Promise<Project[]>;
  onOpenSettings: () => void;
  account: CodexAccountSnapshot | null;
  connection: CodexConnectionState;
  onRefreshAccount: () => Promise<CodexAccountSnapshot>;
  onLogout: () => Promise<void>;
  onAccountErrorMessage: (message: string | null) => void;
}) {
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sidebarResizeDisabled = resizeDisabled;
  const sidebarResizeSurface: SidebarResizeSurface = floating ? "floating" : "inline";
  const setSidebarResizeActive = (active: boolean) => {
    setSidebarResizing(active);
    onResizeActiveChange?.(active);
  };
  const handleProjectDrop = useCallback((drop: { projectId: string; targetContainerId: string }) => {
    if (drop.targetContainerId !== "pinned") return;
    void onSetProjectPinned(drop.projectId, { pinned: true }).catch(() => {
      toast.danger("Failed to pin project");
    });
  }, [onSetProjectPinned]);

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sidebarResizeDisabled) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const resolveZoom = getWindowZoom ?? (() => 1);
    const startX = event.clientX / resolveZoom();
    const startWidth = width;
    let didMove = false;

    setSidebarResizeActive(true);

    const resolveNextWidth = (nextEvent: PointerEvent) =>
      startWidth + ((nextEvent.clientX / resolveZoom()) - startX);

    function stopResize() {
      setSidebarResizeActive(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    }

    function onPointerMove(nextEvent: PointerEvent) {
      nextEvent.preventDefault();
      didMove = didMove || nextEvent.clientX / resolveZoom() !== startX;
      onResizeWidth(resolveNextWidth(nextEvent), "live", sidebarResizeSurface);
    }

    function onPointerUp(nextEvent: PointerEvent) {
      nextEvent.preventDefault();
      if (didMove) {
        onResizeWidth(resolveNextWidth(nextEvent), "end", sidebarResizeSurface);
      }
      stopResize();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleResizeClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (sidebarResizeDisabled) return;
    if (event.detail !== 2) return;
    event.preventDefault();
    setSidebarResizeActive(false);
    onResizeWidth(CODEX_SIDEBAR_WIDTH_DEFAULT_PX, "reset", sidebarResizeSurface);
  };

  const resizeHandle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-disabled={sidebarResizeDisabled || undefined}
      onClick={handleResizeClick}
      onPointerDown={handleResizePointerDown}
      data-testid="sidebar-resize-strip"
      className={cn(
        "group absolute flex touch-none select-none z-20 -top-toolbar right-0 bottom-0 w-4 translate-x-2",
        sidebarResizeDisabled ? "pointer-events-none" : "cursor-col-resize active:cursor-col-resize",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "sidebar-resize-handle-line pointer-events-none m-auto opacity-0",
          "h-full w-px bg-gradient-to-b from-transparent via-token-foreground/25 to-transparent",
          sidebarResizing ? "opacity-100" : "group-hover:opacity-100 group-active:opacity-100",
        )}
      />
    </div>
  );

  const sidebarShell = (
    <motion.aside
      className={cn(
        floating
          ? CODEX_SIDEBAR_FLOATING_ASIDE_CLASS
          : "app-shell-left-panel pointer-events-auto relative flex h-full min-h-0 shrink-0 flex-col overflow-visible browser:bg-token-main-surface-primary",
        sidebarResizing && "cursor-col-resize",
        "font-sans text-sm",
      )}
      style={{
        width: floating ? width : animatedWidth ?? width,
        ...(!floating ? { paddingTop: "var(--height-toolbar)" } : {}),
      }}
      data-testid={floating ? "app-shell-floating-left-panel" : "project-session-sidebar"}
    >
      {header}
      <motion.div
        className="max-w-full min-h-0 flex-1 overflow-hidden"
        style={{ minWidth: width, width, opacity: floating ? undefined : contentOpacity }}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="shrink-0">
            <SidebarNewChatButton
              shortcutLabel={resolveCodexNewChatShortcutLabel()}
              onClick={() => void onStartNewChatInProject(activeProjectId)}
            />
            <CodexSidebarTopAction
              label="Search"
              icon={<SearchIcon className="icon-xs" />}
              shortcutLabel={resolveCodexCommandPaletteShortcutLabel()}
              onClick={onOpenCommandPalette}
            />
            <CodexSidebarTopAction
              label="Plugins"
              icon={<ComposerPluginsIcon className="icon-xs" />}
              onClick={() => onShowUnavailableProduct("Plugins")}
            />
            <CodexSidebarTopAction
              label="Automations"
              icon={<CodexAutomationsIcon />}
              onClick={() => onShowUnavailableProduct("Automations")}
            />
          </div>

          <div
            data-app-action-sidebar-scroll=""
            className="vertical-scroll-fade-mask scrollbar-token relative isolate flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto pt-4 [contain:layout_paint]"
          >
            <SidebarProjectDndProvider onProjectDrop={handleProjectDrop}>
              <SidebarProjectGroupSections
                projects={projects}
                activeProjectId={activeProjectId}
                activeSessionId={activeSessionId}
                contextMenuSessionId={contextMenuSessionId}
                sessionsByProject={sessionsByProject}
                expandedProjectIds={expandedProjectIds}
                pinnedProjectsSectionCollapsed={pinnedProjectsSectionCollapsed}
                projectsSectionCollapsed={projectsSectionCollapsed}
                loadingSessions={loadingSessions}
                onTogglePinnedProjectsSectionCollapsed={onTogglePinnedProjectsSectionCollapsed}
                onToggleProjectsSectionCollapsed={onToggleProjectsSectionCollapsed}
                onToggleProjectExpanded={onToggleProjectExpanded}
                onSelectProject={onSelectProject}
                onSelectSession={onSelectSession}
                onOpenSessionContextMenu={onOpenSessionContextMenu}
                onToggleSessionPinned={onToggleSessionPinned}
                onStartNewChatInProject={onStartNewChatInProject}
                projectPickerOpenTick={projectPickerOpenTick}
                onCreateProject={onCreateProject}
                onUpdateProject={onUpdateProject}
                onDeleteProject={onDeleteProject}
                onReorderProjects={onReorderProjects}
                onSetProjectPinned={onSetProjectPinned}
                onSetPinnedProjectOrder={onSetPinnedProjectOrder}
              />
            </SidebarProjectDndProvider>
          </div>

          <LeftSidebarFooter
            onOpenSettings={onOpenSettings}
            account={account}
            connection={connection}
            onRefreshAccount={onRefreshAccount}
            onLogout={onLogout}
            onErrorMessage={onAccountErrorMessage}
          />
        </div>
      </motion.div>

      {!floating ? resizeHandle : null}
    </motion.aside>
  );

  if (floating) {
    return (
      <>
        {sidebarShell}
        {resizeHandle}
      </>
    );
  }

  return sidebarShell;
}

type PanelActionCardProps = ComponentPropsWithoutRef<"button"> & {
  action: PanelNewTabAction;
  isMac: boolean;
};

const PanelActionCard = forwardRef<HTMLButtonElement, PanelActionCardProps>(
  function PanelActionCard({
    action,
    isMac,
    className,
    ...buttonProps
  }, ref) {
    const shortcut = resolvePanelShortcutLabel(action.shortcut, isMac);
    const Icon = action.Icon;
    return (
      <button
        ref={ref}
        type="button"
        className={cn(PANEL_ACTION_ROW_CLASS, className)}
        {...buttonProps}
      >
        <span className="icon-xs flex shrink-0 items-center justify-center text-token-text-secondary">
          <Icon className="icon-xs" />
        </span>
        <span
          data-thread-side-panel-new-tab-action-label="true"
          className="min-w-0 flex-1 truncate text-sm font-normal text-token-text-primary"
        >
          {action.label}
        </span>
        {shortcut ? (
          <span className="ml-auto shrink-0 pl-2 text-token-text-secondary">
            <kbd className={PANEL_ACTION_KBD_CLASS}>{shortcut}</kbd>
          </span>
        ) : null}
      </button>
    );
  },
);

function RightPanelCardStagePicker({
  cards,
  onOpenCard,
}: {
  cards: Array<{ card: CardSummary; columnName: string }>;
  onOpenCard: (card: CardSummary) => void;
}) {
  if (cards.length === 0) {
    return (
      <div className="w-[320px] px-3 py-2 text-sm text-token-description-foreground">
        No cards in this project.
      </div>
    );
  }

  return (
    <div className="max-h-[320px] w-[320px] overflow-y-auto py-1">
      {cards.map(({ card, columnName }) => (
        <NodexDropdownItem
          key={card.id}
          leftSlot={<SquareKanban className="icon-sm" />}
          subText={columnName}
          onSelect={() => onOpenCard(card)}
        >
          {card.title || card.id}
        </NodexDropdownItem>
      ))}
    </div>
  );
}

function EmptyRightPane({
  actions,
  cards,
  isMac,
  onAction,
  onOpenCard,
}: {
  actions: PanelNewTabAction[];
  cards: Array<{ card: CardSummary; columnName: string }>;
  isMac: boolean;
  onAction: (kind: PanelNewTabActionKind) => void;
  onOpenCard: (card: CardSummary) => void;
}) {
  const codexActions = actions.filter((action) => !isNodexPanelOptionAction(action));
  const nodexActions = actions.filter(isNodexPanelOptionAction);
  const renderAction = (action: PanelNewTabAction) => {
    if (action.kind === "card_stage") {
      return (
        <NodexDropdownMenu
          key={action.kind}
          align="center"
          sideOffset={8}
          contentWidth="panelWide"
          triggerButton={<PanelActionCard action={action} isMac={isMac} />}
        >
          <RightPanelCardStagePicker cards={cards} onOpenCard={onOpenCard} />
        </NodexDropdownMenu>
      );
    }

    return (
      <PanelActionCard
        key={action.kind}
        action={action}
        isMac={isMac}
        onClick={() => onAction(action.kind)}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto bg-token-main-surface-primary p-2 select-none">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center">
        <div className="sticky top-0 z-10 flex flex-col gap-6 bg-token-main-surface-primary">
          <div
            data-thread-side-panel-new-tab-action-grid="true"
            className="flex w-full flex-col gap-1 px-panel"
          >
            {codexActions.map(renderAction)}
            {nodexActions.length > 0 ? (
              <div aria-hidden="true" className="px-2.5 py-1">
                <div className="h-px w-full bg-token-menu-border" />
              </div>
            ) : null}
            {nodexActions.map(renderAction)}
          </div>
        </div>
      </div>
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

function WindowNavigationToolbarButton({
  label,
  shortcutLabel,
  disabled,
  onClick,
  children,
}: {
  label: "Back" | "Forward";
  shortcutLabel: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <NodexTooltip
      delayOpen
      tooltipContent={label}
      shortcut={<ShortcutKeycaps keys={[shortcutLabel]} />}
      side="bottom"
    >
      <button
        type="button"
        className={`${TOOLBAR_BUTTON_BASE_CLASS} ${TOOLBAR_BUTTON_GHOST_CLASS}`}
        title={label}
        aria-label={label}
        disabled={disabled}
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
  onQueueingEnabledChange,
  onOpenThread,
  onOpenTurnDiffReview,
  onForkSessionFromTurn,
  accountActions,
  worktreeStartMode,
  worktreeBranchPrefix,
  onOpenCard,
  searchOpenTick,
  summaryPanelMounted,
  summaryPanelOpen,
  summaryPanelHideImmediately,
  summaryPanelContentShift,
  summarySideChatRows,
  summaryBrowserRows,
  rightPanelComposerOverlayEnabled,
  rightPanelComposerOverlayTarget,
  onOpenSideChat,
  onOpenMcpAppSidePanel,
}: {
  session: ProjectSession;
  project: Project | null;
  projects: Project[];
  onRefreshProjectSessions: (projectId: string) => Promise<ProjectSession[]>;
  onEnsureBlankSessionForProject: (projectId: string) => Promise<ProjectSession>;
  onRequestProjectPickerOpen: () => void;
  onOpenLocalEnvironmentsSettings: () => void;
  onQueueingEnabledChange: ThreadStageActions["onQueueingEnabledChange"];
  onOpenThread: ThreadStageActions["onOpenThread"];
  onOpenTurnDiffReview: ThreadStageActions["onOpenTurnDiffReview"];
  onForkSessionFromTurn: NonNullable<ThreadActionControllerInput["onForkSessionFromTurn"]>;
  accountActions: ReturnType<typeof useCodexAccountActions>;
  worktreeStartMode: WorktreeStartMode;
  worktreeBranchPrefix: string;
  onOpenCard: (cardId: string) => void;
  searchOpenTick: number;
  summaryPanelMounted: boolean;
  summaryPanelOpen: boolean;
  summaryPanelHideImmediately: boolean;
  summaryPanelContentShift: number;
  summarySideChatRows: readonly ThreadSummaryPanelAuxiliaryRow[];
  summaryBrowserRows: readonly ThreadSummaryPanelAuxiliaryRow[];
  rightPanelComposerOverlayEnabled: boolean;
  rightPanelComposerOverlayTarget: HTMLElement | null;
  onOpenSideChat: (input?: {
    prompt?: string;
    promptInput?: CodexPromptInput;
    collaborationMode?: CodexCollaborationModeKind;
  }) => Promise<void>;
  onOpenMcpAppSidePanel: ThreadStageActions["onOpenMcpAppSidePanel"];
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

  const actions = useMemo(() => createThreadStageActions({
    activeThreadId: summary?.threadId ?? null,
    accountActions,
    codexControl,
    onOpenCard,
    onEnsureBlankSessionForProject,
    onRefreshProjectSessions,
    onQueueingEnabledChange,
    onOpenThread,
    onOpenTurnDiffReview,
    onForkSessionFromTurn,
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
    onOpenSideChat: async (input) => {
      await onOpenSideChat({
        ...input,
        collaborationMode: selectedCollaborationMode,
      });
    },
    onOpenMcpAppSidePanel,
    selectedCollaborationMode,
    setSelectedCollaborationMode,
  }), [
    codexControl,
    accountActions,
    onOpenCard,
    onEnsureBlankSessionForProject,
    onRefreshProjectSessions,
    onQueueingEnabledChange,
    onOpenThread,
    onOpenTurnDiffReview,
    onForkSessionFromTurn,
    onRequestProjectPickerOpen,
    onOpenLocalEnvironmentsSettings,
    onOpenSideChat,
    onOpenMcpAppSidePanel,
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
        projectWorkspacePath={summary ? projectWorkspaceRootOrNull(project) : projectWorkspaceRootOrNull(selectedNewThreadProject)}
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
        newThreadStartInSelector={summary ? null : {
          target: {
            runInTarget: selectedNewThreadRunInTarget,
            runInEnvironmentPath: selectedNewThreadEnvironmentPath,
            worktreeStartMode,
            worktreeBranchPrefix,
          },
          disabled: false,
          worktreeAvailable: Boolean(normalizeProjectPrimaryWorkspaceRoot(selectedNewThreadProject)),
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
        summaryPanelMounted={summaryPanelMounted}
        summaryPanelOpen={summaryPanelOpen}
        summaryPanelHideImmediately={summaryPanelHideImmediately}
        summaryPanelContentShift={summaryPanelContentShift}
        summarySideChatRows={summarySideChatRows}
        summaryBrowserRows={summaryBrowserRows}
        rightPanelComposerOverlayEnabled={rightPanelComposerOverlayEnabled}
        rightPanelComposerOverlayTarget={rightPanelComposerOverlayTarget}
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

function McpAppSessionTab({ tab }: { tab: McpAppPanelTab }) {
  return (
    <div
      className="h-full min-h-0 bg-token-main-surface-primary"
      data-mcp-app-side-panel-tab={tab.id}
      data-mcp-capability-id={tab.app.capabilityId}
    >
      <McpCapabilityViewFrame resource={tab.app.resource} mode="side-panel" />
    </div>
  );
}

function SideChatSessionTab({
  tab,
  activeSession,
  projects,
  onOpenCardTab,
  onRefreshSessions,
  onRecreateSideChat,
  onOpenMcpAppSidePanel,
  onQueueingEnabledChange,
  onOpenThread,
  onOpenTurnDiffReview,
}: {
  tab: SideChatPanelTab;
  activeSession: ProjectSession;
  projects: Project[];
  onOpenCardTab: OpenCardTabHandler;
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  onRecreateSideChat: () => void;
  onOpenMcpAppSidePanel: ThreadStageActions["onOpenMcpAppSidePanel"];
  onQueueingEnabledChange: ThreadStageActions["onQueueingEnabledChange"];
  onOpenThread: ThreadStageActions["onOpenThread"];
  onOpenTurnDiffReview: ThreadStageActions["onOpenTurnDiffReview"];
}) {
  const project = projects.find((candidate) => candidate.id === tab.projectId) ?? null;
  const conversation = useConversation(tab.threadId);
  const accountActions = useCodexAccountActions();
  const codexControl = useCodexAppServerControl(tab.projectId);
  const [collaborationModes, setCollaborationModes] = useState<CodexCollaborationModePreset[]>([]);
  const [selectedCollaborationMode, setSelectedCollaborationMode] = useState<CodexCollaborationModeKind>("default");

  useEffect(() => {
    if (tab.status !== "ready") return;
    void codexControl.loadModels().catch(() => undefined);
    void codexControl.listCollaborationModes()
      .then(setCollaborationModes)
      .catch(() => setCollaborationModes([]));
  }, [codexControl.loadModels, codexControl.listCollaborationModes, tab.status]);

  const actions = useMemo(() => createThreadStageActions({
    activeThreadId: tab.threadId,
    accountActions,
    codexControl,
    onOpenCard: (cardId) => {
      void onOpenCardTab(tab.projectId, cardId, cardId);
    },
    onEnsureBlankSessionForProject: async () => activeSession,
    onRefreshProjectSessions: onRefreshSessions,
    onQueueingEnabledChange,
    onOpenThread,
    onOpenTurnDiffReview,
    currentSessionProjectId: activeSession.projectId,
    projectId: tab.projectId,
    onNewThreadProjectChange: () => undefined,
    onRequestNewChatProjectCreate: () => undefined,
    onNewThreadStartInTargetChange: () => undefined,
    onNewThreadStartInEnvironmentChange: () => undefined,
    onRefreshNewThreadStartInEnvironments: async () => undefined,
    onOpenNewThreadLocalEnvironmentsSettings: () => undefined,
    onOpenMcpAppSidePanel,
    selectedCollaborationMode,
    setSelectedCollaborationMode,
  }), [
    accountActions,
    activeSession,
    codexControl,
    onOpenCardTab,
    onOpenMcpAppSidePanel,
    onOpenThread,
    onOpenTurnDiffReview,
    onQueueingEnabledChange,
    onRefreshSessions,
    selectedCollaborationMode,
    tab.projectId,
    tab.threadId,
  ]);

  if (tab.status === "loading") {
    return <SideChatLoadingPanel title={tab.title} />;
  }

  if (tab.status === "expired" || !tab.threadId || !conversation) {
    return <SideChatExpiredPanel onRecreateSideChat={onRecreateSideChat} />;
  }

  return (
    <div className="h-full min-h-0 bg-token-main-surface-primary">
      <ConnectedThreadStage
        projectId={tab.projectId}
        projectWorkspacePath={projectWorkspaceRootOrNull(project)}
        isNewThreadTab={false}
        newThreadTarget={null}
        newThreadProjectSelector={null}
        newThreadStartInSelector={null}
        threadStartProgress={null}
        activeThreadId={tab.threadId}
        activeThreadSummary={conversation}
        availableModels={codexControl.availableModels}
        collaborationModes={collaborationModes}
        selectedCollaborationMode={selectedCollaborationMode}
        selectedModel={codexControl.threadSettings.model ?? ""}
        selectedReasoningEffort={codexControl.threadSettings.reasoningEffort ?? "medium"}
        reasoningEffortOptions={codexControl.reasoningEffortOptions}
        permissionMode={codexControl.permissionMode}
        isQueueingEnabled
        composerEnterBehavior="enter"
        searchOpenTick={0}
        summaryPanelMounted={false}
        summaryPanelOpen={false}
        summaryPanelHideImmediately={false}
        summaryPanelContentShift={0}
        sideChatContext={{
          parentThreadId: tab.parentThreadId,
          tabTitle: tab.title,
        }}
        actions={actions}
      />
    </div>
  );
}

export function SideChatLoadingPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary p-6 select-none">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center text-center">
        <div className="relative mb-3 flex size-10 items-center justify-center rounded-xl bg-token-bg-secondary text-token-text-secondary">
          <CodexSidePanelSideChatIcon className="icon-md opacity-40" />
          <SpinnerIcon className="icon-xs absolute animate-spin text-token-text-secondary" />
        </div>
        <div className="text-base font-semibold text-token-text-primary">{title}</div>
      </div>
    </div>
  );
}

export function SideChatExpiredPanel({ onRecreateSideChat }: { onRecreateSideChat: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary p-6 select-none">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center text-center">
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-token-bg-secondary text-token-text-secondary">
          <CodexSidePanelSideChatIcon className="icon-md" />
        </div>
        <div className="text-base font-semibold text-token-text-primary">Side chat expired</div>
        <div className="mt-1 max-w-sm text-sm text-token-text-secondary">
          This temporary side chat is no longer available; start a new side chat to continue
        </div>
        <NodexButton
          type="button"
          size="sm"
          className="mt-4"
          onClick={onRecreateSideChat}
        >
          Start new side chat
        </NodexButton>
      </div>
    </div>
  );
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
  activePanelCardStageCardIdsByProject,
  cardStageCloseRef,
  cardStagePersistRef,
  cardStageSessionSnapshotRef,
  pendingReminderOpen,
  taskSearchOpenTick,
  setSearchQuery,
  setDbViewPrefs,
  onReminderHandled,
  onLeaveCardStageCard,
  onOpenCardTab,
  onOpenFileTab,
  onRefreshSessions,
  onCloseTab,
  cardStageHistoryModal,
  onToggleCardStageHistoryModal,
  selectedTurnDiffReviewTarget,
  browserBoundsSyncTrigger,
}: {
  tab: ProjectSessionTab & { preview?: true };
  activeSession: ProjectSession;
  projects: Project[];
  activeView: WorkbenchView;
  activeSearchQuery: string;
  activeDbViewPrefs: DbViewPrefs | null;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  activePanelCardStageCardIdsByProject: ReadonlyMap<string, ReadonlySet<string>>;
  cardStageCloseRef: React.RefObject<(() => Promise<void>) | null>;
  cardStagePersistRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  cardStageSessionSnapshotRef?: React.MutableRefObject<CardStageSessionSnapshot | null>;
  pendingReminderOpen?: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  } | null;
  taskSearchOpenTick: number;
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
  onOpenCardTab: OpenCardTabHandler;
  onOpenFileTab: (input: { path: string; title: string; panelId: PanelId }) => Promise<void>;
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  onCloseTab: (tabId: string) => Promise<void>;
  cardStageHistoryModal: CardStageHistoryModalContext | null;
  onToggleCardStageHistoryModal: (context: CardStageHistoryModalContext) => void;
  selectedTurnDiffReviewTarget: CodexTurnDiffReviewTarget | null;
  browserBoundsSyncTrigger?: MotionValue<number>;
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
        activePanelCardStageCardIdsByProject={activePanelCardStageCardIdsByProject}
        cardStageCloseRef={cardStageCloseRef}
        pendingReminderOpen={pendingReminderOpen}
        taskSearchOpenTick={taskSearchOpenTick}
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
        sessionId={activeSession.id}
        onLeaveCard={onLeaveCardStageCard}
        onClose={() => void onCloseTab(tab.id)}
        onOpenTerminal={async () => {
          await invoke("project-session-tabs:create", {
            sessionId: activeSession.id,
            projectId: activeSession.projectId,
            panelId: "bottom",
            kind: "terminal",
            title: "Terminal",
            config: {
              projectId: cardTab.config.projectId,
              terminalSessionId: `session:${activeSession.id}:terminal:${Date.now()}`,
            },
          });
          await invoke("project-session-panels:update", activeSession.id, "bottom", { collapsed: false });
          await onRefreshSessions(activeSession.projectId);
        }}
        historyPanelActive={Boolean(
          cardStageHistoryModal
          && cardStageHistoryModal.sessionId === activeSession.id
          && cardStageHistoryModal.tabId === cardTab.id
          && cardStageHistoryModal.projectId === cardTab.config.projectId
          && cardStageHistoryModal.cardId === cardTab.config.cardId,
        )}
        onToggleHistoryPanel={onToggleCardStageHistoryModal}
      />
    );
  }

  if (tab.kind === "terminal" && "terminalSessionId" in tab.config) {
    const cwd = resolveSessionTerminalCwd(activeSession, tab, projects);
    return (
      <div className="h-full min-h-0 bg-token-main-surface-primary">
        <TerminalPanel
          terminalId={tab.config.terminalSessionId}
          cwd={cwd}
          panelHeight={Number.MAX_SAFE_INTEGER}
        />
      </div>
    );
  }

  if (tab.kind === "review") {
    const project = projects.find((item) => item.id === tab.projectId) ?? null;
    return (
      <ConnectedReviewDiffPanel
        threadId={activeSession.thread?.threadId ?? null}
        projectWorkspacePath={projectWorkspaceRootOrNull(project)}
        searchOpenTick={0}
        selectedTurnDiff={selectedTurnDiffReviewTarget}
      />
    );
  }

  if (tab.kind === "browser") {
    return (
      <BrowserSidebarPanel
        tab={tab}
        activeSession={activeSession}
        onRefreshSessions={onRefreshSessions}
        boundsSyncTrigger={browserBoundsSyncTrigger}
      />
    );
  }

  if (tab.kind === "files") {
    return (
      <WorkspaceFilesPanel
        tab={tab as WorkspaceFilesTab}
        activeSession={activeSession}
        project={projects.find((item) => item.id === tab.projectId) ?? null}
        onOpenFileTab={onOpenFileTab}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-token-main-surface-primary text-sm text-token-text-secondary">
      Unsupported tab.
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
  activePanelCardStageCardIdsByProject,
  cardStageCloseRef,
  pendingReminderOpen,
  taskSearchOpenTick,
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
  activePanelCardStageCardIdsByProject: ReadonlyMap<string, ReadonlySet<string>>;
  cardStageCloseRef: React.RefObject<(() => Promise<void>) | null>;
  pendingReminderOpen?: {
    projectId: string;
    cardId: string;
    occurrenceStart: string;
  } | null;
  taskSearchOpenTick: number;
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
  onOpenCardTab: OpenCardTabHandler;
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
  const lastHandledTaskSearchOpenTickRef = useRef(taskSearchOpenTick);
  const searchQuery = searchByProject[config.projectId] ?? (config.projectId === tab.projectId ? activeSearchQuery : "");
  const activePanelCardStageCardIds = activePanelCardStageCardIdsByProject.get(config.projectId);
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

  useEffect(() => {
    if (
      taskSearchOpenTick <= 0
      || taskSearchOpenTick === lastHandledTaskSearchOpenTickRef.current
    ) {
      return;
    }

    lastHandledTaskSearchOpenTickRef.current = taskSearchOpenTick;
    openTaskSearch(true);
  }, [openTaskSearch, taskSearchOpenTick]);

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
          activePanelCardStageCardIds={activePanelCardStageCardIds}
          cardStageCloseRef={cardStageCloseRef}
          pendingReminderOpen={pendingReminderOpen}
          calendarState={calendarState}
          calendarVisibleDays={calendarVisibleDays}
          calendarCreateRequestId={calendarCreateRequestId}
          onCalendarAnchorDateChange={handleCalendarAnchorDateChange}
          onReminderHandled={onReminderHandled}
          openCardStage={(projectId, cardId, titleSnapshot, options) => {
            void onOpenCardTab(projectId, cardId, titleSnapshot, {
              sourceTabId: tab.id,
              openMode: options?.openMode ?? "preview",
            });
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
  sessionId,
  onLeaveCard,
  onClose,
  onOpenTerminal,
  historyPanelActive,
  onToggleHistoryPanel,
}: {
  tab: ProjectSessionTab & { config: { projectId: string; cardId: string; titleSnapshot?: string } };
  project: Project | null;
  closeRef: React.RefObject<(() => Promise<void>) | null>;
  persistRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  sessionSnapshotRef?: React.MutableRefObject<CardStageSessionSnapshot | null>;
  sessionId: string;
  onLeaveCard: (snapshot: CardStageSessionSnapshot) => void;
  onClose: () => void;
  onOpenTerminal: (card: Card) => Promise<void>;
  historyPanelActive: boolean;
  onToggleHistoryPanel: (context: CardStageHistoryModalContext) => void;
}) {
  const kanban = useKanban({ projectId: tab.config.projectId, sessionId: tab.id });
  const refreshBoard = kanban.refresh;

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  const cardSummary = kanban.cardIndex.get(tab.config.cardId) ?? null;
  const detail = useCardDetail(
    tab.config.projectId,
    tab.config.cardId,
    cardSummary?.status,
  );
  const card = detail.card;
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
      <CardStageSessionNotice
        title="Project not found"
        description="This card tab points to a project that is no longer available."
        actionLabel="Close tab"
        onAction={onClose}
      />
    );
  }

  if (kanban.loading && !card) {
    return (
      <CardStageSessionNotice
        title="Loading card"
        description={tab.config.titleSnapshot ? `Opening ${tab.config.titleSnapshot}.` : "Opening the selected card."}
      />
    );
  }

  if (!card) {
    return (
      <CardStageSessionNotice
        title="Card not found"
        description={tab.config.titleSnapshot
          ? `${tab.config.titleSnapshot} is no longer available in ${project.name}.`
          : `This card is no longer available in ${project.name}.`}
        actionLabel="Close tab"
        onAction={onClose}
      />
    );
  }

  const columnId = cardSummary?.status ?? card?.status ?? "draft";
  const columnName = KANBAN_STATUS_LABELS[columnId] ?? columnId;

  if (!card && (detail.loading || cardSummary)) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-token-text-secondary">
        Loading card...
      </div>
    );
  }

  return (
    <>
      <CardStage
        card={card}
        columnId={columnId}
        columnName={columnName}
        projectId={tab.config.projectId}
        projectWorkspacePath={projectWorkspaceRootOrNull(project)}
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
        onToggleHistoryPanel={() => onToggleHistoryPanel({
          sessionId,
          tabId: tab.id,
          projectId: tab.config.projectId,
          cardId: tab.config.cardId,
          cardTitle: card?.title ?? tab.config.titleSnapshot,
        })}
        historyPanelActive={historyPanelActive}
        linkedCodexThreads={[]}
      />
    </>
  );
}

function CardStageSessionNotice({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary p-3 select-none">
      <div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center text-center">
        <div className="text-base font-medium text-token-text-primary">{title}</div>
        <div className="mt-1 text-sm text-token-text-secondary">{description}</div>
        {actionLabel && onAction ? (
          <NodexButton
            type="button"
            size="sm"
            className="mt-3"
            onClick={onAction}
          >
            {actionLabel}
          </NodexButton>
        ) : null}
      </div>
    </div>
  );
}
