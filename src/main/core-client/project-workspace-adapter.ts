import { randomUUID } from "node:crypto";

import type {
  CodexBackgroundProcessRecord,
  CodexPermissionMode,
  CodexThreadActiveFlag,
  CodexThreadStatusType,
  CodexThreadSummary,
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
  ProjectSessionRenameInput,
  ProjectSessionSummary,
  ProjectSessionThreadLink,
  ProjectSessionThreadLinkInput,
  ProjectSessionUnreadInput,
  ProjectSessionUpdateInput,
  ProjectUpdateInput,
} from "../../shared/types";
import type { AgentExecutionProfile } from "../../shared/agent-runtime";
import type { DynamicToolCatalogSelection } from "../codex/dynamic-tool-registry";
import {
  ProjectSessionThreadLinkInputSchema,
  ProjectSessionRenameInputSchema,
  ProjectSessionUpdateInputSchema,
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
type CoreThread = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "thread" }
>["thread"];
type CoreBackgroundProcess = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "background_processes" }
>["processes"][number];

export interface DesktopProjectWorkspaceThread {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly sessionId: string | null;
  readonly forkedFromId: string | null;
  readonly parentThreadId: string | null;
  readonly threadSource: CodexThreadSummary["threadSource"];
  readonly serviceName: string | null;
  readonly agentNickname: string | null;
  readonly agentRole: string | null;
  readonly agentPath: string | null;
  readonly threadName: string | null;
  readonly threadPreview: string;
  readonly modelProvider: string;
  readonly executionProfile?: AgentExecutionProfile | null;
  readonly cwd: string | null;
  readonly managedWorktreePath: string | null;
  readonly projectlessOutputDirectory: string | null;
  readonly projectlessWorkspaceBrowserRoot: string | null;
  readonly statusType: ProjectSessionThreadLink["statusType"];
  readonly statusActiveFlags: ProjectSessionThreadLink["statusActiveFlags"];
  readonly archived: boolean;
  readonly pinnedOrder: number | null;
  readonly hasUnreadTurn: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly linkedAt: string;
}

export interface DesktopProjectWorkspaceThreadPatch {
  readonly projectId?: string | null;
  readonly forkedFromId?: string | null;
  readonly parentThreadId?: string | null;
  readonly threadName?: string | null;
  readonly threadSource?: CodexThreadSummary["threadSource"];
  readonly serviceName?: string | null;
  readonly agentNickname?: string | null;
  readonly agentRole?: string | null;
  readonly agentPath?: string | null;
  readonly threadPreview?: string;
  readonly modelProvider?: string;
  readonly executionProfile?: AgentExecutionProfile | null;
  readonly cwd?: string | null;
  readonly managedWorktreePath?: string | null;
  readonly projectlessOutputDirectory?: string | null;
  readonly projectlessWorkspaceBrowserRoot?: string | null;
  readonly status?: {
    readonly statusType: CodexThreadStatusType;
    readonly activeFlags: readonly CodexThreadActiveFlag[];
  };
  readonly archived?: boolean;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly linkedAt?: string;
}

export interface DesktopProjectWorkspaceThreadMoveInput {
  readonly threadId: string;
  readonly sourceProjectId: string | null;
  readonly targetProjectId: string | null;
  readonly beforeThreadId?: string | null;
  readonly insertAtEnd?: boolean;
  readonly useDefaultOrder?: boolean;
  readonly metadata?: Pick<
    DesktopProjectWorkspaceThreadPatch,
    | "cwd"
    | "managedWorktreePath"
    | "projectlessOutputDirectory"
    | "projectlessWorkspaceBrowserRoot"
  >;
}

export interface DesktopProjectWorkspaceSidebar {
  readonly threads: readonly DesktopProjectWorkspaceThread[];
  readonly projectThreadOrders: Readonly<Record<string, readonly string[]>>;
  readonly projectlessThreadOrder: readonly string[] | null;
}

export interface DesktopProjectWorkspaceExecutionContext {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly permissionMode: CodexPermissionMode | null;
  readonly dynamicToolCatalogs: readonly DynamicToolCatalogSelection[];
  readonly writableRoots: readonly string[];
}

export interface DesktopProjectWorkspacePort {
  listProjects(options?: { includeArchived?: boolean }): Promise<Project[]>;
  getProject(projectId: string): Promise<Project | null>;
  readProjectPermissionMode(
    projectId: string,
  ): Promise<CodexPermissionMode | null>;
  setProjectPermissionMode(
    projectId: string,
    mode: CodexPermissionMode,
  ): Promise<CodexPermissionMode>;
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
  setProjectLifecycle(
    projectId: string,
    lifecycle: Project["lifecycle"],
  ): Promise<Project | null>;
  listProjectSessions(
    projectId: string | null,
    options?: ProjectSessionListOptions,
  ): Promise<ProjectSession[]>;
  listProjectSessionSummaries(
    projectId: string | null,
    options?: ProjectSessionListOptions,
  ): Promise<ProjectSessionSummary[]>;
  listProjectThreads(
    projectId: string | null,
    options?: ProjectSessionListOptions,
  ): Promise<DesktopProjectWorkspaceThread[]>;
  getProjectSession(sessionId: string): Promise<ProjectSession | null>;
  updateProjectSession(
    sessionId: string,
    input: ProjectSessionUpdateInput,
  ): Promise<ProjectSession | null>;
  renameProjectSession(
    sessionId: string,
    input: ProjectSessionRenameInput,
  ): Promise<ProjectSession | null>;
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
  upsertProjectSessionThreadLink(
    input: ProjectSessionThreadLinkInput,
  ): Promise<ProjectSessionThreadLink>;
  detachProjectSessionThread(sessionId: string): Promise<boolean>;
  getThread(
    threadId: string,
  ): Promise<DesktopProjectWorkspaceThread | null>;
  upsertThread(
    threadId: string,
    patch: DesktopProjectWorkspaceThreadPatch,
  ): Promise<DesktopProjectWorkspaceThread>;
  updateThread(
    threadId: string,
    patch: DesktopProjectWorkspaceThreadPatch,
  ): Promise<DesktopProjectWorkspaceThread | null>;
  moveThread(input: DesktopProjectWorkspaceThreadMoveInput): Promise<{
    readonly thread: DesktopProjectWorkspaceThread;
    readonly sidebar: DesktopProjectWorkspaceSidebar;
  }>;
  setThreadUnread(
    threadId: string,
    unread: boolean,
  ): Promise<DesktopProjectWorkspaceThread | null>;
  setThreadArchived(
    threadId: string,
    archived: boolean,
  ): Promise<DesktopProjectWorkspaceSidebar>;
  deleteThread(threadId: string): Promise<{
    readonly deleted: boolean;
    readonly sidebar: DesktopProjectWorkspaceSidebar;
  }>;
  readThreadExecutionContext(
    threadId: string,
  ): Promise<DesktopProjectWorkspaceExecutionContext | null>;
  replaceThreadDynamicToolCatalogs(
    threadId: string,
    catalogs: readonly DynamicToolCatalogSelection[],
  ): Promise<readonly DynamicToolCatalogSelection[]>;
  mergeThreadWritableRoots(
    threadId: string,
    roots: readonly string[],
  ): Promise<readonly string[]>;
  replaceThreadWritableRoots(
    threadId: string,
    roots: readonly string[],
  ): Promise<readonly string[]>;
  listBackgroundProcesses(
    threadId?: string | null,
  ): Promise<CodexBackgroundProcessRecord[]>;
  upsertBackgroundProcess(
    input: CodexBackgroundProcessRecord,
    options?: { readonly preserveStartedAt?: boolean },
  ): Promise<CodexBackgroundProcessRecord>;
  readSidebar(
    includeArchived: boolean,
  ): Promise<DesktopProjectWorkspaceSidebar>;
  setProjectThreadOrder(
    projectId: string,
    orderedThreadIds: readonly string[] | null,
  ): Promise<DesktopProjectWorkspaceSidebar>;
  setProjectlessThreadOrder(input: {
    readonly threadIdsInDisplayOrder: readonly string[];
    readonly visibleThreadIds: readonly string[];
    readonly nextVisibleThreadIds: readonly string[];
  }): Promise<DesktopProjectWorkspaceSidebar>;
  setThreadPinned(
    threadId: string,
    pinned: boolean,
    beforeThreadId?: string | null,
  ): Promise<DesktopProjectWorkspaceSidebar>;
  reorderPinnedThreads(
    orderedThreadIds: readonly string[],
  ): Promise<DesktopProjectWorkspaceSidebar>;
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
  executionProfile: thread.model_id
    ? {
        providerId: thread.model_provider,
        modelId: thread.model_id,
        harnessId: thread.harness_id ?? null,
        reasoningEffort: thread.reasoning_effort ?? null,
        serviceTier: thread.service_tier ?? null,
      }
    : null,
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

const fromCoreBackgroundProcess = (
  process: CoreBackgroundProcess,
): CodexBackgroundProcessRecord => ({
  id: process.id,
  threadId: process.thread_id,
  threadTitle: process.thread_title ?? null,
  itemId: process.item_id,
  turnId: process.turn_id ?? null,
  command: process.command,
  cwd: process.cwd ?? null,
  processId: process.process_id ?? null,
  osPid: process.os_pid ?? null,
  terminalSessionId: process.terminal_session_id ?? null,
  source: process.source,
  startedAtMs: process.started_at_ms,
  updatedAtMs: process.updated_at_ms,
});

const fromCoreWorkspaceThread = (
  thread: CoreThread,
): DesktopProjectWorkspaceThread => ({
  threadId: thread.thread_id,
  projectId: thread.project_id ?? null,
  sessionId: thread.session_id ?? null,
  forkedFromId: thread.forked_from_id ?? null,
  parentThreadId: thread.parent_thread_id ?? null,
  threadSource: thread.thread_source ?? null,
  serviceName: thread.service_name ?? null,
  agentNickname: thread.agent_nickname ?? null,
  agentRole: thread.agent_role ?? null,
  agentPath: thread.agent_path ?? null,
  threadName: thread.thread_name ?? null,
  threadPreview: thread.thread_preview,
  modelProvider: thread.model_provider,
  executionProfile: thread.model_id
    ? {
        providerId: thread.model_provider,
        modelId: thread.model_id,
        harnessId: thread.harness_id ?? null,
        reasoningEffort: thread.reasoning_effort ?? null,
        serviceTier: thread.service_tier ?? null,
      }
    : null,
  cwd: thread.cwd ?? null,
  managedWorktreePath: thread.managed_worktree_path ?? null,
  projectlessOutputDirectory: thread.projectless_output_directory ?? null,
  projectlessWorkspaceBrowserRoot:
    thread.projectless_workspace_browser_root ?? null,
  statusType: thread.status.status_type,
  statusActiveFlags: [...thread.status.active_flags],
  archived: thread.archived,
  pinnedOrder: thread.pinned_order ?? null,
  hasUnreadTurn: thread.has_unread_turn,
  createdAt: thread.created_at,
  updatedAt: thread.updated_at,
  linkedAt: thread.linked_at,
});

const toCoreExecutionProfilePatch = (
  profile: AgentExecutionProfile | null,
) => profile
  ? {
      model_provider: profile.providerId,
      model_id: profile.modelId,
      harness_id: profile.harnessId,
      reasoning_effort: profile.reasoningEffort,
      service_tier: profile.serviceTier,
    }
  : {
      model_id: null,
      harness_id: null,
      reasoning_effort: null,
      service_tier: null,
    };

const toCoreThreadPatch = (
  patch: DesktopProjectWorkspaceThreadPatch,
) => ({
  ...(Object.prototype.hasOwnProperty.call(patch, "projectId")
    ? { project_id: patch.projectId ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "forkedFromId")
    ? { forked_from_id: patch.forkedFromId ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "parentThreadId")
    ? { parent_thread_id: patch.parentThreadId ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "threadName")
    ? { thread_name: patch.threadName ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "threadSource")
    ? { thread_source: patch.threadSource ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "serviceName")
    ? { service_name: patch.serviceName ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "agentNickname")
    ? { agent_nickname: patch.agentNickname ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "agentRole")
    ? { agent_role: patch.agentRole ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "agentPath")
    ? { agent_path: patch.agentPath ?? null }
    : {}),
  ...(patch.threadPreview === undefined
    ? {}
    : { thread_preview: patch.threadPreview }),
  ...(patch.modelProvider === undefined
    ? {}
    : { model_provider: patch.modelProvider }),
  ...(Object.prototype.hasOwnProperty.call(patch, "executionProfile")
    ? toCoreExecutionProfilePatch(patch.executionProfile ?? null)
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "cwd")
    ? { cwd: patch.cwd ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "managedWorktreePath")
    ? { managed_worktree_path: patch.managedWorktreePath ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "projectlessOutputDirectory")
    ? { projectless_output_directory: patch.projectlessOutputDirectory ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(patch, "projectlessWorkspaceBrowserRoot")
    ? {
        projectless_workspace_browser_root:
          patch.projectlessWorkspaceBrowserRoot ?? null,
      }
    : {}),
  ...(patch.status === undefined
    ? {}
    : {
        status: {
          status_type: patch.status.statusType,
          active_flags: [...patch.status.activeFlags],
        },
      }),
  ...(patch.archived === undefined ? {} : { archived: patch.archived }),
  ...(patch.createdAt === undefined ? {} : { created_at: patch.createdAt }),
  ...(patch.updatedAt === undefined ? {} : { updated_at: patch.updatedAt }),
  ...(patch.linkedAt === undefined ? {} : { linked_at: patch.linkedAt }),
});

const toCoreThreadLane = (projectId: string | null) =>
  projectId === null
    ? { kind: "projectless" as const }
    : { kind: "project" as const, project_id: projectId };

const toCoreThreadMovePlacement = (
  input: DesktopProjectWorkspaceThreadMoveInput,
) => {
  const beforeThreadId = input.beforeThreadId?.trim() || null;
  const insertAtEnd = input.insertAtEnd === true;
  const useDefaultOrder = input.useDefaultOrder === true;
  if (useDefaultOrder && (beforeThreadId !== null || insertAtEnd)) {
    throw new Error(
      "useDefaultOrder cannot be combined with beforeThreadId or insertAtEnd",
    );
  }
  if (beforeThreadId !== null && insertAtEnd) {
    throw new Error("beforeThreadId cannot be combined with insertAtEnd");
  }
  if (useDefaultOrder) return { kind: "default" as const };
  if (beforeThreadId !== null) {
    return { kind: "before" as const, thread_id: beforeThreadId };
  }
  if (insertAtEnd) return { kind: "end" as const };
  return { kind: "start" as const };
};

const toCoreThreadMoveMetadata = (
  metadata: DesktopProjectWorkspaceThreadMoveInput["metadata"],
) => ({
  ...(metadata && Object.prototype.hasOwnProperty.call(metadata, "cwd")
    ? { cwd: metadata.cwd ?? null }
    : {}),
  ...(metadata && Object.prototype.hasOwnProperty.call(metadata, "managedWorktreePath")
    ? { managed_worktree_path: metadata.managedWorktreePath ?? null }
    : {}),
  ...(metadata && Object.prototype.hasOwnProperty.call(metadata, "projectlessOutputDirectory")
    ? { projectless_output_directory: metadata.projectlessOutputDirectory ?? null }
    : {}),
  ...(metadata && Object.prototype.hasOwnProperty.call(metadata, "projectlessWorkspaceBrowserRoot")
    ? {
        projectless_workspace_browser_root:
          metadata.projectlessWorkspaceBrowserRoot ?? null,
      }
    : {}),
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
  initialDatabaseViewId: session.initial_database_view_id ?? null,
  thread,
  createdAt: session.created_at,
  updatedAt: session.updated_at,
});

export function createCoreProjectWorkspaceAdapter(
  client: CoreClientPort,
): DesktopProjectWorkspacePort {
  const readCoreThread = async (threadId: string): Promise<CoreThread | null> => {
    let snapshot: ProjectWorkspaceReadSnapshot;
    try {
      snapshot = await client.workspaceRead({
        kind: "thread",
        thread_id: threadId,
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (snapshot.value.kind !== "thread") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return snapshot.value.thread;
  };

  const readThreadExecutionContext = async (
    threadId: string,
  ): Promise<DesktopProjectWorkspaceExecutionContext | null> => {
    let snapshot: ProjectWorkspaceReadSnapshot;
    try {
      snapshot = await client.workspaceRead({
        kind: "execution_context",
        thread_id: threadId,
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (snapshot.value.kind !== "execution_context") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    const { context } = snapshot.value;
    return {
      threadId: context.thread.thread_id,
      projectId: context.thread.project_id ?? null,
      permissionMode: context.permission_mode ?? null,
      dynamicToolCatalogs: context.thread.dynamic_tool_catalogs.map(
        (catalog) => ({
          namespace: catalog.namespace,
          toolsetRevision: catalog.toolset_revision,
        }),
      ),
      writableRoots: [...context.thread.writable_roots],
    };
  };

  const getThread = async (
    threadId: string,
  ): Promise<DesktopProjectWorkspaceThread | null> => {
    const thread = await readCoreThread(threadId);
    return thread ? fromCoreWorkspaceThread(thread) : null;
  };

  const readThread = async (
    summary: CoreSessionSummary,
  ): Promise<ProjectSessionThreadLink | null> => {
    const threadId = summary.thread_id ?? null;
    if (!threadId) return null;
    const thread = await readCoreThread(threadId);
    if (!thread) throw new Error(`Linked Core Thread not found: ${threadId}`);
    return fromCoreThread(
      thread,
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
    return fromCoreSessionSummary(summary, thread);
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

  const readProjects = async (
    options?: { includeArchived?: boolean },
  ): Promise<Project[]> => {
    const snapshot = await client.workspaceRead({
      kind: "projects",
      include_archived: options?.includeArchived ?? false,
    });
    if (snapshot.value.kind !== "projects") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return snapshot.value.projects.map(fromCoreProject);
  };

  const listProjectThreads = async (
    projectId: string | null,
    options?: ProjectSessionListOptions,
  ): Promise<DesktopProjectWorkspaceThread[]> => {
    const snapshot = await client.workspaceRead({
      kind: "threads",
      project_id: projectId,
      include_archived: options?.includeArchived ?? false,
    });
    if (snapshot.value.kind !== "threads") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return snapshot.value.threads.map(fromCoreWorkspaceThread);
  };

  const readProjectPermissionMode = async (
    projectId: string,
  ): Promise<CodexPermissionMode | null> => {
    let snapshot: ProjectWorkspaceReadSnapshot;
    try {
      snapshot = await client.workspaceRead({
        kind: "project_permission_mode",
        project_id: projectId,
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (snapshot.value.kind !== "project_permission_mode") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return snapshot.value.mode ?? null;
  };

  const listBackgroundProcesses = async (
    threadId?: string | null,
  ): Promise<CodexBackgroundProcessRecord[]> => {
    const normalizedThreadId = threadId?.trim() || null;
    const snapshot = await client.workspaceRead({
      kind: "background_processes",
      thread_id: normalizedThreadId,
    });
    if (snapshot.value.kind !== "background_processes") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return snapshot.value.processes.map(fromCoreBackgroundProcess);
  };

  const readSidebar = async (
    includeArchived: boolean,
  ): Promise<DesktopProjectWorkspaceSidebar> => {
    const snapshot = await client.workspaceRead({
      kind: "sidebar",
      include_archived: includeArchived,
    });
    if (snapshot.value.kind !== "sidebar") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return {
      threads: snapshot.value.sidebar.threads.map(fromCoreWorkspaceThread),
      projectThreadOrders: Object.fromEntries(
        Object.entries(snapshot.value.sidebar.project_thread_orders).map(
          ([projectId, threadIds]) => [projectId, [...threadIds]],
        ),
      ),
      projectlessThreadOrder:
        snapshot.value.sidebar.projectless_thread_order === null
        || snapshot.value.sidebar.projectless_thread_order === undefined
          ? null
          : [...snapshot.value.sidebar.projectless_thread_order],
    };
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
    readProjectPermissionMode,
    setProjectPermissionMode: async (projectId, mode) => {
      await apply({
        kind: "set_project_permission_mode",
        project_id: projectId,
        mode,
      });
      const selected = await readProjectPermissionMode(projectId);
      if (!selected) {
        throw new Error(`Updated Project permission mode not found: ${projectId}`);
      }
      return selected;
    },
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
    setProjectLifecycle: async (projectId, lifecycle) => {
      const current = await getProject(projectId);
      if (!current) return null;
      if (current.lifecycle === lifecycle) return current;
      await apply({
        kind: "set_project_lifecycle",
        project_id: projectId,
        lifecycle,
      });
      return await getProject(projectId);
    },
    listProjectSessions: async (projectId, options) => {
      const summaries = await listSummaries(projectId, options);
      const sessions = await Promise.all(
        summaries.map((summary) => readSession(summary.id)),
      );
      return sessions.filter((session): session is ProjectSession => session !== null);
    },
    listProjectSessionSummaries: listSummaries,
    listProjectThreads,
    getProjectSession: readSession,
    updateProjectSession: async (sessionId, input) => {
      const parsed = ProjectSessionUpdateInputSchema.parse(input);
      const current = await readSession(sessionId);
      if (!current) return null;
      if (
        parsed.noThreadFallbackTitle === undefined
      ) {
        return current;
      }
      await apply({
        kind: "mutate_session",
        session_id: sessionId,
        intent: {
          kind: "set_fallback_title",
          title: parsed.noThreadFallbackTitle,
        },
      });
      return await readSession(sessionId);
    },
    renameProjectSession: async (sessionId, input) => {
      const parsed = ProjectSessionRenameInputSchema.parse(input);
      if (!(await readSession(sessionId))) return null;
      await apply({
        kind: "mutate_session",
        session_id: sessionId,
        intent: { kind: "rename", title: parsed.title },
      });
      return await readSession(sessionId);
    },
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
    upsertProjectSessionThreadLink: async (input) => {
      const parsed = ProjectSessionThreadLinkInputSchema.parse(input);
      const session = await readSession(parsed.sessionId);
      if (!session) {
        throw new Error(`Project session not found: ${parsed.sessionId}`);
      }
      if (session.projectId !== parsed.projectId) {
        throw new Error("Thread project must match the owning session project");
      }
      const existing = await readCoreThread(parsed.threadId);
      const hasForkedFromId = Object.prototype.hasOwnProperty.call(
        input,
        "forkedFromId",
      );
      const hasThreadSource = Object.prototype.hasOwnProperty.call(
        input,
        "threadSource",
      );
      const hasServiceName = Object.prototype.hasOwnProperty.call(
        input,
        "serviceName",
      );
      const hasAgentNickname = Object.prototype.hasOwnProperty.call(
        input,
        "agentNickname",
      );
      const hasAgentRole = Object.prototype.hasOwnProperty.call(
        input,
        "agentRole",
      );
      const hasAgentPath = Object.prototype.hasOwnProperty.call(
        input,
        "agentPath",
      );
      const hasManagedWorktreePath = Object.prototype.hasOwnProperty.call(
        input,
        "managedWorktreePath",
      );
      const hasExecutionProfile = Object.prototype.hasOwnProperty.call(
        input,
        "executionProfile",
      );
      await apply({
        kind: "mutate_session",
        session_id: parsed.sessionId,
        intent: {
          kind: "link_thread",
          thread_id: parsed.threadId,
          expected_project_id: parsed.projectId,
          thread_patch: {
            project_id: parsed.projectId,
            ...(hasForkedFromId
              ? { forked_from_id: parsed.forkedFromId ?? null }
              : {}),
            ...(parsed.parentThreadId
              ? { parent_thread_id: parsed.parentThreadId }
              : {}),
            ...(hasThreadSource
              ? { thread_source: parsed.threadSource ?? null }
              : {}),
            ...(hasServiceName
              ? { service_name: parsed.serviceName ?? null }
              : {}),
            ...(hasAgentNickname
              ? { agent_nickname: parsed.agentNickname ?? null }
              : {}),
            ...(hasAgentRole
              ? { agent_role: parsed.agentRole ?? null }
              : {}),
            ...(hasAgentPath
              ? { agent_path: parsed.agentPath ?? null }
              : {}),
            ...(parsed.threadName != null
              ? { thread_name: parsed.threadName }
              : {}),
            thread_preview:
              parsed.threadPreview ?? existing?.thread_preview ?? "",
            model_provider: parsed.executionProfile?.providerId
              ?? parsed.modelProvider
              ?? existing?.model_provider
              ?? "",
            ...(hasExecutionProfile
              ? toCoreExecutionProfilePatch(parsed.executionProfile ?? null)
              : {}),
            ...(parsed.cwd != null ? { cwd: parsed.cwd } : {}),
            ...(hasManagedWorktreePath
              ? { managed_worktree_path: parsed.managedWorktreePath ?? null }
              : {}),
            ...(parsed.projectlessOutputDirectory != null
              ? {
                  projectless_output_directory:
                    parsed.projectlessOutputDirectory,
                }
              : {}),
            ...(parsed.projectlessWorkspaceBrowserRoot != null
              ? {
                  projectless_workspace_browser_root:
                    parsed.projectlessWorkspaceBrowserRoot,
                }
              : {}),
            status: {
              status_type: parsed.statusType ?? "notLoaded",
              active_flags: parsed.statusActiveFlags ?? [],
            },
            archived: parsed.archived ?? existing?.archived ?? false,
            ...(!existing && parsed.createdAt !== undefined
              ? { created_at: parsed.createdAt }
              : {}),
            ...(parsed.updatedAt !== undefined
              ? { updated_at: parsed.updatedAt }
              : {}),
          },
        },
      });
      const linked = await readSession(parsed.sessionId);
      if (!linked?.thread) {
        throw new Error("Unable to attach project session thread");
      }
      return linked.thread;
    },
    detachProjectSessionThread: async (sessionId) => {
      const session = await readSession(sessionId);
      if (!session?.thread) return false;
      await apply({
        kind: "mutate_session",
        session_id: sessionId,
        intent: {
          kind: "unlink_thread",
          thread_id: session.thread.threadId,
        },
      });
      return true;
    },
    getThread,
    upsertThread: async (threadId, patch) => {
      await apply({
        kind: "upsert_thread",
        thread_id: threadId,
        patch: toCoreThreadPatch(patch),
      });
      const thread = await getThread(threadId);
      if (!thread) {
        throw new Error(`Unable to read upserted Codex Thread '${threadId}'`);
      }
      return thread;
    },
    updateThread: async (threadId, patch) => {
      try {
        await apply({
          kind: "update_thread",
          thread_id: threadId,
          patch: toCoreThreadPatch(patch),
        });
      } catch (error) {
        if (!isNotFound(error)) throw error;
        return null;
      }
      return await getThread(threadId);
    },
    moveThread: async (input) => {
      await apply({
        kind: "move_thread",
        thread_id: input.threadId,
        source: toCoreThreadLane(input.sourceProjectId),
        target: toCoreThreadLane(input.targetProjectId),
        placement: toCoreThreadMovePlacement(input),
        metadata: toCoreThreadMoveMetadata(input.metadata),
      });
      const thread = await getThread(input.threadId);
      if (!thread) {
        throw new Error(`Unable to read moved Codex Thread '${input.threadId}'`);
      }
      return { thread, sidebar: await readSidebar(false) };
    },
    setThreadUnread: async (threadId, unread) => {
      try {
        await apply({
          kind: "set_thread_unread",
          thread_id: threadId,
          unread,
        });
      } catch (error) {
        if (!isNotFound(error)) throw error;
        return null;
      }
      return await getThread(threadId);
    },
    setThreadArchived: async (threadId, archived) => {
      try {
        await apply({
          kind: "set_thread_archived",
          thread_id: threadId,
          archived,
        });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return await readSidebar(false);
    },
    deleteThread: async (threadId) => {
      const existing = await readCoreThread(threadId);
      if (!existing) {
        return { deleted: false, sidebar: await readSidebar(false) };
      }
      await apply({ kind: "delete_thread", thread_id: threadId });
      return { deleted: true, sidebar: await readSidebar(false) };
    },
    readThreadExecutionContext,
    replaceThreadDynamicToolCatalogs: async (threadId, catalogs) => {
      await apply({
        kind: "replace_thread_dynamic_tool_catalogs",
        thread_id: threadId,
        catalogs: catalogs.map((catalog) => ({
          namespace: catalog.namespace,
          toolset_revision: catalog.toolsetRevision,
        })),
      });
      const context = await readThreadExecutionContext(threadId);
      if (!context) {
        throw new Error(`Updated Core Thread not found: ${threadId}`);
      }
      return context.dynamicToolCatalogs;
    },
    mergeThreadWritableRoots: async (threadId, roots) => {
      await apply({
        kind: "merge_thread_writable_roots",
        thread_id: threadId,
        roots: [...roots],
      });
      const context = await readThreadExecutionContext(threadId);
      if (!context) {
        throw new Error(`Updated Core Thread not found: ${threadId}`);
      }
      return context.writableRoots;
    },
    replaceThreadWritableRoots: async (threadId, roots) => {
      await apply({
        kind: "replace_thread_writable_roots",
        thread_id: threadId,
        roots: [...roots],
      });
      const context = await readThreadExecutionContext(threadId);
      if (!context) {
        throw new Error(`Updated Core Thread not found: ${threadId}`);
      }
      return context.writableRoots;
    },
    listBackgroundProcesses,
    upsertBackgroundProcess: async (input, options = {}) => {
      await apply({
        kind: "upsert_background_process",
        process: {
          id: input.id,
          thread_id: input.threadId,
          thread_title: input.threadTitle,
          item_id: input.itemId,
          turn_id: input.turnId,
          command: input.command,
          cwd: input.cwd,
          process_id: input.processId,
          os_pid: input.osPid,
          terminal_session_id: input.terminalSessionId,
          source: input.source,
          started_at_ms: input.startedAtMs,
          updated_at_ms: input.updatedAtMs,
        },
        preserve_started_at: options.preserveStartedAt ?? true,
      });
      const persisted = (await listBackgroundProcesses(input.threadId))
        .find((candidate) => candidate.id === input.id);
      if (!persisted) {
        throw new Error(`Updated Core background process not found: ${input.id}`);
      }
      return persisted;
    },
    readSidebar,
    setProjectThreadOrder: async (projectId, orderedThreadIds) => {
      await apply(orderedThreadIds === null
        ? {
            kind: "clear_project_thread_order",
            project_id: projectId,
          }
        : {
            kind: "set_project_thread_order",
            project_id: projectId,
            ordered_thread_ids: [...orderedThreadIds],
          });
      return await readSidebar(false);
    },
    setProjectlessThreadOrder: async (input) => {
      await apply({
        kind: "set_projectless_thread_order",
        thread_ids_in_display_order: [...input.threadIdsInDisplayOrder],
        visible_thread_ids: [...input.visibleThreadIds],
        next_visible_thread_ids: [...input.nextVisibleThreadIds],
      });
      return await readSidebar(false);
    },
    setThreadPinned: async (threadId, pinned, beforeThreadId) => {
      try {
        await apply({
          kind: "set_thread_pinned",
          thread_id: threadId,
          pinned,
          ...(!pinned || beforeThreadId === undefined
            ? {}
            : {
                placement: beforeThreadId === null
                  ? { kind: "end" }
                  : { kind: "before", thread_id: beforeThreadId },
              }),
        });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return await readSidebar(false);
    },
    reorderPinnedThreads: async (orderedThreadIds) => {
      await apply({
        kind: "reorder_pinned_threads",
        thread_ids: [...orderedThreadIds],
      });
      return await readSidebar(false);
    },
  };
}
