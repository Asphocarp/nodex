import path from "node:path";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
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
  readonly recover: Effect.Effect<void>;
  readonly requiresRecovery: Effect.Effect<boolean>;
}

export interface GitReviewRepositoryWatcherOptions {
  readonly roots: GitReviewWatchRoots;
  readonly host: FileWatchHost;
  readonly onChange: (
    event: GitReviewRepositoryChangedEvent,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly onRequiresRecoveryChanged?: (
    requiresRecovery: boolean,
  ) => Effect.Effect<void, never, Scope.Scope>;
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
    const changeFibers = yield* FiberMap.make<GitReviewRepositoryChange>();
    const recoveryLock = yield* Semaphore.make(1);
    const targets = watchTargets(options.roots);
    const states = new Map<WatchTarget, WatchTargetState>();
    const changeStates = new Map<GitReviewRepositoryChange, ChangeState>();
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
    const updateRequiresRecovery = Effect.fn("GitReviewRepositoryWatcher.updateRequiresRecovery")(
      function* () {
        const next = requiresRecovery();
        if (lastRequiresRecovery === next) return;
        lastRequiresRecovery = next;
        if (options.onRequiresRecoveryChanged) {
          yield* options.onRequiresRecoveryChanged(next);
        }
      },
    );
    const settleRecovery = (state: WatchTargetState) => {
      const waiters = [...state.recoveryWaiters];
      state.recoveryWaiters.clear();
      return Effect.forEach(waiters, (waiter) => Deferred.succeed(waiter, undefined), {
        discard: true,
      });
    };
    const signalChange = Effect.fn("GitReviewRepositoryWatcher.signalChange")(function* (
      target: WatchTarget,
      changedPaths?: readonly string[],
    ) {
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
      yield* FiberMap.run(
        changeFibers,
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
            yield* options.onChange(event).pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() =>
                  logWatchFailure("Could not publish Git repository change", {
                    changeType,
                    cause,
                  }),
                ),
              ),
            );
            if (state.pending) continue;
            state.active = false;
            return;
          }
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              state.active = false;
            }),
          ),
        ),
        { onlyIfMissing: true, startImmediately: true },
      );
    });

    for (const target of targets) {
      const state = states.get(target);
      if (!state) continue;
      yield* Effect.forever(
        Effect.gen(function* () {
          yield* options.host
            .watch({
              path: target.watchPath,
              recursive: target.recursive,
              renameEventHandling:
                target.changeType === "working-tree"
                  ? "changed-path-with-parent-directory"
                  : "changed-path",
            })
            .pipe(
              Stream.runForEach((event) => {
                if (event._tag === "Ready") {
                  return Effect.gen(function* () {
                    const recovering = state.attempted;
                    state.available = true;
                    state.recursiveCoverage = event.coverage.recursive;
                    if (!state.attempted) {
                      state.attempted = true;
                      yield* Deferred.succeed(state.firstAttempt, undefined);
                    }
                    yield* settleRecovery(state);
                    yield* updateRequiresRecovery();
                    if (recovering) yield* signalChange(target);
                  });
                }

                const acceptedPaths = event.changedPaths.flatMap((changedPath) => {
                  if (!target.shouldHandleChangedPath(changedPath)) return [];
                  if (target.changeType !== "working-tree") return [changedPath];
                  const affectedPath = affectedWorkingTreePath(options.roots, changedPath);
                  return affectedPath === null ? [] : [affectedPath];
                });
                if (event.changedPaths.length > 0 && acceptedPaths.length === 0) {
                  return Effect.void;
                }
                const includesRoot =
                  target.changeType === "working-tree" &&
                  acceptedPaths.includes(options.roots.root);
                return signalChange(
                  target,
                  event.changedPaths.length === 0 || includesRoot ? undefined : acceptedPaths,
                );
              }),
            );
        }).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const wasAvailable = state.available;
              state.available = false;
              state.recursiveCoverage = false;
              if (!state.attempted) {
                state.attempted = true;
                yield* Deferred.succeed(state.firstAttempt, undefined);
              }
              yield* settleRecovery(state);
              yield* updateRequiresRecovery();
              logWatchFailure("Could not watch Git repository path", {
                path: target.path,
                error,
              });
              if (wasAvailable) return;
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

    return {
      requiresRecovery: Effect.sync(requiresRecovery),
      recover: recoveryLock.withPermits(1)(
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
      ),
    };
  });
