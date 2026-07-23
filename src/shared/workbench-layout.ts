import type { WorkbenchSessionViewSnapshot } from "./workbench-session-view";

export type WorkbenchLayoutView = "kanban" | "list" | "toggle-list" | "canvas" | "calendar";
export type WorkbenchLayoutStageId = "db" | "pages" | "threads" | "files";
export type WorkbenchLayoutStageNavDirection = "left" | "right";

export interface WorkbenchRecentPageSession {
  id: string;
  projectId: string;
  pageId: string;
  titleSnapshot: string;
  lastOpenedAt: string;
}

export interface WorkbenchLayoutPageStageState {
  open: boolean;
  projectId: string;
  pageId: string | null;
}

export interface WorkbenchLayoutThreadsStageTab {
  id: string;
  title: string;
  preview: string;
}

export interface WorkbenchLayoutFilesStageTab {
  id: "diff";
  title: string;
}

export interface WorkbenchLayoutSidebarSnapshot {
  collapsed: boolean;
  width: number;
  collapsibleSections: Record<string, unknown>;
}

export interface WorkbenchLayoutDockSnapshot {
  width: number;
  tree: unknown;
}

export interface WorkbenchLayoutSnapshot {
  version: 3;
  dbProjectId: string | null;
  activeProjectSessionId: string | null;
  threadsProjectId: string | null;
  viewsByProject: Record<string, WorkbenchLayoutView>;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<string, unknown>;
  projectOrder: string[];
  focusedStage: WorkbenchLayoutStageId;
  stageNavDirection: WorkbenchLayoutStageNavDirection;
  sidebar: WorkbenchLayoutSidebarSnapshot;
  dock: WorkbenchLayoutDockSnapshot;
  sidebarStageExpandedByProject: Record<string, Record<string, boolean>>;
  sidebarSectionExpandedByProject: Record<string, Record<string, boolean>>;
  sidebarSectionShowAllByProject: Record<string, Record<string, boolean>>;
  activePagesTabId: string;
  activeRecentSessionId: string | null;
  recentPageSessions: WorkbenchRecentPageSession[];
  pageStage: WorkbenchLayoutPageStageState;
  threadsTabs: WorkbenchLayoutThreadsStageTab[];
  activeThreadsTabId: string;
  filesTabs: WorkbenchLayoutFilesStageTab[];
  activeFilesTabId: string;
  stagePanelWidths: Record<string, number>;
  slidingWindowPaneCount: number;
  sessionViewsBySessionId: Record<string, WorkbenchSessionViewSnapshot>;
}

function createDefaultDockTree(): WorkbenchLayoutSnapshot["dock"]["tree"] {
  return {
    type: "leaf",
    id: globalThis.crypto?.randomUUID?.() ?? "default-dock",
    tabs: [
      { id: "pagestage", kind: "pagestage", title: "Page" },
      { id: "history", kind: "history", title: "History" },
    ],
    activeTabId: "pagestage",
  };
}

export function createDefaultWorkbenchLayoutSnapshot(): WorkbenchLayoutSnapshot {
  return {
    version: 3,
    dbProjectId: null,
    activeProjectSessionId: null,
    threadsProjectId: null,
    viewsByProject: {},
    searchByProject: {},
    dbViewPrefsByProject: {},
    projectOrder: [],
    focusedStage: "db",
    stageNavDirection: "right",
    sidebar: {
      collapsed: false,
      width: 300,
      collapsibleSections: {},
    },
    dock: {
      width: 560,
      tree: createDefaultDockTree(),
    },
    sidebarStageExpandedByProject: {},
    sidebarSectionExpandedByProject: {},
    sidebarSectionShowAllByProject: {},
    activePagesTabId: "",
    activeRecentSessionId: null,
    recentPageSessions: [],
    pageStage: {
      open: false,
      projectId: "",
      pageId: null,
    },
    threadsTabs: [],
    activeThreadsTabId: "thread:new",
    filesTabs: [{ id: "diff", title: "Diffs" }],
    activeFilesTabId: "diff",
    stagePanelWidths: {},
    slidingWindowPaneCount: 2,
    sessionViewsBySessionId: {},
  };
}
