import { randomUUID } from "node:crypto";

import type {
  PanelId,
  Project,
  ProjectCreateInput,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
  ProjectSession,
  ProjectSessionCreateInput,
  ProjectSessionListOptions,
  ProjectSessionPinnedInput,
  ProjectSessionPinnedOrderInput,
  ProjectSessionPanelActivateInput,
  ProjectSessionPanelEnsureRightLeafInput,
  ProjectSessionPanelEnsureRightLeafResult,
  ProjectSessionPanelMaximizeInput,
  ProjectSessionPanelMergeInput,
  ProjectSessionPanelResizeInput,
  ProjectSessionPanelSplitInput,
  ProjectSessionSummary,
  ProjectSessionTab,
  ProjectSessionTabCreateInput,
  ProjectSessionTabReorderInput,
  ProjectSessionTabUpdateInput,
  ProjectSessionThreadLink,
  ProjectSessionUnreadInput,
  ProjectUpdateInput,
} from "../../shared/types";
import {
  ProjectSessionPanelActivateInputSchema,
  ProjectSessionPanelEnsureRightLeafInputSchema,
  ProjectSessionPanelMaximizeInputSchema,
  ProjectSessionPanelMergeInputSchema,
  ProjectSessionPanelResizeInputSchema,
  ProjectSessionPanelSplitInputSchema,
  ProjectSessionTabCreateInputSchema,
  ProjectSessionTabReorderInputSchema,
  ProjectSessionPanelsSchema,
  parseProjectSessionTabConfig,
} from "../../shared/schemas/project-sessions";
import {
  activateProjectSessionPanelLeaf,
  findNearestProjectSessionPanelLeafToRight,
  findProjectSessionPanelLeaf,
  getProjectSessionPanelActiveLeaf,
  insertProjectSessionPanelLeaf,
  listProjectSessionPanelLeaves,
  mergeProjectSessionPanelLeaf,
  normalizeProjectSessionPanelLayout,
  pruneEmptyProjectSessionPanelLeaves,
  reorderProjectSessionPanelLeafTabs,
  setProjectSessionPanelBranchRatio,
  setProjectSessionPanelMaximizedLeaf,
  splitProjectSessionPanelLeaf,
} from "../../shared/project-session-panel-layout";
import { CoreModuleResponseError } from "./core-client";
import type {
  CoreClientPort,
  ProjectWorkspaceReadSnapshot,
} from "./types";

type CoreProject = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "startup" }
>["projects"][number];
type CoreSessionSummary = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "sessions" }
>["sessions"][number];
type CoreSessionTab = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "session" }
>["tabs"][number];
type CoreThread = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "thread" }
>["thread"];

export interface DesktopProjectWorkspacePort {
  listProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project | null>;
  createProject(input: ProjectCreateInput): Promise<Project>;
  updateProject(
    projectId: string,
    input: ProjectUpdateInput,
  ): Promise<Project | null>;
  reorderProjects(input: ProjectOrderInput): Promise<Project[]>;
  setProjectPinned(
    projectId: string,
    input: ProjectPinnedInput,
  ): Promise<Project | null>;
  setPinnedProjectOrder(input: ProjectPinnedOrderInput): Promise<Project[]>;
  deleteProject(projectId: string): Promise<boolean>;
  listProjectSessions(
    projectId: string | null,
    options?: ProjectSessionListOptions,
  ): Promise<ProjectSession[]>;
  listProjectSessionSummaries(
    projectId: string | null,
    options?: ProjectSessionListOptions,
  ): Promise<ProjectSessionSummary[]>;
  getProjectSession(sessionId: string): Promise<ProjectSession | null>;
  createProjectSession(input: ProjectSessionCreateInput): Promise<ProjectSession>;
  deleteProjectSession(sessionId: string): Promise<boolean>;
  reorderProjectSessions(
    projectId: string,
    orderedSessionIds: string[],
  ): Promise<ProjectSession[]>;
  setProjectSessionPinned(
    sessionId: string,
    input: ProjectSessionPinnedInput,
  ): Promise<ProjectSession | null>;
  setPinnedProjectSessionOrder(
    projectId: string,
    input: ProjectSessionPinnedOrderInput,
  ): Promise<ProjectSession[]>;
  archiveProjectSession(sessionId: string): Promise<ProjectSession | null>;
  unarchiveProjectSession(sessionId: string): Promise<ProjectSession | null>;
  markProjectSessionUnread(
    sessionId: string,
    input: ProjectSessionUnreadInput,
  ): Promise<ProjectSession | null>;
  createProjectSessionTab(
    input: ProjectSessionTabCreateInput,
  ): Promise<ProjectSessionTab>;
  splitProjectSessionPanelGroup(
    input: ProjectSessionPanelSplitInput,
  ): Promise<ProjectSession | null>;
  ensureProjectSessionPanelLeafToRight(
    input: ProjectSessionPanelEnsureRightLeafInput,
  ): Promise<ProjectSessionPanelEnsureRightLeafResult | null>;
  mergeProjectSessionPanelGroup(
    input: ProjectSessionPanelMergeInput,
  ): Promise<ProjectSession | null>;
  activateProjectSessionPanelGroup(
    input: ProjectSessionPanelActivateInput,
  ): Promise<ProjectSession | null>;
  resizeProjectSessionPanelGroup(
    input: ProjectSessionPanelResizeInput,
  ): Promise<ProjectSession | null>;
  maximizeProjectSessionPanelGroup(
    input: ProjectSessionPanelMaximizeInput,
  ): Promise<ProjectSession | null>;
  reorderProjectSessionTabs(
    input: ProjectSessionTabReorderInput,
  ): Promise<ProjectSession | null>;
  getProjectSessionTab(tabId: string): Promise<ProjectSessionTab | null>;
  updateProjectSessionTab(
    tabId: string,
    input: ProjectSessionTabUpdateInput,
  ): Promise<ProjectSessionTab | null>;
  updateProjectSessionTabState(
    tabId: string,
    stateKey: number,
    state: unknown,
  ): Promise<ProjectSessionTab | null>;
}

const isNotFound = (error: unknown): boolean =>
  error instanceof CoreModuleResponseError &&
  error.coreError.code === "not_found";

const fromCoreProject = (project: CoreProject): Project => ({
  id: project.id,
  libraryId: project.library_id,
  databaseId: project.database_id,
  lifecycle: project.lifecycle,
  bindingRevision: project.binding_revision,
  name: project.name,
  description: project.description,
  icon: project.icon || undefined,
  sources: project.sources.map((source) => ({
    root: source.root,
    order: source.order,
  })),
  primaryWorkspaceRoot: project.primary_workspace_root ?? null,
  pinned: project.pinned,
  pinnedOrder: project.pinned_order ?? null,
  created: new Date(project.created_at),
  updated: new Date(project.updated_at),
});

const fromCoreThread = (
  thread: CoreThread,
  sessionId: string,
  sessionProjectId: string | null,
): ProjectSessionThreadLink => ({
  sessionId,
  projectId: thread.project_id ?? sessionProjectId,
  threadId: thread.thread_id,
  forkedFromId: thread.forked_from_id ?? null,
  parentThreadId: thread.parent_thread_id ?? undefined,
  threadName: thread.thread_name ?? undefined,
  threadPreview: thread.thread_preview,
  modelProvider: thread.model_provider,
  cwd: thread.cwd ?? undefined,
  managedWorktreePath: thread.managed_worktree_path ?? null,
  projectlessOutputDirectory: thread.projectless_output_directory ?? null,
  projectlessWorkspaceBrowserRoot:
    thread.projectless_workspace_browser_root ?? null,
  statusType: thread.status.status_type,
  statusActiveFlags: [...thread.status.active_flags],
  archived: thread.archived,
  createdAt: thread.created_at,
  updatedAt: thread.updated_at,
  linkedAt: thread.linked_at,
});

const fromCoreSessionSummary = (
  session: CoreSessionSummary,
  thread: ProjectSessionThreadLink | null,
): ProjectSessionSummary => ({
  id: session.id,
  projectId: session.project_id ?? null,
  noThreadFallbackTitle: session.no_thread_fallback_title,
  displayTitle: session.display_title,
  order: session.order,
  pinned: session.pinned,
  pinnedOrder: session.pinned_order ?? null,
  archived: session.archived,
  archivedAt: session.archived_at ?? null,
  unread: session.unread,
  leftPaneCollapsed: session.left_pane_collapsed,
  thread,
  createdAt: session.created_at,
  updatedAt: session.updated_at,
});

const fromCoreTab = (tab: CoreSessionTab): ProjectSessionTab => ({
  id: tab.id,
  sessionId: tab.session_id,
  projectId: tab.project_id ?? null,
  browserTabId: tab.browser_tab_id ?? null,
  panelId: tab.panel_id,
  kind: tab.kind,
  title: tab.title,
  order: tab.order,
  config: parseProjectSessionTabConfig(tab.kind, tab.config),
  stateKey: tab.state_key,
  state: tab.state,
  createdAt: tab.created_at,
  updatedAt: tab.updated_at,
});

export function createCoreProjectWorkspaceAdapter(
  client: CoreClientPort,
): DesktopProjectWorkspacePort {
  const readThread = async (
    summary: CoreSessionSummary,
  ): Promise<ProjectSessionThreadLink | null> => {
    const threadId = summary.thread_id ?? null;
    if (!threadId) return null;
    const snapshot = await client.workspaceRead({
      kind: "thread",
      thread_id: threadId,
    });
    if (snapshot.value.kind !== "thread") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return fromCoreThread(
      snapshot.value.thread,
      summary.id,
      summary.project_id ?? null,
    );
  };

  const readSession = async (sessionId: string): Promise<ProjectSession | null> => {
    let snapshot: ProjectWorkspaceReadSnapshot;
    try {
      snapshot = await client.workspaceRead({
        kind: "session",
        session_id: sessionId,
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (snapshot.value.kind !== "session") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    const summary = snapshot.value.session;
    const thread = await readThread(summary);
    const tabs = snapshot.value.tabs.map(fromCoreTab);
    const panels = ProjectSessionPanelsSchema.parse(snapshot.value.panels) as Record<
      PanelId,
      ProjectSession["panels"][PanelId]
    >;
    return {
      ...fromCoreSessionSummary(summary, thread),
      panels,
      tabs,
    };
  };

  const readTab = async (tabId: string): Promise<ProjectSessionTab | null> => {
    let snapshot: ProjectWorkspaceReadSnapshot;
    try {
      snapshot = await client.workspaceRead({
        kind: "session_tab",
        tab_id: tabId,
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (snapshot.value.kind !== "session_tab") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return fromCoreTab(snapshot.value.tab);
  };

  const listSummaries = async (
    projectId: string | null,
    options?: ProjectSessionListOptions,
  ): Promise<ProjectSessionSummary[]> => {
    const snapshot = await client.workspaceRead({
      kind: "sessions",
      project_id: projectId,
      include_archived: options?.includeArchived ?? false,
    });
    if (snapshot.value.kind !== "sessions") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return await Promise.all(
      snapshot.value.sessions.map(async (summary) =>
        fromCoreSessionSummary(summary, await readThread(summary)),
      ),
    );
  };

  const readProjects = async (): Promise<Project[]> => {
    const snapshot = await client.workspaceRead({ kind: "startup" });
    if (snapshot.value.kind !== "startup") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return snapshot.value.projects.map(fromCoreProject);
  };

  const apply = async (
    intent: Parameters<CoreClientPort["workspaceApply"]>[0]["intent"],
  ): Promise<void> => {
    await client.workspaceApply({ operationId: randomUUID(), intent });
  };

  const replacePanelLayout = async (
    sessionId: string,
    panelId: PanelId,
    layout: ProjectSession["panels"][PanelId]["layout"],
  ): Promise<ProjectSession | null> => {
    await apply({
      kind: "mutate_session",
      session_id: sessionId,
      intent: {
        kind: "replace_panel_layout",
        panel_id: panelId,
        layout,
      },
    });
    return await readSession(sessionId);
  };

  const cleanupPanelLayout = (
    layout: ProjectSession["panels"][PanelId]["layout"],
    tabIds: readonly string[],
    options: {
      readonly preserveEmptyLeafIds?: readonly string[];
      readonly preferredActiveLeafId?: string | null;
      readonly preferredActiveTabId?: string | null;
    } = {},
  ) => {
    const normalizeOptions = {
      preferredActiveLeafId: options.preferredActiveLeafId,
      preferredActiveTabId: options.preferredActiveTabId,
    };
    return pruneEmptyProjectSessionPanelLeaves(
      normalizeProjectSessionPanelLayout(layout, tabIds, normalizeOptions),
      {
        ...normalizeOptions,
        preserveLeafIds: options.preserveEmptyLeafIds,
      },
    );
  };

  const getProject = async (projectId: string): Promise<Project | null> => {
    let snapshot: ProjectWorkspaceReadSnapshot;
    try {
      snapshot = await client.workspaceRead({
        kind: "project",
        project_id: projectId,
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (snapshot.value.kind !== "project") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return fromCoreProject(snapshot.value.project);
  };

  return {
    listProjects: readProjects,
    getProject,
    createProject: async (input) => {
      const projectId = randomUUID();
      await apply({
        kind: "create_project",
        project_id: projectId,
        name: input.name ?? "",
        description: input.description ?? "",
        icon: input.icon ?? null,
        source_roots: input.sources ?? [],
      });
      const project = await getProject(projectId);
      if (!project) throw new Error(`Created Project not found: ${projectId}`);
      return project;
    },
    updateProject: async (projectId, input) => {
      const current = await getProject(projectId);
      if (!current) return null;
      await apply({
        kind: "update_project",
        project_id: projectId,
        expected_binding_revision: current.bindingRevision,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.sources !== undefined ? { source_roots: input.sources } : {}),
      });
      return await getProject(projectId);
    },
    reorderProjects: async (input) => {
      await apply({
        kind: "reorder_projects",
        project_ids: input.orderedProjectIds,
      });
      return await readProjects();
    },
    setProjectPinned: async (projectId, input) => {
      if (!(await getProject(projectId))) return null;
      await apply({
        kind: "set_project_pinned",
        project_id: projectId,
        pinned: input.pinned,
      });
      return await getProject(projectId);
    },
    setPinnedProjectOrder: async (input) => {
      await apply({
        kind: "reorder_pinned_projects",
        project_ids: input.orderedProjectIds,
      });
      return await readProjects();
    },
    deleteProject: async (projectId) => {
      const current = await getProject(projectId);
      if (!current || current.lifecycle === "archived") return false;
      await apply({
        kind: "set_project_lifecycle",
        project_id: projectId,
        lifecycle: "archived",
      });
      return true;
    },
    listProjectSessions: async (projectId, options) => {
      const summaries = await listSummaries(projectId, options);
      const sessions = await Promise.all(
        summaries.map((summary) => readSession(summary.id)),
      );
      return sessions.filter((session): session is ProjectSession => session !== null);
    },
    listProjectSessionSummaries: listSummaries,
    getProjectSession: readSession,
    createProjectSession: async (input) => {
      const sessionId = randomUUID();
      await apply({
        kind: "create_session",
        session_id: sessionId,
        project_id: input.projectId,
        title: input.noThreadFallbackTitle,
      });
      const session = await readSession(sessionId);
      if (!session) {
        throw new Error(`Created Project Session not found: ${sessionId}`);
      }
      return session;
    },
    deleteProjectSession: async (sessionId) => {
      if (!(await readSession(sessionId))) return false;
      await apply({ kind: "delete_session", session_id: sessionId });
      return true;
    },
    reorderProjectSessions: async (projectId, orderedSessionIds) => {
      await apply({
        kind: "reorder_sessions",
        project_id: projectId,
        session_ids: orderedSessionIds,
      });
      return await Promise.all(
        (await listSummaries(projectId)).map(async (summary) => {
          const session = await readSession(summary.id);
          if (!session) {
            throw new Error(`Reordered Project Session not found: ${summary.id}`);
          }
          return session;
        }),
      );
    },
    setProjectSessionPinned: async (sessionId, input) => {
      if (!(await readSession(sessionId))) return null;
      await apply({
        kind: "mutate_session",
        session_id: sessionId,
        intent: { kind: "set_pinned", pinned: input.pinned },
      });
      return await readSession(sessionId);
    },
    setPinnedProjectSessionOrder: async (projectId, input) => {
      await apply({
        kind: "reorder_pinned_sessions",
        project_id: projectId,
        session_ids: input.orderedSessionIds,
      });
      return await Promise.all(
        (await listSummaries(projectId)).map(async (summary) => {
          const session = await readSession(summary.id);
          if (!session) {
            throw new Error(`Pinned Project Session not found: ${summary.id}`);
          }
          return session;
        }),
      );
    },
    archiveProjectSession: async (sessionId) => {
      if (!(await readSession(sessionId))) return null;
      await apply({
        kind: "mutate_session",
        session_id: sessionId,
        intent: { kind: "set_archived", archived: true },
      });
      return await readSession(sessionId);
    },
    unarchiveProjectSession: async (sessionId) => {
      if (!(await readSession(sessionId))) return null;
      await apply({
        kind: "mutate_session",
        session_id: sessionId,
        intent: { kind: "set_archived", archived: false },
      });
      return await readSession(sessionId);
    },
    markProjectSessionUnread: async (sessionId, input) => {
      if (!(await readSession(sessionId))) return null;
      await apply({
        kind: "mutate_session",
        session_id: sessionId,
        intent: { kind: "set_unread", unread: input.unread },
      });
      return await readSession(sessionId);
    },
    createProjectSessionTab: async (input) => {
      const parsed = ProjectSessionTabCreateInputSchema.parse(input);
      const tabId = parsed.clientTabId ?? randomUUID();
      await apply({
        kind: "mutate_session",
        session_id: parsed.sessionId,
        intent: {
          kind: "create_tab",
          tab_id: tabId,
          panel_id: parsed.panelId,
          target_leaf_id: parsed.targetLeafId ?? null,
          browser_tab_id: parsed.browserTabId ?? null,
          tab_kind: parsed.kind,
          title: parsed.title,
          config: parsed.config,
        },
      });
      const session = await readSession(parsed.sessionId);
      const exact = session?.tabs.find((tab) => tab.id === tabId);
      if (exact) return exact;
      const equivalent = session?.tabs.find((tab) => {
        if (tab.kind === parsed.kind && (parsed.kind === "review")) return true;
        if (tab.kind !== "db_view" || parsed.kind !== "db_view") return false;
        return "databaseViewId" in tab.config &&
          "databaseViewId" in parsed.config &&
          tab.config.databaseViewId === parsed.config.databaseViewId;
      });
      if (!equivalent) {
        throw new Error(`Created Project Session tab not found: ${tabId}`);
      }
      return equivalent;
    },
    splitProjectSessionPanelGroup: async (input) => {
      const parsed = ProjectSessionPanelSplitInputSchema.parse(input);
      const session = await readSession(parsed.sessionId);
      if (!session) return null;
      if (
        parsed.tabId &&
        !session.tabs.some(
          (tab) => tab.id === parsed.tabId && tab.panelId === parsed.panelId,
        )
      ) {
        throw new Error("Tab does not belong to the target panel");
      }
      const panelTabIds = session.tabs
        .filter((tab) => tab.panelId === parsed.panelId)
        .map((tab) => tab.id);
      const layout = cleanupPanelLayout(
        splitProjectSessionPanelLeaf(session.panels[parsed.panelId].layout, {
          leafId: parsed.leafId,
          side: parsed.side,
          tabId: parsed.tabId,
          newLeafId: randomUUID(),
          newBranchId: randomUUID(),
        }),
        panelTabIds,
        {
          preserveEmptyLeafIds: parsed.preserveEmptyLeafIds,
          preferredActiveLeafId: parsed.leafId,
          preferredActiveTabId: parsed.tabId ?? null,
        },
      );
      return await replacePanelLayout(parsed.sessionId, parsed.panelId, layout);
    },
    ensureProjectSessionPanelLeafToRight: async (input) => {
      const parsed = ProjectSessionPanelEnsureRightLeafInputSchema.parse(input);
      const session = await readSession(parsed.sessionId);
      if (!session) return null;
      const panelTabIds = session.tabs
        .filter((tab) => tab.panelId === parsed.panelId)
        .map((tab) => tab.id);
      const layout = normalizeProjectSessionPanelLayout(
        session.panels[parsed.panelId].layout,
        panelTabIds,
        { preferredActiveLeafId: parsed.sourceLeafId },
      );
      const sourceLeaf = findProjectSessionPanelLeaf(
        layout,
        parsed.sourceLeafId,
      );
      if (!sourceLeaf) return null;
      const existingLeafId = findNearestProjectSessionPanelLeafToRight(
        layout,
        sourceLeaf.id,
      );
      if (existingLeafId) {
        return { session, leafId: existingLeafId, created: false };
      }
      const leafId = randomUUID();
      const next = await replacePanelLayout(
        parsed.sessionId,
        parsed.panelId,
        insertProjectSessionPanelLeaf(layout, {
          leafId: sourceLeaf.id,
          side: "right",
          newLeafId: leafId,
          newBranchId: randomUUID(),
        }),
      );
      return next ? { session: next, leafId, created: true } : null;
    },
    mergeProjectSessionPanelGroup: async (input) => {
      const parsed = ProjectSessionPanelMergeInputSchema.parse(input);
      const session = await readSession(parsed.sessionId);
      if (!session) return null;
      return await replacePanelLayout(
        parsed.sessionId,
        parsed.panelId,
        mergeProjectSessionPanelLeaf(
          session.panels[parsed.panelId].layout,
          parsed.leafId,
        ),
      );
    },
    activateProjectSessionPanelGroup: async (input) => {
      const parsed = ProjectSessionPanelActivateInputSchema.parse(input);
      const session = await readSession(parsed.sessionId);
      if (!session) return null;
      return await replacePanelLayout(
        parsed.sessionId,
        parsed.panelId,
        activateProjectSessionPanelLeaf(
          session.panels[parsed.panelId].layout,
          parsed.leafId,
          parsed.tabId,
        ),
      );
    },
    resizeProjectSessionPanelGroup: async (input) => {
      const parsed = ProjectSessionPanelResizeInputSchema.parse(input);
      const session = await readSession(parsed.sessionId);
      if (!session) return null;
      return await replacePanelLayout(
        parsed.sessionId,
        parsed.panelId,
        setProjectSessionPanelBranchRatio(
          session.panels[parsed.panelId].layout,
          parsed.branchId,
          parsed.ratio,
        ),
      );
    },
    maximizeProjectSessionPanelGroup: async (input) => {
      const parsed = ProjectSessionPanelMaximizeInputSchema.parse(input);
      const session = await readSession(parsed.sessionId);
      if (!session) return null;
      return await replacePanelLayout(
        parsed.sessionId,
        parsed.panelId,
        setProjectSessionPanelMaximizedLeaf(
          session.panels[parsed.panelId].layout,
          parsed.leafId,
        ),
      );
    },
    reorderProjectSessionTabs: async (input) => {
      const parsed = ProjectSessionTabReorderInputSchema.parse(input);
      const session = await readSession(parsed.sessionId);
      if (!session) return null;
      const panelTabs = session.tabs.filter(
        (tab) => tab.panelId === parsed.panelId,
      );
      const layout = normalizeProjectSessionPanelLayout(
        session.panels[parsed.panelId].layout,
        panelTabs.map((tab) => tab.id),
      );
      const selected = new Set(parsed.orderedTabIds);
      const targetLeaf = parsed.leafId
        ? findProjectSessionPanelLeaf(layout, parsed.leafId)
        : panelTabs.length === parsed.orderedTabIds.length
          ? getProjectSessionPanelActiveLeaf(layout)
          : listProjectSessionPanelLeaves(layout).find((leaf) =>
              leaf.tabIds.some((tabId) => selected.has(tabId)),
            ) ?? null;
      const leafId = targetLeaf?.id ?? getProjectSessionPanelActiveLeaf(layout).id;
      return await replacePanelLayout(
        parsed.sessionId,
        parsed.panelId,
        reorderProjectSessionPanelLeafTabs(
          layout,
          leafId,
          parsed.orderedTabIds,
        ),
      );
    },
    getProjectSessionTab: readTab,
    updateProjectSessionTab: async (tabId, input) => {
      const current = await readTab(tabId);
      if (!current) return null;
      const hasState = Object.prototype.hasOwnProperty.call(input, "state");
      await apply({
        kind: "mutate_session",
        session_id: current.sessionId,
        intent: {
          kind: "update_tab",
          tab_id: tabId,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.config !== undefined ? { config: input.config } : {}),
          ...(input.stateKey !== undefined ? { state_key: input.stateKey } : {}),
          ...(hasState ? { state: input.state } : {}),
        },
      });
      return await readTab(tabId);
    },
    updateProjectSessionTabState: async (tabId, stateKey, state) => {
      const current = await readTab(tabId);
      if (!current) return null;
      await apply({
        kind: "mutate_session",
        session_id: current.sessionId,
        intent: {
          kind: "replace_tab_state",
          tab_id: tabId,
          state_key: stateKey,
          state,
        },
      });
      return await readTab(tabId);
    },
  };
}
