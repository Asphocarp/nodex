import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type {
  Project,
  WorkbenchLayoutSnapshot,
  WorkbenchRecentPageSession,
} from "./types";
import {
  type DockTreeNode,
} from "./dock-layout";
import {
  clampStagePanelWidth,
  STAGE_PANEL_MAX_WIDTH,
  STAGE_PANEL_MIN_WIDTH,
} from "./stage-panel-resize";
import {
  normalizeSidebarCollapsibleSectionsState,
  type SidebarCollapsibleSectionId,
  type SidebarCollapsibleSectionsState,
} from "./sidebar-section-prefs";
import {
  CODEX_SIDEBAR_WIDTH_STORAGE_KEY,
  clampCodexSidebarWidth,
  resolveCodexSidebarWidth,
} from "./codex-sidebar-auto-reveal";
import {
  cloneDbViewPrefs,
  getDefaultDbViewPrefs,
  normalizeDbViewPrefs,
  type DbViewPrefs,
  type SupportedDbView,
  viewSupportsDbViewPrefs,
} from "./db-view-prefs";
import {
  parseDockPrefs,
  parseFilesStageTabs,
  parseSidebarSectionStateByProject,
  parseSidebarStageExpanded,
  parseStageNavDirection,
  parseStagePanelWidths,
  parseThreadsStageTabs,
  parseWorkbenchRecentSessions,
  parseWorkbenchSearchMap,
  parseWorkbenchProjectOrder,
  parseWorkbenchStageMap,
  parseWorkbenchViewMap,
} from "./workbench-persisted-schemas";
import {
  appScope,
  scopedAtom,
  useScopedAtom,
} from "./maitai";
import type { WorkbenchSessionViewSnapshot } from "../../shared/workbench-session-view";

export type WorkbenchView = "kanban" | "list" | "toggle-list" | "canvas" | "calendar";
export type StageId = "db" | "pages" | "threads" | "files";
export type StageNavDirection = "left" | "right";
export type SidebarGroupId = StageId | "recents";
export type {
  SidebarCollapsibleSectionId,
  SidebarCollapsibleSectionsState,
} from "./sidebar-section-prefs";

export const STAGE_ORDER: StageId[] = ["db", "pages", "threads", "files"];
export const NEW_THREAD_STAGE_TAB_ID = "thread:new";

export interface ProjectRef {
  projectId: string;
  colorToken: string;
  initial: string;
}

export type RecentPageSession = WorkbenchRecentPageSession;

export interface PagesStageTab {
  id: string;
  kind: "history" | "session";
  title: string;
  sessionId?: string;
}

export interface ThreadsStageTab {
  id: string;
  title: string;
  preview: string;
}

export interface FilesStageTab {
  id: "diff";
  title: string;
}

export type StagePanelWidths = Partial<Record<StageId, number>>;
export type SidebarSectionState = Record<string, boolean>;

const WORKBENCH_STORAGE_KEY = "nodex-workbench-v2";
const SIDEBAR_STORAGE_KEY = "nodex-sidebar-v2";
const DOCK_STORAGE_KEY = "nodex-dock-layout-v2";
const RECENT_STORAGE_KEY = "nodex-recent-page-sessions-v1";
const DB_VIEW_PREFS_STORAGE_KEY = "nodex-db-view-prefs-v1";
const WINDOW_LOCAL_STORAGE_KEYS = new Set([
  WORKBENCH_STORAGE_KEY,
  RECENT_STORAGE_KEY,
]);
const VALID_VIEWS: WorkbenchView[] = ["kanban", "list", "toggle-list", "canvas", "calendar"];
const SIDEBAR_GROUP_IDS: SidebarGroupId[] = ["db", "recents", "pages", "threads", "files"];
const MAX_RECENT_PAGE_SESSIONS = 10;
const HISTORY_TAB_ID = "history";
const NEW_THREAD_STAGE_TAB_TITLE = "New thread";

interface SidebarPrefs {
  collapsed: boolean;
  width: number;
  collapsibleSections: SidebarCollapsibleSectionsState;
}

interface WorkbenchPrefs {
  dbProjectId?: string | null;
  threadsProjectId?: string | null;
  viewsByProject: Record<string, WorkbenchView>;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject?: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  projectOrder: string[];
  activeRecentSessionId: string | null;
  focusedStage?: StageId;
  stageNavDirection?: StageNavDirection;
  sidebarStageExpandedByProject?: Record<string, Partial<Record<SidebarGroupId, boolean>>>;
  sidebarSectionExpandedByProject?: Record<string, SidebarSectionState>;
  sidebarSectionShowAllByProject?: Record<string, SidebarSectionState>;
  activePagesTabId?: string;
  threadsTabs?: ThreadsStageTab[];
  activeThreadsTabId?: string;
  filesTabs?: FilesStageTab[];
  activeFilesTabId?: string;
  stagePanelWidths?: StagePanelWidths;
  slidingWindowPaneCount?: number;
}

type PersistedWorkbenchPrefs = Partial<WorkbenchPrefs> & {
  /** Decode-only key written before Project navigation naming was corrected. */
  spaceOrder?: string[];
};

interface DockPrefs {
  width: number;
  tree: DockTreeNode;
}

interface WorkbenchState {
  dbProjectId: string | null;
  threadsProjectId: string | null;
  viewsByProject: Record<string, WorkbenchView>;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  projectOrder: string[];
  sidebar: SidebarPrefs;
  dock: DockPrefs;
  recentPageSessions: RecentPageSession[];
  activeRecentSessionId: string | null;
  focusedStage: StageId;
  stageNavDirection: StageNavDirection;
  sidebarStageExpandedByProject: Record<string, Partial<Record<SidebarGroupId, boolean>>>;
  sidebarSectionExpandedByProject: Record<string, SidebarSectionState>;
  sidebarSectionShowAllByProject: Record<string, SidebarSectionState>;
  activePagesTabId: string;
  threadsTabs: ThreadsStageTab[];
  activeThreadsTabId: string;
  filesTabs: FilesStageTab[];
  activeFilesTabId: string;
  stagePanelWidths: StagePanelWidths;
  slidingWindowPaneCount: number;
  sessionViewsBySessionId: Record<string, WorkbenchSessionViewSnapshot>;
}

const workbenchStateAtom = scopedAtom<WorkbenchState | null>(
  appScope,
  null,
  { debugLabel: "workbench-window-layout" },
);

const DEFAULT_DOCK_WIDTH = 560;
const DOCK_MIN_WIDTH = 360;
const DOCK_MAX_WIDTH = 1100;
const SLIDING_WINDOW_MIN_PANES = 1;
const SLIDING_WINDOW_MAX_PANES = STAGE_ORDER.length;
const SLIDING_WINDOW_DEFAULT_PANES = 2;
const PROJECT_COLOR_PALETTE = [
  "#5e9fe8",
  "#72bc8f",
  "#de9255",
  "#bf8eda",
  "#eac26b",
  "#e97366",
  "#46a171",
  "#2783de",
];

const DEFAULT_FILES_TABS: FilesStageTab[] = [
  { id: "diff", title: "Diffs" },
];

function isWorkbenchView(value: unknown): value is WorkbenchView {
  return typeof value === "string" && VALID_VIEWS.includes(value as WorkbenchView);
}

function isStageId(value: unknown): value is StageId {
  return typeof value === "string" && STAGE_ORDER.includes(value as StageId);
}

function isStageDirection(value: unknown): value is StageNavDirection {
  return value === "left" || value === "right";
}

function normalizeViewMap(value: unknown): Record<string, WorkbenchView> {
  return parseWorkbenchViewMap(value);
}

function normalizeSearchMap(value: unknown): Record<string, string> {
  return parseWorkbenchSearchMap(value);
}

function normalizeDbViewPrefsMap(value: unknown): Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>> {
  if (typeof value !== "object" || value === null) return {};

  return Object.entries(value).reduce<Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>>(
    (acc, [projectId, projectPrefs]) => {
      if (typeof projectId !== "string" || projectId.length === 0) return acc;
      if (typeof projectPrefs !== "object" || projectPrefs === null) return acc;

      const nextPrefs = Object.entries(projectPrefs).reduce<Partial<Record<SupportedDbView, DbViewPrefs>>>(
        (viewAcc, [view, prefs]) => {
          if (view !== "kanban" && view !== "list" && view !== "toggle-list") return viewAcc;
          viewAcc[view] = normalizeDbViewPrefs(view, prefs);
          return viewAcc;
        },
        {},
      );

      acc[projectId] = nextPrefs;
      return acc;
    },
    {},
  );
}

function normalizeProjectOrder(value: unknown): string[] {
  return parseWorkbenchProjectOrder(value);
}

function normalizeRecentSessions(value: unknown): RecentPageSession[] {
  return parseWorkbenchRecentSessions(value, MAX_RECENT_PAGE_SESSIONS);
}

function findRecentPageSession(
  recentSessions: readonly RecentPageSession[],
  projectId: string,
  pageId: string,
): RecentPageSession | null {
  return recentSessions.find((session) => session.projectId === projectId && session.pageId === pageId) ?? null;
}

export function resolvePagesStageSelectionForPage(
  recentSessions: readonly RecentPageSession[],
  projectId: string,
  pageId: string,
): {
  activeRecentSessionId: string | null;
  activePagesTabId: string;
} {
  const session = findRecentPageSession(recentSessions, projectId, pageId);
  if (!session) {
    return {
      activeRecentSessionId: null,
      activePagesTabId: "",
    };
  }

  return {
    activeRecentSessionId: session.id,
    activePagesTabId: `session:${session.id}`,
  };
}

function recordRecentPageLeaveInList(
  recentSessions: readonly RecentPageSession[],
  projectId: string,
  pageId: string,
  titleSnapshot: string,
): RecentPageSession[] {
  const existing = findRecentPageSession(recentSessions, projectId, pageId);
  if (existing) {
    return recentSessions.map((session) =>
      session.id === existing.id
        ? {
            ...session,
            titleSnapshot,
          }
        : session,
    );
  }

  return [{
    id: crypto.randomUUID(),
    projectId,
    pageId,
    titleSnapshot,
    lastOpenedAt: new Date().toISOString(),
  }, ...recentSessions].slice(0, MAX_RECENT_PAGE_SESSIONS);
}

function reorderRecentPageSessionsInList(
  recentSessions: readonly RecentPageSession[],
  orderedSessionIds: readonly string[],
): RecentPageSession[] {
  if (orderedSessionIds.length === 0) return [...recentSessions];

  const sessionById = new Map(recentSessions.map((session) => [session.id, session]));
  const selectedIds = new Set<string>();
  const reordered = orderedSessionIds.flatMap((sessionId) => {
    if (selectedIds.has(sessionId)) return [];
    const session = sessionById.get(sessionId);
    if (!session) return [];
    selectedIds.add(sessionId);
    return [session];
  });

  if (reordered.length === 0) return [...recentSessions];

  const preserved = recentSessions.filter((session) => !selectedIds.has(session.id));
  return [...reordered, ...preserved];
}

function normalizeStageMap(value: unknown): Record<string, StageId> {
  return parseWorkbenchStageMap(value);
}

function normalizeSidebarStageExpanded(
  value: unknown,
): Record<string, Partial<Record<SidebarGroupId, boolean>>> {
  return parseSidebarStageExpanded(value);
}

function normalizeSidebarSectionStateByProject(
  value: unknown,
): Record<string, SidebarSectionState> {
  return parseSidebarSectionStateByProject(value);
}

function normalizeThreadsTabs(value: unknown): ThreadsStageTab[] {
  const parsed = parseThreadsStageTabs(value)
    .filter((tab) => tab.id !== NEW_THREAD_STAGE_TAB_ID)
    .slice(0, 31);
  return ensureThreadsTabs(parsed);
}

function normalizeFilesTabs(value: unknown): FilesStageTab[] {
  const hasCurrentTab = parseFilesStageTabs(value).some((tab) => tab.id === "diff");
  return hasCurrentTab ? [...DEFAULT_FILES_TABS] : [];
}

function normalizeStagePanelWidths(
  value: unknown,
): StagePanelWidths {
  return Object.entries(parseStagePanelWidths(value)).reduce<StagePanelWidths>((acc, [stageId, width]) => {
    if (!isStageId(stageId)) return acc;
    acc[stageId] = clampStagePanelWidth(width, STAGE_PANEL_MIN_WIDTH, STAGE_PANEL_MAX_WIDTH);
    return acc;
  }, {});
}

function clampSlidingWindowPaneCount(value: number): number {
  if (!Number.isFinite(value)) return SLIDING_WINDOW_DEFAULT_PANES;
  return clamp(
    Math.round(value),
    SLIDING_WINDOW_MIN_PANES,
    SLIDING_WINDOW_MAX_PANES,
  );
}

function normalizeSlidingWindowPaneCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clampSlidingWindowPaneCount(value);
}

function resolvePersistedSlidingWindowPaneCount(persistedPaneCount: unknown): number {
  const nextCount = normalizeSlidingWindowPaneCount(persistedPaneCount);
  if (nextCount !== null) return nextCount;
  return SLIDING_WINDOW_DEFAULT_PANES;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPreferredStorage(key: string): Storage {
  return WINDOW_LOCAL_STORAGE_KEYS.has(key) ? sessionStorage : localStorage;
}

function readJson<T>(key: string): T | null {
  try {
    const preferredStorage = getPreferredStorage(key);
    const raw = preferredStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    try {
      if (!WINDOW_LOCAL_STORAGE_KEYS.has(key)) return null;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    const storage = getPreferredStorage(key);
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore localStorage failures
  }
}

function readNumberStorage(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === "") return null;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "number" ? parsed : Number(raw);
  } catch {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : Number(raw);
    } catch {
      return null;
    }
  }
}

function writeNumberStorage(key: string, value: number): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore localStorage failures
  }
}

function hashProjectId(projectId: string): number {
  let hash = 0;
  for (let index = 0; index < projectId.length; index += 1) {
    hash = (hash * 31 + projectId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function makeProjectRef(projectId: string): ProjectRef {
  const colorToken = PROJECT_COLOR_PALETTE[hashProjectId(projectId) % PROJECT_COLOR_PALETTE.length];
  const initial = projectId.slice(0, 1).toUpperCase() || "?";
  return { projectId, colorToken, initial };
}

function buildProjectIdSet(projects: Project[]): Set<string> {
  return new Set(projects.map((project) => project.id));
}

function pruneProjectRecord<T>(
  record: Record<string, T>,
  projectIds: ReadonlySet<string>,
): Record<string, T> {
  return Object.entries(record).reduce<Record<string, T>>((acc, [projectId, value]) => {
    if (!projectIds.has(projectId)) return acc;
    acc[projectId] = value;
    return acc;
  }, {});
}

function pruneRecentSessions(
  recentSessions: RecentPageSession[],
  projectIds: ReadonlySet<string>,
): RecentPageSession[] {
  return recentSessions.filter((session) => projectIds.has(session.projectId));
}

interface LoadInitialStateOptions {
  layoutSnapshot?: WorkbenchLayoutSnapshot | null;
}

function loadInitialState(options: LoadInitialStateOptions = {}): WorkbenchState {
  const persistedWorkbench = readJson<PersistedWorkbenchPrefs>(WORKBENCH_STORAGE_KEY);
  const persistedSidebar = readJson<Partial<SidebarPrefs>>(SIDEBAR_STORAGE_KEY);
  const persistedCodexSidebarWidth = readNumberStorage(CODEX_SIDEBAR_WIDTH_STORAGE_KEY);
  const persistedDock = readJson<Partial<DockPrefs>>(DOCK_STORAGE_KEY);
  const persistedRecent = readJson<unknown>(RECENT_STORAGE_KEY);
  const persistedDbViewPrefs = readJson<WorkbenchPrefs["dbViewPrefsByProject"]>(DB_VIEW_PREFS_STORAGE_KEY);
  const parsedDockPrefs = parseDockPrefs(persistedDock);
  const layoutSnapshot = options.layoutSnapshot ?? null;
  const dbProjectId = layoutSnapshot
    ? layoutSnapshot.dbProjectId
    : (typeof persistedWorkbench?.dbProjectId === "string" && persistedWorkbench.dbProjectId) || null;
  const threadsProjectId = layoutSnapshot
    ? layoutSnapshot.threadsProjectId
    : (typeof persistedWorkbench?.threadsProjectId === "string" && persistedWorkbench.threadsProjectId)
      || dbProjectId;
  const threadsTabs = ensureThreadsTabs(normalizeThreadsTabs(layoutSnapshot?.threadsTabs ?? persistedWorkbench?.threadsTabs));
  const filesTabs = ensureFilesTabs(normalizeFilesTabs(layoutSnapshot?.filesTabs ?? persistedWorkbench?.filesTabs));
  const focusedStage =
    (layoutSnapshot && isStageId(layoutSnapshot.focusedStage) && layoutSnapshot.focusedStage) ||
    (isStageId(persistedWorkbench?.focusedStage) && persistedWorkbench.focusedStage) ||
    "db";
  const stageNavDirection =
    parseStageNavDirection(layoutSnapshot?.stageNavDirection) ||
    parseStageNavDirection(persistedWorkbench?.stageNavDirection) ||
    "right";
  const activeThreadsTabId =
    (typeof layoutSnapshot?.activeThreadsTabId === "string" && layoutSnapshot.activeThreadsTabId) ||
    (typeof persistedWorkbench?.activeThreadsTabId === "string" && persistedWorkbench.activeThreadsTabId) ||
    threadsTabs[0]?.id ||
    "";
  const activeFilesTabId =
    (typeof layoutSnapshot?.activeFilesTabId === "string" && layoutSnapshot.activeFilesTabId) ||
    (typeof persistedWorkbench?.activeFilesTabId === "string" && persistedWorkbench.activeFilesTabId) ||
    filesTabs[0]?.id ||
    "diff";
  const activePagesTabId =
    (typeof layoutSnapshot?.activePagesTabId === "string" && layoutSnapshot.activePagesTabId) ||
    (typeof persistedWorkbench?.activePagesTabId === "string" && persistedWorkbench.activePagesTabId) ||
    "";
  const activeRecentSessionId = layoutSnapshot
    ? (typeof layoutSnapshot.activeRecentSessionId === "string" ? layoutSnapshot.activeRecentSessionId : null)
    : ((typeof persistedWorkbench?.activeRecentSessionId === "string" &&
      persistedWorkbench.activeRecentSessionId) ||
      null);
  const stagePanelWidths = normalizeStagePanelWidths(layoutSnapshot?.stagePanelWidths ?? persistedWorkbench?.stagePanelWidths);
  const slidingWindowPaneCount = resolvePersistedSlidingWindowPaneCount(
    layoutSnapshot?.slidingWindowPaneCount ?? persistedWorkbench?.slidingWindowPaneCount,
  );
  return {
    dbProjectId,
    threadsProjectId,
    viewsByProject: layoutSnapshot
      ? normalizeViewMap(layoutSnapshot.viewsByProject)
      : normalizeViewMap(persistedWorkbench?.viewsByProject),
    searchByProject: normalizeSearchMap(layoutSnapshot?.searchByProject ?? persistedWorkbench?.searchByProject),
    dbViewPrefsByProject: normalizeDbViewPrefsMap(
      layoutSnapshot?.dbViewPrefsByProject ?? persistedDbViewPrefs ?? persistedWorkbench?.dbViewPrefsByProject,
    ),
    projectOrder: normalizeProjectOrder(
      layoutSnapshot?.projectOrder
      ?? persistedWorkbench?.projectOrder
      ?? persistedWorkbench?.spaceOrder,
    ),
    sidebar: {
      collapsed: Boolean(layoutSnapshot?.sidebar?.collapsed ?? persistedSidebar?.collapsed),
      width: resolveCodexSidebarWidth({
        layoutSnapshotWidth: typeof layoutSnapshot?.sidebar?.width === "number"
          ? layoutSnapshot.sidebar.width
          : null,
        codexStorageWidth: persistedCodexSidebarWidth,
        nodexStorageWidth: typeof persistedSidebar?.width === "number"
          ? persistedSidebar.width
          : null,
      }),
      collapsibleSections: normalizeSidebarCollapsibleSectionsState(
        layoutSnapshot?.sidebar?.collapsibleSections ?? persistedSidebar?.collapsibleSections,
      ),
    },
    dock: {
      width: clamp(
        (typeof layoutSnapshot?.dock?.width === "number" ? layoutSnapshot.dock.width : parsedDockPrefs.width)
          ?? DEFAULT_DOCK_WIDTH,
        DOCK_MIN_WIDTH,
        DOCK_MAX_WIDTH,
      ),
      tree: parseDockPrefs(layoutSnapshot?.dock).tree ?? parsedDockPrefs.tree,
    },
    recentPageSessions: layoutSnapshot
      ? normalizeRecentSessions(layoutSnapshot.recentPageSessions).slice(0, MAX_RECENT_PAGE_SESSIONS)
      : normalizeRecentSessions(persistedRecent).slice(0, MAX_RECENT_PAGE_SESSIONS),
    activeRecentSessionId,
    focusedStage,
    stageNavDirection,
    sidebarStageExpandedByProject: normalizeSidebarStageExpanded(
      layoutSnapshot?.sidebarStageExpandedByProject ?? persistedWorkbench?.sidebarStageExpandedByProject,
    ),
    sidebarSectionExpandedByProject: normalizeSidebarSectionStateByProject(
      layoutSnapshot?.sidebarSectionExpandedByProject ?? persistedWorkbench?.sidebarSectionExpandedByProject,
    ),
    sidebarSectionShowAllByProject: normalizeSidebarSectionStateByProject(
      layoutSnapshot?.sidebarSectionShowAllByProject ?? persistedWorkbench?.sidebarSectionShowAllByProject,
    ),
    activePagesTabId,
    threadsTabs,
    activeThreadsTabId,
    filesTabs,
    activeFilesTabId,
    stagePanelWidths,
    slidingWindowPaneCount,
    sessionViewsBySessionId: layoutSnapshot?.sessionViewsBySessionId ?? {},
  };
}

function reconcileProjectOrder(
  _order: string[],
  projects: Project[],
): string[] {
  return [...new Set(projects.map((project) => project.id))];
}

export function resolveActiveProjectAfterCatalogChange(
  current: string | null,
  previousOrder: readonly string[],
  projects: readonly Project[],
  selectFirstWhenEmpty = false,
): string | null {
  const nextIds = new Set(projects.map((project) => project.id));
  if (current && nextIds.has(current)) return current;
  if (projects.length === 0) return null;
  if (!current) return selectFirstWhenEmpty ? projects[0]?.id ?? null : null;

  const previousIndex = previousOrder.indexOf(current);
  if (previousIndex < 0) return projects[0]?.id ?? null;
  const nextAdjacent = previousOrder
    .slice(previousIndex + 1)
    .find((projectId) => nextIds.has(projectId));
  if (nextAdjacent) return nextAdjacent;
  const previousAdjacent = previousOrder
    .slice(0, previousIndex)
    .reverse()
    .find((projectId) => nextIds.has(projectId));
  return previousAdjacent ?? projects[0]?.id ?? null;
}

function ensureSidebarStageState(
  value: Partial<Record<SidebarGroupId, boolean>> | undefined,
): Partial<Record<SidebarGroupId, boolean>> {
  if (!value) return {};
  return SIDEBAR_GROUP_IDS.reduce<Partial<Record<SidebarGroupId, boolean>>>((acc, groupId) => {
    const expanded = value[groupId];
    if (typeof expanded === "boolean") {
      acc[groupId] = expanded;
    }
    return acc;
  }, {});
}

function ensureFilesTabs(tabs: FilesStageTab[] | undefined): FilesStageTab[] {
  if (!tabs || tabs.length === 0) return [...DEFAULT_FILES_TABS];
  return [{ id: "diff", title: "Diffs" }];
}

function ensureThreadsTabs(tabs: ThreadsStageTab[] | undefined): ThreadsStageTab[] {
  if (!tabs || tabs.length === 0) {
    return [{ id: NEW_THREAD_STAGE_TAB_ID, title: NEW_THREAD_STAGE_TAB_TITLE, preview: "" }];
  }

  const deduped = tabs.reduce<ThreadsStageTab[]>((acc, tab) => {
    if (tab.id === NEW_THREAD_STAGE_TAB_ID) return acc;
    if (acc.some((existing) => existing.id === tab.id)) return acc;
    acc.push(tab);
    return acc;
  }, []);

  return [
    { id: NEW_THREAD_STAGE_TAB_ID, title: NEW_THREAD_STAGE_TAB_TITLE, preview: "" },
    ...deduped.slice(0, 31),
  ];
}

function stageIndexOf(stageId: StageId): number {
  return STAGE_ORDER.indexOf(stageId);
}

export function resolveExpandedStages(
  focusedStage: StageId,
  direction: StageNavDirection,
  paneCount: number,
  isNarrow: boolean,
): StageId[] {
  if (isNarrow) return [focusedStage];
  const resolvedPaneCount = clampSlidingWindowPaneCount(paneCount);
  if (resolvedPaneCount >= STAGE_ORDER.length) return [...STAGE_ORDER];

  const focusedIndex = stageIndexOf(focusedStage);
  if (focusedIndex < 0) return STAGE_ORDER.slice(0, resolvedPaneCount);

  const maxWindowStart = STAGE_ORDER.length - resolvedPaneCount;
  const startIndex = direction === "left"
    ? Math.max(0, focusedIndex - (resolvedPaneCount - 1))
    : Math.min(maxWindowStart, focusedIndex);

  return STAGE_ORDER.slice(startIndex, startIndex + resolvedPaneCount);
}

export function resolveNearestSlidingWindowDirection(
  focusedStage: StageId,
  visibleStages: readonly StageId[],
  paneCount: number,
  fallbackDirection: StageNavDirection,
): StageNavDirection {
  if (visibleStages.length < 2) return fallbackDirection;

  const currentWindowStart = stageIndexOf(visibleStages[0]);
  if (currentWindowStart < 0) return fallbackDirection;

  const leftWindowStart = stageIndexOf(resolveExpandedStages(focusedStage, "left", paneCount, false)[0]);
  const rightWindowStart = stageIndexOf(resolveExpandedStages(focusedStage, "right", paneCount, false)[0]);
  if (leftWindowStart < 0 || rightWindowStart < 0) return fallbackDirection;

  const leftDistance = Math.abs(leftWindowStart - currentWindowStart);
  const rightDistance = Math.abs(rightWindowStart - currentWindowStart);
  if (leftDistance === rightDistance) return fallbackDirection;

  return leftDistance < rightDistance ? "left" : "right";
}

export function resolveSlidingWindowFocusIntent(
  focusedStage: StageId,
  visibleStages: readonly StageId[],
  paneCount: number,
  fallbackDirection: StageNavDirection,
): { direction: StageNavDirection } {
  return {
    direction: resolveNearestSlidingWindowDirection(focusedStage, visibleStages, paneCount, fallbackDirection),
  };
}

export function resolveEffectiveSlidingWindowPaneCount(
  requestedPaneCount: number,
  availableWidthPx: number,
): number {
  const normalizedRequestedPaneCount = clampSlidingWindowPaneCount(requestedPaneCount);
  if (!Number.isFinite(availableWidthPx) || availableWidthPx <= 0) return normalizedRequestedPaneCount;
  const maxByWidth = Math.max(
    SLIDING_WINDOW_MIN_PANES,
    Math.floor(availableWidthPx / STAGE_PANEL_MIN_WIDTH),
  );
  return clampSlidingWindowPaneCount(Math.min(normalizedRequestedPaneCount, maxByWidth));
}

type SlidingWindowPaneCountAction = "decrease" | "increase";

function areStageWindowsEqual(a: readonly StageId[], b: readonly StageId[]): boolean {
  return a.length === b.length && a.every((stageId, index) => stageId === b[index]);
}

function resolveSlidingWindowWindowState(
  targetWindow: readonly StageId[],
  paneCount: number,
  focusedStage: StageId,
  stageNavDirection: StageNavDirection,
): { focusedStage: StageId; stageNavDirection: StageNavDirection } {
  const fallbackStage = targetWindow[targetWindow.length - 1] ?? focusedStage;
  const focusCandidates = targetWindow.includes(focusedStage)
    ? [focusedStage, fallbackStage, targetWindow[0] ?? focusedStage]
    : [fallbackStage, targetWindow[0] ?? fallbackStage];
  const directionCandidates = stageNavDirection === "right"
    ? ["right", "left"] as const
    : ["left", "right"] as const;

  for (const candidateFocus of focusCandidates) {
    for (const candidateDirection of directionCandidates) {
      const candidateWindow = resolveExpandedStages(
        candidateFocus,
        candidateDirection,
        paneCount,
        false,
      );
      if (!areStageWindowsEqual(candidateWindow, targetWindow)) continue;
      return {
        focusedStage: candidateFocus,
        stageNavDirection: candidateDirection,
      };
    }
  }

  return {
    focusedStage: fallbackStage,
    stageNavDirection: "left",
  };
}

function resolveSlidingWindowWindowDirection(
  targetWindow: readonly StageId[],
  paneCount: number,
  focusedStage: StageId,
  fallbackDirection: StageNavDirection,
): StageNavDirection {
  const directionCandidates = fallbackDirection === "right"
    ? ["right", "left"] as const
    : ["left", "right"] as const;

  for (const candidateDirection of directionCandidates) {
    const candidateWindow = resolveExpandedStages(
      focusedStage,
      candidateDirection,
      paneCount,
      false,
    );
    if (areStageWindowsEqual(candidateWindow, targetWindow)) {
      return candidateDirection;
    }
  }

  return fallbackDirection;
}

export function resolveSlidingWindowShift(
  focusedStage: StageId,
  stageNavDirection: StageNavDirection,
  paneCount: number,
  direction: -1 | 1,
): { focusedStage: StageId; stageNavDirection: StageNavDirection } {
  const normalizedPaneCount = clampSlidingWindowPaneCount(paneCount);
  const currentWindow = resolveExpandedStages(
    focusedStage,
    stageNavDirection,
    normalizedPaneCount,
    false,
  );

  if (currentWindow.length <= 1) {
    return {
      focusedStage,
      stageNavDirection,
    };
  }

  const currentWindowStart = stageIndexOf(currentWindow[0]);
  const maxWindowStart = STAGE_ORDER.length - currentWindow.length;
  const targetWindowStart = clamp(
    currentWindowStart + direction,
    0,
    maxWindowStart,
  );

  if (targetWindowStart === currentWindowStart) {
    return {
      focusedStage,
      stageNavDirection,
    };
  }

  const targetWindow = STAGE_ORDER.slice(
    targetWindowStart,
    targetWindowStart + currentWindow.length,
  );
  const nextFocusedStage = targetWindow.includes(focusedStage)
    ? focusedStage
    : direction > 0
      ? targetWindow[0] ?? focusedStage
      : targetWindow[targetWindow.length - 1] ?? focusedStage;

  return {
    focusedStage: nextFocusedStage,
    stageNavDirection: resolveSlidingWindowWindowDirection(
      targetWindow,
      normalizedPaneCount,
      nextFocusedStage,
      direction > 0 ? "right" : "left",
    ),
  };
}

export function resolveSlidingWindowPaneCountChange(
  focusedStage: StageId,
  stageNavDirection: StageNavDirection,
  paneCount: number,
  action: SlidingWindowPaneCountAction,
): {
  focusedStage: StageId;
  stageNavDirection: StageNavDirection;
  slidingWindowPaneCount: number;
} {
  const normalizedPaneCount = clampSlidingWindowPaneCount(paneCount);
  const currentWindow = resolveExpandedStages(
    focusedStage,
    stageNavDirection,
    normalizedPaneCount,
    false,
  );

  if (action === "increase") {
    if (normalizedPaneCount >= STAGE_ORDER.length) {
      return {
        focusedStage,
        stageNavDirection,
        slidingWindowPaneCount: normalizedPaneCount,
      };
    }

    const rightEdgeStage = currentWindow[currentWindow.length - 1];
    const leftEdgeStage = currentWindow[0];
    const rightEdgeIndex = rightEdgeStage ? stageIndexOf(rightEdgeStage) : -1;
    const leftEdgeIndex = leftEdgeStage ? stageIndexOf(leftEdgeStage) : -1;

    const targetWindow = rightEdgeIndex >= 0 && rightEdgeIndex < STAGE_ORDER.length - 1
      ? [...currentWindow, STAGE_ORDER[rightEdgeIndex + 1]]
      : leftEdgeIndex > 0
        ? [STAGE_ORDER[leftEdgeIndex - 1], ...currentWindow]
        : currentWindow;
    const nextPaneCount = clampSlidingWindowPaneCount(normalizedPaneCount + 1);
    const nextWindowState = resolveSlidingWindowWindowState(
      targetWindow,
      nextPaneCount,
      focusedStage,
      stageNavDirection,
    );

    return {
      ...nextWindowState,
      slidingWindowPaneCount: nextPaneCount,
    };
  }

  if (normalizedPaneCount <= 1 || currentWindow.length <= 1) {
    return {
      focusedStage,
      stageNavDirection,
      slidingWindowPaneCount: normalizedPaneCount,
    };
  }

  const targetWindow = currentWindow.slice(0, -1);
  const nextPaneCount = clampSlidingWindowPaneCount(normalizedPaneCount - 1);
  const nextWindowState = resolveSlidingWindowWindowState(
    targetWindow,
    nextPaneCount,
    focusedStage,
    stageNavDirection,
  );

  return {
    ...nextWindowState,
    slidingWindowPaneCount: nextPaneCount,
  };
}

function makePagesStageTabs(
  recentSessions: RecentPageSession[],
): PagesStageTab[] {
  return recentSessions.map((session) => ({
    id: `session:${session.id}`,
    kind: "session" as const,
    title: session.titleSnapshot || session.pageId,
    sessionId: session.id,
  }));
}

interface UseWorkbenchStateOptions {
  initialLayoutSnapshot?: WorkbenchLayoutSnapshot | null;
  projectsReady?: boolean;
}

export function useWorkbenchState(
  projects: Project[],
  options: UseWorkbenchStateOptions = {},
) {
  const [storedState, setStoredState] = useScopedAtom(workbenchStateAtom);
  const initialStateRef = useRef<WorkbenchState | null>(null);
  if (!initialStateRef.current) {
    initialStateRef.current = loadInitialState({
      layoutSnapshot: options.initialLayoutSnapshot,
    });
  }
  const initialState = initialStateRef.current;
  const hasReconciledProjectsRef = useRef(false);
  const state = storedState ?? initialState;
  const setState = useCallback((update: WorkbenchState | ((previous: WorkbenchState) => WorkbenchState)) => {
    setStoredState((current) => {
      const previous = current ?? initialState;
      return typeof update === "function" ? update(previous) : update;
    });
  }, [initialState, setStoredState]);

  useLayoutEffect(() => {
    setStoredState((current) => current ?? initialState);
  }, [initialState, setStoredState]);

  useEffect(() => {
    if (options.projectsReady === false) return;

    setState((prev) => {
      const projectIds = buildProjectIdSet(projects);
      const projectOrder = reconcileProjectOrder(prev.projectOrder, projects);
      const dbProjectId = resolveActiveProjectAfterCatalogChange(
        prev.dbProjectId,
        prev.projectOrder,
        projects,
        !hasReconciledProjectsRef.current,
      );
      const threadsProjectId = resolveActiveProjectAfterCatalogChange(
        prev.threadsProjectId,
        prev.projectOrder,
        projects,
        !hasReconciledProjectsRef.current,
      );

      const viewsByProject = pruneProjectRecord(prev.viewsByProject, projectIds);
      const searchByProject = pruneProjectRecord(prev.searchByProject, projectIds);
      const dbViewPrefsByProject = pruneProjectRecord(prev.dbViewPrefsByProject, projectIds);

      Object.keys(viewsByProject).forEach((projectId) => {
        if (projectIds.has(projectId)) return;
        delete viewsByProject[projectId];
      });

      Object.keys(searchByProject).forEach((projectId) => {
        if (projectIds.has(projectId)) return;
        delete searchByProject[projectId];
      });
      Object.keys(dbViewPrefsByProject).forEach((projectId) => {
        if (projectIds.has(projectId)) return;
        delete dbViewPrefsByProject[projectId];
      });

      projects.forEach((project) => {
        if (viewsByProject[project.id]) return;
        viewsByProject[project.id] = "kanban";
      });

      const recentPageSessions = pruneRecentSessions(prev.recentPageSessions, projectIds);

      const activeRecentSessionId =
        prev.activeRecentSessionId &&
        recentPageSessions.some((session) => session.id === prev.activeRecentSessionId)
          ? prev.activeRecentSessionId
          : null;

      const sidebarStageExpandedByProject = pruneProjectRecord(prev.sidebarStageExpandedByProject, projectIds);
      const sidebarSectionExpandedByProject = pruneProjectRecord(prev.sidebarSectionExpandedByProject, projectIds);
      const sidebarSectionShowAllByProject = pruneProjectRecord(prev.sidebarSectionShowAllByProject, projectIds);
      const slidingWindowPaneCount = clampSlidingWindowPaneCount(prev.slidingWindowPaneCount);

      Object.keys(sidebarStageExpandedByProject).forEach((projectId) => {
        if (!projectIds.has(projectId)) delete sidebarStageExpandedByProject[projectId];
      });
      Object.keys(sidebarSectionExpandedByProject).forEach((projectId) => {
        if (!projectIds.has(projectId)) delete sidebarSectionExpandedByProject[projectId];
      });
      Object.keys(sidebarSectionShowAllByProject).forEach((projectId) => {
        if (!projectIds.has(projectId)) delete sidebarSectionShowAllByProject[projectId];
      });

      projects.forEach((project) => {
        const projectId = project.id;
        sidebarStageExpandedByProject[projectId] = ensureSidebarStageState(
          sidebarStageExpandedByProject[projectId],
        );
        sidebarSectionExpandedByProject[projectId] = normalizeSidebarSectionStateByProject({
          [projectId]: sidebarSectionExpandedByProject[projectId],
        })[projectId] ?? {};
        sidebarSectionShowAllByProject[projectId] = normalizeSidebarSectionStateByProject({
          [projectId]: sidebarSectionShowAllByProject[projectId],
        })[projectId] ?? {};
      });

      const pagesTabs = makePagesStageTabs(recentPageSessions);
      const hasActivePagesTab =
        (prev.activePagesTabId === HISTORY_TAB_ID && pagesTabs.length > 0) ||
        pagesTabs.some((tab) => tab.id === prev.activePagesTabId);
      const activePagesTabId = hasActivePagesTab
        ? prev.activePagesTabId
        : pagesTabs[0]?.id ?? "";

      const threadsTabs = ensureThreadsTabs(prev.threadsTabs);
      const activeThreadsTabId = threadsTabs.some((tab) => tab.id === prev.activeThreadsTabId)
        ? prev.activeThreadsTabId
        : threadsTabs[0]?.id ?? "";

      const filesTabs = ensureFilesTabs(prev.filesTabs);
      const activeFilesTabId = filesTabs.some((tab) => tab.id === prev.activeFilesTabId)
        ? prev.activeFilesTabId
        : filesTabs[0]?.id ?? "diff";

      const stagePanelWidths = normalizeStagePanelWidths(prev.stagePanelWidths);
      const focusedStage = prev.focusedStage;
      const stageNavDirection = isStageDirection(prev.stageNavDirection) ? prev.stageNavDirection : "right";

      return {
        ...prev,
        projectOrder,
        dbProjectId,
        threadsProjectId,
        viewsByProject,
        searchByProject,
        dbViewPrefsByProject,
        recentPageSessions,
        activeRecentSessionId,
        focusedStage,
        stageNavDirection,
        sidebarStageExpandedByProject,
        sidebarSectionExpandedByProject,
        sidebarSectionShowAllByProject,
        activePagesTabId,
        threadsTabs,
        activeThreadsTabId,
        filesTabs,
        activeFilesTabId,
        stagePanelWidths,
        slidingWindowPaneCount,
      };
    });
    hasReconciledProjectsRef.current = true;
  }, [options.projectsReady, projects, setState]);

  useEffect(() => {
    writeJson(WORKBENCH_STORAGE_KEY, {
      dbProjectId: state.dbProjectId,
      threadsProjectId: state.threadsProjectId,
      viewsByProject: state.viewsByProject,
      searchByProject: state.searchByProject,
      projectOrder: state.projectOrder,
      activeRecentSessionId: state.activeRecentSessionId,
      focusedStage: state.focusedStage,
      stageNavDirection: state.stageNavDirection,
      sidebarStageExpandedByProject: state.sidebarStageExpandedByProject,
      sidebarSectionExpandedByProject: state.sidebarSectionExpandedByProject,
      sidebarSectionShowAllByProject: state.sidebarSectionShowAllByProject,
      activePagesTabId: state.activePagesTabId,
      threadsTabs: state.threadsTabs,
      activeThreadsTabId: state.activeThreadsTabId,
      filesTabs: state.filesTabs,
      activeFilesTabId: state.activeFilesTabId,
      stagePanelWidths: state.stagePanelWidths,
      slidingWindowPaneCount: state.slidingWindowPaneCount,
    } satisfies WorkbenchPrefs);

    writeJson(SIDEBAR_STORAGE_KEY, state.sidebar);
    writeNumberStorage(CODEX_SIDEBAR_WIDTH_STORAGE_KEY, state.sidebar.width);
    writeJson(DOCK_STORAGE_KEY, state.dock);
    writeJson(RECENT_STORAGE_KEY, state.recentPageSessions);
    writeJson(DB_VIEW_PREFS_STORAGE_KEY, state.dbViewPrefsByProject);
  }, [state]);

  const projectRefs = useMemo(
    () => state.projectOrder.map((projectId) => makeProjectRef(projectId)),
    [state.projectOrder],
  );

  const activeView = state.dbProjectId
    ? state.viewsByProject[state.dbProjectId] ?? "kanban"
    : "kanban";
  const activeSearchQuery = state.dbProjectId
    ? state.searchByProject[state.dbProjectId] ?? ""
    : "";
  const activeDbViewPrefs = viewSupportsDbViewPrefs(activeView)
    ? (state.dbProjectId
      ? state.dbViewPrefsByProject[state.dbProjectId]?.[activeView]
      : undefined) ?? getDefaultDbViewPrefs(activeView)
    : null;
  const focusedStage = state.focusedStage;
  const stageNavDirection = state.stageNavDirection;

  const pagesTabs = useMemo(
    () => makePagesStageTabs(state.recentPageSessions),
    [state.recentPageSessions],
  );
  const activePagesTabId = state.activePagesTabId;

  const threadsTabs = state.threadsTabs;
  const activeThreadsTabId = state.activeThreadsTabId;

  const filesTabs = state.filesTabs;
  const activeFilesTabId = state.activeFilesTabId;
  const stagePanelWidths = state.stagePanelWidths;
  const slidingWindowPaneCount = clampSlidingWindowPaneCount(state.slidingWindowPaneCount);

  const setDbProject = useCallback((projectId: string | null) => {
    setState((prev) => {
      if (prev.dbProjectId === projectId) return prev;
      return { ...prev, dbProjectId: projectId };
    });
  }, [setState]);

  const setThreadsProjectId = useCallback((projectId: string | null) => {
    setState((prev) => {
      if (prev.threadsProjectId === projectId) return prev;
      return { ...prev, threadsProjectId: projectId };
    });
  }, [setState]);

  const setView = useCallback((projectId: string, view: WorkbenchView) => {
    setState((prev) => {
      if (prev.viewsByProject[projectId] === view) return prev;
      return {
        ...prev,
        viewsByProject: {
          ...prev.viewsByProject,
          [projectId]: view,
        },
      };
    });
  }, [setState]);

  const setSearchQuery = useCallback((projectId: string, query: string) => {
    setState((prev) => {
      if (prev.searchByProject[projectId] === query) return prev;
      return {
        ...prev,
        searchByProject: {
          ...prev.searchByProject,
          [projectId]: query,
        },
      };
    });
  }, [setState]);

  const setDbViewPrefs = useCallback((
    projectId: string,
    view: SupportedDbView,
    update: (prev: DbViewPrefs) => DbViewPrefs,
  ) => {
    setState((prev) => {
      const current = prev.dbViewPrefsByProject[projectId]?.[view] ?? getDefaultDbViewPrefs(view);
      const nextPrefs = normalizeDbViewPrefs(view, update(cloneDbViewPrefs(current)));
      if (JSON.stringify(current) === JSON.stringify(nextPrefs)) return prev;

      return {
        ...prev,
        dbViewPrefsByProject: {
          ...prev.dbViewPrefsByProject,
          [projectId]: {
            ...prev.dbViewPrefsByProject[projectId],
            [view]: nextPrefs,
          },
        },
      };
    });
  }, [setState]);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setState((prev) => {
      if (prev.sidebar.collapsed === collapsed) return prev;
      return {
        ...prev,
        sidebar: {
          ...prev.sidebar,
          collapsed,
        },
      };
    });
  }, [setState]);

  const setSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampCodexSidebarWidth(width);
    setState((prev) => {
      if (prev.sidebar.width === nextWidth) return prev;
      return {
        ...prev,
        sidebar: {
          ...prev.sidebar,
          width: nextWidth,
        },
      };
    });
  }, [setState]);

  const setSidebarCollapsibleSectionCollapsed = useCallback((
    sectionId: SidebarCollapsibleSectionId,
    collapsed: boolean,
  ) => {
    setState((prev) => {
      if (prev.sidebar.collapsibleSections[sectionId] === collapsed) return prev;
      return {
        ...prev,
        sidebar: {
          ...prev.sidebar,
          collapsibleSections: {
            ...prev.sidebar.collapsibleSections,
            [sectionId]: collapsed,
          },
        },
      };
    });
  }, [setState]);

  const setDockWidth = useCallback((width: number) => {
    const nextWidth = clamp(width, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH);
    setState((prev) => {
      if (prev.dock.width === nextWidth) return prev;
      return {
        ...prev,
        dock: {
          ...prev.dock,
          width: nextWidth,
        },
      };
    });
  }, [setState]);

  const setDockTree = useCallback((tree: DockTreeNode) => {
    setState((prev) => ({
      ...prev,
      dock: {
        ...prev.dock,
        tree,
      },
    }));
  }, [setState]);

  const setFocusedStage = useCallback((
    _projectId: string,
    stageId: StageId,
    directionOverride?: StageNavDirection,
  ) => {
    setState((prev) => {
      const prevStage = prev.focusedStage;
      const prevIndex = stageIndexOf(prevStage);
      const nextIndex = stageIndexOf(stageId);
      const computedDirection =
        nextIndex === prevIndex
          ? prev.stageNavDirection
          : nextIndex > prevIndex
            ? "right"
            : "left";
      const direction = directionOverride ?? computedDirection;

      if (prevStage === stageId && prev.stageNavDirection === direction) {
        return prev;
      }

      return {
        ...prev,
        focusedStage: stageId,
        stageNavDirection: direction,
      };
    });
  }, [setState]);

  const focusAdjacentStage = useCallback((_projectId: string, direction: -1 | 1) => {
    setState((prev) => {
      const current = prev.focusedStage;
      const currentIndex = stageIndexOf(current);
      const nextIndex =
        direction > 0
          ? (currentIndex + 1) % STAGE_ORDER.length
          : (currentIndex - 1 + STAGE_ORDER.length) % STAGE_ORDER.length;
      const nextStage = STAGE_ORDER[nextIndex];

      return {
        ...prev,
        focusedStage: nextStage,
        stageNavDirection: direction > 0 ? "right" : "left",
      };
    });
  }, [setState]);

  const switchToStageIndex = useCallback((projectId: string, index: number) => {
    if (index < 0 || index >= STAGE_ORDER.length) return;
    setFocusedStage(projectId, STAGE_ORDER[index]);
  }, [setFocusedStage]);

  const setSidebarStageExpanded = useCallback((projectId: string, stageId: SidebarGroupId, expanded: boolean) => {
    setState((prev) => {
      const projectMap = ensureSidebarStageState(prev.sidebarStageExpandedByProject[projectId]);
      if (projectMap[stageId] === expanded) return prev;
      return {
        ...prev,
        sidebarStageExpandedByProject: {
          ...prev.sidebarStageExpandedByProject,
          [projectId]: {
            ...projectMap,
            [stageId]: expanded,
          },
        },
      };
    });
  }, [setState]);

  const setSidebarSectionExpanded = useCallback((projectId: string, sectionId: string, expanded: boolean) => {
    setState((prev) => {
      const projectMap = prev.sidebarSectionExpandedByProject[projectId] ?? {};
      if (projectMap[sectionId] === expanded) return prev;
      return {
        ...prev,
        sidebarSectionExpandedByProject: {
          ...prev.sidebarSectionExpandedByProject,
          [projectId]: {
            ...projectMap,
            [sectionId]: expanded,
          },
        },
      };
    });
  }, [setState]);

  const isSidebarSectionExpanded = useCallback((projectId: string, sectionId: string): boolean => {
    const value = state.sidebarSectionExpandedByProject[projectId]?.[sectionId];
    return typeof value === "boolean" ? value : false;
  }, [state.sidebarSectionExpandedByProject]);

  const setSidebarSectionShowAll = useCallback((projectId: string, sectionId: string, showAll: boolean) => {
    setState((prev) => {
      const projectMap = prev.sidebarSectionShowAllByProject[projectId] ?? {};
      if (projectMap[sectionId] === showAll) return prev;
      return {
        ...prev,
        sidebarSectionShowAllByProject: {
          ...prev.sidebarSectionShowAllByProject,
          [projectId]: {
            ...projectMap,
            [sectionId]: showAll,
          },
        },
      };
    });
  }, [setState]);

  const isSidebarSectionShowAll = useCallback((projectId: string, sectionId: string): boolean => {
    const value = state.sidebarSectionShowAllByProject[projectId]?.[sectionId];
    return typeof value === "boolean" ? value : false;
  }, [state.sidebarSectionShowAllByProject]);

  const setActivePagesTab = useCallback((_projectId: string, tabId: string) => {
    setState((prev) => {
      if (prev.activePagesTabId === tabId) return prev;
      return {
        ...prev,
        activePagesTabId: tabId,
      };
    });
  }, [setState]);

  const setActiveThreadsTab = useCallback((projectId: string, tabId: string) => {
    setState((prev) => {
      if (prev.activeThreadsTabId === tabId && prev.threadsProjectId === projectId) return prev;
      return {
        ...prev,
        threadsProjectId: projectId,
        activeThreadsTabId: tabId,
      };
    });
  }, [setState]);

  const setThreadsTabs = useCallback((projectId: string, tabs: ThreadsStageTab[]) => {
    const normalizedTabs = ensureThreadsTabs(tabs);
    setState((prev) => {
      if (projectId !== prev.threadsProjectId) return prev;
      const currentTabs = ensureThreadsTabs(prev.threadsTabs);
      const currentSignature = JSON.stringify(currentTabs);
      const nextSignature = JSON.stringify(normalizedTabs);
      if (currentSignature === nextSignature) return prev;

      const currentActive = prev.activeThreadsTabId;
      const hasActive = normalizedTabs.some((tab) => tab.id === currentActive);
      const nextActive = hasActive ? currentActive : normalizedTabs[0]?.id ?? "";

      return {
        ...prev,
        threadsTabs: normalizedTabs,
        activeThreadsTabId: nextActive,
      };
    });
  }, [setState]);

  const setActiveFilesTab = useCallback((_projectId: string, tabId: string) => {
    const normalizedTabId = tabId === "diff" ? tabId : "diff";
    setState((prev) => {
      if (prev.activeFilesTabId === normalizedTabId) return prev;
      return {
        ...prev,
        activeFilesTabId: normalizedTabId,
      };
    });
  }, [setState]);

  const setStagePanelWidths = useCallback((_projectId: string, widths: StagePanelWidths) => {
    setState((prev) => {
      if (typeof widths !== "object" || widths === null) return prev;

      const current = normalizeStagePanelWidths(prev.stagePanelWidths);
      const nextProjectWidths = { ...current };
      let changed = false;

      Object.entries(widths).forEach(([stageId, width]) => {
        if (!isStageId(stageId)) return;
        if (typeof width !== "number" || !Number.isFinite(width)) return;
        const nextWidth = clampStagePanelWidth(width, STAGE_PANEL_MIN_WIDTH, STAGE_PANEL_MAX_WIDTH);
        if (nextProjectWidths[stageId] === nextWidth) return;
        nextProjectWidths[stageId] = nextWidth;
        changed = true;
      });

      if (!changed) return prev;

      return {
        ...prev,
        stagePanelWidths: nextProjectWidths,
      };
    });
  }, [setState]);

  const setSlidingWindowPaneCount = useCallback((paneCount: number) => {
    const nextPaneCount = clampSlidingWindowPaneCount(paneCount);
    setState((prev) => {
      if (prev.slidingWindowPaneCount === nextPaneCount) return prev;
      return {
        ...prev,
        slidingWindowPaneCount: nextPaneCount,
      };
    });
  }, [setState]);

  const stepSlidingWindowPaneCount = useCallback((action: SlidingWindowPaneCountAction) => {
    setState((prev) => {
      const nextWindowState = resolveSlidingWindowPaneCountChange(
        prev.focusedStage,
        prev.stageNavDirection,
        prev.slidingWindowPaneCount,
        action,
      );

      if (
        prev.focusedStage === nextWindowState.focusedStage
        && prev.stageNavDirection === nextWindowState.stageNavDirection
        && prev.slidingWindowPaneCount === nextWindowState.slidingWindowPaneCount
      ) {
        return prev;
      }

      return {
        ...prev,
        focusedStage: nextWindowState.focusedStage,
        stageNavDirection: nextWindowState.stageNavDirection,
        slidingWindowPaneCount: nextWindowState.slidingWindowPaneCount,
      };
    });
  }, [setState]);

  const cycleProjects = useCallback((direction: -1 | 1) => {
    setState((prev) => {
      if (prev.projectOrder.length <= 1) return prev;
      if (!prev.dbProjectId) return prev;
      const currentIndex = prev.projectOrder.indexOf(prev.dbProjectId);
      if (currentIndex < 0) return prev;
      const nextIndex =
        direction > 0
          ? (currentIndex + 1) % prev.projectOrder.length
          : (currentIndex - 1 + prev.projectOrder.length) % prev.projectOrder.length;
      return {
        ...prev,
        dbProjectId: prev.projectOrder[nextIndex],
      };
    });
  }, [setState]);

  const switchToProjectIndex = useCallback((index: number) => {
    setState((prev) => {
      if (index < 0 || index >= prev.projectOrder.length) return prev;
      return { ...prev, dbProjectId: prev.projectOrder[index] };
    });
  }, [setState]);

  const recordRecentPageLeave = useCallback(
    (projectId: string, pageId: string, titleSnapshot: string): string | null => {
      let sessionId: string | null = null;
      setState((prev) => {
        const nextRecent = recordRecentPageLeaveInList(prev.recentPageSessions, projectId, pageId, titleSnapshot);
        const targetSession = findRecentPageSession(nextRecent, projectId, pageId);
        if (!targetSession) return prev;
        sessionId = targetSession.id;

        return {
          ...prev,
          recentPageSessions: nextRecent,
        };
      });

      return sessionId;
    },
    [setState],
  );

  const selectRecentPageSession = useCallback((sessionId: string) => {
    setState((prev) => {
      const target = prev.recentPageSessions.find((session) => session.id === sessionId);
      if (!target) return prev;

      return {
        ...prev,
        activeRecentSessionId: target.id,
        focusedStage: "pages",
        activePagesTabId: `session:${target.id}`,
      };
    });
  }, [setState]);

  const setActiveRecentPageSession = useCallback((sessionId: string | null) => {
    setState((prev) => {
      const target = sessionId
        ? prev.recentPageSessions.find((session) => session.id === sessionId) ?? null
        : null;
      const nextActiveRecentSessionId = target?.id ?? null;
      if (prev.activeRecentSessionId === nextActiveRecentSessionId) {
        return prev;
      }

      return {
        ...prev,
        activeRecentSessionId: nextActiveRecentSessionId,
      };
    });
  }, [setState]);

  const closeRecentPageSession = useCallback((sessionId: string) => {
    setState((prev) => {
      const closing = prev.recentPageSessions.find((session) => session.id === sessionId);
      const nextRecent = prev.recentPageSessions.filter((session) => session.id !== sessionId);
      if (nextRecent.length === prev.recentPageSessions.length) return prev;

      const nextActiveSessionId =
        prev.activeRecentSessionId === sessionId ? nextRecent[0]?.id ?? null : prev.activeRecentSessionId;

      const nextActivePagesTabId =
        closing && prev.activePagesTabId === `session:${sessionId}`
          ? (nextRecent[0] ? `session:${nextRecent[0].id}` : "")
          : prev.activePagesTabId;

      return {
        ...prev,
        activeRecentSessionId: nextActiveSessionId,
        recentPageSessions: nextRecent,
        activePagesTabId: nextActivePagesTabId,
      };
    });
  }, [setState]);

  const reorderRecentPageSessions = useCallback((orderedSessionIds: string[]) => {
    setState((prev) => {
      const nextRecent = reorderRecentPageSessionsInList(prev.recentPageSessions, orderedSessionIds);
      if (JSON.stringify(nextRecent.map((session) => session.id)) === JSON.stringify(prev.recentPageSessions.map((session) => session.id))) {
        return prev;
      }

      return {
        ...prev,
        recentPageSessions: nextRecent,
      };
    });
  }, [setState]);

  const setSessionView = useCallback((
    sessionId: string,
    update:
      | WorkbenchSessionViewSnapshot
      | ((previous: WorkbenchSessionViewSnapshot | undefined) => WorkbenchSessionViewSnapshot),
  ) => {
    setState((previous) => {
      const next = typeof update === "function"
        ? update(previous.sessionViewsBySessionId[sessionId])
        : update;
      if (next === previous.sessionViewsBySessionId[sessionId]) return previous;
      return {
        ...previous,
        sessionViewsBySessionId: {
          ...previous.sessionViewsBySessionId,
          [sessionId]: next,
        },
      };
    });
  }, [setState]);

  const removeSessionView = useCallback((sessionId: string) => {
    setState((previous) => {
      if (!previous.sessionViewsBySessionId[sessionId]) return previous;
      const sessionViewsBySessionId = { ...previous.sessionViewsBySessionId };
      delete sessionViewsBySessionId[sessionId];
      return { ...previous, sessionViewsBySessionId };
    });
  }, [setState]);

  const isSidebarStageExpanded = useCallback(
    (projectId: string, stageId: SidebarGroupId): boolean => {
      const value = state.sidebarStageExpandedByProject[projectId]?.[stageId];
      return typeof value === "boolean" ? value : true;
    },
    [state.sidebarStageExpandedByProject],
  );

  const buildLayoutSnapshot = useCallback((
    pageStage: WorkbenchLayoutSnapshot["pageStage"],
    activeProjectSessionId: string | null = null,
  ): WorkbenchLayoutSnapshot => ({
    version: 3,
    dbProjectId: state.dbProjectId,
    activeProjectSessionId,
    threadsProjectId: state.threadsProjectId,
    viewsByProject: state.viewsByProject,
    searchByProject: state.searchByProject,
    dbViewPrefsByProject: state.dbViewPrefsByProject,
    projectOrder: state.projectOrder,
    focusedStage: state.focusedStage,
    stageNavDirection: state.stageNavDirection,
    sidebar: state.sidebar,
    dock: state.dock,
    sidebarStageExpandedByProject: state.sidebarStageExpandedByProject as Record<string, Record<string, boolean>>,
    sidebarSectionExpandedByProject: state.sidebarSectionExpandedByProject,
    sidebarSectionShowAllByProject: state.sidebarSectionShowAllByProject,
    activePagesTabId: state.activePagesTabId,
    activeRecentSessionId: state.activeRecentSessionId,
    recentPageSessions: state.recentPageSessions,
    pageStage,
    threadsTabs: state.threadsTabs,
    activeThreadsTabId: state.activeThreadsTabId,
    filesTabs: state.filesTabs,
    activeFilesTabId: state.activeFilesTabId,
    stagePanelWidths: state.stagePanelWidths as Record<string, number>,
    slidingWindowPaneCount: state.slidingWindowPaneCount,
    sessionViewsBySessionId: state.sessionViewsBySessionId,
  }), [state]);

  const replaceLayoutSnapshot = useCallback((layoutSnapshot: WorkbenchLayoutSnapshot) => {
    setState(loadInitialState({ layoutSnapshot }));
  }, [setState]);

  return {
    dbProjectId: state.dbProjectId,
    activeProjectId: state.dbProjectId,
    threadsProjectId: state.threadsProjectId,
    projectRefs,
    activeView,
    activeSearchQuery,
    activeDbViewPrefs,
    viewsByProject: state.viewsByProject,
    searchByProject: state.searchByProject,
    dbViewPrefsByProject: state.dbViewPrefsByProject,
    sidebar: state.sidebar,
    dock: state.dock,
    recentPageSessions: state.recentPageSessions,
    activeRecentSessionId: state.activeRecentSessionId,
    focusedStage,
    stageNavDirection,
    pagesTabs,
    activePagesTabId,
    threadsTabs,
    activeThreadsTabId,
    filesTabs,
    activeFilesTabId,
    stagePanelWidths,
    slidingWindowPaneCount,
    sessionViewsBySessionId: state.sessionViewsBySessionId,
    setDbProject,
    setActiveProject: setDbProject,
    setThreadsProjectId,
    setView,
    setSearchQuery,
    setDbViewPrefs,
    setSidebarCollapsed,
    setSidebarWidth,
    setSidebarCollapsibleSectionCollapsed,
    setDockWidth,
    setDockTree,
    setFocusedStage,
    focusAdjacentStage,
    switchToStageIndex,
    setSidebarStageExpanded,
    isSidebarStageExpanded,
    setSidebarSectionExpanded,
    isSidebarSectionExpanded,
    setSidebarSectionShowAll,
    isSidebarSectionShowAll,
    setActivePagesTab,
    setActiveThreadsTab,
    setThreadsTabs,
    setActiveFilesTab,
    setStagePanelWidths,
    setSlidingWindowPaneCount,
    stepSlidingWindowPaneCount,
    cycleProjects,
    switchToProjectIndex,
    recordRecentPageLeave,
    selectRecentPageSession,
    setActiveRecentPageSession,
    closeRecentPageSession,
    reorderRecentPageSessions,
    setSessionView,
    removeSessionView,
    buildLayoutSnapshot,
    replaceLayoutSnapshot,
  };
}

export const workbenchStorageKeys = {
  workbench: WORKBENCH_STORAGE_KEY,
  sidebar: SIDEBAR_STORAGE_KEY,
  dock: DOCK_STORAGE_KEY,
  recent: RECENT_STORAGE_KEY,
  dbViewPrefs: DB_VIEW_PREFS_STORAGE_KEY,
};

export const workbenchTestHelpers = {
  clamp,
  isWorkbenchView,
  normalizeViewMap,
  normalizeSearchMap,
  normalizeDbViewPrefsMap,
  normalizeProjectOrder,
  normalizeRecentSessions,
  findRecentPageSession,
  resolvePagesStageSelectionForPage,
  recordRecentPageLeaveInList,
  reorderRecentPageSessionsInList,
  normalizeStageMap,
  clampSlidingWindowPaneCount,
  normalizeSlidingWindowPaneCount,
  resolvePersistedSlidingWindowPaneCount,
  reconcileProjectOrder,
  resolveActiveProjectAfterCatalogChange,
  loadInitialState,
  makeProjectRef,
  resolveExpandedStages,
  resolveNearestSlidingWindowDirection,
  resolveSlidingWindowFocusIntent,
  resolveSlidingWindowShift,
  resolveEffectiveSlidingWindowPaneCount,
  resolveSlidingWindowPaneCountChange,
};
