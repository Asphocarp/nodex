import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type { CodexSidebarSnapshot, ProjectSessionSummaryWindow } from "../../shared/types";
import type { DesktopProjectWorkspaceSidebar } from "../core-client/project-workspace-adapter";
import { CodexSidebarSyncRuntime, type CodexSidebarSyncMetadata } from "./CodexSidebarSyncRuntime";

export class CodexThreadCatalogError extends Data.TaggedError("CodexThreadCatalogError")<{
  readonly operation: "list-pinned" | "set-pinned" | "reorder-pinned" | "publish";
  readonly cause: unknown;
}> {}

export interface CodexThreadCatalogOptions {
  readonly readSidebarOverview: (
    after: string | null,
  ) => Effect.Effect<ProjectSessionSummaryWindow, CodexThreadCatalogError>;
  readonly setThreadPinned: (
    threadId: string,
    pinned: boolean,
    beforeThreadId?: string | null,
  ) => Effect.Effect<DesktopProjectWorkspaceSidebar, CodexThreadCatalogError>;
  readonly reorderPinnedThreads: (
    orderedThreadIds: readonly string[],
  ) => Effect.Effect<void, CodexThreadCatalogError>;
}

export class CodexThreadCatalog extends Context.Service<
  CodexThreadCatalog,
  {
    readonly listPinned: Effect.Effect<readonly string[], CodexThreadCatalogError>;
    readonly setPinned: (
      threadId: string,
      pinned: boolean,
      beforeThreadId?: string | null,
    ) => Effect.Effect<CodexSidebarSnapshot, CodexThreadCatalogError>;
    readonly reorderPinned: (
      orderedThreadIds: readonly string[],
    ) => Effect.Effect<CodexSidebarSnapshot, CodexThreadCatalogError>;
  }
>()("nodex/main/codex-application/CodexThreadCatalog") {}

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

export const make = (
  options: CodexThreadCatalogOptions,
): Effect.Effect<CodexThreadCatalog["Service"], never, CodexSidebarSyncRuntime | Scope.Scope> =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
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

    return CodexThreadCatalog.of({
      listPinned: runOwned(
        Effect.gen(function* () {
          const threadIds: string[] = [];
          let after: string | null = null;
          do {
            const window: ProjectSessionSummaryWindow = yield* options.readSidebarOverview(after);
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
    });
  });
