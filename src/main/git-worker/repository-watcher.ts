import path from "node:path";
import * as Deferred from "effect/Deferred";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as FiberSet from "effect/FiberSet";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import type { FileWatchHost } from "../file-watch-host";
import { getLogger } from "../logging/logger";

export const GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS = 1_000;
export const GIT_REVIEW_WATCH_RETRY_MS = 1_000;
export const GIT_REVIEW_MAX_WORKING_TREE_PATHS = 64;

const WORKTREE_TOPOLOGY_FILES = new Set(["HEAD", "commondir", "gitdir", "locked"]);

const logger = getLogger({
  subsystem: "git-review",
  component: "repository-watcher",
});

export type GitReviewRepositoryChange =
  | "config"
  | "head"
  | "index"
  | "remote-refs"
  | "working-tree"
  | "synced-branch"
  | "worktree-topology";

const CHANGE_TYPES = [
  "config",
  "head",
  "index",
  "remote-refs",
  "working-tree",
  "synced-branch",
  "worktree-topology",
] as const satisfies readonly GitReviewRepositoryChange[];

export interface GitReviewWatchRoots {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly headPath: string;
  readonly indexPath: string;
  readonly syncedBranchPath: string;
}

export interface GitReviewRepositoryChangedEvent {
  readonly changeType: GitReviewRepositoryChange;
  readonly changedPaths?: readonly string[];
}

export interface GitReviewRepositoryWatcher {
  readonly requiresRecovery: boolean;
  recover(): Promise<void>;
}

export interface GitReviewRepositoryWatcherOptions {
  readonly roots: GitReviewWatchRoots;
  readonly host: FileWatchHost;
  readonly onChange: (event: GitReviewRepositoryChangedEvent) => void | Promise<void>;
  readonly onRequiresRecoveryChanged?: (requiresRecovery: boolean) => void;
}

interface WatchTarget {
  readonly changeType: GitReviewRepositoryChange;
  readonly path: string;
  readonly recursive: boolean;
  readonly shouldHandleChangedPath: (changedPath: string) => boolean;
  readonly watchPath: string;
}

interface WatchTargetState {
  available: boolean;
  recursiveCoverage: boolean;
  attempted: boolean;
  readonly firstAttempt: Deferred.Deferred<void>;
  readonly recoveryWaiters: Set<Deferred.Deferred<void>>;
  readonly retryWake: Queue.Queue<void>;
}

interface ChangeState {
  active: boolean;
  pending: boolean;
}

class GitRepositoryWatcherError extends Data.TaggedError("GitRepositoryWatcherError")<{
  readonly operation: "emit-change" | "start-session" | "dispose-session";
  readonly cause: unknown;
}> {}

function isPathInside(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function isUnlockedPath(directory: string, candidate: string): boolean {
  return !candidate.endsWith(".lock") && isPathInside(directory, candidate);
}

function isWorktreeTopologyPath(worktreesDirectory: string, candidate: string): boolean {
  if (!isPathInside(worktreesDirectory, candidate)) return false;
  const relative = path.relative(worktreesDirectory, candidate);
  if (relative === "") return true;
  const parts = relative.split(path.sep);
  return parts.length === 1 || (parts.length === 2 && WORKTREE_TOPOLOGY_FILES.has(parts[1] ?? ""));
}

function watchTargets(roots: GitReviewWatchRoots): readonly WatchTarget[] {
  const { commonDir, gitDir, headPath, indexPath, root, syncedBranchPath } = roots;
  const targets: WatchTarget[] = [];
  const file = (targetPath: string, changeType: GitReviewRepositoryChange) => {
    targets.push({
      changeType,
      path: targetPath,
      recursive: false,
      shouldHandleChangedPath: (changedPath) => changedPath === targetPath,
      watchPath: path.dirname(targetPath),
    });
  };
  const directory = (
    targetPath: string,
    changeType: GitReviewRepositoryChange,
    shouldHandleChangedPath: (changedPath: string) => boolean,
  ) => {
    targets.push({
      changeType,
      path: targetPath,
      recursive: true,
      shouldHandleChangedPath,
      watchPath: targetPath,
    });
  };

  file(headPath, "head");
  const commonHeadPath = path.join(commonDir, "HEAD");
  if (commonHeadPath !== headPath) file(commonHeadPath, "head");
  file(indexPath, "index");
  file(path.join(commonDir, "FETCH_HEAD"), "remote-refs");
  file(path.join(commonDir, "packed-refs"), "remote-refs");

  const localHeadsDirectory = path.join(commonDir, "refs", "heads");
  directory(localHeadsDirectory, "head", (changedPath) =>
    isUnlockedPath(localHeadsDirectory, changedPath),
  );

  const refsDirectory = path.join(commonDir, "refs");
  const remoteRefsDirectory = path.join(refsDirectory, "remotes");
  directory(refsDirectory, "remote-refs", (changedPath) =>
    isUnlockedPath(remoteRefsDirectory, changedPath),
  );

  file(path.join(commonDir, "config"), "config");
  const infoDirectory = path.join(commonDir, "info");
  const excludePath = path.join(infoDirectory, "exclude");
  const attributesPath = path.join(infoDirectory, "attributes");
  directory(
    infoDirectory,
    "config",
    (changedPath) => changedPath === excludePath || changedPath === attributesPath,
  );

  file(path.join(gitDir, "config.worktree"), "config");
  file(syncedBranchPath, "synced-branch");

  const worktreesDirectory = path.join(commonDir, "worktrees");
  directory(commonDir, "worktree-topology", (changedPath) =>
    isWorktreeTopologyPath(worktreesDirectory, changedPath),
  );
  directory(
    root,
    "working-tree",
    (changedPath) =>
      !isPathInside(commonDir, changedPath) && !isPathInside(path.join(root, ".git"), changedPath),
  );
  return targets;
}

function affectedWorkingTreePath(roots: GitReviewWatchRoots, changedPath: string): string | null {
  const relativeParts = path.relative(roots.root, changedPath).split(path.sep);
  const gitPartIndex = relativeParts.indexOf(".git");
  if (gitPartIndex < 1) return changedPath;
  const metadataName = relativeParts[gitPartIndex + 1];
  if (metadataName !== "HEAD" && metadataName !== "packed-refs" && metadataName !== "refs") {
    return null;
  }
  return path.join(roots.root, ...relativeParts.slice(0, gitPartIndex));
}

function addPendingWorkingTreePath(
  roots: GitReviewWatchRoots,
  pendingPaths: Set<string> | null,
  changedPath: string,
): Set<string> | null {
  if (pendingPaths === null) return null;
  if ([...pendingPaths].some((existingPath) => isPathInside(existingPath, changedPath))) {
    return pendingPaths;
  }

  for (const existingPath of pendingPaths) {
    if (isPathInside(changedPath, existingPath)) pendingPaths.delete(existingPath);
  }
  pendingPaths.add(changedPath);
  if (pendingPaths.size <= GIT_REVIEW_MAX_WORKING_TREE_PATHS) return pendingPaths;

  const topLevelPaths = new Set<string>();
  for (const pendingPath of pendingPaths) {
    const relative = path.relative(roots.root, pendingPath);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return null;
    }
    const [topLevelName] = relative.split(path.sep, 1);
    if (!topLevelName) return null;
    topLevelPaths.add(path.join(roots.root, topLevelName));
    if (topLevelPaths.size > GIT_REVIEW_MAX_WORKING_TREE_PATHS) return null;
  }
  return topLevelPaths;
}

function logWatchFailure(message: string, details: Record<string, unknown>): void {
  logger.warn(message, details);
}

export function shouldRefreshGitReviewSummary(change: GitReviewRepositoryChange): boolean {
  return (
    change === "config" ||
    change === "head" ||
    change === "index" ||
    change === "remote-refs" ||
    change === "working-tree"
  );
}

/** Acquires every native watch target and owns its retry and emission fibers in one Scope. */
export const makeGitReviewRepositoryWatcher = (
  options: GitReviewRepositoryWatcherOptions,
): Effect.Effect<GitReviewRepositoryWatcher, never, Scope.Scope> =>
  Effect.gen(function* () {
    const runRecovery = yield* FiberSet.makeRuntimePromise<never, unknown, never>();
    const changeFibers = yield* FiberMap.make<GitReviewRepositoryChange>();
    const runChange = yield* FiberMap.runtimePromise(changeFibers)();
    const targets = watchTargets(options.roots);
    const states = new Map<WatchTarget, WatchTargetState>();
    const changeStates = new Map<GitReviewRepositoryChange, ChangeState>();
    let closed = false;
    let lastRequiresRecovery: boolean | null = null;
    let pendingWorkingTreePaths: Set<string> | null = new Set();

    for (const changeType of CHANGE_TYPES) {
      changeStates.set(changeType, { active: false, pending: false });
    }
    for (const target of targets) {
      states.set(target, {
        available: false,
        recursiveCoverage: false,
        attempted: false,
        firstAttempt: yield* Deferred.make<void>(),
        recoveryWaiters: new Set(),
        retryWake: yield* Queue.sliding<void>(1),
      });
    }

    const requiresRecovery = () =>
      [...states.entries()].some(
        ([target, state]) => !state.available || (target.recursive && !state.recursiveCoverage),
      );
    const updateRequiresRecovery = () => {
      const next = requiresRecovery();
      if (lastRequiresRecovery === next) return;
      lastRequiresRecovery = next;
      options.onRequiresRecoveryChanged?.(next);
    };
    const settleRecovery = (state: WatchTargetState) => {
      const waiters = [...state.recoveryWaiters];
      state.recoveryWaiters.clear();
      return Effect.forEach(waiters, (waiter) => Deferred.succeed(waiter, undefined), {
        discard: true,
      });
    };
    const signalChange = (target: WatchTarget, changedPaths?: readonly string[]): void => {
      if (closed) return;
      if (target.changeType === "working-tree") {
        if (changedPaths === undefined) {
          pendingWorkingTreePaths = null;
        } else if (pendingWorkingTreePaths !== null) {
          for (const changedPath of changedPaths) {
            pendingWorkingTreePaths = addPendingWorkingTreePath(
              options.roots,
              pendingWorkingTreePaths,
              changedPath,
            );
            if (pendingWorkingTreePaths === null) break;
          }
        }
      }
      const changeType = target.changeType;
      const state = changeStates.get(changeType);
      if (!state) return;
      state.pending = true;
      if (state.active) return;
      state.active = true;
      const run = runChange(
        changeType,
        Effect.gen(function* () {
          while (true) {
            yield* Effect.sleep(Duration.millis(GIT_REVIEW_REPOSITORY_CHANGE_DELAY_MS));
            state.pending = false;
            const event = yield* Effect.sync((): GitReviewRepositoryChangedEvent => {
              const changedPaths =
                changeType === "working-tree" && pendingWorkingTreePaths !== null
                  ? [...pendingWorkingTreePaths]
                  : undefined;
              if (changeType === "working-tree") pendingWorkingTreePaths = new Set();
              return {
                changeType,
                ...(changedPaths === undefined ? {} : { changedPaths }),
              };
            });
            yield* Effect.tryPromise({
              try: () => Promise.resolve(options.onChange(event)),
              catch: (cause) => new GitRepositoryWatcherError({ operation: "emit-change", cause }),
            }).pipe(
              Effect.catch((error) =>
                Effect.sync(() =>
                  logWatchFailure("Could not publish Git repository change", {
                    changeType,
                    error,
                  }),
                ),
              ),
            );
            if (state.pending) continue;
            state.active = false;
            return;
          }
        }),
      );
      void run.catch(() => {
        state.active = false;
      });
    };

    for (const target of targets) {
      const state = states.get(target);
      if (!state) continue;
      yield* Effect.forever(
        Effect.gen(function* () {
          let admitted = true;
          const closedSession = yield* Effect.acquireUseRelease(
            Effect.tryPromise({
              try: () =>
                options.host.startFileWatch({
                  path: target.watchPath,
                  recursive: target.recursive,
                  renameEventHandling:
                    target.changeType === "working-tree"
                      ? "changed-path-with-parent-directory"
                      : "changed-path",
                  onChange: ({ changedPaths }) => {
                    if (!admitted || closed) return;
                    const acceptedPaths = changedPaths.flatMap((changedPath) => {
                      if (!target.shouldHandleChangedPath(changedPath)) return [];
                      if (target.changeType !== "working-tree") return [changedPath];
                      const affectedPath = affectedWorkingTreePath(options.roots, changedPath);
                      return affectedPath === null ? [] : [affectedPath];
                    });
                    if (changedPaths.length > 0 && acceptedPaths.length === 0) return;
                    const includesRoot =
                      target.changeType === "working-tree" &&
                      acceptedPaths.includes(options.roots.root);
                    signalChange(
                      target,
                      changedPaths.length === 0 || includesRoot ? undefined : acceptedPaths,
                    );
                  },
                }),
              catch: (cause) =>
                new GitRepositoryWatcherError({ operation: "start-session", cause }),
            }),
            (session) =>
              Effect.gen(function* () {
                const recovering = state.attempted;
                state.available = true;
                state.recursiveCoverage = session.coverage.recursive;
                if (!state.attempted) {
                  state.attempted = true;
                  yield* Deferred.succeed(state.firstAttempt, undefined);
                }
                yield* settleRecovery(state);
                updateRequiresRecovery();
                if (recovering) signalChange(target);
                return yield* Effect.promise(() => session.closed);
              }),
            (session) =>
              Effect.sync(() => {
                admitted = false;
              }).pipe(
                Effect.andThen(
                  Effect.tryPromise({
                    try: () => session.dispose(),
                    catch: (cause) =>
                      new GitRepositoryWatcherError({ operation: "dispose-session", cause }),
                  }).pipe(
                    Effect.catch((error) =>
                      Effect.sync(() =>
                        logWatchFailure("Could not dispose Git repository watcher session", {
                          error,
                        }),
                      ),
                    ),
                  ),
                ),
              ),
          );

          state.available = false;
          state.recursiveCoverage = false;
          updateRequiresRecovery();
          if (closedSession.reason === "watch-error") {
            logWatchFailure("Git repository watcher session failed", {
              path: target.path,
              error: closedSession.error,
            });
          }
        }).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              state.available = false;
              state.recursiveCoverage = false;
              if (!state.attempted) {
                state.attempted = true;
                yield* Deferred.succeed(state.firstAttempt, undefined);
              }
              yield* settleRecovery(state);
              updateRequiresRecovery();
              logWatchFailure("Could not watch Git repository path", {
                path: target.path,
                error,
              });
              yield* Effect.raceFirst(
                Effect.sleep(Duration.millis(GIT_REVIEW_WATCH_RETRY_MS)),
                Queue.take(state.retryWake),
              );
            }),
          ),
        ),
      ).pipe(Effect.forkScoped({ startImmediately: true }));
    }

    yield* Effect.forEach(states.values(), (state) => Deferred.await(state.firstAttempt), {
      concurrency: "unbounded",
      discard: true,
    });

    const watcher: GitReviewRepositoryWatcher = {
      get requiresRecovery() {
        return requiresRecovery();
      },
      recover: async () => {
        if (closed) return;
        await runRecovery(
          Effect.gen(function* () {
            const waiters: Deferred.Deferred<void>[] = [];
            for (const state of states.values()) {
              if (state.available) continue;
              const waiter = yield* Deferred.make<void>();
              if (state.available) continue;
              state.recoveryWaiters.add(waiter);
              waiters.push(waiter);
              yield* Queue.offer(state.retryWake, undefined);
            }
            yield* Effect.forEach(waiters, Deferred.await, {
              concurrency: "unbounded",
              discard: true,
            });
          }),
        );
      },
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      }),
    );
    return watcher;
  });
