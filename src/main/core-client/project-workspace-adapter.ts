import { randomUUID } from "node:crypto";

import type {
  CodexBackgroundProcessRecord,
  CodexPermissionMode,
  CodexThreadActiveFlag,
  CodexThreadStatusType,
  CodexThreadSummary,
  Project,
  ProjectActivitySummaryResult,
  ProjectCreateInput,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
  ProjectSession,
  ProjectSessionCreateInput,
  ProjectSessionPinnedInput,
  ProjectSessionPinnedOrderInput,
  ProjectSessionRenameInput,
  ProjectSessionSummary,
  ProjectSessionThreadSummary,
  ProjectSessionSummaryWindow,
  ProjectSessionSummaryWindowInput,
  ProjectSessionThreadLink,
  ProjectSessionThreadLinkInput,
  ProjectSessionUnreadInput,
  ProjectSessionUpdateInput,
  ProjectUpdateInput,
  ProjectWindow,
  ProjectWindowInput,
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
import { applyResultCursor } from "./types";

type CoreProject = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "project_window" }
>["projects"]["items"][number];
type CoreSessionSummary = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "session" }
>["session"];
type CoreTask = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "task_window" }
>["tasks"]["items"][number];
type CoreTaskThread = NonNullable<CoreTask["thread"]>;
type CoreThread = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "thread" }
>["thread"];
type CoreBackgroundProcess = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "background_process_window" }
>["processes"]["items"][number];
type CoreManagedWorktreeLifecycleSnapshot = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { kind: "managed_worktree_lifecycle_snapshot" }
>["snapshot"];

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
  readonly executionHostId: string;
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
  readonly executionHostId?: string;
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
  readonly afterThreadId?: string | null;
  readonly insertAtEnd?: boolean;
  readonly useDefaultOrder?: boolean;
  readonly runtimeWorkspaceRoots?: readonly string[];
  readonly projectAccessGrant?: {
    readonly expectedTargetBindingRevision: number;
    readonly missingProjectSources: readonly string[];
  };
  readonly metadata?: Pick<
    DesktopProjectWorkspaceThreadPatch,
    | "cwd"
    | "executionHostId"
    | "managedWorktreePath"
    | "projectlessOutputDirectory"
    | "projectlessWorkspaceBrowserRoot"
  >;
}

export interface DesktopProjectWorkspaceExecutionLocation {
  readonly executionHostId: string;
  readonly cwd: string | null;
  readonly managedWorktreePath: string | null;
  readonly runtimeWorkspaceRoots: readonly string[];
  readonly projectlessOutputDirectory: string | null;
  readonly projectlessWorkspaceBrowserRoot: string | null;
}

export interface DesktopProjectWorkspaceSidebar {
  readonly threads: readonly DesktopProjectWorkspaceThread[];
}

export interface DesktopProjectWorkspaceExecutionContext {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly permissionMode: CodexPermissionMode | null;
  readonly dynamicToolCatalogs: readonly DynamicToolCatalogSelection[];
  readonly writableRoots: readonly string[];
}

export interface DesktopManagedWorktreeSummary {
  readonly threadId: string;
  readonly projectId: string;
  readonly sessionId: string | null;
  readonly sessionTitle: string | null;
  readonly threadName: string | null;
  readonly path: string;
  readonly linkedAt: string;
}

export interface DesktopManagedWorktreeWindow {
  readonly items: readonly DesktopManagedWorktreeSummary[];
  readonly nextCursor: string | null;
  readonly projectionRevision: number;
}

export interface DesktopManagedWorktreeLifecycleConsumer {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly sessionId: string | null;
  readonly executionHostId: string;
  readonly cwd: string | null;
  readonly managedWorktreePath: string;
  readonly runtimeWorkspaceRoots: readonly string[];
  readonly archived: boolean;
  readonly pinnedOrder: number | null;
  readonly statusType: CodexThreadStatusType;
  readonly statusActiveFlags: readonly CodexThreadActiveFlag[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly linkedAt: string;
}

export interface DesktopManagedWorktreeProjectProtection {
  readonly projectId: string;
  readonly lifecycle: Project["lifecycle"];
  readonly sourceRoots: readonly string[];
  readonly primaryWorkspaceRoot: string | null;
}

export interface DesktopManagedWorktreeLifecycleSnapshot {
  readonly projectionRevision: number;
  readonly consumers: readonly DesktopManagedWorktreeLifecycleConsumer[];
  readonly projects: readonly DesktopManagedWorktreeProjectProtection[];
}

export interface DesktopAppServerSweepReconcileResult {
  readonly threadIds: readonly string[];
  readonly projectIds: readonly string[];
}

export interface DesktopProjectBootstrap {
  readonly status: "empty" | "ready";
}

export interface DesktopInitialProjectStarterPage {
  readonly pageId: string;
  readonly documentId: string;
  readonly titleMarkdown: string;
  readonly nfm: string;
}

export interface DesktopInitialProjectCreateInput extends ProjectCreateInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly starterPage: DesktopInitialProjectStarterPage;
}

export interface DesktopInitialProjectCreateResult {
  readonly project: Project;
}

export interface DesktopProjectWorkspacePort {
  readProjectBootstrap(): Promise<DesktopProjectBootstrap>;
  /** Available (non-archived) Projects form one fixed 200-item domain collection. */
  listProjects(): Promise<Project[]>;
  listProjectWindow(input?: ProjectWindowInput): Promise<ProjectWindow>;
  readProjectActivitySummaries(
    projectIds: readonly string[],
  ): Promise<ProjectActivitySummaryResult>;
  getProject(projectId: string): Promise<Project | null>;
  readProjectPermissionMode(
    projectId: string,
  ): Promise<CodexPermissionMode | null>;
  readProjectlessPermissionMode(): Promise<CodexPermissionMode | null>;
  setProjectPermissionMode(
    projectId: string,
    mode: CodexPermissionMode,
  ): Promise<CodexPermissionMode>;
  setProjectlessPermissionMode(
    mode: CodexPermissionMode,
  ): Promise<CodexPermissionMode>;
  createInitialProject(
    input: DesktopInitialProjectCreateInput,
  ): Promise<DesktopInitialProjectCreateResult>;
  createProject(input: ProjectCreateInput): Promise<Project>;
  updateProject(
    projectId: string,
    input: ProjectUpdateInput,
  ): Promise<Project | null>;
  reorderProjects(input: ProjectOrderInput): Promise<void>;
  setProjectPinned(
    projectId: string,
    input: ProjectPinnedInput,
  ): Promise<Project | null>;
  setPinnedProjectOrder(input: ProjectPinnedOrderInput): Promise<void>;
  setProjectLifecycle(
    projectId: string,
    lifecycle: Project["lifecycle"],
  ): Promise<Project | null>;
  listProjectSessionSummaryWindow(
    projectId: string | null,
    input?: ProjectSessionSummaryWindowInput,
  ): Promise<ProjectSessionSummaryWindow>;
  readSidebarOverview(
    includeArchived?: boolean,
    input?: ProjectSessionSummaryWindowInput,
  ): Promise<ProjectSessionSummaryWindow>;
  getProjectSession(sessionId: string): Promise<ProjectSession | null>;
  updateProjectSession(
    sessionId: string,
    input: ProjectSessionUpdateInput,
  ): Promise<ProjectSession | null>;
  renameProjectSession(
    sessionId: string,
    input: ProjectSessionRenameInput,
  ): Promise<ProjectSession | null>;
  ensureDefaultDraftProjectSession(
    projectId: string | null,
  ): Promise<ProjectSession>;
  createProjectSession(input: ProjectSessionCreateInput): Promise<ProjectSession>;
  deleteProjectSession(sessionId: string): Promise<boolean>;
  reorderProjectSessions(
    projectId: string | null,
    orderedSessionIds: string[],
  ): Promise<void>;
  setProjectSessionPinned(
    sessionId: string,
    input: ProjectSessionPinnedInput,
  ): Promise<ProjectSession | null>;
  setPinnedProjectSessionOrder(
    projectId: string,
    input: ProjectSessionPinnedOrderInput,
  ): Promise<void>;
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
  setThreadExecutionLocation(
    threadId: string,
    location: DesktopProjectWorkspaceExecutionLocation,
  ): Promise<DesktopProjectWorkspaceThread | null>;
  moveThread(input: DesktopProjectWorkspaceThreadMoveInput): Promise<{
    readonly thread: DesktopProjectWorkspaceThread;
    readonly operationId: string;
    readonly projectionRevision: number;
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
  observeAppServerThreadWindow(
    sweepId: string,
    threadIds: readonly string[],
  ): Promise<void>;
  reconcileAppServerThreadSweep(
    sweepId: string,
    limit?: number,
  ): Promise<DesktopAppServerSweepReconcileResult>;
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
  listManagedWorktreeWindow(
    input?: {
      projectId?: string | null;
      after?: string | null;
      first?: number;
    },
  ): Promise<DesktopManagedWorktreeWindow>;
  readManagedWorktreeLifecycleSnapshot(): Promise<DesktopManagedWorktreeLifecycleSnapshot>;
  upsertBackgroundProcess(
    input: CodexBackgroundProcessRecord,
    options?: { readonly preserveStartedAt?: boolean },
  ): Promise<CodexBackgroundProcessRecord>;
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
  defaultDatabaseViewId: project.default_database_view_id ?? null,
  lifecycle: project.lifecycle,
  bindingRevision: project.binding_revision,
  name: project.name,
  description: project.description,
  appearance: project.appearance,
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
  threadSource: thread.thread_source ?? null,
  serviceName: thread.service_name ?? null,
  agentNickname: thread.agent_nickname ?? null,
  agentRole: thread.agent_role ?? null,
  agentPath: thread.agent_path ?? null,
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
  executionHostId: thread.execution_host_id,
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

const fromCoreTaskThread = (
  thread: CoreTaskThread,
  sessionId: string,
  sessionProjectId: string | null,
): ProjectSessionThreadSummary => ({
  sessionId,
  projectId: thread.project_id ?? sessionProjectId,
  threadId: thread.thread_id,
  forkedFromId: thread.forked_from_id ?? null,
  parentThreadId: thread.parent_thread_id ?? undefined,
  threadSource: thread.thread_source ?? null,
  serviceName: thread.service_name ?? null,
  agentNickname: thread.agent_nickname ?? null,
  agentRole: thread.agent_role ?? null,
  agentPath: thread.agent_path ?? null,
  threadName: thread.thread_name ?? undefined,
  threadPreview: thread.thread_preview,
  executionHostId: thread.execution_host_id,
  cwd: thread.cwd ?? undefined,
  managedWorktreePath: thread.managed_worktree_path ?? null,
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
  executionHostId: thread.execution_host_id,
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
  ...(patch.executionHostId === undefined
    ? {}
    : { execution_host_id: patch.executionHostId }),
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
  const movedThreadId = input.threadId.trim();
  const beforeThreadId = input.beforeThreadId?.trim() || null;
  const afterThreadId = input.afterThreadId?.trim() || null;
  const insertAtEnd = input.insertAtEnd === true;
  const useDefaultOrder = input.useDefaultOrder === true;
  const explicitPlacements = [
    beforeThreadId !== null,
    afterThreadId !== null,
    insertAtEnd,
    useDefaultOrder,
  ].filter(Boolean).length;
  if (explicitPlacements > 1) {
    throw new Error(
      "Thread placement accepts only one of beforeThreadId, afterThreadId, insertAtEnd, or useDefaultOrder",
    );
  }
  if (beforeThreadId === movedThreadId || afterThreadId === movedThreadId) {
    throw new Error("Thread placement anchor must reference another Thread");
  }
  if (useDefaultOrder) return { kind: "default" as const };
  if (beforeThreadId !== null) {
    return { kind: "before" as const, thread_id: beforeThreadId };
  }
  if (afterThreadId !== null) {
    return { kind: "after" as const, thread_id: afterThreadId };
  }
  if (insertAtEnd) return { kind: "end" as const };
  return { kind: "start" as const };
};

const toCoreThreadMoveMetadata = (
  metadata: DesktopProjectWorkspaceThreadMoveInput["metadata"],
) => ({
  ...(metadata?.executionHostId === undefined
    ? {}
    : { execution_host_id: metadata.executionHostId }),
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
  thread: ProjectSessionThreadSummary | null,
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
  thread,
  createdAt: session.created_at,
  updatedAt: session.updated_at,
});

const fromCoreSessionDetail = (
  session: CoreSessionSummary,
  thread: ProjectSessionThreadLink | null,
): ProjectSession => ({
  ...fromCoreSessionSummary(session, null),
  thread,
});

const fromCoreTask = (task: CoreTask): ProjectSessionSummary =>
  fromCoreSessionSummary(
    task.session,
    task.thread
      ? fromCoreTaskThread(
          task.thread,
          task.session.id,
          task.session.project_id ?? null,
        )
      : null,
  );

export function createCoreProjectWorkspaceAdapter(
  client: CoreClientPort,
): DesktopProjectWorkspacePort {
  const projectUpdateTails = new Map<string, Promise<void>>();
  const runSerializedProjectUpdate = async <T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previous = projectUpdateTails.get(projectId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    projectUpdateTails.set(projectId, tail);
    try {
      return await result;
    } finally {
      if (projectUpdateTails.get(projectId) === tail) {
        projectUpdateTails.delete(projectId);
      }
    }
  };

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
    return fromCoreSessionDetail(summary, thread);
  };

  const listSummaryWindow = async (
    projectId: string | null,
    input?: ProjectSessionSummaryWindowInput,
  ): Promise<ProjectSessionSummaryWindow> => {
    const snapshot = await client.workspaceRead({
      kind: "task_window",
      project_id: projectId,
      include_archived: input?.includeArchived ?? false,
      window: {
        after: input?.after ?? null,
        first: input?.first,
      },
    });
    if (snapshot.value.kind !== "task_window") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    const tasks = snapshot.value.tasks;
    return {
      items: tasks.items.map(fromCoreTask),
      nextCursor: tasks.next_cursor ?? null,
      hasMore: tasks.next_cursor !== null && tasks.next_cursor !== undefined,
      projectionRevision: tasks.authority.projection_revision,
    };
  };

  const readSidebarOverview = async (
    includeArchived = false,
    input?: ProjectSessionSummaryWindowInput,
  ): Promise<ProjectSessionSummaryWindow> => {
    const snapshot = await client.workspaceRead({
      kind: "sidebar_overview",
      include_archived: includeArchived,
      pinned_window: {
        after: input?.after ?? null,
        first: input?.first ?? 100,
      },
    });
    if (snapshot.value.kind !== "sidebar_overview") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    const tasks = snapshot.value.pinned_tasks;
    return {
      items: tasks.items.map(fromCoreTask),
      nextCursor: tasks.next_cursor ?? null,
      hasMore: tasks.next_cursor !== null && tasks.next_cursor !== undefined,
      projectionRevision: tasks.authority.projection_revision,
    };
  };

  const readProjectWindow = async (
    input: ProjectWindowInput = {},
  ): Promise<ProjectWindow> => {
    const snapshot = await client.workspaceRead({
      kind: "project_window",
      include_archived: input.includeArchived ?? false,
      window: {
        after: input.after ?? null,
        first: input.first ?? 100,
      },
    });
    if (snapshot.value.kind !== "project_window") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return {
      items: snapshot.value.projects.items.map(fromCoreProject),
      nextCursor: snapshot.value.projects.next_cursor ?? null,
      hasMore: snapshot.value.projects.next_cursor !== null
        && snapshot.value.projects.next_cursor !== undefined,
      projectionRevision: snapshot.value.projects.authority.projection_revision,
    };
  };

  const readProjects = async (): Promise<Project[]> => {
    const window = await readProjectWindow({
      includeArchived: false,
      first: 200,
    });
    if (window.nextCursor !== null) {
      throw new Error("Available Project collection exceeded its fixed Core bound");
    }
    return [...window.items];
  };

  const readProjectBootstrap = async (): Promise<DesktopProjectBootstrap> => {
    const snapshot = await client.workspaceRead({ kind: "project_bootstrap" });
    if (snapshot.value.kind !== "project_bootstrap") {
      throw new Error("Core returned the wrong Project bootstrap read variant");
    }
    return {
      status: snapshot.value.bootstrap.status,
    };
  };

  const readProjectActivitySummaries = async (
    projectIds: readonly string[],
  ): Promise<ProjectActivitySummaryResult> => {
    const snapshot = await client.workspaceRead({
      kind: "project_activity_summaries",
      project_ids: [...projectIds],
    });
    if (snapshot.value.kind !== "project_activity_summaries") {
      throw new Error(
        "Core returned the wrong Project activity summaries read variant",
      );
    }
    return {
      summaries: snapshot.value.summaries.map((summary) => ({
        projectId: summary.project_id,
        taskCount: summary.task_count,
        waitingCount: summary.waiting_count,
        unreadCount: summary.unread_count,
        activeCount: summary.active_count,
      })),
      projectionRevision: snapshot.value.projection_revision,
    };
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

  const readProjectlessPermissionMode = async (): Promise<CodexPermissionMode | null> => {
    let snapshot: ProjectWorkspaceReadSnapshot;
    try {
      snapshot = await client.workspaceRead({
        kind: "projectless_permission_mode",
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (snapshot.value.kind !== "projectless_permission_mode") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    return snapshot.value.mode ?? null;
  };

  const listBackgroundProcesses = async (
    threadId?: string | null,
  ): Promise<CodexBackgroundProcessRecord[]> => {
    const normalizedThreadId = threadId?.trim() || null;
    const snapshot = await client.workspaceRead({
      kind: "background_process_window",
      thread_id: normalizedThreadId,
      window: { after: null, first: 200 },
    });
    if (snapshot.value.kind !== "background_process_window") {
      throw new Error("Core returned the wrong Project Workspace read variant");
    }
    if (snapshot.value.processes.next_cursor) {
      throw new Error("Background process collection exceeded its fixed Core bound");
    }
    return snapshot.value.processes.items.map(fromCoreBackgroundProcess);
  };

  const listManagedWorktreeWindow = async (
    input: {
      projectId?: string | null;
      after?: string | null;
      first?: number;
    } = {},
  ): Promise<DesktopManagedWorktreeWindow> => {
    const snapshot = await client.workspaceRead({
      kind: "managed_worktree_window",
      project_id: input.projectId ?? null,
      window: {
        after: input.after ?? null,
        first: input.first ?? 200,
      },
    });
    if (snapshot.value.kind !== "managed_worktree_window") {
      throw new Error("Core returned the wrong managed-worktree window variant");
    }
    return {
      items: snapshot.value.worktrees.items.map((worktree) => ({
        threadId: worktree.thread_id,
        projectId: worktree.project_id,
        sessionId: worktree.session_id ?? null,
        sessionTitle: worktree.session_title ?? null,
        threadName: worktree.thread_name ?? null,
        path: worktree.path,
        linkedAt: worktree.linked_at,
      })),
      nextCursor: snapshot.value.worktrees.next_cursor ?? null,
      projectionRevision: snapshot.value.worktrees.authority.projection_revision,
    };
  };

  const readManagedWorktreeLifecycleSnapshot = async (
  ): Promise<DesktopManagedWorktreeLifecycleSnapshot> => {
    const read = await client.workspaceRead({
      kind: "managed_worktree_lifecycle_snapshot",
    });
    if (read.value.kind !== "managed_worktree_lifecycle_snapshot") {
      throw new Error("Core returned the wrong managed-worktree lifecycle variant");
    }
    const snapshot: CoreManagedWorktreeLifecycleSnapshot = read.value.snapshot;
    return {
      projectionRevision: snapshot.projection_revision,
      consumers: snapshot.consumers.map((consumer) => ({
        threadId: consumer.thread_id,
        projectId: consumer.project_id ?? null,
        sessionId: consumer.session_id ?? null,
        executionHostId: consumer.execution_host_id,
        cwd: consumer.cwd ?? null,
        managedWorktreePath: consumer.managed_worktree_path,
        runtimeWorkspaceRoots: [...consumer.runtime_workspace_roots],
        archived: consumer.archived,
        pinnedOrder: consumer.pinned_order ?? null,
        statusType: consumer.status.status_type,
        statusActiveFlags: [...consumer.status.active_flags],
        createdAt: consumer.created_at,
        updatedAt: consumer.updated_at,
        linkedAt: consumer.linked_at,
      })),
      projects: snapshot.projects.map((project) => ({
        projectId: project.project_id,
        lifecycle: project.lifecycle,
        sourceRoots: project.sources.map((source) => source.root),
        primaryWorkspaceRoot: project.primary_workspace_root ?? null,
      })),
    };
  };

  const mutationSidebarReceipt = (
    threads: readonly DesktopProjectWorkspaceThread[] = [],
  ): DesktopProjectWorkspaceSidebar => ({
    threads,
  });

  const apply = async (
    intent: Parameters<CoreClientPort["workspaceApply"]>[0]["intent"],
  ): ReturnType<CoreClientPort["workspaceApply"]> => {
    return await client.workspaceApply({ operationId: randomUUID(), intent });
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
    readProjectBootstrap,
    listProjects: readProjects,
    listProjectWindow: readProjectWindow,
    readProjectActivitySummaries,
    getProject,
    readProjectPermissionMode,
    readProjectlessPermissionMode,
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
    setProjectlessPermissionMode: async (mode) => {
      await apply({
        kind: "set_projectless_permission_mode",
        mode,
      });
      const selected = await readProjectlessPermissionMode();
      if (!selected) {
        throw new Error("Updated projectless permission mode not found");
      }
      return selected;
    },
    createInitialProject: async (input) => {
      await client.workspaceApply({
        operationId: input.operationId,
        intent: {
          kind: "create_initial_project",
          project_id: input.projectId,
          name: input.name ?? "",
          description: input.description ?? "",
          appearance: input.appearance ?? null,
          source_roots: input.sources ?? [],
          ...(input.pageKeyPrefix === undefined
            ? {}
            : { page_key_prefix: input.pageKeyPrefix }),
          starter_page: {
            page_id: input.starterPage.pageId,
            document_id: input.starterPage.documentId,
            title_markdown: input.starterPage.titleMarkdown,
            nfm: input.starterPage.nfm,
          },
        },
      });
      const project = await getProject(input.projectId);
      if (!project) {
        throw new Error(`Created initial Project not found: ${input.projectId}`);
      }
      return { project };
    },
    createProject: async (input) => {
      const projectId = randomUUID();
      await apply({
        kind: "create_project",
        project_id: projectId,
        name: input.name ?? "",
        description: input.description ?? "",
        appearance: input.appearance ?? null,
        source_roots: input.sources ?? [],
        ...(input.pageKeyPrefix === undefined
          ? {}
          : { page_key_prefix: input.pageKeyPrefix }),
      });
      const project = await getProject(projectId);
      if (!project) throw new Error(`Created Project not found: ${projectId}`);
      return project;
    },
    updateProject: (projectId, input) =>
      runSerializedProjectUpdate(projectId, async () => {
        const current = await getProject(projectId);
        if (!current) return null;
        await apply({
          kind: "update_project",
          project_id: projectId,
          expected_binding_revision:
            input.expectedBindingRevision ?? current.bindingRevision,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.appearance !== undefined
            ? { appearance: input.appearance }
            : {}),
          ...(input.sources !== undefined ? { source_roots: input.sources } : {}),
        });
        return await getProject(projectId);
      }),
    reorderProjects: async (input) => {
      await apply({
        kind: "reorder_projects",
        project_ids: input.orderedProjectIds,
      });
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
    listProjectSessionSummaryWindow: listSummaryWindow,
    readSidebarOverview,
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
    ensureDefaultDraftProjectSession: async (projectId) => {
      const applied = await apply({
        kind: "ensure_default_draft_session",
        session_id: randomUUID(),
        project_id: projectId,
        title: "New chat",
      });
      const [sessionId, ...unexpectedSessionIds] = applied.outcome.affected_session_ids;
      if (!sessionId || unexpectedSessionIds.length > 0) {
        throw new Error(
          "Core default-draft ensure did not return exactly one Project Session",
        );
      }
      const session = await readSession(sessionId);
      if (!session) {
        throw new Error(`Ensured Project Session not found: ${sessionId}`);
      }
      return session;
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
      const hasExecutionHostId = Object.prototype.hasOwnProperty.call(
        input,
        "executionHostId",
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
            ...(parsed.runtimeWorkspaceRoots === undefined
              ? {
                  ...(hasExecutionHostId
                    ? { execution_host_id: parsed.executionHostId }
                    : {}),
                  ...(parsed.cwd != null ? { cwd: parsed.cwd } : {}),
                  ...(hasManagedWorktreePath
                    ? {
                        managed_worktree_path:
                          parsed.managedWorktreePath ?? null,
                      }
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
          ...(parsed.runtimeWorkspaceRoots === undefined
            ? {}
            : {
                execution_location: {
                  execution_host_id:
                    parsed.executionHostId
                    ?? existing?.execution_host_id
                    ?? "local",
                  cwd: parsed.cwd ?? null,
                  managed_worktree_path: parsed.managedWorktreePath ?? null,
                  runtime_workspace_roots: [...parsed.runtimeWorkspaceRoots],
                  projectless_output_directory:
                    parsed.projectlessOutputDirectory ?? null,
                  projectless_workspace_browser_root:
                    parsed.projectlessWorkspaceBrowserRoot ?? null,
                },
              }),
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
    setThreadExecutionLocation: async (threadId, location) => {
      try {
        await apply({
          kind: "set_thread_execution_location",
          thread_id: threadId,
          location: {
            execution_host_id: location.executionHostId,
            cwd: location.cwd,
            managed_worktree_path: location.managedWorktreePath,
            runtime_workspace_roots: [...location.runtimeWorkspaceRoots],
            projectless_output_directory: location.projectlessOutputDirectory,
            projectless_workspace_browser_root:
              location.projectlessWorkspaceBrowserRoot,
          },
        });
      } catch (error) {
        if (!isNotFound(error)) throw error;
        return null;
      }
      return await getThread(threadId);
    },
    moveThread: async (input) => {
      const operationId = randomUUID();
      const applied = await client.workspaceApply({ operationId, intent: {
        kind: "move_thread",
        thread_id: input.threadId,
        source: toCoreThreadLane(input.sourceProjectId),
        target: toCoreThreadLane(input.targetProjectId),
        placement: toCoreThreadMovePlacement(input),
        metadata: toCoreThreadMoveMetadata(input.metadata),
        ...(input.runtimeWorkspaceRoots === undefined
          ? {}
          : { runtime_workspace_roots: [...input.runtimeWorkspaceRoots] }),
        ...(input.projectAccessGrant === undefined
          ? {}
          : {
              project_access_grant: {
                expected_target_binding_revision:
                  input.projectAccessGrant.expectedTargetBindingRevision,
                missing_source_roots: [...input.projectAccessGrant.missingProjectSources],
              },
            }),
      } });
      const thread = await getThread(input.threadId);
      if (!thread) {
        throw new Error(`Unable to read moved Codex Thread '${input.threadId}'`);
      }
      return {
        thread,
        operationId,
        projectionRevision: applyResultCursor(applied),
      };
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
      return mutationSidebarReceipt();
    },
    deleteThread: async (threadId) => {
      const existing = await readCoreThread(threadId);
      if (!existing) {
        return { deleted: false, sidebar: mutationSidebarReceipt() };
      }
      await apply({ kind: "delete_thread", thread_id: threadId });
      return { deleted: true, sidebar: mutationSidebarReceipt() };
    },
    observeAppServerThreadWindow: async (sweepId, threadIds) => {
      await apply({
        kind: "observe_app_server_thread_window",
        sweep_id: sweepId,
        thread_ids: [...threadIds],
      });
    },
    reconcileAppServerThreadSweep: async (sweepId, limit = 100) => {
      const committed = await apply({
        kind: "reconcile_app_server_thread_sweep",
        sweep_id: sweepId,
        limit,
      });
      return {
        threadIds: committed.outcome.affected_thread_ids,
        projectIds: committed.outcome.affected_project_ids,
      };
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
    listManagedWorktreeWindow,
    readManagedWorktreeLifecycleSnapshot,
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
      const thread = await getThread(threadId);
      return mutationSidebarReceipt(thread ? [thread] : []);
    },
    reorderPinnedThreads: async (orderedThreadIds) => {
      await apply({
        kind: "reorder_pinned_threads",
        thread_ids: [...orderedThreadIds],
      });
      return mutationSidebarReceipt();
    },
  };
}
