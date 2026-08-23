import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type {
  ManagedWorktreeAvailability,
  ManagedWorktreeRecord,
  ManagedWorktreeRestoreResult,
  ManagedWorktreeSettings,
  UpdateManagedWorktreeSettingsInput,
} from "../../shared/types";
import { CODEX_APP_LOCAL_HOST_ID } from "../codex/codex-app-meta-thread-tools";
import {
  normalizeWorktreePathForIdentity,
  resolveWorktreePathComparisonKey,
} from "../codex/codex-managed-worktree-effects";
import type {
  DesktopProjectWorkspacePort,
  DesktopProjectWorkspaceThread,
} from "../core-client/project-workspace-adapter";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { buildWorkspaceThreadSummary } from "./CodexThreadCatalogProjection";
import { ExecutionHostRuntime } from "./ExecutionHostRuntime";
import { ManagedWorktreeRuntime } from "./ManagedWorktreeRuntime";
import { ManagedWorktreeRetentionRuntime } from "./ManagedWorktreeRetentionRuntime";

export class ManagedWorktreeCatalogError extends Data.TaggedError("ManagedWorktreeCatalogError")<{
  readonly operation:
    | "delete"
    | "list"
    | "read-settings"
    | "inspect-thread"
    | "restore-thread"
    | "update-settings";
  readonly cause: unknown;
}> {}

export interface ManagedWorktreeCatalogOptions {
  readonly projectWorkspace: DesktopProjectWorkspacePort;
  readonly settings: {
    readonly read: () => ManagedWorktreeSettings;
    readonly update: (input: UpdateManagedWorktreeSettingsInput) => ManagedWorktreeSettings;
  };
  readonly defaultManagedRoot: string;
  readonly projectThread: (thread: DesktopProjectWorkspaceThread) => void;
}

export class ManagedWorktreeCatalog extends Context.Service<
  ManagedWorktreeCatalog,
  {
    readonly list: Effect.Effect<readonly ManagedWorktreeRecord[], ManagedWorktreeCatalogError>;
    readonly inspectThread: (
      threadId: string,
    ) => Effect.Effect<ManagedWorktreeAvailability, ManagedWorktreeCatalogError>;
    readonly restoreThread: (
      threadId: string,
    ) => Effect.Effect<ManagedWorktreeRestoreResult, ManagedWorktreeCatalogError>;
    readonly settings: Effect.Effect<ManagedWorktreeSettings, ManagedWorktreeCatalogError>;
    readonly updateSettings: (
      input: UpdateManagedWorktreeSettingsInput,
    ) => Effect.Effect<ManagedWorktreeSettings, ManagedWorktreeCatalogError>;
    readonly delete: (
      hostId: string,
      worktreePath: string,
    ) => Effect.Effect<boolean, ManagedWorktreeCatalogError>;
  }
>()("nodex/main/codex-application/ManagedWorktreeCatalog") {}

interface ManagedThreadContext {
  readonly threadId: string;
  readonly hostId: string;
  readonly worktreeGitRoot: string;
  readonly cwd: string;
  readonly candidateRepositoryPaths: readonly string[];
}

const toManagedWorktreeInspection = (context: ManagedThreadContext) => ({
  hostId: context.hostId,
  worktreeGitRoot: context.worktreeGitRoot,
  cwd: context.cwd,
  candidateRepositoryPaths: context.candidateRepositoryPaths,
});

export const make = (
  options: ManagedWorktreeCatalogOptions,
): Effect.Effect<
  ManagedWorktreeCatalog["Service"],
  never,
  | CodexApplicationEventHub
  | ExecutionHostRuntime
  | ManagedWorktreeRetentionRuntime
  | ManagedWorktreeRuntime
  | Scope.Scope
> =>
  Effect.gen(function* () {
    const events = yield* CodexApplicationEventHub;
    const executionHosts = yield* ExecutionHostRuntime;
    const managed = yield* ManagedWorktreeRuntime;
    const retention = yield* ManagedWorktreeRetentionRuntime;
    const ownerScope = yield* Scope.Scope;

    const fail = (
      operation: ManagedWorktreeCatalogError["operation"],
      cause: unknown,
    ): ManagedWorktreeCatalogError => new ManagedWorktreeCatalogError({ operation, cause });
    const runOwned = <A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.acquireUseRelease(
        operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
        Fiber.join,
        Fiber.interrupt,
      );
    const project = <A>(
      operation: ManagedWorktreeCatalogError["operation"],
      run: () => Promise<A>,
    ): Effect.Effect<A, ManagedWorktreeCatalogError> =>
      Effect.tryPromise({ try: run, catch: (cause) => fail(operation, cause) });
    const fromSync = <A>(
      operation: ManagedWorktreeCatalogError["operation"],
      run: () => A,
    ): Effect.Effect<A, ManagedWorktreeCatalogError> =>
      Effect.try({ try: run, catch: (cause) => fail(operation, cause) });

    const resolveThreadContext = (
      threadId: string,
      operation: "inspect-thread" | "restore-thread",
    ): Effect.Effect<ManagedThreadContext | null, ManagedWorktreeCatalogError> =>
      Effect.gen(function* () {
        const thread = yield* project(operation, () =>
          options.projectWorkspace.getThread(threadId),
        );
        const worktreeGitRoot = thread?.managedWorktreePath?.trim();
        const cwd = thread?.cwd?.trim();
        if (!thread || !worktreeGitRoot || !cwd) return null;

        const lifecycle = yield* project(operation, () =>
          options.projectWorkspace.readManagedWorktreeLifecycleSnapshot(),
        );
        const candidates = new Set(
          lifecycle.projects
            .filter((project) => project.projectId === thread.projectId)
            .flatMap((project) => project.sourceRoots)
            .map((root) => root.trim())
            .filter(Boolean),
        );
        if (candidates.size === 0) {
          const inventory = yield* managed.list(thread.executionHostId).pipe(
            Effect.mapError((cause) => fail(operation, cause)),
            Effect.catch(() => Effect.succeed(null)),
          );
          const normalizedPath = normalizeWorktreePathForIdentity(worktreeGitRoot);
          for (const entry of inventory?.entries ?? []) {
            if (
              normalizeWorktreePathForIdentity(entry.worktreeGitRoot) === normalizedPath &&
              entry.repositoryPath?.trim()
            ) {
              candidates.add(entry.repositoryPath.trim());
            }
          }
        }
        return {
          threadId: thread.threadId,
          hostId: thread.executionHostId,
          worktreeGitRoot,
          cwd,
          candidateRepositoryPaths: [...candidates],
        };
      });

    const list = runOwned(
      Effect.gen(function* () {
        const hostIds = executionHosts.registry.listHostIds("list");
        const [physicalByHost, lifecycle, projects] = yield* Effect.all(
          [
            Effect.forEach(
              hostIds,
              (hostId) =>
                managed.list(hostId).pipe(
                  Effect.map((inventory) => ({ hostId, inventory })),
                  Effect.mapError((cause) => fail("list", cause)),
                ),
              { concurrency: "unbounded" },
            ),
            project("list", () => options.projectWorkspace.readManagedWorktreeLifecycleSnapshot()),
            project("list", () => options.projectWorkspace.listProjects()),
          ] as const,
          { concurrency: "unbounded" },
        );
        const projectNameById = new Map(
          projects.map((project) => [project.id, project.name] as const),
        );
        const permanentRoots = new Set(
          (yield* Effect.forEach(
            lifecycle.projects.flatMap((entry) => entry.sourceRoots),
            (root) => project("list", () => resolveWorktreePathComparisonKey(root)),
            { concurrency: "unbounded" },
          )).map((root) => `${CODEX_APP_LOCAL_HOST_ID}\0${root}`),
        );
        const consumersByPath = new Map<string, typeof lifecycle.consumers>();
        for (const consumer of lifecycle.consumers) {
          const key = `${consumer.executionHostId}\0${normalizeWorktreePathForIdentity(
            consumer.managedWorktreePath,
          )}`;
          consumersByPath.set(key, [...(consumersByPath.get(key) ?? []), consumer]);
        }
        const physicalEntries = physicalByHost.flatMap(({ hostId, inventory }) =>
          inventory.entries.map((entry) => ({ hostId, entry })),
        );
        const records = yield* Effect.forEach(
          physicalEntries,
          ({
            hostId,
            entry,
          }): Effect.Effect<ManagedWorktreeRecord | null, ManagedWorktreeCatalogError> =>
            Effect.gen(function* () {
              const normalizedPath = normalizeWorktreePathForIdentity(entry.worktreeGitRoot);
              const comparisonKey = yield* project("list", () =>
                resolveWorktreePathComparisonKey(entry.worktreeGitRoot),
              );
              if (permanentRoots.has(`${hostId}\0${comparisonKey}`)) return null;
              const consumers = consumersByPath.get(`${hostId}\0${normalizedPath}`) ?? [];
              const conversations = yield* Effect.forEach(
                consumers,
                (consumer) =>
                  Effect.all(
                    [
                      project("list", () => options.projectWorkspace.getThread(consumer.threadId)),
                      consumer.sessionId
                        ? project("list", () =>
                            options.projectWorkspace.getProjectSession(consumer.sessionId!),
                          )
                        : Effect.succeed(null),
                    ] as const,
                    { concurrency: "unbounded" },
                  ).pipe(
                    Effect.map(([thread, session]) => ({
                      threadId: consumer.threadId,
                      projectId: consumer.projectId,
                      projectName: consumer.projectId
                        ? (projectNameById.get(consumer.projectId) ?? null)
                        : null,
                      sessionId: consumer.sessionId,
                      sessionTitle: session?.displayTitle ?? null,
                      threadName: thread?.threadName ?? null,
                      archived: consumer.archived,
                      updatedAt: consumer.updatedAt,
                    })),
                  ),
                { concurrency: "unbounded" },
              );
              return {
                hostId,
                path: entry.worktreeGitRoot,
                exists: true,
                repositoryPath: entry.repositoryPath,
                createdAtMs: entry.createdAtMs,
                conversations: conversations.sort(
                  (left, right) => right.updatedAt - left.updatedAt,
                ),
              };
            }),
          { concurrency: "unbounded" },
        );
        return records
          .filter((record): record is ManagedWorktreeRecord => record !== null)
          .sort((left, right) => (right.createdAtMs ?? 0) - (left.createdAtMs ?? 0));
      }),
    );

    return ManagedWorktreeCatalog.of({
      list,
      settings: fromSync("read-settings", options.settings.read),
      updateSettings: (input) =>
        runOwned(
          Effect.uninterruptible(
            Effect.gen(function* () {
              const settings = yield* fromSync("update-settings", () =>
                options.settings.update(input),
              );
              yield* fromSync("update-settings", () =>
                executionHosts.registry.updateManagedRoot(
                  CODEX_APP_LOCAL_HOST_ID,
                  settings.worktreeRoot ?? options.defaultManagedRoot,
                ),
              );
              yield* retention.request;
              return settings;
            }),
          ),
        ),
      inspectThread: (threadId) => {
        const normalizedThreadId = threadId.trim();
        if (!normalizedThreadId) {
          return Effect.succeed<ManagedWorktreeAvailability>({ state: "not-managed" });
        }
        return runOwned(
          Effect.gen(function* () {
            const context = yield* resolveThreadContext(normalizedThreadId, "inspect-thread");
            if (!context) {
              return { state: "not-managed" } satisfies ManagedWorktreeAvailability;
            }
            return yield* managed.inspect(toManagedWorktreeInspection(context)).pipe(
              Effect.map((result) => result.availability),
              Effect.catch((error) =>
                Effect.succeed<ManagedWorktreeAvailability>({
                  state: "unavailable",
                  reason: "inspection-failed",
                  message: error.cause instanceof Error ? error.cause.message : String(error.cause),
                }),
              ),
            );
          }),
        );
      },
      restoreThread: (threadId) =>
        runOwned(
          Effect.gen(function* () {
            const context = yield* resolveThreadContext(threadId.trim(), "restore-thread");
            if (!context) {
              return yield* Effect.fail(
                fail("restore-thread", new Error("Thread does not use a managed worktree")),
              );
            }
            const result = yield* managed
              .restore({
                ...toManagedWorktreeInspection(context),
                ownerThreadId: context.threadId,
              })
              .pipe(Effect.mapError((cause) => fail("restore-thread", cause)));
            if (result.ownerWarning) {
              yield* Effect.logWarning("Restored managed worktree without owner metadata").pipe(
                Effect.annotateLogs({
                  threadId: context.threadId,
                  hostId: context.hostId,
                  warning: result.ownerWarning,
                }),
              );
            }
            const persisted = yield* project("restore-thread", () =>
              options.projectWorkspace.getThread(context.threadId),
            );
            if (persisted) {
              events.publish({
                kind: "codex",
                value: { type: "threadSummary", thread: buildWorkspaceThreadSummary(persisted) },
              });
            }
            return {
              availability: { state: "available" as const },
              ownerWarning: result.ownerWarning,
            };
          }),
        ),
      delete: (hostId, worktreePath) =>
        runOwned(
          Effect.gen(function* () {
            const lifecycle = yield* project("delete", () =>
              options.projectWorkspace.readManagedWorktreeLifecycleSnapshot(),
            );
            const normalizedPath = normalizeWorktreePathForIdentity(worktreePath);
            const consumers = lifecycle.consumers.filter(
              (consumer) =>
                consumer.executionHostId === hostId &&
                normalizeWorktreePathForIdentity(consumer.managedWorktreePath) === normalizedPath,
            );
            for (const consumer of consumers) {
              const sidebar = yield* project("delete", () =>
                options.projectWorkspace.setThreadArchived(consumer.threadId, true),
              );
              for (const thread of sidebar.threads) options.projectThread(thread);
            }
            const result = yield* managed
              .remove({
                hostId,
                worktreeGitRoot: worktreePath,
                reason: "settings-delete",
              })
              .pipe(Effect.mapError((cause) => fail("delete", cause)));
            return result.removed || result.alreadyMissing;
          }),
        ),
    });
  });
