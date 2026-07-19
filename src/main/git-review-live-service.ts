import path from "node:path";
import type {
  BranchDiffStatsRequest,
  BranchDiffStatsResult,
  GitReviewBaseBranchRequest,
  GitReviewBaseBranchResult,
  GitReviewBranchCommitsRequest,
  GitReviewBranchCommitsResult,
  GitReviewLiveEvent,
  GitReviewLiveQuery,
  GitReviewLiveQueryResult,
  GitReviewSummaryRequest,
  GitReviewSummaryResult,
} from "../shared/types";
import {
  cancelGitReviewRequest,
  filterGitReviewWorkingTreePaths,
  GIT_REVIEW_LOCAL_HOST_ID,
  invalidateGitReviewSnapshot,
  markGitReviewRepositoryObserved,
  readBranchDiffStats,
  readGitReviewBaseBranch,
  readGitReviewBranchCommits,
  readGitReviewSummary,
  type GitReviewRepositoryIdentity,
  type GitReviewWorkingTreePathFilterResult,
} from "./git-review-service";
import {
  NodeGitReviewRepositoryWatcher,
  GIT_REVIEW_WATCH_RETRY_MS,
  resolveGitReviewWatchRoots,
  shouldRefreshGitReviewSummary,
  type GitReviewRepositoryChange,
  type GitReviewRepositoryChangedEvent,
  type GitReviewRepositoryWatcher,
  type GitReviewRepositoryWatcherOptions,
  type GitReviewWatchRoots,
} from "./git-review-repository-watcher";
import {
  localFileWatchHost,
  type FileWatchHost,
  type FileWatchSession,
} from "./file-watch-host";

export const GIT_REVIEW_LIVE_DEBOUNCE_MS = 100;
export const GIT_REVIEW_LIVE_ERROR_RETRY_MS = 1_000;
export const GIT_REVIEW_LIVE_MAX_ERROR_RETRIES = 3;

export type {
  GitReviewRepositoryChange,
  GitReviewWatchRoots,
} from "./git-review-repository-watcher";
export { shouldRefreshGitReviewSummary } from "./git-review-repository-watcher";

export interface GitReviewLiveSubscriptionDependencies {
  readSummary: (
    request: GitReviewSummaryRequest,
  ) => Promise<GitReviewSummaryResult>;
  readBranchDiffStats: (
    request: BranchDiffStatsRequest,
  ) => Promise<BranchDiffStatsResult>;
  readBranchCommits: (
    request: GitReviewBranchCommitsRequest,
  ) => Promise<GitReviewBranchCommitsResult>;
  readBaseBranch: (
    request: GitReviewBaseBranchRequest,
  ) => Promise<GitReviewBaseBranchResult>;
  resolveWatchRoots: (cwd: string) => Promise<GitReviewWatchRoots | null>;
  fileWatchHost: FileWatchHost;
  createRepositoryWatcher: (
    options: GitReviewRepositoryWatcherOptions,
  ) => GitReviewRepositoryWatcher;
  filterWorkingTreePaths: (input: {
    root: string;
    changedPaths: readonly string[];
  }) => Promise<GitReviewWorkingTreePathFilterResult>;
  invalidateSnapshot: (
    cwd: string,
    identity?: GitReviewRepositoryIdentity,
  ) => void;
  markRepositoryObserved: (
    cwd: string,
    observed: boolean,
    identity?: GitReviewRepositoryIdentity,
  ) => void;
  cancelRequest: (requestId: string) => void;
}

export interface GitReviewLiveSubscription {
  dispose(): void;
  recover(): Promise<void>;
  refresh(): Promise<void>;
}

interface LiveQueryState {
  disposed: boolean;
  dirty: boolean;
  running: boolean;
  generation: number;
  errorRetryCount: number;
  requiresRecovery: boolean;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  requestId: string | null;
  settledGeneration: number;
}

interface SharedGitReviewWatcherMember {
  readonly onChange: (event: GitReviewRepositoryChangedEvent) => void;
  readonly onRequiresRecoveryChanged: (requiresRecovery: boolean) => void;
}

interface SharedGitReviewWatcherHub {
  readonly key: string;
  readonly roots: GitReviewWatchRoots;
  readonly host: FileWatchHost;
  readonly members: Set<SharedGitReviewWatcherMember>;
  readonly watcher: GitReviewRepositoryWatcher;
  startPromise: Promise<void>;
  recoveryPromise: Promise<void> | null;
}

interface SharedGitReviewWatcherHandle {
  readonly requiresRecovery: boolean;
  release(): Promise<void>;
  recover(): Promise<void>;
}

const sharedWatcherHubsByHost = new WeakMap<
  FileWatchHost,
  Map<string, SharedGitReviewWatcherHub>
>();

function buildSharedWatcherHubKey(roots: GitReviewWatchRoots): string {
  return JSON.stringify(["local", roots.commonDir, roots.root]);
}

function buildRepositoryIdentity(
  roots: GitReviewWatchRoots,
): GitReviewRepositoryIdentity {
  return {
    hostId: GIT_REVIEW_LOCAL_HOST_ID,
    commonDir: roots.commonDir,
    root: roots.root,
  };
}

async function filterRepositoryChangedEvent(input: {
  event: GitReviewRepositoryChangedEvent;
  roots: GitReviewWatchRoots;
  dependencies: GitReviewLiveSubscriptionDependencies;
}): Promise<GitReviewRepositoryChangedEvent | null> {
  if (
    input.event.changeType !== "working-tree"
    || input.event.changedPaths === undefined
  ) {
    return input.event;
  }

  const filtered = await input.dependencies.filterWorkingTreePaths({
    root: input.roots.root,
    changedPaths: input.event.changedPaths,
  }).catch((): GitReviewWorkingTreePathFilterResult => ({ type: "full" }));
  if (filtered.type === "full") {
    return { changeType: "working-tree" };
  }
  if (filtered.changedPaths.length === 0) return null;
  return {
    changeType: "working-tree",
    changedPaths: filtered.changedPaths,
  };
}

function scheduleHubStart(hub: SharedGitReviewWatcherHub): Promise<void> {
  const start = hub.startPromise.then(() => hub.watcher.start());
  hub.startPromise = start;
  return start;
}

function scheduleHubRecovery(hub: SharedGitReviewWatcherHub): Promise<void> {
  if (hub.recoveryPromise !== null) return hub.recoveryPromise;
  const recovery = scheduleHubStart(hub).finally(() => {
    if (hub.recoveryPromise === recovery) hub.recoveryPromise = null;
  });
  hub.recoveryPromise = recovery;
  return recovery;
}

async function acquireSharedGitReviewWatcher(input: {
  readonly roots: GitReviewWatchRoots;
  readonly dependencies: GitReviewLiveSubscriptionDependencies;
  readonly onChange: (event: GitReviewRepositoryChangedEvent) => void;
  readonly onRequiresRecoveryChanged: (requiresRecovery: boolean) => void;
}): Promise<SharedGitReviewWatcherHandle> {
  let hubs = sharedWatcherHubsByHost.get(input.dependencies.fileWatchHost);
  if (!hubs) {
    hubs = new Map();
    sharedWatcherHubsByHost.set(input.dependencies.fileWatchHost, hubs);
  }

  const key = buildSharedWatcherHubKey(input.roots);
  let hub = hubs.get(key);
  if (!hub) {
    const members = new Set<SharedGitReviewWatcherMember>();
    const watcher = input.dependencies.createRepositoryWatcher({
      roots: input.roots,
      host: input.dependencies.fileWatchHost,
      onChange: async (event) => {
        const filteredEvent = await filterRepositoryChangedEvent({
          event,
          roots: input.roots,
          dependencies: input.dependencies,
        });
        if (filteredEvent === null) return;
        if (shouldRefreshGitReviewSummary(filteredEvent.changeType)) {
          input.dependencies.invalidateSnapshot(
            input.roots.root,
            buildRepositoryIdentity(input.roots),
          );
        }
        for (const member of members) member.onChange(filteredEvent);
      },
      onRequiresRecoveryChanged: (requiresRecovery) => {
        for (const member of members) {
          member.onRequiresRecoveryChanged(requiresRecovery);
        }
      },
    });
    hub = {
      key,
      roots: input.roots,
      host: input.dependencies.fileWatchHost,
      members,
      watcher,
      startPromise: Promise.resolve(),
      recoveryPromise: null,
    };
    hubs.set(key, hub);
  }

  const member: SharedGitReviewWatcherMember = {
    onChange: input.onChange,
    onRequiresRecoveryChanged: input.onRequiresRecoveryChanged,
  };
  hub.members.add(member);

  try {
    await scheduleHubStart(hub);
  } catch (error) {
    hub.members.delete(member);
    if (hub.members.size === 0 && hubs.get(key) === hub) {
      hubs.delete(key);
      hub.watcher.dispose();
    }
    throw error;
  }

  member.onRequiresRecoveryChanged(hub.watcher.requiresRecovery);
  let released = false;
  return {
    get requiresRecovery() {
      return hub.watcher.requiresRecovery;
    },
    async release() {
      if (released) return;
      released = true;
      hub.members.delete(member);
      if (hub.members.size > 0) return;
      await hub.startPromise.catch(() => undefined);
      if (hub.members.size > 0 || hubs.get(key) !== hub) return;
      hub.watcher.dispose();
      hubs.delete(key);
    },
    async recover() {
      if (released) return;
      await scheduleHubRecovery(hub);
    },
  };
}

function buildUpdatedEvent(input: {
  subscriptionId: string;
  generation: number;
  phase: "tracked" | "complete";
  requiresRecovery: boolean;
  output: GitReviewLiveQueryResult;
}): GitReviewLiveEvent {
  return {
    type: "git-live-query-updated",
    subscriptionId: input.subscriptionId,
    generation: input.generation,
    phase: input.phase,
    requiresRecovery: input.requiresRecovery,
    ...input.output,
  };
}

const DEFAULT_DEPENDENCIES: GitReviewLiveSubscriptionDependencies = {
  readSummary: readGitReviewSummary,
  readBranchDiffStats,
  readBranchCommits: readGitReviewBranchCommits,
  readBaseBranch: readGitReviewBaseBranch,
  resolveWatchRoots: resolveGitReviewWatchRoots,
  fileWatchHost: localFileWatchHost,
  filterWorkingTreePaths: filterGitReviewWorkingTreePaths,
  createRepositoryWatcher: (options) =>
    new NodeGitReviewRepositoryWatcher(options),
  invalidateSnapshot: invalidateGitReviewSnapshot,
  markRepositoryObserved: markGitReviewRepositoryObserved,
  cancelRequest: (requestId) => {
    cancelGitReviewRequest({ requestId });
  },
};

export function shouldRefreshGitReviewLiveQuery(
  query: GitReviewLiveQuery,
  change: GitReviewRepositoryChange,
): boolean {
  if (
    query.method === "review-summary"
    || query.method === "branch-diff-stats"
  ) {
    return shouldRefreshGitReviewSummary(change);
  }
  return change === "config"
    || change === "head"
    || change === "remote-refs";
}

async function readCompleteLiveQuery(
  query: Exclude<GitReviewLiveQuery, { method: "review-summary" }>,
  dependencies: GitReviewLiveSubscriptionDependencies,
  requestId: string,
): Promise<GitReviewLiveQueryResult> {
  switch (query.method) {
    case "branch-diff-stats":
      return {
        method: query.method,
        result: await dependencies.readBranchDiffStats({
          ...query.params,
          requestId,
        }),
      };
    case "branch-commits":
      return {
        method: query.method,
        result: await dependencies.readBranchCommits({
          ...query.params,
          requestId,
        }),
      };
    case "base-branch":
      return {
        method: query.method,
        result: await dependencies.readBaseBranch({
          ...query.params,
          requestId,
        }),
      };
  }
}

export function subscribeGitReviewLiveQuery(
  input: {
    subscriptionId: string;
    query: GitReviewLiveQuery;
    publish: (event: GitReviewLiveEvent) => void;
  },
  dependencies: GitReviewLiveSubscriptionDependencies = DEFAULT_DEPENDENCIES,
): GitReviewLiveSubscription {
  const state: LiveQueryState = {
    disposed: false,
    dirty: false,
    running: false,
    generation: 0,
    errorRetryCount: 0,
    requiresRecovery: false,
    refreshTimer: null,
    requestId: null,
    settledGeneration: 0,
  };
  let watcherHandle: SharedGitReviewWatcherHandle | null = null;
  let watcherReadyPromise: Promise<void> | null = null;
  let watcherStartIdentity = 0;
  let repositoryObserved = false;
  let observedRepositoryIdentity: GitReviewRepositoryIdentity | null = null;
  let recoveryPromise: Promise<void> | null = null;
  let gitInitWatchSession: FileWatchSession | null = null;
  let gitInitWatchStartPromise: Promise<void> | null = null;
  let gitInitWatchRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotInvalidationPending = false;
  const generationWaiters = new Map<number, Set<() => void>>();

  const settleGeneration = (generation: number) => {
    state.settledGeneration = Math.max(state.settledGeneration, generation);
    for (const [target, waiters] of generationWaiters) {
      if (target > state.settledGeneration) continue;
      generationWaiters.delete(target);
      for (const resolve of waiters) resolve();
    }
  };

  const waitForGeneration = (generation: number): Promise<void> => {
    if (state.disposed || state.settledGeneration >= generation) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiters = generationWaiters.get(generation) ?? new Set();
      waiters.add(resolve);
      generationWaiters.set(generation, waiters);
    });
  };

  const setRepositoryObserved = (
    observed: boolean,
    identity?: GitReviewRepositoryIdentity,
  ) => {
    if (repositoryObserved === observed) return;
    repositoryObserved = observed;
    if (observed) {
      if (!identity) return;
      observedRepositoryIdentity = identity;
      dependencies.markRepositoryObserved(
        input.query.params.cwd,
        true,
        identity,
      );
      return;
    }
    dependencies.markRepositoryObserved(
      input.query.params.cwd,
      false,
      observedRepositoryIdentity ?? undefined,
    );
    observedRepositoryIdentity = null;
  };

  const invalidateRepositorySnapshot = () => {
    if (observedRepositoryIdentity) {
      dependencies.invalidateSnapshot(
        input.query.params.cwd,
        observedRepositoryIdentity,
      );
      snapshotInvalidationPending = false;
      return;
    }
    snapshotInvalidationPending = true;
  };

  const clearRefreshTimer = () => {
    if (state.refreshTimer === null) return;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
  };

  const cancelCurrentRead = () => {
    const requestId = state.requestId;
    if (!requestId) return;
    dependencies.cancelRequest(requestId);
    state.requestId = null;
  };

  const stopWatchers = async () => {
    const handle = watcherHandle;
    watcherHandle = null;
    setRepositoryObserved(false);
    await handle?.release();
  };

  const publishFailure = (generation: number, error: unknown) => {
    if (state.disposed || generation !== state.generation) return;
    input.publish({
      type: "git-live-query-failed",
      subscriptionId: input.subscriptionId,
      generation,
      requiresRecovery: state.requiresRecovery,
      method: input.query.method,
      errorMessage: error instanceof Error
        ? error.message
        : "Could not refresh the Git live query.",
    });
  };

  const isCurrent = (generation: number) =>
    !state.disposed && generation === state.generation;

  let run = async () => {};
  let startWatchers = async () => {};

  const scheduleRun = (delay = GIT_REVIEW_LIVE_DEBOUNCE_MS) => {
    if (
      state.disposed
      || state.running
      || state.refreshTimer !== null
    ) return;
    if (delay === 0) {
      void run();
      return;
    }
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      void run();
    }, delay);
  };

  const markRefreshRequested = (resetErrorRetryCount = true): number => {
    if (state.disposed) return state.generation;
    state.generation += 1;
    state.dirty = true;
    if (state.running) cancelCurrentRead();
    if (resetErrorRetryCount) state.errorRetryCount = 0;
    return state.generation;
  };

  const requestRefresh = (
    delay = GIT_REVIEW_LIVE_DEBOUNCE_MS,
    resetErrorRetryCount = true,
  ): number => {
    const generation = markRefreshRequested(resetErrorRetryCount);
    if (delay === 0) clearRefreshTimer();
    scheduleRun(delay);
    return generation;
  };

  run = async () => {
    if (state.disposed || state.running || !state.dirty) return;
    state.running = true;
    state.dirty = false;
    const generation = state.generation;
    const requestPrefix = `${input.subscriptionId}:${generation}`;
    let retryDelay: number | null = null;
    let trackedSummaryFallback: Extract<
      GitReviewSummaryResult,
      { type: "success" }
    > | null = null;

    try {
      if (
        input.query.method === "review-summary"
        && (
          input.query.params.source === "unstaged"
          || input.query.params.source === "branch"
        )
        && input.query.params.includeUntrackedFiles !== false
      ) {
        state.requestId = `${requestPrefix}:tracked`;
        const tracked = await dependencies.readSummary({
          ...input.query.params,
          includeUntrackedFiles: false,
          requestId: state.requestId,
        });
        if (!isCurrent(generation)) return;
        if (tracked.type === "success" && tracked.files.length > 0) {
          trackedSummaryFallback = tracked;
          input.publish(buildUpdatedEvent({
            subscriptionId: input.subscriptionId,
            generation,
            phase: "tracked",
            requiresRecovery: state.requiresRecovery,
            output: { method: "review-summary", result: tracked },
          }));
        }
      }
      if (
        input.query.method === "branch-diff-stats"
        && input.query.params.includeUntrackedFiles === true
      ) {
        state.requestId = `${requestPrefix}:tracked`;
        const tracked = await dependencies.readBranchDiffStats({
          ...input.query.params,
          includeUntrackedFiles: false,
          requestId: state.requestId,
        });
        if (!isCurrent(generation)) return;
        input.publish(buildUpdatedEvent({
          subscriptionId: input.subscriptionId,
          generation,
          phase: "tracked",
          requiresRecovery: state.requiresRecovery,
          output: { method: "branch-diff-stats", result: tracked },
        }));
      }

      if (!isCurrent(generation)) return;
      let output: GitReviewLiveQueryResult;
      if (input.query.method === "review-summary") {
        state.requestId = `${requestPrefix}:complete`;
        const complete = await dependencies.readSummary({
          ...input.query.params,
          includeUntrackedFiles:
            input.query.params.includeUntrackedFiles !== false,
          requestId: state.requestId,
        });
        output = {
          method: "review-summary",
          result:
            complete.type === "error" && trackedSummaryFallback
              ? trackedSummaryFallback
              : complete,
        };
      } else {
        state.requestId = `${requestPrefix}:complete`;
        output = await readCompleteLiveQuery(
          input.query,
          dependencies,
          state.requestId,
        );
      }
      if (!isCurrent(generation)) return;
      input.publish(buildUpdatedEvent({
        subscriptionId: input.subscriptionId,
        generation,
        phase: "complete",
        requiresRecovery: state.requiresRecovery,
        output,
      }));
      const isRetryableTypedError =
        output.method === "review-summary" && output.result.type === "error";
      if (
        isRetryableTypedError &&
        state.errorRetryCount < GIT_REVIEW_LIVE_MAX_ERROR_RETRIES
      ) {
        state.errorRetryCount += 1;
        state.dirty = true;
        retryDelay = GIT_REVIEW_LIVE_ERROR_RETRY_MS;
      } else if (!isRetryableTypedError) {
        state.errorRetryCount = 0;
      }
    } catch (error) {
      if (!isCurrent(generation)) return;
      publishFailure(generation, error);
    } finally {
      if (state.requestId?.startsWith(requestPrefix)) state.requestId = null;
      state.running = false;
      settleGeneration(generation);
      if (!state.disposed && state.dirty) {
        if (retryDelay !== null && generation === state.generation) {
          state.generation += 1;
        }
        scheduleRun(retryDelay ?? GIT_REVIEW_LIVE_DEBOUNCE_MS);
      }
    }
  };

  const setRequiresRecovery = (requiresRecovery: boolean) => {
    if (
      state.disposed
      || state.requiresRecovery === requiresRecovery
    ) return;
    state.requiresRecovery = requiresRecovery;
    requestRefresh();
  };

  const stopGitInitWatcher = async () => {
    if (gitInitWatchRetryTimer !== null) {
      clearTimeout(gitInitWatchRetryTimer);
      gitInitWatchRetryTimer = null;
    }
    const session = gitInitWatchSession;
    gitInitWatchSession = null;
    await session?.dispose();
  };

  const scheduleGitInitWatchRetry = () => {
    if (state.disposed || gitInitWatchRetryTimer !== null) return;
    gitInitWatchRetryTimer = setTimeout(() => {
      gitInitWatchRetryTimer = null;
      void startGitInitWatcher();
    }, GIT_REVIEW_WATCH_RETRY_MS);
  };

  const startGitInitWatcher = async (): Promise<void> => {
    if (
      state.disposed
      || gitInitWatchSession !== null
      || gitInitWatchStartPromise !== null
    ) return;
    const cwd = path.resolve(input.query.params.cwd.trim());
    const dotGitPath = path.join(cwd, ".git");
    const start = dependencies.fileWatchHost.startFileWatch({
      path: cwd,
      recursive: false,
      renameEventHandling: "changed-path",
      onChange: (change) => {
        if (
          change.changedPaths.length > 0
          && !change.changedPaths.some(
            (changedPath) => path.resolve(changedPath) === dotGitPath,
          )
        ) return;
        void startWatchers();
      },
    }).then((session) => {
      if (state.disposed) {
        void session.dispose();
        return;
      }
      gitInitWatchSession = session;
      void session.closed.then((closed) => {
        if (gitInitWatchSession !== session) return;
        gitInitWatchSession = null;
        if (state.disposed || closed.reason === "disposed") return;
        setRequiresRecovery(true);
        scheduleGitInitWatchRetry();
      });
    }).catch(() => {
      if (state.disposed) return;
      setRequiresRecovery(true);
      scheduleGitInitWatchRetry();
    }).finally(() => {
      if (gitInitWatchStartPromise === start) {
        gitInitWatchStartPromise = null;
      }
    });
    gitInitWatchStartPromise = start;
    await start;
  };

  startWatchers = async () => {
    watcherStartIdentity += 1;
    const identity = watcherStartIdentity;
    const roots = await dependencies.resolveWatchRoots(input.query.params.cwd);
    if (state.disposed || identity !== watcherStartIdentity) return;
    if (!roots) {
      await startGitInitWatcher();
      return;
    }

    await stopGitInitWatcher();

    const nextHandle = await acquireSharedGitReviewWatcher({
      roots,
      dependencies,
      onChange: (event) => {
        if (
          state.disposed
          || identity !== watcherStartIdentity
          || !shouldRefreshGitReviewLiveQuery(input.query, event.changeType)
        ) return;
        requestRefresh();
      },
      onRequiresRecoveryChanged: setRequiresRecovery,
    }).catch(() => null);

    if (
      state.disposed
      || identity !== watcherStartIdentity
      || nextHandle === null
    ) {
      await nextHandle?.release();
      if (!state.disposed && identity === watcherStartIdentity) {
        setRequiresRecovery(true);
      }
      return;
    }

    await stopWatchers();
    watcherHandle = nextHandle;
    state.requiresRecovery = nextHandle.requiresRecovery;
    const repositoryIdentity = buildRepositoryIdentity(roots);
    setRepositoryObserved(true, repositoryIdentity);
    if (snapshotInvalidationPending) {
      dependencies.invalidateSnapshot(
        input.query.params.cwd,
        repositoryIdentity,
      );
      snapshotInvalidationPending = false;
    }
  };

  watcherReadyPromise = startWatchers().finally(() => {
    clearRefreshTimer();
    requestRefresh(0);
  });
  void watcherReadyPromise;

  return {
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      watcherStartIdentity += 1;
      clearRefreshTimer();
      cancelCurrentRead();
      settleGeneration(Number.POSITIVE_INFINITY);
      void Promise.all([stopWatchers(), stopGitInitWatcher()]);
    },
    recover() {
      if (state.disposed) return Promise.resolve();
      if (recoveryPromise !== null) return recoveryPromise;
      invalidateRepositorySnapshot();
      const generation = markRefreshRequested();
      recoveryPromise = Promise.resolve()
        .then(async () => {
          await watcherReadyPromise;
          if (snapshotInvalidationPending) {
            dependencies.invalidateSnapshot(input.query.params.cwd);
            snapshotInvalidationPending = false;
          }
          if (watcherHandle) {
            await watcherHandle.recover();
          } else {
            await startWatchers();
          }
          clearRefreshTimer();
          scheduleRun(0);
          await waitForGeneration(generation);
        })
        .finally(() => {
          recoveryPromise = null;
        });
      return recoveryPromise;
    },
    refresh() {
      if (state.disposed) return Promise.resolve();
      invalidateRepositorySnapshot();
      const generation = markRefreshRequested();
      return Promise.resolve(watcherReadyPromise).then(() => {
        if (state.disposed) return;
        if (snapshotInvalidationPending) {
          dependencies.invalidateSnapshot(input.query.params.cwd);
          snapshotInvalidationPending = false;
        }
        clearRefreshTimer();
        scheduleRun(0);
        return waitForGeneration(generation);
      });
    },
  };
}

export function subscribeGitReviewSummary(
  input: {
    subscriptionId: string;
    request: GitReviewSummaryRequest;
    publish: (event: GitReviewLiveEvent) => void;
  },
  dependencies: GitReviewLiveSubscriptionDependencies = DEFAULT_DEPENDENCIES,
): GitReviewLiveSubscription {
  return subscribeGitReviewLiveQuery(
    {
      subscriptionId: input.subscriptionId,
      query: {
        method: "review-summary",
        params: input.request,
      },
      publish: input.publish,
    },
    dependencies,
  );
}
