import {
  Activity,
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
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform, type MotionStyle, type MotionValue } from "motion/react";
import {
  ArrowLeft,
  Bot,
  CalendarDays,
  Database,
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
  HeaderInlineActionRail,
  HeaderShellSlot,
} from "./workbench-header-actions";
import {
  CalendarToolbarControls,
  CalendarToolbarMonthLabel,
} from "@/components/kanban/calendar/calendar-toolbar";
import { DbViewToolbar } from "./db-view-toolbar";
import { DatabaseManagementDialogController } from "./database-management-dialog-controller";
import { MainViewHost } from "./main-view-host";
import { CardStage } from "./workbench-card-stage";
import { OwnedBlockDocumentBoundary } from "@/components/block-documents/owned-block-document-boundary";
import { CardStageToolbar } from "@/components/kanban/card-stage/toolbar";
import { CardStageContentSkeleton } from "@/components/kanban/card-stage/content-skeleton";
import { HistoryPanel } from "./workbench-history-panel";
import { TerminalPanel } from "./workbench-terminal-panel";
import {
  terminalSessionStore,
  useTerminalSessionStoreVersion,
} from "@/lib/terminal-session-store";
import { BrowserSidebarHiddenWebviewHosts } from "@/features/browser-sidebar/browser-sidebar-hidden-webview-hosts";
import { BrowserSidebarPanel } from "@/features/browser-sidebar/browser-sidebar-panel";
import {
  readBrowserConfigFavicon,
  readBrowserConfigTitle,
  readBrowserConfigUrl,
} from "@/features/browser-sidebar/browser-sidebar-tab-config";
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
import {
  buildCodexHooksSettingsPath,
  type CodexHooksSettingsTarget,
} from "@/lib/codex-hooks-route";
import { isCodexGitSettings } from "../../../shared/codex-git-settings";
import { WorkbenchAutomationsRouteShell, WorkbenchAutomationSidePanelTab } from "./workbench-automations-overlay";
import { buildAutomationsPath } from "./workbench-automations-routes";
import { PendingWorktreeRoute } from "./pending-worktree-route";
import { WorkbenchProcessManagerDialog } from "./workbench-process-manager-dialog";
import type { OpenCardStageOptions } from "@/components/kanban/open-card-stage";
import { LeftSidebarFooter } from "./left-sidebar-footer";
import { SidebarProjectsSectionActions } from "./sidebar-projects-section-actions";
import {
  NodexDropdownFlyoutSubmenuItem,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSeparator,
} from "@/components/ui/dropdown";
import { NodexButton, NodexIconButton } from "@/components/ui/button";
import { ShortcutKeycaps } from "@/components/ui/shortcut-keycaps";
import { NodexTooltip, NodexTooltipProvider } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import {
  ConnectedThreadStage,
  ConnectedReviewDiffPanel,
  ThreadSummaryPanelHeaderAction,
  useCodexAppServerControl,
  useConversation,
  useConversationSubset,
  useCodexThreadStartProgress,
  useLocalConversationAccount,
  useLocalConversationConnection,
} from "@/features/local-conversation";
import { createThreadStageActions } from "@/features/local-conversation/thread-action-controller";
import {
  buildThreadSummaryPanelBrowserRow,
  isThreadSummaryBrowserRowAgentWorking,
} from "@/features/local-conversation/projection/thread-summary-panel-browser-row-model";
import { buildThreadSummaryPanelSideChatRow } from "@/features/local-conversation/projection/thread-summary-panel-side-chat-row-model";
import { buildThreadSummaryPanelScheduledAutomationRow } from "@/features/local-conversation/projection/thread-summary-panel-scheduled-automation-model";
import { useRemoteHostedPipSummaryControl } from "@/features/local-conversation/view/use-remote-hosted-pip-summary-control";
import { SubagentAvatar } from "@/features/local-conversation/view/shared/subagent-avatar";
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
import {
  invoke,
  subscribeCodexPendingWorktreesChanged,
  subscribeCodexPendingWorktreeWarnings,
} from "@/lib/api";
import { useCodexScheduledAutomations } from "@/lib/use-codex-scheduled-automations";
import { useKanban } from "@/lib/use-kanban";
import { ensureFreshDatabaseViewBoard } from "@/lib/kanban-store";
import { fetchCardDetail, useCardDetail } from "@/lib/card-detail-store";
import { useCardTargetReadModels } from "@/lib/block-reference-queries";
import { resolveCardStageBreadcrumbTarget } from "@/lib/card-stage-breadcrumb-target";
import {
  projectCardDetailToStageModel,
  type CardStageDatabaseProperties,
} from "@/lib/card-stage-card";
import { commitCardDetailMetadataPatch } from "@/lib/card-detail-metadata-runtime";
import { readCardStageContentWidthPreference } from "@/lib/card-stage-layout";
import {
  createCardStageTabTitleStore,
  makeCardStageTabTitleKey,
  type CardStageTabTitleStore,
} from "@/lib/card-stage-tab-title-store";
import { cn } from "@/lib/utils";
import { RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE } from "@/lib/right-panel-composer-overlay-reserve";
import {
  makeDefaultSidebarCollapsibleSectionsState,
  makeDefaultSidebarTopLevelSectionsPrefs,
  normalizeSidebarTopLevelSectionOrder,
  type SidebarCollapsibleSectionId,
  type SidebarCollapsibleSectionsState,
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
  CODEX_SIDEBAR_PROJECTLESS_THREAD_MAX_ITEMS,
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
  getCachedProjectSessionDetail,
  prefetchProjectSessionDetail,
  projectSessionToSummary,
  seedProjectSessionDetail,
  seedProjectSessionDetails,
  setProjectSessionSummaries,
} from "@/lib/project-session-query-cache";
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
  makeProjectSessionPanelLayout,
} from "../../../shared/project-session-panel-layout";
import { resolveCodexSubagentDisplayName } from "../../../shared/codex-subagent-display";
import { CODEX_CLIENT_THREAD_ID_PREFIX } from "../../../shared/codex-client-thread";
import {
  codexSidebarProjectThreadContainerId,
  isCodexSidebarThreadContainerId,
  type CodexSidebarChatsThreadOrderInput,
  type CodexSidebarThreadMoveInput,
  type CodexSidebarThreadMoveBlocked,
  type CodexSidebarThreadMovePlacement,
} from "../../../shared/codex-sidebar-thread-move";
import type { CodexPendingWorktreeEntry } from "../../../shared/codex-pending-worktree";
import {
  requireProjectSessionBrowserTabId,
  type BrowserSidebarBrowserUseStateSnapshot,
} from "../../../shared/browser-sidebar";
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
  CodexAccountSnapshot,
  CodexBackgroundTerminalRow,
  CodexCollaborationModeKind,
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexConnectionState,
  CodexCollaborationModePreset,
  CodexComposerIntent,
  CodexSidebarSyncResult,
  CodexSidebarThreadItem,
  CodexThreadSummary,
  CodexTurnDiffReviewTarget,
  GitReviewSource,
  CodexPromptInput,
  CodexScheduledAutomation,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationUpdateInput,
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
  ProjectSessionPanelState,
  ProjectSessionSummary,
  ProjectSessionTab,
  ProjectSessionTabConfig,
  ProjectSessionTabCreateInput,
  ProjectSessionThreadLink,
  ProjectSessionPanelSplitSide,
  WorktreeStartMode,
  WorktreeEnvironmentOption,
} from "@/lib/types";
import type {
  ProjectSessionCardStageAncestor,
  ProjectSessionCardStageTabConfig,
  TerminalSessionSnapshot,
} from "../../../shared/types";
import { appendCardStageAncestor } from "../../../shared/card-stage-ancestors";
import type { ThreadActionControllerInput, ThreadStageActions } from "@/features/local-conversation";
import type {
  ThreadOpenSideChatInput,
  ThreadMcpAppSidePanelInput,
  ThreadOpenSubagentPayload,
  ThreadPlanSidePanelState,
  ThreadPlanSidePanelTarget,
  NewChatStartInSelectorModel,
  ThreadSummaryPanelAuxiliaryRow,
  ThreadSummaryPanelBrowserRow,
  ThreadSummaryPanelComputerUsePipState,
  ThreadSummaryPanelScheduledAutomationOpenInput,
  ThreadSummaryPanelScheduledAutomationRow,
} from "@/features/local-conversation/thread-stage-types";
import {
  getDefaultDbViewPrefs,
  viewSupportsDbViewPrefs,
  type DbViewPrefs,
  type SupportedDbView,
} from "@/lib/db-view-prefs";
import {
  type RecentCardSession,
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
  shouldCollapseCodexSidebarResizeWidth,
  shouldClearCodexSidebarHoverSuppression,
  shouldResetCodexSidebarPointerOnWindowMouseOut,
  type CodexSidebarPointerSnapshot,
} from "@/lib/codex-sidebar-auto-reveal";
import { useCodexSidebarMotionState } from "@/lib/codex-sidebar-motion";
import { useDistinctState } from "@/lib/use-distinct-state";
import {
  useElementSizeMotionValues,
  useMotionValueState,
  useSyncedMotionValue,
} from "@/lib/resize-observer-motion-values";
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
  CodexThreadIcon,
  CodexSidePanelBrowserIcon,
  CodexSidePanelFilesIcon,
  CodexSidePanelPlusIcon,
  CodexSidePanelReviewIcon,
  CodexSidePanelSideChatIcon,
  CodexSidePanelTerminalIcon,
  ComposerPluginsIcon,
  ComposerPlanModeIcon,
  SpinnerIcon,
} from "@/components/shared/icons";
import {
  getSidebarScrollChromeStyle,
  SIDEBAR_SCROLL_AREA_CLASS,
  SIDEBAR_COLLAPSED_CHROME_BUTTON_CLASS,
  SidebarCompactNewChatButton,
  SidebarExpandedHeader,
} from "./sidebar-new-chat-controls";
import { useCodexAccountActions } from "@/lib/use-codex-account-actions";
import {
  CodexProjectRow,
  CodexProjectSessionList,
  CodexSidebarSection,
  CodexSidebarThreadRow,
  CodexSidebarTopActionButton,
  resolveCodexCardSearchShortcutLabel,
  resolveCodexNewChatShortcutLabel,
} from "./codex-sidebar";
import { RenameChatDialog } from "./rename-chat-dialog";
import { SidebarThreadMoveBlockedDialog } from "./sidebar-thread-move-blocked-dialog";
import { StableWorktreeSidebarRows } from "./stable-worktree-sidebar-row";
import {
  loadLocalEnvironmentConfigSelection,
  readLocalEnvironmentSelections,
  resolveLocalEnvironmentOptionSelection,
  writeLocalEnvironmentSelection,
} from "./local-environment-selection";
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
import {
  replaceVisibleOrder,
  SidebarProjectSortableContext,
  useSidebarGroupReorderController,
  type SidebarGroupDndController,
} from "./sidebar-project-group-dnd";
import { SidebarDropIndicator } from "./sidebar-drop-indicator";
import { SidebarReorderDndProvider } from "./sidebar-reorder-dnd";
import {
  resolveSidebarThreadKeysWithPendingDrops,
  SidebarThreadDropContainer,
  SidebarThreadReorderRows,
  SidebarThreadSortableRows,
  usePendingSidebarThreadDrops,
  useSidebarPinnedDropContainer,
  useSidebarThreadReorderController,
  type SidebarThreadDropRequest,
} from "./sidebar-thread-reorder";
import {
  buildCodexSidebarPinnedReorderMutation,
  listReorderableCodexSidebarProjectThreadKeys,
  orderCodexSidebarThreadKeysByManualThreadIds,
  replaceVisibleCodexSidebarThreadKeyOrder,
  resolveCodexSidebarThreadHomeContainerId,
  sortSidebarThreadKeysForDisplay,
  type CodexSidebarProjectGroup,
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
  CodexBackgroundTerminalProcessRow,
  CodexBackgroundTerminalProcessThreadRef,
} from "@/lib/codex-background-terminal-processes";
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
const AUTOMATION_DETAIL_RAIL_DEFAULT_WIDTH = 820;
const AUTOMATION_DETAIL_RAIL_MIN_WIDTH = 360;
const AUTOMATION_DETAIL_RAIL_MAIN_MIN_WIDTH = 420;
const BOTTOM_PANEL_DEFAULT_HEIGHT = 280;
const BOTTOM_PANEL_MIN_HEIGHT = 160;
const TOOLBAR_BUTTON_BASE_CLASS = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square justify-center !px-0";
const TOOLBAR_BUTTON_GHOST_CLASS = "text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent";
const TOOLBAR_BUTTON_SECONDARY_CLASS = "text-token-foreground bg-token-foreground/5 enabled:hover:bg-token-foreground/10 data-[state=open]:bg-token-foreground/10 border-transparent";
const RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX = 70;
const RIGHT_PANEL_HEADER_FALLBACK_RAIL_WIDTH_PX = 62;

type CodexShellWidthClass = "narrow" | "medium" | "wide";

function resolveCodexShellWidthClass(width: number): CodexShellWidthClass {
  if (width <= CODEX_SHELL_NARROW_WIDTH_PX) return "narrow";
  if (width <= CODEX_SHELL_MEDIUM_WIDTH_PX) return "medium";
  return "wide";
}

function reportSidebarThreadReorderError(): void {
  toast.danger("Couldn’t reorder task");
}

function reportSidebarProjectReorderError(): void {
  toast.danger("Couldn’t reorder project");
}
const LEFT_HEADER_COLLAPSED_RAIL_FALLBACK_WIDTH_PX = 126;
const THREAD_SUMMARY_PANEL_STORAGE_KEY = "nodex:thread-summary-panel:pinned-open";
const RETAINED_SESSION_CAP = 4;
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
  commandId?: string;
  Icon: ComponentType<{ className?: string }>;
}

type ProjectSessionFilesPreviewTab = WorkspaceFilesTab & {
  preview: true;
  kind: "files";
  config: WorkspaceFilesTab["config"] & {
    hostId: "local";
    workspaceRoot: string;
    path: string;
  };
};

type ProjectSessionPreviewTab =
  | (ProjectSessionTab & { preview: true })
  | ProjectSessionFilesPreviewTab;

type DurableProjectSessionRenderableTab = ProjectSessionTab & {
  preview?: true;
};

type ProjectSessionTabPanelTab =
  | DurableProjectSessionRenderableTab
  | ProjectSessionFilesPreviewTab;

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

interface AutomationPanelTab {
  automationPanel: true;
  id: string;
  sessionId: string;
  projectId: string;
  panelId: "right";
  leafId?: string;
  title: string;
  stateKey: number;
  automationId: string | null;
  createInput: CodexScheduledAutomationCreateInput | null;
  mode: "open" | "suggested-create" | "suggested-update";
  updateInput: CodexScheduledAutomationUpdateInput | null;
}

interface BackgroundAgentPanelTab {
  backgroundAgent: true;
  id: string;
  sessionId: string;
  projectId: string;
  panelId: "right";
  leafId?: string;
  threadId: string;
  title: string;
  stateKey: number;
  subagent: ThreadOpenSubagentPayload;
}

interface ProcessOutputPanelTab {
  processOutputPanel: true;
  id: string;
  sessionId: string;
  projectId: string | null;
  panelId: "right";
  leafId?: string;
  threadId: string;
  turnId: string | null;
  itemId: string;
  title: string;
  stateKey: number;
  command: string;
  cwd: string | null;
  terminalSessionId: string | null;
}

interface ProcessOutputPanelTarget {
  threadId: string;
  turnId?: string | null;
  itemId: string;
  command: string;
  cwd: string | null;
  terminalSessionId?: string | null;
}

type ProjectSessionRenderableTab =
  | DurableProjectSessionRenderableTab
  | ProjectSessionFilesPreviewTab
  | SideChatPanelTab
  | McpAppPanelTab
  | PlanPanelTab
  | AutomationPanelTab
  | BackgroundAgentPanelTab
  | ProcessOutputPanelTab;

interface CardStageHistoryModalContext {
  sessionId: string;
  tabId: string;
  projectId: string;
  cardId: string;
  cardTitle?: string;
  cardNfm?: string;
}

interface RetainedSessionEntry {
  sessionId: string;
}

interface BuildRetainedSessionEntriesInput {
  activeSessionId: string | null;
  activeSession: ProjectSession | null;
  previousEntries: readonly RetainedSessionEntry[];
  knownSessionIds: ReadonlySet<string>;
  getSessionDetail: (sessionId: string) => ProjectSession | null | undefined;
  cap: number;
}

interface ShouldSynchronouslyRevealSessionInput {
  sessionId: string;
  cachedSession: ProjectSession | null | undefined;
  retainedEntries: readonly RetainedSessionEntry[];
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

function applyProjectSessionSummaryToLoadedSession(
  session: ProjectSession,
  summary: ProjectSessionSummary,
): ProjectSession {
  return {
    ...summary,
    panels: session.panels,
    tabs: session.tabs,
  };
}

function makeSummaryOnlyProjectSession(summary: ProjectSessionSummary): ProjectSession {
  const makePanel = (panelId: PanelId): ProjectSessionPanelState => ({
    collapsed: true,
    layout: makeProjectSessionPanelLayout([], null),
    size: panelId === "right"
      ? { widthPx: 600, fullWidth: false }
      : { heightPx: 280 },
  });

  return {
    ...summary,
    panels: {
      right: makePanel("right"),
      bottom: makePanel("bottom"),
    },
    tabs: [],
  };
}

function mergeLoadedProjectSessionSummaries(
  current: ProjectSession[],
  summaries: ProjectSessionSummary[],
): ProjectSession[] {
  const loadedById = new Map(current.map((session) => [session.id, session]));
  return sortProjectSessionsForSidebar(
    summaries.flatMap((summary): ProjectSession[] => {
      const loaded = loadedById.get(summary.id);
      return [loaded ? applyProjectSessionSummaryToLoadedSession(loaded, summary) : makeSummaryOnlyProjectSession(summary)];
    }),
  );
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
    collapsibleSections?: SidebarCollapsibleSectionsState;
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
  setSidebarTopLevelSectionVisible?: (sectionId: SidebarTopLevelSectionId, visible: boolean) => void;
  setSidebarTopLevelSectionItemLimit?: (sectionId: SidebarTopLevelSectionId, itemLimit: SidebarSectionItemLimit) => void;
  setSidebarCollapsibleSectionCollapsed?: (sectionId: SidebarCollapsibleSectionId, collapsed: boolean) => void;
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
  onRegisterSidebarToggleHandler?: (
    handler: (source: WorkbenchSidebarToggleCommandSource) => void,
  ) => () => void;
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
  ancestors?: readonly ProjectSessionCardStageAncestor[];
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

function isBunTestRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    Bun?: unknown;
    process?: { argv?: string[] };
  };
  if (typeof runtime.Bun === "undefined") return false;

  const argv = runtime.process?.argv ?? [];
  return argv.some((item) => item.includes("bun")) && argv.some((item) => item.includes("test"));
}

function RetainedActivity({
  mode,
  children,
}: {
  mode: "visible" | "hidden";
  children: ReactNode;
}) {
  if (isBunTestRuntime()) {
    return (
      <div hidden={mode === "hidden"} aria-hidden={mode === "hidden" ? "true" : undefined}>
        {children}
      </div>
    );
  }

  return <Activity mode={mode}>{children}</Activity>;
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

interface SessionPanelRenderModel {
  rightPanel: ProjectSessionPanelState;
  bottomPanel: ProjectSessionPanelState;
  rightActiveLeafId: string;
  bottomActiveLeafId: string;
  rightRenderableTabs: ProjectSessionRenderableTab[];
  bottomRenderableTabs: ProjectSessionRenderableTab[];
  rightActiveTabId: string | null;
  bottomActiveTabId: string | null;
  rightPanelCollapsed: boolean;
  bottomPanelCollapsed: boolean;
  sidePanelOpen: boolean;
  bottomPanelOpen: boolean;
  rightPanelFullWidth: boolean;
  rightActiveRenderableTab: ProjectSessionRenderableTab | null;
  threadPlanSidePanelState: ThreadPlanSidePanelState | null;
  renderableTabsByPanelLeaf: Record<PanelId, Record<string, ProjectSessionRenderableTab[]>>;
  activeTabIdsByPanelLeaf: Record<PanelId, Record<string, string | null>>;
  browserRetentionTabs: ProjectSessionTab[];
  visibleBrowserTabIds: ReadonlySet<string>;
}

interface SessionPanelRenderModelInput {
  session: ProjectSession;
  previewTabsByPanel: Record<string, ProjectSessionPreviewTab>;
  sideChatTabsBySession: Record<string, SideChatPanelTab[]>;
  sideChatActiveTabByPanel: Record<string, string>;
  mcpAppTabsBySession: Record<string, McpAppPanelTab[]>;
  mcpAppActiveTabByPanel: Record<string, string>;
  planTabsBySession: Record<string, PlanPanelTab[]>;
  planActiveTabByPanel: Record<string, string>;
  automationTabsBySession: Record<string, AutomationPanelTab[]>;
  automationActiveTabByPanel: Record<string, string>;
  backgroundAgentTabsBySession: Record<string, BackgroundAgentPanelTab[]>;
  backgroundAgentActiveTabByPanel: Record<string, string>;
  processOutputTabsBySession: Record<string, ProcessOutputPanelTab[]>;
  processOutputActiveTabByPanel: Record<string, string>;
  panelCollapsedOverrides: Record<string, boolean>;
  activePlanKeyBySession: Record<string, string>;
}

function isRetainableProjectSession(
  session: ProjectSession | null | undefined,
  knownSessionIds: ReadonlySet<string>,
): session is ProjectSession {
  if (!session) return false;
  if (!knownSessionIds.has(session.id)) return false;
  if (session.archived) return false;
  if (!Array.isArray(session.tabs)) return false;
  return typeof session.panels === "object" && session.panels !== null;
}

function buildRetainedSessionEntries({
  activeSessionId,
  activeSession,
  previousEntries,
  knownSessionIds,
  getSessionDetail,
  cap,
}: BuildRetainedSessionEntriesInput): RetainedSessionEntry[] {
  const orderedSessionIds = activeSessionId
    ? [
        activeSessionId,
        ...previousEntries
          .map((entry) => entry.sessionId)
          .filter((sessionId) => sessionId !== activeSessionId),
      ]
    : previousEntries.map((entry) => entry.sessionId);
  const seenSessionIds = new Set<string>();
  const nextEntries: RetainedSessionEntry[] = [];

  for (const sessionId of orderedSessionIds) {
    if (seenSessionIds.has(sessionId)) continue;
    seenSessionIds.add(sessionId);

    const detail = activeSession?.id === sessionId ? activeSession : getSessionDetail(sessionId);
    if (!isRetainableProjectSession(detail, knownSessionIds)) continue;

    nextEntries.push({ sessionId });
    if (nextEntries.length >= cap) break;
  }

  return nextEntries;
}

function areRetainedSessionEntriesEqual(
  currentEntries: readonly RetainedSessionEntry[],
  nextEntries: readonly RetainedSessionEntry[],
): boolean {
  return currentEntries.length === nextEntries.length
    && currentEntries.every((entry, index) => (
      entry.sessionId === nextEntries[index]?.sessionId
    ));
}

export function shouldSynchronouslyRevealSession({
  sessionId,
  cachedSession,
  retainedEntries,
}: ShouldSynchronouslyRevealSessionInput): boolean {
  if (!cachedSession) return false;
  return retainedEntries.some((entry) => entry.sessionId === sessionId);
}

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
  if (
    isSideChatPanelTab(tab)
    || isMcpAppPanelTab(tab)
    || isPlanPanelTab(tab)
    || isAutomationPanelTab(tab)
    || isBackgroundAgentPanelTab(tab)
    || isProcessOutputPanelTab(tab)
  ) return {};
  if (tab.kind !== "db_view" && tab.kind !== "card_stage") return {};
  if (!("projectId" in tab.config)) return {};

  const targetProjectId = tab.config.projectId;
  if (targetProjectId === null) return {};
  if (targetProjectId === activeSession.projectId) return {};

  const targetProject = projects.find((project) => project.id === targetProjectId);
  const projectLabel = targetProject?.name.trim() || targetProjectId;

  return {
    contextLabel: projectLabel,
    titleLabel: (title) => `${projectLabel} project, ${title}`,
    tooltip: (title) => (
      <div className="flex max-w-80 flex-col gap-0.5">
        <div className="truncate font-medium">{title}</div>
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

function findDbViewTabForDatabaseView(
  session: ProjectSession,
  databaseViewId: string,
): ProjectSessionTab | null {
  return session.tabs.find((tab) =>
    tab.kind === "db_view"
    && "databaseViewId" in tab.config
    && tab.config.databaseViewId === databaseViewId
  ) ?? null;
}

function listSessionDbViewTargets(
  session: ProjectSession,
): Array<{ projectId: string; databaseViewId: string }> {
  const targets = new Map<string, { projectId: string; databaseViewId: string }>();
  for (const tab of session.tabs) {
    if (tab.kind !== "db_view") continue;
    if (!("projectId" in tab.config)) continue;
    if (tab.config.projectId === null) continue;
    if (!("databaseViewId" in tab.config)) continue;
    if (typeof tab.config.databaseViewId !== "string") continue;
    const databaseViewId = tab.config.databaseViewId.trim();
    if (!databaseViewId) continue;
    targets.set(databaseViewId, {
      projectId: tab.config.projectId,
      databaseViewId,
    });
  }
  return [...targets.values()];
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
  projectId: string | null,
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
    if (projectId === null && action.kind !== "browser") return [];
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

function getWorkspaceFileParentPath(path: string): string {
  const normalizedPath = path.trim();
  const lastSlashIndex = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  if (lastSlashIndex > 0) return normalizedPath.slice(0, lastSlashIndex);
  if (lastSlashIndex === 0) return normalizedPath.slice(0, 1);
  return "";
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

function clampAutomationDetailRailWidth(width: number, shellWidth: number): number {
  const roundedWidth = Math.round(width);
  if (!Number.isFinite(shellWidth) || shellWidth <= 0) {
    return Math.max(AUTOMATION_DETAIL_RAIL_MIN_WIDTH, roundedWidth);
  }

  const maxWidth = Math.max(
    AUTOMATION_DETAIL_RAIL_MIN_WIDTH,
    Math.floor(shellWidth - AUTOMATION_DETAIL_RAIL_MAIN_MIN_WIDTH),
  );
  return Math.min(maxWidth, Math.max(AUTOMATION_DETAIL_RAIL_MIN_WIDTH, roundedWidth));
}

function readCodexWindowZoom(root: HTMLElement | null): number {
  const rawZoom = root ? window.getComputedStyle(root).getPropertyValue("--codex-window-zoom") : "";
  const parsedZoom = Number.parseFloat(rawZoom);
  return Number.isFinite(parsedZoom) && parsedZoom > 0 ? parsedZoom : 1;
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

function resolvePanelPreviewKeyLeafId(key: string, sessionId: string, panelId: PanelId): string | null {
  const leafPrefix = `${sessionId}:${panelId}:`;
  if (!key.startsWith(leafPrefix)) return null;
  return key.slice(leafPrefix.length) || null;
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

function resolveActiveRenderableTabId(
  renderableTabs: readonly ProjectSessionRenderableTab[],
  fallbackActiveTabId: string | null,
  activeTabCandidates: readonly (string | null)[],
): string | null {
  for (const candidate of activeTabCandidates) {
    if (!candidate) continue;
    if (renderableTabs.some((tab) => tab.id === candidate)) return candidate;
  }
  if (fallbackActiveTabId && renderableTabs.some((tab) => tab.id === fallbackActiveTabId)) {
    return fallbackActiveTabId;
  }
  return renderableTabs[0]?.id ?? null;
}

function buildSessionPanelRenderModel(input: SessionPanelRenderModelInput): SessionPanelRenderModel {
  const {
    session,
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
  } = input;
  const rightPanel = session.panels.right;
  const bottomPanel = session.panels.bottom;
  const rightActiveLeafId = resolveSessionPanelActiveLeafId(session, "right");
  const bottomActiveLeafId = resolveSessionPanelActiveLeafId(session, "bottom");
  const renderableTabsByPanelLeaf: Record<PanelId, Record<string, ProjectSessionRenderableTab[]>> = {
    right: {},
    bottom: {},
  };
  const activeTabIdsByPanelLeaf: Record<PanelId, Record<string, string | null>> = {
    right: {},
    bottom: {},
  };
  const durableById = new Map(session.tabs.map((tab) => [tab.id, tab]));

  for (const panelId of ["right", "bottom"] as const) {
    const panel = session.panels[panelId];
    const activeLeafId = panelId === "right" ? rightActiveLeafId : bottomActiveLeafId;
    for (const leaf of listProjectSessionPanelLeaves(panel.layout)) {
      const durableTabs = leaf.tabIds.flatMap((tabId) => {
        const tab = durableById.get(tabId);
        return tab && tab.panelId === panelId ? [tab] : [];
      });
      const sideChatTabs = (sideChatTabsBySession[session.id] ?? []).filter((tab) =>
        tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leaf.id
      );
      const mcpAppTabs = (mcpAppTabsBySession[session.id] ?? []).filter((tab) =>
        tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leaf.id
      );
      const planTabs = (planTabsBySession[session.id] ?? []).filter((tab) =>
        tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leaf.id
      );
      const automationTabs = (automationTabsBySession[session.id] ?? []).filter((tab) =>
        tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leaf.id
      );
      const backgroundAgentTabs = (backgroundAgentTabsBySession[session.id] ?? []).filter((tab) =>
        tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leaf.id
      );
      const processOutputTabs = (processOutputTabsBySession[session.id] ?? []).filter((tab) =>
        tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leaf.id
      );
      const previewTab = getRenderablePanelPreviewTab(session, panelId, leaf.id, previewTabsByPanel);
      const renderableTabs: ProjectSessionRenderableTab[] = previewTab
        ? [
            ...durableTabs,
            ...sideChatTabs,
            ...mcpAppTabs,
            ...planTabs,
            ...automationTabs,
            ...backgroundAgentTabs,
            ...processOutputTabs,
            previewTab,
          ]
        : [
            ...durableTabs,
            ...sideChatTabs,
            ...mcpAppTabs,
            ...planTabs,
            ...automationTabs,
            ...backgroundAgentTabs,
            ...processOutputTabs,
          ];
      const sideChatActiveTabId = sideChatActiveTabByPanel[makeSideChatPanelKey(session.id, panelId, leaf.id)]
        ?? (leaf.id === activeLeafId ? sideChatActiveTabByPanel[makeSideChatPanelKey(session.id, panelId)] : null)
        ?? null;
      const mcpAppActiveTabId = mcpAppActiveTabByPanel[makeMcpAppPanelKey(session.id, panelId, leaf.id)]
        ?? (leaf.id === activeLeafId ? mcpAppActiveTabByPanel[makeMcpAppPanelKey(session.id, panelId)] : null)
        ?? null;
      const planActiveTabId = planActiveTabByPanel[makePlanPanelKey(session.id, panelId, leaf.id)]
        ?? (leaf.id === activeLeafId ? planActiveTabByPanel[makePlanPanelKey(session.id, panelId)] : null)
        ?? null;
      const automationActiveTabId = automationActiveTabByPanel[makeAutomationPanelKey(session.id, panelId, leaf.id)]
        ?? (leaf.id === activeLeafId ? automationActiveTabByPanel[makeAutomationPanelKey(session.id, panelId)] : null)
        ?? null;
      const backgroundAgentActiveTabId =
        backgroundAgentActiveTabByPanel[makeBackgroundAgentPanelKey(session.id, panelId, leaf.id)]
        ?? (leaf.id === activeLeafId
          ? backgroundAgentActiveTabByPanel[makeBackgroundAgentPanelKey(session.id, panelId)]
          : null)
        ?? null;
      const processOutputActiveTabId =
        processOutputActiveTabByPanel[makeProcessOutputPanelKey(session.id, panelId, leaf.id)]
        ?? (leaf.id === activeLeafId
          ? processOutputActiveTabByPanel[makeProcessOutputPanelKey(session.id, panelId)]
          : null)
        ?? null;

      renderableTabsByPanelLeaf[panelId][leaf.id] = renderableTabs;
      activeTabIdsByPanelLeaf[panelId][leaf.id] = resolveActiveRenderableTabId(
        renderableTabs,
        leaf.activeTabId,
        [
          previewTab?.id ?? null,
          planActiveTabId,
          automationActiveTabId,
          mcpAppActiveTabId,
          sideChatActiveTabId,
          backgroundAgentActiveTabId,
          processOutputActiveTabId,
        ],
      );
    }
  }

  const rightRenderableTabs = renderableTabsByPanelLeaf.right[rightActiveLeafId] ?? [];
  const bottomRenderableTabs = renderableTabsByPanelLeaf.bottom[bottomActiveLeafId] ?? [];
  const rightActiveTabId = activeTabIdsByPanelLeaf.right[rightActiveLeafId] ?? null;
  const bottomActiveTabId = activeTabIdsByPanelLeaf.bottom[bottomActiveLeafId] ?? null;
  const rightPanelCollapsed =
    panelCollapsedOverrides[makePanelPreviewKey(session.id, "right")] ?? rightPanel.collapsed;
  const bottomPanelCollapsed =
    panelCollapsedOverrides[makePanelPreviewKey(session.id, "bottom")] ?? bottomPanel.collapsed;
  const sidePanelOpen = !rightPanelCollapsed;
  const bottomPanelOpen = !bottomPanelCollapsed;
  const rightPanelFullWidth = sidePanelOpen && (rightPanel.size.fullWidth ?? false);
  const rightActiveRenderableTab = rightActiveTabId
    ? rightRenderableTabs.find((tab) => tab.id === rightActiveTabId) ?? null
    : null;
  const browserRetentionTabs = [
    ...session.tabs.filter((tab) => tab.kind === "browser"),
    ...Object.values(previewTabsByPanel).filter((tab): tab is ProjectSessionTab & { preview: true } =>
      tab.sessionId === session.id
      && tab.kind === "browser"
      && typeof tab.browserTabId === "string"
    ),
  ];
  const browserTabIds = new Set(browserRetentionTabs.map((tab) => tab.id));
  const visibleBrowserTabIds = new Set<string>();
  const collectVisibleBrowserTabIds = (panelId: PanelId, panelOpen: boolean) => {
    if (!panelOpen) return;
    const layout = session.panels[panelId].layout;
    const leafIds = layout.maximizedLeafId
      ? [layout.maximizedLeafId]
      : listProjectSessionPanelLeaves(layout).map((leaf) => leaf.id);
    for (const leafId of leafIds) {
      const tabId = activeTabIdsByPanelLeaf[panelId][leafId];
      if (tabId && browserTabIds.has(tabId)) visibleBrowserTabIds.add(tabId);
    }
  };
  collectVisibleBrowserTabIds("right", sidePanelOpen);
  collectVisibleBrowserTabIds("bottom", bottomPanelOpen);

  return {
    rightPanel,
    bottomPanel,
    rightActiveLeafId,
    bottomActiveLeafId,
    rightRenderableTabs,
    bottomRenderableTabs,
    rightActiveTabId,
    bottomActiveTabId,
    rightPanelCollapsed,
    bottomPanelCollapsed,
    sidePanelOpen,
    bottomPanelOpen,
    rightPanelFullWidth,
    rightActiveRenderableTab,
    threadPlanSidePanelState: {
      rightPanelEnabled: session.projectId !== null,
      activePlanKey: activePlanKeyBySession[session.id] ?? null,
      activeRightPanelTabId: sidePanelOpen ? rightActiveTabId : null,
    },
    renderableTabsByPanelLeaf,
    activeTabIdsByPanelLeaf,
    browserRetentionTabs,
    visibleBrowserTabIds,
  };
}

function collectPanelCardStageCardIdsByProject(
  session: ProjectSession,
  model: SessionPanelRenderModel,
): ReadonlyMap<string, ReadonlySet<string>> {
  const byProject = new Map<string, Set<string>>();
  const collectPanelVisibleCardStageCards = (panelId: PanelId, panelOpen: boolean) => {
    if (!panelOpen) return;

    const layout = session.panels[panelId].layout;
    const leafIds = layout.maximizedLeafId
      ? [layout.maximizedLeafId]
      : listProjectSessionPanelLeaves(layout).map((leaf) => leaf.id);

    for (const leafId of leafIds) {
      const activeTabId = model.activeTabIdsByPanelLeaf[panelId][leafId] ?? null;
      const activeTab = activeTabId
        ? model.renderableTabsByPanelLeaf[panelId][leafId]?.find((tab) => tab.id === activeTabId) ?? null
        : null;
      if (!activeTab || isTransientPanelTab(activeTab)) continue;
      if (isProjectSessionFilesPreviewTab(activeTab)) continue;

      const cardRef = readCardStagePanelTabCardRef(activeTab);
      if (!cardRef) continue;

      const cardIds = byProject.get(cardRef.projectId) ?? new Set<string>();
      cardIds.add(cardRef.cardId);
      byProject.set(cardRef.projectId, cardIds);
    }
  };

  collectPanelVisibleCardStageCards("right", model.sidePanelOpen);
  collectPanelVisibleCardStageCards("bottom", model.bottomPanelOpen);
  return byProject;
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

function makeAutomationPanelKey(sessionId: string, panelId: PanelId, leafId?: string | null): string {
  return leafId ? `${sessionId}:${panelId}:${leafId}` : `${sessionId}:${panelId}`;
}

function makeBackgroundAgentPanelKey(sessionId: string, panelId: PanelId, leafId?: string | null): string {
  return leafId ? `${sessionId}:${panelId}:${leafId}` : `${sessionId}:${panelId}`;
}

function makeProcessOutputPanelKey(sessionId: string, panelId: PanelId, leafId?: string | null): string {
  return leafId ? `${sessionId}:${panelId}:${leafId}` : `${sessionId}:${panelId}`;
}

function makeBackgroundAgentPanelTabId(threadId: string): string {
  return `background-agent:${threadId}`;
}

function encodeProcessOutputPanelTabPart(value: string): string {
  return encodeURIComponent(value);
}

function makeProcessOutputPanelTabId(threadId: string, itemId: string): string {
  return `process-output:${encodeProcessOutputPanelTabPart(threadId)}:${encodeProcessOutputPanelTabPart(itemId)}`;
}

function resolveProcessOutputPanelTitle(command: string): string {
  const trimmed = command.trim();
  return trimmed.length > 0 ? trimmed : "Process output";
}

function findProcessOutputCommandItem(
  conversation: CodexConversationSnapshot | null | undefined,
  itemId: string,
  turnId?: string | null,
): CodexConversationItem | null {
  if (!conversation) return null;

  const candidateTurns = turnId
    ? conversation.turns.filter((turn) => turn.turnId === turnId)
    : conversation.turns;
  for (const turn of candidateTurns) {
    const item = turn.items.find((candidate) =>
      candidate.itemId === itemId && candidate.kind === "commandExecution"
    );
    if (item) return item;
  }

  return null;
}

function buildProcessOutputTargetFromManagerRow(
  row: CodexBackgroundTerminalProcessRow,
  conversation: CodexConversationSnapshot | null | undefined,
): ProcessOutputPanelTarget {
  const item = findProcessOutputCommandItem(conversation, row.itemId, row.turnId);
  return {
    threadId: row.threadId,
    turnId: item?.turnId ?? row.turnId,
    itemId: row.itemId,
    command: item?.command ?? row.command,
    cwd: item?.cwd ?? row.cwd,
    terminalSessionId: row.terminalSessionId,
  };
}

function buildProcessOutputTargetFromSummaryRow(
  threadId: string,
  row: CodexBackgroundTerminalRow,
): ProcessOutputPanelTarget {
  return {
    threadId,
    turnId: row.turnId,
    itemId: row.id,
    command: row.command,
    cwd: row.cwd,
    terminalSessionId: null,
  };
}

function createBackgroundAgentTabIcon(threadId: string): ComponentType<{ className?: string }> {
  function BackgroundAgentTabIcon({ className }: { className?: string }) {
    return (
      <SubagentAvatar
        seed={threadId}
        className={className}
      />
    );
  }

  return BackgroundAgentTabIcon;
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

function isAutomationPanelTab(tab: ProjectSessionRenderableTab): tab is AutomationPanelTab {
  return "automationPanel" in tab && tab.automationPanel === true;
}

function isBackgroundAgentPanelTab(tab: ProjectSessionRenderableTab): tab is BackgroundAgentPanelTab {
  return "backgroundAgent" in tab && tab.backgroundAgent === true;
}

function isProcessOutputPanelTab(tab: ProjectSessionRenderableTab): tab is ProcessOutputPanelTab {
  return "processOutputPanel" in tab && tab.processOutputPanel === true;
}

function isProjectSessionFilesPreviewTab(tab: ProjectSessionRenderableTab): tab is ProjectSessionFilesPreviewTab {
  return "kind" in tab && tab.kind === "files" && tab.preview === true && "workspaceRoot" in tab.config;
}

function isTransientPanelTab(
  tab: ProjectSessionRenderableTab,
): tab is SideChatPanelTab | McpAppPanelTab | PlanPanelTab | AutomationPanelTab | BackgroundAgentPanelTab | ProcessOutputPanelTab {
  return isSideChatPanelTab(tab)
    || isMcpAppPanelTab(tab)
    || isPlanPanelTab(tab)
    || isAutomationPanelTab(tab)
    || isBackgroundAgentPanelTab(tab)
    || isProcessOutputPanelTab(tab);
}

function isRootThreadRightPanelComposerOverlayEligibleTab(
  tab: ProjectSessionRenderableTab | null,
): boolean {
  if (!tab) return false;
  if (isTransientPanelTab(tab)) return false;

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

  if (kind === "browser") {
    return {
      kind,
      title: "Browser",
      config: { projectId },
    };
  }

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
  if (projectId === null && draft.kind !== "browser") {
    throw new Error("Projectless sessions cannot own project-scoped tabs");
  }
  const now = new Date().toISOString();
  return {
    id: `preview:${session.id}:${panelId}:${draft.kind}`,
    sessionId: session.id,
    projectId,
    browserTabId: draft.kind === "browser" ? makeClientProjectSessionTabId() : null,
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
): ProjectSessionFilesPreviewTab {
  const now = new Date().toISOString();
  const projectId = session.projectId;
  return {
    id: `preview:${session.id}:${panelId}:files:${input.path}`,
    sessionId: session.id,
    projectId,
    browserTabId: null,
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
  input: {
    projectId: string;
    cardId: string;
    titleSnapshot?: string;
    ancestors?: readonly ProjectSessionCardStageAncestor[];
  },
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
    browserTabId: null,
    panelId,
    kind: "card_stage",
    title,
    order: session.tabs.filter((tab) => tab.panelId === panelId).length,
    config: {
      projectId: input.projectId,
      cardId: input.cardId,
      ...(input.titleSnapshot ? { titleSnapshot: input.titleSnapshot } : {}),
      ...(input.ancestors !== undefined ? { ancestors: [...input.ancestors] } : {}),
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

function replaceProjectSessionById(
  sessions: readonly ProjectSession[],
  replacement: ProjectSession,
): ProjectSession[] {
  const index = sessions.findIndex((session) => session.id === replacement.id);
  if (index < 0) return [...sessions, replacement];
  return sessions.map((session, candidateIndex) =>
    candidateIndex === index ? replacement : session
  );
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

function cardStageAncestorsEqual(
  left: readonly ProjectSessionCardStageAncestor[] | undefined,
  right: readonly ProjectSessionCardStageAncestor[],
): boolean {
  if ((left?.length ?? 0) !== right.length) return false;
  return right.every((ancestor, index) => {
    const candidate = left?.[index];
    return candidate?.cardId === ancestor.cardId;
  });
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
  onReorderProjects,
  onSetProjectPinned,
  onSetPinnedProjectOrder,
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
  setSidebarTopLevelSectionVisible,
  setSidebarCollapsibleSectionCollapsed,
  settingsToggleTick,
  keyboardShortcutsSettingsOpenTick,
  sidebarToggleRequestTick = 0,
  sidebarToggleRequestSource = "keyboard_shortcut",
  onRegisterSidebarToggleHandler,
  navigationCommandRequest = null,
  panelTabCycleRequest = null,
  panelTabCloseRequest = null,
  threadRenameRequest = null,
  onNavigationStateChange,
  commandKeymapState,
}: WorkbenchShellProps) {
  const queryClient = useQueryClient();
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
  const [blockedSidebarThreadMove, setBlockedSidebarThreadMove] =
    useState<CodexSidebarThreadMoveBlocked | null>(null);
  const [renamingSession, setRenamingSession] = useState(false);
  const [renamePendingWorktree, setRenamePendingWorktree] =
    useState<CodexSidebarThreadItem | null>(null);
  const [previewTabsByPanel, setPreviewTabsByPanel] = useState<Record<string, ProjectSessionPreviewTab>>({});
  const [cardStageTabTitleStore] = useState(createCardStageTabTitleStore);
  const [sideChatTabsBySession, setSideChatTabsBySession] = useState<Record<string, SideChatPanelTab[]>>({});
  const [sideChatActiveTabByPanel, setSideChatActiveTabByPanel] = useState<Record<string, string>>({});
  const [mcpAppTabsBySession, setMcpAppTabsBySession] = useState<Record<string, McpAppPanelTab[]>>({});
  const [mcpAppActiveTabByPanel, setMcpAppActiveTabByPanel] = useState<Record<string, string>>({});
  const [planTabsBySession, setPlanTabsBySession] = useState<Record<string, PlanPanelTab[]>>({});
  const [planActiveTabByPanel, setPlanActiveTabByPanel] = useState<Record<string, string>>({});
  const [automationTabsBySession, setAutomationTabsBySession] = useState<Record<string, AutomationPanelTab[]>>({});
  const [automationActiveTabByPanel, setAutomationActiveTabByPanel] = useState<Record<string, string>>({});
  const [backgroundAgentTabsBySession, setBackgroundAgentTabsBySession] =
    useState<Record<string, BackgroundAgentPanelTab[]>>({});
  const [backgroundAgentActiveTabByPanel, setBackgroundAgentActiveTabByPanel] = useState<Record<string, string>>({});
  const [processOutputTabsBySession, setProcessOutputTabsBySession] =
    useState<Record<string, ProcessOutputPanelTab[]>>({});
  const [processOutputActiveTabByPanel, setProcessOutputActiveTabByPanel] = useState<Record<string, string>>({});
  const [pendingProcessOutputOpen, setPendingProcessOutputOpen] = useState<ProcessOutputPanelTarget | null>(null);
  const [activePlanKeyBySession, setActivePlanKeyBySession] = useState<Record<string, string>>({});
  const [panelCollapsedOverrides, setPanelCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [
    retainedSessionEntries,
    setRetainedSessionEntries,
    getRetainedSessionEntries,
  ] = useDistinctState<RetainedSessionEntry[]>([], areRetainedSessionEntriesEqual);
  const [headerLeftWidth, setHeaderLeftWidth] = useState(0);
  const [, setHeaderLeftRailWidth] = useState(0);
  const [headerRightWidth, setHeaderRightWidth] = useState(RIGHT_PANEL_HEADER_FALLBACK_SPACER_WIDTH_PX);
  const [, setHeaderRightRailWidth] = useState(RIGHT_PANEL_HEADER_FALLBACK_RAIL_WIDTH_PX);
  const [automationsDetailRailOpen, setAutomationsDetailRailOpen] = useState(false);
  const automationsDetailRailRequestedWidth = useMotionValue(AUTOMATION_DETAIL_RAIL_DEFAULT_WIDTH);
  const [threadHeaderPortalElement, setThreadHeaderPortalElement] = useState<HTMLDivElement | null>(null);
  const [automationsHeaderPortalElement, setAutomationsHeaderPortalElement] = useState<HTMLDivElement | null>(null);
  const [automationsDetailRailPortalElement, setAutomationsDetailRailPortalElement] = useState<HTMLDivElement | null>(null);
  const [rightPanelComposerOverlayTarget, setRightPanelComposerOverlayTarget] = useState<HTMLElement | null>(null);
  const terminalSessionVersion = useTerminalSessionStoreVersion();
  const [threadSummaryPanelPinnedOpen, setThreadSummaryPanelPinnedOpen] = useState(readThreadSummaryPanelPinnedOpen);
  const [threadSummaryPanelPopoverOpen, setThreadSummaryPanelPopoverOpen] = useState(false);
  const [localSidebarCollapsed, setLocalSidebarCollapsed] = useState(false);
  const [localSidebarWidth, setLocalSidebarWidth] = useState(CODEX_SIDEBAR_WIDTH_DEFAULT_PX);
  const [localSidebarCollapsibleSections, setLocalSidebarCollapsibleSections] = useState(
    makeDefaultSidebarCollapsibleSectionsState,
  );
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteOpenRequest, setCommandPaletteOpenRequest] = useState({
    tick: 0,
    mode: "root" as CommandMenuMode,
    initialQuery: "",
  });
  const [
    floatingSidebarVisible,
    setFloatingSidebarVisible,
    getFloatingSidebarVisible,
  ] = useDistinctState(false);
  const [floatingSidebarResizing, setFloatingSidebarResizing] =
    useDistinctState(false);
  const [sidebarHoverSuppressed, setSidebarHoverSuppressed] =
    useDistinctState(false);
  const [sidebarTriggerHovered, setSidebarTriggerHovered] =
    useDistinctState(false);
  const [sidebarClickInFlight, setSidebarClickInFlight] = useState(false);
  const [floatingSidebarFocusActive, setFloatingSidebarFocusActive] =
    useDistinctState(false);
  const [sidebarDragWidth, setSidebarDragWidth] = useState<number | null>(null);
  const [shellNavigationHistory, setShellNavigationHistory] = useState(readWorkbenchShellNavigationHistoryState);
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
  const pendingSidebarPersistedOpenRef = useRef<boolean | null>(null);
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
  const sidebarCollapsibleSections = sidebar?.collapsibleSections ?? localSidebarCollapsibleSections;
  const pinnedProjectsSectionCollapsed = sidebarCollapsibleSections.pinned;
  const projectsSectionCollapsed = sidebarCollapsibleSections.projects;
  const chatsSectionCollapsed = sidebarCollapsibleSections.chats;
  const lastHandledSettingsToggleTickRef = useRef(settingsToggleTick);
  const lastHandledKeyboardShortcutsSettingsOpenTickRef = useRef(keyboardShortcutsSettingsOpenTick);
  const [pendingWorktreeClientThreadId, setPendingWorktreeClientThreadId] = useState<string | null>(null);
  const [pendingWorktrees, setPendingWorktrees] = useState<CodexPendingWorktreeEntry[]>([]);
  const [pendingStableWorktrees, setPendingStableWorktrees] = useState<StableWorktreeEntry[]>([]);
  const [stableWorktreeStatusId, setStableWorktreeStatusId] = useState<string | null>(null);
  const [reopenStableWorktreeAfterSettingsId, setReopenStableWorktreeAfterSettingsId] =
    useState<string | null>(null);
  const [reopenPendingWorktreeAfterSettingsClientThreadId, setReopenPendingWorktreeAfterSettingsClientThreadId] =
    useState<string | null>(null);
  const closePendingWorktreeRoute = useCallback(() => {
    setPendingWorktreeClientThreadId(null);
  }, []);
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
    setStableWorktreeStatusId(result.pendingWorktreeId);
  }, []);
  const [settingsPath, setSettingsPath] = useState<string | null>(null);
  const [localEnvironmentSettingsInitial, setLocalEnvironmentSettingsInitial] = useState<{
    projectId: string | null;
    configPath: string | null;
  } | null>(null);
  const [automationsPath, setAutomationsPath] = useState<string | null>(null);
  const [newThreadComposerIntentsBySessionId, setNewThreadComposerIntentsBySessionId] =
    useState<Record<string, CodexComposerIntent>>({});
  const [processManagerOpen, setProcessManagerOpen] = useState(false);
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
  const summaryGitReviewRequestKeyRef = useRef(0);
  const [summaryGitReviewRequest, setSummaryGitReviewRequest] = useState<{
    source: GitReviewSource;
    key: number;
  } | null>(null);
  const codexAccount = useLocalConversationAccount();
  const codexConnection = useLocalConversationConnection();
  const codexAccountActions = useCodexAccountActions();
  const reducedMotion = useReducedMotion();
  const realSidebarMotion = useCodexSidebarMotionState({
    initialOpen: !sidebarCollapsed,
    targetWidth: sidebarWidth,
    reducedMotion,
  });
  const sidebarOpen = realSidebarMotion.logicalOpen;
  const sidebarLogicalCollapsed = !sidebarOpen;
  const sidebarAnimating = realSidebarMotion.animating;
  const getRealSidebarOpen = realSidebarMotion.getOpen;
  const setRealSidebarOpen = realSidebarMotion.setOpen;
  const setRealSidebarTargetWidth = realSidebarMotion.setTargetWidth;

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const activeSessions = useMemo(
    () => activeProject ? sessionsByProject[activeProject.id] ?? [] : [],
    [activeProject, sessionsByProject],
  );
  const selectedActiveSession = activeSessions.find((session) => session.id === activeSessionId)
    ?? projectlessSessions.find((session) => session.id === activeSessionId)
    ?? null;
  const activeSession = selectedActiveSession ?? activeSessions[0] ?? null;
  const activeRenderSession = activeSession
    ? getCachedProjectSessionDetail(queryClient, activeSession.id) ?? activeSession
    : null;
  const forkTransferTargetConversationId = activeRenderSession?.thread?.threadId ?? null;
  const forkTransferTargetSessionId = activeRenderSession?.id ?? null;
  useLayoutEffect(() => {
    if (!forkTransferTargetConversationId || !forkTransferTargetSessionId) return;
    void invoke("codex:fork-side-panel-transfer:consume", {
      routeKind: "local-thread",
      targetConversationId: forkTransferTargetConversationId,
      targetProjectSessionId: forkTransferTargetSessionId,
    }).then(async (consumed) => {
      if (consumed !== true) return;
      const session = await invoke(
        "project-sessions:get",
        forkTransferTargetSessionId,
      ) as ProjectSession | null;
      if (!session) return;
      seedProjectSessionDetail(queryClient, session);
      if (session.projectId === null) {
        setProjectlessSessions((current) =>
          replaceProjectSessionById(current, session)
        );
        return;
      }
      const projectId = session.projectId;
      setSessionsByProject((current) => ({
        ...current,
        [projectId]: replaceProjectSessionById(
          current[projectId] ?? [],
          session,
        ),
      }));
    }).catch(() => undefined);
  }, [forkTransferTargetConversationId, forkTransferTargetSessionId, queryClient]);
  const scheduledAutomationsQuery = useCodexScheduledAutomations();
  const refreshProjectSessionSummariesRef =
    useRef<((projectId: string | null) => Promise<ProjectSessionSummary[]>) | null>(null);
  const pendingSidebarSessionScopesRef = useRef<{
    projectIds: Set<string>;
    projectless: boolean;
  }>({
    projectIds: new Set(),
    projectless: false,
  });
  const projectSessionSummaryRefreshInFlightRef =
    useRef<Map<string, Promise<ProjectSessionSummary[]>>>(new Map());
  const refreshSidebarSessionScopes = useCallback((
    refreshProjectSessionSummariesForId: (projectId: string | null) => Promise<ProjectSessionSummary[]>,
    projectIds: readonly string[],
    projectless: boolean,
  ) => {
    const uniqueProjectIds = [...new Set(projectIds)];
    if (uniqueProjectIds.length === 0 && !projectless) return;

    const refreshes = uniqueProjectIds.map((projectId) => refreshProjectSessionSummariesForId(projectId));
    if (projectless) refreshes.push(refreshProjectSessionSummariesForId(null));
    void Promise.all(refreshes).catch(() => undefined);
  }, []);
  const drainPendingSidebarSessionScopes = useCallback((
    refreshProjectSessionSummariesForId: (projectId: string | null) => Promise<ProjectSessionSummary[]>,
  ) => {
    const pending = pendingSidebarSessionScopesRef.current;
    if (pending.projectIds.size === 0 && !pending.projectless) return;

    const projectIds = [...pending.projectIds];
    const projectless = pending.projectless;
    pendingSidebarSessionScopesRef.current = {
      projectIds: new Set(),
      projectless: false,
    };
    refreshSidebarSessionScopes(refreshProjectSessionSummariesForId, projectIds, projectless);
  }, [refreshSidebarSessionScopes]);
  const handleSidebarSessionsAffected = useCallback((result: CodexSidebarSyncResult) => {
    const refreshProjectSessionSummariesForId = refreshProjectSessionSummariesRef.current;
    const affectedProjectIds = [...new Set(result.changedProjectIds)];
    if (affectedProjectIds.length === 0 && !result.projectlessChanged) return;

    if (!refreshProjectSessionSummariesForId) {
      const pending = pendingSidebarSessionScopesRef.current;
      for (const projectId of affectedProjectIds) pending.projectIds.add(projectId);
      pending.projectless ||= result.projectlessChanged;
      return;
    }

    refreshSidebarSessionScopes(refreshProjectSessionSummariesForId, affectedProjectIds, result.projectlessChanged);
  }, [refreshSidebarSessionScopes]);
  const {
    applySnapshot: applySidebarThreadSnapshot,
    model: sidebarThreadModel,
    refresh: refreshSidebarThreadSnapshot,
    reorderPinned: reorderPinnedSidebarThreads,
    setPinned: setSidebarThreadPinned,
  } = useSidebarThreadSyncModel({
    projects,
    onSessionsAffected: handleSidebarSessionsAffected,
  });
  const [sidebarArchivePendingKeys, setSidebarArchivePendingKeys] = useState<Set<string>>(() => new Set());
  const sidebarArchivePendingKeysRef = useRef<ReadonlySet<string>>(sidebarArchivePendingKeys);
  const knownSessions = useMemo(
    () => [...Object.values(sessionsByProject).flat(), ...projectlessSessions],
    [projectlessSessions, sessionsByProject],
  );
  const knownSessionIds = useMemo(
    () => new Set(knownSessions.map((session) => session.id)),
    [knownSessions],
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
    projectId: activeProject?.id ?? activeProjectId,
    sessionId: activeSession ? `${activeSession.id}:right-panel-actions` : "right-panel-actions",
  });
  const [cardStageHistoryModal, setCardStageHistoryModal] = useState<CardStageHistoryModalContext | null>(null);
  const [openPanelNewTabMenuKey, setOpenPanelNewTabMenuKey] = useState<string | null>(null);
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
  const rightActiveTabId = activeSessionPanelModel?.rightActiveTabId ?? null;
  const bottomActiveTabId = activeSessionPanelModel?.bottomActiveTabId ?? null;
  const rightPanelCollapsed = activeSessionPanelModel?.rightPanelCollapsed ?? true;
  const bottomPanelCollapsed = activeSessionPanelModel?.bottomPanelCollapsed ?? true;
  const sidePanelOpen = activeSessionPanelModel?.sidePanelOpen ?? false;
  const bottomPanelOpen = activeSessionPanelModel?.bottomPanelOpen ?? false;
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
  const rightPanelFullWidth = activeSessionPanelModel?.rightPanelFullWidth ?? false;
  const rightActiveRenderableTab = activeSessionPanelModel?.rightActiveRenderableTab ?? null;
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
  const readShellBodyFallbackSize = useCallback(() => {
    if (typeof window === "undefined") return { height: 0, width: 0 };
    const windowZoom = readCodexWindowZoom(workbenchRootRef.current);
    return {
      height: window.innerHeight / windowZoom,
      width: window.innerWidth / windowZoom,
    };
  }, []);
  const initialShellBodySize = readShellBodyFallbackSize();
  const shellBodySize = useElementSizeMotionValues({
    initialHeight: initialShellBodySize.height,
    initialWidth: initialShellBodySize.width,
    readFallbackSize: readShellBodyFallbackSize,
  });
  const rootFontSize = useMotionValue(readCodexRootFontSize());
  const rightPanelRequestedWidth = useMotionValue(
    rightPanel?.size.widthPx ?? RIGHT_PANEL_DEFAULT_WIDTH,
  );
  const bottomPanelRequestedHeight = useMotionValue(
    bottomPanel?.size.heightPx ?? BOTTOM_PANEL_DEFAULT_HEIGHT,
  );
  useLayoutEffect(() => {
    rightPanelRequestedWidth.set(
      rightPanel?.size.widthPx ?? RIGHT_PANEL_DEFAULT_WIDTH,
    );
  }, [activeSession?.id, rightPanel?.size.widthPx, rightPanelRequestedWidth]);
  useLayoutEffect(() => {
    bottomPanelRequestedHeight.set(
      bottomPanel?.size.heightPx ?? BOTTOM_PANEL_DEFAULT_HEIGHT,
    );
  }, [activeSession?.id, bottomPanel?.size.heightPx, bottomPanelRequestedHeight]);

  const rightPanelFullWidthValue = useSyncedMotionValue(rightPanelFullWidth ? 1 : 0);
  const sidePanelOpenValue = useSyncedMotionValue(sidePanelOpen ? 1 : 0);
  const sidebarOpenValue = useSyncedMotionValue(sidebarOpen ? 1 : 0);
  const activeSessionValue = useSyncedMotionValue(activeSession ? 1 : 0);
  const shellMainContentWidth = useTransform(
    [shellBodySize.width, realSidebarMotion.targetWidth, sidebarOpenValue],
    ([latestShellWidth, latestSidebarWidth, latestSidebarOpen]) => Math.max(
      0,
      Number(latestShellWidth) - (
        Number(latestSidebarOpen) > 0 ? Number(latestSidebarWidth) : 0
      ),
    ),
  );
  const regularRightPanelWidth = useTransform(
    [rightPanelRequestedWidth, shellMainContentWidth],
    ([latestRequestedWidth, latestSizingWidth]) => clampRegularRightPanelWidth(
      Number(latestRequestedWidth),
      Number(latestSizingWidth),
    ),
  );
  const bottomPanelHeight = useTransform(
    [bottomPanelRequestedHeight, shellBodySize.height],
    ([latestRequestedHeight, latestShellHeight]) => clampBottomPanelHeight(
      Number(latestRequestedHeight),
      Number(latestShellHeight),
    ),
  );
  const rightPanelTargetWidth = useTransform(
    [shellMainContentWidth, regularRightPanelWidth, rightPanelFullWidthValue],
    ([latestSizingWidth, latestRegularWidth, latestFullWidth]) => (
      Number(latestFullWidth) > 0
        ? Math.max(Number(latestSizingWidth), Number(latestRegularWidth))
        : Number(latestRegularWidth)
    ),
  );
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
    [rightPanelMotion.progress, rightPanelMotion.targetSize, rightPanelFullWidthValue],
    ([latestProgress, latestTargetSize, latestFullWidth]) =>
      Number(latestFullWidth) > 0
        ? 0
        : resolveCodexAnimatedPanelSize(Number(latestProgress), Number(latestTargetSize)),
  );
  const automationsRouteHeaderSlotSuppressed = useMotionValue(automationsPath ? 1 : 0);
  useLayoutEffect(() => {
    automationsRouteHeaderSlotSuppressed.set(automationsPath ? 1 : 0);
  }, [automationsPath, automationsRouteHeaderSlotSuppressed]);
  const rightHeaderShellSlotWidth = useTransform(
    [rightPanelAnimatedWidth, automationsRouteHeaderSlotSuppressed],
    ([latestRightPanelWidth, latestSuppressed]) =>
      Number(latestSuppressed) > 0 ? 0 : Number(latestRightPanelWidth),
  );
  const bottomPanelAnimatedHeightCss = useTransform(
    bottomPanelMotion.animatedSize,
    (latestHeight) => `${latestHeight}px`,
  );
  const mainContentTargetWidth = useTransform(
    [
      shellBodySize.width,
      realSidebarMotion.targetWidth,
      sidebarOpenValue,
      regularRightPanelWidth,
      sidePanelOpenValue,
      rightPanelFullWidthValue,
      activeSessionValue,
    ],
    ([
      latestShellWidth,
      latestSidebarWidth,
      latestSidebarOpen,
      latestRightPanelWidth,
      latestSidePanelOpen,
      latestRightPanelFullWidth,
      latestActiveSession,
    ]) => Number(latestActiveSession) > 0
      ? resolveCodexMainContentTargetWidth({
          shellWidth: Number(latestShellWidth),
          leftSidebarOpen: Number(latestSidebarOpen) > 0,
          leftSidebarWidth: Number(latestSidebarWidth),
          rightPanelOpen: Number(latestSidePanelOpen) > 0,
          rightPanelWidth: Number(latestRightPanelWidth),
          rightPanelFullWidth: Number(latestRightPanelFullWidth) > 0,
        })
      : 0,
  );
  const appShellMainContentLayout = "thread-edge-scroll" as const;
  const appShellHeaderEdgeScrollValue = useTransform(
    [mainContentTargetWidth, rootFontSize, rightPanelFullWidthValue],
    ([latestMainContentWidth, latestRootFontSize, latestRightPanelFullWidth]) => (
      resolveCodexHeaderEdgeScroll({
        layout: appShellMainContentLayout,
        mainContentWidth: Number(latestMainContentWidth),
        rootFontSizePx: Number(latestRootFontSize),
        rightPanelFullWidth: Number(latestRightPanelFullWidth) > 0,
      }) ? 1 : 0
    ),
  );
  const appShellHeaderEdgeScroll = useMotionValueState(appShellHeaderEdgeScrollValue) > 0;
  const appShellMainContentFrameBorderVisible = resolveCodexMainContentFrameBorder({
    rightPanelOpen: sidePanelOpen,
    headerEdgeScroll: appShellHeaderEdgeScroll,
  });
  const threadSummaryPanelLayoutModeValue = useTransform(
    mainContentTargetWidth,
    resolveCodexSummaryPanelLayoutMode,
  );
  const threadSummaryPanelLayoutMode: ThreadSummaryPanelLayoutMode =
    useMotionValueState(threadSummaryPanelLayoutModeValue);
  const shellWidthClassValue = useTransform(
    shellBodySize.width,
    resolveCodexShellWidthClass,
  );
  const shellWidthClass = useMotionValueState(shellWidthClassValue);
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

  useEffect(() => {
    if (!pendingWorktreeClientThreadId) return;
    setSettingsPath(null);
    setLocalEnvironmentSettingsInitial(null);
    setAutomationsPath(null);
  }, [pendingWorktreeClientThreadId]);

  const handleCodexAccountLogout = useCallback(async () => {
    await codexAccountActions.logout();
  }, [codexAccountActions]);
  const handleCodexAccountErrorMessage = useCallback((message: string | null) => {
    if (!message) return;
    toast.danger(message);
  }, []);
  const isMacPlatform = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
  const safeHeaderLeftWidth = isMacPlatform
    ? MAC_TRAFFIC_LIGHT_SAFE_HEADER_LEFT_PX
    : NON_MAC_SAFE_HEADER_LEFT_PX;
  const collapsedHeaderLeftFallbackWidth = safeHeaderLeftWidth + LEFT_HEADER_COLLAPSED_RAIL_FALLBACK_WIDTH_PX;
  const effectiveHeaderLeftWidth = sidebarLogicalCollapsed
    ? Math.max(headerLeftWidth, collapsedHeaderLeftFallbackWidth)
    : Math.max(headerLeftWidth, safeHeaderLeftWidth + 24);
  const realSidebarMounted = realSidebarMotion.mounted;
  const headerLeftShellSlotWidth = sidebarLogicalCollapsed && rightPanelFullWidth
    ? 0
    : realSidebarMounted
      ? realSidebarMotion.animatedWidth
      : effectiveHeaderLeftWidth;
  const headerLeftShellSlotMinWidth = realSidebarMounted
    ? sidebarLogicalCollapsed
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
    closePendingWorktreeRoute();
    setAutomationsPath(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setLocalEnvironmentSettingsInitial(null);
    setSettingsPath(buildSettingsPath("general-settings"));
  }, [closePendingWorktreeRoute]);

  const openKeyboardShortcutsSettings = useCallback(() => {
    closePendingWorktreeRoute();
    setAutomationsPath(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setLocalEnvironmentSettingsInitial(null);
    setSettingsPath(buildSettingsPath("keyboard-shortcuts"));
  }, [closePendingWorktreeRoute]);

  const openLocalEnvironmentsSettings = useCallback((input?: {
    projectId?: string | null;
    configPath?: string | null;
    reopenStableWorktreeId?: string | null;
    reopenPendingWorktreeClientThreadId?: string | null;
  }) => {
    closePendingWorktreeRoute();
    setAutomationsPath(null);
    setReopenStableWorktreeAfterSettingsId(input?.reopenStableWorktreeId ?? null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(
      input?.reopenPendingWorktreeClientThreadId ?? null,
    );
    setLocalEnvironmentSettingsInitial({
      projectId: input?.projectId ?? null,
      configPath: input?.configPath ?? null,
    });
    setSettingsPath(buildSettingsPath("local-environments"));
  }, [closePendingWorktreeRoute]);

  const openHooksSettings = useCallback((target: CodexHooksSettingsTarget) => {
    closePendingWorktreeRoute();
    setAutomationsPath(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setLocalEnvironmentSettingsInitial(null);
    setSettingsPath(buildCodexHooksSettingsPath(target));
  }, [closePendingWorktreeRoute]);

  const closeSettings = useCallback(() => {
    setSettingsPath(null);
    setLocalEnvironmentSettingsInitial(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    if (
      reopenStableWorktreeAfterSettingsId
      && pendingStableWorktrees.some((entry) => entry.id === reopenStableWorktreeAfterSettingsId)
    ) {
      setStableWorktreeStatusId(reopenStableWorktreeAfterSettingsId);
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
  }, [
    pendingStableWorktrees,
    pendingWorktrees,
    reopenPendingWorktreeAfterSettingsClientThreadId,
    reopenStableWorktreeAfterSettingsId,
  ]);

  const openAutomations = useCallback((path = buildAutomationsPath()) => {
    closePendingWorktreeRoute();
    setSettingsPath(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setAutomationsPath(path);
  }, [closePendingWorktreeRoute]);

  useEffect(() => {
    if (
      typeof settingsToggleTick !== "number"
      || settingsToggleTick <= 0
      || settingsToggleTick === lastHandledSettingsToggleTickRef.current
    ) {
      return;
    }

    lastHandledSettingsToggleTickRef.current = settingsToggleTick;
    setAutomationsPath(null);
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setLocalEnvironmentSettingsInitial(null);
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
    setReopenStableWorktreeAfterSettingsId(null);
    setReopenPendingWorktreeAfterSettingsClientThreadId(null);
    setLocalEnvironmentSettingsInitial(null);
    setSettingsPath(buildSettingsPath("keyboard-shortcuts"));
  }, [keyboardShortcutsSettingsOpenTick]);

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

  useEffect(() => {
    let disposed = false;
    void invoke("settings:git:get")
      .then((settings) => {
        if (disposed) return;
        if (!isCodexGitSettings(settings)) return;
        setWorktreeAutoBranchPrefix(writeWorktreeAutoBranchPrefix(settings.branchPrefix));
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
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
    seedProjectSessionDetails(queryClient, sessions);
    setProjectSessionSummaries(queryClient, projectId, sessions.map(projectSessionToSummary));
    if (projectId === null) {
      setProjectlessSessions(sessions);
      return sessions;
    }
    setSessionsByProject((current) => ({ ...current, [projectId]: sessions }));
    return sessions;
  }, [queryClient]);

  const reorderProjectThreadsForSidebar = useCallback(async (
    projectId: string,
    orderedThreadIds: string[],
  ) => {
    const result = await invoke("codex:sidebar:project-thread-order:set", {
      projectId,
      orderedThreadIds,
    });
    startTransition(() => {
      applySidebarThreadSnapshot(result.snapshot);
    });
  }, [applySidebarThreadSnapshot]);

  const reorderChatsThreadsForSidebar = useCallback(async (
    input: CodexSidebarChatsThreadOrderInput,
  ) => {
    const result = await invoke("codex:sidebar:chats-thread-order:set", input);
    startTransition(() => {
      applySidebarThreadSnapshot(result.snapshot);
    });
  }, [applySidebarThreadSnapshot]);

  const moveSidebarThreadForSidebar = useCallback(async (
    drop: SidebarThreadDropRequest,
  ) => {
    if (
      !isCodexSidebarThreadContainerId(drop.sourceContainerId)
      || !isCodexSidebarThreadContainerId(drop.targetContainerId)
    ) {
      throw new Error("Invalid sidebar thread move container");
    }

    const placement: CodexSidebarThreadMovePlacement = drop.useDefaultOrder
      ? { beforeThreadId: null, useDefaultOrder: true }
      : drop.insertAtEnd
        ? { beforeThreadId: null, insertAtEnd: true }
        : drop.beforeThreadId === null
          ? { beforeThreadId: null }
          : { beforeThreadId: drop.beforeThreadId };
    const moveInput: CodexSidebarThreadMoveInput = {
      hostId: "local",
      threadId: drop.threadId,
      sourceContainerId: drop.sourceContainerId,
      targetContainerId: drop.targetContainerId,
      ...placement,
    };
    const result = await invoke("codex:sidebar:thread:move", moveInput);
    if (result.status === "blocked") {
      setBlockedSidebarThreadMove(result);
      return;
    }
    if (result.status === "unchanged") return;

    const scopes = new Map([
      [result.source.projectId ?? "__projectless__", result.source] as const,
      [result.destination.projectId ?? "__projectless__", result.destination] as const,
    ]);
    for (const scope of scopes.values()) {
      setProjectSessionSummaries(queryClient, scope.projectId, scope.sessions);
    }
    startTransition(() => {
      const projectless = scopes.get("__projectless__");
      if (projectless) {
        setProjectlessSessions((current) => (
          mergeLoadedProjectSessionSummaries(current, projectless.sessions)
        ));
      }
      setSessionsByProject((current) => {
        const next = { ...current };
        for (const scope of scopes.values()) {
          if (scope.projectId === null) continue;
          next[scope.projectId] = mergeLoadedProjectSessionSummaries(
            current[scope.projectId] ?? [],
            scope.sessions,
          );
        }
        return next;
      });
      applySidebarThreadSnapshot(result.snapshot);
    });
  }, [applySidebarThreadSnapshot, queryClient]);

  const refreshProjectSessionSummaries = useCallback(async (projectId: string | null) => {
    const key = projectId ?? "__projectless__";
    const existing = projectSessionSummaryRefreshInFlightRef.current.get(key);
    if (existing) return await existing;

    const request = (async () => {
      const summaries = (await invoke("project-sessions:list-summaries", projectId)) as ProjectSessionSummary[];
      setProjectSessionSummaries(queryClient, projectId, summaries);
      if (projectId === null) {
        setProjectlessSessions((current) => mergeLoadedProjectSessionSummaries(current, summaries));
        return summaries;
      }
      setSessionsByProject((current) => ({
        ...current,
        [projectId]: mergeLoadedProjectSessionSummaries(current[projectId] ?? [], summaries),
      }));
      return summaries;
    })();

    projectSessionSummaryRefreshInFlightRef.current.set(key, request);
    try {
      return await request;
    } finally {
      if (projectSessionSummaryRefreshInFlightRef.current.get(key) === request) {
        projectSessionSummaryRefreshInFlightRef.current.delete(key);
      }
    }
  }, [queryClient]);

  useEffect(() => {
    refreshProjectSessionSummariesRef.current = refreshProjectSessionSummaries;
    drainPendingSidebarSessionScopes(refreshProjectSessionSummaries);
    return () => {
      if (refreshProjectSessionSummariesRef.current === refreshProjectSessionSummaries) {
        refreshProjectSessionSummariesRef.current = null;
      }
    };
  }, [drainPendingSidebarSessionScopes, refreshProjectSessionSummaries]);

  const mergeSessionInState = useCallback((session: ProjectSession) => {
    seedProjectSessionDetail(queryClient, session);
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
  }, [queryClient]);

  const warmProjectSessionDbViewBoards = useCallback((session: ProjectSession) => {
    for (const target of listSessionDbViewTargets(session)) {
      void ensureFreshDatabaseViewBoard(
        target.projectId,
        target.databaseViewId,
      ).catch(() => undefined);
    }
  }, []);

  const prefetchSidebarSession = useCallback((item: CodexSidebarThreadItem) => {
    if (item.disabled) return;

    const session = item.sessionId
      ? knownSessions.find((candidate) => candidate.id === item.sessionId) ?? null
      : knownSessions.find((candidate) => candidate.thread?.threadId === item.threadId) ?? null;
    const sessionId = item.sessionId ?? session?.id ?? null;
    if (!sessionId) return;

    const cached = getCachedProjectSessionDetail(queryClient, sessionId);
    if (cached) {
      warmProjectSessionDbViewBoards(cached);
      return;
    }

    void prefetchProjectSessionDetail(queryClient, sessionId)
      .then((detail) => {
        if (detail) warmProjectSessionDbViewBoards(detail);
      })
      .catch(() => undefined);
  }, [knownSessions, queryClient, warmProjectSessionDbViewBoards]);

  useEffect(() => {
    if (!activeSession) return;

    const cached = getCachedProjectSessionDetail(queryClient, activeSession.id);
    if (cached) {
      mergeSessionInState(cached);
      warmProjectSessionDbViewBoards(cached);
      return;
    }

    void prefetchProjectSessionDetail(queryClient, activeSession.id)
      .then((detail) => {
        if (!detail) return;
        mergeSessionInState(detail);
        warmProjectSessionDbViewBoards(detail);
      })
      .catch(() => undefined);
  }, [activeSession, mergeSessionInState, queryClient, warmProjectSessionDbViewBoards]);

  useEffect(() => {
    setRetainedSessionEntries(buildRetainedSessionEntries({
      activeSessionId: activeRenderSession?.id ?? null,
      activeSession: activeRenderSession,
      previousEntries: getRetainedSessionEntries(),
      knownSessionIds,
      getSessionDetail: (sessionId) => getCachedProjectSessionDetail(queryClient, sessionId),
      cap: RETAINED_SESSION_CAP,
    }));
  }, [
    activeRenderSession,
    getRetainedSessionEntries,
    knownSessionIds,
    queryClient,
    setRetainedSessionEntries,
  ]);

  const retainedSessionRenderEntries = useMemo(() => {
    const entries: Array<{ session: ProjectSession; isActive: boolean }> = [];
    if (activeRenderSession) {
      entries.push({ session: activeRenderSession, isActive: true });
    }

    const activeId = activeRenderSession?.id ?? null;
    for (const entry of retainedSessionEntries) {
      if (entry.sessionId === activeId) continue;
      if (!knownSessionIds.has(entry.sessionId)) continue;

      const detail = getCachedProjectSessionDetail(queryClient, entry.sessionId);
      if (!isRetainableProjectSession(detail, knownSessionIds)) continue;
      entries.push({ session: detail, isActive: false });
      if (entries.length >= RETAINED_SESSION_CAP) break;
    }

    return entries;
  }, [activeRenderSession, knownSessionIds, queryClient, retainedSessionEntries]);

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

  const resolveForkLocalEnvironmentConfigPath = useCallback(async (
    workspaceRoot: string | null | undefined,
  ): Promise<string | null> => {
    return await loadLocalEnvironmentConfigSelection({
      workspaceRoot,
      selectionsByWorkspace: readLocalEnvironmentSelections(),
      loadCandidates: async (resolvedWorkspaceRoot) => await invoke(
        "worktrees:environments:configs:list-for-workspace",
        "local",
        resolvedWorkspaceRoot,
      ),
    });
  }, []);

  const refreshAllSessions = useCallback(async () => {
    if (projects.length === 0) return;
    setLoadingSessions(true);
    setSessionError(null);
    try {
      await Promise.all([
        ...projects.map((project) => refreshProjectSessionSummaries(project.id)),
        refreshProjectSessionSummaries(null),
      ]);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Unable to load project sessions");
    } finally {
      setLoadingSessions(false);
    }
  }, [projects, refreshProjectSessionSummaries]);

  useEffect(() => {
    void refreshAllSessions();
  }, [refreshAllSessions]);

  useEffect(() => {
    const measure = () => rootFontSize.set(readCodexRootFontSize());

    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [rootFontSize]);

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
    const cachedSession = getCachedProjectSessionDetail(queryClient, session.id);
    const targetSession = cachedSession ?? session;
    warmProjectSessionDbViewBoards(targetSession);
    recordShellNavigation(buildSnapshotForSession(targetSession, targetSession.projectId ?? activeProjectId));

    const revealSession = () => {
      setActiveSessionId(targetSession.id);
      if (targetSession.projectId !== null) {
        const projectId = targetSession.projectId;
        setActiveProjectId(projectId);
        setDbProject(projectId);
        setExpandedProjectIds((current) => new Set([...current, projectId]));
      }
    };

    if (shouldSynchronouslyRevealSession({
      sessionId: targetSession.id,
      cachedSession,
      retainedEntries: retainedSessionEntries,
    })) {
      revealSession();
    } else {
      startTransition(revealSession);
    }

    if (targetSession.unread) {
      const threadId = targetSession.thread?.threadId ?? null;
      if (threadId) {
        void workbenchCodexControl.markConversationAsRead(threadId).catch(() => undefined);
        return;
      }
      void invoke("project-sessions:mark-unread", targetSession.id, { unread: false })
        .then((updated) => {
          if (!updated) return;
          mergeSessionInState(updated as ProjectSession);
        })
        .catch(() => undefined);
    }
  }, [
    activeProjectId,
    buildSnapshotForSession,
    mergeSessionInState,
    queryClient,
    recordShellNavigation,
    retainedSessionEntries,
    setDbProject,
    warmProjectSessionDbViewBoards,
    workbenchCodexControl,
  ]);

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
        await setSidebarThreadPinned(session.thread.threadId, nextPinned);
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
  }, [mergeSessionInState, refreshProjectSessions, sessionsByProject, setSidebarThreadPinned]);

  const toggleSidebarThreadPinned = useCallback(async (item: CodexSidebarThreadItem) => {
    if (item.disabled) return;
    const nextPinned = !item.pinned;
    try {
      if (item.kind === "pending-worktree") {
        if (!item.pendingWorktreeId) return;
        await invoke(
          "codex:pending-worktree:set-pinned",
          item.hostId,
          item.pendingWorktreeId,
          nextPinned,
        );
        return;
      }
      await setSidebarThreadPinned(item.threadId, nextPinned);
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
  }, [knownSessions, mergeSessionInState, refreshProjectSessions, setSidebarThreadPinned]);

  const selectSidebarThread = useCallback(async (item: CodexSidebarThreadItem) => {
    if (item.disabled) return;
    if (item.kind === "pending-worktree") {
      setSettingsPath(null);
      setLocalEnvironmentSettingsInitial(null);
      setAutomationsPath(null);
      setPendingWorktreeClientThreadId(item.threadId);
      return;
    }
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

  const handlePendingWorktreeTitleDoubleClick = useCallback((
    item: CodexSidebarThreadItem,
    event: ReactMouseEvent<HTMLElement>,
  ) => {
    if (event.defaultPrevented || item.kind !== "pending-worktree") return;
    setRenamePendingWorktree(item);
  }, []);

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

  const resolveSidebarArchivePendingKeyForSession = useCallback((session: ProjectSession) => {
    for (const [key, item] of sidebarThreadModel.threadItemsByKey) {
      if (item.sessionId === session.id) return key;
      if (session.thread && item.threadId === session.thread.threadId) return key;
    }

    return `local:session:${session.id}`;
  }, [sidebarThreadModel.threadItemsByKey]);

  const beginSidebarArchive = useCallback((key: string): boolean => {
    const current = sidebarArchivePendingKeysRef.current;
    if (current.has(key)) return false;

    const next = new Set(current);
    next.add(key);
    sidebarArchivePendingKeysRef.current = next;
    setSidebarArchivePendingKeys(next);
    return true;
  }, []);

  const finishSidebarArchive = useCallback((key: string) => {
    const current = sidebarArchivePendingKeysRef.current;
    if (!current.has(key)) return;

    const next = new Set(current);
    next.delete(key);
    sidebarArchivePendingKeysRef.current = next;
    setSidebarArchivePendingKeys(next);
  }, []);

  const archiveSessionWithSidebarPendingState = useCallback(async (session: ProjectSession) => {
    const pendingKey = resolveSidebarArchivePendingKeyForSession(session);
    if (!beginSidebarArchive(pendingKey)) return;

    try {
      const archived = await archiveSession(session, { showToast: false });
      if (!archived) toast.danger("Failed to archive chat");
    } finally {
      finishSidebarArchive(pendingKey);
    }
  }, [
    archiveSession,
    beginSidebarArchive,
    finishSidebarArchive,
    resolveSidebarArchivePendingKeyForSession,
  ]);

  const archiveSidebarThreadItem = useCallback(async (item: CodexSidebarThreadItem) => {
    if (item.disabled || !beginSidebarArchive(item.key)) return;

    try {
      if (item.kind === "pending-worktree") {
        if (!item.pendingWorktreeId) return;
        await invoke(
          "codex:pending-worktree:cancel",
          item.hostId,
          item.pendingWorktreeId,
        );
        if (item.threadId === pendingWorktreeClientThreadId) closePendingWorktreeRoute();
        return;
      }

      const session = item.sessionId
        ? knownSessions.find((candidate) => candidate.id === item.sessionId) ?? null
        : knownSessions.find((candidate) => candidate.thread?.threadId === item.threadId) ?? null;
      if (session) {
        const archived = await archiveSession(session, { showToast: false });
        if (!archived) toast.danger("Failed to archive chat");
        return;
      }

      await invoke("codex:thread:archive", item.threadId);
      await refreshSidebarThreadSnapshot();
    } catch {
      toast.danger(item.kind === "pending-worktree"
        ? "Failed to cancel worktree setup"
        : "Failed to archive chat");
    } finally {
      finishSidebarArchive(item.key);
    }
  }, [
    archiveSession,
    beginSidebarArchive,
    closePendingWorktreeRoute,
    finishSidebarArchive,
    knownSessions,
    pendingWorktreeClientThreadId,
    refreshSidebarThreadSnapshot,
  ]);

  const toggleSessionUnread = useCallback(async (session: ProjectSession) => {
    const hasUnreadTurn = !session.unread;
    try {
      if (session.thread?.threadId) {
        if (hasUnreadTurn) {
          await workbenchCodexControl.markConversationAsUnread(session.thread.threadId);
        } else {
          await workbenchCodexControl.markConversationAsRead(session.thread.threadId);
        }
        mergeSessionInState({ ...session, unread: hasUnreadTurn });
        return;
      }
      const updated = await invoke(
        "project-sessions:mark-unread",
        session.id,
        { unread: hasUnreadTurn },
      ) as ProjectSession | null;
      if (updated) mergeSessionInState(updated);
    } catch {
      toast.danger(hasUnreadTurn ? "Failed to mark chat unread" : "Failed to mark chat read");
    }
  }, [mergeSessionInState, workbenchCodexControl]);

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
      const localEnvironmentConfigPath = target === "newWorktree"
        ? await resolveForkLocalEnvironmentConfigPath(
          session.thread?.cwd,
        )
        : null;
      const result = await invoke("project-sessions:fork", session.id, {
        target,
        ...(target === "newWorktree" ? { localEnvironmentConfigPath } : {}),
      }) as ProjectSessionForkResult;
      if ("pendingWorktreeId" in result) {
        setPendingWorktreeClientThreadId(result.clientThreadId);
        return;
      }
      await refreshProjectSessions(result.session.projectId);
      selectSession(result.session);
    } catch {
      toast.danger(target === "newWorktree" ? "Failed to fork chat into new worktree" : "Failed to fork chat");
    }
  }, [refreshProjectSessions, resolveForkLocalEnvironmentConfigPath, selectSession]);

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
      await archiveSessionWithSidebarPendingState(session);
      return;
    }
    if (actionId === SESSION_CONTEXT_MENU_ACTION_IDS.markUnread) {
      await toggleSessionUnread(session);
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
    archiveSessionWithSidebarPendingState,
    copySessionText,
    forkSession,
    toggleSessionUnread,
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
    const automationCount = (automationTabsBySession[activeSession.id] ?? []).filter((tab) => {
      if (tab.id === excludedTabId) return false;
      return tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leafId;
    }).length;
    const backgroundAgentCount = (backgroundAgentTabsBySession[activeSession.id] ?? []).filter((tab) => {
      if (tab.id === excludedTabId) return false;
      return tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leafId;
    }).length;
    const processOutputCount = (processOutputTabsBySession[activeSession.id] ?? []).filter((tab) => {
      if (tab.id === excludedTabId) return false;
      return tab.panelId === panelId && (tab.leafId ?? activeLeafId) === leafId;
    }).length;
    const previewTab = getRenderablePanelPreviewTab(activeSession, panelId, leafId, previewTabsByPanel);
    const previewCount = previewTab && previewTab.id !== excludedTabId ? 1 : 0;
    return durableCount + sideChatCount + mcpAppCount + planCount + automationCount + backgroundAgentCount + processOutputCount + previewCount;
  }, [
    activeSession,
    automationTabsBySession,
    backgroundAgentTabsBySession,
    mcpAppTabsBySession,
    planTabsBySession,
    processOutputTabsBySession,
    previewTabsByPanel,
    sideChatTabsBySession,
  ]);

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

  const clearBackgroundAgentActiveTab = useCallback((
    sessionId: string,
    panelId: PanelId,
    leafId?: string | null,
  ) => {
    setBackgroundAgentActiveTabByPanel((current) => {
      const keys = [
        makeBackgroundAgentPanelKey(sessionId, panelId, leafId),
        makeBackgroundAgentPanelKey(sessionId, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }, []);

  const clearProcessOutputActiveTab = useCallback((
    sessionId: string,
    panelId: PanelId,
    leafId?: string | null,
  ) => {
    setProcessOutputActiveTabByPanel((current) => {
      const keys = [
        makeProcessOutputPanelKey(sessionId, panelId, leafId),
        makeProcessOutputPanelKey(sessionId, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }, []);

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
      clearBackgroundAgentActiveTab(activeSession.id, panelId, leafId);
      clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
      setAutomationActiveTabByPanel((current) => {
        const keys = [
          makeAutomationPanelKey(activeSession.id, panelId, leafId),
          makeAutomationPanelKey(activeSession.id, panelId),
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
      setSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeSideChatPanelKey(activeSession.id, panelId, leafId)]: tabId,
      }));
      return;
    }

    if ((mcpAppTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, leafId);
      clearBackgroundAgentActiveTab(activeSession.id, panelId, leafId);
      clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
      setAutomationActiveTabByPanel((current) => {
        const keys = [
          makeAutomationPanelKey(activeSession.id, panelId, leafId),
          makeAutomationPanelKey(activeSession.id, panelId),
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
      return;
    }

    const planTab = (planTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (planTab) {
      clearPanelPreviewTab(activeSession.id, panelId, leafId);
      clearBackgroundAgentActiveTab(activeSession.id, panelId, leafId);
      clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
      setAutomationActiveTabByPanel((current) => {
        const keys = [
          makeAutomationPanelKey(activeSession.id, panelId, leafId),
          makeAutomationPanelKey(activeSession.id, panelId),
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

    if ((automationTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, leafId);
      clearBackgroundAgentActiveTab(activeSession.id, panelId, leafId);
      clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
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
      setAutomationActiveTabByPanel((current) => ({
        ...current,
        [makeAutomationPanelKey(activeSession.id, panelId, leafId)]: tabId,
      }));
      return;
    }

    if ((backgroundAgentTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, leafId);
      clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
      setAutomationActiveTabByPanel((current) => {
        const keys = [
          makeAutomationPanelKey(activeSession.id, panelId, leafId),
          makeAutomationPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
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
      setBackgroundAgentActiveTabByPanel((current) => ({
        ...current,
        [makeBackgroundAgentPanelKey(activeSession.id, panelId, leafId)]: tabId,
      }));
      return;
    }

    if ((processOutputTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, leafId);
      clearBackgroundAgentActiveTab(activeSession.id, panelId, leafId);
      setAutomationActiveTabByPanel((current) => {
        const keys = [
          makeAutomationPanelKey(activeSession.id, panelId, leafId),
          makeAutomationPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
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
      setProcessOutputActiveTabByPanel((current) => ({
        ...current,
        [makeProcessOutputPanelKey(activeSession.id, panelId, leafId)]: tabId,
      }));
      return;
    }

    if (!activeSession.tabs.some((tab) => tab.id === tabId && tab.panelId === panelId)) return;

    clearBackgroundAgentActiveTab(activeSession.id, panelId, leafId);
    clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
    setAutomationActiveTabByPanel((current) => {
      const keys = [
        makeAutomationPanelKey(activeSession.id, panelId, leafId),
        makeAutomationPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
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
    setAutomationActiveTabByPanel((current) => {
      const keys = [
        makeAutomationPanelKey(activeSession.id, panelId, leafId),
        makeAutomationPanelKey(activeSession.id, panelId),
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
    automationTabsBySession,
    backgroundAgentTabsBySession,
    clearPanelPreviewTab,
    clearBackgroundAgentActiveTab,
    clearProcessOutputActiveTab,
    mcpAppTabsBySession,
    planTabsBySession,
    processOutputTabsBySession,
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
    if (previewTab?.kind === "browser") {
      const browserTabId = requireProjectSessionBrowserTabId(previewTab);
      const durableIdentityStillReferenced = activeSession.tabs.some((tab) =>
        tab.kind === "browser"
        && requireProjectSessionBrowserTabId(tab) === browserTabId
      );
      if (!durableIdentityStillReferenced) {
        await invoke("browser-sidebar-command", {
          type: "close-tab",
          browserConversationId: activeSession.id,
          browserTabId,
        });
      }
    }
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

  const closeAutomationPanelTab = useCallback(async (
    panelId: PanelId,
    tabId: string,
    replacementTabId: string | null = null,
  ) => {
    if (!activeSession) return;
    const automationTab = (automationTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (!automationTab) return;
    const targetLeafId = automationTab.leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);

    setAutomationTabsBySession((current) => {
      const tabs = current[activeSession.id] ?? [];
      return {
        ...current,
        [activeSession.id]: tabs.filter((tab) => tab.id !== tabId),
      };
    });
    setAutomationActiveTabByPanel((current) => {
      const keys = [
        makeAutomationPanelKey(activeSession.id, panelId, automationTab.leafId),
        makeAutomationPanelKey(activeSession.id, panelId),
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
    automationTabsBySession,
    getPanelVisibleLeafTabCount,
    getPanelVisibleTabCount,
    removeEmptyVisiblePanelLeaf,
    updateActivePanel,
  ]);

  const closeBackgroundAgentPanelTab = useCallback(async (
    panelId: PanelId,
    tabId: string,
    replacementTabId: string | null = null,
  ) => {
    if (!activeSession) return;
    const backgroundAgentTab = (backgroundAgentTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (!backgroundAgentTab) return;
    const targetLeafId = backgroundAgentTab.leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);

    setBackgroundAgentTabsBySession((current) => {
      const tabs = current[activeSession.id] ?? [];
      return {
        ...current,
        [activeSession.id]: tabs.filter((tab) => tab.id !== tabId),
      };
    });
    setBackgroundAgentActiveTabByPanel((current) => {
      const keys = [
        makeBackgroundAgentPanelKey(activeSession.id, panelId, backgroundAgentTab.leafId),
        makeBackgroundAgentPanelKey(activeSession.id, panelId),
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
    backgroundAgentTabsBySession,
    getPanelVisibleLeafTabCount,
    getPanelVisibleTabCount,
    removeEmptyVisiblePanelLeaf,
    updateActivePanel,
  ]);

  const closeProcessOutputPanelTab = useCallback(async (
    panelId: PanelId,
    tabId: string,
    replacementTabId: string | null = null,
  ) => {
    if (!activeSession) return;
    const processOutputTab = (processOutputTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (!processOutputTab) return;
    const targetLeafId = processOutputTab.leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);

    setProcessOutputTabsBySession((current) => {
      const tabs = current[activeSession.id] ?? [];
      return {
        ...current,
        [activeSession.id]: tabs.filter((tab) => tab.id !== tabId),
      };
    });
    setProcessOutputActiveTabByPanel((current) => {
      const keys = [
        makeProcessOutputPanelKey(activeSession.id, panelId, processOutputTab.leafId),
        makeProcessOutputPanelKey(activeSession.id, panelId),
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
    processOutputTabsBySession,
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
    if ((automationTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      await closeAutomationPanelTab(panelId, tabId, replacementTabId);
      return;
    }
    if ((backgroundAgentTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      await closeBackgroundAgentPanelTab(panelId, tabId, replacementTabId);
      return;
    }
    if ((processOutputTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      await closeProcessOutputPanelTab(panelId, tabId, replacementTabId);
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
    automationTabsBySession,
    backgroundAgentTabsBySession,
    closeAutomationPanelTab,
    closeBackgroundAgentPanelTab,
    closeProcessOutputPanelTab,
    closePreviewTab,
    closeMcpAppPanelTab,
    closePlanPanelTab,
    closeSideChatPanelTab,
    closeTab,
    getPreserveEmptyLeafIdsAfterDurableRemoval,
    mcpAppTabsBySession,
    planTabsBySession,
    processOutputTabsBySession,
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
      clearBackgroundAgentActiveTab(activeSession.id, panelId, targetLeafId);
      clearProcessOutputActiveTab(activeSession.id, panelId, targetLeafId);
      setAutomationActiveTabByPanel((current) => {
        const keys = [
          makeAutomationPanelKey(activeSession.id, panelId, targetLeafId),
          makeAutomationPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
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
      clearBackgroundAgentActiveTab(activeSession.id, panelId, targetLeafId);
      clearProcessOutputActiveTab(activeSession.id, panelId, targetLeafId);
      setAutomationActiveTabByPanel((current) => {
        const keys = [
          makeAutomationPanelKey(activeSession.id, panelId, targetLeafId),
          makeAutomationPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
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
      clearBackgroundAgentActiveTab(activeSession.id, panelId, targetLeafId);
      clearProcessOutputActiveTab(activeSession.id, panelId, targetLeafId);
      setAutomationActiveTabByPanel((current) => {
        const keys = [
          makeAutomationPanelKey(activeSession.id, panelId, targetLeafId),
          makeAutomationPanelKey(activeSession.id, panelId),
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

    if ((automationTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
      clearBackgroundAgentActiveTab(activeSession.id, panelId, targetLeafId);
      clearProcessOutputActiveTab(activeSession.id, panelId, targetLeafId);
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
      setAutomationActiveTabByPanel((current) => ({
        ...current,
        [makeAutomationPanelKey(activeSession.id, panelId, targetLeafId)]: tabId,
      }));
      return;
    }

    if ((backgroundAgentTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
      clearProcessOutputActiveTab(activeSession.id, panelId, targetLeafId);
      setAutomationActiveTabByPanel((current) => {
        const keys = [
          makeAutomationPanelKey(activeSession.id, panelId, targetLeafId),
          makeAutomationPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
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
      setBackgroundAgentActiveTabByPanel((current) => ({
        ...current,
        [makeBackgroundAgentPanelKey(activeSession.id, panelId, targetLeafId)]: tabId,
      }));
      return;
    }

    if ((processOutputTabsBySession[activeSession.id] ?? []).some((tab) => tab.id === tabId)) {
      clearPanelPreviewTab(activeSession.id, panelId, targetLeafId);
      clearBackgroundAgentActiveTab(activeSession.id, panelId, targetLeafId);
      setAutomationActiveTabByPanel((current) => {
        const keys = [
          makeAutomationPanelKey(activeSession.id, panelId, targetLeafId),
          makeAutomationPanelKey(activeSession.id, panelId),
        ];
        if (!keys.some((key) => key in current)) return current;
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
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
      setProcessOutputActiveTabByPanel((current) => ({
        ...current,
        [makeProcessOutputPanelKey(activeSession.id, panelId, targetLeafId)]: tabId,
      }));
      return;
    }

    clearBackgroundAgentActiveTab(activeSession.id, panelId, targetLeafId);
    clearProcessOutputActiveTab(activeSession.id, panelId, targetLeafId);
    setAutomationActiveTabByPanel((current) => {
      const keys = [
        makeAutomationPanelKey(activeSession.id, panelId, targetLeafId),
        makeAutomationPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
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
    automationTabsBySession,
    backgroundAgentTabsBySession,
    clearPanelPreviewTab,
    clearBackgroundAgentActiveTab,
    clearProcessOutputActiveTab,
    mcpAppTabsBySession,
    planTabsBySession,
    processOutputTabsBySession,
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
    const targetLeafId = leafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    const previewTab = previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId, targetLeafId)]
      ?? previewTabsByPanel[makePanelPreviewKey(activeSession.id, panelId)];
    if (!previewTab || previewTab.id !== tabId) return;
    if (isProjectSessionFilesPreviewTab(previewTab) && previewTab.config.projectId === null) return;
    if (pinningPreviewTabIdsRef.current.has(tabId)) return;

    pinningPreviewTabIdsRef.current.add(tabId);
    try {
      await invoke("project-session-panels:activate", {
        sessionId: activeSession.id,
        panelId,
        leafId: targetLeafId,
      });
      const previewTabConfig: ProjectSessionTabConfig = isProjectSessionFilesPreviewTab(previewTab)
        ? {
            ...previewTab.config,
            projectId: projectId ?? previewTab.config.projectId,
          }
        : previewTab.config;
      const createInput: ProjectSessionTabCreateInput = {
        sessionId: activeSession.id,
        projectId,
        panelId,
        targetLeafId,
        ...(previewTab.kind === "browser"
          ? { browserTabId: requireProjectSessionBrowserTabId(previewTab) }
          : {}),
        ...(previewTab.kind === "card_stage" ? { clientTabId: previewTab.id } : {}),
        kind: previewTab.kind,
        title: previewTab.title,
        config: previewTabConfig,
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
    if (!session) throw new Error("Panel split no longer exists");
    mergeSessionInState(session);
  }, [activeSession, mergeSessionInState]);

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
    setAutomationActiveTabByPanel((current) => {
      const keys = [
        makeAutomationPanelKey(activeSession.id, panelId, leafId),
        makeAutomationPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
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
    clearProcessOutputActiveTab,
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
    setAutomationActiveTabByPanel((current) => {
      const keys = [
        makeAutomationPanelKey(activeSession.id, panelId, leafId),
        makeAutomationPanelKey(activeSession.id, panelId),
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
    clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
    setMcpAppActiveTabByPanel((current) => ({
      ...current,
      [makeMcpAppPanelKey(activeSession.id, panelId, leafId)]: tabId,
    }));
    await ensureActivePanelOpenWithoutRefresh(panelId);
  }, [activeSession, clearPanelPreviewTab, clearProcessOutputActiveTab, ensureActivePanelOpenWithoutRefresh]);

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
    setAutomationActiveTabByPanel((current) => {
      const keys = [
        makeAutomationPanelKey(activeSession.id, panelId, leafId),
        makeAutomationPanelKey(activeSession.id, panelId),
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
    setAutomationActiveTabByPanel((current) => {
      const keys = [
        makeAutomationPanelKey(activeSession.id, panelId, leafId),
        makeAutomationPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
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
  }, [activeSession, clearPanelPreviewTab, clearProcessOutputActiveTab, ensureActivePanelOpenWithoutRefresh]);

  const openAutomationSidePanel = useCallback(async (input: ThreadSummaryPanelScheduledAutomationOpenInput) => {
    if (!activeSession || activeSession.projectId === null) return;
    const projectId = activeSession.projectId;
    const panelId: PanelId = "right";
    const leafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const mode = input.mode ?? "open";
    const automationId = input.automationId ?? input.updateInput?.id ?? null;
    const suggestionKey = [
      mode,
      input.updateInput?.id ?? automationId ?? "",
      input.createInput?.name ?? input.updateInput?.name ?? input.title,
      input.createInput?.rrule ?? input.updateInput?.rrule ?? "",
    ].join(":");
    const tabId = mode === "suggested-create" || mode === "suggested-update"
      ? `automation-suggestion:${encodeURIComponent(suggestionKey)}`
      : `automation:${automationId ?? encodeURIComponent(input.title)}`;
    const tab: AutomationPanelTab = {
      automationPanel: true,
      id: tabId,
      sessionId: activeSession.id,
      projectId,
      panelId,
      leafId,
      title: input.title.trim() || "Scheduled task",
      stateKey: Date.now(),
      automationId,
      createInput: input.createInput ?? null,
      mode,
      updateInput: input.updateInput ?? null,
    };

    setAutomationTabsBySession((current) => {
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
    clearBackgroundAgentActiveTab(activeSession.id, panelId, leafId);
    clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
    setAutomationActiveTabByPanel((current) => ({
      ...current,
      [makeAutomationPanelKey(activeSession.id, panelId, leafId)]: tabId,
    }));
    await ensureActivePanelOpenWithoutRefresh(panelId);
  }, [
    activeSession,
    clearBackgroundAgentActiveTab,
    clearPanelPreviewTab,
    clearProcessOutputActiveTab,
    ensureActivePanelOpenWithoutRefresh,
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
    const sessionProjectId = activeSession.projectId;
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
    if (!activeSession) return false;
    const sessionProjectId = activeSession.projectId;
    const project = sessionProjectId === null
      ? null
      : projects.find((candidate) => candidate.id === sessionProjectId) ?? null;
    const workspaceRoot = normalizeProjectPrimaryWorkspaceRoot(project)
      ?? getWorkspaceFileParentPath(input.path);
    if (!workspaceRoot) return false;
    const existing = activeSession.tabs.find((tab) =>
      tab.kind === "files"
      && tab.panelId === input.panelId
      && "path" in tab.config
      && tab.config.path === input.path,
    );
    if (existing) {
      await setActivePanelTab(input.panelId, existing.id, { openPanel: true });
      return true;
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
    return true;
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
      const requestedAncestors = options?.ancestors;
      const existingConfig = existing.config as ProjectSessionCardStageTabConfig;
      const shouldRefreshBreadcrumb = requestedAncestors !== undefined
        && !cardStageAncestorsEqual(existingConfig.ancestors, requestedAncestors);
      if (shouldRefreshBreadcrumb) {
        await invoke("project-session-tabs:update", existing.id, {
          config: {
            ...existingConfig,
            ...(titleSnapshot !== undefined ? { titleSnapshot } : {}),
            ancestors: [...requestedAncestors],
          },
        });
      }
      const existingLeafId = resolveLeafIdForPanelTab(activeSession, "right", existing.id);
      clearPanelPreviewTab(activeSession.id, "right", existingLeafId);
      await updateActivePanel("right", { collapsed: false });
      await setActivePanelTab("right", existing.id, { leafId: existingLeafId, openPanel: true });
      if (shouldRefreshBreadcrumb) await refreshProjectSessions(sessionProjectId);
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
          { projectId, cardId, titleSnapshot, ancestors: options?.ancestors },
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
        ...(options?.ancestors !== undefined
          ? { ancestors: [...options.ancestors] }
          : {}),
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
    projectId: string | null,
    options?: { select?: boolean },
  ) => {
    const sessions = projectId === null
      ? projectlessSessions.length > 0
        ? projectlessSessions
        : await refreshProjectSessions(null)
      : sessionsByProject[projectId] ?? await refreshProjectSessions(projectId);
    const shouldSelect = options?.select !== false;

    for (const candidate of sessions) {
      if (candidate.thread || candidate.tabs.length > 0) continue;

      const detail = getCachedProjectSessionDetail(queryClient, candidate.id)
        ?? await prefetchProjectSessionDetail(queryClient, candidate.id);
      if (!detail || detail.thread || detail.tabs.length > 0) continue;

      if (shouldSelect) selectSession(detail);
      return detail;
    }

    const session = (await invoke("project-sessions:create", {
      projectId,
      noThreadFallbackTitle: "New thread",
    })) as ProjectSession;
    await refreshProjectSessions(projectId);
    if (shouldSelect) selectSession(session);
    return session;
  }, [projectlessSessions, queryClient, refreshProjectSessions, selectSession, sessionsByProject]);

  const startNewChatInProject = useCallback(async (projectId: string) => {
    const session = await ensureBlankSessionForProject(projectId);
    await invoke("project-session-panels:update", session.id, "right", {
      size: { ...session.panels.right.size, fullWidth: false },
    });
    await refreshProjectSessions(projectId);
  }, [ensureBlankSessionForProject, refreshProjectSessions]);

  const openScheduledAutomationChatCreate = useCallback(async (prompt: string) => {
    const targetProject = activeProject ?? projects.find((project) => project.id === activeProjectId) ?? null;
    if (!targetProject) {
      throw new Error("No project is available for scheduled task chat.");
    }

    const session = await ensureBlankSessionForProject(targetProject.id);
    setSettingsPath(null);
    setAutomationsPath(null);
    setNewThreadComposerIntentsBySessionId((current) => ({
      ...current,
      [session.id]: {
        prompt,
        focusNonce: Date.now(),
      },
    }));
  }, [activeProject, activeProjectId, ensureBlankSessionForProject, projects]);

  const startScheduledAutomationTemplateChat = useCallback(async (prompt: string) => {
    const targetProject = activeProject ?? projects.find((project) => project.id === activeProjectId) ?? null;
    if (!targetProject) {
      throw new Error("No project is available for scheduled task personalization.");
    }

    const session = await ensureBlankSessionForProject(targetProject.id);
    setSettingsPath(null);
    setAutomationsPath(null);
    const result = await workbenchCodexControl.startThreadForSession({
      projectId: targetProject.id,
      sessionId: session.id,
      prompt,
      runInTarget: "localProject",
      collaborationMode: "default",
    });
    if (result.kind !== "started") {
      throw new Error("Scheduled task personalization unexpectedly started in a worktree");
    }
    const { detail } = result;
    await refreshProjectSessions(targetProject.id);
    selectSession(session);
    await workbenchCodexControl.requestThreadStreamSnapshot(detail.threadId).catch(() => null);
  }, [
    activeProject,
    activeProjectId,
    ensureBlankSessionForProject,
    projects,
    refreshProjectSessions,
    selectSession,
    workbenchCodexControl,
  ]);

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

  const setSidebarSectionCollapsed = useCallback((
    sectionId: SidebarCollapsibleSectionId,
    collapsed: boolean,
  ) => {
    if (setSidebarCollapsibleSectionCollapsed) {
      setSidebarCollapsibleSectionCollapsed(sectionId, collapsed);
      return;
    }

    setLocalSidebarCollapsibleSections((current) => {
      if (current[sectionId] === collapsed) return current;
      return {
        ...current,
        [sectionId]: collapsed,
      };
    });
  }, [setSidebarCollapsibleSectionCollapsed]);

  const toggleProjectsSectionCollapsed = useCallback(() => {
    setSidebarSectionCollapsed("projects", !projectsSectionCollapsed);
  }, [projectsSectionCollapsed, setSidebarSectionCollapsed]);

  const togglePinnedProjectsSectionCollapsed = useCallback(() => {
    setSidebarSectionCollapsed("pinned", !pinnedProjectsSectionCollapsed);
  }, [pinnedProjectsSectionCollapsed, setSidebarSectionCollapsed]);

  const toggleChatsSectionCollapsed = useCallback(() => {
    setSidebarSectionCollapsed("chats", !chatsSectionCollapsed);
  }, [chatsSectionCollapsed, setSidebarSectionCollapsed]);

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

      if (matchesKeyboardEventToCommand(event, shortcutState, "openProcessManager")) {
        event.preventDefault();
        setProcessManagerOpen(true);
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

  const openBackgroundAgentPanelTab = useCallback(async (
    subagent: ThreadOpenSubagentPayload,
  ): Promise<boolean> => {
    if (!activeSession || activeSession.projectId === null) return false;

    const threadId = subagent.conversationId.trim();
    if (!threadId) return false;

    let hydratedSummaries: CodexThreadSummary[] = [];
    try {
      hydratedSummaries = await workbenchCodexControl.hydrateBackgroundSubagentThreads({ threadIds: [threadId] });
    } catch {
      toast.danger("Failed to open background agent");
      return false;
    }

    const panelId = "right" as const;
    const leafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const tabId = makeBackgroundAgentPanelTabId(threadId);
    const title = resolveCodexSubagentDisplayName({
      threadId,
      childSummary: hydratedSummaries.find((summary) => summary.threadId === threadId) ?? null,
      fallbackDisplayName: subagent.displayName,
    });
    const tab: BackgroundAgentPanelTab = {
      backgroundAgent: true,
      id: tabId,
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
      panelId,
      leafId,
      threadId,
      title,
      stateKey: Date.now(),
      subagent: {
        ...subagent,
        conversationId: threadId,
        displayName: title,
      },
    };

    setBackgroundAgentTabsBySession((current) => {
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
    clearProcessOutputActiveTab(activeSession.id, panelId, leafId);
    setBackgroundAgentActiveTabByPanel((current) => ({
      ...current,
      [makeBackgroundAgentPanelKey(activeSession.id, panelId, leafId)]: tabId,
    }));
    setPanelCollapsedOverrides((current) => ({
      ...current,
      [makePanelPreviewKey(activeSession.id, panelId)]: false,
    }));
    await ensureActivePanelOpenWithoutRefresh(panelId);
    return true;
  }, [
    activeSession,
    clearPanelPreviewTab,
    clearProcessOutputActiveTab,
    ensureActivePanelOpenWithoutRefresh,
    workbenchCodexControl,
  ]);

  const openAttachedThreadSessionResult = useCallback(async (
    threadId: string,
    context?: Parameters<NonNullable<ThreadStageActions["onOpenThread"]>>[1],
  ): Promise<boolean> => {
    if (threadId.startsWith(CODEX_CLIENT_THREAD_ID_PREFIX)) {
      setSettingsPath(null);
      setLocalEnvironmentSettingsInitial(null);
      setAutomationsPath(null);
      setPendingWorktreeClientThreadId(threadId);
      return true;
    }
    if (context?.subagent && await openBackgroundAgentPanelTab(context.subagent)) {
      return true;
    }

    const session = knownSessions.find((candidate) => candidate.thread?.threadId === threadId) ?? null;
    if (session) {
      closePendingWorktreeRoute();
      selectSession(session);
      return true;
    }

    try {
      const ensured = await invoke("codex:thread:ensure-session", threadId) as ProjectSession | null;
      if (!ensured) {
        toast.info("That chat is not available", {
          id: `thread-open-unattached-${threadId}`,
        });
        return false;
      }
      closePendingWorktreeRoute();
      mergeSessionInState(ensured);
      await refreshProjectSessions(ensured.projectId);
      selectSession(ensured);
      return true;
    } catch {
      toast.danger("Failed to open chat");
      return false;
    }
  }, [
    knownSessions,
    closePendingWorktreeRoute,
    mergeSessionInState,
    openBackgroundAgentPanelTab,
    refreshProjectSessions,
    selectSession,
  ]);

  const openAttachedThreadSession = useCallback<ThreadStageActions["onOpenThread"]>(async (threadId, context) => {
    await openAttachedThreadSessionResult(threadId, context);
  }, [openAttachedThreadSessionResult]);

  const openAttachedThreadSessionById = useCallback(async (threadId: string) => {
    await openAttachedThreadSession(threadId);
  }, [openAttachedThreadSession]);

  const openAutomationHistoryThreadSessionById = useCallback(async (threadId: string) => {
    const opened = await openAttachedThreadSessionResult(threadId);
    if (!opened) return;

    setSettingsPath(null);
    setAutomationsPath(null);
  }, [openAttachedThreadSessionResult]);

  const openProcessOutputInCurrentSession = useCallback(async (target: ProcessOutputPanelTarget): Promise<boolean> => {
    if (!activeSession?.thread || activeSession.thread.threadId !== target.threadId) return false;

    const panelId = "right" as const;
    const leafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const tabId = makeProcessOutputPanelTabId(target.threadId, target.itemId);
    const tab: ProcessOutputPanelTab = {
      processOutputPanel: true,
      id: tabId,
      sessionId: activeSession.id,
      projectId: activeSession.projectId,
      panelId,
      leafId,
      threadId: target.threadId,
      turnId: target.turnId ?? null,
      itemId: target.itemId,
      title: resolveProcessOutputPanelTitle(target.command),
      stateKey: Date.now(),
      command: target.command,
      cwd: target.cwd,
      terminalSessionId: target.terminalSessionId ?? null,
    };

    setProcessOutputTabsBySession((current) => {
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
    clearBackgroundAgentActiveTab(activeSession.id, panelId, leafId);
    setAutomationActiveTabByPanel((current) => {
      const keys = [
        makeAutomationPanelKey(activeSession.id, panelId, leafId),
        makeAutomationPanelKey(activeSession.id, panelId),
      ];
      if (!keys.some((key) => key in current)) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
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
    setProcessOutputActiveTabByPanel((current) => ({
      ...current,
      [makeProcessOutputPanelKey(activeSession.id, panelId, leafId)]: tabId,
    }));
    setPanelCollapsedOverrides((current) => ({
      ...current,
      [makePanelPreviewKey(activeSession.id, panelId)]: false,
    }));
    await ensureActivePanelOpenWithoutRefresh(panelId);
    return true;
  }, [
    activeSession,
    clearBackgroundAgentActiveTab,
    clearPanelPreviewTab,
    ensureActivePanelOpenWithoutRefresh,
  ]);

  const openProcessOutputForThread = useCallback(async (target: ProcessOutputPanelTarget) => {
    setPendingProcessOutputOpen(target);
    await openAttachedThreadSession(target.threadId);
  }, [openAttachedThreadSession]);

  useEffect(() => {
    if (!pendingProcessOutputOpen) return;
    if (!activeSession?.thread || activeSession.thread.threadId !== pendingProcessOutputOpen.threadId) return;

    let cancelled = false;
    void openProcessOutputInCurrentSession(pendingProcessOutputOpen)
      .then((opened) => {
        if (cancelled || !opened) return;
        setPendingProcessOutputOpen((current) =>
          current === pendingProcessOutputOpen ? null : current
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeSession?.thread,
    openProcessOutputInCurrentSession,
    pendingProcessOutputOpen,
  ]);

  const openProcessManagerOutput = useCallback((row: CodexBackgroundTerminalProcessRow) => {
    const conversation = processManagerConversationsById[row.threadId] ?? null;
    const target = buildProcessOutputTargetFromManagerRow(row, conversation);
    void openProcessOutputForThread(target);
  }, [openProcessOutputForThread, processManagerConversationsById]);

  const openTurnDiffReview = useCallback((target: CodexTurnDiffReviewTarget) => {
    setSummaryGitReviewRequest(null);
    setSelectedTurnDiffReviewTarget(target);
    void createManualTab("review", "right");
  }, [createManualTab]);
  const openSummaryGitReview = useCallback<NonNullable<ThreadStageActions["onOpenSummaryGitReview"]>>((input) => {
    summaryGitReviewRequestKeyRef.current += 1;
    setSelectedTurnDiffReviewTarget(null);
    setSummaryGitReviewRequest({
      source: input.source,
      key: summaryGitReviewRequestKeyRef.current,
    });
    void createManualTab("review", "right");
  }, [createManualTab]);

  const openTurnDiffFileInSidePanel = useCallback<NonNullable<ThreadStageActions["onOpenTurnDiffFileInSidePanel"]>>(async (target) => {
    await openWorkspaceFileTab({
      path: target.path,
      title: target.title,
      panelId: "right",
    });
  }, [openWorkspaceFileTab]);
  const openSummaryOutputInSidePanel = useCallback<NonNullable<ThreadStageActions["onOpenSummaryOutputInSidePanel"]>>(async (target) => {
    if (!activeSession) return false;
    return await openWorkspaceFileTab({
      path: target.path,
      title: target.title,
      panelId: "right",
    });
  }, [activeSession, openWorkspaceFileTab]);
  const consumeNewThreadComposerIntent = useCallback((sessionId: string, focusNonce: number) => {
    setNewThreadComposerIntentsBySessionId((current) => {
      const intent = current[sessionId];
      if (!intent || intent.focusNonce !== focusNonce) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }, []);

  const forkSessionFromTurn = useCallback(async (input: {
    threadId: string;
    turnId: string;
    message: string;
    collaborationMode: CodexCollaborationModeKind;
  }) => {
    const sourceSession = [...Object.values(sessionsByProject).flat(), ...projectlessSessions]
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
    if ("pendingWorktreeId" in result) {
      setPendingWorktreeClientThreadId(result.clientThreadId);
      return;
    }
    await refreshProjectSessions(result.session.projectId);
    selectSession(result.session);
    if (result.composerIntent) {
      workbenchCodexControl.setComposerIntent(result.threadId, result.composerIntent);
    }
    // The selected task owns resume/hydration; it must not extend the source task's fork action.
    void workbenchCodexControl.requestThreadStreamSnapshot(result.threadId).catch(() => undefined);
  }, [projectlessSessions, refreshProjectSessions, selectSession, sessionsByProject, workbenchCodexControl]);

  const forkSessionFromTurnIntoWorktree = useCallback(async (input: {
    threadId: string;
    targetTurnId: string;
  }) => {
    const sourceSession = [...Object.values(sessionsByProject).flat(), ...projectlessSessions]
      .find((candidate) => candidate.thread?.threadId === input.threadId);
    if (!sourceSession) {
      throw new Error("This thread is not attached to a project session");
    }

    const localEnvironmentConfigPath = await resolveForkLocalEnvironmentConfigPath(
      sourceSession.thread?.cwd,
    );
    const result = await invoke("project-sessions:fork", sourceSession.id, {
      target: "newWorktree",
      turnId: input.targetTurnId,
      localEnvironmentConfigPath,
    }) as ProjectSessionForkResult;
    if (!("pendingWorktreeId" in result)) {
      throw new Error("Worktree fork started without a pending worktree");
    }
    setPendingWorktreeClientThreadId(result.clientThreadId);
  }, [projectlessSessions, resolveForkLocalEnvironmentConfigPath, sessionsByProject]);

  const createBrowserTabToRight = useCallback(async (sourceTab: ProjectSessionTab, duplicate: boolean) => {
    if (!activeSession) return;
    const sessionProjectId = activeSession.projectId;
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

  const reloadBrowserTab = useCallback((tab: ProjectSessionTab) => {
    if (!activeSession || tab.kind !== "browser") return;
    void invoke("browser-sidebar-command", {
      type: "reload",
      browserConversationId: activeSession.id,
      browserTabId: requireProjectSessionBrowserTabId(tab),
    });
  }, [activeSession]);

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
    databaseViewId: string,
    panelId: PanelId,
    leafId: string,
  ) => {
    if (!activeSession || activeSession.projectId === null) return;
    const sessionProjectId = activeSession.projectId;
    const existing = findDbViewTabForDatabaseView(activeSession, databaseViewId);
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
      config: { projectId, databaseViewId, view: "kanban" },
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
      await openDbViewFromPanelPicker(
        destination.projectId,
        destination.databaseViewId,
        panelId,
        leafId,
      );
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
  }, [panelTabCycleRequest]);

  useEffect(() => {
    if (!panelTabCloseRequest) return;
    if (panelTabCloseRequest.tick <= 0) return;
    if (lastHandledPanelTabCloseRequestTickRef.current === panelTabCloseRequest.tick) return;
    lastHandledPanelTabCloseRequestTickRef.current = panelTabCloseRequest.tick;
    closeFocusedPanelTab(null, { respectActiveElementGuard: true });
  }, [panelTabCloseRequest]);

  const resizeRightPanel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const root = workbenchRootRef.current;
    const windowZoom = readCodexWindowZoom(root);
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    const sizingWidth = shellMainContentWidth.get();
    const startX = event.clientX / windowZoom;
    const startWidth = regularRightPanelWidth.get();
    const restoreRequestedWidth = () => {
      rightPanelRequestedWidth.set(clampRegularRightPanelWidth(
        activeSession?.panels.right.size.widthPx ?? RIGHT_PANEL_DEFAULT_WIDTH,
        sizingWidth,
      ));
    };

    let latestWidth = startWidth;
    let closedByResize = false;
    rightPanelRequestedWidth.set(startWidth);
    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      if (closedByResize) return;
      const pointerX = moveEvent.clientX / windowZoom;
      const rawWidth = startWidth + startX - pointerX;
      if (rawWidth < RIGHT_PANEL_MIN_WIDTH) {
        closedByResize = true;
        latestWidth = RIGHT_PANEL_MIN_WIDTH;
        restoreRequestedWidth();
        void setActivePanelCollapsed("right", true);
        return;
      }

      const nextWidth = clampRegularRightPanelWidth(rawWidth, sizingWidth);
      latestWidth = nextWidth;
      rightPanelRequestedWidth.set(nextWidth);
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
          if (!activeSession || closedByResize) {
            restoreRequestedWidth();
            return;
          }
          await updateActivePanel("right", {
            size: {
              ...activeSession.panels.right.size,
              widthPx: latestWidth,
            },
          });
        } catch (error) {
          restoreRequestedWidth();
          toast.danger(error instanceof Error ? error.message : "Unable to resize panel");
        }
      })();
    };
    const onPointerCancel = () => {
      cleanupPointerResize();
      restoreRequestedWidth();
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }, [
    activeSession,
    regularRightPanelWidth,
    rightPanelRequestedWidth,
    setActivePanelCollapsed,
    shellMainContentWidth,
    updateActivePanel,
  ]);

  const resizeAutomationDetailRail = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const root = workbenchRootRef.current;
    const windowZoom = readCodexWindowZoom(root);
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    const sizingWidth = shellMainContentWidth.get();
    const startX = event.clientX / windowZoom;
    const startWidth = clampAutomationDetailRailWidth(
      automationsDetailRailRequestedWidth.get(),
      sizingWidth,
    );

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const pointerX = moveEvent.clientX / windowZoom;
      const rawWidth = startWidth + startX - pointerX;
      automationsDetailRailRequestedWidth.set(
        clampAutomationDetailRailWidth(rawWidth, sizingWidth),
      );
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
    };
    const onPointerCancel = () => {
      cleanupPointerResize();
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }, [automationsDetailRailRequestedWidth, shellMainContentWidth]);

  const resizeBottomPanel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const root = workbenchRootRef.current;
    const windowZoom = readCodexWindowZoom(root);
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY / windowZoom;
    const sizingHeight = shellBodySize.height.get();
    const startHeight = bottomPanelHeight.get();
    const restoreRequestedHeight = () => {
      bottomPanelRequestedHeight.set(clampBottomPanelHeight(
        activeSession?.panels.bottom.size.heightPx ?? BOTTOM_PANEL_DEFAULT_HEIGHT,
        sizingHeight,
      ));
    };
    let latestHeight = startHeight;
    let closedByResize = false;
    bottomPanelRequestedHeight.set(startHeight);

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      if (closedByResize) return;
      const pointerY = moveEvent.clientY / windowZoom;
      const rawHeight = startHeight + startY - pointerY;
      if (rawHeight < BOTTOM_PANEL_MIN_HEIGHT) {
        closedByResize = true;
        latestHeight = BOTTOM_PANEL_MIN_HEIGHT;
        restoreRequestedHeight();
        void setActivePanelCollapsed("bottom", true);
        return;
      }

      const nextHeight = clampBottomPanelHeight(rawHeight, sizingHeight);
      latestHeight = nextHeight;
      bottomPanelRequestedHeight.set(nextHeight);
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
          if (!activeSession || closedByResize) {
            restoreRequestedHeight();
            return;
          }
          await updateActivePanel("bottom", {
            size: {
              ...activeSession.panels.bottom.size,
              heightPx: latestHeight,
            },
          });
        } catch (error) {
          restoreRequestedHeight();
          toast.danger(error instanceof Error ? error.message : "Unable to resize panel");
        }
      })();
    };
    const onPointerCancel = () => {
      cleanupPointerResize();
      restoreRequestedHeight();
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }, [
    activeSession,
    bottomPanelHeight,
    bottomPanelRequestedHeight,
    setActivePanelCollapsed,
    shellBodySize.height,
    updateActivePanel,
  ]);

  const activePanelCardStageCardIdsByProject = useMemo<ReadonlyMap<string, ReadonlySet<string>>>(() => {
    if (!activeRenderSession || !activeSessionPanelModel) return new Map();
    return collectPanelCardStageCardIdsByProject(activeRenderSession, activeSessionPanelModel);
  }, [activeRenderSession, activeSessionPanelModel]);

  const buildPanelGroupTabsForSession = useCallback((
    session: ProjectSession,
    model: SessionPanelRenderModel,
    visibleCardStageCardIdsByProject: ReadonlyMap<string, ReadonlySet<string>>,
    browserBoundsSyncTriggerByPanel: Partial<Record<PanelId, MotionValue<number>>> = {},
    sessionIsActive = false,
  ): PanelGroupTabsByPanel => {
    // Rebuild terminal tab descriptors when the external session store changes.
    void terminalSessionVersion;
    const makeItem = (tab: ProjectSessionRenderableTab): AppShellTabItem => {
      const transientPanelTab = isTransientPanelTab(tab);
      const retentionMode = !transientPanelTab && tab.kind === "card_stage" ? "layout" : undefined;
      const title = !transientPanelTab
          && tab.kind === "terminal"
          && "terminalSessionId" in tab.config
          ? terminalSessionStore.resolveTitle(
              tab.config.terminalSessionId,
              tab.title,
              resolveTerminalTabIndex(session, tab),
            )
          : tab.title;
      const cardStageTitleSource = !transientPanelTab && tab.kind === "card_stage"
        ? cardStageTabTitleStore.createSource(
            makeCardStageTabTitleKey(session.id, tab.id),
            title,
          )
        : undefined;
      const chromeContext = resolveProjectTargetTabChromeContext(
        tab,
        session,
        projects,
      );

      return {
        id: tab.id,
        domTabId: !transientPanelTab && tab.kind === "review"
          ? "diff"
          : !transientPanelTab && tab.kind === "files" && "path" in tab.config
            ? getWorkspaceFileDomTabId("hostId" in tab.config ? tab.config.hostId : "local", tab.config.path)
            : undefined,
        title,
        titleSource: cardStageTitleSource,
        ...chromeContext,
        icon: isSideChatPanelTab(tab)
          ? CodexSidePanelSideChatIcon
          : isMcpAppPanelTab(tab)
            ? ComposerPluginsIcon
              : isPlanPanelTab(tab)
                ? ComposerPlanModeIcon
                : isAutomationPanelTab(tab)
                  ? CodexAutomationsIcon
                  : isBackgroundAgentPanelTab(tab)
                    ? createBackgroundAgentTabIcon(tab.threadId)
                    : isProcessOutputPanelTab(tab)
                      ? CodexSidePanelTerminalIcon
                      : isProjectSessionFilesPreviewTab(tab)
                        ? getTabIcon(tab.kind)
                        : getBrowserTabIcon(tab),
        closable: isSideChatPanelTab(tab)
          ? tab.status !== "loading"
          : isMcpAppPanelTab(tab)
            ? true
            : isPlanPanelTab(tab)
              ? true
              : isAutomationPanelTab(tab)
                ? true
                : isBackgroundAgentPanelTab(tab)
                  ? true
                  : isProcessOutputPanelTab(tab)
                    ? true
                    : tab.preview === true || session.tabs.length > 1,
        preview: transientPanelTab ? undefined : tab.preview,
        retentionMode,
        reorderable: transientPanelTab ? false : tab.preview === true ? false : true,
        splittable: !transientPanelTab && tab.preview !== true,
        contextMenuItems: !transientPanelTab && tab.kind === "browser"
          ? [
              {
                id: "browser-new-tab-right",
                label: "New tab to the right",
                onSelect: () => void createBrowserTabToRight(tab, false),
              },
              {
                id: "browser-reload",
                label: "Reload",
                onSelect: () => reloadBrowserTab(tab),
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
                key={`${session.id}:${tab.id}:${tab.stateKey}`}
                tab={tab}
                activeSession={session}
                projects={projects}
                onRefreshSessions={refreshProjectSessions}
                onRecreateSideChat={() => void recreateSideChatPanelTab(tab.id)}
                onOpenMcpAppSidePanel={openMcpAppSidePanel}
                onOpenHooksSettings={openHooksSettings}
                threadQueueFollowUpsEnabled={threadQueueFollowUpsEnabled}
                composerEnterBehavior={composerEnterBehavior}
                onQueueingEnabledChange={handleThreadQueueFollowUpsEnabledChange}
                onOpenThread={openAttachedThreadSession}
                onOpenTurnDiffReview={openTurnDiffReview}
                onOpenTurnDiffFileInSidePanel={openTurnDiffFileInSidePanel}
                turnDiffHoverPreviewDisabled={model.sidePanelOpen}
              />
            );
          }
          if (isMcpAppPanelTab(tab)) {
            return <McpAppSessionTab key={`${session.id}:${tab.id}:${tab.stateKey}`} tab={tab} />;
          }
          if (isPlanPanelTab(tab)) {
            return <PlanSidePanelTab key={`${session.id}:${tab.id}:${tab.stateKey}`} content={tab.content} />;
          }
          if (isAutomationPanelTab(tab)) {
            return (
              <WorkbenchAutomationSidePanelTab
                key={`${session.id}:${tab.id}:${tab.stateKey}`}
                automationId={tab.automationId}
                createInput={tab.createInput}
                mode={tab.mode}
                projects={projects}
                title={tab.title}
                updateInput={tab.updateInput}
                onClose={() => closeAutomationPanelTab(tab.panelId, tab.id)}
                onOpenInScheduled={(automationId) => {
                  openAutomations(buildAutomationsPath({ automationId }));
                }}
                onOpenLocalEnvironmentsSettings={openLocalEnvironmentsSettings}
                onSaved={(automation: CodexScheduledAutomation) => {
                  setAutomationTabsBySession((current) => {
                    const tabs = current[session.id] ?? [];
                    return {
                      ...current,
                      [session.id]: tabs.map((candidate) =>
                        candidate.id === tab.id
                          ? {
                              ...candidate,
                              automationId: automation.id,
                              createInput: null,
                              mode: "open",
                              title: automation.name,
                              updateInput: null,
                              stateKey: candidate.stateKey + 1,
                            }
                          : candidate
                      ),
                    };
                  });
                }}
                onTitleChange={(title) => {
                  setAutomationTabsBySession((current) => {
                    const tabs = current[session.id] ?? [];
                    return {
                      ...current,
                      [session.id]: tabs.map((candidate) =>
                        candidate.id === tab.id ? { ...candidate, title } : candidate
                      ),
                    };
                  });
                }}
              />
            );
          }
          if (isProcessOutputPanelTab(tab)) {
            return <ProcessOutputPanelTabView key={`${session.id}:${tab.id}:${tab.stateKey}`} tab={tab} />;
          }
          if (isBackgroundAgentPanelTab(tab)) {
            return (
              <BackgroundAgentSessionTab
                key={`${session.id}:${tab.id}:${tab.stateKey}`}
                tab={tab}
                activeSession={session}
                projects={projects}
                onRefreshSessions={refreshProjectSessions}
                onOpenMcpAppSidePanel={openMcpAppSidePanel}
                onOpenHooksSettings={openHooksSettings}
                threadQueueFollowUpsEnabled={threadQueueFollowUpsEnabled}
                composerEnterBehavior={composerEnterBehavior}
                onQueueingEnabledChange={handleThreadQueueFollowUpsEnabledChange}
                onOpenThread={openAttachedThreadSession}
                onOpenTurnDiffReview={openTurnDiffReview}
                onOpenTurnDiffFileInSidePanel={openTurnDiffFileInSidePanel}
                turnDiffHoverPreviewDisabled={model.sidePanelOpen}
              />
            );
          }
          return (
            <ProjectSessionTabPanel
              key={`${session.id}:${tab.id}:${tab.stateKey}`}
              tab={tab}
              activeSession={session}
              projects={projects}
              activeView={activeView}
              activeSearchQuery={activeSearchQuery}
              activeDbViewPrefs={activeDbViewPrefs}
              searchByProject={searchByProject}
              dbViewPrefsByProject={dbViewPrefsByProject}
              activePanelCardStageCardIdsByProject={visibleCardStageCardIdsByProject}
              cardStageTabTitleStore={cardStageTabTitleStore}
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
              onOpenThread={openAttachedThreadSessionById}
              cardStageHistoryModal={cardStageHistoryModal}
              onToggleCardStageHistoryModal={toggleCardStageHistoryModal}
              selectedTurnDiffReviewTarget={selectedTurnDiffReviewTarget}
              summaryGitReviewRequest={summaryGitReviewRequest}
              browserBoundsSyncTrigger={browserBoundsSyncTriggerByPanel[tab.panelId]}
              isActivePanelTab={sessionIsActive && panelContext.active}
            />
          );
        },
      };
    };
    const buildPanelTabs = (panelId: PanelId) => {
      const panel = session.panels[panelId];
      const leaves = listProjectSessionPanelLeaves(panel.layout);
      const itemsByLeafId: Record<string, AppShellTabItem[]> = {};
      const activeTabIdsByLeafId: Record<string, string | null> = {};

      for (const leaf of leaves) {
        const renderableTabs = model.renderableTabsByPanelLeaf[panelId][leaf.id] ?? [];

        itemsByLeafId[leaf.id] = renderableTabs.map(makeItem);
        activeTabIdsByLeafId[leaf.id] = model.activeTabIdsByPanelLeaf[panelId][leaf.id] ?? null;
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
    activeView,
    cardStageCloseRef,
    cardStageHistoryModal,
    cardStagePersistRef,
    cardStageSessionSnapshotRef,
    cardStageTabTitleStore,
    closeAutomationPanelTab,
    closeTab,
    composerEnterBehavior,
    createBrowserTabToRight,
    createManualTab,
    ensureBlankSessionForProject,
    onLeaveCardStageCard,
    onReminderHandled,
    openAutomations,
    openMcpAppSidePanel,
    openHooksSettings,
    openCardTab,
    openLocalEnvironmentsSettings,
    openWorkspaceFileTab,
    handleThreadQueueFollowUpsEnabledChange,
    openAttachedThreadSession,
    openAttachedThreadSessionById,
    openTurnDiffReview,
    openTurnDiffFileInSidePanel,
    pendingReminderOpen,
    projects,
    recreateSideChatPanelTab,
    refreshProjectSessions,
    reloadBrowserTab,
    taskSearchOpenTick,
    dbViewPrefsByProject,
    searchByProject,
    setDbViewPrefs,
    setSearchQuery,
    selectedTurnDiffReviewTarget,
    summaryGitReviewRequest,
    terminalSessionVersion,
    threadQueueFollowUpsEnabled,
    toggleCardStageHistoryModal,
  ]);

  const panelGroupTabs = useMemo<PanelGroupTabsByPanel>(() => {
    if (!activeRenderSession || !activeSessionPanelModel) {
      return {
        right: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
        bottom: { itemsByLeafId: {}, activeTabIdsByLeafId: {} },
      };
    }
    return buildPanelGroupTabsForSession(
      activeRenderSession,
      activeSessionPanelModel,
      activePanelCardStageCardIdsByProject,
      {
        right: rightPanelMotion.animatedSize,
        bottom: bottomPanelMotion.animatedSize,
      },
      true,
    );
  }, [
    activePanelCardStageCardIdsByProject,
    activeRenderSession,
    activeSessionPanelModel,
    bottomPanelMotion.animatedSize,
    buildPanelGroupTabsForSession,
    rightPanelMotion.animatedSize,
  ]);

  panelGroupTabsRef.current = panelGroupTabs;

  useEffect(() => {
    if (!activeRenderSession) return;
    const activeSessionPrefix = `${activeRenderSession.id}:`;
    const currentKeys = new Set<string>();

    for (const panelId of ["right", "bottom"] as const) {
      const panelTabs = panelGroupTabs[panelId];
      for (const [leafId, tabs] of Object.entries(panelTabs.itemsByLeafId)) {
        const key = makePanelLeafStateKey(activeRenderSession.id, panelId, leafId);
        currentKeys.add(key);
        const visibleTabIds = new Set(tabs.map((tab) => tab.id));
        const activeTabId = panelTabs.activeTabIdsByLeafId[leafId] ?? null;
        const durableLeaf = findProjectSessionPanelLeaf(activeRenderSession.panels[panelId].layout, leafId);
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
  }, [activeRenderSession, panelGroupTabs]);

  const browserRetentionTabs = activeSessionPanelModel?.browserRetentionTabs ?? [];
  const visibleBrowserTabIds = activeSessionPanelModel?.visibleBrowserTabIds ?? new Set<string>();

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
    const motionResolution = setRealSidebarOpen(nextOpen, {
      animate: options.animate,
      suppressHoverOpen: options.suppressHoverOpen,
    });
    setSidebarTriggerHovered(false);
    setSidebarHoverSuppressed(motionResolution.suppressHoverOpen);
    setFloatingSidebarVisible(false);
    pendingSidebarPersistedOpenRef.current = nextOpen;
    applySidebarCollapsed(collapsed);
  }, [
    applySidebarCollapsed,
    setFloatingSidebarVisible,
    setRealSidebarOpen,
    setSidebarHoverSuppressed,
    setSidebarTriggerHovered,
  ]);

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
    setRealSidebarTargetWidth(nextWidth);
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
  }, [
    setFloatingSidebarVisible,
    setRealSidebarTargetWidth,
    setSidebarCollapsedWithCodexState,
    setSidebarWidth,
  ]);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsedWithCodexState(getRealSidebarOpen());
  }, [
    getRealSidebarOpen,
    setSidebarCollapsedWithCodexState,
  ]);

  const showRealSidebarFromFloatingPanel = useCallback(() => {
    setSidebarCollapsedWithCodexState(false, {
      animate: false,
      suppressHoverOpen: false,
    });
  }, [setSidebarCollapsedWithCodexState]);

  useEffect(() => {
    const persistedOpen = !sidebarCollapsed;
    const pendingPersistedOpen = pendingSidebarPersistedOpenRef.current;
    if (pendingPersistedOpen !== null) {
      if (persistedOpen === pendingPersistedOpen) {
        pendingSidebarPersistedOpenRef.current = null;
        return;
      }

      if (getRealSidebarOpen() === pendingPersistedOpen) return;
    }

    if (getRealSidebarOpen() === persistedOpen) return;
    setRealSidebarOpen(persistedOpen);
  }, [getRealSidebarOpen, setRealSidebarOpen, sidebarCollapsed]);

  const handleRegisteredSidebarToggle = useEffectEvent(() => {
    setSidebarCollapsedWithCodexState(getRealSidebarOpen());
  });

  useEffect(() => {
    if (!onRegisterSidebarToggleHandler) return undefined;
    return onRegisterSidebarToggleHandler(() => {
      handleRegisteredSidebarToggle();
    });
  }, [onRegisterSidebarToggleHandler]);

  useEffect(() => {
    if (lastHandledSidebarToggleRequestTickRef.current === sidebarToggleRequestTick) return;
    lastHandledSidebarToggleRequestTickRef.current = sidebarToggleRequestTick;
    setSidebarCollapsedWithCodexState(getRealSidebarOpen());
  }, [
    getRealSidebarOpen,
    setSidebarCollapsedWithCodexState,
    sidebarToggleRequestSource,
    sidebarToggleRequestTick,
  ]);

  useEffect(() => {
    if (sidebarLogicalCollapsed) return;
    setFloatingSidebarVisible(false);
    setSidebarHoverSuppressed(false);
  }, [
    setFloatingSidebarVisible,
    setSidebarHoverSuppressed,
    sidebarLogicalCollapsed,
  ]);

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

    if (crossedNarrowWidth && atNarrowWidth && sidebarOpen) {
      setSidebarCollapsedWithCodexState(true, {
        animate: false,
        suppressHoverOpen: true,
      });
    }
  }, [
    activeSession,
    recordShellNavigation,
    setFloatingSidebarFocusActive,
    setSidebarCollapsedWithCodexState,
    sidePanelOpen,
    sidebarOpen,
    shellWidthClass,
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
  // These setters compare against ref-backed current values before entering
  // React. Returning the current value from a functional state updater is too
  // late: the update has already been enqueued and can join a nested update
  // cycle while another Workbench transition is pending.
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

    const currentlyVisible = getFloatingSidebarVisible();
    setFloatingSidebarVisible(deriveCodexSidebarFloatingVisibility({
      pointerX,
      leftPanelWidthPx: inputs.sidebarWidth,
      sidebarOpen: !inputs.sidebarCollapsed,
      sidebarAnimating: inputs.sidebarAnimating,
      hoverSuppressed: false,
      focusOverride: inputs.floatingSidebarFocusActive,
      currentlyVisible,
    }));
  }, [getFloatingSidebarVisible, setFloatingSidebarVisible, setSidebarHoverSuppressed]);

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
  }, [setFloatingSidebarFocusActive]);

  useEffect(() => {
    // Keep the ref the pointermove handler reads in sync, then recompute once
    // for this input change (pointer comes from the ref — auto-reveal still
    // reacts when width/collapse/focus change without the mouse moving).
    sidebarVisibilityInputsRef.current = {
      sidebarWidth,
      sidebarCollapsed: sidebarLogicalCollapsed,
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
    sidebarLogicalCollapsed,
    sidebarHoverSuppressed,
    sidebarTriggerHovered,
    sidebarWidth,
  ]);

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
  const [browserUseState, setBrowserUseState] = useState<BrowserSidebarBrowserUseStateSnapshot | null>(null);
  useEffect(() => {
    const unsubscribeBrowserUse = window.api?.on("browser-sidebar-browser-use-state", (payload) => {
      setBrowserUseState(payload as BrowserSidebarBrowserUseStateSnapshot);
    });
    return () => {
      unsubscribeBrowserUse?.();
    };
  }, []);
  const threadSummarySideChatThreadIds = useMemo(() => {
    if (!activeSession) return [];
    return (sideChatTabsBySession[activeSession.id] ?? []).flatMap((tab) =>
      tab.threadId ? [tab.threadId] : []
    );
  }, [activeSession, sideChatTabsBySession]);
  const threadSummarySideChatConversationsById = useConversationSubset(threadSummarySideChatThreadIds);
  const threadSummarySideChatRows = useMemo<ThreadSummaryPanelAuxiliaryRow[]>(() => {
    if (!activeSession) return [];
    return (sideChatTabsBySession[activeSession.id] ?? []).map((tab) =>
      buildThreadSummaryPanelSideChatRow(tab, tab.threadId ? threadSummarySideChatConversationsById[tab.threadId] : null)
    );
  }, [activeSession, sideChatTabsBySession, threadSummarySideChatConversationsById]);
  const threadSummaryBrowserRows = useMemo<ThreadSummaryPanelBrowserRow[]>(() => {
    if (!activeSession) return [];
    const activeBrowserUseTabId = browserUseState
      ?.activeBrowserTabIdsByConversation[activeSession.id] ?? null;
    const browserTabs = activeSession.tabs
      .filter((tab) => tab.kind === "browser")
      .map((tab) => buildThreadSummaryPanelBrowserRow({
        id: tab.id,
        tabTitle: tab.title,
        configTitle: readBrowserConfigTitle(tab),
        url: readBrowserConfigUrl(tab),
        faviconUrl: readBrowserConfigFavicon(tab),
        isAgentWorking: isThreadSummaryBrowserRowAgentWorking(
          activeBrowserUseTabId,
          requireProjectSessionBrowserTabId(tab),
        ),
        panelId: tab.panelId,
        leafId: resolveLeafIdForPanelTab(activeSession, tab.panelId, tab.id),
      }));
    const browserPreviewTabs = Object.entries(previewTabsByPanel)
      .filter(([, tab]) => tab.sessionId === activeSession.id && tab.kind === "browser")
      .map(([key, tab]) => buildThreadSummaryPanelBrowserRow({
        id: tab.id,
        tabTitle: tab.title,
        configTitle: readBrowserConfigTitle(tab),
        url: readBrowserConfigUrl(tab),
        faviconUrl: readBrowserConfigFavicon(tab),
        isAgentWorking: isThreadSummaryBrowserRowAgentWorking(
          activeBrowserUseTabId,
          requireProjectSessionBrowserTabId(tab),
        ),
        panelId: tab.panelId,
        leafId: resolvePanelPreviewKeyLeafId(key, activeSession.id, tab.panelId),
      }));
    return [...browserTabs, ...browserPreviewTabs];
  }, [activeSession, browserUseState, previewTabsByPanel]);
  const threadSummaryScheduledAutomation = useMemo<ThreadSummaryPanelScheduledAutomationRow | null>(() =>
    buildThreadSummaryPanelScheduledAutomationRow({
      automations: scheduledAutomationsQuery.data ?? [],
      conversationId: activeSession?.thread?.threadId ?? null,
    }), [activeSession?.thread?.threadId, scheduledAutomationsQuery.data]);
  const remoteHostedPipSummaryControl = useRemoteHostedPipSummaryControl(activeSession?.thread?.threadId ?? null);
  const openSummarySideChatRow = useCallback<NonNullable<ThreadStageActions["onOpenSummarySideChatRow"]>>(async ({
    rowId,
    panelId,
    leafId,
  }) => {
    if (!activeSession) return;
    await setActivePanelCollapsed(panelId, false);
    await selectPanelTab(panelId, rowId, leafId ?? undefined);
  }, [activeSession, selectPanelTab, setActivePanelCollapsed]);
  const openSummaryBrowserRow = useCallback<NonNullable<ThreadStageActions["onOpenSummaryBrowserRow"]>>(async ({
    rowId,
    panelId,
    leafId,
  }) => {
    if (!activeSession) return;
    await setActivePanelCollapsed(panelId, false);
    await selectPanelTab(panelId, rowId, leafId ?? undefined);
  }, [activeSession, selectPanelTab, setActivePanelCollapsed]);
  const openSummaryScheduledAutomation = useCallback<NonNullable<ThreadStageActions["onOpenSummaryScheduledAutomation"]>>(({
    automationId,
    createInput,
    mode,
    title,
    updateInput,
  }) => {
    if (mode === "suggested-create" || mode === "suggested-update") {
      void openAutomationSidePanel({
        automationId,
        createInput,
        mode,
        title,
        updateInput,
      });
      return;
    }
    if (!automationId) return;
    openAutomations(buildAutomationsPath({ automationId }));
  }, [openAutomationSidePanel, openAutomations]);
  const openSummaryProcessManager = useCallback<NonNullable<ThreadStageActions["onOpenProcessManager"]>>(() => {
    setProcessManagerOpen(true);
  }, []);
  const openSummaryBackgroundTerminalOutput = useCallback<NonNullable<ThreadStageActions["onOpenBackgroundTerminalOutput"]>>(async (row) => {
    if (!activeSession?.thread) return;
    await openProcessOutputInCurrentSession(buildProcessOutputTargetFromSummaryRow(activeSession.thread.threadId, row));
  }, [activeSession?.thread, openProcessOutputInCurrentSession]);
  const threadSummaryHeaderActions = useMemo<Pick<ThreadStageActions, "onOpenSummaryOutputInSidePanel" | "onOpenSummaryScheduledAutomation">>(() => ({
    onOpenSummaryOutputInSidePanel: openSummaryOutputInSidePanel,
    onOpenSummaryScheduledAutomation: openSummaryScheduledAutomation,
  }), [openSummaryOutputInSidePanel, openSummaryScheduledAutomation]);

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
      activeThreadIsManagedWorktree={Boolean(activeSession.thread?.managedWorktreePath)}
      onPopoverOpenChange={setThreadSummaryPanelPopoverOpen}
      projectWorkspacePath={projectWorkspaceRootOrNull(activeProject)}
      mode={threadSummaryPanelMode}
      pinnedOpen={threadSummaryPanelPinnedOpen}
      onPinnedOpenToggle={toggleThreadSummaryPanel}
      popoverOpen={threadSummaryPanelPopoverOpen}
      scheduledAutomation={threadSummaryScheduledAutomation}
      actions={threadSummaryHeaderActions}
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

  const renderPanelNewTabButton = (session: ProjectSession, panelId: PanelId, leafId: string) => {
    const actions = filterAvailablePanelActions(
      PANEL_NEW_TAB_ACTIONS,
      session.tabs,
      panelId,
      session.projectId,
    );
    const title = panelId === "right" ? "Open side panel tab" : "Open bottom panel tab";
    const menuKey = `${session.id}:${panelId}:${leafId}:new-tab`;
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
              && session.projectId !== null
              && !findDbViewTabForProject(session, session.projectId);
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
                    currentProjectId={session.projectId}
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
  const settingsRouteShell = settingsPath ? (
    <SettingsRouteShell
      path={settingsPath}
      onPathChange={setSettingsPath}
      onBackToApp={closeSettings}
      onRequestProjectPickerOpen={onRequestProjectPickerOpen}
      projects={projects}
      activeProjectId={activeProject?.id ?? activeProjectId}
      initialLocalEnvironmentProjectId={localEnvironmentSettingsInitial?.projectId ?? null}
      initialLocalEnvironmentConfigPath={localEnvironmentSettingsInitial?.configPath ?? null}
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
  const automationsRouteShell = automationsPath ? (
    <WorkbenchAutomationsRouteShell
      path={automationsPath}
      projects={projects}
      externalHeader
      headerPortalTarget={automationsHeaderPortalElement}
      detailRailPortalTarget={automationsDetailRailPortalElement}
      onDetailRailOpenChange={setAutomationsDetailRailOpen}
      onPathChange={setAutomationsPath}
      onOpenThread={openAutomationHistoryThreadSessionById}
      onCreateWithChat={openScheduledAutomationChatCreate}
      onPersonalizeTemplate={startScheduledAutomationTemplateChat}
      onOpenLocalEnvironmentsSettings={openLocalEnvironmentsSettings}
    />
  ) : null;
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
  }, [ensureBlankSessionForProject, projects]);
  const stableWorktreeStatusDialog = stableWorktreeStatusId ? (
    <StableWorktreeStatusDialog
      pendingWorktreeId={stableWorktreeStatusId}
      agentMode={workbenchCodexControl.permissionMode}
      transport={ELECTRON_STABLE_WORKTREE_STATUS_TRANSPORT}
      onClose={() => setStableWorktreeStatusId(null)}
      onEditEnvironment={(entry) => {
        const sourceProject = projects.find((project) =>
          project.primaryWorkspaceRoot === entry.sourceWorkspaceRoot
          || project.sources.some((source) => source.root === entry.sourceWorkspaceRoot)
        ) ?? null;
        openLocalEnvironmentsSettings({
          projectId: sourceProject?.id ?? null,
          configPath: entry.localEnvironmentConfigPath ?? null,
          reopenStableWorktreeId: entry.id,
        });
      }}
      onOpenPendingWorktree={(clientThreadId) => {
        setSettingsPath(null);
        setLocalEnvironmentSettingsInitial(null);
        setAutomationsPath(null);
        setPendingWorktreeClientThreadId(clientThreadId);
      }}
      onActionError={(error) => {
        toast.danger(error instanceof Error ? error.message : "Worktree action failed");
      }}
    />
  ) : null;
  const pendingWorktreeRouteShell = pendingWorktreeClientThreadId ? (
    <PendingWorktreeRoute
      clientThreadId={pendingWorktreeClientThreadId}
      agentMode={workbenchCodexControl.permissionMode}
      headerPortalTarget={threadHeaderPortalElement}
      onClose={closePendingWorktreeRoute}
      onOpenThread={openAttachedThreadSessionResult}
      onOpenPendingWorktree={setPendingWorktreeClientThreadId}
      onCancelToSource={handOffCancelledPendingWorktree}
      onEditEnvironment={(entry) => {
        void openLocalEnvironmentsSettings({
          projectId: entry.launchMode === "start-conversation"
            ? entry.startConversationParamsInput.projectAssignment?.projectId ?? null
            : entry.launchMode === "fork-conversation"
              ? entry.projectAssignment?.projectId ?? null
              : null,
          configPath: entry.localEnvironmentConfigPath ?? null,
          reopenPendingWorktreeClientThreadId: pendingWorktreeClientThreadId,
        });
      }}
    />
  ) : null;
  const appShellHeaderCenterVisible = settingsRouteShell == null
    && (
      activeSession != null
      || automationsRouteShell != null
      || pendingWorktreeRouteShell != null
    );
  const appShellHeaderActions = settingsPath
    ? null
    : pendingWorktreeRouteShell
      ? null
      : automationsPath
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
  const renamePendingWorktreeDialog = (
    <RenameChatDialog
      open={Boolean(renamePendingWorktree)}
      initialValue={renamePendingWorktree?.title ?? ""}
      busy={false}
      requireNonEmpty
      onOpenChange={(open) => {
        if (!open) setRenamePendingWorktree(null);
      }}
      onSave={(label) => {
        const item = renamePendingWorktree;
        if (!item?.pendingWorktreeId) return;
        void invoke(
          "codex:pending-worktree:rename",
          item.hostId,
          item.pendingWorktreeId,
          label,
        ).then(() => {
          setRenamePendingWorktree(null);
        }).catch(() => {
          toast.danger("Failed to rename task");
        });
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
    manageTasks: () => {
      openAutomations();
    },
    openProcessManager: () => {
      setProcessManagerOpen(true);
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

  const renderRetainedSessionActivity = (entry: { session: ProjectSession; isActive: boolean }) => {
    const { session, isActive } = entry;
    const model = isActive && activeSessionPanelModel
      ? activeSessionPanelModel
      : buildSessionPanelRenderModel({
          session,
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
        });
    const visibleCardStageCardIdsByProject = isActive
      ? activePanelCardStageCardIdsByProject
      : collectPanelCardStageCardIdsByProject(session, model);
    const sessionPanelGroupTabs = isActive
      ? panelGroupTabs
      : buildPanelGroupTabsForSession(session, model, visibleCardStageCardIdsByProject, {}, false);
    const latestShellMainContentWidth = shellMainContentWidth.get();
    const latestShellBodyHeight = shellBodySize.height.get();
    const inactiveRegularRightPanelWidth = clampRegularRightPanelWidth(
      model.rightPanel.size.widthPx ?? RIGHT_PANEL_DEFAULT_WIDTH,
      latestShellMainContentWidth,
    );
    const inactiveBottomPanelHeight = clampBottomPanelHeight(
      model.bottomPanel.size.heightPx ?? BOTTOM_PANEL_DEFAULT_HEIGHT,
      latestShellBodyHeight,
    );
    const sessionBottomPanelHeight = isActive
      ? bottomPanelHeight
      : inactiveBottomPanelHeight;
    const sessionRightPanelTargetWidth = isActive
      ? rightPanelTargetWidth
      : model.rightPanelFullWidth
        ? Math.max(latestShellMainContentWidth, inactiveRegularRightPanelWidth)
        : inactiveRegularRightPanelWidth;
    const sessionRightPanelMounted = isActive ? rightPanelMotion.mounted : model.sidePanelOpen;
    const sessionBottomPanelMounted = isActive ? bottomPanelMotion.mounted : model.bottomPanelOpen;
    const sessionRightPanelOpacity = isActive ? rightPanelMotion.opacity : 1;
    const sessionBottomPanelOpacity = isActive ? bottomPanelMotion.opacity : 1;
    const sessionRightPanelWidth = isActive ? rightPanelMotion.animatedSize : sessionRightPanelTargetWidth;
    const sessionBottomPanelHeightStyle = isActive ? bottomPanelMotion.animatedSize : sessionBottomPanelHeight;
    const sessionFrameBorderVisible = isActive
      ? appShellMainContentFrameBorderVisible
      : resolveCodexMainContentFrameBorder({
          rightPanelOpen: model.sidePanelOpen,
          headerEdgeScroll: false,
        });
    const sessionProject = session.projectId
      ? projects.find((project) => project.id === session.projectId) ?? activeProject
      : activeProject;
    const sessionThreadSummaryPanelMounted = isActive ? threadSummaryPanelMounted : false;
    const sessionThreadSummaryPanelOpen = isActive ? threadSummaryPanelOpen : false;
    const sessionThreadSummaryPanelHideImmediately = isActive ? threadSummaryPanelHideImmediately : false;
    const sessionThreadSummaryPanelContentShift = isActive ? threadSummaryPanelContentShift : 0;
    const sessionRightPanelComposerOverlayEnabled = isActive && rightPanelComposerOverlayEnabled;
    const sessionThreadPlanSidePanelState = isActive ? model.threadPlanSidePanelState : null;
    const sessionAvailableRightPanelActions = filterAvailablePanelActions(
      PANEL_NEW_TAB_ACTIONS,
      session.tabs,
      "right",
      session.projectId,
    );
    const sessionAvailableBottomPanelActions = filterAvailablePanelActions(
      PANEL_NEW_TAB_ACTIONS,
      session.tabs,
      "bottom",
      session.projectId,
    );
    const sessionPanelTabScrollEndPaddingPx = isActive ? panelTabScrollEndPaddingPx : 0;

    return (
      <RetainedActivity key={session.id} mode={isActive ? "visible" : "hidden"}>
        <div
          aria-hidden={isActive ? undefined : "true"}
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
          data-retained-session-id={session.id}
          data-retained-session-active={isActive ? "true" : "false"}
        >
          <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <section
              data-testid="session-thread-page"
              data-session-thread-page-hidden={model.rightPanelFullWidth ? "true" : "false"}
              data-app-shell-main-content-layout={appShellMainContentLayout}
              aria-hidden={model.rightPanelFullWidth ? "true" : undefined}
              className={cn(
                "app-shell-main-content-viewport relative flex min-h-0 min-w-0 flex-col",
                model.rightPanelFullWidth ? "w-0 flex-none overflow-hidden" : "flex-1",
              )}
            >
              <div
                className={cn(
                  "app-shell-main-content-frame relative mt-(--app-shell-main-content-frame-top-offset) flex min-h-0 flex-1 flex-col border-t",
                  sessionFrameBorderVisible
                    ? "border-token-border-default"
                    : "border-transparent",
                )}
              >
                <div
                  aria-hidden="true"
                  data-app-shell-main-content-top-fade="full-bleed"
                  className="app-shell-main-content-top-fade pointer-events-none absolute inset-x-0 top-0 z-20 h-4 bg-gradient-to-b from-token-main-surface-primary opacity-0 transition-opacity duration-200 browser:hidden"
                />
                {isActive && sessionError ? (
                  <div className="border-b border-token-border px-3 py-2 text-xs text-token-text-secondary">{sessionError}</div>
                ) : null}
                {isActive || session.thread ? (
                  <ThreadHeaderPortalProvider target={isActive ? threadHeaderPortalElement : null}>
                    <SessionThreadPage
                      session={session}
                      project={sessionProject}
                      projects={projects}
                      threadViewportActive={isActive && !model.rightPanelFullWidth}
                      onRefreshProjectSessions={refreshProjectSessions}
                      onEnsureBlankSessionForProject={ensureBlankSessionForProject}
                      onOpenPendingWorktree={setPendingWorktreeClientThreadId}
                      newThreadComposerIntent={newThreadComposerIntentsBySessionId[session.id] ?? null}
                      onConsumeNewThreadComposerIntent={consumeNewThreadComposerIntent}
                      onRequestProjectPickerOpen={onRequestProjectPickerOpen}
                      onOpenLocalEnvironmentsSettings={openLocalEnvironmentsSettings}
                      onOpenHooksSettings={openHooksSettings}
                      threadQueueFollowUpsEnabled={threadQueueFollowUpsEnabled}
                      composerEnterBehavior={composerEnterBehavior}
                      onQueueingEnabledChange={handleThreadQueueFollowUpsEnabledChange}
                      onOpenThread={openAttachedThreadSession}
                      onOpenTurnDiffReview={openTurnDiffReview}
                      onOpenTurnDiffFileInSidePanel={openTurnDiffFileInSidePanel}
                      onOpenSummaryGitReview={openSummaryGitReview}
                      turnDiffHoverPreviewDisabled={model.sidePanelOpen}
                      onForkSessionFromTurn={forkSessionFromTurn}
                      onForkFromTurnIntoWorktree={forkSessionFromTurnIntoWorktree}
                      worktreeStartMode={worktreeStartMode}
                      worktreeBranchPrefix={worktreeAutoBranchPrefix}
                      searchOpenTick={isActive ? threadSearchOpenTick : 0}
                      summaryPanelMounted={sessionThreadSummaryPanelMounted}
                      summaryPanelOpen={sessionThreadSummaryPanelOpen}
                      summaryPanelHideImmediately={sessionThreadSummaryPanelHideImmediately}
                      summaryPanelContentShift={sessionThreadSummaryPanelContentShift}
                      summarySideChatRows={isActive ? threadSummarySideChatRows : []}
                      summaryBrowserRows={isActive ? threadSummaryBrowserRows : []}
                      summaryScheduledAutomation={isActive ? threadSummaryScheduledAutomation : null}
                      summaryComputerUsePip={isActive ? remoteHostedPipSummaryControl.summaryComputerUsePip : null}
                      onOpenSummarySideChatRow={openSummarySideChatRow}
                      onOpenSummaryBrowserRow={openSummaryBrowserRow}
                      onOpenSummaryScheduledAutomation={openSummaryScheduledAutomation}
                      onOpenSummaryOutputInSidePanel={openSummaryOutputInSidePanel}
                      onOpenProcessManager={openSummaryProcessManager}
                      onOpenBackgroundTerminalOutput={openSummaryBackgroundTerminalOutput}
                      onToggleSummaryComputerUsePip={remoteHostedPipSummaryControl.onToggleSummaryComputerUsePip}
                      rightPanelComposerOverlayEnabled={sessionRightPanelComposerOverlayEnabled}
                      rightPanelComposerOverlayTarget={isActive ? rightPanelComposerOverlayTarget : null}
                      onOpenSideChat={(input) => openSideChat({ ...input, targetPanelId: "right" })}
                      onOpenMcpAppSidePanel={openMcpAppSidePanel}
                      onOpenPlanInSidePanel={openPlanSidePanel}
                      onClosePlanSidePanel={closePlanSidePanel}
                      planSidePanelState={sessionThreadPlanSidePanelState}
                      onRequestRenameThread={() => {
                        openRenameSessionDialog(session);
                      }}
                    />
                  </ThreadHeaderPortalProvider>
                ) : null}
              </div>
            </section>

            {sessionRightPanelMounted ? (
              <motion.aside
                data-app-shell-focus-area="right-panel"
                data-testid={isActive ? "session-right-panel" : undefined}
                data-right-panel-width-mode={model.rightPanelFullWidth ? "full" : "regular"}
                className={cn(
                  "relative ml-auto h-full min-h-0 min-w-0 shrink-0 overflow-visible",
                  APP_SHELL_RIGHT_PANEL_LAYER_CLASS,
                )}
                style={{
                  opacity: sessionRightPanelOpacity,
                  width: sessionRightPanelWidth,
                }}
              >
                {isActive && model.sidePanelOpen && !model.rightPanelFullWidth ? (
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
                  <motion.div
                    ref={isActive ? setRightPanelComposerOverlayTarget : undefined}
                    data-right-panel-composer-overlay-host="true"
                    className={cn(
                      "absolute top-0 right-0 bottom-0 min-w-0 bg-token-main-surface-primary",
                      !model.rightPanelFullWidth && "border-l border-token-border",
                    )}
                    style={{
                      width: sessionRightPanelTargetWidth,
                      "--thread-content-top-inset": "calc(var(--spacing) * 8)",
                    } as MotionStyle}
                  >
                    <PanelGroupTree
                      sessionId={session.id}
                      panelId="right"
                      layout={model.rightPanel.layout}
                      tabItemsByLeafId={sessionPanelGroupTabs.right.itemsByLeafId}
                      activeTabIdsByLeafId={sessionPanelGroupTabs.right.activeTabIdsByLeafId}
                      renderAfterTabs={(leafId) => isActive ? renderPanelNewTabButton(session, "right", leafId) : null}
                      renderAfterList={() => isActive ? rightPanelHeaderAfterList : null}
                      headerStartInsetPx={isActive ? rightPanelHeaderStartInsetWidth : 0}
                      tabScrollEndPaddingPx={sessionPanelTabScrollEndPaddingPx}
                      renderEmptyLeaf={(leafId) => (
                        <EmptyRightPane
                          actions={sessionAvailableRightPanelActions}
                          projects={projects}
                          isMac={isMacPlatform}
                          commandKeymapState={commandKeymapState}
                          currentProjectId={session.projectId}
                          currentProjectDbViewExists={
                            session.projectId !== null
                            && Boolean(findDbViewTabForProject(session, session.projectId))
                          }
                          onAction={(kind) => {
                            if (!isActive) return;
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
                            if (!isActive) return;
                            await openPanelDestinationFromPicker(destination, "right", leafId);
                          }}
                        />
                      )}
                      onSelectTab={(leafId, tabId) => {
                        if (isActive) void selectPanelTab("right", tabId, leafId);
                      }}
                      onCloseTab={(leafId, tabId) => {
                        if (isActive) void closePanelTab("right", tabId, leafId);
                      }}
                      onDirectCloseTab={(leafId, tabId) => {
                        if (isActive) void closePanelTab("right", tabId, leafId);
                      }}
                      onPinTab={(leafId, tabId) => {
                        if (isActive) void pinPreviewTab("right", tabId, leafId);
                      }}
                      onReorderTab={(leafId, tabId, targetIndex) => {
                        if (isActive) void reorderTabs("right", tabId, targetIndex, leafId);
                      }}
                      onMoveTab={(tabId, targetPanelId, targetLeafId, targetIndex, splitTarget) => {
                        if (isActive) void moveTabToPanel(tabId, targetPanelId, targetLeafId, targetIndex, splitTarget);
                      }}
                      onSplitGroup={(leafId, side, tabId) => {
                        if (isActive) void splitPanelGroup("right", leafId, side, tabId);
                      }}
                      onFocusGroup={(leafId) => {
                        if (isActive) rememberFocusedPanelGroup("right", leafId);
                      }}
                      onActivateGroup={(leafId, tabId) => {
                        if (isActive) void activatePanelGroup("right", leafId, tabId);
                      }}
                      onResizeGroup={(branchId, ratio) => {
                        if (!isActive) return;
                        return resizePanelGroup("right", branchId, ratio);
                      }}
                    />
                  </motion.div>
                </div>
              </motion.aside>
            ) : null}
          </div>

          {sessionBottomPanelMounted ? (
            <motion.section
              data-app-shell-focus-area="bottom-panel"
              data-testid={isActive ? "session-bottom-panel" : undefined}
              className="relative min-h-0 w-full shrink-0 overflow-visible"
              style={{
                opacity: sessionBottomPanelOpacity,
                height: sessionBottomPanelHeightStyle,
              }}
            >
              {isActive && model.bottomPanelOpen ? (
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
                <motion.div
                  className="absolute inset-x-0 top-0 min-h-0 border-t border-token-border bg-token-main-surface-primary"
                  style={{
                    height: sessionBottomPanelHeight,
                    minHeight: sessionBottomPanelHeight,
                  }}
                >
                  <PanelGroupTree
                    sessionId={session.id}
                    panelId="bottom"
                    layout={model.bottomPanel.layout}
                    tabItemsByLeafId={sessionPanelGroupTabs.bottom.itemsByLeafId}
                    activeTabIdsByLeafId={sessionPanelGroupTabs.bottom.activeTabIdsByLeafId}
                    renderAfterTabs={(leafId) => isActive ? renderPanelNewTabButton(session, "bottom", leafId) : null}
                    tabScrollEndPaddingPx={sessionPanelTabScrollEndPaddingPx}
                    headerEndInsetPx={isActive ? bottomPanelGlobalHeaderInsetWidth : 0}
                    renderEmptyLeaf={(leafId) => (
                      <EmptyRightPane
                        actions={sessionAvailableBottomPanelActions}
                        projects={projects}
                        isMac={isMacPlatform}
                        commandKeymapState={commandKeymapState}
                        currentProjectId={session.projectId}
                        currentProjectDbViewExists={false}
                        onAction={(kind) => {
                          if (!isActive) return;
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
                          if (!isActive) return;
                          await openPanelDestinationFromPicker(destination, "bottom", leafId);
                        }}
                      />
                    )}
                    onSelectTab={(leafId, tabId) => {
                      if (isActive) void selectPanelTab("bottom", tabId, leafId);
                    }}
                    onCloseTab={(leafId, tabId) => {
                      if (isActive) void closePanelTab("bottom", tabId, leafId);
                    }}
                    onDirectCloseTab={(leafId, tabId) => {
                      if (isActive) void closePanelTab("bottom", tabId, leafId);
                    }}
                    onPinTab={(leafId, tabId) => {
                      if (isActive) void pinPreviewTab("bottom", tabId, leafId);
                    }}
                    onReorderTab={(leafId, tabId, targetIndex) => {
                      if (isActive) void reorderTabs("bottom", tabId, targetIndex, leafId);
                    }}
                    onMoveTab={(tabId, targetPanelId, targetLeafId, targetIndex, splitTarget) => {
                      if (isActive) void moveTabToPanel(tabId, targetPanelId, targetLeafId, targetIndex, splitTarget);
                    }}
                    onSplitGroup={(leafId, side, tabId) => {
                      if (isActive) void splitPanelGroup("bottom", leafId, side, tabId);
                    }}
                    onFocusGroup={(leafId) => {
                      if (isActive) rememberFocusedPanelGroup("bottom", leafId);
                    }}
                    onActivateGroup={(leafId, tabId) => {
                      if (isActive) void activatePanelGroup("bottom", leafId, tabId);
                    }}
                    onResizeGroup={(branchId, ratio) => {
                      if (!isActive) return;
                      return resizePanelGroup("bottom", branchId, ratio);
                    }}
                  />
                  {isActive && bottomPanelGlobalHeaderControls ? (
                    <div
                      data-testid="bottom-panel-global-header-actions"
                      className="pointer-events-none absolute top-0 right-0 z-30 flex h-toolbar items-center justify-end pr-2"
                    >
                      <div className="pointer-events-none flex h-full items-center gap-1">
                        {bottomPanelGlobalHeaderControls}
                      </div>
                    </div>
                  ) : null}
                </motion.div>
              </div>
            </motion.section>
          ) : null}
        </div>
      </RetainedActivity>
    );
  };

  return (
    <HeaderActionProvider actions={appShellHeaderActions}>
      <NodexTooltipProvider>
        <ContentSearchProvider openRequest={contentSearchOpenRequest}>
          <ContentSearchSurface />
          {renameSessionDialog}
          {renamePendingWorktreeDialog}
          {stableWorktreeStatusDialog}
          <SidebarThreadMoveBlockedDialog
            blocked={blockedSidebarThreadMove}
            onClose={() => setBlockedSidebarThreadMove(null)}
          />
          {commandPalette}
          <WorkbenchProcessManagerDialog
            open={processManagerOpen}
            activeThreadId={activeSession?.thread?.threadId ?? null}
            threads={processManagerThreads}
            control={workbenchCodexControl}
            onOpenChange={setProcessManagerOpen}
            onOpenThread={openAttachedThreadSession}
            onOpenOutput={openProcessManagerOutput}
          />
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
            {activeRenderSession ? (
              <BrowserSidebarHiddenWebviewHosts
                sessionId={activeRenderSession.id}
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
              <motion.div
                aria-hidden={automationsRouteShell == null && rightPanelFullWidth ? "true" : undefined}
                data-testid="app-shell-header-context-menu-surface"
                className={cn(
                  "pointer-events-none ms-4 flex h-full min-w-0 flex-1 isolate items-center gap-1.5 overflow-hidden [contain:layout_paint] pe-2",
                  automationsRouteShell == null && rightPanelFullWidth && "invisible",
                )}
                style={{ marginRight: automationsDetailRailResolvedWidth }}
              >
                {automationsRouteShell ? (
                  <div
                    ref={setAutomationsHeaderPortalElement}
                    data-testid="automations-route-header-portal-target"
                    className="pointer-events-none w-full min-w-0 flex-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto"
                  />
                ) : (
                  <>
                    <div
                      ref={setThreadHeaderPortalElement}
                      data-testid="thread-stage-header-portal-target"
                      className="pointer-events-none w-full min-w-0 flex-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto"
                    />
                    <HeaderInlineActionRail
                      slotPosition="center"
                      data-testid="thread-stage-header-summary-actions"
                      className="ms-auto"
                    />
                  </>
                )}
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
          {settingsRouteShell ? (
            settingsRouteShell
          ) : (
            <>
          {showInlineSidebar ? (
            <ProjectSessionSidebar
              spaces={spaces}
              activeProjectId={activeProjectId}
              activeSessionId={activeSession?.id ?? null}
              activePendingClientThreadId={pendingWorktreeClientThreadId}
              contextMenuSessionId={contextMenuSessionId}
              sessionsByProject={sessionsByProject}
              projectlessSessions={projectlessSessions}
              sidebarThreadModel={sidebarThreadModel}
              pendingStableWorktrees={pendingStableWorktrees}
              expandedProjectIds={expandedProjectIds}
              pinnedProjectsSectionCollapsed={pinnedProjectsSectionCollapsed}
              projectsSectionCollapsed={projectsSectionCollapsed}
              chatsSectionCollapsed={chatsSectionCollapsed}
              loadingSessions={loadingSessions}
              width={sidebarWidth}
              animatedWidth={realSidebarMotion.animatedWidth}
              contentOpacity={realSidebarMotion.opacity}
              resizeDisabled={sidebarAnimating}
              getWindowZoom={getWindowZoom}
              onResizeWidth={applySidebarWidth}
              onTogglePinnedProjectsSectionCollapsed={togglePinnedProjectsSectionCollapsed}
              onToggleProjectsSectionCollapsed={toggleProjectsSectionCollapsed}
              onToggleChatsSectionCollapsed={toggleChatsSectionCollapsed}
              onToggleProjectExpanded={toggleProjectExpanded}
              onSelectProject={(projectId) => {
                closePendingWorktreeRoute();
                setAutomationsPath(null);
                selectProject(projectId);
              }}
              onSelectSidebarThread={(item) => {
                closePendingWorktreeRoute();
                setAutomationsPath(null);
                void selectSidebarThread(item);
              }}
              onPreviewSidebarThread={prefetchSidebarSession}
              onOpenSessionContextMenu={openSessionContextMenu}
              onSessionTitleDoubleClick={handleSessionTitleDoubleClick}
              onPendingWorktreeTitleDoubleClick={handlePendingWorktreeTitleDoubleClick}
              onArchiveSidebarThread={archiveSidebarThreadItem}
              onToggleSessionPinned={toggleSessionPin}
              onToggleSidebarThreadPinned={toggleSidebarThreadPinned}
              onStartNewChatInProject={(projectId) => {
                closePendingWorktreeRoute();
                setAutomationsPath(null);
                void startNewChatInProject(projectId);
              }}
              onOpenStableWorktree={setStableWorktreeStatusId}
              onCreateStableWorktree={createStableWorktree}
              onOpenCommandPalette={openSidebarCommandPalette}
              onShowUnavailableProduct={showSidebarUnavailableProduct}
              onOpenAutomations={openAutomations}
              automationsActive={Boolean(automationsPath)}
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
              onReorderProjectThreads={reorderProjectThreadsForSidebar}
              onReorderChatsThreads={reorderChatsThreadsForSidebar}
              onMoveSidebarThread={moveSidebarThreadForSidebar}
              onReorderPinnedThreads={reorderPinnedSidebarThreads}
              onOpenSettings={openSettings}
              account={codexAccount}
              connection={codexConnection}
              onRefreshAccount={codexAccountActions.refreshAccount}
              onStartChatGptLogin={codexAccountActions.startChatGptLogin}
              onStartApiKeyLogin={codexAccountActions.startApiKeyLogin}
              onCancelLogin={codexAccountActions.cancelLogin}
              onLogout={handleCodexAccountLogout}
              onAccountErrorMessage={handleCodexAccountErrorMessage}
              sidebarArchivePendingKeys={sidebarArchivePendingKeys}
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
                  activePendingClientThreadId={pendingWorktreeClientThreadId}
                  contextMenuSessionId={contextMenuSessionId}
                  sessionsByProject={sessionsByProject}
                  projectlessSessions={projectlessSessions}
                  sidebarThreadModel={sidebarThreadModel}
                  pendingStableWorktrees={pendingStableWorktrees}
                  expandedProjectIds={expandedProjectIds}
                  pinnedProjectsSectionCollapsed={pinnedProjectsSectionCollapsed}
                  projectsSectionCollapsed={projectsSectionCollapsed}
                  chatsSectionCollapsed={chatsSectionCollapsed}
                  loadingSessions={loadingSessions}
                  width={sidebarWidth}
                  getWindowZoom={getWindowZoom}
                  onResizeWidth={applySidebarWidth}
                  onResizeActiveChange={setFloatingSidebarResizing}
                  onTogglePinnedProjectsSectionCollapsed={togglePinnedProjectsSectionCollapsed}
                  onToggleProjectsSectionCollapsed={toggleProjectsSectionCollapsed}
                  onToggleChatsSectionCollapsed={toggleChatsSectionCollapsed}
                  onToggleProjectExpanded={toggleProjectExpanded}
                  onSelectProject={(projectId) => {
                    closePendingWorktreeRoute();
                    setAutomationsPath(null);
                    selectProject(projectId);
                  }}
                  onSelectSidebarThread={(item) => {
                    closePendingWorktreeRoute();
                    setAutomationsPath(null);
                    void selectSidebarThread(item);
                  }}
                  onPreviewSidebarThread={prefetchSidebarSession}
                  onOpenSessionContextMenu={openSessionContextMenu}
                  onSessionTitleDoubleClick={handleSessionTitleDoubleClick}
                  onPendingWorktreeTitleDoubleClick={handlePendingWorktreeTitleDoubleClick}
                  onArchiveSidebarThread={archiveSidebarThreadItem}
                  onToggleSessionPinned={toggleSessionPin}
                  onToggleSidebarThreadPinned={toggleSidebarThreadPinned}
                  onStartNewChatInProject={(projectId) => {
                    closePendingWorktreeRoute();
                    setAutomationsPath(null);
                    void startNewChatInProject(projectId);
                  }}
                  onOpenStableWorktree={setStableWorktreeStatusId}
                  onCreateStableWorktree={createStableWorktree}
                  onOpenCommandPalette={openSidebarCommandPalette}
                  onShowUnavailableProduct={showSidebarUnavailableProduct}
                  onOpenAutomations={openAutomations}
                  automationsActive={Boolean(automationsPath)}
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
                  onReorderProjectThreads={reorderProjectThreadsForSidebar}
                  onReorderChatsThreads={reorderChatsThreadsForSidebar}
                  onMoveSidebarThread={moveSidebarThreadForSidebar}
                  onReorderPinnedThreads={reorderPinnedSidebarThreads}
                  onOpenSettings={openSettings}
                  account={codexAccount}
                  connection={codexConnection}
                  onRefreshAccount={codexAccountActions.refreshAccount}
                  onStartChatGptLogin={codexAccountActions.startChatGptLogin}
                  onStartApiKeyLogin={codexAccountActions.startApiKeyLogin}
                  onCancelLogin={codexAccountActions.cancelLogin}
                  onLogout={handleCodexAccountLogout}
                  onAccountErrorMessage={handleCodexAccountErrorMessage}
                  sidebarArchivePendingKeys={sidebarArchivePendingKeys}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {pendingWorktreeRouteShell ? (
            <main
              className={cn(
                "main-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                realSidebarMounted ? "rounded-s-2xl" : "!rounded-l-none",
              )}
            >
              {pendingWorktreeRouteShell}
            </main>
          ) : automationsRouteShell ? (
            <>
              <main
                className={cn(
                  "main-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                  realSidebarMounted ? "rounded-s-2xl" : "!rounded-l-none",
                )}
              >
                {automationsRouteShell}
              </main>
              {automationsDetailRailMounted ? (
                <motion.aside
                  data-app-shell-focus-area="right-panel"
                  data-testid="automation-detail-rail"
                  data-right-panel-width-mode="regular"
                  className={cn(
                    "relative ml-auto h-full min-h-0 min-w-0 shrink-0 overflow-visible",
                    APP_SHELL_RIGHT_PANEL_LAYER_CLASS,
                  )}
                  style={{
                    width: automationsDetailRailResolvedWidth,
                  }}
                >
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize scheduled task details"
                    className="group absolute top-0 bottom-0 left-0 z-40 flex w-4 -translate-x-2 cursor-col-resize touch-none select-none active:cursor-col-resize"
                    onPointerDown={resizeAutomationDetailRail}
                  >
                    <div className="pointer-events-none m-auto h-full w-px bg-linear-to-b from-transparent via-token-foreground/25 to-transparent opacity-0 group-hover:opacity-100 group-active:opacity-100" />
                  </div>

                  <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
                    <motion.div
                      ref={setAutomationsDetailRailPortalElement}
                      className="absolute top-0 bottom-0 left-0 min-w-0 border-l border-token-border bg-token-main-surface-primary"
                      style={{
                        width: automationsDetailRailResolvedWidth,
                        minWidth: automationsDetailRailResolvedWidth,
                        "--thread-content-top-inset": "calc(var(--spacing) * 8)",
                      } as MotionStyle}
                    />
                  </div>
                </motion.aside>
              ) : null}
            </>
          ) : (
            <>
              <main
                className={cn(
                  "main-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                  realSidebarMounted ? "rounded-s-2xl" : "!rounded-l-none",
                )}
              >
                {retainedSessionRenderEntries.length > 0 ? (
                  retainedSessionRenderEntries.map(renderRetainedSessionActivity)
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
                cardNfm={cardStageHistoryModal?.cardNfm}
                projectWorkspacePath={projectWorkspaceRootOrNull(cardStageHistoryModalProject)}
                open={cardStageHistoryModal !== null}
                onClose={closeCardStageHistoryModal}
                onCardMutated={() => {
                  void activeProjectKanban.refresh();
                }}
              />
            </>
          )}
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

function SidebarProjectGroupRowsContent({
  visibleItems,
  pager,
  emptyText,
  loading,
  reorderGroups,
  renderProjectGroup,
}: {
  visibleItems: CodexSidebarProjectGroup[];
  pager: ReactNode;
  emptyText: string;
  loading: boolean;
  reorderGroups: (nextVisibleGroupIds: string[]) => void | Promise<void>;
  renderProjectGroup: (
    group: CodexSidebarProjectGroup,
    controller: SidebarGroupDndController,
  ) => ReactNode;
}) {
  const visibleGroupIds = useMemo(
    () => visibleItems.map((group) => group.project.id),
    [visibleItems],
  );
  const visibleGroupById = useMemo(
    () => new Map(visibleItems.map((group) => [group.project.id, group] as const)),
    [visibleItems],
  );
  const reorder = useSidebarGroupReorderController({
    groupIds: visibleGroupIds,
    reorderGroups,
  });
  const orderedVisibleItems = useMemo(
    () => reorder.groupIds
      .map((projectId) => visibleGroupById.get(projectId))
      .filter((group): group is CodexSidebarProjectGroup => Boolean(group)),
    [reorder.groupIds, visibleGroupById],
  );

  return (
    <div className="isolate flex flex-col [contain:layout]">
      <SidebarProjectSortableContext groupIds={reorder.groupIds}>
        <div className="flex flex-col" role="list" aria-label="Projects">
          {orderedVisibleItems.length > 0 ? orderedVisibleItems.map((group, index) => (
            <Fragment key={group.project.id}>
              {reorder.dropIndicatorIndex === index ? <SidebarDropIndicator /> : null}
              {renderProjectGroup(group, reorder.controller)}
            </Fragment>
          )) : (
            <div className="px-row-x py-row-y text-sm text-token-description-foreground" role="listitem">
              {loading ? "Loading projects..." : emptyText}
            </div>
          )}
          {reorder.dropIndicatorIndex === orderedVisibleItems.length ? <SidebarDropIndicator /> : null}
          {pager}
        </div>
      </SidebarProjectSortableContext>
    </div>
  );
}

function SidebarPinnedThreadRowsContent({
  containerId,
  getThreadId,
  visibleThreadKeys,
  itemsByKey,
  ariaLabel,
  onVisibleThreadOrderChange,
  renderThread,
}: {
  containerId: "pinned";
  getThreadId: (threadKey: string) => string | null;
  visibleThreadKeys: string[];
  itemsByKey: ReadonlyMap<string, CodexSidebarThreadItem>;
  ariaLabel: string;
  onVisibleThreadOrderChange: (change: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => Promise<void>;
  renderThread: (threadKey: string) => ReactNode;
}) {
  const pendingThreadDrops = usePendingSidebarThreadDrops();
  const optimisticThreadKeys = resolveSidebarThreadKeysWithPendingDrops({
    containerId,
    pendingThreadDrops,
    threadKeys: visibleThreadKeys,
    getThreadId,
  });
  return (
    <div className="isolate flex flex-col [contain:layout]">
      <div className="flex flex-col" role="list" aria-label={ariaLabel}>
        <SidebarThreadReorderRows
          containerId={containerId}
          getThreadId={getThreadId}
          visibleThreadKeys={optimisticThreadKeys}
          sortableThreadKeys={optimisticThreadKeys}
          onVisibleThreadOrderChange={onVisibleThreadOrderChange}
          renderThread={renderThread}
          renderDragOverlay={(threadKey) => {
            const item = itemsByKey.get(threadKey);
            if (!item) return null;
            return (
              <div className="flex h-[var(--height-token-nav-row)] max-w-80 items-center gap-2 px-2 text-base text-token-foreground">
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <CodexThreadIcon className="icon-xs" />
                </span>
                <span className="min-w-0 truncate">{item.title}</span>
              </div>
            );
          }}
          sourceProjectKind="local"
          targetProjectKind="local"
        />
      </div>
    </div>
  );
}

function SidebarThreadContainerRowsContent({
  containerId,
  threadKeys,
  getThreadId,
  itemsByKey,
  expanded,
  onExpandedChange,
  forcedVisibleKey,
  suppressedKeys,
  loading,
  onVisibleThreadOrderChange,
  renderThread,
}: {
  containerId: "chats";
  threadKeys: string[];
  getThreadId: (threadKey: string) => string | null;
  itemsByKey: ReadonlyMap<string, CodexSidebarThreadItem>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  forcedVisibleKey: string | null;
  suppressedKeys: ReadonlySet<string>;
  loading: boolean;
  onVisibleThreadOrderChange: (change: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => Promise<void>;
  renderThread: (threadKey: string) => ReactNode;
}) {
  const pendingThreadDrops = usePendingSidebarThreadDrops();
  const optimisticThreadKeys = resolveSidebarThreadKeysWithPendingDrops({
    containerId,
    pendingThreadDrops,
    threadKeys,
    threadKeysInDisplayOrder: threadKeys,
    getThreadId,
  });
  const sortableThreadKeys = optimisticThreadKeys.filter((threadKey) => (
    getThreadId(threadKey) !== null && !suppressedKeys.has(threadKey)
  ));
  const reorder = useSidebarThreadReorderController({
    visibleThreadKeys: sortableThreadKeys,
    onVisibleThreadOrderChange,
  });
  const displayedThreadKeys = replaceVisibleCodexSidebarThreadKeyOrder({
    threadKeysInDisplayOrder: optimisticThreadKeys,
    visibleThreadKeys: sortableThreadKeys,
    nextVisibleThreadKeys: reorder.displayedVisibleThreadKeys,
  });

  return (
    <SidebarThreadDropContainer containerId={containerId} targetProjectKind="local">
      <CodexSidebarPaginatedItems
        items={displayedThreadKeys}
        getKey={(threadKey) => threadKey}
        maxItems={CODEX_SIDEBAR_PROJECTLESS_THREAD_MAX_ITEMS}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        forcedVisibleKey={forcedVisibleKey}
        suppressedKeys={suppressedKeys}
      >
        {(pagination, pager) => (
          <div className="isolate flex flex-col [contain:layout]">
            <div className="flex flex-col" role="list" aria-label="Chats">
              {pagination.visibleItems.length > 0 ? (
                <SidebarThreadSortableRows
                  containerId={containerId}
                  getThreadId={getThreadId}
                  visibleThreadKeys={pagination.visibleItems}
                  sortableThreadKeysInDisplayOrder={reorder.displayedVisibleThreadKeys}
                  controller={reorder.controller}
                  dropIndicatorTarget={reorder.dropIndicatorTarget}
                  renderThread={renderThread}
                  renderDragOverlay={(threadKey) => {
                    const item = itemsByKey.get(threadKey);
                    if (!item) return null;
                    return (
                      <div className="flex h-[var(--height-token-nav-row)] max-w-80 items-center gap-2 px-2 text-base text-token-foreground">
                        <span className="flex size-5 shrink-0 items-center justify-center">
                          <CodexThreadIcon className="icon-xs" />
                        </span>
                        <span className="min-w-0 truncate">{item.title}</span>
                      </div>
                    );
                  }}
                  sourceProjectKind="local"
                  targetProjectKind="local"
                />
              ) : (
                <div className="px-row-x py-row-y text-sm text-token-description-foreground" role="listitem">
                  {loading ? "Loading chats..." : "No projectless chats"}
                </div>
              )}
              {pager}
            </div>
          </div>
        )}
      </CodexSidebarPaginatedItems>
    </SidebarThreadDropContainer>
  );
}

function SidebarProjectThreadRowsContent({
  project,
  pinnedThreadKeys,
  sortablePinnedThreadKeys,
  threadKeys,
  expanded,
  forcedVisibleKey,
  suppressedKeys,
  loading,
  onExpandedChange,
  onPinnedThreadOrderChange,
  onProjectThreadOrderChange,
  getThreadId,
  itemsByKey,
  renderThread,
}: {
  project: Project;
  pinnedThreadKeys: string[];
  sortablePinnedThreadKeys: string[];
  threadKeys: string[];
  expanded: boolean;
  forcedVisibleKey: string | null;
  suppressedKeys: ReadonlySet<string>;
  loading: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPinnedThreadOrderChange: (change: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => Promise<void>;
  onProjectThreadOrderChange: (projectId: string, orderedThreadIds: string[]) => Promise<void>;
  getThreadId: (threadKey: string) => string | null;
  itemsByKey: ReadonlyMap<string, CodexSidebarThreadItem>;
  renderThread: (threadKey: string) => ReactNode;
}) {
  const pinnedContainerId = codexSidebarProjectThreadContainerId(project.id, true);
  const regularContainerId = codexSidebarProjectThreadContainerId(project.id, false);
  const pendingThreadDrops = usePendingSidebarThreadDrops();
  const optimisticPinnedThreadKeys = useMemo(() => resolveSidebarThreadKeysWithPendingDrops({
    containerId: pinnedContainerId,
    pendingThreadDrops,
    threadKeys: pinnedThreadKeys,
    getThreadId,
  }), [getThreadId, pendingThreadDrops, pinnedContainerId, pinnedThreadKeys]);
  const optimisticRegularThreadKeys = useMemo(() => resolveSidebarThreadKeysWithPendingDrops({
    containerId: regularContainerId,
    pendingThreadDrops,
    threadKeys,
    threadKeysInDisplayOrder: threadKeys,
    getThreadId,
  }), [
    getThreadId,
    pendingThreadDrops,
    regularContainerId,
    threadKeys,
  ]);
  const sortablePinnedThreadKeySet = useMemo(
    () => new Set(sortablePinnedThreadKeys),
    [sortablePinnedThreadKeys],
  );
  const optimisticSortablePinnedThreadKeys = useMemo(() => optimisticPinnedThreadKeys.filter(
    (threadKey) => sortablePinnedThreadKeySet.has(threadKey) && !suppressedKeys.has(threadKey),
  ), [optimisticPinnedThreadKeys, sortablePinnedThreadKeySet, suppressedKeys]);
  const sortableRegularThreadKeys = useMemo(() => listReorderableCodexSidebarProjectThreadKeys({
    visibleThreadKeys: optimisticRegularThreadKeys.filter(
      (threadKey) => !suppressedKeys.has(threadKey),
    ),
    getThreadId,
  }), [getThreadId, optimisticRegularThreadKeys, suppressedKeys]);
  const persistVisibleRegularThreadOrder = useCallback(async ({
    visibleThreadKeys,
    nextVisibleThreadKeys,
  }: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => {
    const orderedThreadIds = nextVisibleThreadKeys.flatMap((threadKey) => {
      const threadId = getThreadId(threadKey);
      return threadId ? [threadId] : [];
    });
    if (orderedThreadIds.length !== visibleThreadKeys.length) return;
    await onProjectThreadOrderChange(project.id, orderedThreadIds);
  }, [getThreadId, onProjectThreadOrderChange, project.id]);
  const pinnedReorder = useSidebarThreadReorderController({
    visibleThreadKeys: optimisticSortablePinnedThreadKeys,
    onVisibleThreadOrderChange: onPinnedThreadOrderChange,
  });
  const regularReorder = useSidebarThreadReorderController({
    visibleThreadKeys: sortableRegularThreadKeys,
    onVisibleThreadOrderChange: persistVisibleRegularThreadOrder,
  });
  const displayedPinnedThreadKeys = useMemo(() => replaceVisibleCodexSidebarThreadKeyOrder({
    threadKeysInDisplayOrder: optimisticPinnedThreadKeys,
    visibleThreadKeys: optimisticSortablePinnedThreadKeys,
    nextVisibleThreadKeys: pinnedReorder.displayedVisibleThreadKeys,
  }), [
    optimisticPinnedThreadKeys,
    optimisticSortablePinnedThreadKeys,
    pinnedReorder.displayedVisibleThreadKeys,
  ]);
  const displayedRegularThreadKeys = useMemo(() => replaceVisibleCodexSidebarThreadKeyOrder({
    threadKeysInDisplayOrder: optimisticRegularThreadKeys,
    visibleThreadKeys: sortableRegularThreadKeys,
    nextVisibleThreadKeys: regularReorder.displayedVisibleThreadKeys,
  }), [
    optimisticRegularThreadKeys,
    regularReorder.displayedVisibleThreadKeys,
    sortableRegularThreadKeys,
  ]);
  const displayedThreadKeys = useMemo(
    () => [...displayedPinnedThreadKeys, ...displayedRegularThreadKeys],
    [displayedPinnedThreadKeys, displayedRegularThreadKeys],
  );
  const renderDragOverlay = (threadKey: string) => {
    const item = itemsByKey.get(threadKey);
    if (!item) return null;
    return (
      <div className="flex h-[var(--height-token-nav-row)] max-w-80 items-center gap-2 px-2 text-base text-token-foreground">
        <span className="flex size-5 shrink-0 items-center justify-center">
          <CodexThreadIcon className="icon-xs" />
        </span>
        <span className="min-w-0 truncate">{item.title}</span>
      </div>
    );
  };

  return (
    <CodexSidebarPaginatedItems
      items={displayedThreadKeys}
      getKey={(threadKey) => threadKey}
      maxItems={CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      forcedVisibleKey={forcedVisibleKey}
      suppressedKeys={suppressedKeys}
      pagerClassName={CODEX_SIDEBAR_PROJECT_THREAD_PAGER_ROW_CLASS}
    >
      {(pagination, pager) => {
        const pinnedThreadKeySet = new Set(displayedPinnedThreadKeys);
        const visiblePinnedThreadKeys = pagination.visibleItems.filter((threadKey) => (
          pinnedThreadKeySet.has(threadKey)
        ));
        const visibleRegularThreadKeys = pagination.visibleItems.filter((threadKey) => (
          !pinnedThreadKeySet.has(threadKey)
        ));

        return (
          <CodexProjectSessionList project={project} showAll={expanded}>
            <SidebarThreadDropContainer
              containerId={pinnedContainerId}
              targetProjectKind="local"
            >
              <SidebarThreadSortableRows
                containerId={pinnedContainerId}
                getThreadId={getThreadId}
                visibleThreadKeys={visiblePinnedThreadKeys}
                sortableThreadKeysInDisplayOrder={pinnedReorder.displayedVisibleThreadKeys}
                controller={pinnedReorder.controller}
                dropIndicatorTarget={pinnedReorder.dropIndicatorTarget}
                renderThread={renderThread}
                renderDragOverlay={renderDragOverlay}
                sourceProjectKind="local"
                targetProjectKind="local"
              />
            </SidebarThreadDropContainer>
            <SidebarThreadDropContainer
              containerId={regularContainerId}
              targetProjectKind="local"
            >
              <SidebarThreadSortableRows
                containerId={regularContainerId}
                getThreadId={getThreadId}
                visibleThreadKeys={visibleRegularThreadKeys}
                sortableThreadKeysInDisplayOrder={regularReorder.displayedVisibleThreadKeys}
                controller={regularReorder.controller}
                dropIndicatorTarget={regularReorder.dropIndicatorTarget}
                renderThread={renderThread}
                renderDragOverlay={renderDragOverlay}
                sourceProjectKind="local"
                targetProjectKind="local"
              />
            </SidebarThreadDropContainer>
            {pagination.visibleItems.length === 0 ? (
              <div className="px-row-x py-row-y text-sm text-token-description-foreground" role="listitem">
                {loading ? "Loading chats..." : "No chats"}
              </div>
            ) : null}
            <SidebarThreadDropContainer
              containerId={regularContainerId}
              projectDropZone="project-pagination"
              targetProjectKind="local"
            >
              {pager}
            </SidebarThreadDropContainer>
          </CodexProjectSessionList>
        );
      }}
    </CodexSidebarPaginatedItems>
  );
}

function SidebarThreadOrganizerSections({
  activeProjectId,
  activeSessionId,
  activePendingClientThreadId,
  contextMenuSessionId,
  sessionsByProject,
  projectlessSessions,
  expandedProjectIds,
  pinnedThreadsSectionCollapsed,
  projectsSectionCollapsed,
  chatsSectionCollapsed,
  loadingSessions,
  model,
  onTogglePinnedThreadsSectionCollapsed,
  onToggleProjectsSectionCollapsed,
  onToggleChatsSectionCollapsed,
  onToggleProjectExpanded,
  onSelectProject,
  onSelectSidebarThread,
  onPreviewSidebarThread,
  onOpenSessionContextMenu,
  onSessionTitleDoubleClick,
  onPendingWorktreeTitleDoubleClick,
  onArchiveSidebarThread,
  onToggleSessionPinned,
  onToggleSidebarThreadPinned,
  onStartNewChatInProject,
  pendingStableWorktrees,
  onOpenStableWorktree,
  onCreateStableWorktree,
  projectPickerOpenTick,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onReorderProjects,
  onSetProjectPinned,
  onSetPinnedProjectOrder,
  onReorderProjectThreads,
  onReorderChatsThreads,
  onReorderPinnedThreads,
  sidebarArchivePendingKeys,
}: {
  activeProjectId: string;
  activeSessionId: string | null;
  activePendingClientThreadId?: string | null;
  contextMenuSessionId?: string | null;
  sessionsByProject: Record<string, ProjectSession[]>;
  projectlessSessions: ProjectSession[];
  expandedProjectIds: Set<string>;
  pinnedThreadsSectionCollapsed: boolean;
  projectsSectionCollapsed: boolean;
  chatsSectionCollapsed: boolean;
  loadingSessions: boolean;
  model: CodexSidebarThreadSyncModel;
  onTogglePinnedThreadsSectionCollapsed: () => void;
  onToggleProjectsSectionCollapsed: () => void;
  onToggleChatsSectionCollapsed: () => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSidebarThread: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onPreviewSidebarThread?: (item: CodexSidebarThreadItem) => void;
  onOpenSessionContextMenu?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onSessionTitleDoubleClick?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onPendingWorktreeTitleDoubleClick?: (
    item: CodexSidebarThreadItem,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onArchiveSidebarThread?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onToggleSessionPinned?: (session: ProjectSession) => void | Promise<void>;
  onToggleSidebarThreadPinned?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onStartNewChatInProject: (projectId: string) => void | Promise<void>;
  pendingStableWorktrees: readonly StableWorktreeEntry[];
  onOpenStableWorktree: (pendingWorktreeId: string) => void;
  onCreateStableWorktree: (project: Project, projectName: string) => Promise<void>;
  projectPickerOpenTick: number;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onReorderProjects: (input: ProjectOrderInput) => Promise<Project[]>;
  onSetProjectPinned: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onSetPinnedProjectOrder: (input: ProjectPinnedOrderInput) => Promise<Project[]>;
  onReorderProjectThreads: (projectId: string, orderedThreadIds: string[]) => Promise<void>;
  onReorderChatsThreads: (input: CodexSidebarChatsThreadOrderInput) => Promise<void>;
  onReorderPinnedThreads: (orderedThreadIds: readonly string[]) => Promise<unknown>;
  sidebarArchivePendingKeys: ReadonlySet<string>;
}) {
  const [pinnedProjectsExpanded, setPinnedProjectsExpanded] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [expandedProjectThreadListIds, setExpandedProjectThreadListIds] = useState<Set<string>>(new Set());
  const [projectlessThreadListExpanded, setProjectlessThreadListExpanded] = useState(false);
  const [previouslyExpandedProjectGroupIds, setPreviouslyExpandedProjectGroupIds] = useState<string[]>([]);
  const pinnedDropTarget = useSidebarPinnedDropContainer();
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
  const getSidebarRealThreadId = useCallback((threadKey: string) => {
    const item = sidebarThreadItemsByKey.get(threadKey);
    if (!item || item.pendingWorktreeId) return null;
    if (model.threadItemsByKey.has(threadKey)) return item.threadId;
    const session = item.sessionId
      ? sessionsById.get(item.sessionId)
      : sessionsByThreadId.get(item.threadId);
    return session?.thread?.threadId ?? null;
  }, [model.threadItemsByKey, sessionsById, sessionsByThreadId, sidebarThreadItemsByKey]);
  const allPinnedThreadKeys = useMemo(() => {
    const fallbackPinnedThreadKeys = sortSidebarThreadKeysForDisplay({
      threadKeys: fallbackThreadItems
        .filter((item) => item.pinned)
        .map((item) => item.key),
      itemsByKey: sidebarThreadItemsByKey,
      sessionsById,
    });
    return [...model.pinnedThreadKeys, ...fallbackPinnedThreadKeys];
  }, [fallbackThreadItems, model.pinnedThreadKeys, sessionsById, sidebarThreadItemsByKey]);
  const knownProjectIds = useMemo(
    () => new Set(model.projectGroups.map((group) => group.project.id)),
    [model.projectGroups],
  );
  const pinnedStandaloneThreadKeys = useMemo(() => allPinnedThreadKeys.filter((threadKey) => {
    const projectId = sidebarThreadItemsByKey.get(threadKey)?.projectId ?? null;
    return projectId === null || !knownProjectIds.has(projectId);
  }), [allPinnedThreadKeys, knownProjectIds, sidebarThreadItemsByKey]);
  const sortablePinnedStandaloneThreadKeys = useMemo(() =>
    pinnedStandaloneThreadKeys.filter((threadKey) =>
      model.threadItemsByKey.has(threadKey)
      && !sidebarArchivePendingKeys.has(threadKey)
    ), [model.threadItemsByKey, pinnedStandaloneThreadKeys, sidebarArchivePendingKeys]);
  const fallbackPinnedStandaloneThreadKeys = useMemo(() =>
    pinnedStandaloneThreadKeys.filter((threadKey) =>
      !model.threadItemsByKey.has(threadKey)
      && !sidebarArchivePendingKeys.has(threadKey)
    ), [model.threadItemsByKey, pinnedStandaloneThreadKeys, sidebarArchivePendingKeys]);
  const reorderVisiblePinnedThreads = useCallback(async ({
    visibleThreadKeys,
    nextVisibleThreadKeys,
  }: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => {
    const mutation = buildCodexSidebarPinnedReorderMutation({
      pinnedThreadIds: model.snapshot.pinnedThreadIds,
      visibleThreadKeys,
      nextVisibleThreadKeys,
      itemsByKey: sidebarThreadItemsByKey,
    });
    const pendingItemsById = new Map(nextVisibleThreadKeys.flatMap((threadKey) => {
      const item = sidebarThreadItemsByKey.get(threadKey);
      return item?.pendingWorktreeId ? [[item.pendingWorktreeId, item] as const] : [];
    }));
    const pendingRequests = mutation.pendingUpdates.flatMap((update) => {
      const pendingItem = pendingItemsById.get(update.pendingWorktreeId);
      if (!pendingItem) return [];
      return [invoke(
        "codex:pending-worktree:set-pinned-before-thread",
        pendingItem.hostId,
        update.pendingWorktreeId,
        update.beforeThreadId,
      ).catch(() => {
        toast.danger("Failed to reorder pending chat");
      })];
    });

    try {
      const pinnedOrderRequest = onReorderPinnedThreads(mutation.pinnedThreadIds)
        .then(() => undefined);
      await Promise.all([pinnedOrderRequest, ...pendingRequests]);
    } catch (error) {
      toast.danger("Failed to reorder pinned chats");
      throw error;
    }
  }, [model.snapshot.pinnedThreadIds, onReorderPinnedThreads, sidebarThreadItemsByKey]);
  const canonicalUnpinnedThreadKeys = useMemo(() => sortSidebarThreadKeysForDisplay({
    threadKeys: [
      ...model.snapshot.items
        .filter((item) => !item.pinned && !sidebarArchivePendingKeys.has(item.key))
        .map((item) => item.key),
      ...fallbackThreadItems
        .filter((item) => !item.pinned && !sidebarArchivePendingKeys.has(item.key))
        .map((item) => item.key),
    ],
    itemsByKey: sidebarThreadItemsByKey,
    sessionsById,
  }), [
    fallbackThreadItems,
    model.snapshot.items,
    sessionsById,
    sidebarArchivePendingKeys,
    sidebarThreadItemsByKey,
  ]);
  const projectGroups = useMemo(() => model.projectGroups.map((group) => {
    const projectPinnedThreadKeySet = new Set([
      ...group.pinnedThreadKeys,
      ...fallbackThreadItems
        .filter((item) => item.projectId === group.project.id && item.pinned)
        .map((item) => item.key),
    ]);
    const pinnedThreadKeys = allPinnedThreadKeys.filter((threadKey) => (
      projectPinnedThreadKeySet.has(threadKey)
    ));
    const unpinnedThreadKeys = sortSidebarThreadKeysForDisplay({
      threadKeys: [
        ...group.threadKeys,
        ...fallbackThreadItems
          .filter((item) => item.projectId === group.project.id && !item.pinned)
          .map((item) => item.key),
      ],
      itemsByKey: sidebarThreadItemsByKey,
      sessionsById,
    });
    const manualThreadOrder = model.snapshot.projectThreadOrders[group.project.id];
    const threadKeys = manualThreadOrder
      ? orderCodexSidebarThreadKeysByManualThreadIds({
          threadKeys: unpinnedThreadKeys,
          orderedThreadIds: manualThreadOrder,
          getThreadId: getSidebarRealThreadId,
        })
      : unpinnedThreadKeys;
    return {
      project: group.project,
      pinnedThreadKeys,
      threadKeys,
    };
  }), [
    allPinnedThreadKeys,
    fallbackThreadItems,
    getSidebarRealThreadId,
    model.projectGroups,
    model.snapshot.projectThreadOrders,
    sessionsById,
    sidebarThreadItemsByKey,
  ]);
  const stableWorktreeWorkspaceRootOptions = useMemo(
    () => projectGroups.flatMap(({ project }) =>
      project.sources.map((source) => source.root)
    ),
    [projectGroups],
  );
  const stableWorktreeWorkspaceRootLabels = useMemo(() => Object.fromEntries(
    projectGroups.flatMap(({ project }) =>
      project.sources.map((source) => [source.root, project.name] as const)
    ),
  ), [projectGroups]);
  const projectLabelById = useMemo(() => {
    const entries = projectGroups.map(({ project }) => [project.id, project.name] as const);
    return new Map(entries);
  }, [projectGroups]);
  const projectOrderIds = useMemo(
    () => projectGroups.map((group) => group.project.id),
    [projectGroups],
  );
  const pinnedProjectGroups = useMemo(
    () => projectGroups
      .filter((group) => group.project.pinned)
      .sort((left, right) =>
        (left.project.pinnedOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.project.pinnedOrder ?? Number.MAX_SAFE_INTEGER)
      ),
    [projectGroups],
  );
  const pinnedProjectIds = useMemo(
    () => pinnedProjectGroups.map((group) => group.project.id),
    [pinnedProjectGroups],
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
  const reorderVisibleProjectGroups = useCallback((
    visibleGroupIds: string[],
    nextVisibleGroupIds: string[],
  ) => {
    const orderedProjectIds = replaceVisibleOrder(
      projectOrderIds,
      visibleGroupIds,
      nextVisibleGroupIds,
    );
    return onReorderProjects({ orderedProjectIds }).then(() => undefined);
  }, [onReorderProjects, projectOrderIds]);
  const reorderVisiblePinnedProjectGroups = useCallback((
    visibleGroupIds: string[],
    nextVisibleGroupIds: string[],
  ) => {
    const orderedProjectIds = replaceVisibleOrder(
      pinnedProjectIds,
      visibleGroupIds,
      nextVisibleGroupIds,
    );
    return onSetPinnedProjectOrder({ orderedProjectIds }).then(() => undefined);
  }, [onSetPinnedProjectOrder, pinnedProjectIds]);
  const hasVisiblePinnedStandaloneThreads = pinnedStandaloneThreadKeys.some((threadKey) =>
    !sidebarArchivePendingKeys.has(threadKey)
  );
  const hasVisiblePinnedSectionItems = hasVisiblePinnedStandaloneThreads || pinnedProjectGroups.length > 0;
  const projectlessThreadKeys = useMemo(() => {
    const canonicalProjectlessThreadKeys = canonicalUnpinnedThreadKeys.filter((threadKey) => (
      sidebarThreadItemsByKey.get(threadKey)?.projectless === true
    ));
    const manualThreadOrder = model.snapshot.projectlessThreadOrder;
    if (manualThreadOrder === null) return canonicalProjectlessThreadKeys;
    return orderCodexSidebarThreadKeysByManualThreadIds({
      threadKeys: canonicalProjectlessThreadKeys,
      orderedThreadIds: manualThreadOrder,
      getThreadId: getSidebarRealThreadId,
    });
  }, [
    canonicalUnpinnedThreadKeys,
    getSidebarRealThreadId,
    model.snapshot.projectlessThreadOrder,
    sidebarThreadItemsByKey,
  ]);
  const reorderVisibleProjectlessThreads = useCallback(async ({
    visibleThreadKeys,
    nextVisibleThreadKeys,
  }: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => {
    const listRealThreadIds = (threadKeys: readonly string[]) => threadKeys.flatMap((threadKey) => {
      const threadId = getSidebarRealThreadId(threadKey);
      return threadId === null ? [] : [threadId];
    });
    const visibleThreadIds = listRealThreadIds(visibleThreadKeys);
    const nextVisibleThreadIds = listRealThreadIds(nextVisibleThreadKeys);
    if (
      visibleThreadIds.length !== visibleThreadKeys.length
      || nextVisibleThreadIds.length !== nextVisibleThreadKeys.length
    ) return;
    await onReorderChatsThreads({
      threadIdsInDisplayOrder: listRealThreadIds(projectlessThreadKeys),
      visibleThreadIds,
      nextVisibleThreadIds,
    });
  }, [
    getSidebarRealThreadId,
    onReorderChatsThreads,
    projectlessThreadKeys,
  ]);
  const activeThreadKey = useMemo(() => {
    if (activePendingClientThreadId) {
      for (const [key, item] of sidebarThreadItemsByKey) {
        if ((item.clientThreadId ?? item.threadId) === activePendingClientThreadId) return key;
      }
    }
    if (!activeSessionId) return null;
    const activeSession = sessionsById.get(activeSessionId);

    for (const [key, item] of sidebarThreadItemsByKey) {
      if (item.sessionId === activeSessionId) return key;
      if (activeSession?.thread && item.threadId === activeSession.thread.threadId) return key;
    }

    return activeSession ? `local:session:${activeSession.id}` : null;
  }, [activePendingClientThreadId, activeSessionId, sessionsById, sidebarThreadItemsByKey]);

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
        active={(item.clientThreadId ?? item.threadId) === activePendingClientThreadId
          || Boolean(sessionId && activeSessionId === sessionId)}
        contextMenuOpen={Boolean(sessionId && contextMenuSessionId === sessionId)}
        hoverCardProjectLabel={hoverCardProjectLabel}
        onSelect={() => {
          void onSelectSidebarThread(item);
        }}
        onPreview={() => onPreviewSidebarThread?.(item)}
        onOpenContextMenu={session && onOpenSessionContextMenu
          ? (_item, event) => onOpenSessionContextMenu(session, event)
          : undefined}
        onRenameFromTitleDoubleClick={session && onSessionTitleDoubleClick
          ? (_item, event) => onSessionTitleDoubleClick(session, event)
          : item.kind === "pending-worktree" && onPendingWorktreeTitleDoubleClick
            ? (_item, event) => onPendingWorktreeTitleDoubleClick(item, event)
            : undefined}
        archivePending={sidebarArchivePendingKeys.has(item.key)}
        onArchive={onArchiveSidebarThread}
        onTogglePinned={session && onToggleSessionPinned
          ? () => onToggleSessionPinned(session)
          : onToggleSidebarThreadPinned}
      />
    );
  }, [
    activeSessionId,
    activePendingClientThreadId,
    contextMenuSessionId,
    onOpenSessionContextMenu,
    onArchiveSidebarThread,
    onSelectSidebarThread,
    onPreviewSidebarThread,
    onSessionTitleDoubleClick,
    onPendingWorktreeTitleDoubleClick,
    onToggleSessionPinned,
    onToggleSidebarThreadPinned,
    projectLabelById,
    resolveSessionForItem,
    sidebarArchivePendingKeys,
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
      suppressedKeys={sidebarArchivePendingKeys}
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
  ), [loadingSessions, renderThreadRow, sidebarArchivePendingKeys]);

  const renderProjectGroupRows = (
    groups: typeof projectGroups,
    options: {
      reorderScope: "projects" | "pinned";
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
      {(pagination, pager) => {
        const visibleGroupIds = pagination.visibleItems.map((group) => group.project.id);
        return (
          <SidebarProjectGroupRowsContent
            visibleItems={pagination.visibleItems}
            pager={pager}
            emptyText={options.emptyText ?? "No projects"}
            loading={loadingSessions}
            reorderGroups={(nextVisibleGroupIds) => {
              if (options.reorderScope === "pinned") {
                return reorderVisiblePinnedProjectGroups(visibleGroupIds, nextVisibleGroupIds);
              }
              return reorderVisibleProjectGroups(visibleGroupIds, nextVisibleGroupIds);
            }}
            renderProjectGroup={({
              project,
              pinnedThreadKeys,
              threadKeys,
            }, groupDndController) => {
              const expanded = expandedProjectIds.has(project.id);
              const threadListExpanded = expandedProjectThreadListIds.has(project.id);
              return (
                <CodexProjectRow
                  key={project.id}
                  project={project}
                  active={activeSessionId === null && activeProjectId === project.id}
                  expanded={expanded}
                  groupDndController={groupDndController}
                  allowProjectReorder
                  onActivate={() => onToggleProjectExpanded(project.id)}
                  onSelectProject={() => onSelectProject(project.id)}
                  onStartNewChat={() => void onStartNewChatInProject(project.id)}
                  onUpdateProject={onUpdateProject}
                  onDeleteProject={onDeleteProject}
                  onSetProjectPinned={onSetProjectPinned}
                  onCreateStableWorktree={onCreateStableWorktree}
                  stableWorktreeWorkspaceRootOptions={stableWorktreeWorkspaceRootOptions}
                  stableWorktreeWorkspaceRootLabels={stableWorktreeWorkspaceRootLabels}
                >
                  <SidebarProjectThreadRowsContent
                    project={project}
                    pinnedThreadKeys={pinnedThreadKeys}
                    sortablePinnedThreadKeys={pinnedThreadKeys.filter((threadKey) => (
                      model.threadItemsByKey.has(threadKey)
                      && !sidebarArchivePendingKeys.has(threadKey)
                    ))}
                    threadKeys={threadKeys}
                    expanded={threadListExpanded}
                    onExpandedChange={(nextExpanded) => {
                      setProjectThreadListExpanded(project.id, nextExpanded);
                    }}
                    forcedVisibleKey={activeThreadKey}
                    suppressedKeys={sidebarArchivePendingKeys}
                    loading={loadingSessions}
                    onPinnedThreadOrderChange={reorderVisiblePinnedThreads}
                    onProjectThreadOrderChange={onReorderProjectThreads}
                    getThreadId={getSidebarRealThreadId}
                    itemsByKey={sidebarThreadItemsByKey}
                    renderThread={(threadKey) => renderThreadRow(threadKey, {
                      hoverCardProjectLabel: project.name,
                    })}
                  />
                </CodexProjectRow>
              );
            }}
          />
        );
      }}
    </CodexSidebarPaginatedItems>
  );

  const renderPinnedSection = () => {
    if (
      !hasVisiblePinnedSectionItems
      && !pinnedDropTarget.projectDragActive
      && !pinnedDropTarget.isExternalThreadDropTarget
    ) {
      return null;
    }

    if (!hasVisiblePinnedSectionItems) {
      return (
        <div
          ref={pinnedDropTarget.setNodeRef}
          className={cn(
            "-my-4 px-row-x",
            pinnedDropTarget.projectDragActive
              && pinnedDropTarget.isOver
              && "rounded-[10px] bg-token-bg-secondary/40 ring-1 ring-inset ring-token-border",
            pinnedDropTarget.isExternalThreadDropTarget
              && pinnedDropTarget.isOver
              && "rounded-[10px] bg-token-bg-secondary/40",
          )}
        >
          <div className="h-4">
            {pinnedDropTarget.projectDragActive && pinnedDropTarget.isOver
              ? <SidebarDropIndicator compensateLayout={false} />
              : null}
          </div>
        </div>
      );
    }

    return (
      <div
        ref={pinnedDropTarget.setNodeRef}
        className={cn(
          "relative",
          pinnedDropTarget.isExternalThreadDropTarget
            && pinnedDropTarget.isOver
            && "rounded-lg bg-token-list-hover-background",
        )}
      >
        <CodexSidebarSection
          heading="Pinned"
          collapsed={pinnedThreadsSectionCollapsed}
          onToggle={onTogglePinnedThreadsSectionCollapsed}
        >
          {sortablePinnedStandaloneThreadKeys.length > 0 ? (
            <SidebarPinnedThreadRowsContent
              containerId="pinned"
              getThreadId={getSidebarRealThreadId}
              visibleThreadKeys={sortablePinnedStandaloneThreadKeys}
              itemsByKey={sidebarThreadItemsByKey}
              ariaLabel="Pinned chats"
              onVisibleThreadOrderChange={reorderVisiblePinnedThreads}
              renderThread={renderThreadRow}
            />
          ) : null}
          {fallbackPinnedStandaloneThreadKeys.length > 0
            ? renderThreadList(fallbackPinnedStandaloneThreadKeys, "No pinned chats", {
                ariaLabel: "Pinned local views",
              })
            : null}
          {pinnedProjectGroups.length > 0
            ? renderProjectGroupRows(pinnedProjectGroups, {
              reorderScope: "pinned",
              expanded: pinnedProjectsExpanded,
              onExpandedChange: setPinnedProjectsExpanded,
            })
            : null}
        </CodexSidebarSection>
      </div>
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
          />
        )}
      >
        <StableWorktreeSidebarRows
          entries={pendingStableWorktrees}
          onOpen={onOpenStableWorktree}
        />
        {renderProjectGroupRows(unpinnedProjectGroups, {
          reorderScope: "projects",
          expanded: projectsExpanded,
          onExpandedChange: setProjectsExpanded,
        })}
      </CodexSidebarSection>
      <CodexSidebarSection
        heading="Chats"
        collapsed={chatsSectionCollapsed}
        onToggle={onToggleChatsSectionCollapsed}
      >
        <SidebarThreadContainerRowsContent
          containerId="chats"
          threadKeys={projectlessThreadKeys}
          getThreadId={getSidebarRealThreadId}
          itemsByKey={sidebarThreadItemsByKey}
          expanded={projectlessThreadListExpanded}
          onExpandedChange={setProjectlessThreadListExpanded}
          forcedVisibleKey={activeThreadKey}
          suppressedKeys={sidebarArchivePendingKeys}
          loading={loadingSessions}
          onVisibleThreadOrderChange={reorderVisibleProjectlessThreads}
          renderThread={renderThreadRow}
        />
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
  activePendingClientThreadId,
  contextMenuSessionId,
  sessionsByProject,
  projectlessSessions,
  sidebarThreadModel,
  pendingStableWorktrees,
  expandedProjectIds,
  pinnedProjectsSectionCollapsed,
  projectsSectionCollapsed,
  chatsSectionCollapsed,
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
  onToggleChatsSectionCollapsed,
  onToggleProjectExpanded,
  onSelectProject,
  onSelectSidebarThread,
  onPreviewSidebarThread,
  onOpenSessionContextMenu,
  onSessionTitleDoubleClick,
  onPendingWorktreeTitleDoubleClick,
  onArchiveSidebarThread,
  onToggleSessionPinned,
  onToggleSidebarThreadPinned,
  onStartNewChatInProject,
  onOpenStableWorktree,
  onCreateStableWorktree,
  onOpenCommandPalette,
  onShowUnavailableProduct,
  onOpenAutomations,
  automationsActive,
  projectPickerOpenTick = 0,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onReorderProjects,
  onSetProjectPinned,
  onSetPinnedProjectOrder,
  onReorderProjectThreads,
  onReorderChatsThreads,
  onMoveSidebarThread,
  onReorderPinnedThreads,
  onOpenSettings,
  account,
  connection,
  onRefreshAccount,
  onStartChatGptLogin,
  onStartApiKeyLogin,
  onCancelLogin,
  onLogout,
  onAccountErrorMessage,
  sidebarArchivePendingKeys,
}: {
  floating?: boolean;
  header?: ReactNode;
  spaces: SpaceRef[];
  activeProjectId: string;
  activeSessionId: string | null;
  activePendingClientThreadId?: string | null;
  contextMenuSessionId?: string | null;
  sessionsByProject: Record<string, ProjectSession[]>;
  projectlessSessions: ProjectSession[];
  sidebarThreadModel: CodexSidebarThreadSyncModel;
  pendingStableWorktrees: readonly StableWorktreeEntry[];
  expandedProjectIds: Set<string>;
  pinnedProjectsSectionCollapsed: boolean;
  projectsSectionCollapsed: boolean;
  chatsSectionCollapsed: boolean;
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
  onToggleChatsSectionCollapsed: () => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSidebarThread: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onPreviewSidebarThread?: (item: CodexSidebarThreadItem) => void;
  onOpenSessionContextMenu?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onSessionTitleDoubleClick?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onPendingWorktreeTitleDoubleClick?: (
    item: CodexSidebarThreadItem,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onArchiveSidebarThread?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onToggleSessionPinned?: (session: ProjectSession) => void | Promise<void>;
  onToggleSidebarThreadPinned?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onStartNewChatInProject: (projectId: string) => void | Promise<void>;
  onOpenStableWorktree: (pendingWorktreeId: string) => void;
  onCreateStableWorktree: (project: Project, projectName: string) => Promise<void>;
  onOpenCommandPalette: () => void;
  onShowUnavailableProduct: (label: string) => void;
  onOpenAutomations: () => void;
  automationsActive: boolean;
  projectPickerOpenTick?: number;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onReorderProjects: (input: ProjectOrderInput) => Promise<Project[]>;
  onSetProjectPinned: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onSetPinnedProjectOrder: (input: ProjectPinnedOrderInput) => Promise<Project[]>;
  onReorderProjectThreads: (projectId: string, orderedThreadIds: string[]) => Promise<void>;
  onReorderChatsThreads: (input: CodexSidebarChatsThreadOrderInput) => Promise<void>;
  onMoveSidebarThread: (drop: SidebarThreadDropRequest) => Promise<void>;
  onReorderPinnedThreads: (orderedThreadIds: readonly string[]) => Promise<unknown>;
  onOpenSettings: () => void;
  account: CodexAccountSnapshot | null;
  connection: CodexConnectionState;
  onRefreshAccount: () => Promise<CodexAccountSnapshot>;
  onStartChatGptLogin: ReturnType<typeof useCodexAccountActions>["startChatGptLogin"];
  onStartApiKeyLogin: ReturnType<typeof useCodexAccountActions>["startApiKeyLogin"];
  onCancelLogin: ReturnType<typeof useCodexAccountActions>["cancelLogin"];
  onLogout: () => Promise<void>;
  onAccountErrorMessage: (message: string | null) => void;
  sidebarArchivePendingKeys: ReadonlySet<string>;
}) {
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [scrolledContentUnderHeader, setScrolledContentUnderHeader] = useState(false);
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
  const sidebarThreadIdByKey = useMemo(() => {
    const entries: Array<readonly [string, string]> = [];
    for (const [threadKey, item] of sidebarThreadModel.threadItemsByKey) {
      if (item.pendingWorktreeId) continue;
      entries.push([threadKey, item.threadId]);
    }
    for (const session of [...Object.values(sessionsByProject).flat(), ...projectlessSessions]) {
      if (!session.thread) continue;
      entries.push([`local:session:${session.id}`, session.thread.threadId]);
    }
    return new Map(entries);
  }, [projectlessSessions, sessionsByProject, sidebarThreadModel.threadItemsByKey]);
  const knownSidebarProjectIds = useMemo(
    () => new Set(sidebarThreadModel.projectGroups.map((group) => group.project.id)),
    [sidebarThreadModel.projectGroups],
  );
  const homeContainerIdByThreadId = useMemo(() => {
    const entries: Array<readonly [string, string]> = [];
    for (const item of sidebarThreadModel.threadItemsByKey.values()) {
      if (item.pendingWorktreeId) continue;
      const containerId = resolveCodexSidebarThreadHomeContainerId({
        kind: item.kind,
        pinned: item.pinned,
        projectId: item.projectId,
        projectless: item.projectless,
        knownProjectIds: knownSidebarProjectIds,
      });
      if (containerId) entries.push([item.threadId, containerId]);
    }
    for (const session of [...Object.values(sessionsByProject).flat(), ...projectlessSessions]) {
      if (!session.thread) continue;
      const containerId = resolveCodexSidebarThreadHomeContainerId({
        kind: "local",
        pinned: session.pinned,
        projectId: session.projectId,
        projectless: session.projectId === null,
        knownProjectIds: knownSidebarProjectIds,
      });
      if (containerId === null) continue;
      entries.push([
        session.thread.threadId,
        containerId,
      ]);
    }
    return new Map(entries);
  }, [
    knownSidebarProjectIds,
    projectlessSessions,
    sessionsByProject,
    sidebarThreadModel.threadItemsByKey,
  ]);
  const getSidebarThreadIdByKey = useCallback(
    (threadKey: string) => sidebarThreadIdByKey.get(threadKey) ?? null,
    [sidebarThreadIdByKey],
  );

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
        <div
          className="flex h-full min-h-0 flex-col overflow-hidden [--height-token-nav-row:30px] [--padding-row-cell-x:8px] [--padding-row-x:8px] [--radius-token-row:10px]"
          style={getSidebarScrollChromeStyle(scrolledContentUnderHeader)}
        >
          <nav
            className="sidebar-foreground-muted flex min-h-0 flex-1 flex-col"
            role="navigation"
            aria-label="Automation folders"
          >
            <SidebarExpandedHeader
              productName="Nodex"
              searchShortcutLabel={resolveCodexCardSearchShortcutLabel()}
              newChatShortcutLabel={resolveCodexNewChatShortcutLabel()}
              scrolledContentUnderHeader={scrolledContentUnderHeader}
              onSearch={onOpenCommandPalette}
              onNewChat={() => void onStartNewChatInProject(activeProjectId)}
            />

            <div
              data-app-action-sidebar-scroll=""
              className={SIDEBAR_SCROLL_AREA_CLASS}
              onScroll={(event) => {
                setScrolledContentUnderHeader(event.currentTarget.scrollTop > 0);
              }}
            >
              <div className="flex shrink-0 flex-col gap-2" data-app-action-sidebar-scroll-top-actions="">
                <div className="shrink-0 px-row-x">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-col gap-px">
                      <CodexSidebarTopActionButton
                        label="Scheduled"
                        icon={<CodexAutomationsIcon />}
                        active={automationsActive}
                        onClick={() => onOpenAutomations()}
                      />
                      <CodexSidebarTopActionButton
                        label="Plugins"
                        icon={<ComposerPluginsIcon className="icon-xs" />}
                        onClick={() => onShowUnavailableProduct("Plugins")}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <SidebarReorderDndProvider
                getThreadIdByThreadKey={getSidebarThreadIdByKey}
                homeContainerIdByThreadId={homeContainerIdByThreadId}
                onProjectError={reportSidebarProjectReorderError}
                onProjectDrop={handleProjectDrop}
                onThreadError={reportSidebarThreadReorderError}
                onThreadDrop={onMoveSidebarThread}
              >
                <SidebarThreadOrganizerSections
                  activeProjectId={activeProjectId}
                  activeSessionId={activeSessionId}
                  activePendingClientThreadId={activePendingClientThreadId}
                  contextMenuSessionId={contextMenuSessionId}
                  sessionsByProject={sessionsByProject}
                  projectlessSessions={projectlessSessions}
                  expandedProjectIds={expandedProjectIds}
                  pinnedThreadsSectionCollapsed={pinnedProjectsSectionCollapsed}
                  projectsSectionCollapsed={projectsSectionCollapsed}
                  chatsSectionCollapsed={chatsSectionCollapsed}
                  loadingSessions={loadingSessions}
                  model={sidebarThreadModel}
                  onTogglePinnedThreadsSectionCollapsed={onTogglePinnedProjectsSectionCollapsed}
                  onToggleProjectsSectionCollapsed={onToggleProjectsSectionCollapsed}
                  onToggleChatsSectionCollapsed={onToggleChatsSectionCollapsed}
                  onToggleProjectExpanded={onToggleProjectExpanded}
                  onSelectProject={onSelectProject}
                  onSelectSidebarThread={onSelectSidebarThread}
                  onPreviewSidebarThread={onPreviewSidebarThread}
                  onOpenSessionContextMenu={onOpenSessionContextMenu}
                  onSessionTitleDoubleClick={onSessionTitleDoubleClick}
                  onPendingWorktreeTitleDoubleClick={onPendingWorktreeTitleDoubleClick}
                  onArchiveSidebarThread={onArchiveSidebarThread}
                  onToggleSessionPinned={onToggleSessionPinned}
                  onToggleSidebarThreadPinned={onToggleSidebarThreadPinned}
                  onStartNewChatInProject={onStartNewChatInProject}
                  pendingStableWorktrees={pendingStableWorktrees}
                  onOpenStableWorktree={onOpenStableWorktree}
                  onCreateStableWorktree={onCreateStableWorktree}
                  projectPickerOpenTick={projectPickerOpenTick}
                  onCreateProject={onCreateProject}
                  onUpdateProject={onUpdateProject}
                  onDeleteProject={onDeleteProject}
                  onReorderProjects={onReorderProjects}
                  onSetProjectPinned={onSetProjectPinned}
                  onSetPinnedProjectOrder={onSetPinnedProjectOrder}
                  onReorderProjectThreads={onReorderProjectThreads}
                  onReorderChatsThreads={onReorderChatsThreads}
                  onReorderPinnedThreads={onReorderPinnedThreads}
                  sidebarArchivePendingKeys={sidebarArchivePendingKeys}
                />
              </SidebarReorderDndProvider>
            </div>

            <LeftSidebarFooter
              onOpenSettings={onOpenSettings}
              account={account}
              connection={connection}
              onRefreshAccount={onRefreshAccount}
              onStartChatGptLogin={onStartChatGptLogin}
              onStartApiKeyLogin={onStartApiKeyLogin}
              onCancelLogin={onCancelLogin}
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
  threadViewportActive,
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
  threadViewportActive: boolean;
  onRefreshProjectSessions: (projectId: string) => Promise<ProjectSession[]>;
  onEnsureBlankSessionForProject: (projectId: string) => Promise<ProjectSession>;
  onOpenPendingWorktree: (clientThreadId: string) => void;
  newThreadComposerIntent?: CodexComposerIntent | null;
  onConsumeNewThreadComposerIntent?: ThreadStageActions["onConsumeNewThreadComposerIntent"];
  onRequestProjectPickerOpen: () => void;
  onOpenLocalEnvironmentsSettings: () => void;
  onOpenHooksSettings: NonNullable<ThreadStageActions["onOpenHooksSettings"]>;
  threadQueueFollowUpsEnabled: boolean;
  composerEnterBehavior: ComposerEnterBehavior;
  onQueueingEnabledChange: ThreadStageActions["onQueueingEnabledChange"];
  onOpenThread: ThreadStageActions["onOpenThread"];
  onOpenTurnDiffReview: ThreadStageActions["onOpenTurnDiffReview"];
  onOpenTurnDiffFileInSidePanel: NonNullable<ThreadStageActions["onOpenTurnDiffFileInSidePanel"]>;
  onOpenSummaryGitReview: NonNullable<ThreadStageActions["onOpenSummaryGitReview"]>;
  turnDiffHoverPreviewDisabled: boolean;
  onForkSessionFromTurn: NonNullable<ThreadActionControllerInput["onForkSessionFromTurn"]>;
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
  summaryScheduledAutomation: ThreadSummaryPanelScheduledAutomationRow | null;
  summaryComputerUsePip: ThreadSummaryPanelComputerUsePipState | null;
  onOpenSummarySideChatRow: NonNullable<ThreadStageActions["onOpenSummarySideChatRow"]>;
  onOpenSummaryBrowserRow: NonNullable<ThreadStageActions["onOpenSummaryBrowserRow"]>;
  onOpenSummaryScheduledAutomation: NonNullable<ThreadStageActions["onOpenSummaryScheduledAutomation"]>;
  onOpenSummaryOutputInSidePanel: NonNullable<ThreadStageActions["onOpenSummaryOutputInSidePanel"]>;
  onOpenProcessManager?: ThreadStageActions["onOpenProcessManager"];
  onOpenBackgroundTerminalOutput?: ThreadStageActions["onOpenBackgroundTerminalOutput"];
  onToggleSummaryComputerUsePip: NonNullable<ThreadStageActions["onToggleSummaryComputerUsePip"]>;
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
  const [canForkCurrentThreadIntoWorktree, setCanForkCurrentThreadIntoWorktree] = useState(false);
  const selectedNewThreadProject = projects.find((candidate) => candidate.id === selectedNewThreadProjectId) ?? project ?? null;
  const startInSelectorProject = summary ? project : selectedNewThreadProject;
  const newThreadEnvironmentWorkspaceRoot = projectWorkspaceRootOrNull(startInSelectorProject);
  const effectiveProjectId = summary ? projectId : selectedNewThreadProject?.id ?? projectId;
  const codexControl = useCodexAppServerControl(effectiveProjectId);
  const loadModels = codexControl.loadModels;
  const listCollaborationModes = codexControl.listCollaborationModes;
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
    setNewThreadEnvironmentsLoading(true);
    try {
      const options = await invoke("worktrees:environments:list", effectiveProjectId) as WorktreeEnvironmentOption[];
      setNewThreadEnvironmentOptions(options);
      setSelectedNewThreadEnvironmentPath(resolveLocalEnvironmentOptionSelection({
        options,
        selectionsByWorkspace: readLocalEnvironmentSelections(),
        workspaceRoot: newThreadEnvironmentWorkspaceRoot,
      }));
    } catch {
      setNewThreadEnvironmentOptions([]);
    } finally {
      setNewThreadEnvironmentsLoading(false);
    }
  }, [effectiveProjectId, newThreadEnvironmentWorkspaceRoot]);

  const changeNewThreadEnvironment = useCallback((configPath: string | null) => {
    setSelectedNewThreadEnvironmentPath(configPath);
    if (!newThreadEnvironmentWorkspaceRoot) return;
    writeLocalEnvironmentSelection({
      workspaceRoot: newThreadEnvironmentWorkspaceRoot,
      configPath,
    });
  }, [newThreadEnvironmentWorkspaceRoot]);

  useEffect(() => {
    if (selectedNewThreadRunInTarget !== "newWorktree") return;
    void refreshNewThreadEnvironments();
  }, [refreshNewThreadEnvironments, selectedNewThreadRunInTarget]);

  const startInSelectorModel = useMemo<NewChatStartInSelectorModel>(() => ({
    target: {
      runInTarget: selectedNewThreadRunInTarget,
      runInEnvironmentPath: selectedNewThreadEnvironmentPath,
      worktreeStartMode,
      worktreeBranchPrefix,
    },
    disabled: false,
    worktreeAvailable: Boolean(normalizeProjectPrimaryWorkspaceRoot(startInSelectorProject)),
    environments: newThreadEnvironmentOptions,
    environmentsLoading: newThreadEnvironmentsLoading,
    selectedEnvironmentPath: selectedNewThreadEnvironmentPath,
    worktreeStartMode,
    worktreeBranchPrefix,
  }), [
    newThreadEnvironmentOptions,
    newThreadEnvironmentsLoading,
    selectedNewThreadEnvironmentPath,
    selectedNewThreadRunInTarget,
    startInSelectorProject,
    worktreeBranchPrefix,
    worktreeStartMode,
  ]);

  const actions = useMemo<ThreadStageActions>(() => ({
    ...createThreadStageActions({
      activeThreadId: summary?.threadId ?? null,
      codexControl,
      onEnsureBlankSessionForProject,
      onRefreshProjectSessions,
      onOpenPendingWorktree,
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
      onNewThreadStartInEnvironmentChange: changeNewThreadEnvironment,
      onRefreshNewThreadStartInEnvironments: refreshNewThreadEnvironments,
      onOpenNewThreadLocalEnvironmentsSettings: onOpenLocalEnvironmentsSettings,
      onOpenHooksSettings,
      onOpenSideChat: async (input) => {
        await onOpenSideChat({
          ...input,
          collaborationMode: selectedCollaborationMode,
        });
      },
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
      selectedCollaborationMode,
      setSelectedCollaborationMode,
    }),
    ...(onConsumeNewThreadComposerIntent ? { onConsumeNewThreadComposerIntent } : {}),
  }), [
    codexControl,
    onEnsureBlankSessionForProject,
    onRefreshProjectSessions,
    onOpenPendingWorktree,
    onQueueingEnabledChange,
    onOpenThread,
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
    projectId,
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
        newThreadStartInSelector={startInSelectorModel}
        newThreadComposerIntent={summary ? null : newThreadComposerIntent ?? null}
        threadStartProgress={threadStartProgress}
        activeThreadId={summary?.threadId ?? null}
        activeThreadSummary={summary}
        availableModels={codexControl.availableModels}
        collaborationModes={collaborationModes}
        selectedCollaborationMode={selectedCollaborationMode}
        selectedModel={codexControl.threadSettings.model ?? ""}
        selectedReasoningEffort={codexControl.threadSettings.reasoningEffort ?? "medium"}
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
        rightPanelComposerOverlayEnabled={rightPanelComposerOverlayEnabled}
        rightPanelComposerOverlayTarget={rightPanelComposerOverlayTarget}
        turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
        threadViewportActive={threadViewportActive}
        actions={actions}
        onForkFromTurnIntoWorktree={canForkCurrentThreadIntoWorktree
          ? onForkFromTurnIntoWorktree
          : undefined}
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
    managedWorktreePath: thread.managedWorktreePath ?? null,
    projectlessOutputDirectory: thread.projectlessOutputDirectory ?? null,
    projectlessWorkspaceBrowserRoot: thread.projectlessWorkspaceBrowserRoot ?? null,
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

function useProcessOutputTerminalSnapshot(sessionId: string | null): TerminalSessionSnapshot | null {
  const [snapshot, setSnapshot] = useState<TerminalSessionSnapshot | null>(() =>
    sessionId ? terminalSessionStore.getSnapshot(sessionId) : null
  );

  useEffect(() => {
    if (!sessionId) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    terminalSessionStore.ensureEventSubscriptions();
    setSnapshot(terminalSessionStore.getSnapshot(sessionId));
    void terminalSessionStore.fetchSnapshot(sessionId)
      .then((nextSnapshot) => {
        if (!cancelled && nextSnapshot) {
          setSnapshot(nextSnapshot);
        }
      });

    const unsubscribe = terminalSessionStore.subscribe(sessionId, (event) => {
      if (cancelled) return;
      if (event.type === "init-log" || event.type === "attached") {
        setSnapshot(event.snapshot);
        return;
      }
      if (event.type === "exit") {
        setSnapshot((current) => current
          ? { ...current, exited: true, exitCode: event.exitCode }
          : terminalSessionStore.getSnapshot(sessionId)
        );
        return;
      }
      setSnapshot(terminalSessionStore.getSnapshot(sessionId));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sessionId]);

  return snapshot;
}

function ProcessOutputPanelTabView({ tab }: { tab: ProcessOutputPanelTab }) {
  const conversation = useConversation(tab.threadId);
  const terminalSnapshot = useProcessOutputTerminalSnapshot(tab.terminalSessionId);
  const item = findProcessOutputCommandItem(conversation, tab.itemId, tab.turnId);
  const command = item?.command ?? tab.command;
  const cwd = terminalSnapshot?.cwd ?? item?.cwd ?? tab.cwd;
  const output = terminalSnapshot ? terminalSnapshot.buffer : item?.aggregatedOutput ?? "";
  const displayCommand = command.trim() || "Background terminal";
  const displayOutput = output.trimEnd();

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-token-main-surface-primary"
      data-process-output-panel-tab={tab.id}
      data-thread-id={tab.threadId}
      data-item-id={tab.itemId}
    >
      <div className="flex min-h-14 shrink-0 flex-col justify-center border-b border-token-border px-3 py-2">
        <div className="truncate font-mono text-xs text-token-foreground" title={displayCommand}>
          {displayCommand}
        </div>
        {cwd ? (
          <div className="mt-1 truncate text-xs text-token-description-foreground" title={cwd}>
            {cwd}
          </div>
        ) : null}
      </div>
      {displayOutput ? (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-token-foreground">
          {displayOutput}
        </pre>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-token-description-foreground">
          No output yet
        </div>
      )}
    </div>
  );
}

function BackgroundAgentSessionTab({
  tab,
  activeSession,
  projects,
  onRefreshSessions,
  onOpenMcpAppSidePanel,
  onOpenHooksSettings,
  threadQueueFollowUpsEnabled,
  composerEnterBehavior,
  onQueueingEnabledChange,
  onOpenThread,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  turnDiffHoverPreviewDisabled,
}: {
  tab: BackgroundAgentPanelTab;
  activeSession: ProjectSession;
  projects: Project[];
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  onOpenMcpAppSidePanel: ThreadStageActions["onOpenMcpAppSidePanel"];
  onOpenHooksSettings: NonNullable<ThreadStageActions["onOpenHooksSettings"]>;
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
  const codexControl = useCodexAppServerControl(tab.projectId);
  const loadModels = codexControl.loadModels;
  const listCollaborationModes = codexControl.listCollaborationModes;
  const requestThreadStreamSnapshot = codexControl.requestThreadStreamSnapshot;
  const [collaborationModes, setCollaborationModes] = useState<CodexCollaborationModePreset[]>([]);
  const [selectedCollaborationMode, setSelectedCollaborationMode] = useState<CodexCollaborationModeKind>("default");

  useEffect(() => {
    void loadModels().catch(() => undefined);
    void listCollaborationModes()
      .then(setCollaborationModes)
      .catch(() => setCollaborationModes([]));
  }, [listCollaborationModes, loadModels]);

  useEffect(() => {
    void requestThreadStreamSnapshot(tab.threadId).catch(() => undefined);
  }, [requestThreadStreamSnapshot, tab.threadId]);

  const actions = useMemo(() => createThreadStageActions({
    activeThreadId: tab.threadId,
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
    onOpenHooksSettings,
    selectedCollaborationMode,
    setSelectedCollaborationMode,
  }), [
    activeSession,
    codexControl,
    onOpenMcpAppSidePanel,
    onOpenHooksSettings,
    onOpenThread,
    onOpenTurnDiffReview,
    onOpenTurnDiffFileInSidePanel,
    onQueueingEnabledChange,
    onRefreshSessions,
    selectedCollaborationMode,
    tab.projectId,
    tab.threadId,
  ]);

  if (!conversation) {
    return <BackgroundAgentLoadingPanel title={tab.title} />;
  }

  return (
    <div className="h-full min-h-0 bg-token-main-surface-primary" data-background-agent-side-panel-tab={tab.id}>
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
        backgroundAgentDetail={true}
        availableModels={codexControl.availableModels}
        collaborationModes={collaborationModes}
        selectedCollaborationMode={selectedCollaborationMode}
        selectedModel={codexControl.threadSettings.model ?? ""}
        selectedReasoningEffort={codexControl.threadSettings.reasoningEffort ?? "medium"}
        selectedPersonality={codexControl.personality}
        reasoningEffortOptions={codexControl.reasoningEffortOptions}
        permissionMode={codexControl.permissionMode}
        isQueueingEnabled={threadQueueFollowUpsEnabled}
        composerEnterBehavior={composerEnterBehavior}
        searchOpenTick={0}
        summaryPanelMounted={false}
        summaryPanelOpen={false}
        summaryPanelHideImmediately={false}
        summaryPanelContentShift={0}
        turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
        actions={actions}
      />
    </div>
  );
}

function BackgroundAgentLoadingPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary p-6 select-none">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center text-center">
        <div className="relative mb-3 flex size-10 items-center justify-center rounded-xl bg-token-bg-secondary text-token-text-secondary">
          <Bot className="icon-md opacity-40" />
          <SpinnerIcon className="icon-xs absolute animate-spin text-token-text-secondary" />
        </div>
        <div className="text-base font-semibold text-token-text-primary">{title}</div>
      </div>
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
  onOpenHooksSettings,
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
  onOpenHooksSettings: NonNullable<ThreadStageActions["onOpenHooksSettings"]>;
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
  const codexControl = useCodexAppServerControl(tab.projectId);
  const loadModels = codexControl.loadModels;
  const listCollaborationModes = codexControl.listCollaborationModes;
  const [collaborationModes, setCollaborationModes] = useState<CodexCollaborationModePreset[]>([]);
  const [selectedCollaborationMode, setSelectedCollaborationMode] = useState<CodexCollaborationModeKind>("default");

  useEffect(() => {
    if (tab.status !== "ready") return;
    void loadModels().catch(() => undefined);
    void listCollaborationModes()
      .then(setCollaborationModes)
      .catch(() => setCollaborationModes([]));
  }, [listCollaborationModes, loadModels, tab.status]);

  const actions = useMemo(() => createThreadStageActions({
    activeThreadId: tab.threadId,
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
    onOpenHooksSettings,
    selectedCollaborationMode,
    setSelectedCollaborationMode,
  }), [
    activeSession,
    codexControl,
    onOpenMcpAppSidePanel,
    onOpenHooksSettings,
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
        selectedPersonality={codexControl.personality}
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
  cardStageTabTitleStore,
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
  summaryGitReviewRequest,
  browserBoundsSyncTrigger,
  isActivePanelTab,
}: {
  tab: ProjectSessionTabPanelTab;
  activeSession: ProjectSession;
  projects: Project[];
  activeView: WorkbenchView;
  activeSearchQuery: string;
  activeDbViewPrefs: DbViewPrefs | null;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  activePanelCardStageCardIdsByProject: ReadonlyMap<string, ReadonlySet<string>>;
  cardStageTabTitleStore: CardStageTabTitleStore;
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
  onOpenFileTab: (input: { path: string; title: string; panelId: PanelId }) => Promise<unknown>;
  onEnsureBlankSessionForProject: (
    projectId: string,
    options?: { select?: boolean },
  ) => Promise<ProjectSession>;
  onRefreshSessions: (projectId: string | null) => Promise<ProjectSession[]>;
  onCloseTab: (tabId: string) => Promise<void>;
  onCreateTerminalTab: (panelId: PanelId, leafId: string) => Promise<void> | void;
  onOpenThread: (threadId: string) => Promise<void>;
  cardStageHistoryModal: CardStageHistoryModalContext | null;
  onToggleCardStageHistoryModal: (context: CardStageHistoryModalContext) => void;
  selectedTurnDiffReviewTarget: CodexTurnDiffReviewTarget | null;
  summaryGitReviewRequest: {
    source: GitReviewSource;
    key: number;
  } | null;
  browserBoundsSyncTrigger?: MotionValue<number>;
  isActivePanelTab: boolean;
}) {
  if (tab.kind === "db_view" && "view" in tab.config) {
    return (
      <DbViewSessionTab
        sessionId={activeSession.id}
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
        titleStore={cardStageTabTitleStore}
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
        onOpenCardTab={onOpenCardTab}
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
        initialGitSource={summaryGitReviewRequest?.source ?? null}
        initialGitSourceRequestKey={summaryGitReviewRequest?.key ?? null}
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
  sessionId,
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
  sessionId: string;
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
  const projectId = config.projectId;
  if (projectId === null) {
    throw new Error("Database view tabs require a project");
  }
  const databaseViewId = "databaseViewId" in config && typeof config.databaseViewId === "string"
    ? config.databaseViewId.trim()
    : "";
  const selectedDatabaseViewId = databaseViewId || `missing-database-view:${tab.id}`;
  const view = isProjectSessionDbView(config.view) ? config.view : activeView;
  const legacyRulesView = viewSupportsDbViewPrefs(view) ? view : null;
  const legacyDbViewPrefs = legacyRulesView
    ? dbViewPrefsByProject[projectId]?.[legacyRulesView]
      ?? (projectId === tab.projectId && view === activeView ? activeDbViewPrefs : null)
      ?? getDefaultDbViewPrefs(legacyRulesView)
    : null;
  const selectedDatabaseView = useKanban({
    projectId,
    databaseViewId: selectedDatabaseViewId,
    sessionId: `${tab.id}:toolbar`,
  });
  const activeProjectBoard = selectedDatabaseView.board;
  const databaseView = selectedDatabaseView.databaseView;
  const selectedGeneralView = Boolean(
    databaseView && !databaseView.primaryWriteCompatible,
  );
  const renderedView: ProjectSessionDbView = selectedGeneralView && databaseView
    ? databaseView.query.view.kind
    : view;
  const rulesView = selectedGeneralView ? null : legacyRulesView;
  const dbViewPrefs = selectedGeneralView ? null : legacyDbViewPrefs;
  const [calendarState, setCalendarState] = useState<CalendarViewState>(() => loadCalendarViewState());
  const [calendarCreateRequestId, setCalendarCreateRequestId] = useState(0);
  const [taskSearchOpen, setTaskSearchOpen] = useState(false);
  const [databaseManagerOpen, setDatabaseManagerOpen] = useState(false);
  const calendarVisibleDays = useMemo(() => resolveCalendarVisibleDays(calendarState), [calendarState]);
  const calendarDayCount = resolveCalendarVisibleDayCount(calendarState.range);
  const scrollStateKey = renderedView === "calendar"
    ? `db-view:${sessionId}:${tab.id}:${projectId}:${selectedDatabaseViewId}:${renderedView}:${calendarState.range}`
    : `db-view:${sessionId}:${tab.id}:${projectId}:${selectedDatabaseViewId}:${renderedView}`;
  const taskSearchInputRef = useRef<HTMLInputElement | null>(null);
  const lastHandledTaskSearchOpenTickRef = useRef(taskSearchOpenTick);
  const searchQuery = searchByProject[projectId] ?? (projectId === tab.projectId ? activeSearchQuery : "");
  const activePanelCardStageCardIds = activePanelCardStageCardIdsByProject.get(projectId);
  const availableTags = useMemo(() => {
    if (databaseView) {
      return Array.from(
        new Set(databaseView.columns.flatMap((column) =>
          column.rows.flatMap((row) => row.tags))),
      ).sort((left, right) => left.localeCompare(right));
    }
    if (!activeProjectBoard) return [];
    return Array.from(
      new Set(activeProjectBoard.columns.flatMap((column) => column.cards.flatMap((card) => card.tags))),
    ).sort((left, right) => left.localeCompare(right));
  }, [activeProjectBoard, databaseView]);

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
    if (selectedGeneralView) return;
    await invoke("project-session-tabs:update", tab.id, {
      config: {
        projectId,
        databaseViewId: selectedDatabaseViewId,
        view: nextView,
      },
      title: DB_VIEW_TABS.find((item) => item.id === nextView)?.label ?? "DB View",
    });
    await onRefreshSessions(projectId);
  };

  const availableToolbarItems = selectedGeneralView
    ? DB_VIEW_TABS.filter((item) => item.id === renderedView)
    : DB_VIEW_TABS;
  const toolbarItems = availableToolbarItems.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    active: item.id === renderedView,
    onSelect: () => {
      void selectView(item.id);
    },
  }));
  const calendarToolbarControls = !selectedGeneralView && renderedView === "calendar" ? (
    <CalendarToolbarControls
      range={calendarState.range}
      onRangeChange={handleCalendarRangeChange}
      onCreate={handleCalendarCreate}
      onToday={handleCalendarToday}
      onPrev={handleCalendarPrev}
      onNext={handleCalendarNext}
    />
  ) : null;
  const calendarToolbarContextLabel = !selectedGeneralView && renderedView === "calendar" ? (
    <CalendarToolbarMonthLabel visibleDays={calendarVisibleDays} />
  ) : null;
  const updateDbViewPrefs = rulesView
    ? (update: (prev: DbViewPrefs) => DbViewPrefs) => setDbViewPrefs(projectId, rulesView, update)
    : null;
  const searchShortcutLabel =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC") ? "⌘F" : "Ctrl+F";

  if (!databaseViewId) {
    return (
      <div className="flex h-full items-center justify-center bg-token-main-surface-primary px-6 text-sm text-token-text-secondary">
        This Database tab has no durable View identity. Reopen it from the View picker.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-token-main-surface-primary">
      <DbViewToolbar
        items={toolbarItems}
        activeSearchQuery={searchQuery}
        taskSearchOpen={taskSearchOpen}
        showSearchControls={selectedGeneralView || renderedView !== "calendar"}
        searchShortcutLabel={searchShortcutLabel}
        taskSearchInputRef={taskSearchInputRef}
        rulesView={rulesView}
        dbViewPrefs={dbViewPrefs}
        availableTags={availableTags}
        viewContextLabel={calendarToolbarContextLabel}
        calendarControls={calendarToolbarControls}
        managementControl={(
          <NodexIconButton
            icon={Database}
            size="sm"
            active={databaseManagerOpen}
            ariaLabel="Manage Databases"
            title="Manage Databases"
            onClick={() => setDatabaseManagerOpen(true)}
          />
        )}
        onUpdateDbViewPrefs={updateDbViewPrefs}
        onSearchQueryChange={(value) => setSearchQuery(projectId, value)}
        onOpenTaskSearch={openTaskSearch}
        onCloseTaskSearch={closeTaskSearch}
      />
      <DatabaseManagementDialogController
        projectId={projectId}
        initialDatabaseBlockId={databaseView?.databaseBlockId ?? null}
        open={databaseManagerOpen}
        onOpenChange={setDatabaseManagerOpen}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <MainViewHost
          projectId={projectId}
          databaseViewId={databaseViewId}
          databaseView={databaseView}
          refreshDatabaseView={selectedDatabaseView.refresh}
          projects={projects}
          view={renderedView}
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
          scrollStateKey={scrollStateKey}
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

interface CardStageDatabaseCapability {
  readonly availableTags: string[];
  readonly onDelete: (cardId: string) => Promise<void>;
  readonly onMove: (cardId: string, toStatus: Card["status"]) => Promise<void>;
  readonly onCompleteOccurrence: (
    cardId: string,
    occurrenceStart: Date,
  ) => Promise<void>;
  readonly onSkipOccurrence: (
    cardId: string,
    occurrenceStart: Date,
  ) => Promise<void>;
}

function CardStageDatabaseCapabilityBoundary({
  projectId,
  sessionId,
  properties,
  children,
}: {
  projectId: string;
  sessionId: string;
  properties: CardStageDatabaseProperties | null;
  children: (capability: CardStageDatabaseCapability | null) => ReactNode;
}) {
  const kanban = useKanban({
    projectId,
    sessionId,
    enabled: properties !== null,
  });
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const column of kanban.board?.columns ?? []) {
      for (const card of column.cards) {
        card.tags.forEach((tag) => tags.add(tag));
      }
    }
    return [...tags].sort((left, right) => left.localeCompare(right));
  }, [kanban.board?.columns]);

  if (!properties) return children(null);
  return children({
    availableTags,
    onDelete: async (cardId) => {
      const deleted = await kanban.deleteCard(properties.status, cardId);
      if (!deleted) throw new Error(`Card ${cardId} delete did not commit`);
    },
    onMove: async (cardId, toStatus) => {
      await kanban.moveCard({
        fromStatus: properties.status,
        cardId,
        toStatus,
      });
      await fetchCardDetail(projectId, cardId);
    },
    onCompleteOccurrence: async (cardId, occurrenceStart) => {
      await kanban.completeOccurrence({
        cardId,
        occurrenceStart,
        source: "card-stage",
      });
      await fetchCardDetail(projectId, cardId);
    },
    onSkipOccurrence: async (cardId, occurrenceStart) => {
      await kanban.skipOccurrence({
        cardId,
        occurrenceStart,
        source: "card-stage",
      });
      await fetchCardDetail(projectId, cardId);
    },
  });
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
  titleStore,
  onLeaveCard,
  onClose,
  onOpenTerminal,
  onEnsureBlankSessionForProject,
  onRefreshSessions,
  onOpenCardTab,
  onOpenThread,
  historyPanelActive,
  onToggleHistoryPanel,
  isActivePanelTab,
}: {
  tab: ProjectSessionTab & { config: ProjectSessionCardStageTabConfig };
  project: Project | null;
  closeRef: React.RefObject<(() => Promise<void>) | null>;
  persistRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  sessionSnapshotRef?: React.MutableRefObject<CardStageSessionSnapshot | null>;
  sessionId: string;
  sessionThread: CodexThreadSummary | null;
  canStartThreadInSession: boolean;
  titleStore: CardStageTabTitleStore;
  onLeaveCard: (snapshot: CardStageSessionSnapshot) => void;
  onClose: () => void;
  onOpenTerminal: () => Promise<void>;
  onEnsureBlankSessionForProject: (
    projectId: string,
    options?: { select?: boolean },
  ) => Promise<ProjectSession>;
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  onOpenCardTab: OpenCardTabHandler;
  onOpenThread: (threadId: string) => Promise<void>;
  historyPanelActive: boolean;
  onToggleHistoryPanel: (context: CardStageHistoryModalContext) => void;
  isActivePanelTab: boolean;
}) {
  const codexControl = useCodexAppServerControl(tab.config.projectId);
  const titleStoreKey = makeCardStageTabTitleKey(sessionId, tab.id);

  const detailSnapshot = useCardDetail(
    tab.config.projectId,
    tab.config.cardId,
  );
  const stageProjection = useMemo(() => {
    if (!detailSnapshot.detail) return { card: null, error: null };
    try {
      return {
        card: projectCardDetailToStageModel(detailSnapshot.detail),
        error: null,
      };
    } catch (error) {
      return {
        card: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [detailSnapshot.detail]);
  const card = stageProjection.card;
  const cardLoadError = !card
    ? stageProjection.error ?? (
        detailSnapshot.error === "Card not found"
          ? null
          : detailSnapshot.error
      )
    : null;
  const cardHydrating = !card && (
    detailSnapshot.loading
    || (!detailSnapshot.error && !stageProjection.error)
  );
  useLayoutEffect(() => {
    if (!card) return;
    titleStore.publishCommitted(titleStoreKey, card.card.title);
  }, [
    card,
    titleStore,
    titleStoreKey,
  ]);
  useEffect(() => () => {
    titleStore.release(titleStoreKey);
  }, [titleStore, titleStoreKey]);
  const cardAncestors = tab.config.ancestors ?? [];
  const ancestorTargetReads = useCardTargetReadModels(
    project?.id ?? "",
    cardAncestors.map((ancestor) => ancestor.cardId),
  );
  const breadcrumb = cardAncestors.length > 0 ? {
    ancestors: cardAncestors.map((ancestor, index) => {
      const target = resolveCardStageBreadcrumbTarget({
        targetBlockId: ancestor.cardId,
        model: ancestorTargetReads[index]?.data ?? null,
        loading: ancestorTargetReads[index]?.loading ?? false,
        error: ancestorTargetReads[index]?.error ?? null,
      });
      return {
        projectId:
          target.navigationTarget?.projectId ?? tab.config.projectId,
        cardId: target.navigationTarget?.cardId ?? ancestor.cardId,
        title: target.title,
        disabled: target.navigationTarget === null,
      };
    }),
    onOpenAncestor: (
      ancestor: { projectId: string; cardId: string; title: string },
      ancestorIndex: number,
    ) => {
      void onOpenCardTab(
        ancestor.projectId,
        ancestor.cardId,
        ancestor.title,
        {
          openMode: "durable",
          ancestors: cardAncestors.slice(0, ancestorIndex),
        },
      );
    },
  } : undefined;
  const handleStartNewSessionThreadFromEditor = useCallback(async (input: {
    projectId: string;
    targetSessionId?: string;
    prompt: string;
    promptInput?: CodexPromptInput;
    threadName?: string;
  }) => {
    const targetSessionId = input.targetSessionId?.trim()
      || (await onEnsureBlankSessionForProject(input.projectId, { select: false })).id;
    const result = await codexControl.startThreadForSession({
      projectId: input.projectId,
      sessionId: targetSessionId,
      prompt: input.prompt,
      promptInput: input.promptInput,
      threadName: input.threadName,
      skipAutoTitleGeneration: Boolean(input.threadName?.trim()),
      runInTarget: "localProject",
    });
    if (result.kind !== "started") {
      throw new Error("Card thread unexpectedly started in a worktree");
    }
    const { detail } = result;
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
    return (
      <CardStageSessionSkeleton
        titleSnapshot={tab.config.titleSnapshot}
        breadcrumb={breadcrumb ? {
          ...breadcrumb,
          currentTitle: tab.config.titleSnapshot ?? tab.config.cardId,
        } : undefined}
      />
    );
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

  const compatibilityDatabase =
    card.databaseContext.kind === "member"
      ? card.databaseContext.compatibilityProperties
      : null;

  const renderDocumentSurface = (
    databaseCapability: CardStageDatabaseCapability | null,
  ): ReactNode => (
    <OwnedBlockDocumentBoundary
      projectId={tab.config.projectId}
      ownerBlockId={card.card.id}
    >
      {(documentModel, documentControls) => {
        if (documentModel.status === "loading") {
          return (
            <CardStageSessionSkeleton
              titleSnapshot={card.card.title}
              breadcrumb={breadcrumb ? {
                ...breadcrumb,
                currentTitle: card.card.title,
              } : undefined}
            />
          );
        }
        if (documentModel.status === "error") {
          return (
            <CardStageSessionNotice
              title="Could not open card"
              description={documentModel.error.message}
              actionLabel="Retry"
              onAction={() => {
                void documentControls.reload();
              }}
            />
          );
        }
        if (documentModel.status !== "ready") {
          return (
            <CardStageSessionNotice
              title="Card content is not ready"
              description="This Card content is not ready to edit."
              actionLabel="Retry"
              onAction={() => {
                void documentControls.reload();
              }}
            />
          );
        }

        const documentAuthority = {
          kind: "yjs" as const,
          descriptor: documentModel.descriptor,
          reload: documentControls.reload,
        };

        return (
          <CardStage
            documentAuthority={documentAuthority}
            card={card}
            projectId={tab.config.projectId}
            projectName={project.name}
            projectWorkspacePath={projectWorkspaceRootOrNull(project)}
            availableTags={databaseCapability?.availableTags ?? []}
            closeRef={closeRef as React.MutableRefObject<(() => Promise<void>) | null>}
            persistRef={persistRef}
            sessionSnapshotRef={sessionSnapshotRef}
            onTitleChange={(title) => {
              titleStore.publishLive(titleStoreKey, title);
            }}
            onTitleSourceDispose={() => {
              titleStore.clearLive(titleStoreKey);
            }}
            onClose={onClose}
            onLeaveCard={onLeaveCard}
            onUpdate={async (cardId: string, updates: Partial<CardInput>) =>
              await commitCardDetailMetadataPatch({
                projectId: tab.config.projectId,
                cardBlockId: cardId,
                mutationId: crypto.randomUUID(),
                clientSessionId: tab.id,
                patch: updates,
              })}
            {...(databaseCapability
              ? {
                  onDelete: databaseCapability.onDelete,
                  onMove: databaseCapability.onMove,
                  onCompleteOccurrence:
                    databaseCapability.onCompleteOccurrence,
                  onSkipOccurrence: databaseCapability.onSkipOccurrence,
                }
              : {})}
            onOpenTerminalPanel={() => {
              void onOpenTerminal();
            }}
            onToggleHistoryPanel={(snapshot) => onToggleHistoryPanel({
              sessionId,
              tabId: tab.id,
              projectId: tab.config.projectId,
              cardId: tab.config.cardId,
              cardTitle: snapshot.title || tab.config.titleSnapshot,
              cardNfm: snapshot.nfm,
            })}
            historyPanelActive={historyPanelActive}
            isActivePanelTab={isActivePanelTab}
            breadcrumb={breadcrumb}
            sessionId={sessionId}
            sessionThread={sessionThread}
            canStartThreadInSession={canStartThreadInSession}
            linkedCodexThreads={[]}
            onOpenCodexThread={onOpenThread}
            onOpenCard={({ projectId, cardId, titleSnapshot }) => {
              const ancestors = appendCardStageAncestor(cardAncestors, {
                cardId: tab.config.cardId,
              });
              void onOpenCardTab(projectId, cardId, titleSnapshot, {
                openMode: "durable",
                ancestors,
              });
            }}
            onStartNewSessionThreadFromEditor={handleStartNewSessionThreadFromEditor}
            onSendThreadSectionPrompt={async ({
              projectId,
              threadId,
              prompt,
              promptInput,
            }) => {
              await codexControl.startTurn(threadId, prompt, {
                projectId,
                promptInput,
              });
            }}
          />
        );
      }}
    </OwnedBlockDocumentBoundary>
  );

  return (
    <CardStageDatabaseCapabilityBoundary
      projectId={tab.config.projectId}
      sessionId={tab.id}
      properties={compatibilityDatabase}
    >
      {renderDocumentSurface}
    </CardStageDatabaseCapabilityBoundary>
  );
}

function CardStageSessionSkeleton({
  titleSnapshot,
  breadcrumb,
}: {
  titleSnapshot?: string;
  breadcrumb?: ComponentPropsWithoutRef<typeof CardStageToolbar>["breadcrumb"];
}) {
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
        onCopyDeeplink={() => undefined}
        onDelete={() => undefined}
        onToggleContentWidth={() => undefined}
        onToggleShowRawContent={() => undefined}
        onToggleHistoryPanel={() => undefined}
        breadcrumb={breadcrumb}
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
            <CardStageContentSkeleton
              titleSnapshot={title}
              announce={false}
            />
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
