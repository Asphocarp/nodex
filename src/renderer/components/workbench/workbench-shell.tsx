import {
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
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion, useTransform, type MotionStyle, type MotionValue } from "motion/react";
import {
  ArrowLeft,
  CalendarDays,
  Globe2,
  PenLine,
  Plus,
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
import { TerminalPanel } from "./workbench-terminal-panel";
import { SettingsRouteShell } from "./workbench-settings-overlay";
import { buildSettingsPath } from "./workbench-settings-routes";
import { ProjectManagerPopover } from "./left-sidebar-project-manager";
import { LeftSidebarFooter } from "./left-sidebar-footer";
import { NodexDropdownFlyoutSubmenuItem, NodexDropdownItem, NodexDropdownMenu } from "@/components/ui/dropdown";
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
import { invoke, subscribeProjectSessionChanges } from "@/lib/api";
import { useKanban } from "@/lib/use-kanban";
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
  CodexThreadSummary,
  CodexPromptInput,
  PanelId,
  Project,
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
import type { ThreadStageActions } from "@/features/local-conversation";
import type { ThreadSummaryPanelAuxiliaryRow } from "@/features/local-conversation/thread-stage-types";
import {
  getDefaultDbViewPrefs,
  viewSupportsDbViewPrefs,
  type DbViewPrefs,
  type SupportedDbView,
} from "@/lib/db-view-prefs";
import type { SpaceRef, WorkbenchView } from "@/lib/use-workbench-state";
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
  CODEX_SIDEBAR_FLOATING_OUTER_CLASS,
  CODEX_SIDEBAR_POINTER_DEFAULT,
  CODEX_SIDEBAR_WIDTH_DEFAULT_PX,
  CODEX_SIDEBAR_WIDTH_MIN_PX,
  clampCodexSidebarWidth,
  deriveCodexSidebarFloatingVisibility,
  getCodexSidebarFloatingTransition,
  normalizeCodexSidebarPointer,
  shouldAnimateCodexSidebarToggle,
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
  CodexSidebarActionButton,
  CodexSidebarSection,
  CodexSidebarTopAction,
  CodexThreadRow,
  resolveCodexNewChatShortcutLabel,
} from "./codex-sidebar";
import {
  resolveWorkbenchNavigationShortcutLabel,
  WORKBENCH_NAVIGATION_COMMANDS,
  type WorkbenchNavigationCommandRequest,
  type WorkbenchNavigationCommandState,
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

const MAC_TRAFFIC_LIGHT_SAFE_HEADER_LEFT_PX = 90;
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
const PREVIEWABLE_PROJECT_SESSION_TAB_KIND_SET = new Set<ProjectSessionTab["kind"]>([
  "browser_placeholder",
  "files_placeholder",
]);
const PANEL_ACTION_CARD_CLASS = "cursor-interaction min-h-32 w-full max-w-[330px] rounded-xl bg-token-bg-secondary px-4 py-6 text-center hover:bg-token-list-hover-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-token-border-xstrong";
const PANEL_ACTION_KBD_CLASS = "inline-flex !rounded-md !border-0 !bg-current/10 !font-sans !text-xs !text-current !shadow-none !px-1.5 !py-0.5 !leading-none";
const DB_VIEW_TABS: Array<{ id: ProjectSessionDbView; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "kanban", label: "Board", icon: SquareKanban },
  { id: "list", label: "Table", icon: Table2 },
  { id: "toggle-list", label: "List", icon: ToggleListIcon },
  { id: "canvas", label: "Canvas", icon: PenLine },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

type PanelActionShortcut = "mod+p" | "mod+t" | "ctrl+shift+g" | "ctrl+backquote";

interface PanelNewTabAction {
  kind: ProjectSessionTab["kind"];
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

type ProjectSessionRenderableTab = DurableProjectSessionRenderableTab | SideChatPanelTab;

type ProjectSessionTabDraft = Pick<ProjectSessionTabCreateInput, "kind" | "title" | "config">;

const PANEL_NEW_TAB_ACTIONS: PanelNewTabAction[] = [
  {
    kind: "files_placeholder",
    defaultPanelId: "right",
    targetPanelIds: ["right", "bottom"],
    label: "Files",
    description: "Browse project files",
    shortcut: "mod+p",
    Icon: CodexSidePanelFilesIcon,
  },
  {
    kind: "side_chat_placeholder",
    defaultPanelId: "right",
    targetPanelIds: ["right", "bottom"],
    label: "Side chat",
    description: "Start a side conversation",
    Icon: CodexSidePanelSideChatIcon,
  },
  {
    kind: "browser_placeholder",
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
  projectPickerOpenTick?: unknown;
  taskSearchOpenTick?: unknown;
  diffSearchOpenTick?: unknown;
  commandPaletteOpenTick?: unknown;
  commandPaletteInitialQuery?: unknown;
  settingsToggleTick?: unknown;
  sidebarToggleRequestTick?: number;
  sidebarToggleRequestSource?: WorkbenchSidebarToggleCommandSource;
  navigationCommandRequest?: WorkbenchNavigationCommandRequest | null;
  onNavigationStateChange?: (state: WorkbenchNavigationCommandState) => void;
  navigateToStage?: unknown;
  navigateToDbView?: unknown;
  navigateToRecentSession?: unknown;
  navigateToCardsTab?: unknown;
  navigateToThreadTab?: unknown;
  navigateToFilesTab?: unknown;
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
  if (kind === "terminal") return CodexSidePanelTerminalIcon;
  if (kind === "browser_placeholder") return CodexSidePanelBrowserIcon;
  if (kind === "review") return CodexSidePanelReviewIcon;
  if (kind === "files_placeholder") return CodexSidePanelFilesIcon;
  if (kind === "side_chat_placeholder") return CodexSidePanelSideChatIcon;
  return Globe2;
}

function isPanelActionTargetAllowed(action: PanelNewTabAction, panelId: PanelId): boolean {
  return action.targetPanelIds?.includes(panelId) ?? action.defaultPanelId === panelId;
}

function filterAvailablePanelActions(
  actions: readonly PanelNewTabAction[],
  tabs: readonly ProjectSessionTab[],
  panelId: PanelId,
): PanelNewTabAction[] {
  return actions.filter((action) => {
    if (!isPanelActionTargetAllowed(action, panelId)) return false;
    if (!PROJECT_SESSION_SINGLETON_TAB_KIND_SET.has(action.kind)) return true;
    return !tabs.some((tab) => tab.kind === action.kind);
  });
}

function normalizeOptionalPath(value: string | null | undefined): string | undefined {
  const trimmedValue = value?.trim();
  if (!trimmedValue) return undefined;
  return trimmedValue;
}

function resolveSessionTerminalCwd(
  session: ProjectSession,
  tab: ProjectSessionTab,
  projects: readonly Project[],
): string | undefined {
  const threadCwd = normalizeOptionalPath(session.thread?.cwd);
  if (threadCwd) return threadCwd;

  const tabProjectId = "projectId" in tab.config ? tab.config.projectId : session.projectId;
  return normalizeOptionalPath(projects.find((project) => project.id === tabProjectId)?.workspacePath)
    ?? normalizeOptionalPath(projects.find((project) => project.id === session.projectId)?.workspacePath);
}

function resolvePanelShortcutLabel(shortcut: PanelActionShortcut | undefined, isMac: boolean): string | null {
  if (!shortcut) return null;
  if (shortcut === "mod+p") return isMac ? "⌘P" : "Ctrl+P";
  if (shortcut === "mod+t") return isMac ? "⌘T" : "Ctrl+T";
  if (shortcut === "ctrl+shift+g") return "⌃⇧G";
  return "⌃`";
}

function matchesPanelShortcut(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  shortcut: PanelActionShortcut,
  isMac: boolean,
): boolean {
  const key = event.key.toLowerCase();
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  if (shortcut === "mod+p") return modifier && !event.altKey && !event.shiftKey && key === "p";
  if (shortcut === "mod+t") return modifier && !event.altKey && !event.shiftKey && key === "t";
  if (shortcut === "ctrl+shift+g") {
    return event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey && key === "g";
  }
  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === "`" || event.code === "Backquote");
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

function makeSideChatPanelKey(sessionId: string, panelId: PanelId, leafId?: string | null): string {
  return leafId ? `${sessionId}:${panelId}:${leafId}` : `${sessionId}:${panelId}`;
}

function isSideChatPanelTab(tab: ProjectSessionRenderableTab): tab is SideChatPanelTab {
  return "sideChat" in tab && tab.sideChat === true;
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

  if (kind === "files_placeholder") {
    return {
      kind,
      title: "Files",
      config: { projectId: session.projectId },
    };
  }

  if (kind === "side_chat_placeholder") {
    return {
      kind,
      title: "Side chat",
      config: { projectId: session.projectId },
    };
  }

  if (kind === "browser_placeholder") {
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
  onRenameProject,
  onDeleteProject,
  onRequestProjectPickerOpen,
  threadSearchOpenTick,
  setSidebarCollapsed,
  setSidebarWidth,
  setSidebarTopLevelSectionVisible,
  settingsToggleTick,
  sidebarToggleRequestTick = 0,
  sidebarToggleRequestSource = "keyboard_shortcut",
  navigationCommandRequest = null,
  onNavigationStateChange,
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
  const [panelCollapsedOverrides, setPanelCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [rightPanelDragWidth, setRightPanelDragWidth] = useState<number | null>(null);
  const [sessionContentWidth, setSessionContentWidth] = useState(0);
  const [sessionContentHeight, setSessionContentHeight] = useState(0);
  const [appShellWidth, setAppShellWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  const [rootFontSizePx, setRootFontSizePx] = useState(readCodexRootFontSize);
  const [headerLeftWidth, setHeaderLeftWidth] = useState(0);
  const [, setHeaderLeftRailWidth] = useState(0);
  const [headerRightWidth, setHeaderRightWidth] = useState(RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX);
  const [headerRightRailWidth, setHeaderRightRailWidth] = useState(RIGHT_PANEL_HEADER_FALLBACK_RAIL_WIDTH_PX);
  const [threadHeaderPortalElement, setThreadHeaderPortalElement] = useState<HTMLDivElement | null>(null);
  const [threadSummaryPanelPinnedOpen, setThreadSummaryPanelPinnedOpen] = useState(readThreadSummaryPanelPinnedOpen);
  const [threadSummaryPanelPopoverOpen, setThreadSummaryPanelPopoverOpen] = useState(false);
  const [localSidebarCollapsed, setLocalSidebarCollapsed] = useState(false);
  const [localSidebarWidth, setLocalSidebarWidth] = useState(CODEX_SIDEBAR_WIDTH_DEFAULT_PX);
  const [sidebarPointer, setSidebarPointer] = useState<CodexSidebarPointerSnapshot>(CODEX_SIDEBAR_POINTER_DEFAULT);
  const [floatingSidebarVisible, setFloatingSidebarVisible] = useState(false);
  const [sidebarHoverSuppressed, setSidebarHoverSuppressed] = useState(false);
  const [sidebarTriggerHovered, setSidebarTriggerHovered] = useState(false);
  const [sidebarClickInFlight, setSidebarClickInFlight] = useState(false);
  const [sidebarAnimateLayout, setSidebarAnimateLayout] = useState(true);
  const [appShellFocusAreaActive, setAppShellFocusAreaActive] = useState(false);
  const [sidebarTaskSearchOpenTick, setSidebarTaskSearchOpenTick] = useState(0);
  const [projectsSectionCollapsed, setProjectsSectionCollapsed] = useState(false);
  const [shellNavigationHistory, setShellNavigationHistory] = useState(readWorkbenchShellNavigationHistoryState);
  const workbenchRootRef = useRef<HTMLDivElement | null>(null);
  const sessionContentRef = useRef<HTMLDivElement | null>(null);
  const pinningPreviewTabIdsRef = useRef<Set<string>>(new Set());
  const sidebarPointerRef = useRef<CodexSidebarPointerSnapshot>(CODEX_SIDEBAR_POINTER_DEFAULT);
  const lastHandledSidebarToggleRequestTickRef = useRef(sidebarToggleRequestTick);
  const lastHandledNavigationCommandTickRef = useRef(navigationCommandRequest?.tick ?? 0);
  const currentShellNavigationSnapshotRef = useRef<WorkbenchShellNavigationSnapshot | null>(null);
  const applyingShellNavigationRef = useRef(false);
  const shellAtMediumWidthRef = useRef(false);
  const shellAtNarrowWidthRef = useRef(false);
  const sidebarCollapsed = sidebar?.collapsed ?? localSidebarCollapsed;
  const sidebarWidth = sidebar?.width ?? localSidebarWidth;
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
  const rightPanel = activeSession?.panels.right ?? null;
  const bottomPanel = activeSession?.panels.bottom ?? null;
  const rightPanelTabs = activeSession?.tabs.filter((tab) => tab.panelId === "right") ?? [];
  const bottomPanelTabs = activeSession?.tabs.filter((tab) => tab.panelId === "bottom") ?? [];
  const rightActiveLeafId = activeSession ? resolveSessionPanelActiveLeafId(activeSession, "right") : "main";
  const bottomActiveLeafId = activeSession ? resolveSessionPanelActiveLeafId(activeSession, "bottom") : "main";
  const rightPreviewTab = activeSession
    ? previewTabsByPanel[makePanelPreviewKey(activeSession.id, "right", rightActiveLeafId)]
      ?? previewTabsByPanel[makePanelPreviewKey(activeSession.id, "right")]
      ?? null
    : null;
  const bottomPreviewTab = activeSession
    ? previewTabsByPanel[makePanelPreviewKey(activeSession.id, "bottom", bottomActiveLeafId)]
      ?? previewTabsByPanel[makePanelPreviewKey(activeSession.id, "bottom")]
      ?? null
    : null;
  const activeSessionSideChatTabs = activeSession ? sideChatTabsBySession[activeSession.id] ?? [] : [];
  const rightSideChatTabs = activeSessionSideChatTabs.filter((tab) => tab.panelId === "right");
  const bottomSideChatTabs = activeSessionSideChatTabs.filter((tab) => tab.panelId === "bottom");
  const rightRenderableTabs: ProjectSessionRenderableTab[] = rightPreviewTab
    ? [...rightPanelTabs, ...rightSideChatTabs, rightPreviewTab]
    : [...rightPanelTabs, ...rightSideChatTabs];
  const bottomRenderableTabs: ProjectSessionRenderableTab[] = bottomPreviewTab
    ? [...bottomPanelTabs, ...bottomSideChatTabs, bottomPreviewTab]
    : [...bottomPanelTabs, ...bottomSideChatTabs];
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
  const rightActiveTabId = rightPreviewTab?.id
    ?? (rightSideChatActiveTabId && rightRenderableTabs.some((tab) => tab.id === rightSideChatActiveTabId)
      ? rightSideChatActiveTabId
      : rightPanel ? getProjectSessionPanelActiveLeaf(rightPanel.layout).activeTabId : null)
    ?? rightRenderableTabs[0]?.id
    ?? null;
  const bottomActiveTabId = bottomPreviewTab?.id
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
  const rightPanelFullWidth = Boolean(
    activeSession && sidePanelOpen && (rightPanel?.size.fullWidth ?? activeSession.isOverview),
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
    bottomPanel?.size.heightPx ?? BOTTOM_PANEL_DEFAULT_HEIGHT,
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
    const cards: Array<{ card: Card; columnName: string }> = [];
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
  const headerLeftShellSlotWidth = realSidebarMounted ? realSidebarMotion.animatedSize : effectiveHeaderLeftWidth;
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
      projectWorkspacePath: project?.workspacePath ?? null,
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
      projectWorkspacePath: project?.workspacePath ?? null,
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
    const previewTab = previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId, leafId)]
      ?? (leafId === activeLeafId ? previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId)] : null)
      ?? null;
    const previewCount = previewTab && previewTab.id !== excludedTabId ? 1 : 0;
    return durableCount + sideChatCount + previewCount;
  }, [activeSession, previewTabsByPanel, sideChatTabsBySession]);

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

  const closePanelTab = useCallback(async (panelId: PanelId, tabId: string, leafId?: string) => {
    if (!activeSession) return;
    const previewTab = (leafId ? previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId, leafId)] : null)
      ?? previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId)];
    if (previewTab?.id === tabId) {
      await closePreviewTab(panelId, leafId);
      return;
    }
    if ((sideChatTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      await closeSideChatPanelTab(panelId, tabId);
      return;
    }

    const targetLeafId = leafId ?? resolveLeafIdForPanelTab(activeSession, panelId, tabId);
    const preserveEmptyLeafIds = getPreserveEmptyLeafIdsAfterDurableRemoval(panelId, targetLeafId, tabId);
    await closeTab(tabId, { preserveEmptyLeafIds });
    if (preserveEmptyLeafIds.length > 0) {
      await updateActivePanel(panelId, { collapsed: false });
    }
  }, [
    activeSession,
    closePreviewTab,
    closeSideChatPanelTab,
    closeTab,
    getPreserveEmptyLeafIdsAfterDurableRemoval,
    previewTabsByPanel,
    sideChatTabsBySession,
    updateActivePanel,
  ]);

  const selectPanelTab = useCallback(async (panelId: PanelId, tabId: string, leafId?: string) => {
    if (!activeSession) return;
    const targetLeafId = leafId ?? resolveLeafIdForPanelTab(activeSession, panelId, tabId);
    const previewTab = previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId, targetLeafId)]
      ?? previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId)];
    if (previewTab?.id === tabId) return;
    if ((sideChatTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
      setSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeSideChatPanelKey(activeSession.id, panelId, targetLeafId)]: tabId,
      }));
      return;
    }
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
  }, [activeSession, clearPanelPreviewTab, previewTabsByPanel, setActivePanelTab, sideChatTabsBySession]);

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
      await invoke("project-session-tabs:create", {
        sessionId: activeSession.id,
        projectId: activeSession.projectId,
        panelId,
        kind: previewTab.kind,
        title: previewTab.title,
        config: previewTab.config,
      });
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

  const openCardTab = useCallback(async (projectId: string, cardId: string, titleSnapshot?: string) => {
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
      await updateActivePanel("right", {
        collapsed: false,
        size: { ...activeSession.panels.right.size, fullWidth: false },
      });
      await setActivePanelTab("right", existing.id, { openPanel: true });
      return;
    }

    await invoke("project-session-tabs:create", {
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
      panelId: "right",
      kind: "card_stage",
      title: titleSnapshot || cardId,
      config: { projectId, cardId, titleSnapshot },
    });
    await ensureActivePanelOpenWithoutRefresh("right");
    await refreshProjectSessions(activeSession.projectId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh, openCardStage, refreshProjectSessions, setActivePanelTab, updateActivePanel]);

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

  const showSidebarUnavailableProduct = useCallback((label: string) => {
    toast.info(`${label} is not available in Nodex yet.`, {
      id: `sidebar-${label.toLowerCase()}-unavailable`,
    });
  }, []);

  const toggleProjectsSectionCollapsed = useCallback(() => {
    setProjectsSectionCollapsed((current) => !current);
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

  const openCardStageFromPicker = useCallback(async (card: Card) => {
    if (!activeSession) return;
    await openCardTab(activeSession.projectId, card.id, card.title || card.id);
  }, [activeSession, openCardTab]);

  const handleRightPanelShortcut = useEffectEvent((event: KeyboardEvent): boolean => {
    if (!activeSession) return false;
    if (isWorkbenchNewChatShortcutTargetEditable(event.target)) return false;

    const action = PANEL_NEW_TAB_ACTIONS.find((candidate) =>
      candidate.shortcut ? matchesPanelShortcut(event, candidate.shortcut, isMacPlatform) : false,
    );
    if (!action) return false;

    if (action.kind === "terminal") {
      void focusOrCreateSessionTerminalTab();
      return true;
    }

    if (action.kind === "side_chat_placeholder") {
      void openSideChat({ targetPanelId: action.defaultPanelId });
      return true;
    }

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

  const resizeRightPanel = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const root = workbenchRootRef.current;
    const windowZoom = readCodexWindowZoom(root);
    const sizingWidth = rightPanelSizingWidth;
    const startX = event.clientX / windowZoom;
    const startWidth = regularRightPanelWidth;

    let latestWidth = startWidth;
    let closedByResize = false;
    setRightPanelDragWidth(startWidth);
    const onMouseMove = (moveEvent: MouseEvent) => {
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

    const onMouseUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
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

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [activeSession, regularRightPanelWidth, rightPanelSizingWidth, setActivePanelCollapsed, updateActivePanel]);

  const resizeBottomPanel = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const root = workbenchRootRef.current;
    const windowZoom = readCodexWindowZoom(root);
    const startY = event.clientY / windowZoom;
    const startHeight = bottomPanelHeight;
    let latestHeight = startHeight;
    let closedByResize = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (closedByResize) return;
      const pointerY = moveEvent.clientY / windowZoom;
      const rawHeight = startHeight + startY - pointerY;
      if (rawHeight < BOTTOM_PANEL_MIN_HEIGHT) {
        closedByResize = true;
        latestHeight = BOTTOM_PANEL_MIN_HEIGHT;
        void setActivePanelCollapsed("bottom", true);
        return;
      }

      const nextHeight = clampBottomPanelHeight(rawHeight, sessionContentHeight);
      latestHeight = nextHeight;
      if (activeSession) {
        void updateActivePanel("bottom", {
          size: {
            ...activeSession.panels.bottom.size,
            heightPx: nextHeight,
          },
        }, { refresh: false });
      }
    };

    const onMouseUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (activeSession) {
        if (closedByResize) return;
        void updateActivePanel("bottom", {
          size: {
            ...activeSession.panels.bottom.size,
            heightPx: latestHeight,
          },
        });
      }
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [activeSession, bottomPanelHeight, sessionContentHeight, setActivePanelCollapsed, updateActivePanel]);

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
    const makeItem = (tab: ProjectSessionRenderableTab): AppShellTabItem => ({
      id: tab.id,
      title: tab.title,
      icon: isSideChatPanelTab(tab) ? CodexSidePanelSideChatIcon : getTabIcon(tab.kind),
      closable: isSideChatPanelTab(tab)
        ? tab.status !== "loading"
        : tab.preview === true || !activeSession.isOverview || activeSession.tabs.length > 1,
      preview: isSideChatPanelTab(tab) ? undefined : tab.preview,
      reorderable: isSideChatPanelTab(tab) ? false : tab.preview === true ? false : true,
      splittable: !isSideChatPanelTab(tab) && tab.preview !== true,
      renderPanel: () => isSideChatPanelTab(tab) ? (
        <SideChatSessionTab
          key={`${activeSession.id}:${tab.id}:${tab.stateKey}`}
          tab={tab}
          activeSession={activeSession}
          projects={projects}
          onOpenCardTab={openCardTab}
          onRefreshSessions={refreshProjectSessions}
          onRecreateSideChat={() => void recreateSideChatPanelTab(tab.id)}
        />
      ) : (
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
          onRefreshSessions={refreshProjectSessions}
          onCloseTab={closeTab}
          onOpenSideChat={() => void openSideChat({ targetPanelId: tab.panelId })}
        />
      ),
    });
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
        const previewTab = previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === activeLeafId ? previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId)] : null)
          ?? null;
        const renderableTabs: ProjectSessionRenderableTab[] = previewTab
          ? [...durableTabs, ...sideChatTabs, previewTab]
          : [...durableTabs, ...sideChatTabs];
        const sideChatActiveTabId = sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, panelId, leaf.id)]
          ?? (leaf.id === activeLeafId ? sideChatActiveTabByPanel[makeSideChatPanelKey(activeSession.id, panelId)] : null)
          ?? null;
        const activeTabId = previewTab?.id
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
    activeSearchQuery,
    activeSession,
    activeView,
    cardStageCloseRef,
    cardStagePersistRef,
    cardStageSessionSnapshotRef,
    closeTab,
    onLeaveCardStageCard,
    onReminderHandled,
    openSideChat,
    openCardTab,
    pendingReminderOpen,
    projects,
    recreateSideChatPanelTab,
    refreshProjectSessions,
    sidebarTaskSearchOpenTick,
    dbViewPrefsByProject,
    searchByProject,
    setDbViewPrefs,
    setSearchQuery,
    sideChatActiveTabByPanel,
    sideChatTabsBySession,
    previewTabsByPanel,
  ]);

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

  const applySidebarWidth = useCallback((width: number) => {
    if (width < CODEX_SIDEBAR_WIDTH_MIN_PX) {
      setSidebarCollapsedWithCodexState(true);
      return;
    }

    const nextWidth = clampCodexSidebarWidth(width);
    realSidebarMotion.targetSize.set(nextWidth);
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
      setAppShellFocusAreaActive(false);
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
      setSidebarPointer(nextPointer);
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [getWindowZoom]);

  useEffect(() => {
    const updateFocusAreaActive = () => {
      const activeElement = document.activeElement;
      setAppShellFocusAreaActive(
        activeElement instanceof HTMLElement
          && Boolean(activeElement.closest("[data-app-shell-focus-area]")),
      );
    };

    document.addEventListener("focusin", updateFocusAreaActive);
    document.addEventListener("focusout", updateFocusAreaActive);
    updateFocusAreaActive();
    return () => {
      document.removeEventListener("focusin", updateFocusAreaActive);
      document.removeEventListener("focusout", updateFocusAreaActive);
    };
  }, []);

  useEffect(() => {
    if (sidebarHoverSuppressed) {
      if (!shouldClearCodexSidebarHoverSuppression({
        pointerX: sidebarPointer.x,
        triggerHovered: sidebarTriggerHovered,
      })) {
        setFloatingSidebarVisible(false);
        return;
      }
      setSidebarHoverSuppressed(false);
      return;
    }

    setFloatingSidebarVisible((current) => deriveCodexSidebarFloatingVisibility({
      pointerX: sidebarPointer.x,
      leftPanelWidthPx: sidebarWidth,
      sidebarOpen: !sidebarCollapsed,
      sidebarAnimating,
      hoverSuppressed: false,
      focusOverride: appShellFocusAreaActive,
      currentlyVisible: current,
    }));
  }, [
    appShellFocusAreaActive,
    sidebarAnimating,
    sidebarCollapsed,
    sidebarHoverSuppressed,
    sidebarPointer.x,
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
      .filter((tab) => tab.kind === "browser_placeholder")
      .map((tab) => ({
        id: tab.id,
        title: tab.title,
        status: tab.panelId === "right" ? "Right panel" : "Bottom panel",
      }));
    const browserPreviewTabs = Object.values(previewTabsByPanel)
      .filter((tab) => tab.sessionId === activeSession.id && tab.kind === "browser_placeholder")
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
      projectWorkspacePath={activeProject?.workspacePath ?? null}
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
        {actions.map((action) => {
          const Icon = action.Icon;
          if (action.kind === "card_stage") {
            return (
              <NodexDropdownFlyoutSubmenuItem
                key={action.kind}
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
              key={action.kind}
              leftSlot={<Icon className="icon-sm" />}
              keyboardShortcut={resolvePanelShortcutLabel(action.shortcut, isMacPlatform)}
              onSelect={() => {
                if (action.kind === "side_chat_placeholder") {
                  void openSideChat({ targetPanelId: panelId, targetLeafId: leafId });
                  return;
                }
                if (isPreviewableProjectSessionTabKind(action.kind)) {
                  void openPreviewTab(action.kind, panelId, leafId);
                  return;
                }
                void (async () => {
                  await activatePanelGroup(panelId, leafId);
                  await createManualTab(action.kind, panelId);
                })();
              }}
            >
              {action.label}
            </NodexDropdownItem>
          );
        })}
      </NodexDropdownMenu>
    );
  };

  const rightPanelGlobalHeaderInsetWidth = activeSession ? headerRightRailWidth + 40 : 0;
  const bottomPanelGlobalHeaderInsetWidth = activeSession ? 40 : 0;

  const rightPanelGlobalHeaderControls = activeSession ? (
    <>
      <div className="pointer-events-auto flex h-full shrink-0 items-center">
        <ToolbarIconButton
          label={rightPanelFullWidth ? "Restore panel width" : "Expand panel"}
          pressed={rightPanelFullWidth}
          onClick={toggleActiveRightPanelFullWidth}
        >
          {rightPanelFullWidth ? <CodexRestorePanelIcon className="icon-sm" /> : <CodexExpandPanelIcon className="icon-sm" />}
        </ToolbarIconButton>
      </div>
      <div
        aria-hidden="true"
        data-testid="right-panel-tab-bar-header-spacer"
        className="pointer-events-none flex h-full shrink-0 items-center"
        style={{ width: headerRightRailWidth }}
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

  const showFloatingSidebar = sidebarCollapsed && !realSidebarMounted && floatingSidebarVisible;
  const showInlineSidebar = realSidebarMounted;
  const floatingSidebarTransition = getCodexSidebarFloatingTransition(Boolean(reducedMotion));
  const floatingSidebarExitX = reducedMotion ? 0 : -8;
  const floatingSidebarHeaderExitX = reducedMotion ? 0 : 8;
  const floatingSidebarHeader = (
    <motion.div
      className={CODEX_SIDEBAR_FLOATING_HEADER_CLASS}
      initial={{ x: 8 }}
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

  return (
    <HeaderActionProvider actions={settingsPath ? null : headerActions}>
      <NodexTooltipProvider>
        {renameSessionDialog}
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
          <header
            data-testid="workbench-global-header"
            data-app-shell-header-edge-scroll={appShellHeaderEdgeScroll ? "true" : "false"}
            className="app-header-tint draggable pointer-events-none fixed inset-x-0 top-0 z-[42] flex h-toolbar min-w-0 items-center"
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
              projectsSectionCollapsed={projectsSectionCollapsed}
              loadingSessions={loadingSessions}
              width={sidebarWidth}
              animatedWidth={realSidebarMotion.animatedSize}
              contentOpacity={realSidebarMotion.opacity}
              resizeDisabled={sidebarAnimating}
              getWindowZoom={getWindowZoom}
              onResizeWidth={applySidebarWidth}
              onToggleProjectsSectionCollapsed={toggleProjectsSectionCollapsed}
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
              onOpenSessionContextMenu={openSessionContextMenu}
              onToggleSessionPinned={toggleSessionPin}
              onStartNewChatInProject={(projectId) => void startNewChatInProject(projectId)}
              onOpenTaskSearch={openSidebarTaskSearch}
              onShowUnavailableProduct={showSidebarUnavailableProduct}
              onCreateProject={async (...args) => {
                const project = await onCreateProject(...args);
                await refreshAllSessions();
                return project;
              }}
              onRenameProject={onRenameProject ?? (async () => null)}
              onDeleteProject={onDeleteProject ?? (async () => false)}
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
                data-testid="floating-project-session-sidebar-shell"
                className={CODEX_SIDEBAR_FLOATING_OUTER_CLASS}
                style={{ width: sidebarWidth }}
                initial={{ opacity: 0, x: -8 }}
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
                  projectsSectionCollapsed={projectsSectionCollapsed}
                  loadingSessions={loadingSessions}
                  width={sidebarWidth}
                  getWindowZoom={getWindowZoom}
                  onResizeWidth={applySidebarWidth}
                  onToggleProjectsSectionCollapsed={toggleProjectsSectionCollapsed}
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
                  onOpenSessionContextMenu={openSessionContextMenu}
                  onToggleSessionPinned={toggleSessionPin}
                  onStartNewChatInProject={(projectId) => void startNewChatInProject(projectId)}
                  onOpenTaskSearch={openSidebarTaskSearch}
                  onShowUnavailableProduct={showSidebarUnavailableProduct}
                  onCreateProject={async (...args) => {
                    const project = await onCreateProject(...args);
                    await refreshAllSessions();
                    return project;
                  }}
                  onRenameProject={onRenameProject ?? (async () => null)}
                  onDeleteProject={onDeleteProject ?? (async () => false)}
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
                        onOpenCard={(cardId) => {
                          if (!activeProject) return;
                          void openCardTab(activeProject.id, cardId, cardId);
                        }}
                        onOpenSideChat={(input) => openSideChat({ ...input, targetPanelId: "right" })}
                      />
                    </div>
                  </section>

                  {rightPanelMotion.mounted ? (
                    <motion.aside
                      data-app-shell-focus-area="right-panel"
                      data-testid="session-right-panel"
                      data-right-panel-width-mode={rightPanelFullWidth ? "full" : "regular"}
                      className="relative z-[41] ml-auto h-full min-h-0 min-w-0 shrink-0 overflow-visible"
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
                          onMouseDown={resizeRightPanel}
                        >
                          <div className="pointer-events-none m-auto h-full w-px bg-linear-to-b from-transparent via-token-foreground/25 to-transparent opacity-0 group-hover:opacity-100 group-active:opacity-100" />
                        </div>
                      ) : null}

                      <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
                        <div
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
                            headerEndInsetPx={rightPanelGlobalHeaderInsetWidth}
                            renderEmptyLeaf={(leafId) => (
                              <EmptyRightPane
                                actions={availableRightPanelActions}
                                cards={activeProjectCardOptions}
                                isMac={isMacPlatform}
                                onAction={(kind) => {
                                  if (kind === "side_chat_placeholder") {
                                    void openSideChat({ targetPanelId: "right", targetLeafId: leafId });
                                    return;
                                  }
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
                            onActivateGroup={(leafId, tabId) => void activatePanelGroup("right", leafId, tabId)}
                            onResizeGroup={(branchId, ratio) => void resizePanelGroup("right", branchId, ratio)}
                          />
                          {rightPanelGlobalHeaderControls ? (
                            <div
                              data-testid="right-panel-global-header-actions"
                              className="pointer-events-none absolute top-0 right-0 z-30 flex h-toolbar items-center justify-end pr-2"
                            >
                              <div className="pointer-events-none flex h-full items-center gap-1">
                                {rightPanelGlobalHeaderControls}
                              </div>
                            </div>
                          ) : null}
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
                        onMouseDown={resizeBottomPanel}
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
                          headerEndInsetPx={bottomPanelGlobalHeaderInsetWidth}
                          renderEmptyLeaf={(leafId) => (
                            <EmptyRightPane
                              actions={availableBottomPanelActions}
                              cards={[]}
                              isMac={isMacPlatform}
                              onAction={(kind) => {
                                if (kind === "side_chat_placeholder") {
                                  void openSideChat({ targetPanelId: "bottom", targetLeafId: leafId });
                                  return;
                                }
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
            </>
          )}
        </div>
          </motion.div>
        </ThreadHeaderPortalProvider>
      </NodexTooltipProvider>
    </HeaderActionProvider>
  );
}

function ProjectSessionSidebar({
  floating = false,
  header,
  projects,
  spaces,
  activeProjectId,
  activeSessionId,
  contextMenuSessionId,
  sessionsByProject,
  expandedProjectIds,
  projectsSectionCollapsed,
  loadingSessions,
  width,
  animatedWidth,
  contentOpacity,
  resizeDisabled = false,
  getWindowZoom,
  onResizeWidth,
  onToggleProjectsSectionCollapsed,
  onToggleProjectExpanded,
  onSelectProject,
  onSelectSession,
  onOpenSessionContextMenu,
  onToggleSessionPinned,
  onStartNewChatInProject,
  onOpenTaskSearch,
  onShowUnavailableProduct,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
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
  projectsSectionCollapsed: boolean;
  loadingSessions: boolean;
  width: number;
  animatedWidth?: MotionValue<number>;
  contentOpacity?: MotionValue<number>;
  resizeDisabled?: boolean;
  getWindowZoom?: () => number;
  onResizeWidth: (width: number) => void;
  onToggleProjectsSectionCollapsed: () => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (session: ProjectSession) => void;
  onOpenSessionContextMenu?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onToggleSessionPinned?: (session: ProjectSession) => void | Promise<void>;
  onStartNewChatInProject: (projectId: string) => void | Promise<void>;
  onOpenTaskSearch: () => void;
  onShowUnavailableProduct: (label: string) => void;
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
  onOpenSettings: () => void;
  account: CodexAccountSnapshot | null;
  connection: CodexConnectionState;
  onRefreshAccount: () => Promise<CodexAccountSnapshot>;
  onLogout: () => Promise<void>;
  onAccountErrorMessage: (message: string | null) => void;
}) {
  const [manageProjectsOpen, setManageProjectsOpen] = useState(false);

  const handleResizeStart = (event: React.MouseEvent) => {
    if (resizeDisabled || floating) return;
    event.preventDefault();

    const resolveZoom = getWindowZoom ?? (() => 1);
    const startX = event.clientX / resolveZoom();
    const startWidth = width;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (nextEvent: MouseEvent) => {
      onResizeWidth(startWidth + ((nextEvent.clientX / resolveZoom()) - startX));
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
    <motion.aside
      className={cn(
        floating
          ? CODEX_SIDEBAR_FLOATING_ASIDE_CLASS
          : "app-shell-left-panel pointer-events-auto relative flex h-full min-h-0 shrink-0 flex-col overflow-visible browser:bg-token-main-surface-primary",
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
              shortcutLabel={resolveCodexNewChatShortcutLabel() === "⌘N" ? "⌘F" : "Ctrl+F"}
              onClick={onOpenTaskSearch}
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
            <CodexSidebarSection
              heading="Projects"
              collapsed={projectsSectionCollapsed}
              onToggle={onToggleProjectsSectionCollapsed}
              actions={(
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
                    <CodexSidebarActionButton label="Manage projects" title="Manage projects">
                      <Plus className="size-3.5" />
                    </CodexSidebarActionButton>
                  )}
                />
              )}
            >
              {!projectsSectionCollapsed ? (
                <div className="pt-0.5">
                <div className="isolate flex flex-col [contain:layout]">
                  <div className="flex flex-col" role="list" aria-label="Projects">
                    {projects.map((project) => {
                      const sessions = sessionsByProject[project.id] ?? [];
                      const expanded = expandedProjectIds.has(project.id);
                      const isActiveProject = project.id === activeProjectId;

                      return (
                        <CodexProjectRow
                          key={project.id}
                          project={project}
                          active={isActiveProject}
                          expanded={expanded}
                          onActivate={() => {
                            if (isActiveProject) {
                              onToggleProjectExpanded(project.id);
                              return;
                            }

                            onSelectProject(project.id);
                          }}
                          onStartNewChat={() => void onStartNewChatInProject(project.id)}
                          onRenameProject={onRenameProject}
                          onManageProject={() => setManageProjectsOpen(true)}
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
                    })}
                  </div>
                </div>
                </div>
              ) : null}
            </CodexSidebarSection>
          </div>
        </div>
      </motion.div>

      <LeftSidebarFooter
        onOpenSettings={onOpenSettings}
        account={account}
        connection={connection}
        onRefreshAccount={onRefreshAccount}
        onLogout={onLogout}
        onErrorMessage={onAccountErrorMessage}
      />

      <div
        onMouseDown={handleResizeStart}
        aria-disabled={resizeDisabled}
        data-testid="sidebar-resize-strip"
        className={cn(
          "group absolute top-0 right-0 bottom-0 z-20 flex w-3 translate-x-1.5 touch-none select-none",
          resizeDisabled ? "cursor-default" : "cursor-col-resize active:cursor-col-resize",
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none m-auto h-full w-px bg-linear-to-b from-transparent via-(--border) to-transparent group-hover:via-(--foreground-tertiary) group-active:via-(--foreground-tertiary)"
        />
      </div>
    </motion.aside>
  );
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
        className={cn(PANEL_ACTION_CARD_CLASS, className)}
        {...buttonProps}
      >
        <div className="flex min-w-0 flex-col items-center gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center text-token-text-secondary">
            <Icon className="icon-md" />
          </span>
          <span className="flex min-w-0 flex-col items-center gap-1">
            <span
              data-thread-side-panel-new-tab-action-label="true"
              className="w-max max-w-full truncate text-base font-semibold text-token-text-primary"
            >
              {action.label}
            </span>
            <span
              data-thread-side-panel-new-tab-action-label="true"
              className="w-max max-w-full truncate text-sm text-token-text-secondary"
            >
              {action.description}
            </span>
            {shortcut ? (
              <span
                data-thread-side-panel-new-tab-action-label="true"
                className="pt-1 text-token-text-secondary"
              >
                <kbd className={PANEL_ACTION_KBD_CLASS}>{shortcut}</kbd>
              </span>
            ) : null}
          </span>
        </div>
      </button>
    );
  },
);

function RightPanelCardStagePicker({
  cards,
  onOpenCard,
}: {
  cards: Array<{ card: Card; columnName: string }>;
  onOpenCard: (card: Card) => void;
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
  cards: Array<{ card: Card; columnName: string }>;
  isMac: boolean;
  onAction: (kind: ProjectSessionTab["kind"]) => void;
  onOpenCard: (card: Card) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto bg-token-main-surface-primary p-6 select-none">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center">
        <div className="sticky top-0 z-10 flex flex-col gap-8 bg-token-main-surface-primary">
          <div
            data-thread-side-panel-new-tab-action-grid="true"
            className="grid w-full grid-cols-1 justify-center justify-items-center gap-3"
            style={{ gridTemplateColumns: "repeat(1, minmax(0px, 330px))" }}
          >
            {actions.map((action) => {
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
            })}
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
  onOpenSideChat,
}: {
  session: ProjectSession;
  project: Project | null;
  projects: Project[];
  onRefreshProjectSessions: (projectId: string) => Promise<ProjectSession[]>;
  onEnsureBlankSessionForProject: (projectId: string) => Promise<ProjectSession>;
  onRequestProjectPickerOpen: () => void;
  onOpenLocalEnvironmentsSettings: () => void;
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
  onOpenSideChat: (input?: {
    prompt?: string;
    promptInput?: CodexPromptInput;
    collaborationMode?: CodexCollaborationModeKind;
  }) => Promise<void>;
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
    accountActions,
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
    onOpenSideChat: async (input) => {
      await onOpenSideChat({
        ...input,
        collaborationMode: selectedCollaborationMode,
      });
    },
    selectedCollaborationMode,
    setSelectedCollaborationMode,
  }), [
    codexControl,
    accountActions,
    onOpenCard,
    onEnsureBlankSessionForProject,
    onRefreshProjectSessions,
    onRequestProjectPickerOpen,
    onOpenLocalEnvironmentsSettings,
    onOpenSideChat,
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
        summaryPanelMounted={summaryPanelMounted}
        summaryPanelOpen={summaryPanelOpen}
        summaryPanelHideImmediately={summaryPanelHideImmediately}
        summaryPanelContentShift={summaryPanelContentShift}
        summarySideChatRows={summarySideChatRows}
        summaryBrowserRows={summaryBrowserRows}
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
    onOpenSideChat: noopAsync,
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
    onUnarchiveThread: noopAsync,
    onOpenTurnDiffReview: () => undefined,
    onConsumeComposerIntent: () => undefined,
    onOpenThread: () => undefined,
    onCleanBackgroundTerminals: async () => undefined,
    onOpenCard,
  };
}

function makeSessionThreadStageActions(input: {
  activeThreadId: string | null;
  accountActions: ReturnType<typeof useCodexAccountActions>;
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
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  projectId: string;
  selectedCollaborationMode: CodexCollaborationModeKind;
  setSelectedCollaborationMode: (mode: CodexCollaborationModeKind) => void;
}): ThreadStageActions {
  const base = makeNoopThreadStageActions(input.onOpenCard);
  return {
    ...base,
    onRefreshAccount: input.accountActions.refreshAccount,
    onStartChatGptLogin: input.accountActions.startChatGptLogin,
    onStartApiKeyLogin: input.accountActions.startApiKeyLogin,
    onCancelLogin: async (loginId) => {
      await input.accountActions.cancelLogin(loginId);
    },
    onLogout: async () => {
      await input.accountActions.logout();
    },
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
    onOpenSideChat: input.onOpenSideChat ?? base.onOpenSideChat,
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
    onUnarchiveThread: async (threadId, projectId) => {
      await input.codexControl.unarchiveThread(threadId, projectId);
      await input.onRefreshProjectSessions(projectId);
    },
  };
}

function SideChatSessionTab({
  tab,
  activeSession,
  projects,
  onOpenCardTab,
  onRefreshSessions,
  onRecreateSideChat,
}: {
  tab: SideChatPanelTab;
  activeSession: ProjectSession;
  projects: Project[];
  onOpenCardTab: (projectId: string, cardId: string, titleSnapshot?: string) => Promise<void>;
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  onRecreateSideChat: () => void;
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

  const actions = useMemo(() => makeSessionThreadStageActions({
    activeThreadId: tab.threadId,
    accountActions,
    codexControl,
    onOpenCard: (cardId) => {
      void onOpenCardTab(tab.projectId, cardId, cardId);
    },
    onEnsureBlankSessionForProject: async () => activeSession,
    onRefreshProjectSessions: onRefreshSessions,
    currentSessionProjectId: activeSession.projectId,
    projectId: tab.projectId,
    onNewThreadProjectChange: () => undefined,
    onRequestNewChatProjectCreate: () => undefined,
    onNewThreadStartInTargetChange: () => undefined,
    onNewThreadStartInEnvironmentChange: () => undefined,
    onRefreshNewThreadStartInEnvironments: async () => undefined,
    onOpenNewThreadLocalEnvironmentsSettings: () => undefined,
    selectedCollaborationMode,
    setSelectedCollaborationMode,
  }), [
    accountActions,
    activeSession,
    codexControl,
    onOpenCardTab,
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
        projectWorkspacePath={project?.workspacePath ?? null}
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

export function SideChatPlaceholderPanel({ onOpenSideChat }: { onOpenSideChat?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary p-6 select-none">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center text-center">
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-token-bg-secondary text-token-text-secondary">
          <CodexSidePanelSideChatIcon className="icon-md" />
        </div>
        <div className="text-base font-semibold text-token-text-primary">Side chat</div>
        <div className="mt-1 text-sm text-token-text-secondary">Start a side conversation</div>
        <NodexButton
          type="button"
          size="sm"
          className="mt-4"
          onClick={onOpenSideChat}
        >
          Start side chat
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
  onRefreshSessions,
  onCloseTab,
  onOpenSideChat,
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
  onOpenCardTab: (projectId: string, cardId: string, titleSnapshot?: string) => Promise<void>;
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  onCloseTab: (tabId: string) => Promise<void>;
  onOpenSideChat: () => void;
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
              projectId: activeSession.projectId,
              terminalSessionId: `session:${activeSession.id}:terminal:${Date.now()}`,
            },
          });
          await invoke("project-session-panels:update", activeSession.id, "bottom", { collapsed: false });
          await onRefreshSessions(activeSession.projectId);
        }}
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
        projectWorkspacePath={project?.workspacePath ?? null}
        searchOpenTick={0}
      />
    );
  }

  if (
    tab.kind === "browser_placeholder"
    || tab.kind === "files_placeholder"
    || tab.kind === "side_chat_placeholder"
  ) {
    return <ProjectSessionMockTab kind={tab.kind} onOpenSideChat={onOpenSideChat} />;
  }

  return (
    <div className="flex h-full items-center justify-center bg-token-main-surface-primary text-sm text-token-text-secondary">
      Unsupported tab.
    </div>
  );
}

function ProjectSessionMockTab({
  kind,
  onOpenSideChat,
}: {
  kind: "browser_placeholder" | "files_placeholder" | "side_chat_placeholder";
  onOpenSideChat?: () => void;
}) {
  if (kind === "side_chat_placeholder") {
    return <SideChatPlaceholderPanel onOpenSideChat={onOpenSideChat} />;
  }

  const action = PANEL_NEW_TAB_ACTIONS.find((candidate) => candidate.kind === kind);
  const Icon = action?.Icon ?? CodexSidePanelBrowserIcon;
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary p-6 select-none">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center text-center">
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-token-bg-secondary text-token-text-secondary">
          <Icon className="icon-md" />
        </div>
        <div className="text-base font-semibold text-token-text-primary">{action?.label ?? "Browser"}</div>
        <div className="mt-1 text-sm text-token-text-secondary">{action?.description ?? "Open a website"}</div>
      </div>
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
  const lastHandledTaskSearchOpenTickRef = useRef(taskSearchOpenTick);
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
