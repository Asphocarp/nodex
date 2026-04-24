import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { dirname, join } from "path";
import type { WorkbenchResumeSnapshot } from "../shared/workbench-resume";
import { normalizeProjectIcon } from "../shared/project-icon";
import type {
  WorkbenchLayoutSnapshot,
  WorkspaceBootstrap,
  WorkspaceCatalog,
  WorkspaceRecord,
} from "../shared/workspace";
import {
  WorkbenchLayoutSnapshotSchema,
  WorkspaceCatalogSchema,
} from "../shared/schemas/workspace";

const WORKSPACE_FILE_NAME = "workspaces-v1.json";
const WORKSPACE_VERSION = 1;
const DEFAULT_WORKSPACE_ID = "default";

function nowIso(): string {
  return new Date().toISOString();
}

function makeDefaultDockTree(): WorkbenchLayoutSnapshot["dock"]["tree"] {
  return {
    type: "leaf",
    id: randomUUID(),
    tabs: [
      { id: "cardstage", kind: "cardstage", title: "Card" },
      { id: "terminal", kind: "terminal", title: "Terminal" },
      { id: "history", kind: "history", title: "History" },
    ],
    activeTabId: "cardstage",
  };
}

export function createDefaultWorkbenchLayoutSnapshot(
  legacyResumeSnapshot: WorkbenchResumeSnapshot | null = null,
): WorkbenchLayoutSnapshot {
  return {
    version: WORKSPACE_VERSION,
    dbProjectId: legacyResumeSnapshot?.dbProjectId ?? DEFAULT_WORKSPACE_ID,
    threadsProjectId: legacyResumeSnapshot?.threadsProjectId ?? legacyResumeSnapshot?.dbProjectId ?? DEFAULT_WORKSPACE_ID,
    viewsByProject: legacyResumeSnapshot?.viewsByProject ?? {},
    searchByProject: {},
    dbViewPrefsByProject: {},
    spaceOrder: [],
    focusedStage: legacyResumeSnapshot?.focusedStage ?? "db",
    stageNavDirection: legacyResumeSnapshot?.stageNavDirection ?? "right",
    stageRailLayoutMode: "sliding-window",
    sidebar: {
      collapsed: false,
      width: 280,
      topLevelSectionOrder: [],
      topLevelSections: {},
    },
    dock: {
      width: 560,
      tree: makeDefaultDockTree(),
    },
    sidebarStageExpandedByProject: {},
    sidebarSectionExpandedByProject: {},
    sidebarSectionShowAllByProject: {},
    activeCardsTabId: legacyResumeSnapshot?.activeCardsTabId ?? "",
    activeRecentSessionId: legacyResumeSnapshot?.activeRecentSessionId ?? null,
    recentCardSessions: legacyResumeSnapshot?.recentCardSessions ?? [],
    cardStage: legacyResumeSnapshot?.cardStage ?? {
      open: false,
      projectId: "",
      cardId: null,
    },
    threadsTabs: [],
    activeThreadsTabId: legacyResumeSnapshot?.activeThreadsTabId ?? "thread:new",
    terminalTabs: [],
    activeTerminalTabId: "",
    filesTabs: [{ id: "diff", title: "Diffs" }],
    activeFilesTabId: "diff",
    stagePanelWidths: {},
    stageCollapsed: { files: true },
    slidingWindowPaneCount: 2,
    terminalPanelOpen: false,
    terminalPanelHeight: 260,
  };
}

function normalizeLayout(value: unknown, fallback: WorkbenchLayoutSnapshot): WorkbenchLayoutSnapshot {
  const parsed = WorkbenchLayoutSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function normalizeWorkspaceIcon(value: unknown): string | undefined {
  return normalizeProjectIcon(value) || undefined;
}

function normalizeCatalog(value: unknown, fallbackLayout: WorkbenchLayoutSnapshot): WorkspaceCatalog | null {
  const parsed = WorkspaceCatalogSchema.safeParse(value);
  if (!parsed.success) return null;

  const seen = new Set<string>();
  const workspaces = parsed.data.workspaces.filter((workspace) => {
    if (seen.has(workspace.id)) return false;
    seen.add(workspace.id);
    return true;
  });
  if (workspaces.length === 0) return null;

  const lastActiveWorkspaceId = workspaces.some((workspace) => workspace.id === parsed.data.lastActiveWorkspaceId)
    ? parsed.data.lastActiveWorkspaceId
    : workspaces[0].id;

  return {
    version: WORKSPACE_VERSION,
    lastActiveWorkspaceId,
    workspaces: workspaces.map((workspace) => {
      const normalizedIcon = normalizeWorkspaceIcon(workspace.icon);
      const normalizedWorkspace = {
        ...workspace,
        layout: normalizeLayout(workspace.layout, fallbackLayout),
      };
      delete normalizedWorkspace.icon;
      return normalizedIcon
        ? { ...normalizedWorkspace, icon: normalizedIcon }
        : normalizedWorkspace;
    }),
  };
}

function makeDefaultWorkspace(legacyResumeSnapshot: WorkbenchResumeSnapshot | null): WorkspaceRecord {
  const timestamp = nowIso();
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: "Default",
    createdAt: timestamp,
    updatedAt: timestamp,
    layout: createDefaultWorkbenchLayoutSnapshot(legacyResumeSnapshot),
  };
}

export class WorkspaceState {
  private readonly statePath: string;
  private readonly readLegacyResumeSnapshot: () => WorkbenchResumeSnapshot | null;

  constructor(
    userDataPath: string,
    readLegacyResumeSnapshot: () => WorkbenchResumeSnapshot | null = () => null,
  ) {
    this.statePath = join(userDataPath, WORKSPACE_FILE_NAME);
    this.readLegacyResumeSnapshot = readLegacyResumeSnapshot;
  }

  bootstrap(): WorkspaceBootstrap {
    const catalog = this.readOrCreateCatalog();
    const activeWorkspace = this.resolveActiveWorkspace(catalog);
    return { catalog, activeWorkspace };
  }

  createWorkspace(name: string, layout: WorkbenchLayoutSnapshot, icon?: string | null): WorkspaceBootstrap {
    const catalog = this.readOrCreateCatalog();
    const timestamp = nowIso();
    const normalizedName = name.trim() || "Workspace";
    const normalizedIcon = normalizeWorkspaceIcon(icon);
    const workspace: WorkspaceRecord = {
      id: `workspace-${randomUUID()}`,
      name: normalizedName,
      ...(normalizedIcon ? { icon: normalizedIcon } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      layout: normalizeLayout(layout, createDefaultWorkbenchLayoutSnapshot()),
    };
    const nextCatalog: WorkspaceCatalog = {
      version: WORKSPACE_VERSION,
      lastActiveWorkspaceId: workspace.id,
      workspaces: [...catalog.workspaces, workspace],
    };
    this.writeCatalog(nextCatalog);
    return { catalog: nextCatalog, activeWorkspace: workspace };
  }

  renameWorkspace(workspaceId: string, name: string, icon?: string | null): WorkspaceBootstrap {
    const catalog = this.readOrCreateCatalog();
    const normalizedName = name.trim();
    if (!normalizedName) return this.bootstrap();

    const timestamp = nowIso();
    const nextCatalog: WorkspaceCatalog = {
      ...catalog,
      workspaces: catalog.workspaces.map((workspace) => {
        if (workspace.id !== workspaceId) return workspace;

        const normalizedIcon = icon === undefined
          ? normalizeWorkspaceIcon(workspace.icon)
          : normalizeWorkspaceIcon(icon);
        const renamedWorkspace = {
          ...workspace,
          name: normalizedName,
          updatedAt: timestamp,
        };
        delete renamedWorkspace.icon;
        return normalizedIcon
          ? { ...renamedWorkspace, icon: normalizedIcon }
          : renamedWorkspace;
      }),
    };
    this.writeCatalog(nextCatalog);
    return { catalog: nextCatalog, activeWorkspace: this.resolveActiveWorkspace(nextCatalog) };
  }

  deleteWorkspace(workspaceId: string): WorkspaceBootstrap {
    const catalog = this.readOrCreateCatalog();
    if (catalog.workspaces.length <= 1) return this.bootstrap();

    const nextWorkspaces = catalog.workspaces.filter((workspace) => workspace.id !== workspaceId);
    if (nextWorkspaces.length === catalog.workspaces.length) return this.bootstrap();

    const lastActiveWorkspaceId = catalog.lastActiveWorkspaceId === workspaceId
      ? nextWorkspaces[0].id
      : catalog.lastActiveWorkspaceId;
    const nextCatalog: WorkspaceCatalog = {
      version: WORKSPACE_VERSION,
      lastActiveWorkspaceId,
      workspaces: nextWorkspaces,
    };
    this.writeCatalog(nextCatalog);
    return { catalog: nextCatalog, activeWorkspace: this.resolveActiveWorkspace(nextCatalog) };
  }

  saveLayout(workspaceId: string, layout: WorkbenchLayoutSnapshot): WorkspaceBootstrap {
    const catalog = this.readOrCreateCatalog();
    const timestamp = nowIso();
    const fallbackLayout = createDefaultWorkbenchLayoutSnapshot();
    const nextCatalog: WorkspaceCatalog = {
      ...catalog,
      workspaces: catalog.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, updatedAt: timestamp, layout: normalizeLayout(layout, fallbackLayout) }
          : workspace
      ),
    };
    this.writeCatalog(nextCatalog);
    return { catalog: nextCatalog, activeWorkspace: this.resolveActiveWorkspace(nextCatalog) };
  }

  setActive(workspaceId: string): WorkspaceBootstrap {
    const catalog = this.readOrCreateCatalog();
    const nextActiveWorkspaceId = catalog.workspaces.some((workspace) => workspace.id === workspaceId)
      ? workspaceId
      : catalog.lastActiveWorkspaceId;
    const nextCatalog: WorkspaceCatalog = {
      ...catalog,
      lastActiveWorkspaceId: nextActiveWorkspaceId,
    };
    this.writeCatalog(nextCatalog);
    return { catalog: nextCatalog, activeWorkspace: this.resolveActiveWorkspace(nextCatalog) };
  }

  readCatalog(): WorkspaceCatalog | null {
    try {
      const raw = readFileSync(this.statePath, "utf8");
      return normalizeCatalog(JSON.parse(raw), createDefaultWorkbenchLayoutSnapshot());
    } catch {
      return null;
    }
  }

  private readOrCreateCatalog(): WorkspaceCatalog {
    const existing = this.readCatalog();
    if (existing) return existing;

    const defaultWorkspace = makeDefaultWorkspace(this.readLegacyResumeSnapshot());
    const catalog: WorkspaceCatalog = {
      version: WORKSPACE_VERSION,
      lastActiveWorkspaceId: defaultWorkspace.id,
      workspaces: [defaultWorkspace],
    };
    this.writeCatalog(catalog);
    return catalog;
  }

  private resolveActiveWorkspace(catalog: WorkspaceCatalog): WorkspaceRecord {
    return catalog.workspaces.find((workspace) => workspace.id === catalog.lastActiveWorkspaceId)
      ?? catalog.workspaces[0];
  }

  private writeCatalog(catalog: WorkspaceCatalog): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(catalog, null, 2), "utf8");
  }
}

export const workspaceStateTestHelpers = {
  createDefaultWorkbenchLayoutSnapshot,
  normalizeCatalog,
};
