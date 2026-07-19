import { randomUUID } from "node:crypto";

import type {
  PanelId,
  Project,
  ProjectCreateInput,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
  ProjectSession,
  ProjectSessionListOptions,
  ProjectSessionSummary,
  ProjectSessionTab,
  ProjectSessionThreadLink,
  ProjectUpdateInput,
} from "../../shared/types";
import {
  ProjectSessionPanelsSchema,
  parseProjectSessionTabConfig,
} from "../../shared/schemas/project-sessions";
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
  };
}
