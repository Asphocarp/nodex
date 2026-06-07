import type {
  WorkbenchRecentCardSession,
  WorkbenchResumeCardStageState,
  WorkbenchResumeStageId,
  WorkbenchResumeStageNavDirection,
  WorkbenchResumeView,
} from "./workbench-resume";

export interface WorkbenchLayoutThreadsStageTab {
  id: string;
  title: string;
  preview: string;
}

export interface WorkbenchLayoutTerminalStageTab {
  id: string;
  kind: "project" | "card";
  projectId: string;
  title: string;
  sessionId: string;
  cardId?: string;
  sessionRefId?: string;
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
  viewsByProject: Record<string, WorkbenchResumeView>;
  searchByProject: Record<string, string>;
  dbViewPrefsByProject: Record<string, unknown>;
  spaceOrder: string[];
  focusedStage: WorkbenchResumeStageId;
  stageNavDirection: WorkbenchResumeStageNavDirection;
  sidebar: WorkbenchLayoutSidebarSnapshot;
  dock: WorkbenchLayoutDockSnapshot;
  sidebarStageExpandedByProject: Record<string, Record<string, boolean>>;
  sidebarSectionExpandedByProject: Record<string, Record<string, boolean>>;
  sidebarSectionShowAllByProject: Record<string, Record<string, boolean>>;
  activeCardsTabId: string;
  activeRecentSessionId: string | null;
  recentCardSessions: WorkbenchRecentCardSession[];
  cardStage: WorkbenchResumeCardStageState;
  threadsTabs: WorkbenchLayoutThreadsStageTab[];
  activeThreadsTabId: string;
  terminalTabs: WorkbenchLayoutTerminalStageTab[];
  activeTerminalTabId: string;
  filesTabs: WorkbenchLayoutFilesStageTab[];
  activeFilesTabId: string;
  stagePanelWidths: Record<string, number>;
  slidingWindowPaneCount: number;
  terminalPanelOpen: boolean;
  terminalPanelHeight: number;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
  layout: WorkbenchLayoutSnapshot;
}

export interface WorkspaceCatalog {
  version: 1;
  lastActiveWorkspaceId: string;
  workspaces: WorkspaceRecord[];
}

export interface WorkspaceBootstrap {
  catalog: WorkspaceCatalog;
  activeWorkspace: WorkspaceRecord;
}
