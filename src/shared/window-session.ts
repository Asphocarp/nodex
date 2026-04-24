import type {
  WorkbenchLayoutSnapshot,
  WorkspaceCatalog,
  WorkspaceRecord,
} from "./workspace";

export type WindowRestorePolicy = "all" | "last-window" | "none";

export interface WindowRestoreSettings {
  policy: WindowRestorePolicy;
}

export interface UpdateWindowRestoreSettingsInput {
  policy: WindowRestorePolicy;
}

export interface WindowSessionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: "normal" | "maximized" | "fullscreen";
}

export interface WindowSessionRecord {
  id: string;
  workspaceId: string;
  layout: WorkbenchLayoutSnapshot;
  createdAt: string;
  updatedAt: string;
  focusedAt: string;
  bounds?: WindowSessionBounds;
}

export interface WindowSessionCatalog {
  version: 1;
  lastActiveSessionId: string;
  sessions: WindowSessionRecord[];
}

export interface WindowSessionBootstrap {
  catalog: WorkspaceCatalog;
  activeWorkspace: WorkspaceRecord;
  session: WindowSessionRecord;
}

export interface WindowSessionSeed {
  workspaceId?: string;
  layout?: WorkbenchLayoutSnapshot;
}
