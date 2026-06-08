export type WorkbenchLayoutView = "kanban" | "list" | "toggle-list" | "canvas" | "calendar";
export type WorkbenchLayoutStageId = "db" | "cards" | "threads" | "files";
export type WorkbenchLayoutStageNavDirection = "left" | "right";

export interface WorkbenchRecentCardSession {
  id: string;
  projectId: string;
  cardId: string;
  titleSnapshot: string;
  lastOpenedAt: string;
}

export interface WorkbenchLayoutCardStageState {
  open: boolean;
  projectId: string;
  cardId: string | null;
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
  topLevelSectionOrder: string[];
  topLevelSections: Record<string, unknown>;
}

export interface WorkbenchLayoutDockSnapshot {
  width: number;
  tree: unknown;
}

export interface WorkbenchLayoutSnapshot {
  version: 1;
  dbProjectId: string;
  threadsProjectId: string;
  viewsByProject: Record<string, WorkbenchLayoutView>;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<string, unknown>;
  spaceOrder: string[];
  focusedStage: WorkbenchLayoutStageId;
  stageNavDirection: WorkbenchLayoutStageNavDirection;
  sidebar: WorkbenchLayoutSidebarSnapshot;
  dock: WorkbenchLayoutDockSnapshot;
  sidebarStageExpandedByProject: Record<string, Record<string, boolean>>;
  sidebarSectionExpandedByProject: Record<string, Record<string, boolean>>;
  sidebarSectionShowAllByProject: Record<string, Record<string, boolean>>;
  activeCardsTabId: string;
  activeRecentSessionId: string | null;
  recentCardSessions: WorkbenchRecentCardSession[];
  cardStage: WorkbenchLayoutCardStageState;
  threadsTabs: WorkbenchLayoutThreadsStageTab[];
  activeThreadsTabId: string;
  filesTabs: WorkbenchLayoutFilesStageTab[];
  activeFilesTabId: string;
  stagePanelWidths: Record<string, number>;
  slidingWindowPaneCount: number;
}

function createDefaultDockTree(): WorkbenchLayoutSnapshot["dock"]["tree"] {
  return {
    type: "leaf",
    id: globalThis.crypto?.randomUUID?.() ?? "default-dock",
    tabs: [
      { id: "cardstage", kind: "cardstage", title: "Card" },
      { id: "history", kind: "history", title: "History" },
    ],
    activeTabId: "cardstage",
  };
}

export function createDefaultWorkbenchLayoutSnapshot(): WorkbenchLayoutSnapshot {
  return {
    version: 1,
    dbProjectId: "default",
    threadsProjectId: "default",
    viewsByProject: {},
    searchByProject: {},
    dbViewPrefsByProject: {},
    spaceOrder: [],
    focusedStage: "db",
    stageNavDirection: "right",
    sidebar: {
      collapsed: false,
      width: 280,
      topLevelSectionOrder: [],
      topLevelSections: {},
    },
    dock: {
      width: 560,
      tree: createDefaultDockTree(),
    },
    sidebarStageExpandedByProject: {},
    sidebarSectionExpandedByProject: {},
    sidebarSectionShowAllByProject: {},
    activeCardsTabId: "",
    activeRecentSessionId: null,
    recentCardSessions: [],
    cardStage: {
      open: false,
      projectId: "",
      cardId: null,
    },
    threadsTabs: [],
    activeThreadsTabId: "thread:new",
    filesTabs: [{ id: "diff", title: "Diffs" }],
    activeFilesTabId: "diff",
    stagePanelWidths: {},
    slidingWindowPaneCount: 2,
  };
}
