import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type { ThreadSourceKind } from "@nodex/codex-app-server-protocol/v2/ThreadSourceKind";
import type { ClientRequestResponsesByMethod } from "@nodex/effect-codex-app-server/rpc";
import {
  CodexSidebarThreadMoveInputSchema,
  type CodexSidebarThreadMoveInput,
  type CodexSidebarThreadMoveResult,
} from "../../shared/codex-sidebar-thread-move";
import type {
  CodexSidebarSnapshot,
  CodexThreadSummary,
  CodexThreadSummaryWindow,
  CodexThreadSummaryWindowInput,
  CommandPaletteThreadListInput,
  CommandPaletteThreadSearchInput,
  CommandPaletteThreadSearchResult,
  CommandPaletteThreadSummary,
  Project,
  ProjectSessionSummaryWindow,
  ProjectSessionSummaryWindowInput,
} from "../../shared/types";
import type {
  DesktopProjectWorkspaceSidebar,
  DesktopProjectWorkspaceThread,
} from "../core-client/project-workspace-adapter";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CodexSidebarSyncRuntime, type CodexSidebarSyncMetadata } from "./CodexSidebarSyncRuntime";
import {
  isNonSidebarThreadWithoutParent,
  parseThreadStatus,
  resolveSidebarProjectIdForCwd,
  resolveSidebarThreadTitle,
} from "./CodexThreadCatalogProjection";

export class CodexThreadCatalogError extends Data.TaggedError("CodexThreadCatalogError")<{
  readonly operation:
    | "list-pinned"
    | "list-project"
    | "list-palette"
    | "search-palette"
    | "set-pinned"
    | "reorder-pinned"
    | "move"
    | "publish";
  readonly cause: unknown;
}> {}

export interface CodexThreadCatalogOptions {
  readonly readSidebarOverview: (
    input: ProjectSessionSummaryWindowInput,
  ) => Effect.Effect<ProjectSessionSummaryWindow, CodexThreadCatalogError>;
  readonly listProjectWindow: (
    projectId: string | null,
    input: ProjectSessionSummaryWindowInput,
  ) => Effect.Effect<ProjectSessionSummaryWindow, CodexThreadCatalogError>;
  readonly listProjects: Effect.Effect<readonly Project[], CodexThreadCatalogError>;
  readonly readThreadProjection: (threadId: string) => DesktopProjectWorkspaceThread | null;
  readonly setThreadPinned: (
    threadId: string,
    pinned: boolean,
    beforeThreadId?: string | null,
  ) => Effect.Effect<DesktopProjectWorkspaceSidebar, CodexThreadCatalogError>;
  readonly reorderPinnedThreads: (
    orderedThreadIds: readonly string[],
  ) => Effect.Effect<void, CodexThreadCatalogError>;
  readonly move: (
    input: CodexSidebarThreadMoveInput,
  ) => Effect.Effect<CodexSidebarThreadMoveResult, CodexThreadCatalogError>;
}

export class CodexThreadCatalog extends Context.Service<
  CodexThreadCatalog,
  {
    readonly listPinned: Effect.Effect<readonly string[], CodexThreadCatalogError>;
    readonly listProject: (
      projectId: string,
      input?: CodexThreadSummaryWindowInput,
    ) => Effect.Effect<CodexThreadSummaryWindow, CodexThreadCatalogError>;
    readonly listPalette: (
      input: CommandPaletteThreadListInput,
    ) => Effect.Effect<readonly CommandPaletteThreadSummary[], CodexThreadCatalogError>;
    readonly searchPalette: (
      input: CommandPaletteThreadSearchInput,
    ) => Effect.Effect<readonly CommandPaletteThreadSearchResult[], CodexThreadCatalogError>;
    readonly setPinned: (
      threadId: string,
      pinned: boolean,
      beforeThreadId?: string | null,
    ) => Effect.Effect<CodexSidebarSnapshot, CodexThreadCatalogError>;
    readonly reorderPinned: (
      orderedThreadIds: readonly string[],
    ) => Effect.Effect<CodexSidebarSnapshot, CodexThreadCatalogError>;
    readonly move: (
      input: CodexSidebarThreadMoveInput,
    ) => Effect.Effect<CodexSidebarThreadMoveResult, CodexThreadCatalogError>;
  }
>()("nodex/main/codex-application/CodexThreadCatalog") {}

const CODEX_SIDEBAR_THREAD_SOURCE_KINDS = [] as const satisfies readonly ThreadSourceKind[];
const COMMAND_PALETTE_THREAD_SEARCH_DEFAULT_LIMIT = 50;
const COMMAND_PALETTE_THREAD_SEARCH_MAX_LIMIT = 60;

const normalizeCommandPaletteThreadSearchLimit = (limit: number | undefined): number => {
  if (!Number.isFinite(limit)) return COMMAND_PALETTE_THREAD_SEARCH_DEFAULT_LIMIT;
  return Math.min(
    COMMAND_PALETTE_THREAD_SEARCH_MAX_LIMIT,
    Math.max(1, Math.floor(limit ?? COMMAND_PALETTE_THREAD_SEARCH_DEFAULT_LIMIT)),
  );
};

const metadataForProject = (projectId: string | null): CodexSidebarSyncMetadata => ({
  changedProjectIds: projectId === null ? [] : [projectId],
  projectlessChanged: projectId === null,
  materializedSessionIds: [],
  failedThreadIds: [],
});

const emptyMetadata: CodexSidebarSyncMetadata = {
  changedProjectIds: [],
  projectlessChanged: false,
  materializedSessionIds: [],
  failedThreadIds: [],
};

const projectThreadSummary = (
  session: ProjectSessionSummaryWindow["items"][number],
  projection: DesktopProjectWorkspaceThread | null,
): CodexThreadSummary | null => {
  const thread = session.thread;
  if (!thread || thread.parentThreadId) return null;
  return {
    threadId: thread.threadId,
    projectId: session.projectId,
    forkedFromId: thread.forkedFromId ?? null,
    source: null,
    ephemeral: false,
    threadSource: thread.threadSource ?? null,
    serviceName: thread.serviceName ?? null,
    agentNickname: thread.agentNickname ?? null,
    agentRole: thread.agentRole ?? null,
    agentPath: thread.agentPath ?? null,
    threadName: thread.threadName ?? null,
    threadPreview: thread.threadPreview,
    modelProvider: projection?.modelProvider ?? "openai",
    executionProfile: projection?.executionProfile ?? null,
    cwd: thread.cwd ?? null,
    managedWorktreePath: projection?.managedWorktreePath ?? null,
    projectlessOutputDirectory: projection?.projectlessOutputDirectory ?? null,
    projectlessWorkspaceBrowserRoot: projection?.projectlessWorkspaceBrowserRoot ?? null,
    statusType: thread.statusType,
    statusActiveFlags: [...thread.statusActiveFlags],
    archived: session.archived || thread.archived,
    pinned: session.pinned,
    hasUnreadTurn: session.unread,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    recencyAt: thread.recencyAt,
    linkedAt: thread.linkedAt,
  };
};

export const make = (
  options: CodexThreadCatalogOptions,
): Effect.Effect<
  CodexThreadCatalog["Service"],
  never,
  CodexGateway | CodexSidebarSyncRuntime | Scope.Scope
> =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    const gateway = yield* CodexGateway;
    const sidebar = yield* CodexSidebarSyncRuntime;
    const mutations = yield* Semaphore.make(1);
    const runOwned = <A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.acquireUseRelease(
        operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
        Fiber.join,
        Fiber.interrupt,
      );
    const readSnapshot = (): Effect.Effect<CodexSidebarSnapshot, CodexThreadCatalogError> => {
      return Effect.sync(() => sidebar.invalidate()).pipe(
        Effect.andThen(sidebar.sync({ policy: "read", reason: "session-change" })),
        Effect.map((result) => result.snapshot),
        Effect.mapError((cause) => new CodexThreadCatalogError({ operation: "publish", cause })),
      );
    };
    const publish = (
      metadata: CodexSidebarSyncMetadata,
      forceEmit = false,
    ): Effect.Effect<CodexSidebarSnapshot, CodexThreadCatalogError> => {
      return Effect.sync(() => sidebar.invalidate()).pipe(
        Effect.andThen(
          sidebar.publish({
            includeArchived: false,
            source: "core",
            refreshed: false,
            metadata,
            reason: "session-change",
            forceEmit,
          }),
        ),
        Effect.map((result) => result.snapshot),
        Effect.mapError((cause) => new CodexThreadCatalogError({ operation: "publish", cause })),
      );
    };
    const runMutation = <A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      runOwned(mutations.withPermit(operation));

    const listPalette = (
      input: CommandPaletteThreadListInput,
    ): Effect.Effect<readonly CommandPaletteThreadSummary[], CodexThreadCatalogError> => {
      if (input.scope !== "sidebar") return Effect.succeed([]);
      return Effect.gen(function* () {
        const projects = yield* options.listProjects;
        const projectNameById = new Map(
          projects.map((project) => [project.id, project.name] as const),
        );
        const seenThreadIds = new Set<string>();
        const summaries: CommandPaletteThreadSummary[] = [];
        const addWindow = (window: ProjectSessionSummaryWindow): void => {
          for (const session of window.items) {
            if (summaries.length >= 100) return;
            const thread = session.thread;
            if (
              !thread ||
              thread.parentThreadId ||
              session.archived ||
              thread.archived ||
              seenThreadIds.has(thread.threadId)
            ) {
              continue;
            }
            seenThreadIds.add(thread.threadId);
            summaries.push({
              threadId: thread.threadId,
              sessionId: session.id,
              projectId: session.projectId,
              projectName: session.projectId
                ? (projectNameById.get(session.projectId) ?? null)
                : null,
              title: session.displayTitle,
              preview: thread.threadPreview,
              cwd: thread.cwd ?? null,
              gitBranch: null,
              projectless: session.projectId === null,
              pinned: session.pinned,
              pinnedOrder: session.pinnedOrder,
              statusType: thread.statusType,
              statusActiveFlags: [...thread.statusActiveFlags],
              createdAt: thread.createdAt,
              updatedAt: thread.recencyAt ?? thread.updatedAt,
            });
          }
        };
        addWindow(yield* options.readSidebarOverview({ first: 100 }));
        if (summaries.length < 100) {
          addWindow(
            yield* options.listProjectWindow(null, {
              first: 100 - summaries.length,
            }),
          );
        }
        for (const project of projects) {
          if (summaries.length >= 100) break;
          addWindow(
            yield* options.listProjectWindow(project.id, {
              first: 100 - summaries.length,
            }),
          );
        }
        summaries.sort((left, right) => right.updatedAt - left.updatedAt);
        return summaries.slice(0, 100);
      });
    };

    return CodexThreadCatalog.of({
      listPinned: runOwned(
        Effect.gen(function* () {
          const threadIds: string[] = [];
          let after: string | null = null;
          do {
            const window: ProjectSessionSummaryWindow = yield* options.readSidebarOverview({
              after,
              first: 200,
            });
            threadIds.push(
              ...window.items.flatMap((session) =>
                session.thread ? [session.thread.threadId] : [],
              ),
            );
            after = window.nextCursor;
          } while (after !== null);
          return threadIds;
        }),
      ),
      listProject: (projectId, input = {}) => {
        const normalizedProjectId = projectId.trim();
        if (!normalizedProjectId) {
          return Effect.fail(
            new CodexThreadCatalogError({
              operation: "list-project",
              cause: new Error("Project id is required"),
            }),
          );
        }
        return runOwned(
          options.listProjectWindow(normalizedProjectId, input).pipe(
            Effect.map((window) => ({
              ...window,
              items: window.items.flatMap((session) => {
                const summary = projectThreadSummary(
                  session,
                  session.thread ? options.readThreadProjection(session.thread.threadId) : null,
                );
                return summary ? [summary] : [];
              }),
            })),
          ),
        );
      },
      listPalette: (input) => runOwned(listPalette(input)),
      searchPalette: (input) => {
        const query = input.query.trim();
        if (!query) return Effect.succeed([]);
        const limit = normalizeCommandPaletteThreadSearchLimit(input.limit);
        return runOwned(
          Effect.gen(function* () {
            const [localThreads, projects] = yield* Effect.all(
              [listPalette({ scope: "sidebar" }), options.listProjects] as const,
              { concurrency: "unbounded" },
            );
            const localByThreadId = new Map(
              localThreads.map((thread) => [thread.threadId, thread] as const),
            );
            const projectNameById = new Map(
              projects.map((project) => [project.id, project.name] as const),
            );
            const results: CommandPaletteThreadSearchResult[] = [];
            const seenThreadIds = new Set<string>();
            const seenCursors = new Set<string>();
            let cursor: string | null = null;

            while (results.length < limit) {
              const response: ClientRequestResponsesByMethod["thread/search"] = yield* gateway
                .requestLocal("thread/search", {
                  cursor,
                  limit: limit - results.length,
                  sortKey: "updated_at",
                  sortDirection: "desc",
                  sourceKinds: [...CODEX_SIDEBAR_THREAD_SOURCE_KINDS],
                  archived: false,
                  searchTerm: query,
                })
                .pipe(
                  Effect.mapError(
                    (cause) => new CodexThreadCatalogError({ operation: "search-palette", cause }),
                  ),
                );

              for (const result of response.data) {
                const thread = result.thread;
                if (thread.ephemeral || thread.parentThreadId) continue;
                if (isNonSidebarThreadWithoutParent(thread as unknown as Record<string, unknown>)) {
                  continue;
                }
                if (seenThreadIds.has(thread.id)) continue;
                seenThreadIds.add(thread.id);

                const local = localByThreadId.get(thread.id);
                const inferredProjectId = resolveSidebarProjectIdForCwd(thread.cwd, projects);
                const projectId = local?.projectId ?? inferredProjectId;
                const parsedStatus = parseThreadStatus(thread.status);
                const createdAt = Number(thread.createdAt) * 1_000;
                const updatedAt = Number(thread.recencyAt ?? thread.updatedAt) * 1_000;
                const candidate: CommandPaletteThreadSummary = {
                  threadId: thread.id,
                  sessionId: local?.sessionId ?? null,
                  projectId,
                  projectName: projectId
                    ? (projectNameById.get(projectId) ?? local?.projectName ?? null)
                    : null,
                  title: resolveSidebarThreadTitle({
                    threadName: thread.name,
                    threadPreview: thread.preview,
                  }),
                  preview: thread.preview,
                  cwd: thread.cwd,
                  gitBranch: thread.gitInfo?.branch ?? null,
                  projectless: projectId === null,
                  pinned: local?.pinned ?? false,
                  pinnedOrder: local?.pinnedOrder ?? null,
                  statusType: local?.statusType ?? parsedStatus.statusType,
                  statusActiveFlags: local?.statusActiveFlags ?? parsedStatus.statusActiveFlags,
                  createdAt: Number.isFinite(createdAt) ? createdAt : (local?.createdAt ?? 0),
                  updatedAt: Number.isFinite(updatedAt) ? updatedAt : (local?.updatedAt ?? 0),
                };
                results.push({ thread: candidate, snippet: result.snippet });
                if (results.length >= limit) break;
              }

              const nextCursor: string | null = response.nextCursor ?? null;
              if (!nextCursor || seenCursors.has(nextCursor)) break;
              seenCursors.add(nextCursor);
              cursor = nextCursor;
            }

            return results;
          }),
        );
      },
      setPinned: (threadId, pinned, beforeThreadId) => {
        const normalizedThreadId = threadId.trim();
        if (!normalizedThreadId) return runOwned(readSnapshot());
        return runMutation(
          options.setThreadPinned(normalizedThreadId, pinned, beforeThreadId).pipe(
            Effect.flatMap((workspace) => {
              const thread = workspace.threads.find(
                (candidate) => candidate.threadId === normalizedThreadId,
              );
              return thread ? publish(metadataForProject(thread.projectId)) : readSnapshot();
            }),
          ),
        );
      },
      reorderPinned: (orderedThreadIds) =>
        runMutation(
          options
            .reorderPinnedThreads(orderedThreadIds)
            .pipe(Effect.andThen(publish(emptyMetadata, true))),
        ),
      move: (input) =>
        runMutation(
          Effect.try({
            try: () => CodexSidebarThreadMoveInputSchema.parse(input),
            catch: (cause) => new CodexThreadCatalogError({ operation: "move", cause }),
          }).pipe(Effect.flatMap(options.move)),
        ),
    });
  });
