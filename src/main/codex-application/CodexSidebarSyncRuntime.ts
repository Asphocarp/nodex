import { randomUUID } from "node:crypto";
import type { Thread } from "@nodex/codex-app-server-protocol/v2";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { ClientRequestResponsesByMethod } from "@nodex/effect-codex-app-server/rpc";
import type {
  CodexSidebarRefreshPolicy,
  CodexSidebarRefreshReason,
  CodexSidebarSnapshot,
  CodexSidebarSyncResult,
  Project,
  ProjectSession,
} from "../../shared/types";
import { CoreModuleResponseError } from "../core-client/core-client";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CoreModules } from "../core-runtime/CoreModules";
import { CoreRuntimeError } from "../core-runtime/CoreRuntimeError";
import { DatabaseNotifierRuntime } from "../host-runtime/DatabaseNotifierRuntime";
import { getLogger } from "../logging/logger";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { ExecutionHostRuntime } from "./ExecutionHostRuntime";
import { CodexInternalThreadRegistry } from "./CodexInternalThreadRegistry";
import {
  buildWorkspaceThreadSummary,
  hasSidebarThreadSummaryChanged,
  isNonSidebarThreadWithoutParent,
  normalizeSidebarSessionFallbackTitle,
  projectCoreWorkspaceProject,
  projectCoreWorkspaceTask,
  resolveSidebarProjectIdForCwd,
} from "./CodexThreadCatalogProjection";
import { CodexThreadDirectory, type CodexThreadDirectoryEntry } from "./CodexThreadDirectory";

export const DEFAULT_CODEX_SIDEBAR_SYNC_STALE_AFTER = "1 minute";
export const DEFAULT_CODEX_SIDEBAR_SYNC_BACKOFF_INITIAL = "2 seconds";
export const DEFAULT_CODEX_SIDEBAR_SYNC_BACKOFF_MAX = "1 minute";
export const DEFAULT_CODEX_SIDEBAR_NOTIFICATION_SYNC_DEBOUNCE = "300 millis";

export interface CodexSidebarSyncMetadata {
  readonly changedProjectIds: readonly string[];
  readonly projectlessChanged: boolean;
  readonly materializedSessionIds: readonly string[];
  readonly failedThreadIds: readonly string[];
}

export interface CodexSidebarSyncInput {
  readonly includeArchived?: boolean;
  readonly policy?: CodexSidebarRefreshPolicy;
  readonly reason?: CodexSidebarRefreshReason;
}

export interface CodexSidebarSyncNotification {
  readonly notificationMethod: string;
  readonly threadId: string;
}

export interface CodexSidebarCatalogChange {
  readonly reason: CodexSidebarRefreshReason;
  readonly changedProjectIds?: readonly string[];
  readonly projectlessChanged?: boolean;
  readonly materializedSessionIds?: readonly string[];
  readonly failedThreadIds?: readonly string[];
  readonly forceEmit?: boolean;
}

export class CodexSidebarSyncError extends Data.TaggedError("CodexSidebarSyncError")<{
  readonly cause: unknown;
}> {}

export interface CodexSidebarSyncRuntimeOptions {
  readonly foldPathCase?: boolean;
  readonly staleAfter?: Duration.Input;
  readonly backoffInitial?: Duration.Input;
  readonly backoffMax?: Duration.Input;
  readonly notificationDebounce?: Duration.Input;
  readonly sweepRetryInitial?: Duration.Input;
  readonly sweepRetryMax?: Duration.Input;
}

export class CodexSidebarSyncRuntime extends Context.Service<
  CodexSidebarSyncRuntime,
  {
    readonly sync: (
      input?: CodexSidebarSyncInput,
    ) => Effect.Effect<CodexSidebarSyncResult, CodexSidebarSyncError>;
    readonly changed: (
      input: CodexSidebarCatalogChange,
    ) => Effect.Effect<CodexSidebarSyncResult, CodexSidebarSyncError>;
    readonly ensureSession: (
      threadId: string,
    ) => Effect.Effect<ProjectSession | null, CodexSidebarSyncError>;
    readonly invalidate: () => void;
    readonly scheduleNotification: (request: CodexSidebarSyncNotification) => void;
  }
>()("nodex/main/codex-application/CodexSidebarSyncRuntime") {}

interface SidebarCacheEntry {
  readonly invalidationRevision: number;
  readonly snapshot: CodexSidebarSnapshot;
}

interface SidebarCatalogState {
  lastSuccessfulGeneration: number;
  lastSuccessfulRefreshAt: number;
  failureBackoffUntil: number;
  failureBackoffMs: number;
  lastFailure: CodexSidebarSyncError | null;
}

interface MutableSyncMetadata {
  readonly changedProjectIds: Set<string>;
  projectlessChanged: boolean;
  readonly materializedSessionIds: Set<string>;
  readonly failedThreadIds: Set<string>;
}

interface SweepState {
  readonly phase: "scan" | "reconcile";
  readonly sweepId: string;
  readonly cursor: string | null;
  readonly archived: boolean;
  readonly includeArchived: boolean;
  readonly projects: readonly Project[];
  readonly reason: CodexSidebarRefreshReason;
  readonly metadata: MutableSyncMetadata;
}

const emptyMetadata = (): MutableSyncMetadata => ({
  changedProjectIds: new Set(),
  projectlessChanged: false,
  materializedSessionIds: new Set(),
  failedThreadIds: new Set(),
});

const projectMetadata = (metadata: MutableSyncMetadata): CodexSidebarSyncMetadata => ({
  changedProjectIds: [...metadata.changedProjectIds],
  projectlessChanged: metadata.projectlessChanged,
  materializedSessionIds: [...metadata.materializedSessionIds],
  failedThreadIds: [...metadata.failedThreadIds],
});

const markScope = (metadata: MutableSyncMetadata, projectId: string | null): void => {
  if (projectId) metadata.changedProjectIds.add(projectId);
  else metadata.projectlessChanged = true;
};

const isCoreNotFound = (cause: unknown): boolean =>
  cause instanceof CoreRuntimeError &&
  cause.cause instanceof CoreModuleResponseError &&
  cause.cause.coreError.code === "not_found";

const isUnsupportedStateDbOnly = (cause: unknown): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = cause;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const record = current as { readonly cause?: unknown; readonly message?: unknown };
    const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
    if (
      message.includes("usestatedbonly") &&
      (message.includes("unknown") ||
        message.includes("unsupported") ||
        message.includes("invalid"))
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
};

const shouldEmit = (result: CodexSidebarSyncResult): boolean =>
  result.refreshed ||
  result.changedProjectIds.length > 0 ||
  result.projectlessChanged ||
  result.materializedSessionIds.length > 0 ||
  result.failedThreadIds.length > 0;

export const make = (
  options: CodexSidebarSyncRuntimeOptions = {},
): Effect.Effect<
  CodexSidebarSyncRuntime["Service"],
  never,
  | CodexApplicationEventHub
  | CodexGateway
  | CodexInternalThreadRegistry
  | CodexThreadDirectory
  | CoreModules
  | DatabaseNotifierRuntime
  | ExecutionHostRuntime
  | Scope.Scope
> =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    const events = yield* CodexApplicationEventHub;
    const gateway = yield* CodexGateway;
    const internalThreads = yield* CodexInternalThreadRegistry;
    const directory = yield* CodexThreadDirectory;
    const core = yield* CoreModules;
    const notifications = yield* DatabaseNotifierRuntime;
    const executionHosts = yield* ExecutionHostRuntime;
    const logger = getLogger({ component: "codex-sidebar-sync" });
    const refreshes = yield* FiberMap.make<
      boolean,
      CodexSidebarSyncResult,
      CodexSidebarSyncError
    >();
    const refreshAdmission = yield* Semaphore.make(1);
    const mutations = yield* Semaphore.make(1);
    const activeSweep = yield* FiberHandle.make<void, never>();
    const notificationRepair = yield* FiberHandle.make<void, never>();
    const runNotificationRepair = yield* FiberHandle.runtime(notificationRepair)();
    const runSweep = yield* FiberHandle.runtime(activeSweep)();
    const cache = new Map<boolean, SidebarCacheEntry>();
    const catalogStates = new Map<boolean, SidebarCatalogState>();
    const staleAfterMs = Duration.toMillis(
      options.staleAfter ?? DEFAULT_CODEX_SIDEBAR_SYNC_STALE_AFTER,
    );
    const backoffInitialMs = Duration.toMillis(
      options.backoffInitial ?? DEFAULT_CODEX_SIDEBAR_SYNC_BACKOFF_INITIAL,
    );
    const backoffMaxMs = Duration.toMillis(
      options.backoffMax ?? DEFAULT_CODEX_SIDEBAR_SYNC_BACKOFF_MAX,
    );
    const sweepSchedule = Schedule.min([
      Schedule.exponential(options.sweepRetryInitial ?? DEFAULT_CODEX_SIDEBAR_SYNC_BACKOFF_INITIAL),
      Schedule.spaced(options.sweepRetryMax ?? DEFAULT_CODEX_SIDEBAR_SYNC_BACKOFF_MAX),
    ]).pipe(Schedule.jittered);
    let invalidationRevision = 0;
    let generation = 0;
    let useStateDbOnly = true;

    const fail = (cause: unknown): CodexSidebarSyncError =>
      cause instanceof CodexSidebarSyncError ? cause : new CodexSidebarSyncError({ cause });

    const runOwned = <A>(
      operation: Effect.Effect<A, CodexSidebarSyncError>,
    ): Effect.Effect<A, CodexSidebarSyncError> =>
      Effect.acquireUseRelease(
        operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
        Fiber.join,
        Fiber.interrupt,
      );

    const stateFor = (includeArchived: boolean): SidebarCatalogState => {
      const current = catalogStates.get(includeArchived);
      if (current) return current;
      const created: SidebarCatalogState = {
        lastSuccessfulGeneration: 0,
        lastSuccessfulRefreshAt: 0,
        failureBackoffUntil: 0,
        failureBackoffMs: backoffInitialMs,
        lastFailure: null,
      };
      catalogStates.set(includeArchived, created);
      return created;
    };

    const readProjects = Effect.fn("CodexSidebarSync.readProjects")(function* () {
      const response = yield* core.workspace.read({
        kind: "project_window",
        include_archived: false,
        window: { after: null, first: 200 },
      });
      if (response.value.kind !== "project_window") {
        return yield* fail(new Error("Core returned a non-project-window read variant"));
      }
      if (response.value.projects.next_cursor) {
        return yield* fail(new Error("Available Project collection exceeded its Core bound"));
      }
      return response.value.projects.items.map(projectCoreWorkspaceProject);
    });

    const readSession = Effect.fn("CodexSidebarSync.readSession")(function* (
      sessionId: string,
      entry: CodexThreadDirectoryEntry,
    ) {
      const response = yield* core.workspace
        .read({ kind: "session", session_id: sessionId })
        .pipe(
          Effect.catch((cause) =>
            isCoreNotFound(cause) ? Effect.succeed(null) : Effect.fail(cause),
          ),
        );
      if (response === null) return null;
      if (response.value.kind !== "session") {
        return yield* fail(new Error("Core returned a non-session read variant"));
      }
      const session = response.value.session;
      const thread = entry.durable;
      return {
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
        thread: {
          sessionId: session.id,
          projectId: thread.projectId,
          threadId: thread.threadId,
          forkedFromId: thread.forkedFromId,
          parentThreadId: thread.parentThreadId ?? undefined,
          threadSource: thread.threadSource,
          serviceName: thread.serviceName,
          agentNickname: thread.agentNickname,
          agentRole: thread.agentRole,
          agentPath: thread.agentPath,
          threadName: thread.threadName ?? undefined,
          threadPreview: thread.threadPreview,
          modelProvider: thread.modelProvider,
          executionProfile: thread.executionProfile ?? null,
          executionHostId: thread.executionHostId,
          cwd: thread.cwd ?? undefined,
          managedWorktreePath: thread.managedWorktreePath,
          projectlessOutputDirectory: thread.projectlessOutputDirectory,
          projectlessWorkspaceBrowserRoot: thread.projectlessWorkspaceBrowserRoot,
          statusType: thread.statusType,
          statusActiveFlags: [...thread.statusActiveFlags],
          archived: thread.archived,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          recencyAt: thread.recencyAt,
          linkedAt: thread.linkedAt,
        },
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      } satisfies ProjectSession;
    });

    const hide = Effect.fn("CodexSidebarSync.hide")(function* (entry: CodexThreadDirectoryEntry) {
      const thread = entry.durable;
      yield* core.workspace.apply({
        operationId: `electron:sidebar-hide:${thread.threadId}:${randomUUID()}`,
        intent: { kind: "set_thread_archived", thread_id: thread.threadId, archived: true },
      });
      if (!thread.sessionId) return;
      yield* core.workspace
        .apply({
          operationId: `electron:sidebar-hide-unlink:${thread.threadId}:${randomUUID()}`,
          intent: {
            kind: "mutate_session",
            session_id: thread.sessionId,
            intent: { kind: "unlink_thread", thread_id: thread.threadId },
          },
        })
        .pipe(Effect.catch((cause) => (isCoreNotFound(cause) ? Effect.void : Effect.fail(cause))));
    });

    const ensureEntrySession = Effect.fn("CodexSidebarSync.ensureEntrySession")(function* (
      entry: CodexThreadDirectoryEntry,
    ) {
      const thread = entry.durable;
      const summary = buildWorkspaceThreadSummary(thread);
      if (thread.parentThreadId || thread.archived) return null;
      if (
        internalThreads.shouldSuppress(thread.threadId) ||
        isNonSidebarThreadWithoutParent(summary as unknown as Record<string, unknown>)
      ) {
        yield* hide(entry);
        return null;
      }
      if (thread.sessionId) {
        const existing = yield* readSession(thread.sessionId, entry);
        if (existing) return existing;
      }

      const sessionId = randomUUID();
      yield* core.workspace.apply({
        operationId: `electron:sidebar-session-create:${thread.threadId}:${sessionId}`,
        intent: {
          kind: "create_session",
          session_id: sessionId,
          project_id: thread.projectId,
          title: normalizeSidebarSessionFallbackTitle(summary),
          initial_page_ids: [],
        },
      });
      const linked = yield* core.workspace
        .apply({
          operationId: `electron:sidebar-session-link:${thread.threadId}:${sessionId}`,
          intent: {
            kind: "mutate_session",
            session_id: sessionId,
            intent: {
              kind: "link_thread",
              thread_id: thread.threadId,
              expected_project_id: thread.projectId,
            },
          },
        })
        .pipe(Effect.result);
      if (linked._tag === "Failure") {
        yield* core.workspace
          .apply({
            operationId: `electron:sidebar-session-rollback:${thread.threadId}:${sessionId}`,
            intent: { kind: "delete_session", session_id: sessionId },
          })
          .pipe(Effect.ignore);
        return yield* linked.failure;
      }
      if (thread.pinnedOrder !== null) {
        yield* core.workspace.apply({
          operationId: `electron:sidebar-session-pin:${thread.threadId}:${sessionId}`,
          intent: {
            kind: "mutate_session",
            session_id: sessionId,
            intent: { kind: "set_pinned", pinned: true },
          },
        });
      }
      const created = yield* readSession(sessionId, entry);
      if (created?.thread) return created;
      return yield* fail(new Error(`Core did not return Session '${sessionId}' after linking`));
    });

    const ensureSession = (
      threadId: string,
    ): Effect.Effect<ProjectSession | null, CodexSidebarSyncError> =>
      runOwned(
        mutations.withPermit(
          directory
            .resolve({
              threadId: threadId.trim(),
              fidelity: "durable",
              hostId: gateway.localHostId,
            })
            .pipe(
              Effect.mapError(fail),
              Effect.flatMap((entry) => (entry ? ensureEntrySession(entry) : Effect.succeed(null))),
              Effect.mapError(fail),
            ),
        ),
      );

    const readPinnedTasks = Effect.fn("CodexSidebarSync.readPinnedTasks")(function* (
      includeArchived: boolean,
    ) {
      const tasks = [] as Array<ReturnType<typeof projectCoreWorkspaceTask>>;
      let projectionRevision = 0;
      let after: string | null = null;
      do {
        const response: import("../core-client/types").ProjectWorkspaceReadSnapshot =
          yield* core.workspace.read({
            kind: "sidebar_overview",
            include_archived: includeArchived,
            pinned_window: { after, first: 200 },
          });
        if (response.value.kind !== "sidebar_overview") {
          return yield* fail(new Error("Core returned a non-sidebar-overview read variant"));
        }
        projectionRevision = Math.max(
          projectionRevision,
          response.value.pinned_tasks.authority.projection_revision,
        );
        tasks.push(...response.value.pinned_tasks.items.map(projectCoreWorkspaceTask));
        after = response.value.pinned_tasks.next_cursor ?? null;
      } while (after);
      return { tasks, projectionRevision };
    });

    const buildSnapshot = Effect.fn("CodexSidebarSync.buildSnapshot")(function* (
      includeArchived: boolean,
    ) {
      const [{ tasks, projectionRevision }, hosts, generatedAt] = yield* Effect.all(
        [
          readPinnedTasks(includeArchived),
          executionHosts.hosts(),
          Clock.currentTimeMillis,
        ] as const,
        { concurrency: "unbounded" },
      );
      const hostNames = new Map(hosts.map((host) => [host.hostId, host.displayName] as const));
      const projectAssignments: Record<string, string> = {};
      const projectlessThreadIds: string[] = [];
      const items = tasks.flatMap((task) => {
        const thread = task.thread;
        if (!thread || thread.parentThreadId) return [];
        const hostId = thread.executionHostId || gateway.localHostId;
        const isLocalHost = hostId === gateway.localHostId;
        const managedWorktreePath = thread.managedWorktreePath ?? null;
        const projectId = task.projectId ?? thread.projectId;
        if (projectId) projectAssignments[thread.threadId] = projectId;
        else projectlessThreadIds.push(thread.threadId);
        return [
          {
            key: `${isLocalHost ? "local" : "remote"}:${thread.threadId}`,
            kind: isLocalHost ? ("local" as const) : ("remote" as const),
            runLocation: managedWorktreePath
              ? isLocalHost
                ? ({ kind: "local-worktree", path: managedWorktreePath, phase: "ready" } as const)
                : ({
                    kind: "remote-worktree",
                    hostId,
                    hostDisplayName: hostNames.get(hostId) ?? hostId,
                    path: managedWorktreePath,
                    phase: "ready",
                  } as const)
              : isLocalHost
                ? ({ kind: "local-checkout" } as const)
                : ({
                    kind: "remote-checkout",
                    hostId,
                    hostDisplayName: hostNames.get(hostId) ?? hostId,
                  } as const),
            hostId,
            threadId: thread.threadId,
            parentThreadId: thread.parentThreadId ?? null,
            sessionId: task.id,
            projectId,
            title: task.displayTitle,
            preview: thread.threadPreview,
            cwd: thread.cwd ?? null,
            updatedAt: thread.updatedAt,
            recencyAt: thread.recencyAt ?? null,
            createdAt: thread.createdAt,
            pinned: task.pinned,
            pinnedOrder: task.pinnedOrder,
            unread: task.unread,
            archived: task.archived || thread.archived,
            statusType: thread.statusType,
            statusActiveFlags: [...thread.statusActiveFlags],
            projectless: projectId === null,
            disabled: false,
          },
        ];
      });
      return {
        items,
        pinnedThreadIds: items.map((item) => item.threadId),
        projectAssignments,
        projectlessThreadIds,
        revision: projectionRevision,
        generatedAt,
      } satisfies CodexSidebarSnapshot;
    });

    const project = Effect.fn("CodexSidebarSync.project")(function* (input: {
      readonly includeArchived: boolean;
      readonly source: "core" | "app-server";
      readonly refreshed: boolean;
      readonly refreshedAt: number;
      readonly metadata: CodexSidebarSyncMetadata;
      readonly reason: CodexSidebarRefreshReason;
      readonly forceEmit?: boolean;
    }) {
      const revisionAtStart = invalidationRevision;
      const snapshot = yield* buildSnapshot(input.includeArchived);
      const result: CodexSidebarSyncResult = {
        snapshot,
        source: input.source,
        refreshed: input.refreshed,
        refreshedAt: input.refreshedAt,
        changedProjectIds: [...input.metadata.changedProjectIds],
        projectlessChanged: input.metadata.projectlessChanged,
        materializedSessionIds: [...input.metadata.materializedSessionIds],
        failedThreadIds: [...input.metadata.failedThreadIds],
      };
      cache.set(input.includeArchived, { invalidationRevision: revisionAtStart, snapshot });
      if (input.forceEmit || shouldEmit(result)) {
        events.publish({
          kind: "hostMessage",
          value: {
            type: "sidebarSyncUpdated",
            hostId: gateway.localHostId,
            result,
            reason: input.reason,
          },
        });
      }
      return result;
    });

    const requestPage = Effect.fn("CodexSidebarSync.requestPage")(function* (input: {
      readonly cursor: string | null;
      readonly archived: boolean;
    }) {
      const params = (stateDbOnly: boolean) => ({
        cursor: input.cursor,
        limit: 100,
        sortKey: "updated_at" as const,
        sortDirection: "desc" as const,
        modelProviders: null,
        sourceKinds: [],
        archived: input.archived,
        ...(stateDbOnly ? { useStateDbOnly: true } : {}),
      });
      const first = yield* gateway
        .requestLocal("thread/list", params(useStateDbOnly))
        .pipe(Effect.result);
      if (first._tag === "Success") return first.success;
      if (!useStateDbOnly || !isUnsupportedStateDbOnly(first.failure)) return yield* first.failure;
      useStateDbOnly = false;
      yield* Effect.logWarning("App server does not support state-DB thread listing");
      return yield* gateway.requestLocal("thread/list", params(false));
    });

    const archiveExisting = Effect.fn("CodexSidebarSync.archiveExisting")(function* (
      threadId: string,
    ) {
      const existing = yield* directory.resolve({ threadId, fidelity: "durable" });
      if (!existing) return null;
      yield* hide(existing);
      return existing;
    });

    const materializePage = Effect.fn("CodexSidebarSync.materializePage")(function* (
      response: ClientRequestResponsesByMethod["thread/list"],
      state: Pick<SweepState, "projects" | "includeArchived" | "metadata">,
    ) {
      const observedThreadIds: string[] = [];
      yield* Effect.forEach(
        response.data,
        (thread) =>
          Effect.gen(function* () {
            const threadId = thread.id.trim();
            if (!threadId) return;
            const internalKind = internalThreads.observeStarted(thread as Thread);
            if (thread.ephemeral) {
              const hidden = yield* archiveExisting(threadId);
              if (hidden) markScope(state.metadata, hidden.durable.projectId);
              return;
            }
            const parentThreadId = thread.parentThreadId?.trim() || null;
            if (
              !parentThreadId &&
              (internalKind ||
                isNonSidebarThreadWithoutParent(thread as unknown as Record<string, unknown>))
            ) {
              const hidden = yield* archiveExisting(threadId);
              if (hidden) markScope(state.metadata, hidden.durable.projectId);
              return;
            }
            const previous = yield* directory.resolve({ threadId, fidelity: "durable" });
            const inferredProjectId = parentThreadId
              ? null
              : resolveSidebarProjectIdForCwd(
                  thread.cwd,
                  state.projects,
                  options.foldPathCase === true,
                );
            const entry = yield* directory.observeMetadata({
              thread: thread as Thread,
              inferredInitialProjectId: inferredProjectId,
              executionHostId: gateway.localHostId,
            });
            const summary = entry.summary;
            if (hasSidebarThreadSummaryChanged(previous?.summary ?? null, summary)) {
              markScope(state.metadata, previous?.summary.projectId ?? summary.projectId);
              markScope(state.metadata, summary.projectId);
            }
            if (parentThreadId) return;
            observedThreadIds.push(threadId);
            if (!state.includeArchived && summary.archived) return;
            const session = yield* ensureEntrySession(entry);
            if (session && entry.durable.sessionId !== session.id) {
              state.metadata.materializedSessionIds.add(session.id);
              markScope(state.metadata, session.projectId);
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                state.metadata.failedThreadIds.add(thread.id);
                logger.warn("Could not materialize app-server Thread for the sidebar", {
                  threadId: thread.id,
                  cause,
                });
              }),
            ),
          ),
        { concurrency: 8, discard: true },
      );
      return observedThreadIds;
    });

    const observeSweepWindow = (sweepId: string, threadIds: readonly string[]) =>
      threadIds.length === 0
        ? Effect.void
        : core.workspace
            .apply({
              operationId: `electron:sidebar-sweep-observe:${sweepId}:${randomUUID()}`,
              intent: {
                kind: "observe_app_server_thread_window",
                sweep_id: sweepId,
                thread_ids: [...threadIds],
              },
            })
            .pipe(Effect.asVoid);

    const advanceSweep = (
      state: SweepState,
    ): Effect.Effect<SweepState | null, CodexSidebarSyncError> =>
      Effect.gen(function* () {
        if (state.phase === "reconcile") {
          const result = yield* core.workspace.apply({
            operationId: `electron:sidebar-sweep-reconcile:${state.sweepId}:${randomUUID()}`,
            intent: {
              kind: "reconcile_app_server_thread_sweep",
              sweep_id: state.sweepId,
              limit: 100,
            },
          });
          for (const projectId of result.outcome.affected_project_ids) {
            state.metadata.changedProjectIds.add(projectId);
          }
          if (result.outcome.affected_thread_ids.length > 0) {
            state.metadata.projectlessChanged = true;
          }
          if (result.outcome.affected_thread_ids.length === 100) return state;
          const refreshedAt = yield* Clock.currentTimeMillis;
          yield* project({
            includeArchived: state.includeArchived,
            source: "app-server",
            refreshed: true,
            refreshedAt,
            metadata: projectMetadata(state.metadata),
            reason: state.reason,
          });
          return null;
        }

        const response = yield* requestPage({ cursor: state.cursor, archived: state.archived });
        const observed = yield* materializePage(response, state);
        yield* observeSweepWindow(state.sweepId, observed);
        if (response.nextCursor) return { ...state, cursor: response.nextCursor };
        if (!state.archived) return { ...state, cursor: null, archived: true };
        return { ...state, phase: "reconcile" as const, cursor: null };
      }).pipe(Effect.mapError(fail));

    const continueSweep = (initial: SweepState): Effect.Effect<void> => {
      const loop = (state: SweepState): Effect.Effect<void, CodexSidebarSyncError> =>
        mutations.withPermit(advanceSweep(state)).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning("Could not continue background sidebar reconciliation").pipe(
              Effect.annotateLogs({
                cause: String(cause),
                phase: state.phase,
                archived: state.archived,
                cursorPresent: state.cursor !== null,
              }),
            ),
          ),
          Effect.retry(sweepSchedule),
          Effect.flatMap((next) => (next ? loop(next) : Effect.void)),
        );
      return loop(initial).pipe(Effect.catchCause(() => Effect.void));
    };

    const refresh = Effect.fn("CodexSidebarSync.refresh")(function* (input: {
      readonly includeArchived: boolean;
      readonly reason: CodexSidebarRefreshReason;
    }) {
      yield* FiberHandle.clear(activeSweep);
      const projects = yield* readProjects();
      const metadata = emptyMetadata();
      const sweepId = randomUUID();
      const response = yield* requestPage({ cursor: null, archived: false });
      const observed = yield* materializePage(response, {
        projects,
        includeArchived: input.includeArchived,
        metadata,
      });
      yield* observeSweepWindow(sweepId, observed);
      runSweep(
        continueSweep({
          phase: "scan",
          sweepId,
          cursor: response.nextCursor ?? null,
          archived: response.nextCursor == null,
          includeArchived: input.includeArchived,
          projects,
          reason: input.reason,
          metadata,
        }),
      );
      return projectMetadata(metadata);
    });

    const cachedResult = (input: {
      readonly includeArchived: boolean;
      readonly requireCurrentRevision: boolean;
      readonly source: "core" | "stale-last-known";
    }): CodexSidebarSyncResult | null => {
      const entry = cache.get(input.includeArchived);
      if (!entry) return null;
      if (input.requireCurrentRevision && entry.invalidationRevision !== invalidationRevision) {
        return null;
      }
      return {
        snapshot: entry.snapshot,
        source: input.source,
        refreshed: false,
        refreshedAt: stateFor(input.includeArchived).lastSuccessfulRefreshAt,
        changedProjectIds: [],
        projectlessChanged: false,
        materializedSessionIds: [],
        failedThreadIds: [],
      };
    };

    const runRefresh = (input: {
      readonly includeArchived: boolean;
      readonly reason: CodexSidebarRefreshReason;
      readonly generation: number;
    }): Effect.Effect<CodexSidebarSyncResult, CodexSidebarSyncError> =>
      Effect.gen(function* () {
        const attempt = yield* mutations
          .withPermit(refresh(input))
          .pipe(Effect.mapError(fail), Effect.result);
        if (attempt._tag === "Failure") {
          const failedAt = yield* Clock.currentTimeMillis;
          const state = stateFor(input.includeArchived);
          state.lastFailure = attempt.failure;
          state.failureBackoffUntil = failedAt + state.failureBackoffMs;
          state.failureBackoffMs = Math.min(state.failureBackoffMs * 2, backoffMaxMs);
          const fallback = cachedResult({
            includeArchived: input.includeArchived,
            requireCurrentRevision: false,
            source: "stale-last-known",
          });
          if (fallback) return fallback;
          return yield* attempt.failure;
        }
        const refreshedAt = yield* Clock.currentTimeMillis;
        const result = yield* project({
          includeArchived: input.includeArchived,
          source: "app-server",
          refreshed: true,
          refreshedAt,
          metadata: attempt.success,
          reason: input.reason,
        }).pipe(Effect.mapError(fail));
        const state = stateFor(input.includeArchived);
        state.lastSuccessfulGeneration = input.generation;
        state.lastSuccessfulRefreshAt = refreshedAt;
        state.failureBackoffUntil = 0;
        state.failureBackoffMs = backoffInitialMs;
        state.lastFailure = null;
        return result;
      });

    const acquireRefresh = (input: {
      readonly includeArchived: boolean;
      readonly reason: CodexSidebarRefreshReason;
    }) =>
      refreshAdmission.withPermit(
        Effect.gen(function* () {
          const existing = yield* FiberMap.get(refreshes, input.includeArchived);
          if (Option.isSome(existing)) return existing.value;
          generation += 1;
          return yield* FiberMap.run(
            refreshes,
            input.includeArchived,
            runRefresh({ ...input, generation }),
            { startImmediately: true },
          );
        }),
      );

    const sync = (
      input: CodexSidebarSyncInput = {},
    ): Effect.Effect<CodexSidebarSyncResult, CodexSidebarSyncError> =>
      runOwned(
        Effect.gen(function* () {
          const includeArchived = input.includeArchived === true;
          const policy = input.policy ?? "stale";
          const reason = input.reason ?? "manual";
          const state = stateFor(includeArchived);
          if (policy === "read") {
            return yield* project({
              includeArchived,
              source: "core",
              refreshed: false,
              refreshedAt: state.lastSuccessfulRefreshAt,
              metadata: projectMetadata(emptyMetadata()),
              reason,
            }).pipe(Effect.mapError(fail));
          }
          const now = yield* Clock.currentTimeMillis;
          const fresh =
            state.lastSuccessfulGeneration > 0 &&
            now - state.lastSuccessfulRefreshAt < staleAfterMs;
          if (policy === "stale" && fresh && state.failureBackoffUntil <= now) {
            const cached = cachedResult({
              includeArchived,
              requireCurrentRevision: true,
              source: "core",
            });
            if (cached) return cached;
          }
          if (policy === "stale" && state.failureBackoffUntil > now) {
            const cached = cachedResult({
              includeArchived,
              requireCurrentRevision: false,
              source: "stale-last-known",
            });
            if (cached) return cached;
            return yield* state.lastFailure ?? fail(new Error("Sidebar sync is backing off"));
          }
          return yield* Fiber.join(yield* acquireRefresh({ includeArchived, reason }));
        }),
      );

    const changed = (input: CodexSidebarCatalogChange) => {
      invalidationRevision += 1;
      return runOwned(
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((refreshedAt) =>
            project({
              includeArchived: false,
              source: "core",
              refreshed: false,
              refreshedAt,
              metadata: {
                changedProjectIds: [...(input.changedProjectIds ?? [])],
                projectlessChanged: input.projectlessChanged === true,
                materializedSessionIds: [...(input.materializedSessionIds ?? [])],
                failedThreadIds: [...(input.failedThreadIds ?? [])],
              },
              reason: input.reason,
              forceEmit: input.forceEmit,
            }),
          ),
          Effect.mapError(fail),
        ),
      );
    };

    const repairAfterNotification = (minimumGeneration: number) =>
      Effect.gen(function* () {
        const state = stateFor(false);
        if (state.lastSuccessfulGeneration >= minimumGeneration) return;
        const active = yield* refreshAdmission.withPermit(FiberMap.get(refreshes, false));
        if (Option.isSome(active)) yield* Fiber.join(active.value).pipe(Effect.ignore);
        if (state.lastSuccessfulGeneration >= minimumGeneration) return;
        yield* sync({ policy: "force", reason: "host-message" });
      });

    const scheduleNotification = (request: CodexSidebarSyncNotification): void => {
      const minimumGeneration = generation + 1;
      runNotificationRepair(
        Effect.sleep(
          options.notificationDebounce ?? DEFAULT_CODEX_SIDEBAR_NOTIFICATION_SYNC_DEBOUNCE,
        ).pipe(
          Effect.andThen(repairAfterNotification(minimumGeneration)),
          Effect.catchCause((cause) =>
            Effect.logDebug("Sidebar notification repair failed").pipe(
              Effect.annotateLogs({
                cause: String(cause),
                notificationMethod: request.notificationMethod,
                threadId: request.threadId,
              }),
            ),
          ),
        ),
      );
    };

    yield* Stream.runForEach(notifications.projectSessionInvalidations, () =>
      Effect.sync(() => {
        invalidationRevision += 1;
      }),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        cache.clear();
        catalogStates.clear();
      }),
    );

    return CodexSidebarSyncRuntime.of({
      sync,
      changed,
      ensureSession,
      invalidate: () => {
        invalidationRevision += 1;
      },
      scheduleNotification,
    });
  });
