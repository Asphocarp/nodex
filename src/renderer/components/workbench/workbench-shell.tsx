import {
  Fragment,
  forwardRef,
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
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
import { PanelDestinationPicker } from "./panel-destination-picker";
import type { PanelDestination, PanelDestinationPickerScope } from "./panel-destination-picker-model";
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
import { CardStageToolbar } from "@/components/kanban/card-stage/toolbar";
import { HistoryPanel } from "./workbench-history-panel";
import { TerminalPanel } from "./workbench-terminal-panel";
import {
  terminalSessionStore,
  useTerminalSessionStoreVersion,
} from "@/lib/terminal-session-store";
import { BrowserSidebarHiddenWebviewHosts } from "@/features/browser-sidebar/browser-sidebar-hidden-webview-hosts";
import { BrowserSidebarPanel } from "@/features/browser-sidebar/browser-sidebar-panel";
import {
  ContentSearchProvider,
  type ContentSearchDomain,
  type ContentSearchOpenRequest,
  type ContentSearchOpenSource,
} from "@/features/content-search/content-search-context";
import { ContentSearchSurface } from "@/features/content-search/content-search-surface";
import {
  WorkspaceFilesPanel,
  getWorkspaceFileDomTabId,
  getWorkspaceFileName,
  type WorkspaceFilesTab,
} from "@/features/workspace-files";
import { CommandPalette } from "./workbench-shell-deps";
import { SettingsRouteShell } from "./workbench-settings-overlay";
import { buildSettingsPath } from "./workbench-settings-routes";
import type { OpenCardStageOptions } from "@/components/kanban/open-card-stage";
import { LeftSidebarFooter } from "./left-sidebar-footer";
import { SidebarProjectsSectionActions } from "./sidebar-projects-section-actions";
import {
  NodexDropdownFlyoutSubmenuItem,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSeparator,
} from "@/components/ui/dropdown";
import { NodexButton } from "@/components/ui/button";
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
import { PlanSidePanelTab } from "./plan-side-panel-tab";
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
import { invoke } from "@/lib/api";
import { useKanban } from "@/lib/use-kanban";
import { useCardDetail } from "@/lib/card-detail-store";
import { readCardStageContentWidthPreference } from "@/lib/card-stage-layout";
import { cn } from "@/lib/utils";
import { RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE } from "@/lib/right-panel-composer-overlay-reserve";
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
import {
  CODEX_SIDEBAR_DEFAULT_PAGER_ROW_CLASS,
  CODEX_SIDEBAR_PAGER_BUTTON_CLASS,
  CODEX_SIDEBAR_PROJECT_GROUP_MAX_GROUPS,
  CODEX_SIDEBAR_PROJECT_THREAD_PAGER_ROW_CLASS,
  CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS,
  paginateCodexSidebarItems,
  type CodexSidebarPaginationResult,
} from "@/lib/codex-sidebar-pagination";
import {
  listExpandedVisibleProjectGroupIds,
  listReopenableVisibleProjectGroupIds,
  resolveSidebarProjectGroupCollapseAction,
  type SidebarProjectGroupCollapseAction,
} from "@/lib/sidebar-project-group-collapse-action";
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
import { resolvePanelTabCloseReplacement } from "@/lib/panel-tab-close-routing";
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
  CardRunInTarget,
  CardInput,
  CardUpdateMutationResult,
  CodexAccountSnapshot,
  CodexCollaborationModeKind,
  CodexConnectionState,
  CodexCollaborationModePreset,
  CodexSidebarSyncResult,
  CodexSidebarThreadItem,
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
  ProjectSessionPanelEnsureRightLeafResult,
  ProjectSessionTab,
  ProjectSessionTabCreateInput,
  ProjectSessionThreadLink,
  ProjectSessionPanelSplitSide,
  WorktreeStartMode,
  WorktreeEnvironmentOption,
} from "@/lib/types";
import type { ThreadActionControllerInput, ThreadStageActions } from "@/features/local-conversation";
import type {
  ThreadOpenSideChatInput,
  ThreadMcpAppSidePanelInput,
  ThreadPlanSidePanelState,
  ThreadPlanSidePanelTarget,
  ThreadSummaryPanelAuxiliaryRow,
} from "@/features/local-conversation/thread-stage-types";
import {
  getDefaultDbViewPrefs,
  viewSupportsDbViewPrefs,
  type DbViewPrefs,
  type SupportedDbView,
} from "@/lib/db-view-prefs";
import {
  DEFAULT_SIDEBAR_PINNED_ORGANIZATION_MODE,
  normalizeSidebarPinnedOrganizationMode,
  type RecentCardSession,
  type SidebarPinnedOrganizationMode,
  type SpaceRef,
  type WorkbenchView,
} from "@/lib/use-workbench-state";
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
  shouldResetCodexSidebarPointerOnWindowMouseOut,
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
  ComposerPlanModeIcon,
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
  CodexSidebarThreadRow,
  CodexSidebarTopAction,
  resolveCodexCardSearchShortcutLabel,
  resolveCodexNewChatShortcutLabel,
} from "./codex-sidebar";
import { RenameChatDialog } from "./rename-chat-dialog";
import {
  SidebarProjectDndProvider,
  SidebarProjectSortableContext,
  type SidebarGroupDndController,
} from "./sidebar-project-group-dnd";
import {
  sortSidebarThreadKeysForDisplay,
  type CodexSidebarThreadSyncModel,
} from "@/lib/codex-sidebar-thread-sync";
import { useSidebarThreadSyncModel } from "@/lib/use-sidebar-thread-sync-model";
import {
  resolveWorkbenchNavigationShortcutLabel,
  WORKBENCH_NAVIGATION_COMMANDS,
  type WorkbenchNavigationCommandRequest,
  type WorkbenchNavigationCommandState,
  type WorkbenchPanelTabCloseCommandRequest,
  type WorkbenchPanelTabCycleCommandRequest,
  type WorkbenchPanelTabCycleDirection,
  type WorkbenchSidebarToggleCommandSource,
  type WorkbenchThreadRenameCommandRequest,
} from "../../../shared/window-navigation";
import {
  createCommandKeymapState,
  formatCommandShortcutLabel,
  getCommandEntry,
  matchesKeyboardEventToCommand,
  type CommandKeymapState,
} from "../../../shared/command-keybindings";
import type { CommandMenuMode } from "@/lib/command-palette";
import type {
  CommandPaletteShellCommandContext,
  CommandPaletteShellCommandHandlers,
} from "@/lib/command-palette-commands";
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
const NOOP_WORKBENCH_SIDEBAR_GROUP_DND_CONTROLLER: SidebarGroupDndController = {
  handleDragEnd: () => undefined,
};
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
  commandId?: string;
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

interface PlanPanelTab {
  planPanel: true;
  id: "plan";
  sessionId: string;
  projectId: string;
  panelId: "right";
  leafId?: string;
  title: "Plan";
  stateKey: number;
  planKey: string;
  threadId: string;
  turnId: string;
  itemId: string;
  content: string;
  cwd: string | null;
  hideCodeBlocks?: boolean;
}

type ProjectSessionRenderableTab =
  | DurableProjectSessionRenderableTab
  | SideChatPanelTab
  | McpAppPanelTab
  | PlanPanelTab;

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
    commandId: "toggleFileTreePanel",
    Icon: CodexSidePanelFilesIcon,
  },
  {
    kind: "side_chat",
    defaultPanelId: "right",
    targetPanelIds: ["right", "bottom"],
    label: "Side chat",
    description: "Start a side conversation",
    shortcut: "alt+mod+s",
    commandId: "openSideChat",
    Icon: CodexSidePanelSideChatIcon,
  },
  {
    kind: "browser",
    defaultPanelId: "right",
    targetPanelIds: ["right", "bottom"],
    label: "Browser",
    description: "Open a website",
    shortcut: "mod+t",
    commandId: "openBrowserTab",
    Icon: CodexSidePanelBrowserIcon,
  },
  {
    kind: "review",
    defaultPanelId: "right",
    targetPanelIds: ["right"],
    label: "Review",
    description: "View code changes",
    shortcut: "ctrl+shift+g",
    commandId: "openReviewTab",
    Icon: CodexSidePanelReviewIcon,
  },
  {
    kind: "terminal",
    defaultPanelId: "bottom",
    targetPanelIds: ["right", "bottom"],
    label: "Terminal",
    description: "Start an interactive shell",
    shortcut: "ctrl+backquote",
    commandId: "toggleTerminal",
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
    const rank = (session: ProjectSession) => session.pinned ? 0 : 1;
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
    pinnedOrganizationMode?: SidebarPinnedOrganizationMode;
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
  pendingCardDeepLinkOpen?: {
    projectId: string;
    cardId: string;
  } | null;
  onCardDeepLinkHandled?: (payload: {
    projectId: string;
    cardId: string;
  }) => void;
  pendingSessionOpen?: {
    projectId: string | null;
    sessionId: string;
  } | null;
  setDbProject: (projectId: string) => void;
  setSearchQuery: (projectId: string, value: string) => void;
  setDbViewPrefs: (
    projectId: string,
    view: SupportedDbView,
    update: (prev: DbViewPrefs) => DbViewPrefs,
  ) => void;
  openCardStage: (
    projectId: string,
    cardId: string,
    titleSnapshot?: string,
    options?: OpenCardStageOptions,
  ) => void;
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
  contentSearchOpenRequest?: ContentSearchOpenRequest | null;
  onRequestContentSearchOpen?: (preferredDomain: ContentSearchDomain | undefined, source: ContentSearchOpenSource) => void;
  setSidebarCollapsed?: (collapsed: boolean) => void;
  setSidebarWidth?: (width: number) => void;
  setSidebarPinnedOrganizationMode?: (mode: SidebarPinnedOrganizationMode) => void;
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
  taskSearchOpenTick?: number;
  diffSearchOpenTick?: unknown;
  commandPaletteOpenTick?: number;
  commandPaletteInitialMode?: CommandMenuMode;
  commandPaletteInitialQuery?: string;
  settingsToggleTick?: unknown;
  keyboardShortcutsSettingsOpenTick?: unknown;
  sidebarToggleRequestTick?: number;
  sidebarToggleRequestSource?: WorkbenchSidebarToggleCommandSource;
  navigationCommandRequest?: WorkbenchNavigationCommandRequest | null;
  panelTabCycleRequest?: WorkbenchPanelTabCycleCommandRequest | null;
  panelTabCloseRequest?: WorkbenchPanelTabCloseCommandRequest | null;
  threadRenameRequest?: WorkbenchThreadRenameCommandRequest | null;
  onNavigationStateChange?: (state: WorkbenchNavigationCommandState) => void;
  navigateToRecentSession?: unknown;
  navigateToCardsTab?: unknown;
  navigateToThreadTab?: unknown;
  navigateToFilesTab?: unknown;
  commandKeymapState?: CommandKeymapState | null;
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

type PanelGroupTabsByPanel = Record<PanelId, {
  itemsByLeafId: Record<string, AppShellTabItem[]>;
  activeTabIdsByLeafId: Record<string, string | null>;
}>;

const PANEL_FOCUS_AREA_SELECTOR = "[data-app-shell-focus-area=\"right-panel\"], [data-app-shell-focus-area=\"bottom-panel\"]";
const PANEL_GROUP_LEAF_SELECTOR = "[data-panel-group-leaf-id]";

function isCodexTerminalShortcutTarget(target: EventTarget | null): boolean {
  const element = target as ShortcutTargetLike | null;
  if (!element?.closest) return false;
  return Boolean(element.closest("[data-codex-terminal]"));
}

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

function resolveProjectTargetTabChromeContext(
  tab: ProjectSessionRenderableTab,
  activeSession: ProjectSession,
  projects: readonly Project[],
): Pick<AppShellTabItem, "contextLabel" | "titleLabel" | "tooltip"> {
  if (isSideChatPanelTab(tab) || isMcpAppPanelTab(tab) || isPlanPanelTab(tab)) return {};
  if (tab.kind !== "db_view" && tab.kind !== "card_stage") return {};
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

function findDbViewTabForProject(session: ProjectSession, projectId: string): ProjectSessionTab | null {
  return session.tabs.find((tab) =>
    tab.kind === "db_view"
    && "projectId" in tab.config
    && tab.config.projectId === projectId
  ) ?? null;
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

function isPanelDestinationAction(
  action: PanelNewTabAction,
): action is PanelNewTabAction & { kind: "db_view" | "card_stage" } {
  return action.kind === "db_view" || action.kind === "card_stage";
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

function resolvePanelActionShortcutLabel(
  action: PanelNewTabAction,
  isMac: boolean,
  commandKeymapState?: CommandKeymapState | null,
): string | null {
  if (action.commandId) {
    const state = commandKeymapState ?? createCommandKeymapState({}, isMac ? "macOS" : "windows");
    const label = formatCommandShortcutLabel(state, action.commandId);
    const entry = getCommandEntry(state, action.commandId);
    if (label && entry?.isCustom !== true && action.shortcut) {
      return resolvePanelShortcutLabel(action.shortcut, isMac);
    }
    if (label) return label;
  }
  return resolvePanelShortcutLabel(action.shortcut, isMac);
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

function matchesPanelActionShortcut(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  action: PanelNewTabAction,
  isMac: boolean,
  commandKeymapState?: CommandKeymapState | null,
): boolean {
  if (action.commandId) {
    const state = commandKeymapState ?? createCommandKeymapState({}, isMac ? "macOS" : "windows");
    if (matchesKeyboardEventToCommand(event, state, action.commandId)) return true;
  }
  return action.shortcut ? matchesPanelShortcut(event, action.shortcut, isMac) : false;
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

function makePanelLeafStateKey(sessionId: string, panelId: PanelId, leafId: string): string {
  return `${sessionId}:${panelId}:${leafId}`;
}

function uniqueStringList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function makeClientProjectSessionTabId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `tab:${randomId}`;
  return `tab:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`;
}

function makeTerminalSessionId(sessionId: string): string {
  return `session:${sessionId}:terminal:${Date.now()}`;
}

function makeClientTerminalTabId(terminalSessionId: string): string {
  return `terminal:${terminalSessionId}`;
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

function makePlanPanelKey(sessionId: string, panelId: PanelId, leafId?: string | null): string {
  return leafId ? `${sessionId}:${panelId}:${leafId}` : `${sessionId}:${panelId}`;
}

function isSideChatPanelTab(tab: ProjectSessionRenderableTab): tab is SideChatPanelTab {
  return "sideChat" in tab && tab.sideChat === true;
}

function isMcpAppPanelTab(tab: ProjectSessionRenderableTab): tab is McpAppPanelTab {
  return "mcpApp" in tab && tab.mcpApp === true;
}

function isPlanPanelTab(tab: ProjectSessionRenderableTab): tab is PlanPanelTab {
  return "planPanel" in tab && tab.planPanel === true;
}

function isRootThreadRightPanelComposerOverlayEligibleTab(
  tab: ProjectSessionRenderableTab | null,
): boolean {
  if (!tab) return false;
  if (isSideChatPanelTab(tab) || isMcpAppPanelTab(tab) || isPlanPanelTab(tab)) return false;

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

function resolveProjectBoundSessionId(session: ProjectSession): string | null {
  return session.projectId;
}

function isPreviewableProjectSessionTabKind(kind: ProjectSessionTab["kind"]): boolean {
  return PREVIEWABLE_PROJECT_SESSION_TAB_KIND_SET.has(kind);
}

function makeProjectSessionTabDraft(
  session: ProjectSession,
  kind: ProjectSessionTab["kind"],
): ProjectSessionTabDraft | null {
  const projectId = resolveProjectBoundSessionId(session);
  if (projectId === null) return null;

  if (kind === "db_view") {
    return {
      kind,
      title: "DB View",
      config: { projectId, view: "kanban" },
    };
  }

  if (kind === "files") {
    return {
      kind,
      title: "Files",
      config: { projectId, hostId: "local", workspaceRoot: "" },
    };
  }

  if (kind === "browser") {
    return {
      kind,
      title: "Browser",
      config: { projectId },
    };
  }

  if (kind === "review") {
    return {
      kind,
      title: "Review",
      config: { projectId },
    };
  }

  if (kind === "terminal") {
    return {
      kind,
      title: "Terminal",
      config: {
        projectId,
        terminalSessionId: makeTerminalSessionId(session.id),
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
  const projectId = resolveProjectBoundSessionId(session);
  if (projectId === null) {
    throw new Error("Projectless sessions cannot own project-scoped tabs");
  }
  const now = new Date().toISOString();
  return {
    id: `preview:${session.id}:${panelId}:${draft.kind}`,
    sessionId: session.id,
    projectId,
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
  const projectId = resolveProjectBoundSessionId(session);
  if (projectId === null) {
    throw new Error("Projectless sessions cannot own project-scoped tabs");
  }
  const now = new Date().toISOString();
  return {
    id: `preview:${session.id}:${panelId}:files:${input.path}`,
    sessionId: session.id,
    projectId,
    panelId,
    kind: "files",
    title: input.title,
    order: session.tabs.filter((tab) => tab.panelId === panelId).length,
    config: {
      projectId,
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
  const projectId = resolveProjectBoundSessionId(session);
  if (projectId === null) {
    throw new Error("Projectless sessions cannot own project-scoped tabs");
  }
  const now = new Date().toISOString();
  const title = input.titleSnapshot || input.cardId;
  return {
    id: makeClientProjectSessionTabId(),
    sessionId: session.id,
    projectId,
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

function resolveTerminalTabIndex(session: ProjectSession, tab: ProjectSessionTab): number {
  const index = session.tabs
    .filter((candidate) => candidate.kind === "terminal")
    .findIndex((candidate) => candidate.id === tab.id);
  return index >= 0 ? index + 1 : 1;
}

function resolveDbCardSourceLeafId(session: ProjectSession, sourceTabId: string | undefined): string | null {
  if (!sourceTabId) return null;
  const sourceTab = session.tabs.find((tab) =>
    tab.id === sourceTabId
    && tab.panelId === "right"
    && tab.kind === "db_view"
  );
  if (!sourceTab) return null;
  const sourceLeafId = findProjectSessionPanelLeafForTab(session.panels.right.layout, sourceTab.id)?.id;
  return sourceLeafId ?? null;
}

function resolveCardTabTargetLeafId(session: ProjectSession, sourceTabId: string | undefined): string | undefined {
  const sourceLeafId = resolveDbCardSourceLeafId(session, sourceTabId);
  if (!sourceLeafId) return undefined;
  return findNearestProjectSessionPanelLeafToRight(session.panels.right.layout, sourceLeafId) ?? undefined;
}

function shouldEnsureRightLeafForDbCardOpen(
  session: ProjectSession,
  sourceLeafId: string | null,
  rightPanelFullWidth: boolean,
): sourceLeafId is string {
  if (!sourceLeafId) return false;
  if (!rightPanelFullWidth) return false;
  if (findNearestProjectSessionPanelLeafToRight(session.panels.right.layout, sourceLeafId)) return false;
  return listProjectSessionPanelLeaves(session.panels.right.layout).length === 1;
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
  sidebar,
  cardStageCloseRef,
  cardStagePersistRef,
  cardStageSessionSnapshotRef,
  pendingReminderOpen,
  pendingCardDeepLinkOpen,
  onCardDeepLinkHandled,
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
  onSetProjectPinned,
  onRequestProjectPickerOpen,
  projectPickerOpenTick = 0,
  taskSearchOpenTick = 0,
  threadSearchOpenTick,
  contentSearchOpenRequest = null,
  onRequestContentSearchOpen,
  commandPaletteOpenTick = 0,
  commandPaletteInitialMode = "root",
  commandPaletteInitialQuery = "",
  setSidebarCollapsed,
  setSidebarWidth,
  setSidebarPinnedOrganizationMode,
  setSidebarTopLevelSectionVisible,
  settingsToggleTick,
  keyboardShortcutsSettingsOpenTick,
  sidebarToggleRequestTick = 0,
  sidebarToggleRequestSource = "keyboard_shortcut",
  navigationCommandRequest = null,
  panelTabCycleRequest = null,
  panelTabCloseRequest = null,
  threadRenameRequest = null,
  onNavigationStateChange,
  commandKeymapState,
}: WorkbenchShellProps) {
  const fallbackProjectId = projects[0]?.id ?? "default";
  const [activeProjectId, setActiveProjectId] = useState(dbProjectId || fallbackProjectId);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialActiveProjectSessionId);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, ProjectSession[]>>({});
  const [projectlessSessions, setProjectlessSessions] = useState<ProjectSession[]>([]);
  const [expandedProjectIds, setExpandedProjectIds] = useState(() =>
    readInitialExpandedProjects(projects, dbProjectId || fallbackProjectId),
  );
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [contextMenuSessionId, setContextMenuSessionId] = useState<string | null>(null);
  const [renameSession, setRenameSession] = useState<ProjectSession | null>(null);
  const [renamingSession, setRenamingSession] = useState(false);
  const [previewTabsByPanel, setPreviewTabsByPanel] = useState<Record<string, ProjectSessionPreviewTab>>({});
  const [sideChatTabsBySession, setSideChatTabsBySession] = useState<Record<string, SideChatPanelTab[]>>({});
  const [sideChatActiveTabByPanel, setSideChatActiveTabByPanel] = useState<Record<string, string>>({});
  const [mcpAppTabsBySession, setMcpAppTabsBySession] = useState<Record<string, McpAppPanelTab[]>>({});
  const [mcpAppActiveTabByPanel, setMcpAppActiveTabByPanel] = useState<Record<string, string>>({});
  const [planTabsBySession, setPlanTabsBySession] = useState<Record<string, PlanPanelTab[]>>({});
  const [planActiveTabByPanel, setPlanActiveTabByPanel] = useState<Record<string, string>>({});
  const [activePlanKeyBySession, setActivePlanKeyBySession] = useState<Record<string, string>>({});
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
  const terminalSessionVersion = useTerminalSessionStoreVersion();
  const [threadSummaryPanelPinnedOpen, setThreadSummaryPanelPinnedOpen] = useState(readThreadSummaryPanelPinnedOpen);
  const [threadSummaryPanelPopoverOpen, setThreadSummaryPanelPopoverOpen] = useState(false);
  const [localSidebarCollapsed, setLocalSidebarCollapsed] = useState(false);
  const [localSidebarWidth, setLocalSidebarWidth] = useState(CODEX_SIDEBAR_WIDTH_DEFAULT_PX);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteOpenRequest, setCommandPaletteOpenRequest] = useState({
    tick: 0,
    mode: "root" as CommandMenuMode,
    initialQuery: "",
  });
  const [floatingSidebarVisible, setFloatingSidebarVisible] = useState(false);
  const [floatingSidebarResizing, setFloatingSidebarResizing] = useState(false);
  const [sidebarHoverSuppressed, setSidebarHoverSuppressed] = useState(false);
  const [sidebarTriggerHovered, setSidebarTriggerHovered] = useState(false);
  const [sidebarClickInFlight, setSidebarClickInFlight] = useState(false);
  const [sidebarAnimateLayout, setSidebarAnimateLayout] = useState(true);
  const [floatingSidebarFocusActive, setFloatingSidebarFocusActive] = useState(false);
  const [pinnedProjectsSectionCollapsed, setPinnedProjectsSectionCollapsed] = useState(false);
  const [projectsSectionCollapsed, setProjectsSectionCollapsed] = useState(false);
  const [sidebarDragWidth, setSidebarDragWidth] = useState<number | null>(null);
  const [shellNavigationHistory, setShellNavigationHistory] = useState(readWorkbenchShellNavigationHistoryState);
  const [sessionContentElement, setSessionContentElement] = useState<HTMLDivElement | null>(null);
  const workbenchRootRef = useRef<HTMLDivElement | null>(null);
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
  const lastHandledThreadRenameRequestTickRef = useRef(threadRenameRequest?.tick ?? 0);
  const lastHandledCommandPaletteOpenTickRef = useRef(commandPaletteOpenTick);
  const currentShellNavigationSnapshotRef = useRef<WorkbenchShellNavigationSnapshot | null>(null);
  const focusedPanelGroupRef = useRef<PanelTabCycleScope | null>(null);
  const panelGroupTabsRef = useRef<PanelGroupTabsByPanel>({
    right: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
    bottom: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
  });
  const panelTabMruByLeafRef = useRef<Record<string, string[]>>({});
  const applyingShellNavigationRef = useRef(false);
  const shellAtMediumWidthRef = useRef(false);
  const shellAtNarrowWidthRef = useRef(false);
  const sidebarCollapsed = sidebar?.collapsed ?? localSidebarCollapsed;
  const persistedSidebarWidth = sidebar?.width ?? localSidebarWidth;
  const sidebarWidth = sidebarDragWidth ?? persistedSidebarWidth;
  const sidebarPinnedOrganizationMode = normalizeSidebarPinnedOrganizationMode(
    sidebar?.pinnedOrganizationMode ?? DEFAULT_SIDEBAR_PINNED_ORGANIZATION_MODE,
  );
  const lastHandledSettingsToggleTickRef = useRef(settingsToggleTick);
  const lastHandledKeyboardShortcutsSettingsOpenTickRef = useRef(keyboardShortcutsSettingsOpenTick);
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
  const selectedActiveSession = activeSessions.find((session) => session.id === activeSessionId)
    ?? projectlessSessions.find((session) => session.id === activeSessionId)
    ?? null;
  const activeSession = selectedActiveSession ?? activeSessions[0] ?? null;
  const refreshProjectSessionsRef = useRef<((projectId: string | null) => Promise<ProjectSession[]>) | null>(null);
  const pendingSidebarSessionScopesRef = useRef<{
    projectIds: Set<string>;
    projectless: boolean;
  }>({
    projectIds: new Set(),
    projectless: false,
  });
  const refreshSidebarSessionScopes = useCallback((
    refreshProjectSessionsForId: (projectId: string | null) => Promise<ProjectSession[]>,
    projectIds: readonly string[],
    projectless: boolean,
  ) => {
    const uniqueProjectIds = [...new Set(projectIds)];
    if (uniqueProjectIds.length === 0 && !projectless) return;

    const refreshes = uniqueProjectIds.map((projectId) => refreshProjectSessionsForId(projectId));
    if (projectless) refreshes.push(refreshProjectSessionsForId(null));
    void Promise.all(refreshes).catch(() => undefined);
  }, []);
  const drainPendingSidebarSessionScopes = useCallback((
    refreshProjectSessionsForId: (projectId: string | null) => Promise<ProjectSession[]>,
  ) => {
    const pending = pendingSidebarSessionScopesRef.current;
    if (pending.projectIds.size === 0 && !pending.projectless) return;

    const projectIds = [...pending.projectIds];
    const projectless = pending.projectless;
    pendingSidebarSessionScopesRef.current = {
      projectIds: new Set(),
      projectless: false,
    };
    refreshSidebarSessionScopes(refreshProjectSessionsForId, projectIds, projectless);
  }, [refreshSidebarSessionScopes]);
  const handleSidebarSessionsAffected = useCallback((result: CodexSidebarSyncResult) => {
    const refreshProjectSessionsForId = refreshProjectSessionsRef.current;
    const affectedProjectIds = [...new Set(result.changedProjectIds)];
    if (affectedProjectIds.length === 0 && !result.projectlessChanged) return;

    if (!refreshProjectSessionsForId) {
      const pending = pendingSidebarSessionScopesRef.current;
      for (const projectId of affectedProjectIds) pending.projectIds.add(projectId);
      pending.projectless ||= result.projectlessChanged;
      return;
    }

    refreshSidebarSessionScopes(refreshProjectSessionsForId, affectedProjectIds, result.projectlessChanged);
  }, [refreshSidebarSessionScopes]);
  const sidebarThreadSync = useSidebarThreadSyncModel({
    projects,
    onSessionsAffected: handleSidebarSessionsAffected,
  });
  const refreshSidebarThreadSnapshot = sidebarThreadSync.refresh;
  const [sidebarArchiveSuppressedKeys, setSidebarArchiveSuppressedKeys] = useState<Set<string>>(() => new Set());
  const knownSessions = useMemo(
    () => [...Object.values(sessionsByProject).flat(), ...projectlessSessions],
    [projectlessSessions, sessionsByProject],
  );
  useEffect(() => {
    setSidebarArchiveSuppressedKeys((current) => {
      if (current.size === 0) return current;

      const liveKeys = new Set(sidebarThreadSync.model.threadItemsByKey.keys());
      for (const session of knownSessions) {
        if (!session.archived) {
          liveKeys.add(`local:session:${session.id}`);
        }
      }

      const next = new Set([...current].filter((key) => liveKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [knownSessions, sidebarThreadSync.model.threadItemsByKey]);
  const workbenchCodexControl = useCodexAppServerControl(activeProject?.id ?? activeProjectId);
  const activeProjectKanban = useKanban({
    projectId: activeProject?.id ?? activeProjectId,
    sessionId: activeSession ? `${activeSession.id}:right-panel-actions` : "right-panel-actions",
  });
  const [cardStageHistoryModal, setCardStageHistoryModal] = useState<CardStageHistoryModalContext | null>(null);
  const [openPanelNewTabMenuKey, setOpenPanelNewTabMenuKey] = useState<string | null>(null);
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
  const activeSessionPlanTabs = activeSession ? planTabsBySession[activeSession.id] ?? [] : [];
  const rightPlanTabs = activeSessionPlanTabs.filter((tab) => tab.panelId === "right");
  const rightRenderableTabs: ProjectSessionRenderableTab[] = rightPreviewTab
    ? [...rightPanelTabs, ...rightSideChatTabs, ...rightMcpAppTabs, ...rightPlanTabs, rightPreviewTab]
    : [...rightPanelTabs, ...rightSideChatTabs, ...rightMcpAppTabs, ...rightPlanTabs];
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
  const rightPlanActiveTabId = activeSession
    ? planActiveTabByPanel[makePlanPanelKey(activeSession.id, "right", rightActiveLeafId)]
      ?? planActiveTabByPanel[makePlanPanelKey(activeSession.id, "right")]
      ?? null
    : null;
  const bottomMcpAppActiveTabId = activeSession
    ? mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, "bottom", bottomActiveLeafId)]
      ?? mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, "bottom")]
      ?? null
    : null;
  const rightActiveTabId = rightPreviewTab?.id
    ?? (rightPlanActiveTabId && rightRenderableTabs.some((tab) => tab.id === rightPlanActiveTabId)
      ? rightPlanActiveTabId
      : null)
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
  const threadPlanSidePanelState = useMemo<ThreadPlanSidePanelState | null>(() => {
    if (!activeSession) return null;
    return {
      rightPanelEnabled: activeSession.projectId !== null,
      activePlanKey: activePlanKeyBySession[activeSession.id] ?? null,
      activeRightPanelTabId: sidePanelOpen ? rightActiveTabId : null,
    };
  }, [activePlanKeyBySession, activeSession, rightActiveTabId, sidePanelOpen]);
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
    activeSession && sidePanelOpen && (rightPanel?.size.fullWidth ?? false),
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
    ? Math.max(rightPanelSizingWidth, regularRightPanelWidth)
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
      mode: commandPaletteInitialMode,
      initialQuery: commandPaletteInitialQuery,
    }));
    setCommandPaletteOpen(true);
  }, [commandPaletteInitialMode, commandPaletteInitialQuery, commandPaletteOpenTick]);

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

  const openKeyboardShortcutsSettings = useCallback(() => {
    setSettingsPath(buildSettingsPath("keyboard-shortcuts"));
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
    if (
      typeof keyboardShortcutsSettingsOpenTick !== "number"
      || keyboardShortcutsSettingsOpenTick <= 0
      || keyboardShortcutsSettingsOpenTick === lastHandledKeyboardShortcutsSettingsOpenTickRef.current
    ) {
      return;
    }

    lastHandledKeyboardShortcutsSettingsOpenTickRef.current = keyboardShortcutsSettingsOpenTick;
    setSettingsPath(buildSettingsPath("keyboard-shortcuts"));
  }, [keyboardShortcutsSettingsOpenTick]);

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

  const refreshProjectSessions = useCallback(async (projectId: string | null) => {
    const sessions = (await invoke("project-sessions:list", projectId)) as ProjectSession[];
    if (projectId === null) {
      setProjectlessSessions(sessions);
      return sessions;
    }
    setSessionsByProject((current) => ({ ...current, [projectId]: sessions }));
    return sessions;
  }, []);

  useEffect(() => {
    refreshProjectSessionsRef.current = refreshProjectSessions;
    drainPendingSidebarSessionScopes(refreshProjectSessions);
    return () => {
      if (refreshProjectSessionsRef.current === refreshProjectSessions) {
        refreshProjectSessionsRef.current = null;
      }
    };
  }, [drainPendingSidebarSessionScopes, refreshProjectSessions]);

  const mergeSessionInState = useCallback((session: ProjectSession) => {
    if (session.projectId === null) {
      setProjectlessSessions((current) => sortProjectSessionsForSidebar(
        current.some((candidate) => candidate.id === session.id)
          ? current.map((candidate) => candidate.id === session.id ? session : candidate)
          : [...current, session],
      ));
      return;
    }
    const projectId = session.projectId;

    setSessionsByProject((current) => {
      const sessions = current[projectId];
      if (!sessions) return current;
      return {
        ...current,
        [projectId]: sortProjectSessionsForSidebar(
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

  const refreshAllSessions = useCallback(async () => {
    if (projects.length === 0) return;
    setLoadingSessions(true);
    setSessionError(null);
    try {
      const entries = await Promise.all(
        projects.map(async (project) => [project.id, await refreshProjectSessions(project.id)] as const),
      );
      setSessionsByProject(Object.fromEntries(entries));
      await refreshProjectSessions(null);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Unable to load project sessions");
    } finally {
      setLoadingSessions(false);
    }
  }, [projects, refreshProjectSessions]);

  useEffect(() => {
    void refreshAllSessions();
  }, [refreshAllSessions]);

  const measureSessionContent = useEffectEvent(() => {
    if (!sessionContentElement) {
      setSessionContentWidth((current) => current === 0 ? current : 0);
      setSessionContentHeight((current) => current === 0 ? current : 0);
      return;
    }

    const rect = sessionContentElement.getBoundingClientRect();
    setSessionContentWidth((current) => current === rect.width ? current : rect.width);
    setSessionContentHeight((current) => current === rect.height ? current : rect.height);
  });

  const setSessionContentRef = useCallback((node: HTMLDivElement | null) => {
    setSessionContentElement(node);
  }, []);

  useLayoutEffect(() => {
    measureSessionContent();

    if (!sessionContentElement) return undefined;

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureSessionContent);
      return () => {
        window.removeEventListener("resize", measureSessionContent);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      measureSessionContent();
    });
    resizeObserver.observe(sessionContentElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [activeSession?.id, measureSessionContent, sessionContentElement]);

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
      && (activeSession.projectId === activeProject.id || activeSession.projectId === null)
      && activeSession.id === activeSessionId
    ) {
      return;
    }
    const fallbackSession = activeSessions[0] ?? null;
    startTransition(() => {
      setActiveSessionId(fallbackSession?.id ?? null);
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
    const fallbackSession = sessions[0] ?? null;
    recordShellNavigation(buildSnapshotForSession(fallbackSession, projectId));
    startTransition(() => {
      setActiveProjectId(projectId);
      setDbProject(projectId);
      setActiveSessionId(fallbackSession?.id ?? null);
      setExpandedProjectIds((current) => new Set([...current, projectId]));
    });
  }, [buildSnapshotForSession, recordShellNavigation, sessionsByProject, setDbProject]);

  const selectSession = useCallback((session: ProjectSession) => {
    recordShellNavigation(buildSnapshotForSession(session, session.projectId ?? activeProjectId));
    startTransition(() => {
      setActiveSessionId(session.id);
      if (session.projectId !== null) {
        const projectId = session.projectId;
        setActiveProjectId(projectId);
        setDbProject(projectId);
        setExpandedProjectIds((current) => new Set([...current, projectId]));
      }
    });
    if (session.unread) {
      void invoke("project-sessions:mark-unread", session.id, { unread: false })
        .then((updated) => {
          if (!updated) return;
          mergeSessionInState(updated as ProjectSession);
        })
        .catch(() => undefined);
    }
  }, [activeProjectId, buildSnapshotForSession, mergeSessionInState, recordShellNavigation, setDbProject]);

  useEffect(() => {
    if (!pendingSessionOpen) return;
    if (pendingSessionOpen.projectId === null) {
      const targetSession = projectlessSessions.find((session) => session.id === pendingSessionOpen.sessionId);
      if (!targetSession) return;
      selectSession(targetSession);
      return;
    }
    if (pendingSessionOpen.projectId !== activeProject?.id) return;
    const targetSession = activeSessions.find((session) => session.id === pendingSessionOpen.sessionId);
    if (!targetSession) return;
    selectSession(targetSession);
  }, [activeProject?.id, activeSessions, pendingSessionOpen, projectlessSessions, selectSession]);

  const toggleSessionPin = useCallback(async (session: ProjectSession) => {
    if (session.thread) {
      const nextPinned = !session.pinned;
      try {
        await sidebarThreadSync.setPinned(session.thread.threadId, nextPinned);
        const updatedSessions = await refreshProjectSessions(session.projectId);
        const updatedSession = updatedSessions.find((candidate) => candidate.id === session.id);
        if (updatedSession) mergeSessionInState(updatedSession);
      } catch {
        toast.danger(nextPinned ? "Failed to pin chat" : "Failed to unpin chat");
      }
      return;
    }

    if (session.projectId === null) return;
    const projectId = session.projectId;
    const previousSessions = sessionsByProject[projectId] ?? [];
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
      [projectId]: sortProjectSessionsForSidebar(
        (current[projectId] ?? previousSessions)
          .map((candidate) => candidate.id === session.id ? optimisticSession : candidate),
      ),
    }));

    try {
      const updated = await invoke("project-sessions:set-pinned", session.id, { pinned: nextPinned }) as ProjectSession | null;
      if (updated) mergeSessionInState(updated);
      await refreshProjectSessions(projectId);
    } catch {
      setSessionsByProject((current) => ({ ...current, [projectId]: previousSessions }));
      toast.danger(nextPinned ? "Failed to pin chat" : "Failed to unpin chat");
    }
  }, [mergeSessionInState, refreshProjectSessions, sessionsByProject, sidebarThreadSync]);

  const toggleSidebarThreadPinned = useCallback(async (item: CodexSidebarThreadItem) => {
    if (item.disabled) return;
    const nextPinned = !item.pinned;
    try {
      await sidebarThreadSync.setPinned(item.threadId, nextPinned);
      const session = item.sessionId
        ? knownSessions.find((candidate) => candidate.id === item.sessionId) ?? null
        : null;
      if (session) {
        const refreshed = await refreshProjectSessions(session.projectId);
        const updatedSession = refreshed.find((candidate) => candidate.id === session.id);
        if (updatedSession) mergeSessionInState(updatedSession);
      }
    } catch {
      toast.danger(nextPinned ? "Failed to pin chat" : "Failed to unpin chat");
    }
  }, [knownSessions, mergeSessionInState, refreshProjectSessions, sidebarThreadSync]);

  const selectSidebarThread = useCallback(async (item: CodexSidebarThreadItem) => {
    if (item.disabled) return;
    const existingSession = item.sessionId
      ? knownSessions.find((candidate) => candidate.id === item.sessionId) ?? null
      : knownSessions.find((candidate) => candidate.thread?.threadId === item.threadId) ?? null;
    if (existingSession) {
      selectSession(existingSession);
      return;
    }

    try {
      const ensured = await invoke("codex:thread:ensure-session", item.threadId) as ProjectSession | null;
      if (!ensured) {
        toast.info("That chat is not available", {
          id: `thread-open-unavailable-${item.threadId}`,
        });
        return;
      }
      mergeSessionInState(ensured);
      await refreshProjectSessions(ensured.projectId);
      selectSession(ensured);
    } catch {
      toast.danger("Failed to open chat");
    }
  }, [knownSessions, mergeSessionInState, refreshProjectSessions, selectSession]);

  const openRenameSessionDialog = useCallback((session: ProjectSession) => {
    setRenameSession(session);
  }, []);

  const handleSessionTitleDoubleClick = useCallback((
    session: ProjectSession,
    event: ReactMouseEvent<HTMLElement>,
  ) => {
    if (event.defaultPrevented) return;
    if (activeSessionId !== session.id) return;
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest("[data-thread-title]")) return;

    const pointerCancelEvent = typeof PointerEvent === "function"
      ? new PointerEvent("pointercancel", { bubbles: true, cancelable: true })
      : new Event("pointercancel", { bubbles: true, cancelable: true });
    event.currentTarget.dispatchEvent(pointerCancelEvent);
    openRenameSessionDialog(session);
  }, [activeSessionId, openRenameSessionDialog]);

  const archiveSession = useCallback(async (
    session: ProjectSession,
    options: { showToast?: boolean } = {},
  ) => {
    try {
      await invoke("project-sessions:archive", session.id);
      const sessions = await refreshProjectSessions(session.projectId);
      await refreshSidebarThreadSnapshot();
      if (activeSessionId === session.id) {
        const fallbackSession = sessions[0]
          ?? (session.projectId === null
            ? activeSessions[0] ?? null
            : null);
        if (fallbackSession) {
          selectSession(fallbackSession);
        } else {
          setActiveSessionId(null);
        }
      }
      return true;
    } catch {
      if (options.showToast !== false) {
        toast.danger("Failed to archive chat");
      }
      return false;
    }
  }, [activeSessionId, activeSessions, refreshProjectSessions, refreshSidebarThreadSnapshot, selectSession]);

  const resolveSidebarArchiveSuppressionKeyForSession = useCallback((session: ProjectSession) => {
    for (const [key, item] of sidebarThreadSync.model.threadItemsByKey) {
      if (item.sessionId === session.id) return key;
      if (session.thread && item.threadId === session.thread.threadId) return key;
    }

    return `local:session:${session.id}`;
  }, [sidebarThreadSync.model.threadItemsByKey]);

  const suppressSidebarArchiveKey = useCallback((key: string) => {
    setSidebarArchiveSuppressedKeys((current) => {
      if (current.has(key)) return current;
      return new Set([...current, key]);
    });
  }, []);

  const releaseSidebarArchiveKey = useCallback((key: string) => {
    setSidebarArchiveSuppressedKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);

  const archiveSessionWithSidebarSuppression = useCallback(async (session: ProjectSession) => {
    const suppressionKey = resolveSidebarArchiveSuppressionKeyForSession(session);
    if (sidebarArchiveSuppressedKeys.has(suppressionKey)) return;

    suppressSidebarArchiveKey(suppressionKey);
    const archived = await archiveSession(session, { showToast: false });

    if (!archived) {
      releaseSidebarArchiveKey(suppressionKey);
      toast.danger("Failed to archive chat");
    }
  }, [
    archiveSession,
    releaseSidebarArchiveKey,
    resolveSidebarArchiveSuppressionKeyForSession,
    sidebarArchiveSuppressedKeys,
    suppressSidebarArchiveKey,
  ]);

  const archiveSidebarThreadItem = useCallback(async (item: CodexSidebarThreadItem) => {
    if (item.disabled || sidebarArchiveSuppressedKeys.has(item.key)) return;

    suppressSidebarArchiveKey(item.key);
    const session = item.sessionId
      ? knownSessions.find((candidate) => candidate.id === item.sessionId) ?? null
      : knownSessions.find((candidate) => candidate.thread?.threadId === item.threadId) ?? null;

    if (session) {
      const archived = await archiveSession(session, { showToast: false });
      if (!archived) {
        releaseSidebarArchiveKey(item.key);
        toast.danger("Failed to archive chat");
      }
      return;
    }

    try {
      await invoke("codex:thread:archive", item.threadId);
      await refreshSidebarThreadSnapshot();
    } catch {
      releaseSidebarArchiveKey(item.key);
      toast.danger("Failed to archive chat");
    }
  }, [
    archiveSession,
    knownSessions,
    refreshSidebarThreadSnapshot,
    releaseSidebarArchiveKey,
    sidebarArchiveSuppressedKeys,
    suppressSidebarArchiveKey,
  ]);

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
      await archiveSessionWithSidebarSuppression(session);
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
    archiveSessionWithSidebarSuppression,
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

  const submitRenameSession = useCallback(async (title: string) => {
    if (!renameSession) return;

    setRenamingSession(true);
    try {
      const updated = await invoke("project-sessions:rename", renameSession.id, { title }) as ProjectSession | null;
      if (!updated) throw new Error("Session was not found");
      mergeSessionInState(updated);
      await refreshProjectSessions(updated.projectId);
      setRenameSession(null);
    } catch {
      toast.danger("Failed to rename chat");
    } finally {
      setRenamingSession(false);
    }
  }, [mergeSessionInState, refreshProjectSessions, renameSession]);

  useEffect(() => {
    if (!threadRenameRequest) return;
    if (threadRenameRequest.tick <= 0) return;
    if (lastHandledThreadRenameRequestTickRef.current === threadRenameRequest.tick) return;
    lastHandledThreadRenameRequestTickRef.current = threadRenameRequest.tick;
    if (!activeSession) return;
    openRenameSessionDialog(activeSession);
  }, [activeSession, openRenameSessionDialog, threadRenameRequest]);

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
    const planCount = (planTabsBySession[activeSession.id] ?? []).filter((tab) => {
      if (tab.id === excludedTabId) return false;
      return tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leafId;
    }).length;
    const previewTab = getRenderablePanelPreviewTab(activeSession, panelId, leafId, previewTabsByPanel);
    const previewCount = previewTab && previewTab.id !== excludedTabId ? 1 : 0;
    return durableCount + sideChatCount + mcpAppCount + planCount + previewCount;
  }, [activeSession, mcpAppTabsBySession, planTabsBySession, previewTabsByPanel, sideChatTabsBySession]);

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

  const resolvePanelTabCloseTarget = useCallback((
    panelId: PanelId,
    tabId: string,
    leafId: string,
  ): string | null => {
    if (!activeSession) return null;
    const panelTabs = panelGroupTabsRef.current[panelId];
    const tabs = panelTabs.itemsByLeafId[leafId] ?? [];
    const activeTabId = panelTabs.activeTabIdsByLeafId[leafId] ?? null;
    return resolvePanelTabCloseReplacement({
      tabs,
      activeTabId,
      closingTabId: tabId,
      mruTabIds: panelTabMruByLeafRef.current[makePanelLeafStateKey(activeSession.id, panelId, leafId)] ?? [],
    });
  }, [activeSession]);

  const activatePanelTabAfterClose = useCallback(async (
    panelId: PanelId,
    tabId: string | null,
    leafId: string,
  ) => {
    if (!activeSession || !tabId) return;
    const previewTab = getRenderablePanelPreviewTab(activeSession, panelId, leafId, previewTabsByPanel);
    if (previewTab?.id === tabId) return;

    if ((sideChatTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, leafId);
      setMcpAppActiveTabByPanel((current) => {
        const keys = [
          makeMcpAppPanelKey(activeSession.id, panelId, leafId),
          makeMcpAppPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
      setSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeSideChatPanelKey(activeSession.id, panelId, leafId)]: tabId,
      }));
      return;
    }

    if ((mcpAppTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
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
      return;
    }

    const planTab = (planTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (planTab) {
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
      setMcpAppActiveTabByPanel((current) => {
        const keys = [
          makeMcpAppPanelKey(activeSession.id, panelId, leafId),
          makeMcpAppPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
      setPlanActiveTabByPanel((current) => ({
        ...current,
        [makePlanPanelKey(activeSession.id, panelId, leafId)]: tabId,
      }));
      setActivePlanKeyBySession((current) => ({
        ...current,
        [activeSession.id]: planTab.planKey,
      }));
      return;
    }

    if (!activeSession.tabs.some((tab) => tab.id === tabId && tab.panelId === panelId)) return;

    setPlanActiveTabByPanel((current) => {
      const keys = [
        makePlanPanelKey(activeSession.id, panelId, leafId),
        makePlanPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    setMcpAppActiveTabByPanel((current) => {
      const keys = [
        makeMcpAppPanelKey(activeSession.id, panelId, leafId),
        makeMcpAppPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
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
    await setActivePanelTab(panelId, tabId, { leafId });
  }, [
    activeSession,
    clearPanelPreviewTab,
    mcpAppTabsBySession,
    planTabsBySession,
    previewTabsByPanel,
    setActivePanelTab,
    sideChatTabsBySession,
  ]);

  const closeTab = useCallback(async (tabId: string, options: {
    preserveEmptyLeafIds?: string[];
    preferredActiveLeafId?: string | null;
    preferredActiveTabId?: string | null;
  } = {}) => {
    if (!activeSession) return;
    const closingTab = activeSession.tabs.find((tab) => tab.id === tabId) ?? null;
    if (closingTab?.kind === "terminal" && "terminalSessionId" in closingTab.config) {
      terminalSessionStore.close(closingTab.config.terminalSessionId);
    }
    const deleteInput = {
      tabId,
      ...(options.preserveEmptyLeafIds && options.preserveEmptyLeafIds.length > 0
        ? { preserveEmptyLeafIds: options.preserveEmptyLeafIds }
        : {}),
      ...(options.preferredActiveLeafId !== undefined
        ? { preferredActiveLeafId: options.preferredActiveLeafId }
        : {}),
      ...(options.preferredActiveTabId !== undefined
        ? { preferredActiveTabId: options.preferredActiveTabId }
        : {}),
    };
    const hasDeleteOptions = Object.keys(deleteInput).length > 1;
    await invoke(
      "project-session-tabs:delete",
      hasDeleteOptions ? deleteInput : tabId,
    );
    await refreshProjectSessions(activeSession.projectId);
  }, [activeSession, refreshProjectSessions]);

  const closeExitedTerminalTab = useEffectEvent(async (terminalSessionId: string) => {
    if (!activeSession) return;
    const tab = activeSession.tabs.find((candidate) =>
      candidate.kind === "terminal"
      && "terminalSessionId" in candidate.config
      && candidate.config.terminalSessionId === terminalSessionId
    );
    if (!tab) return;

    await closeTab(tab.id);
  });

  useEffect(() => {
    terminalSessionStore.ensureEventSubscriptions();
    return terminalSessionStore.subscribeExit((event) => {
      void closeExitedTerminalTab(event.sessionId);
    });
  }, []);

  const closePreviewTab = useCallback(async (
    panelId: PanelId,
    leafId?: string,
    replacementTabId: string | null = null,
  ) => {
    if (!activeSession) return;
    const targetLeafId = leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    const previewTab = previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId, targetLeafId)]
      ?? previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId)]
      ?? null;
    clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
    await activatePanelTabAfterClose(panelId, replacementTabId, targetLeafId);
    if (previewTab && getPanelVisibleLeafTabCount(panelId, targetLeafId, { excludingTabId: previewTab.id }) === 0) {
      await removeEmptyVisiblePanelLeaf(panelId, targetLeafId, { excludingTabId: previewTab.id });
    }
    if (getPanelVisibleTabCount(panelId, { excludingTabId: previewTab?.id }) > 0) return;
    await updateActivePanel(panelId, { collapsed: true });
  }, [
    activeSession,
    activatePanelTabAfterClose,
    clearPanelPreviewTab,
    getPanelVisibleLeafTabCount,
    getPanelVisibleTabCount,
    previewTabsByPanel,
    removeEmptyVisiblePanelLeaf,
    updateActivePanel,
  ]);

  const closeSideChatPanelTab = useCallback(async (
    panelId: PanelId,
    tabId: string,
    replacementTabId: string | null = null,
  ) => {
    if (!activeSession) return;
    const sideChatTab = (sideChatTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (!sideChatTab) return;
    const targetLeafId = sideChatTab.leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);

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
    await activatePanelTabAfterClose(panelId, replacementTabId, targetLeafId);
    if (getPanelVisibleLeafTabCount(panelId, targetLeafId, { excludingTabId: tabId }) === 0) {
      await removeEmptyVisiblePanelLeaf(panelId, targetLeafId, { excludingTabId: tabId });
    }
    if (getPanelVisibleTabCount(panelId, { excludingTabId: tabId }) > 0) return;
    await updateActivePanel(panelId, { collapsed: true });
  }, [
    activeSession,
    activatePanelTabAfterClose,
    getPanelVisibleLeafTabCount,
    getPanelVisibleTabCount,
    removeEmptyVisiblePanelLeaf,
    sideChatTabsBySession,
    updateActivePanel,
    workbenchCodexControl,
  ]);

  const closeMcpAppPanelTab = useCallback(async (
    panelId: PanelId,
    tabId: string,
    replacementTabId: string | null = null,
  ) => {
    if (!activeSession) return;
    const mcpAppTab = (mcpAppTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (!mcpAppTab) return;
    const targetLeafId = mcpAppTab.leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);

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

    await activatePanelTabAfterClose(panelId, replacementTabId, targetLeafId);
    if (getPanelVisibleLeafTabCount(panelId, targetLeafId, { excludingTabId: tabId }) === 0) {
      await removeEmptyVisiblePanelLeaf(panelId, targetLeafId, { excludingTabId: tabId });
    }
    if (getPanelVisibleTabCount(panelId, { excludingTabId: tabId }) > 0) return;
    await updateActivePanel(panelId, { collapsed: true });
  }, [
    activeSession,
    activatePanelTabAfterClose,
    getPanelVisibleLeafTabCount,
    getPanelVisibleTabCount,
    mcpAppTabsBySession,
    removeEmptyVisiblePanelLeaf,
    updateActivePanel,
  ]);

  const closePlanPanelTab = useCallback(async (
    panelId: PanelId,
    tabId: string,
    replacementTabId: string | null = null,
  ) => {
    if (!activeSession) return;
    const planTab = (planTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (!planTab) return;
    const targetLeafId = planTab.leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);

    setPlanTabsBySession((current) => {
      const tabs = current[activeSession.id] ?? [];
      return {
        ...current,
        [activeSession.id]: tabs.filter((tab) => tab.id !== tabId),
      };
    });
    setPlanActiveTabByPanel((current) => {
      const keys = [
        makePlanPanelKey(activeSession.id, panelId, planTab.leafId),
        makePlanPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => current[key] === tabId)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    setActivePlanKeyBySession((current) => {
      if (current[activeSession.id] !== planTab.planKey) return current;
      const next = { ...current };
      delete next[activeSession.id];
      return next;
    });

    await activatePanelTabAfterClose(panelId, replacementTabId, targetLeafId);
    if (getPanelVisibleLeafTabCount(panelId, targetLeafId, { excludingTabId: tabId }) === 0) {
      await removeEmptyVisiblePanelLeaf(panelId, targetLeafId, { excludingTabId: tabId });
    }
    if (getPanelVisibleTabCount(panelId, { excludingTabId: tabId }) > 0) return;
    await updateActivePanel(panelId, { collapsed: true });
  }, [
    activeSession,
    activatePanelTabAfterClose,
    getPanelVisibleLeafTabCount,
    getPanelVisibleTabCount,
    planTabsBySession,
    removeEmptyVisiblePanelLeaf,
    updateActivePanel,
  ]);

  const closePanelTab = useCallback(async (
    panelId: PanelId,
    tabId: string,
    leafId?: string,
  ) => {
    if (!activeSession) return;
    const targetLeafId = leafId ?? resolveLeafIdForPanelTab(activeSession, panelId, tabId);
    const replacementTabId = resolvePanelTabCloseTarget(panelId, tabId, targetLeafId);
    const previewTab = getRenderablePanelPreviewTab(activeSession, panelId, targetLeafId, previewTabsByPanel);
    if (previewTab?.id === tabId) {
      await closePreviewTab(panelId, targetLeafId, replacementTabId);
      return;
    }
    if ((sideChatTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      await closeSideChatPanelTab(panelId, tabId, replacementTabId);
      return;
    }
    if ((mcpAppTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      await closeMcpAppPanelTab(panelId, tabId, replacementTabId);
      return;
    }
    if ((planTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      await closePlanPanelTab(panelId, tabId, replacementTabId);
      return;
    }

    const preserveEmptyLeafIds = getPreserveEmptyLeafIdsAfterDurableRemoval(panelId, targetLeafId, tabId);
    const durableReplacementTabId = replacementTabId && activeSession.tabs.some((tab) =>
      tab.id === replacementTabId && tab.panelId === panelId
    )
      ? replacementTabId
      : null;
    await closeTab(tabId, {
      preserveEmptyLeafIds,
      preferredActiveLeafId: durableReplacementTabId ? targetLeafId : undefined,
      preferredActiveTabId: durableReplacementTabId ?? undefined,
    });
    if (!durableReplacementTabId) {
      await activatePanelTabAfterClose(panelId, replacementTabId, targetLeafId);
    }
    if (preserveEmptyLeafIds.length > 0) {
      await updateActivePanel(panelId, { collapsed: false });
    }
  }, [
    activeSession,
    activatePanelTabAfterClose,
    closePreviewTab,
    closeMcpAppPanelTab,
    closePlanPanelTab,
    closeSideChatPanelTab,
    closeTab,
    getPreserveEmptyLeafIdsAfterDurableRemoval,
    mcpAppTabsBySession,
    planTabsBySession,
    previewTabsByPanel,
    resolvePanelTabCloseTarget,
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
      setPlanActiveTabByPanel((current) => {
        const keys = [
          makePlanPanelKey(activeSession.id, panelId, targetLeafId),
          makePlanPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
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
      setPlanActiveTabByPanel((current) => {
        const keys = [
          makePlanPanelKey(activeSession.id, panelId, targetLeafId),
          makePlanPanelKey(activeSession.id, panelId),
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
      setMcpAppActiveTabByPanel((current) => ({
        ...current,
        [makeMcpAppPanelKey(activeSession.id, panelId, targetLeafId)]: tabId,
      }));
      return;
    }

    const planTab = (planTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (planTab) {
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
      setPlanActiveTabByPanel((current) => ({
        ...current,
        [makePlanPanelKey(activeSession.id, panelId, targetLeafId)]: tabId,
      }));
      setActivePlanKeyBySession((current) => ({
        ...current,
        [activeSession.id]: planTab.planKey,
      }));
      return;
    }

    setPlanActiveTabByPanel((current) => {
      const keys = [
        makePlanPanelKey(activeSession.id, panelId, targetLeafId),
        makePlanPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
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
  }, [
    activeSession,
    clearPanelPreviewTab,
    mcpAppTabsBySession,
    planTabsBySession,
    previewTabsByPanel,
    setActivePanelTab,
    sideChatTabsBySession,
  ]);

  const closePlanSidePanel = useCallback<NonNullable<ThreadStageActions["onClosePlanSidePanel"]>>(async (input) => {
    if (!activeSession) return;
    const planTab = (planTabsBySession[activeSession.id] ?? []).find((tab) =>
      tab.id === "plan" && tab.planKey === input.planKey
    );
    if (!planTab) return;
    const panelId: PanelId = "right";
    const targetLeafId = planTab.leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);

    setPlanTabsBySession((current) => {
      const tabs = current[activeSession.id] ?? [];
      return {
        ...current,
        [activeSession.id]: tabs.filter((tab) => tab.id !== planTab.id),
      };
    });
    setPlanActiveTabByPanel((current) => {
      const keys = [
        makePlanPanelKey(activeSession.id, panelId, planTab.leafId),
        makePlanPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => current[key] === planTab.id)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    setActivePlanKeyBySession((current) => {
      if (current[activeSession.id] !== planTab.planKey) return current;
      const next = { ...current };
      delete next[activeSession.id];
      return next;
    });

    if (getPanelVisibleLeafTabCount(panelId, targetLeafId, { excludingTabId: planTab.id }) === 0) {
      await removeEmptyVisiblePanelLeaf(panelId, targetLeafId, { excludingTabId: planTab.id });
    }
    if (getPanelVisibleTabCount(panelId, { excludingTabId: planTab.id }) > 0) return;
    await updateActivePanel(panelId, { collapsed: true });
  }, [
    activeSession,
    getPanelVisibleLeafTabCount,
    getPanelVisibleTabCount,
    planTabsBySession,
    removeEmptyVisiblePanelLeaf,
    updateActivePanel,
  ]);

  const pinPreviewTab = useCallback(async (panelId: PanelId, tabId: string, leafId?: string) => {
    if (!activeSession) return;
    const projectId = activeSession.projectId;
    if (projectId === null) return;
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
        projectId,
        panelId,
        targetLeafId,
        ...(previewTab.kind === "card_stage" ? { clientTabId: previewTab.id } : {}),
        kind: previewTab.kind,
        title: previewTab.title,
        config: previewTab.config,
      };
      await invoke("project-session-tabs:create", createInput);
      if (previewTab.kind === "card_stage") {
        await refreshProjectSessions(projectId);
        clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
        return;
      }
      clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
      await refreshProjectSessions(projectId);
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
    input: ThreadOpenSideChatInput & {
      targetPanelId?: PanelId;
      targetLeafId?: string;
      collaborationMode?: CodexCollaborationModeKind;
    } = {},
  ) => {
    if (!activeSession?.thread || activeSession.projectId === null) {
      toast.danger("Failed to open side chat", { id: "side-chat-open-failed" });
      return;
    }
    const projectId = activeSession.projectId;

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
      projectId,
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
    setPlanActiveTabByPanel((current) => {
      const keys = [
        makePlanPanelKey(activeSession.id, panelId, leafId),
        makePlanPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    clearPanelPreviewTab(activeSession.id, panelId, leafId);
    await ensureActivePanelOpenWithoutRefresh(panelId);

    try {
      const draftPrompt = input.kind === "draft" ? input.draftPrompt.trim() : "";
      const result = await workbenchCodexControl.startSideChat({
        projectId,
        parentThreadId,
        parentNavigationPath,
        ...(input.kind === "draft" ? {} : {
          prompt: input.prompt,
          promptInput: input.promptInput,
        }),
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
      if (draftPrompt.length > 0) {
        workbenchCodexControl.setComposerIntent(result.threadId, {
          prompt: draftPrompt,
          focusNonce: Date.now(),
        });
      }
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
    if (!activeSession || activeSession.projectId === null) return;
    const projectId = activeSession.projectId;

    const panelId: PanelId = "right";
    const leafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const tabId = `mcp-app:${input.mcpAppId}`;
    const tab: McpAppPanelTab = {
      mcpApp: true,
      id: tabId,
      sessionId: activeSession.id,
      projectId,
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
    setPlanActiveTabByPanel((current) => {
      const keys = [
        makePlanPanelKey(activeSession.id, panelId, leafId),
        makePlanPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
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

  const openPlanSidePanel = useCallback(async (input: ThreadPlanSidePanelTarget) => {
    if (!activeSession || activeSession.projectId === null) return;
    const projectId = activeSession.projectId;
    const panelId: PanelId = "right";
    const leafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const tabId = "plan";
    const tab: PlanPanelTab = {
      planPanel: true,
      id: tabId,
      sessionId: activeSession.id,
      projectId,
      panelId,
      leafId,
      title: "Plan",
      stateKey: Date.now(),
      planKey: input.planKey,
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: input.itemId,
      content: input.content,
      cwd: input.cwd,
      hideCodeBlocks: input.hideCodeBlocks,
    };

    setPlanTabsBySession((current) => {
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
    setMcpAppActiveTabByPanel((current) => {
      const keys = [
        makeMcpAppPanelKey(activeSession.id, panelId, leafId),
        makeMcpAppPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    setPlanActiveTabByPanel((current) => ({
      ...current,
      [makePlanPanelKey(activeSession.id, panelId, leafId)]: tabId,
    }));
    setActivePlanKeyBySession((current) => ({
      ...current,
      [activeSession.id]: input.planKey,
    }));
    setPanelCollapsedOverrides((current) => ({
      ...current,
      [makePanelPreviewKey(activeSession.id, panelId)]: false,
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
    const sessionProjectId = activeSession.projectId;
    if (sessionProjectId === null) return;
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
    await refreshProjectSessions(sessionProjectId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh, refreshProjectSessions]);

  const openWorkspaceFileTab = useCallback(async (input: {
    path: string;
    title: string;
    panelId: PanelId;
  }) => {
    if (!activeSession) return;
    const sessionProjectId = activeSession.projectId;
    if (sessionProjectId === null) return;
    const project = projects.find((candidate) => candidate.id === sessionProjectId) ?? null;
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
    await refreshProjectSessions(sessionProjectId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh, projects, refreshProjectSessions, setActivePanelTab]);

  const openCardTab = useCallback<OpenCardTabHandler>(async (projectId, cardId, titleSnapshot, options) => {
    if (!activeSession || activeSession.projectId === null) {
      openCardStage(projectId, cardId, titleSnapshot, options);
      return;
    }
    const sessionProjectId = activeSession.projectId;

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

    const sourceLeafId = resolveDbCardSourceLeafId(activeSession, options?.sourceTabId);
    let targetLeafId = resolveCardTabTargetLeafId(activeSession, options?.sourceTabId);
    if (!targetLeafId && shouldEnsureRightLeafForDbCardOpen(activeSession, sourceLeafId, rightPanelFullWidth)) {
      const result = (await invoke("project-session-panels:ensure-right-leaf", {
        sessionId: activeSession.id,
        panelId: "right",
        sourceLeafId,
      })) as ProjectSessionPanelEnsureRightLeafResult | null;
      targetLeafId = result?.leafId;
    }
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
      await refreshProjectSessions(sessionProjectId);
      return;
    }

    await invoke("project-session-tabs:create", {
      sessionId: activeSession.id,
      projectId: sessionProjectId,
      panelId: "right",
      ...(targetLeafId ? { targetLeafId } : {}),
      kind: "card_stage",
      title: titleSnapshot || cardId,
      config: {
        projectId,
        cardId,
        titleSnapshot,
      },
    });
    await ensureActivePanelOpenWithoutRefresh("right");
    await refreshProjectSessions(sessionProjectId);
  }, [
    activeSession,
    clearPanelPreviewTab,
    ensureActivePanelOpenWithoutRefresh,
    openCardStage,
    pinPreviewTab,
    previewTabsByPanel,
    refreshProjectSessions,
    rightPanelFullWidth,
    setActivePanelTab,
    updateActivePanel,
  ]);

  useEffect(() => {
    if (!pendingCardDeepLinkOpen) return;
    if (pendingCardDeepLinkOpen.projectId !== dbProjectId) return;

    let cancelled = false;
    void (async () => {
      await openCardTab(
        pendingCardDeepLinkOpen.projectId,
        pendingCardDeepLinkOpen.cardId,
        undefined,
        {
          openMode: "durable",
        },
      );
      if (cancelled) return;
      onCardDeepLinkHandled?.(pendingCardDeepLinkOpen);
    })();

    return () => {
      cancelled = true;
    };
  }, [dbProjectId, onCardDeepLinkHandled, openCardTab, pendingCardDeepLinkOpen]);

  const ensureBlankSessionForProject = useCallback(async (
    projectId: string,
    options?: { select?: boolean },
  ) => {
    const sessions = sessionsByProject[projectId] ?? await refreshProjectSessions(projectId);
    const reusableSession = sessions.find((candidate) => !candidate.thread && candidate.tabs.length === 0) ?? null;
    const shouldSelect = options?.select !== false;

    if (reusableSession) {
      if (shouldSelect) selectSession(reusableSession);
      return reusableSession;
    }

    const session = (await invoke("project-sessions:create", {
      projectId,
      noThreadFallbackTitle: "New thread",
    })) as ProjectSession;
    await refreshProjectSessions(projectId);
    if (shouldSelect) selectSession(session);
    return session;
  }, [refreshProjectSessions, selectSession, sessionsByProject]);

  const startNewChatInProject = useCallback(async (projectId: string) => {
    const session = await ensureBlankSessionForProject(projectId);
    await invoke("project-session-panels:update", session.id, "right", {
      size: { ...session.panels.right.size, fullWidth: false },
    });
    await refreshProjectSessions(projectId);
  }, [ensureBlankSessionForProject, refreshProjectSessions]);

  const openSidebarCommandPalette = useCallback(() => {
    setCommandPaletteOpenRequest((current) => ({
      tick: current.tick + 1,
      mode: "cards",
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
    const shortcutState = commandKeymapState ?? createCommandKeymapState({}, isMacPlatformForShortcut ? "macOS" : "windows");

    const onKeyDown = (event: KeyboardEvent) => {
      if (isWorkbenchNewChatShortcutTargetEditable(event.target)) return;

      if (matchesKeyboardEventToCommand(event, shortcutState, "archiveThread")) {
        if (!activeSession) return;
        event.preventDefault();
        void archiveSession(activeSession);
        return;
      }

      if (matchesKeyboardEventToCommand(event, shortcutState, "newThread")) {
        event.preventDefault();
        void startNewChatInProject(activeProjectId);
        return;
      }

      if (matchesKeyboardEventToCommand(event, shortcutState, "openSideChat")) {
        event.preventDefault();
        void openSideChat({ targetPanelId: "right" });
        return;
      }

      if (matchesKeyboardEventToCommand(event, shortcutState, "openThreadInNewWindow")) {
        if (!activeSession) return;
        event.preventDefault();
        void onOpenProjectSessionInNewWindow?.(activeSession);
        return;
      }

      if (matchesKeyboardEventToCommand(event, shortcutState, "quickChat")) {
        event.preventDefault();
        void startNewChatInProject(activeProjectId);
        return;
      }

      if (matchesKeyboardEventToCommand(event, shortcutState, "toggleThreadPin")) {
        if (!activeSession) return;
        event.preventDefault();
        void toggleSessionPin(activeSession);
        return;
      }

      if (matchesKeyboardEventToCommand(event, shortcutState, "focusBrowserAddressBar")) {
        const input = document.querySelector<HTMLInputElement>("[data-browser-sidebar-address-input='true']");
        if (!input) return;
        event.preventDefault();
        input.focus();
        input.select();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    activeProjectId,
    activeSession,
    archiveSession,
    commandKeymapState,
    onOpenProjectSessionInNewWindow,
    openSideChat,
    startNewChatInProject,
    toggleSessionPin,
  ]);

  const createManualTab = useCallback(async (
    kind: ProjectSessionTab["kind"],
    targetPanelId?: PanelId,
    targetLeafId?: string,
  ) => {
    if (!activeSession) return;
    const sessionProjectId = activeSession.projectId;
    if (sessionProjectId === null) return;
    const panelId = targetPanelId ?? getDefaultPanelIdForTabKind(kind);
    const draft = makeProjectSessionTabDraft(activeSession, kind);
    if (!draft) return;

    const createInput: ProjectSessionTabCreateInput = {
      sessionId: activeSession.id,
      projectId: sessionProjectId,
      panelId,
      ...(targetLeafId ? { targetLeafId } : {}),
      ...(draft.kind === "terminal" && "terminalSessionId" in draft.config
        ? { clientTabId: makeClientTerminalTabId(draft.config.terminalSessionId) }
        : {}),
      ...draft,
    };

    await invoke("project-session-tabs:create", createInput);
    await ensureActivePanelOpenWithoutRefresh(panelId);
    await refreshProjectSessions(sessionProjectId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh, refreshProjectSessions]);

  const openAttachedThreadSession = useCallback(async (threadId: string) => {
    const session = knownSessions.find((candidate) => candidate.thread?.threadId === threadId) ?? null;
    if (session) {
      selectSession(session);
      return;
    }

    try {
      const ensured = await invoke("codex:thread:ensure-session", threadId) as ProjectSession | null;
      if (!ensured) {
        toast.info("That chat is not available", {
          id: `thread-open-unattached-${threadId}`,
        });
        return;
      }
      mergeSessionInState(ensured);
      await refreshProjectSessions(ensured.projectId);
      selectSession(ensured);
    } catch {
      toast.danger("Failed to open chat");
    }
  }, [knownSessions, mergeSessionInState, refreshProjectSessions, selectSession]);

  const openTurnDiffReview = useCallback((target: CodexTurnDiffReviewTarget) => {
    setSelectedTurnDiffReviewTarget(target);
    void createManualTab("review", "right");
  }, [createManualTab]);

  const openTurnDiffFileInSidePanel = useCallback<NonNullable<ThreadStageActions["onOpenTurnDiffFileInSidePanel"]>>(async (target) => {
    await openWorkspaceFileTab({
      path: target.path,
      title: target.title,
      panelId: "right",
    });
  }, [openWorkspaceFileTab]);

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
    const sessionProjectId = activeSession.projectId;
    if (sessionProjectId === null) return;
    const panelId = sourceTab.panelId;
    const panelTabs = activeSession.tabs.filter((tab) => tab.panelId === panelId);
    const sourceIndex = panelTabs.findIndex((tab) => tab.id === sourceTab.id);
    const sourceConfig = sourceTab.kind === "browser" && "projectId" in sourceTab.config
      ? sourceTab.config
      : { projectId: sessionProjectId };
    const created = await invoke("project-session-tabs:create", {
      sessionId: activeSession.id,
      projectId: sessionProjectId,
      panelId,
      kind: "browser",
      title: duplicate ? sourceTab.title || "Browser" : "Browser",
      config: duplicate
        ? {
            projectId: sessionProjectId,
            ...("url" in sourceConfig && typeof sourceConfig.url === "string" ? { url: sourceConfig.url } : {}),
            ...("title" in sourceConfig && typeof sourceConfig.title === "string" ? { title: sourceConfig.title } : {}),
            ...("faviconUrl" in sourceConfig && typeof sourceConfig.faviconUrl === "string" ? { faviconUrl: sourceConfig.faviconUrl } : {}),
            ...("deviceToolbarVisible" in sourceConfig && typeof sourceConfig.deviceToolbarVisible === "boolean"
              ? { deviceToolbarVisible: sourceConfig.deviceToolbarVisible }
              : {}),
          }
        : { projectId: sessionProjectId },
    }) as ProjectSessionTab;

    if (sourceIndex >= 0) {
      await invoke("project-session-tabs:move", {
        tabId: created.id,
        targetPanelId: panelId,
        targetIndex: sourceIndex + 1,
      });
    }
    await setActivePanelTab(panelId, created.id, { openPanel: true });
    await refreshProjectSessions(sessionProjectId);
  }, [activeSession, refreshProjectSessions, setActivePanelTab]);

  const reloadBrowserTab = useCallback((tabId: string) => {
    void invoke("browser-sidebar-command", { type: "reload", tabId });
  }, []);

  const focusOrCreateSessionTerminalTab = useCallback(async () => {
    if (!activeSession) return;
    const focusedScope = typeof document === "undefined"
      ? null
      : resolveFocusedPanelTabCycleScope(document.activeElement);
    const targetScope = focusedScope ?? focusedPanelGroupRef.current;
    const targetPanelId = targetScope?.panelId ?? "bottom";
    const targetLeafId = targetScope?.leafId ?? resolveSessionPanelActiveLeafId(activeSession, targetPanelId);
    const targetPanelOpen = targetPanelId === "right" ? sidePanelOpen : bottomPanelOpen;
    const targetLeaf = findProjectSessionPanelLeaf(activeSession.panels[targetPanelId].layout, targetLeafId);
    const activeTabId = targetLeaf?.activeTabId ?? resolveSessionPanelActiveTabId(activeSession, targetPanelId);
    const activeTab = activeTabId
      ? activeSession.tabs.find((tab) => tab.id === activeTabId) ?? null
      : null;

    if (targetPanelOpen && activeTab?.kind === "terminal") {
      await setActivePanelCollapsed(targetPanelId, true);
      return;
    }

    const terminalInTargetLeaf = activeSession.tabs.find((tab) =>
      tab.kind === "terminal"
      && tab.panelId === targetPanelId
      && resolveLeafIdForPanelTab(activeSession, targetPanelId, tab.id) === targetLeafId
    );
    const terminalInTargetPanel = activeSession.tabs.find((tab) =>
      tab.kind === "terminal" && tab.panelId === targetPanelId
    );
    const existing =
      terminalInTargetLeaf
      ?? terminalInTargetPanel
      ?? activeSession.tabs.find((tab) => tab.kind === "terminal" && tab.panelId === "bottom")
      ?? activeSession.tabs.find((tab) => tab.kind === "terminal");

    if (existing) {
      await setActivePanelTab(existing.panelId, existing.id, {
        openPanel: true,
        leafId: resolveLeafIdForPanelTab(activeSession, existing.panelId, existing.id),
      });
      return;
    }

    await createManualTab("terminal", targetPanelId, targetLeafId);
  }, [
    activeSession,
    bottomPanelOpen,
    createManualTab,
    setActivePanelCollapsed,
    setActivePanelTab,
    sidePanelOpen,
  ]);

  const openDbViewFromPanelPicker = useCallback(async (
    projectId: string,
    panelId: PanelId,
    leafId: string,
  ) => {
    if (!activeSession || activeSession.projectId === null) return;
    const sessionProjectId = activeSession.projectId;
    const existing = findDbViewTabForProject(activeSession, projectId);
    if (existing) {
      const existingLeafId = resolveLeafIdForPanelTab(activeSession, existing.panelId, existing.id);
      await setActivePanelTab(existing.panelId, existing.id, {
        leafId: existingLeafId,
        openPanel: true,
      });
      return;
    }

    await invoke("project-session-tabs:create", {
      sessionId: activeSession.id,
      projectId: sessionProjectId,
      panelId,
      targetLeafId: leafId,
      kind: "db_view",
      title: "DB View",
      config: { projectId, view: "kanban" },
    });
    await ensureActivePanelOpenWithoutRefresh(panelId);
    await refreshProjectSessions(sessionProjectId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh, refreshProjectSessions, setActivePanelTab]);

  const openCardStageFromPanelPicker = useCallback(async (
    destination: Extract<PanelDestination, { kind: "card" }>,
    panelId: PanelId,
    leafId: string,
  ) => {
    if (!activeSession || activeSession.projectId === null) {
      openCardStage(destination.projectId, destination.cardId, destination.titleSnapshot);
      return;
    }
    const sessionProjectId = activeSession.projectId;

    const existing = activeSession.tabs.find((tab) =>
      tab.kind === "card_stage"
      && tab.panelId === panelId
      && "cardId" in tab.config
      && tab.config.cardId === destination.cardId
      && tab.config.projectId === destination.projectId,
    );
    if (existing) {
      const existingLeafId = resolveLeafIdForPanelTab(activeSession, panelId, existing.id);
      clearPanelPreviewTab(activeSession.id, panelId, existingLeafId);
      await setActivePanelTab(panelId, existing.id, { leafId: existingLeafId, openPanel: true });
      return;
    }

    const matchingPreviewTab = getRenderablePanelPreviewTab(activeSession, panelId, leafId, previewTabsByPanel);
    if (
      matchingPreviewTab?.kind === "card_stage"
      && "cardId" in matchingPreviewTab.config
      && matchingPreviewTab.config.cardId === destination.cardId
      && matchingPreviewTab.config.projectId === destination.projectId
    ) {
      await pinPreviewTab(panelId, matchingPreviewTab.id, leafId);
      return;
    }

    await invoke("project-session-tabs:create", {
      sessionId: activeSession.id,
      projectId: sessionProjectId,
      panelId,
      targetLeafId: leafId,
      kind: "card_stage",
      title: destination.titleSnapshot || destination.cardId,
      config: {
        projectId: destination.projectId,
        cardId: destination.cardId,
        titleSnapshot: destination.titleSnapshot || destination.cardId,
      },
    });
    await ensureActivePanelOpenWithoutRefresh(panelId);
    await refreshProjectSessions(sessionProjectId);
  }, [
    activeSession,
    clearPanelPreviewTab,
    ensureActivePanelOpenWithoutRefresh,
    openCardStage,
    pinPreviewTab,
    previewTabsByPanel,
    refreshProjectSessions,
    setActivePanelTab,
  ]);

  const openPanelDestinationFromPicker = useCallback(async (
    destination: PanelDestination,
    panelId: PanelId,
    leafId: string,
  ) => {
    await activatePanelGroup(panelId, leafId);
    if (destination.kind === "db") {
      await openDbViewFromPanelPicker(destination.projectId, panelId, leafId);
      return;
    }

    await openCardStageFromPanelPicker(destination, panelId, leafId);
  }, [activatePanelGroup, openCardStageFromPanelPicker, openDbViewFromPanelPicker]);

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
    if (isCodexTerminalShortcutTarget(event.target)) return false;

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
      matchesPanelActionShortcut(event, candidate, isMacPlatform, commandKeymapState),
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
        const planTabs = (planTabsBySession[activeSession.id] ?? []).filter((tab) =>
          tab.panelId === panelId && (tab.leafId ?? panelActiveLeafId) === leaf.id
        );
        const renderableTabs: ProjectSessionRenderableTab[] = [
          ...durableTabs,
          ...sideChatTabs,
          ...mcpAppTabs,
          ...planTabs,
          ...(previewTab ? [previewTab] : []),
        ];
        const sideChatActiveTabId = sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === panelActiveLeafId ? sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const mcpAppActiveTabId = mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === panelActiveLeafId ? mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const planActiveTabId = planActiveTabByPanel[makePlanPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === panelActiveLeafId ? planActiveTabByPanel[makePlanPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const activeTabId = previewTab?.id
          ?? (planActiveTabId && renderableTabs.some((tab) => tab.id === planActiveTabId)
            ? planActiveTabId
            : null)
          ?? (mcpAppActiveTabId && renderableTabs.some((tab) => tab.id === mcpAppActiveTabId)
            ? mcpAppActiveTabId
            : null)
          ?? (sideChatActiveTabId && renderableTabs.some((tab) => tab.id === sideChatActiveTabId)
            ? sideChatActiveTabId
            : leaf.activeTabId)
          ?? renderableTabs[0]?.id
          ?? null;
        const activeTab = activeTabId ? renderableTabs.find((tab) => tab.id === activeTabId) : null;
        if (!activeTab || isSideChatPanelTab(activeTab) || isMcpAppPanelTab(activeTab) || isPlanPanelTab(activeTab)) continue;

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
    planActiveTabByPanel,
    planTabsBySession,
    previewTabsByPanel,
    sideChatActiveTabByPanel,
    sideChatTabsBySession,
    sidePanelOpen,
  ]);

  const panelGroupTabs = useMemo<PanelGroupTabsByPanel>(() => {
    const empty = {
      right: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
      bottom: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
    } satisfies PanelGroupTabsByPanel;
    if (!activeSession) return empty;
    const makeItem = (tab: ProjectSessionRenderableTab): AppShellTabItem => {
      const chromeContext = resolveProjectTargetTabChromeContext(tab, activeSession, projects);
      const keepMounted = !isSideChatPanelTab(tab)
        && !isMcpAppPanelTab(tab)
        && !isPlanPanelTab(tab)
        && tab.kind === "card_stage";
      const title = !isSideChatPanelTab(tab)
        && !isMcpAppPanelTab(tab)
        && !isPlanPanelTab(tab)
        && tab.kind === "terminal"
        && "terminalSessionId" in tab.config
        ? terminalSessionStore.resolveTitle(
            tab.config.terminalSessionId,
            tab.title,
            resolveTerminalTabIndex(activeSession, tab),
          )
        : tab.title;

      return {
        id: tab.id,
        domTabId: !isSideChatPanelTab(tab) && !isMcpAppPanelTab(tab) && !isPlanPanelTab(tab) && tab.kind === "review"
          ? "diff"
          : !isSideChatPanelTab(tab) && !isMcpAppPanelTab(tab) && !isPlanPanelTab(tab) && tab.kind === "files" && "path" in tab.config
            ? getWorkspaceFileDomTabId("hostId" in tab.config ? tab.config.hostId : "local", tab.config.path)
            : undefined,
        title,
        ...chromeContext,
        icon: isSideChatPanelTab(tab)
          ? CodexSidePanelSideChatIcon
          : isMcpAppPanelTab(tab)
            ? ComposerPluginsIcon
            : isPlanPanelTab(tab)
              ? ComposerPlanModeIcon
              : getBrowserTabIcon(tab),
        closable: isSideChatPanelTab(tab)
          ? tab.status !== "loading"
          : isMcpAppPanelTab(tab)
            ? true
            : isPlanPanelTab(tab)
              ? true
              : tab.preview === true || activeSession.tabs.length > 1,
        preview: isSideChatPanelTab(tab) || isMcpAppPanelTab(tab) || isPlanPanelTab(tab) ? undefined : tab.preview,
        keepMounted,
        reorderable: isSideChatPanelTab(tab) || isMcpAppPanelTab(tab) || isPlanPanelTab(tab) ? false : tab.preview === true ? false : true,
        splittable: !isSideChatPanelTab(tab) && !isMcpAppPanelTab(tab) && !isPlanPanelTab(tab) && tab.preview !== true,
        contextMenuItems: !isSideChatPanelTab(tab) && !isMcpAppPanelTab(tab) && !isPlanPanelTab(tab) && tab.kind === "browser"
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
        renderPanel: (_closeTab, panelContext) => {
          if (isSideChatPanelTab(tab)) {
            return (
              <SideChatSessionTab
                key={`${activeSession.id}:${tab.id}:${tab.stateKey}`}
                tab={tab}
                activeSession={activeSession}
                projects={projects}
                onRefreshSessions={refreshProjectSessions}
                onRecreateSideChat={() => void recreateSideChatPanelTab(tab.id)}
                onOpenMcpAppSidePanel={openMcpAppSidePanel}
                threadQueueFollowUpsEnabled={threadQueueFollowUpsEnabled}
                composerEnterBehavior={composerEnterBehavior}
                onQueueingEnabledChange={handleThreadQueueFollowUpsEnabledChange}
                onOpenThread={openAttachedThreadSession}
                onOpenTurnDiffReview={openTurnDiffReview}
                onOpenTurnDiffFileInSidePanel={openTurnDiffFileInSidePanel}
                turnDiffHoverPreviewDisabled={sidePanelOpen}
              />
            );
          }
          if (isMcpAppPanelTab(tab)) {
            return <McpAppSessionTab key={`${activeSession.id}:${tab.id}:${tab.stateKey}`} tab={tab} />;
          }
          if (isPlanPanelTab(tab)) {
            return <PlanSidePanelTab key={`${activeSession.id}:${tab.id}:${tab.stateKey}`} content={tab.content} />;
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
              taskSearchOpenTick={taskSearchOpenTick}
              setSearchQuery={setSearchQuery}
              setDbViewPrefs={setDbViewPrefs}
              onReminderHandled={onReminderHandled}
              onLeaveCardStageCard={onLeaveCardStageCard}
              onOpenCardTab={openCardTab}
              onOpenFileTab={openWorkspaceFileTab}
              onEnsureBlankSessionForProject={ensureBlankSessionForProject}
              onRefreshSessions={refreshProjectSessions}
              onCloseTab={closeTab}
              onCreateTerminalTab={(panelId, leafId) => createManualTab("terminal", panelId, leafId)}
              onOpenThread={openAttachedThreadSession}
              cardStageHistoryModal={cardStageHistoryModal}
              onToggleCardStageHistoryModal={toggleCardStageHistoryModal}
              selectedTurnDiffReviewTarget={selectedTurnDiffReviewTarget}
              browserBoundsSyncTrigger={tab.panelId === "bottom"
                ? bottomPanelMotion.animatedSize
                : rightPanelMotion.animatedSize}
              isActivePanelTab={panelContext.active}
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
        const planTabs = (planTabsBySession[activeSession.id] ?? []).filter((tab) =>
          tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leaf.id
        );
        const previewTab = getRenderablePanelPreviewTab(activeSession, panelId, leaf.id, previewTabsByPanel);
        const renderableTabs: ProjectSessionRenderableTab[] = previewTab
          ? [...durableTabs, ...sideChatTabs, ...mcpAppTabs, ...planTabs, previewTab]
          : [...durableTabs, ...sideChatTabs, ...mcpAppTabs, ...planTabs];
        const sideChatActiveTabId = sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === activeLeafId ? sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const mcpAppActiveTabId = mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === activeLeafId ? mcpAppActiveTabByPanel[makeMcpAppPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const planActiveTabId = planActiveTabByPanel[makePlanPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === activeLeafId ? planActiveTabByPanel[makePlanPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const activeTabId = previewTab?.id
          ?? (planActiveTabId && renderableTabs.some((tab) => tab.id === planActiveTabId)
            ? planActiveTabId
            : null)
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
    createManualTab,
    mcpAppActiveTabByPanel,
    mcpAppTabsBySession,
    planActiveTabByPanel,
    planTabsBySession,
    onLeaveCardStageCard,
    onReminderHandled,
    openSideChat,
    openMcpAppSidePanel,
    openCardTab,
    openWorkspaceFileTab,
    handleThreadQueueFollowUpsEnabledChange,
    openAttachedThreadSession,
    openTurnDiffReview,
    openTurnDiffFileInSidePanel,
    pendingReminderOpen,
    projects,
    recreateSideChatPanelTab,
    refreshProjectSessions,
    reloadBrowserTab,
    rightPanelMotion.animatedSize,
    taskSearchOpenTick,
    dbViewPrefsByProject,
    searchByProject,
    setDbViewPrefs,
    setSearchQuery,
    sideChatActiveTabByPanel,
    sideChatTabsBySession,
    selectedTurnDiffReviewTarget,
    terminalSessionVersion,
    toggleCardStageHistoryModal,
    previewTabsByPanel,
  ]);

  panelGroupTabsRef.current = panelGroupTabs;

  useEffect(() => {
    if (!activeSession) return;
    const activeSessionPrefix = `${activeSession.id}:`;
    const currentKeys = new Set<string>();

    for (const panelId of ["right", "bottom"] as const) {
      const panelTabs = panelGroupTabs[panelId];
      for (const [leafId, tabs] of Object.entries(panelTabs.itemsByLeafId)) {
        const key = makePanelLeafStateKey(activeSession.id, panelId, leafId);
        currentKeys.add(key);
        const visibleTabIds = new Set(tabs.map((tab) => tab.id));
        const activeTabId = panelTabs.activeTabIdsByLeafId[leafId] ?? null;
        const durableLeaf = findProjectSessionPanelLeaf(activeSession.panels[panelId].layout, leafId);
        const durableMru = durableLeaf?.mruTabIds ?? [];
        const currentMru = panelTabMruByLeafRef.current[key] ?? [];
        const prunedMru = uniqueStringList([...currentMru, ...durableMru])
          .filter((tabId) => visibleTabIds.has(tabId));
        const nextMru = activeTabId && visibleTabIds.has(activeTabId)
          ? [activeTabId, ...prunedMru.filter((tabId) => tabId !== activeTabId)]
          : prunedMru;

        if (nextMru.length === 0) {
          delete panelTabMruByLeafRef.current[key];
          continue;
        }

        panelTabMruByLeafRef.current[key] = nextMru;
      }
    }

    for (const key of Object.keys(panelTabMruByLeafRef.current)) {
      if (!key.startsWith(activeSessionPrefix)) continue;
      if (currentKeys.has(key)) continue;
      delete panelTabMruByLeafRef.current[key];
    }
  }, [activeSession, panelGroupTabs]);

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

    const handleWindowMouseOut = (event: MouseEvent) => {
      if (!shouldResetCodexSidebarPointerOnWindowMouseOut({
        clientX: event.clientX,
        clientY: event.clientY,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        relatedTarget: event.relatedTarget,
      })) return;

      sidebarPointerRef.current = CODEX_SIDEBAR_POINTER_DEFAULT;
      recomputeFloatingSidebarVisibility(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("mouseout", handleWindowMouseOut, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mouseout", handleWindowMouseOut, {
        capture: true,
      });
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
    const menuKey = `${activeSession.id}:${panelId}:${leafId}:new-tab`;
    return (
      <NodexDropdownMenu
        open={openPanelNewTabMenuKey === menuKey}
        onOpenChange={(open) => {
          setOpenPanelNewTabMenuKey(open ? menuKey : null);
        }}
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
            const shouldCreateCurrentProjectDbView = action.kind === "db_view"
              && activeSession.projectId !== null
              && !findDbViewTabForProject(activeSession, activeSession.projectId);
            if (shouldCreateCurrentProjectDbView) {
              return (
                <NodexDropdownItem
                  leftSlot={<Icon className="icon-sm" />}
                  keyboardShortcut={resolvePanelActionShortcutLabel(action, isMacPlatform, commandKeymapState)}
                  onSelect={() => {
                    void (async () => {
                      await activatePanelGroup(panelId, leafId);
                      await createManualTab("db_view", panelId, leafId);
                    })();
                  }}
                >
                  {action.label}
                </NodexDropdownItem>
              );
            }

            if (isPanelDestinationAction(action)) {
              const scope: PanelDestinationPickerScope = action.kind === "db_view" ? "db-only" : "card-only";
              const ariaLabel = action.kind === "db_view" ? "Open DB view" : "Open card stage";
              const placeholder = action.kind === "db_view" ? "Open DB…" : "Open card…";
              return (
                <NodexDropdownFlyoutSubmenuItem
                  label={action.label}
                  leftSlot={<Icon className="icon-sm" />}
                  contentClassName="w-[330px] max-w-[calc(100vw-24px)] overflow-hidden p-0"
                >
                  <PanelDestinationPicker
                    projects={projects}
                    scope={scope}
                    ariaLabel={ariaLabel}
                    placeholder={placeholder}
                    currentProjectId={activeSession.projectId}
                    onClose={() => {
                      setOpenPanelNewTabMenuKey(null);
                    }}
                    onAccept={async (destination) => {
                      await openPanelDestinationFromPicker(destination, panelId, leafId);
                      setOpenPanelNewTabMenuKey(null);
                    }}
                  />
                </NodexDropdownFlyoutSubmenuItem>
              );
            }

            return (
              <NodexDropdownItem
                leftSlot={<Icon className="icon-sm" />}
                keyboardShortcut={resolvePanelActionShortcutLabel(action, isMacPlatform, commandKeymapState)}
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
    <RenameChatDialog
      open={Boolean(renameSession)}
      initialValue={renameSession?.displayTitle ?? ""}
      busy={renamingSession}
      onOpenChange={(open) => {
        if (open) return;
        setRenameSession(null);
      }}
      onSave={(title) => {
        void submitRenameSession(title);
      }}
    />
  );
  const commandPaletteProjectId = activeProject?.id ?? activeProjectId;
  const commandPaletteCommandContext: Omit<CommandPaletteShellCommandContext, "isMac" | "showMockCommands"> = {
    canGoBack: shellCanNavigateBack,
    canGoForward: shellCanNavigateForward,
    canStartNewChat: Boolean(activeProjectId),
    hasActiveSession: Boolean(activeSession),
    activeSessionPinned: activeSession?.pinned ?? false,
    hasAttachedThread: Boolean(activeSession?.thread),
    canOpenSessionInNewWindow: Boolean(onOpenProjectSessionInNewWindow),
    commandKeymapState,
  };
  const commandPaletteCommandHandlers: CommandPaletteShellCommandHandlers = {
    navigateBack: () => {
      void executeShellNavigation("back");
    },
    navigateForward: () => {
      void executeShellNavigation("forward");
    },
    newThread: () => {
      void startNewChatInProject(activeProjectId);
    },
    newThreadInProject: () => {
      void startNewChatInProject(activeProjectId);
    },
    renameThread: () => {
      if (!activeSession) return;
      openRenameSessionDialog(activeSession);
    },
    archiveThread: () => {
      if (!activeSession) return;
      void archiveSession(activeSession);
    },
    toggleThreadPin: () => {
      if (!activeSession) return;
      void toggleSessionPin(activeSession);
    },
    openThreadInNewWindow: () => {
      if (!activeSession) return;
      void onOpenProjectSessionInNewWindow?.(activeSession);
    },
    toggleSidebar: () => {
      toggleSidebarCollapsed();
    },
    toggleSidePanel: () => {
      toggleActiveSidePanel();
    },
    toggleBottomPanel: () => {
      toggleActiveBottomPanel();
    },
    toggleFileTreePanel: () => {
      void openPreviewTab("files", "right");
    },
    openBrowserTab: () => {
      void openPreviewTab("browser", "right");
    },
    openReviewTab: () => {
      void createManualTab("review", "right");
    },
    toggleTerminal: () => {
      void focusOrCreateSessionTerminalTab();
    },
    openDbViewTab: () => {
      void createManualTab("db_view", "right");
    },
    openSideChat: () => {
      void openSideChat({ targetPanelId: "right" });
    },
    findInThread: () => {
      setCommandPaletteOpen(false);
      onRequestContentSearchOpen?.(undefined, "command_palette");
    },
    settings: openSettings,
    showKeyboardShortcuts: openKeyboardShortcutsSettings,
  };
  const commandPalette = (
    <CommandPalette
      open={commandPaletteOpen}
      openTriggerTick={commandPaletteOpenRequest.tick}
      initialMode={commandPaletteOpenRequest.mode}
      initialQuery={commandPaletteOpenRequest.initialQuery}
      projects={projects}
      activeProjectId={commandPaletteProjectId}
      recentCardSessions={recentCardSessions}
      commandContext={commandPaletteCommandContext}
      commandHandlers={commandPaletteCommandHandlers}
      onOpenChange={setCommandPaletteOpen}
      onOpenCard={(projectId, cardId, titleSnapshot) => {
        void openCardTab(projectId, cardId, titleSnapshot);
      }}
      onOpenThread={openAttachedThreadSession}
    />
  );

  return (
    <HeaderActionProvider actions={settingsPath ? null : headerActions}>
      <NodexTooltipProvider>
        <ContentSearchProvider openRequest={contentSearchOpenRequest}>
          <ContentSearchSurface />
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
              spaces={spaces}
              activeProjectId={activeProjectId}
              activeSessionId={activeSession?.id ?? null}
              contextMenuSessionId={contextMenuSessionId}
              sessionsByProject={sessionsByProject}
              projectlessSessions={projectlessSessions}
              sidebarThreadModel={sidebarThreadSync.model}
              pinnedOrganizationMode={sidebarPinnedOrganizationMode}
              onPinnedOrganizationModeChange={setSidebarPinnedOrganizationMode}
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
              onSelectSidebarThread={selectSidebarThread}
              onOpenSessionContextMenu={openSessionContextMenu}
              onSessionTitleDoubleClick={handleSessionTitleDoubleClick}
              onArchiveSidebarThread={archiveSidebarThreadItem}
              onToggleSessionPinned={toggleSessionPin}
              onToggleSidebarThreadPinned={toggleSidebarThreadPinned}
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
              onSetProjectPinned={onSetProjectPinned}
              onOpenSettings={openSettings}
              account={codexAccount}
              connection={codexConnection}
              onRefreshAccount={codexAccountActions.refreshAccount}
              onLogout={handleCodexAccountLogout}
              onAccountErrorMessage={handleCodexAccountErrorMessage}
              sidebarArchiveSuppressedKeys={sidebarArchiveSuppressedKeys}
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
                  spaces={spaces}
                  activeProjectId={activeProjectId}
                  activeSessionId={activeSession?.id ?? null}
                  contextMenuSessionId={contextMenuSessionId}
                  sessionsByProject={sessionsByProject}
                  projectlessSessions={projectlessSessions}
                  sidebarThreadModel={sidebarThreadSync.model}
                  pinnedOrganizationMode={sidebarPinnedOrganizationMode}
                  onPinnedOrganizationModeChange={setSidebarPinnedOrganizationMode}
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
                  onSelectSidebarThread={selectSidebarThread}
                  onOpenSessionContextMenu={openSessionContextMenu}
                  onSessionTitleDoubleClick={handleSessionTitleDoubleClick}
                  onArchiveSidebarThread={archiveSidebarThreadItem}
                  onToggleSessionPinned={toggleSessionPin}
                  onToggleSidebarThreadPinned={toggleSidebarThreadPinned}
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
                  onSetProjectPinned={onSetProjectPinned}
                  onOpenSettings={openSettings}
                  account={codexAccount}
                  connection={codexConnection}
                  onRefreshAccount={codexAccountActions.refreshAccount}
                  onLogout={handleCodexAccountLogout}
                  onAccountErrorMessage={handleCodexAccountErrorMessage}
                  sidebarArchiveSuppressedKeys={sidebarArchiveSuppressedKeys}
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
              <div ref={setSessionContentRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
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
                        threadQueueFollowUpsEnabled={threadQueueFollowUpsEnabled}
                        composerEnterBehavior={composerEnterBehavior}
                        onQueueingEnabledChange={handleThreadQueueFollowUpsEnabledChange}
                        onOpenThread={openAttachedThreadSession}
                        onOpenTurnDiffReview={openTurnDiffReview}
                        onOpenTurnDiffFileInSidePanel={openTurnDiffFileInSidePanel}
                        turnDiffHoverPreviewDisabled={sidePanelOpen}
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
                        onOpenSideChat={(input) => openSideChat({ ...input, targetPanelId: "right" })}
                        onOpenMcpAppSidePanel={openMcpAppSidePanel}
                        onOpenPlanInSidePanel={openPlanSidePanel}
                        onClosePlanSidePanel={closePlanSidePanel}
                        planSidePanelState={threadPlanSidePanelState}
                        onRequestRenameThread={() => {
                          openRenameSessionDialog(activeSession);
                        }}
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
                                projects={projects}
                                isMac={isMacPlatform}
                                commandKeymapState={commandKeymapState}
                                currentProjectId={activeSession.projectId}
                                currentProjectDbViewExists={
                                  activeSession.projectId !== null
                                  && Boolean(findDbViewTabForProject(activeSession, activeSession.projectId))
                                }
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
                                    await createManualTab(kind, "right", leafId);
                                  })();
                                }}
                                onOpenDestination={async (destination) => {
                                  await openPanelDestinationFromPicker(destination, "right", leafId);
                                }}
                              />
                            )}
                            onSelectTab={(leafId, tabId) => void selectPanelTab("right", tabId, leafId)}
                            onCloseTab={(leafId, tabId) => void closePanelTab("right", tabId, leafId)}
                            onDirectCloseTab={(leafId, tabId) => void closePanelTab("right", tabId, leafId)}
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
                              projects={projects}
                              isMac={isMacPlatform}
                              commandKeymapState={commandKeymapState}
                              currentProjectId={activeSession.projectId}
                              currentProjectDbViewExists={false}
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
                                  await createManualTab(kind, "bottom", leafId);
                                })();
                              }}
                              onOpenDestination={async (destination) => {
                                await openPanelDestinationFromPicker(destination, "bottom", leafId);
                              }}
                            />
                          )}
                          onSelectTab={(leafId, tabId) => void selectPanelTab("bottom", tabId, leafId)}
                          onCloseTab={(leafId, tabId) => void closePanelTab("bottom", tabId, leafId)}
                          onDirectCloseTab={(leafId, tabId) => void closePanelTab("bottom", tabId, leafId)}
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
        </ContentSearchProvider>
      </NodexTooltipProvider>
    </HeaderActionProvider>
  );
}

interface CodexSidebarPaginatedItemsProps<T> {
  items: T[];
  getKey: (item: T) => string;
  maxItems?: number | null;
  expanded: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  forcedVisibleKey?: string | null;
  suppressedKeys?: ReadonlySet<string>;
  pagerClassName?: string;
  children: (
    pagination: CodexSidebarPaginationResult<T>,
    pager: ReactNode,
  ) => ReactNode;
}

function CodexSidebarPaginatedItems<T>({
  items,
  getKey,
  maxItems = null,
  expanded,
  onExpandedChange,
  forcedVisibleKey = null,
  suppressedKeys,
  pagerClassName = CODEX_SIDEBAR_DEFAULT_PAGER_ROW_CLASS,
  children,
}: CodexSidebarPaginatedItemsProps<T>) {
  const [extraPageCount, setExtraPageCount] = useState(1);
  const focusRestoreTargetRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (expanded) return;
    setExtraPageCount(1);
  }, [expanded]);

  const pagination = useMemo(() => paginateCodexSidebarItems({
    items,
    getKey,
    maxItems,
    expanded,
    extraPageCount,
    forcedVisibleKey,
    suppressedKeys,
    pagerEnabled: Boolean(onExpandedChange),
  }), [
    expanded,
    extraPageCount,
    forcedVisibleKey,
    getKey,
    items,
    maxItems,
    onExpandedChange,
    suppressedKeys,
  ]);

  const restorePagerFocus = useCallback(() => {
    queueMicrotask(() => {
      focusRestoreTargetRef.current?.focus();
    });
  }, []);

  const showMore = useCallback(() => {
    if (!expanded) {
      setExtraPageCount(1);
      onExpandedChange?.(true);
      restorePagerFocus();
      return;
    }

    setExtraPageCount((current) => current + 1);
    restorePagerFocus();
  }, [expanded, onExpandedChange, restorePagerFocus]);

  const showLess = useCallback(() => {
    setExtraPageCount(1);
    onExpandedChange?.(false);
    restorePagerFocus();
  }, [onExpandedChange, restorePagerFocus]);

  const pager = pagination.showPager ? (
    <div className={pagerClassName} role="listitem">
      {pagination.hasOverflow ? (
        <button
          ref={focusRestoreTargetRef}
          type="button"
          className={CODEX_SIDEBAR_PAGER_BUTTON_CLASS}
          onClick={showMore}
        >
          Show more
        </button>
      ) : null}
      {expanded ? (
        <button
          ref={pagination.hasOverflow ? undefined : focusRestoreTargetRef}
          type="button"
          className={CODEX_SIDEBAR_PAGER_BUTTON_CLASS}
          onClick={showLess}
        >
          Show less
        </button>
      ) : null}
    </div>
  ) : null;

  return <>{children(pagination, pager)}</>;
}

function SidebarThreadOrganizerSections({
  activeProjectId,
  activeSessionId,
  contextMenuSessionId,
  sessionsByProject,
  projectlessSessions,
  pinnedOrganizationMode,
  onPinnedOrganizationModeChange,
  expandedProjectIds,
  pinnedThreadsSectionCollapsed,
  projectsSectionCollapsed,
  loadingSessions,
  model,
  onTogglePinnedThreadsSectionCollapsed,
  onToggleProjectsSectionCollapsed,
  onToggleProjectExpanded,
  onSelectProject,
  onSelectSidebarThread,
  onOpenSessionContextMenu,
  onSessionTitleDoubleClick,
  onArchiveSidebarThread,
  onToggleSessionPinned,
  onToggleSidebarThreadPinned,
  onStartNewChatInProject,
  projectPickerOpenTick,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onSetProjectPinned,
  sidebarArchiveSuppressedKeys,
}: {
  activeProjectId: string;
  activeSessionId: string | null;
  contextMenuSessionId?: string | null;
  sessionsByProject: Record<string, ProjectSession[]>;
  projectlessSessions: ProjectSession[];
  pinnedOrganizationMode: SidebarPinnedOrganizationMode;
  onPinnedOrganizationModeChange?: (mode: SidebarPinnedOrganizationMode) => void;
  expandedProjectIds: Set<string>;
  pinnedThreadsSectionCollapsed: boolean;
  projectsSectionCollapsed: boolean;
  loadingSessions: boolean;
  model: CodexSidebarThreadSyncModel;
  onTogglePinnedThreadsSectionCollapsed: () => void;
  onToggleProjectsSectionCollapsed: () => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSidebarThread: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onOpenSessionContextMenu?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onSessionTitleDoubleClick?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onArchiveSidebarThread?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onToggleSessionPinned?: (session: ProjectSession) => void | Promise<void>;
  onToggleSidebarThreadPinned?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onStartNewChatInProject: (projectId: string) => void | Promise<void>;
  projectPickerOpenTick: number;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onSetProjectPinned: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  sidebarArchiveSuppressedKeys: ReadonlySet<string>;
}) {
  const [chatsCollapsed, setChatsCollapsed] = useState(false);
  const [pinnedProjectsExpanded, setPinnedProjectsExpanded] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [expandedProjectThreadListIds, setExpandedProjectThreadListIds] = useState<Set<string>>(new Set());
  const [previouslyExpandedProjectGroupIds, setPreviouslyExpandedProjectGroupIds] = useState<string[]>([]);
  const sessionsById = useMemo(() => {
    const entries = [
      ...Object.values(sessionsByProject).flat(),
      ...projectlessSessions,
    ].map((session) => [session.id, session] as const);
    return new Map(entries);
  }, [projectlessSessions, sessionsByProject]);
  const knownSessions = useMemo(
    () => [...Object.values(sessionsByProject).flat(), ...projectlessSessions],
    [projectlessSessions, sessionsByProject],
  );
  const sessionsByThreadId = useMemo(() => {
    const entries = knownSessions
      .filter((session) => session.thread)
      .map((session) => [session.thread?.threadId ?? "", session] as const);
    return new Map(entries);
  }, [knownSessions]);
  const fallbackThreadItems = useMemo(() => {
    const existingSessionIds = new Set(
      model.snapshot.items
        .map((item) => item.sessionId)
        .filter((sessionId): sessionId is string => typeof sessionId === "string"),
    );
    const existingThreadIds = new Set(model.snapshot.items.map((item) => item.threadId));
    return knownSessions
      .filter((session) => !session.archived)
      .filter((session) => {
        if (existingSessionIds.has(session.id)) return false;
        if (session.thread && existingThreadIds.has(session.thread.threadId)) return false;
        return true;
      })
      .map((session): CodexSidebarThreadItem => {
        const threadId = session.thread?.threadId ?? session.id;
        return {
          key: `local:session:${session.id}`,
          kind: "local",
          hostId: "local",
          threadId,
          sessionId: session.id,
          projectId: session.projectId,
          title: session.displayTitle,
          preview: session.thread?.threadPreview ?? "",
          cwd: session.thread?.cwd ?? null,
          updatedAt: session.thread?.updatedAt ?? Date.parse(session.updatedAt),
          createdAt: session.thread?.createdAt ?? Date.parse(session.createdAt),
          pinned: session.pinned,
          pinnedOrder: session.pinnedOrder,
          unread: session.unread,
          archived: session.archived || session.thread?.archived === true,
          statusType: (session.thread?.statusType ?? "notLoaded") as CodexSidebarThreadItem["statusType"],
          statusActiveFlags: (session.thread?.statusActiveFlags ?? []) as CodexSidebarThreadItem["statusActiveFlags"],
          projectless: session.projectId === null,
          disabled: false,
        };
      });
  }, [knownSessions, model.snapshot.items]);
  const sidebarThreadItemsByKey = useMemo(() => {
    const itemsByKey = new Map(model.threadItemsByKey);
    for (const item of fallbackThreadItems) {
      itemsByKey.set(item.key, item);
    }
    return itemsByKey;
  }, [fallbackThreadItems, model.threadItemsByKey]);
  const allPinnedThreadKeys = useMemo(() => sortSidebarThreadKeysForDisplay({
    threadKeys: [
      ...model.pinnedThreadKeys,
      ...fallbackThreadItems.filter((item) => item.pinned).map((item) => item.key),
    ],
    itemsByKey: sidebarThreadItemsByKey,
    sessionsById,
  }), [fallbackThreadItems, model.pinnedThreadKeys, sessionsById, sidebarThreadItemsByKey]);
  const projectIds = useMemo(
    () => new Set(model.projectGroups.map((group) => group.project.id)),
    [model.projectGroups],
  );
  const pinnedThreadKeysByProject = useMemo(() => {
    const keysByProject = new Map<string, string[]>();
    if (pinnedOrganizationMode !== "byProject") return keysByProject;

    for (const threadKey of allPinnedThreadKeys) {
      const item = sidebarThreadItemsByKey.get(threadKey);
      if (!item?.projectId || item.projectless || !projectIds.has(item.projectId)) continue;
      const keys = keysByProject.get(item.projectId) ?? [];
      keys.push(threadKey);
      keysByProject.set(item.projectId, keys);
    }

    return keysByProject;
  }, [allPinnedThreadKeys, pinnedOrganizationMode, projectIds, sidebarThreadItemsByKey]);
  const pinnedStandaloneThreadKeys = useMemo(() => {
    if (pinnedOrganizationMode === "manualOrder") return allPinnedThreadKeys;

    return allPinnedThreadKeys.filter((threadKey) => {
      const item = sidebarThreadItemsByKey.get(threadKey);
      if (!item) return true;
      if (item.projectless) return true;
      if (!item.projectId) return true;
      return !projectIds.has(item.projectId);
    });
  }, [allPinnedThreadKeys, pinnedOrganizationMode, projectIds, sidebarThreadItemsByKey]);
  const projectGroups = useMemo(() => model.projectGroups.map((group) => ({
    project: group.project,
    threadKeys: sortSidebarThreadKeysForDisplay({
      threadKeys: [
        ...(pinnedThreadKeysByProject.get(group.project.id) ?? []),
        ...group.threadKeys,
        ...fallbackThreadItems
          .filter((item) => item.projectId === group.project.id && !item.pinned)
          .map((item) => item.key),
      ],
      itemsByKey: sidebarThreadItemsByKey,
      sessionsById,
    }),
  })), [fallbackThreadItems, model.projectGroups, pinnedThreadKeysByProject, sessionsById, sidebarThreadItemsByKey]);
  const projectLabelById = useMemo(() => {
    const entries = projectGroups.map(({ project }) => [project.id, project.name] as const);
    return new Map(entries);
  }, [projectGroups]);
  const pinnedProjectGroups = useMemo(
    () => projectGroups.filter((group) => group.project.pinned),
    [projectGroups],
  );
  const unpinnedProjectGroups = useMemo(
    () => projectGroups.filter((group) => !group.project.pinned),
    [projectGroups],
  );
  const visibleProjectGroupIds = useMemo(
    () => unpinnedProjectGroups.map((group) => group.project.id),
    [unpinnedProjectGroups],
  );
  const projectGroupCollapseAction = useMemo(() => resolveSidebarProjectGroupCollapseAction({
    visibleGroupIds: visibleProjectGroupIds,
    expandedGroupIds: expandedProjectIds,
    previouslyExpandedGroupIds: previouslyExpandedProjectGroupIds,
  }), [expandedProjectIds, previouslyExpandedProjectGroupIds, visibleProjectGroupIds]);
  const runProjectGroupCollapseAction = useCallback((action: SidebarProjectGroupCollapseAction) => {
    if (action === "collapse-all") {
      const expandedVisibleProjectGroupIds = listExpandedVisibleProjectGroupIds(
        visibleProjectGroupIds,
        expandedProjectIds,
      );
      if (expandedVisibleProjectGroupIds.length === 0) return;

      setPreviouslyExpandedProjectGroupIds(expandedVisibleProjectGroupIds);
      for (const projectId of expandedVisibleProjectGroupIds) {
        onToggleProjectExpanded(projectId);
      }
      return;
    }

    const reopenableProjectGroupIds = listReopenableVisibleProjectGroupIds(
      visibleProjectGroupIds,
      previouslyExpandedProjectGroupIds,
    ).filter((projectId) => !expandedProjectIds.has(projectId));
    setPreviouslyExpandedProjectGroupIds([]);
    for (const projectId of reopenableProjectGroupIds) {
      onToggleProjectExpanded(projectId);
    }
  }, [
    expandedProjectIds,
    onToggleProjectExpanded,
    previouslyExpandedProjectGroupIds,
    visibleProjectGroupIds,
  ]);
  const hasVisiblePinnedStandaloneThreads = pinnedStandaloneThreadKeys.some((threadKey) =>
    !sidebarArchiveSuppressedKeys.has(threadKey)
  );
  const hasVisiblePinnedSectionItems = hasVisiblePinnedStandaloneThreads || pinnedProjectGroups.length > 0;
  const projectlessThreadKeys = useMemo(() => sortSidebarThreadKeysForDisplay({
    threadKeys: [
      ...model.projectlessThreadKeys,
      ...fallbackThreadItems
        .filter((item) => item.projectless && !item.pinned)
        .map((item) => item.key),
    ],
    itemsByKey: sidebarThreadItemsByKey,
    sessionsById,
  }), [fallbackThreadItems, model.projectlessThreadKeys, sessionsById, sidebarThreadItemsByKey]);
  const activeThreadKey = useMemo(() => {
    if (!activeSessionId) return null;
    const activeSession = sessionsById.get(activeSessionId);

    for (const [key, item] of sidebarThreadItemsByKey) {
      if (item.sessionId === activeSessionId) return key;
      if (activeSession?.thread && item.threadId === activeSession.thread.threadId) return key;
    }

    return activeSession ? `local:session:${activeSession.id}` : null;
  }, [activeSessionId, sessionsById, sidebarThreadItemsByKey]);

  const setProjectThreadListExpanded = useCallback((projectId: string, expanded: boolean) => {
    setExpandedProjectThreadListIds((current) => {
      const next = new Set(current);
      if (expanded) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }
      return next;
    });
  }, []);

  const resolveSessionForItem = useCallback((item: CodexSidebarThreadItem) => {
    if (item.sessionId) {
      const session = sessionsById.get(item.sessionId);
      if (session) return session;
    }
    return sessionsByThreadId.get(item.threadId) ?? null;
  }, [sessionsById, sessionsByThreadId]);

  const renderThreadRow = useCallback((
    threadKey: string,
    options: {
      hoverCardProjectLabel?: string | null;
    } = {},
  ) => {
    const item = sidebarThreadItemsByKey.get(threadKey);
    if (!item) return null;
    const session = resolveSessionForItem(item);
    const sessionId = item.sessionId ?? session?.id ?? null;
    const hoverCardProjectLabel = options.hoverCardProjectLabel
      ?? (item.projectId ? projectLabelById.get(item.projectId) ?? null : null);

    return (
      <CodexSidebarThreadRow
        key={item.key}
        item={item}
        active={Boolean(sessionId && activeSessionId === sessionId)}
        contextMenuOpen={Boolean(sessionId && contextMenuSessionId === sessionId)}
        hoverCardProjectLabel={hoverCardProjectLabel}
        onSelect={() => {
          void onSelectSidebarThread(item);
        }}
        onOpenContextMenu={session && onOpenSessionContextMenu
          ? (_item, event) => onOpenSessionContextMenu(session, event)
          : undefined}
        onRenameFromTitleDoubleClick={session && onSessionTitleDoubleClick
          ? (_item, event) => onSessionTitleDoubleClick(session, event)
          : undefined}
        archivePending={sidebarArchiveSuppressedKeys.has(item.key)}
        onArchive={onArchiveSidebarThread}
        onTogglePinned={session && onToggleSessionPinned
          ? () => onToggleSessionPinned(session)
          : onToggleSidebarThreadPinned}
      />
    );
  }, [
    activeSessionId,
    contextMenuSessionId,
    onOpenSessionContextMenu,
    onArchiveSidebarThread,
    onSelectSidebarThread,
    onSessionTitleDoubleClick,
    onToggleSessionPinned,
    onToggleSidebarThreadPinned,
    projectLabelById,
    resolveSessionForItem,
    sidebarArchiveSuppressedKeys,
    sidebarThreadItemsByKey,
  ]);

  const renderThreadList = useCallback((
    threadKeys: string[],
    emptyText: string,
    options: {
      ariaLabel?: string;
      maxItems?: number | null;
      expanded?: boolean;
      onExpandedChange?: (expanded: boolean) => void;
      forcedVisibleKey?: string | null;
    } = {},
  ) => (
    <CodexSidebarPaginatedItems
      items={threadKeys}
      getKey={(threadKey) => threadKey}
      maxItems={options.maxItems}
      expanded={options.expanded ?? false}
      onExpandedChange={options.onExpandedChange}
      forcedVisibleKey={options.forcedVisibleKey ?? null}
      suppressedKeys={sidebarArchiveSuppressedKeys}
    >
      {(pagination, pager) => (
        <div className="isolate flex flex-col [contain:layout]">
          <div className="flex flex-col" role="list" aria-label={options.ariaLabel}>
            {pagination.visibleItems.length > 0 ? pagination.visibleItems.map((threadKey) => renderThreadRow(threadKey)) : (
              <div className="px-row-x py-row-y text-sm text-token-description-foreground" role="listitem">
                {loadingSessions ? "Loading chats..." : emptyText}
              </div>
            )}
            {pager}
          </div>
        </div>
      )}
    </CodexSidebarPaginatedItems>
  ), [loadingSessions, renderThreadRow, sidebarArchiveSuppressedKeys]);

  const renderProjectGroupRows = (
    groups: typeof projectGroups,
    options: {
      expanded: boolean;
      onExpandedChange: (expanded: boolean) => void;
      emptyText?: string;
    },
  ) => (
    <CodexSidebarPaginatedItems
      items={groups}
      getKey={(group) => group.project.id}
      maxItems={CODEX_SIDEBAR_PROJECT_GROUP_MAX_GROUPS}
      expanded={options.expanded}
      onExpandedChange={options.onExpandedChange}
      forcedVisibleKey={activeProjectId}
    >
      {(pagination, pager) => (
        <div className="isolate flex flex-col [contain:layout]">
          <SidebarProjectSortableContext groupIds={pagination.visibleItems.map((group) => group.project.id)}>
            <div className="flex flex-col" role="list" aria-label="Projects">
              {pagination.visibleItems.length > 0 ? pagination.visibleItems.map(({ project, threadKeys }) => {
                const expanded = expandedProjectIds.has(project.id);
                const threadListExpanded = expandedProjectThreadListIds.has(project.id);
                return (
                  <CodexProjectRow
                    key={project.id}
                    project={project}
                    active={activeSessionId === null && activeProjectId === project.id}
                    expanded={expanded}
                    groupDndController={NOOP_WORKBENCH_SIDEBAR_GROUP_DND_CONTROLLER}
                    allowProjectReorder
                    onActivate={() => onToggleProjectExpanded(project.id)}
                    onSelectProject={() => onSelectProject(project.id)}
                    onStartNewChat={() => void onStartNewChatInProject(project.id)}
                    onUpdateProject={onUpdateProject}
                    onDeleteProject={onDeleteProject}
                    onSetProjectPinned={onSetProjectPinned}
                  >
                    <CodexSidebarPaginatedItems
                      items={threadKeys}
                      getKey={(threadKey) => threadKey}
                      maxItems={CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS}
                      expanded={threadListExpanded}
                      onExpandedChange={(nextExpanded) => setProjectThreadListExpanded(project.id, nextExpanded)}
                      forcedVisibleKey={activeThreadKey}
                      suppressedKeys={sidebarArchiveSuppressedKeys}
                      pagerClassName={CODEX_SIDEBAR_PROJECT_THREAD_PAGER_ROW_CLASS}
                    >
                      {(threadPagination, threadPager) => (
                        <CodexProjectSessionList project={project} showAll={threadListExpanded}>
                          {threadPagination.visibleItems.length > 0 ? threadPagination.visibleItems.map((threadKey) => renderThreadRow(threadKey, {
                            hoverCardProjectLabel: project.name,
                          })) : (
                            <div className="px-row-x py-row-y text-sm text-token-description-foreground" role="listitem">
                              {loadingSessions ? "Loading chats..." : "No chats"}
                            </div>
                          )}
                          {threadPager}
                        </CodexProjectSessionList>
                      )}
                    </CodexSidebarPaginatedItems>
                  </CodexProjectRow>
                );
              }) : (
                <div className="px-row-x py-row-y text-sm text-token-description-foreground" role="listitem">
                  {loadingSessions ? "Loading projects..." : options.emptyText ?? "No projects"}
                </div>
              )}
              {pager}
            </div>
          </SidebarProjectSortableContext>
        </div>
      )}
    </CodexSidebarPaginatedItems>
  );

  const renderPinnedSection = () => {
    if (!hasVisiblePinnedSectionItems) return null;

    return (
      <CodexSidebarSection
        heading="Pinned"
        collapsed={pinnedThreadsSectionCollapsed}
        onToggle={onTogglePinnedThreadsSectionCollapsed}
      >
        {pinnedStandaloneThreadKeys.length > 0
          ? renderThreadList(pinnedStandaloneThreadKeys, "No pinned chats", { ariaLabel: "Pinned chats" })
          : null}
        {pinnedProjectGroups.length > 0
          ? renderProjectGroupRows(pinnedProjectGroups, {
            expanded: pinnedProjectsExpanded,
            onExpandedChange: setPinnedProjectsExpanded,
          })
          : null}
      </CodexSidebarSection>
    );
  };

  const renderProjectGroups = () => (
    <>
      {renderPinnedSection()}
      <CodexSidebarSection
        heading="Projects"
        collapsed={projectsSectionCollapsed}
        onToggle={onToggleProjectsSectionCollapsed}
        actions={(
          <SidebarProjectsSectionActions
            projectGroupCollapseAction={projectGroupCollapseAction}
            onProjectGroupCollapseAction={runProjectGroupCollapseAction}
            onCreateProject={onCreateProject}
            openSetupTick={projectPickerOpenTick}
            pinnedOrganizationMode={pinnedOrganizationMode}
            onPinnedOrganizationModeChange={onPinnedOrganizationModeChange}
          />
        )}
      >
        {renderProjectGroupRows(unpinnedProjectGroups, {
          expanded: projectsExpanded,
          onExpandedChange: setProjectsExpanded,
        })}
      </CodexSidebarSection>
      <CodexSidebarSection
        heading="Chats"
        collapsed={chatsCollapsed}
        onToggle={() => setChatsCollapsed((current) => !current)}
      >
        {renderThreadList(projectlessThreadKeys, "No projectless chats", { ariaLabel: "Chats" })}
      </CodexSidebarSection>
    </>
  );

  return renderProjectGroups();
}

function ProjectSessionSidebar({
  floating = false,
  header,
  activeProjectId,
  activeSessionId,
  contextMenuSessionId,
  sessionsByProject,
  projectlessSessions,
  sidebarThreadModel,
  pinnedOrganizationMode,
  onPinnedOrganizationModeChange,
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
  onSelectSidebarThread,
  onOpenSessionContextMenu,
  onSessionTitleDoubleClick,
  onArchiveSidebarThread,
  onToggleSessionPinned,
  onToggleSidebarThreadPinned,
  onStartNewChatInProject,
  onOpenCommandPalette,
  onShowUnavailableProduct,
  projectPickerOpenTick = 0,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onSetProjectPinned,
  onOpenSettings,
  account,
  connection,
  onRefreshAccount,
  onLogout,
  onAccountErrorMessage,
  sidebarArchiveSuppressedKeys,
}: {
  floating?: boolean;
  header?: ReactNode;
  spaces: SpaceRef[];
  activeProjectId: string;
  activeSessionId: string | null;
  contextMenuSessionId?: string | null;
  sessionsByProject: Record<string, ProjectSession[]>;
  projectlessSessions: ProjectSession[];
  sidebarThreadModel: CodexSidebarThreadSyncModel;
  pinnedOrganizationMode: SidebarPinnedOrganizationMode;
  onPinnedOrganizationModeChange?: (mode: SidebarPinnedOrganizationMode) => void;
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
  onSelectSidebarThread: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onOpenSessionContextMenu?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onSessionTitleDoubleClick?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onArchiveSidebarThread?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onToggleSessionPinned?: (session: ProjectSession) => void | Promise<void>;
  onToggleSidebarThreadPinned?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onStartNewChatInProject: (projectId: string) => void | Promise<void>;
  onOpenCommandPalette: () => void;
  onShowUnavailableProduct: (label: string) => void;
  projectPickerOpenTick?: number;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onSetProjectPinned: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onOpenSettings: () => void;
  account: CodexAccountSnapshot | null;
  connection: CodexConnectionState;
  onRefreshAccount: () => Promise<CodexAccountSnapshot>;
  onLogout: () => Promise<void>;
  onAccountErrorMessage: (message: string | null) => void;
  sidebarArchiveSuppressedKeys: ReadonlySet<string>;
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
          <nav
            className="sidebar-foreground-muted flex min-h-0 flex-1 flex-col"
            role="navigation"
            aria-label="Automation folders"
          >
            <div className="shrink-0">
              <SidebarNewChatButton
                shortcutLabel={resolveCodexNewChatShortcutLabel()}
                onClick={() => void onStartNewChatInProject(activeProjectId)}
              />
              <CodexSidebarTopAction
                label="Search"
                icon={<SearchIcon className="icon-xs" />}
                shortcutLabel={resolveCodexCardSearchShortcutLabel()}
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
              className="vertical-scroll-fade-mask relative isolate flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto pt-4 [contain:layout_paint]"
            >
              <SidebarProjectDndProvider onProjectDrop={handleProjectDrop}>
                <SidebarThreadOrganizerSections
                  activeProjectId={activeProjectId}
                  activeSessionId={activeSessionId}
                  contextMenuSessionId={contextMenuSessionId}
                  sessionsByProject={sessionsByProject}
                  projectlessSessions={projectlessSessions}
                  pinnedOrganizationMode={pinnedOrganizationMode}
                  onPinnedOrganizationModeChange={onPinnedOrganizationModeChange}
                  expandedProjectIds={expandedProjectIds}
                  pinnedThreadsSectionCollapsed={pinnedProjectsSectionCollapsed}
                  projectsSectionCollapsed={projectsSectionCollapsed}
                  loadingSessions={loadingSessions}
                  model={sidebarThreadModel}
                  onTogglePinnedThreadsSectionCollapsed={onTogglePinnedProjectsSectionCollapsed}
                  onToggleProjectsSectionCollapsed={onToggleProjectsSectionCollapsed}
                  onToggleProjectExpanded={onToggleProjectExpanded}
                  onSelectProject={onSelectProject}
                  onSelectSidebarThread={onSelectSidebarThread}
                  onOpenSessionContextMenu={onOpenSessionContextMenu}
                  onSessionTitleDoubleClick={onSessionTitleDoubleClick}
                  onArchiveSidebarThread={onArchiveSidebarThread}
                  onToggleSessionPinned={onToggleSessionPinned}
                  onToggleSidebarThreadPinned={onToggleSidebarThreadPinned}
                  onStartNewChatInProject={onStartNewChatInProject}
                  projectPickerOpenTick={projectPickerOpenTick}
                  onCreateProject={onCreateProject}
                  onUpdateProject={onUpdateProject}
                  onDeleteProject={onDeleteProject}
                  onSetProjectPinned={onSetProjectPinned}
                  sidebarArchiveSuppressedKeys={sidebarArchiveSuppressedKeys}
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
          </nav>
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
  commandKeymapState?: CommandKeymapState | null;
};

const PanelActionCard = forwardRef<HTMLButtonElement, PanelActionCardProps>(
  function PanelActionCard({
    action,
    isMac,
    commandKeymapState,
    className,
    ...buttonProps
  }, ref) {
    const shortcut = resolvePanelActionShortcutLabel(action, isMac, commandKeymapState);
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

function PanelDestinationActionMenu({
  action,
  projects,
  isMac,
  commandKeymapState,
  currentProjectId,
  onOpenDestination,
}: {
  action: PanelNewTabAction & { kind: "db_view" | "card_stage" };
  projects: readonly Project[];
  isMac: boolean;
  commandKeymapState?: CommandKeymapState | null;
  currentProjectId?: string | null;
  onOpenDestination: (destination: PanelDestination) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const scope: PanelDestinationPickerScope = action.kind === "db_view" ? "db-only" : "card-only";
  const ariaLabel = action.kind === "db_view" ? "Open DB view" : "Open card stage";
  const placeholder = action.kind === "db_view" ? "Open DB…" : "Open card…";

  return (
    <NodexDropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="center"
      sideOffset={8}
      contentClassName="w-[330px] max-w-[calc(100vw-24px)] overflow-hidden p-0"
      triggerButton={<PanelActionCard action={action} isMac={isMac} commandKeymapState={commandKeymapState} />}
    >
      <PanelDestinationPicker
        projects={projects}
        scope={scope}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        currentProjectId={currentProjectId}
        onClose={() => {
          setOpen(false);
        }}
        onAccept={async (destination) => {
          await onOpenDestination(destination);
          setOpen(false);
        }}
      />
    </NodexDropdownMenu>
  );
}

function EmptyRightPane({
  actions,
  projects,
  isMac,
  commandKeymapState,
  currentProjectId,
  currentProjectDbViewExists,
  onAction,
  onOpenDestination,
}: {
  actions: PanelNewTabAction[];
  projects: readonly Project[];
  isMac: boolean;
  commandKeymapState?: CommandKeymapState | null;
  currentProjectId?: string | null;
  currentProjectDbViewExists: boolean;
  onAction: (kind: PanelNewTabActionKind) => void;
  onOpenDestination: (destination: PanelDestination) => Promise<void> | void;
}) {
  const codexActions = actions.filter((action) => !isNodexPanelOptionAction(action));
  const nodexActions = actions.filter(isNodexPanelOptionAction);
  const renderAction = (action: PanelNewTabAction) => {
    if (action.kind === "db_view" && !currentProjectDbViewExists) {
      return (
        <PanelActionCard
          key={action.kind}
          action={action}
          isMac={isMac}
          commandKeymapState={commandKeymapState}
          onClick={() => onAction(action.kind)}
        />
      );
    }

    if (isPanelDestinationAction(action)) {
      return (
        <PanelDestinationActionMenu
          key={action.kind}
          action={action}
          projects={projects}
          isMac={isMac}
          commandKeymapState={commandKeymapState}
          currentProjectId={currentProjectId}
          onOpenDestination={onOpenDestination}
        />
      );
    }

    return (
      <PanelActionCard
        key={action.kind}
        action={action}
        isMac={isMac}
        commandKeymapState={commandKeymapState}
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
  threadQueueFollowUpsEnabled,
  composerEnterBehavior,
  onQueueingEnabledChange,
  onOpenThread,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  turnDiffHoverPreviewDisabled,
  onForkSessionFromTurn,
  accountActions,
  worktreeStartMode,
  worktreeBranchPrefix,
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
  onOpenPlanInSidePanel,
  onClosePlanSidePanel,
  planSidePanelState,
  onRequestRenameThread,
}: {
  session: ProjectSession;
  project: Project | null;
  projects: Project[];
  onRefreshProjectSessions: (projectId: string) => Promise<ProjectSession[]>;
  onEnsureBlankSessionForProject: (projectId: string) => Promise<ProjectSession>;
  onRequestProjectPickerOpen: () => void;
  onOpenLocalEnvironmentsSettings: () => void;
  threadQueueFollowUpsEnabled: boolean;
  composerEnterBehavior: ComposerEnterBehavior;
  onQueueingEnabledChange: ThreadStageActions["onQueueingEnabledChange"];
  onOpenThread: ThreadStageActions["onOpenThread"];
  onOpenTurnDiffReview: ThreadStageActions["onOpenTurnDiffReview"];
  onOpenTurnDiffFileInSidePanel: NonNullable<ThreadStageActions["onOpenTurnDiffFileInSidePanel"]>;
  turnDiffHoverPreviewDisabled: boolean;
  onForkSessionFromTurn: NonNullable<ThreadActionControllerInput["onForkSessionFromTurn"]>;
  accountActions: ReturnType<typeof useCodexAccountActions>;
  worktreeStartMode: WorktreeStartMode;
  worktreeBranchPrefix: string;
  searchOpenTick: number;
  summaryPanelMounted: boolean;
  summaryPanelOpen: boolean;
  summaryPanelHideImmediately: boolean;
  summaryPanelContentShift: number;
  summarySideChatRows: readonly ThreadSummaryPanelAuxiliaryRow[];
  summaryBrowserRows: readonly ThreadSummaryPanelAuxiliaryRow[];
  rightPanelComposerOverlayEnabled: boolean;
  rightPanelComposerOverlayTarget: HTMLElement | null;
  onOpenSideChat: (input?: ThreadOpenSideChatInput & {
    collaborationMode?: CodexCollaborationModeKind;
  }) => Promise<void>;
  onOpenMcpAppSidePanel: ThreadStageActions["onOpenMcpAppSidePanel"];
  onOpenPlanInSidePanel: ThreadStageActions["onOpenPlanInSidePanel"];
  onClosePlanSidePanel: ThreadStageActions["onClosePlanSidePanel"];
  planSidePanelState: ThreadPlanSidePanelState | null;
  onRequestRenameThread: ThreadStageActions["onRequestRenameThread"];
}) {
  const projectId = session.projectId ?? project?.id ?? projects[0]?.id ?? "default";
  const summary = session.thread ? makeThreadSummary(session.thread) : null;
  const [selectedNewThreadProjectId, setSelectedNewThreadProjectId] = useState(projectId);
  const [selectedNewThreadRunInTarget, setSelectedNewThreadRunInTarget] = useState<CardRunInTarget>("localProject");
  const [selectedNewThreadEnvironmentPath, setSelectedNewThreadEnvironmentPath] = useState<string | null>(null);
  const [newThreadEnvironmentOptions, setNewThreadEnvironmentOptions] = useState<WorktreeEnvironmentOption[]>([]);
  const [newThreadEnvironmentsLoading, setNewThreadEnvironmentsLoading] = useState(false);
  const selectedNewThreadProject = projects.find((candidate) => candidate.id === selectedNewThreadProjectId) ?? project ?? null;
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
    onEnsureBlankSessionForProject,
    onRefreshProjectSessions,
    onQueueingEnabledChange,
    onOpenThread,
    onOpenTurnDiffReview,
    onOpenTurnDiffFileInSidePanel,
    onForkSessionFromTurn,
    currentSessionProjectId: projectId,
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
    onOpenPlanInSidePanel,
    onClosePlanSidePanel,
    onRequestRenameThread,
    selectedCollaborationMode,
    setSelectedCollaborationMode,
  }), [
    codexControl,
    accountActions,
    onEnsureBlankSessionForProject,
    onRefreshProjectSessions,
    onQueueingEnabledChange,
    onOpenThread,
    onOpenTurnDiffReview,
    onOpenTurnDiffFileInSidePanel,
    onForkSessionFromTurn,
    onRequestProjectPickerOpen,
    onOpenLocalEnvironmentsSettings,
    onOpenSideChat,
    onOpenMcpAppSidePanel,
    onOpenPlanInSidePanel,
    onClosePlanSidePanel,
    onRequestRenameThread,
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
        threadStartProgress={threadStartProgress}
        activeThreadId={summary?.threadId ?? null}
        activeThreadSummary={summary}
        availableModels={codexControl.availableModels}
        collaborationModes={collaborationModes}
        selectedCollaborationMode={selectedCollaborationMode}
        selectedModel={codexControl.threadSettings.model ?? ""}
        selectedReasoningEffort={codexControl.threadSettings.reasoningEffort ?? "medium"}
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
        planSidePanelState={planSidePanelState}
        rightPanelComposerOverlayEnabled={rightPanelComposerOverlayEnabled}
        rightPanelComposerOverlayTarget={rightPanelComposerOverlayTarget}
        turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
        actions={actions}
      />
    </div>
  );
}

function makeThreadSummary(thread: ProjectSessionThreadLink): CodexThreadSummary {
  return {
    threadId: thread.threadId,
    projectId: thread.projectId,
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
  onRefreshSessions,
  onRecreateSideChat,
  onOpenMcpAppSidePanel,
  threadQueueFollowUpsEnabled,
  composerEnterBehavior,
  onQueueingEnabledChange,
  onOpenThread,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  turnDiffHoverPreviewDisabled,
}: {
  tab: SideChatPanelTab;
  activeSession: ProjectSession;
  projects: Project[];
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  onRecreateSideChat: () => void;
  onOpenMcpAppSidePanel: ThreadStageActions["onOpenMcpAppSidePanel"];
  threadQueueFollowUpsEnabled: boolean;
  composerEnterBehavior: ComposerEnterBehavior;
  onQueueingEnabledChange: ThreadStageActions["onQueueingEnabledChange"];
  onOpenThread: ThreadStageActions["onOpenThread"];
  onOpenTurnDiffReview: ThreadStageActions["onOpenTurnDiffReview"];
  onOpenTurnDiffFileInSidePanel: NonNullable<ThreadStageActions["onOpenTurnDiffFileInSidePanel"]>;
  turnDiffHoverPreviewDisabled: boolean;
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
    onEnsureBlankSessionForProject: async () => activeSession,
    onRefreshProjectSessions: onRefreshSessions,
    onQueueingEnabledChange,
    onOpenThread,
    onOpenTurnDiffReview,
    onOpenTurnDiffFileInSidePanel,
    currentSessionProjectId: activeSession.projectId ?? tab.projectId,
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
    onOpenMcpAppSidePanel,
    onOpenThread,
    onOpenTurnDiffReview,
    onOpenTurnDiffFileInSidePanel,
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
        isQueueingEnabled={threadQueueFollowUpsEnabled}
        composerEnterBehavior={composerEnterBehavior}
        searchOpenTick={0}
        summaryPanelMounted={false}
        summaryPanelOpen={false}
        summaryPanelHideImmediately={false}
        summaryPanelContentShift={0}
        sideChatContext={{
          parentThreadId: tab.parentThreadId,
          tabTitle: tab.title,
        }}
        turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
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
  onEnsureBlankSessionForProject,
  onRefreshSessions,
  onCloseTab,
  onCreateTerminalTab,
  onOpenThread,
  cardStageHistoryModal,
  onToggleCardStageHistoryModal,
  selectedTurnDiffReviewTarget,
  browserBoundsSyncTrigger,
  isActivePanelTab,
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
  onEnsureBlankSessionForProject: (
    projectId: string,
    options?: { select?: boolean },
  ) => Promise<ProjectSession>;
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  onCloseTab: (tabId: string) => Promise<void>;
  onCreateTerminalTab: (panelId: PanelId, leafId: string) => Promise<void> | void;
  onOpenThread: (threadId: string) => Promise<void>;
  cardStageHistoryModal: CardStageHistoryModalContext | null;
  onToggleCardStageHistoryModal: (context: CardStageHistoryModalContext) => void;
  selectedTurnDiffReviewTarget: CodexTurnDiffReviewTarget | null;
  browserBoundsSyncTrigger?: MotionValue<number>;
  isActivePanelTab: boolean;
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
        sessionThread={activeSession.thread ? makeThreadSummary(activeSession.thread) : null}
        canStartThreadInSession={
          !activeSession.thread
          && activeSession.projectId === cardTab.config.projectId
        }
        onLeaveCard={onLeaveCardStageCard}
        onClose={() => void onCloseTab(tab.id)}
        onOpenTerminal={async () => {
          const sessionProjectId = activeSession.projectId;
          if (sessionProjectId === null) return;
          const terminalSessionId = makeTerminalSessionId(activeSession.id);
          await invoke("project-session-tabs:create", {
            sessionId: activeSession.id,
            projectId: sessionProjectId,
            panelId: "bottom",
            clientTabId: makeClientTerminalTabId(terminalSessionId),
            kind: "terminal",
            title: "Terminal",
            config: {
              projectId: cardTab.config.projectId,
              terminalSessionId,
            },
          });
          await invoke("project-session-panels:update", activeSession.id, "bottom", { collapsed: false });
          await onRefreshSessions(sessionProjectId);
        }}
        onEnsureBlankSessionForProject={onEnsureBlankSessionForProject}
        onRefreshSessions={onRefreshSessions}
        onOpenThread={onOpenThread}
        historyPanelActive={Boolean(
          cardStageHistoryModal
          && cardStageHistoryModal.sessionId === activeSession.id
          && cardStageHistoryModal.tabId === cardTab.id
          && cardStageHistoryModal.projectId === cardTab.config.projectId
          && cardStageHistoryModal.cardId === cardTab.config.cardId,
        )}
        onToggleHistoryPanel={onToggleCardStageHistoryModal}
        isActivePanelTab={isActivePanelTab}
      />
    );
  }

  if (tab.kind === "terminal" && "terminalSessionId" in tab.config) {
    const cwd = resolveSessionTerminalCwd(activeSession, tab, projects);
    const leafId = resolveLeafIdForPanelTab(activeSession, tab.panelId, tab.id);
    return (
      <div className="h-full min-h-0 bg-token-main-surface-primary">
        <TerminalPanel
          terminalId={tab.config.terminalSessionId}
          cwd={cwd}
          conversationId={activeSession.thread?.threadId ?? activeSession.id}
          projectSessionId={activeSession.id}
          projectId={tab.config.projectId}
          onNewTerminalTab={() => {
            void onCreateTerminalTab(tab.panelId, leafId);
          }}
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
        activeForContentSearch={isActivePanelTab}
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
  sessionThread,
  canStartThreadInSession,
  onLeaveCard,
  onClose,
  onOpenTerminal,
  onEnsureBlankSessionForProject,
  onRefreshSessions,
  onOpenThread,
  historyPanelActive,
  onToggleHistoryPanel,
  isActivePanelTab,
}: {
  tab: ProjectSessionTab & { config: { projectId: string; cardId: string; titleSnapshot?: string } };
  project: Project | null;
  closeRef: React.RefObject<(() => Promise<void>) | null>;
  persistRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  sessionSnapshotRef?: React.MutableRefObject<CardStageSessionSnapshot | null>;
  sessionId: string;
  sessionThread: CodexThreadSummary | null;
  canStartThreadInSession: boolean;
  onLeaveCard: (snapshot: CardStageSessionSnapshot) => void;
  onClose: () => void;
  onOpenTerminal: (card: Card) => Promise<void>;
  onEnsureBlankSessionForProject: (
    projectId: string,
    options?: { select?: boolean },
  ) => Promise<ProjectSession>;
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  onOpenThread: (threadId: string) => Promise<void>;
  historyPanelActive: boolean;
  onToggleHistoryPanel: (context: CardStageHistoryModalContext) => void;
  isActivePanelTab: boolean;
}) {
  const kanban = useKanban({ projectId: tab.config.projectId, sessionId: tab.id });
  const refreshBoard = kanban.refresh;
  const codexControl = useCodexAppServerControl(tab.config.projectId);

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  const cardSummary = kanban.cardIndex.get(tab.config.cardId) ?? null;
  const detail = useCardDetail(
    tab.config.projectId,
    tab.config.cardId,
    cardSummary?.status,
    cardSummary?.revision,
  );
  const card = detail.card;
  const cardLoadError = !card && detail.error && detail.error !== "Card not found"
    ? detail.error
    : null;
  const cardHydrating = !card && (
    kanban.loading
    || detail.loading
    || !detail.error
  );
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const column of kanban.board?.columns ?? []) {
      for (const item of column.cards) {
        item.tags.forEach((tag) => tags.add(tag));
      }
    }
    return [...tags].sort((left, right) => left.localeCompare(right));
  }, [kanban.board?.columns]);
  const handleStartNewSessionThreadFromEditor = useCallback(async (input: {
    projectId: string;
    targetSessionId?: string;
    prompt: string;
    promptInput?: CodexPromptInput;
    threadName?: string;
  }) => {
    const targetSessionId = input.targetSessionId?.trim()
      || (await onEnsureBlankSessionForProject(input.projectId, { select: false })).id;
    const detail = await codexControl.startThreadForSession({
      projectId: input.projectId,
      sessionId: targetSessionId,
      prompt: input.prompt,
      promptInput: input.promptInput,
      threadName: input.threadName,
      skipAutoTitleGeneration: Boolean(input.threadName?.trim()),
      runInTarget: "localProject",
    });
    await onRefreshSessions(input.projectId);
    await codexControl.loadThreads(input.projectId);
    return {
      threadId: detail.threadId,
      sessionId: targetSessionId,
    };
  }, [codexControl, onEnsureBlankSessionForProject, onRefreshSessions]);

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

  if (cardHydrating) {
    return <CardStageSessionSkeleton titleSnapshot={tab.config.titleSnapshot} />;
  }

  if (cardLoadError) {
    return (
      <CardStageSessionNotice
        title="Could not load card"
        description={tab.config.titleSnapshot
          ? `Nodex could not load ${tab.config.titleSnapshot} in ${project.name}. ${cardLoadError}`
          : `Nodex could not load this card in ${project.name}. ${cardLoadError}`}
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

  return (
    <>
      <CardStage
        card={card}
        columnId={columnId}
        columnName={columnName}
        projectId={tab.config.projectId}
        projectName={project.name}
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
        isActivePanelTab={isActivePanelTab}
        sessionId={sessionId}
        sessionThread={sessionThread}
        canStartThreadInSession={canStartThreadInSession}
        linkedCodexThreads={[]}
        onOpenCodexThread={onOpenThread}
        onStartNewSessionThreadFromEditor={handleStartNewSessionThreadFromEditor}
        onSendThreadSectionPrompt={async ({ projectId, threadId, prompt, promptInput }) => {
          await codexControl.startTurn(threadId, prompt, { projectId, promptInput });
        }}
      />
    </>
  );
}

function CardStageSkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-token-foreground/5", className)}
      aria-hidden="true"
    />
  );
}

function CardStageSessionSkeleton({ titleSnapshot }: { titleSnapshot?: string }) {
  const title = titleSnapshot?.trim();
  const label = titleSnapshot?.trim()
    ? `Loading ${titleSnapshot}`
    : "Loading card";
  const limitMainContentWidth = readCardStageContentWidthPreference();
  const contentBodyClassName = cn(
    "mx-auto w-full px-(--card-stage-body-gutter-inline)",
    limitMainContentWidth && "max-w-(--card-stage-body-max-width)",
  );
  const contentShellClassName = cn(
    "w-full",
  );

  return (
    <div
      className="flex h-full w-full flex-col bg-(--background) select-none"
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <CardStageToolbar
        saving={false}
        disabled={true}
        historyPanelActive={false}
        limitMainContentWidth={limitMainContentWidth}
        showRawContent={false}
        onClose={() => undefined}
        onDelete={() => undefined}
        onToggleContentWidth={() => undefined}
        onToggleShowRawContent={() => undefined}
        onToggleHistoryPanel={() => undefined}
      />

      <div
        className="scrollbar-token min-h-0 flex-1 overflow-y-auto"
        style={RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE}
      >
        <div
          className={contentBodyClassName}
          data-card-stage-body="true"
          data-card-stage-body-width={limitMainContentWidth ? "constrained" : "full"}
        >
          <div className={contentShellClassName}>
            <div className="h-toolbar-sm" />

            {title ? (
              <div
                className={cn(
                  "min-h-8 w-full px-0.5 pt-0.75",
                  "text-xl/snug-plus font-bold text-(--foreground)",
                )}
              >
                {title}
              </div>
            ) : (
              <CardStageSkeletonBlock className="h-8 w-3/4 max-w-xl" />
            )}

            <div className="h-2" />

            <div className="mb-3" aria-hidden="true">
              <div className="grid w-fit grid-cols-[auto_auto_auto_auto] gap-x-4 gap-y-1">
                {["Priority", "Status", "Estimates", "Due date"].map((property) => (
                  <div key={property} className="flex h-6 items-center">
                    <div className="flex items-center gap-0.5 rounded-sm px-1.5">
                      <CardStageSkeletonBlock className="h-3.5 w-3.5 rounded-sm" />
                      <span className="text-sm/4.5 font-medium text-(--foreground-secondary)">
                        {property}
                      </span>
                    </div>
                  </div>
                ))}
                <div className="flex h-7.5 items-center px-1.5">
                  <CardStageSkeletonBlock className="h-5 w-14 rounded-sm" />
                </div>
                <div className="flex h-7.5 items-center px-1.5">
                  <CardStageSkeletonBlock className="h-5 w-24 rounded-sm" />
                </div>
                <div className="flex h-7.5 items-center px-1.5">
                  <CardStageSkeletonBlock className="h-5 w-14 rounded-sm" />
                </div>
                <div className="flex h-7.5 items-center px-1.5">
                  <CardStageSkeletonBlock className="h-5 w-18 rounded-sm" />
                </div>
              </div>
            </div>

            <div className="pt-2 pb-8" aria-hidden="true">
              <div className="space-y-2.5">
                <CardStageSkeletonBlock className="h-4 w-full" />
                <CardStageSkeletonBlock className="h-4 w-11/12" />
                <CardStageSkeletonBlock className="h-4 w-4/5" />
                <div className="h-2" />
                <CardStageSkeletonBlock className="h-4 w-10/12" />
                <CardStageSkeletonBlock className="h-4 w-7/12" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
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
