import { execFile } from "node:child_process";
import path from "node:path";
import * as parcelWatcher from "@parcel/watcher";
import type {
  GitReviewLiveSummaryEvent,
  GitReviewSummaryRequest,
  GitReviewSummaryResult,
} from "../shared/types";
import {
  cancelGitReviewRequest,
  invalidateGitReviewSnapshot,
  markGitReviewRepositoryObserved,
  readGitReviewSummary,
} from "./git-review-service";

export const GIT_REVIEW_LIVE_DEBOUNCE_MS = 100;
export const GIT_REVIEW_LIVE_ERROR_RETRY_MS = 1_000;
export const GIT_REVIEW_LIVE_MAX_ERROR_RETRIES = 3;

export type GitReviewRepositoryChange =
  | "config"
  | "head"
  | "index"
  | "remote-refs"
  | "working-tree"
  | "synced-branch"
  | "worktree-topology";

export interface GitReviewWatchRoots {
  root: string;
  gitDir: string;
  commonDir: string;
}

interface GitReviewWatcherAdapter {
  subscribe(
    directory: string,
    callback: parcelWatcher.SubscribeCallback,
    options?: parcelWatcher.Options,
  ): Promise<parcelWatcher.AsyncSubscription>;
}

export interface GitReviewLiveSubscriptionDependencies {
  readSummary: (
    request: GitReviewSummaryRequest,
  ) => Promise<GitReviewSummaryResult>;
  resolveWatchRoots: (cwd: string) => Promise<GitReviewWatchRoots | null>;
  watcher: GitReviewWatcherAdapter;
}

export interface GitReviewLiveSubscription {
  dispose(): void;
  recover(): void;
  refresh(): void;
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
}

const WATCH_IGNORES = [
  "**/.git/objects/**",
  "**/.git/logs/**",
  "**/.git/FETCH_HEAD",
  "**/.git/index.lock",
  "**/.git/*.lock",
] as const;

interface SharedGitReviewWatcherHandle {
  release(): Promise<void>;
  recover(): Promise<void>;
}

interface SharedGitReviewWatcherHub {
  key: string;
  roots: GitReviewWatchRoots;
  watcher: GitReviewWatcherAdapter;
  listeners: Set<parcelWatcher.SubscribeCallback>;
  subscriptions: parcelWatcher.AsyncSubscription[];
  startIdentity: number;
  ready: Promise<void>;
}

const sharedWatcherHubsByAdapter = new WeakMap<
  GitReviewWatcherAdapter,
  Map<string, SharedGitReviewWatcherHub>
>();

function buildSharedWatcherHubKey(roots: GitReviewWatchRoots): string {
  return JSON.stringify([roots.root, roots.gitDir, roots.commonDir]);
}

async function unsubscribeSharedWatcherSubscriptions(
  subscriptions: parcelWatcher.AsyncSubscription[],
): Promise<void> {
  await Promise.allSettled(
    subscriptions.map((subscription) => subscription.unsubscribe()),
  );
}

async function startSharedWatcherHub(
  hub: SharedGitReviewWatcherHub,
): Promise<void> {
  hub.startIdentity += 1;
  const identity = hub.startIdentity;
  const previousSubscriptions = hub.subscriptions;
  hub.subscriptions = [];
  await unsubscribeSharedWatcherSubscriptions(previousSubscriptions);

  const directories = Array.from(
    new Set([hub.roots.root, hub.roots.gitDir, hub.roots.commonDir]),
  );
  const subscriptions = await Promise.all(
    directories.map((directory) =>
      hub.watcher.subscribe(
        directory,
        (error, events) => {
          if (identity !== hub.startIdentity) return;
          for (const listener of hub.listeners) listener(error, events);
        },
        { ignore: [...WATCH_IGNORES] },
      ),
    ),
  );
  if (identity !== hub.startIdentity || hub.listeners.size === 0) {
    await unsubscribeSharedWatcherSubscriptions(subscriptions);
    return;
  }
  hub.subscriptions = subscriptions;
}

async function acquireSharedGitReviewWatcher(input: {
  roots: GitReviewWatchRoots;
  watcher: GitReviewWatcherAdapter;
  listener: parcelWatcher.SubscribeCallback;
}): Promise<SharedGitReviewWatcherHandle> {
  let hubs = sharedWatcherHubsByAdapter.get(input.watcher);
  if (!hubs) {
    hubs = new Map();
    sharedWatcherHubsByAdapter.set(input.watcher, hubs);
  }
  const key = buildSharedWatcherHubKey(input.roots);
  let hub = hubs.get(key);
  if (!hub) {
    hub = {
      key,
      roots: input.roots,
      watcher: input.watcher,
      listeners: new Set(),
      subscriptions: [],
      startIdentity: 0,
      ready: Promise.resolve(),
    };
    hubs.set(key, hub);
    hub.ready = startSharedWatcherHub(hub);
  }
  hub.listeners.add(input.listener);

  try {
    await hub.ready;
  } catch (error) {
    hub.listeners.delete(input.listener);
    if (hub.listeners.size === 0 && hubs.get(key) === hub) hubs.delete(key);
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      hub.listeners.delete(input.listener);
      if (hub.listeners.size > 0) return;
      if (hubs.get(key) === hub) hubs.delete(key);
      hub.startIdentity += 1;
      const subscriptions = hub.subscriptions;
      hub.subscriptions = [];
      await unsubscribeSharedWatcherSubscriptions(subscriptions);
    },
    async recover() {
      if (released) return;
      hub.ready = startSharedWatcherHub(hub);
      await hub.ready;
    },
  };
}

function execGitLines(cwd: string, args: readonly string[]): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      [...args],
      { cwd, encoding: "utf8", windowsHide: true, timeout: 8_000 },
      (error, stdout) => {
        if (error || typeof stdout !== "string") {
          resolve([]);
          return;
        }
        resolve(stdout.split(/\r?\n/).map((entry) => entry.trim()));
      },
    );
  });
}

async function resolveGitReviewWatchRoots(
  cwd: string,
): Promise<GitReviewWatchRoots | null> {
  const [root = "", rawGitDir = "", rawCommonDir = ""] = await execGitLines(
    cwd,
    ["rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir"],
  );
  if (!root || !rawGitDir || !rawCommonDir) return null;

  return {
    root: path.resolve(cwd, root),
    gitDir: path.resolve(cwd, rawGitDir),
    commonDir: path.resolve(cwd, rawCommonDir),
  };
}

function isWithin(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function normalizeRelative(directory: string, candidate: string): string {
  return path.relative(directory, candidate).replace(/\\/g, "/");
}

export function classifyGitReviewRepositoryChange(
  roots: GitReviewWatchRoots,
  changedPath: string,
): GitReviewRepositoryChange | null {
  const absolutePath = path.resolve(changedPath);
  const gitMetadataRoot = isWithin(roots.gitDir, absolutePath)
    ? roots.gitDir
    : isWithin(roots.commonDir, absolutePath)
      ? roots.commonDir
      : null;

  if (!gitMetadataRoot) {
    return isWithin(roots.root, absolutePath) ? "working-tree" : null;
  }

  const relativePath = normalizeRelative(gitMetadataRoot, absolutePath);
  if (
    relativePath.startsWith("objects/") ||
    relativePath.startsWith("logs/") ||
    relativePath === "FETCH_HEAD" ||
    relativePath.endsWith(".lock")
  ) {
    return null;
  }
  if (relativePath === "config" || relativePath === "config.worktree") {
    return "config";
  }
  if (relativePath === "HEAD" || relativePath.startsWith("refs/heads/")) {
    return "head";
  }
  if (relativePath === "index") return "index";
  if (relativePath.startsWith("refs/remotes/")) return "remote-refs";
  if (relativePath.startsWith("refs/codex/")) return "synced-branch";
  if (relativePath.startsWith("worktrees/")) return "worktree-topology";
  return null;
}

export function shouldRefreshGitReviewSummary(
  change: GitReviewRepositoryChange,
): boolean {
  return (
    change === "config" ||
    change === "head" ||
    change === "index" ||
    change === "remote-refs" ||
    change === "working-tree"
  );
}

function buildUpdatedEvent(input: {
  subscriptionId: string;
  generation: number;
  phase: "tracked" | "complete";
  requiresRecovery: boolean;
  result: GitReviewSummaryResult;
}): GitReviewLiveSummaryEvent {
  return {
    type: "git-live-query-updated",
    subscriptionId: input.subscriptionId,
    generation: input.generation,
    phase: input.phase,
    method: "review-summary",
    requiresRecovery: input.requiresRecovery,
    result: input.result,
  };
}

const DEFAULT_DEPENDENCIES: GitReviewLiveSubscriptionDependencies = {
  readSummary: readGitReviewSummary,
  resolveWatchRoots: resolveGitReviewWatchRoots,
  watcher: parcelWatcher,
};

export function subscribeGitReviewSummary(
  input: {
    subscriptionId: string;
    request: GitReviewSummaryRequest;
    publish: (event: GitReviewLiveSummaryEvent) => void;
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
  };
  let watcherHandle: SharedGitReviewWatcherHandle | null = null;
  let watcherStartIdentity = 0;
  let repositoryObserved = false;

  const setRepositoryObserved = (observed: boolean) => {
    if (repositoryObserved === observed) return;
    repositoryObserved = observed;
    markGitReviewRepositoryObserved(input.request.cwd, observed);
  };

  const clearRefreshTimer = () => {
    if (state.refreshTimer === null) return;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
  };

  const cancelCurrentRead = () => {
    const requestId = state.requestId;
    if (!requestId) return;
    cancelGitReviewRequest({ requestId });
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
      method: "review-summary",
      errorMessage:
        error instanceof Error
          ? error.message
          : "Could not refresh the Git review summary.",
    });
  };

  const run = async () => {
    if (state.disposed || state.running || !state.dirty) return;
    state.running = true;
    state.dirty = false;
    const generation = state.generation;
    const requestPrefix = `${input.subscriptionId}:${generation}`;

    try {
      if (
        input.request.source === "unstaged" ||
        input.request.source === "branch"
      ) {
        state.requestId = `${requestPrefix}:tracked`;
        const tracked = await dependencies.readSummary({
          ...input.request,
          includeUntrackedFiles: false,
          requestId: state.requestId,
        });
        if (tracked.type === "error") {
          throw new Error(
            tracked.errorMessage ?? "Could not refresh tracked Git changes.",
          );
        }
        if (
          !state.disposed &&
          generation === state.generation &&
          tracked.files.length > 0
        ) {
          input.publish(
            buildUpdatedEvent({
              subscriptionId: input.subscriptionId,
              generation,
              phase: "tracked",
              requiresRecovery: state.requiresRecovery,
              result: tracked,
            }),
          );
        }
      }

      state.requestId = `${requestPrefix}:complete`;
      const complete = await dependencies.readSummary({
        ...input.request,
        includeUntrackedFiles: true,
        requestId: state.requestId,
      });
      if (complete.type === "error") {
        throw new Error(
          complete.errorMessage ?? "Could not refresh the Git review summary.",
        );
      }
      if (!state.disposed && generation === state.generation) {
        input.publish(
          buildUpdatedEvent({
            subscriptionId: input.subscriptionId,
            generation,
            phase: "complete",
            requiresRecovery: state.requiresRecovery,
            result: complete,
          }),
        );
      }
      state.errorRetryCount = 0;
    } catch (error) {
      if (state.disposed || generation !== state.generation) return;
      state.errorRetryCount += 1;
      publishFailure(generation, error);
      if (state.errorRetryCount <= GIT_REVIEW_LIVE_MAX_ERROR_RETRIES) {
        state.dirty = true;
        state.refreshTimer = setTimeout(() => {
          state.refreshTimer = null;
          void run();
        }, GIT_REVIEW_LIVE_ERROR_RETRY_MS);
      }
    } finally {
      if (state.requestId?.startsWith(requestPrefix)) state.requestId = null;
      state.running = false;
      if (!state.disposed && state.dirty && state.refreshTimer === null) {
        void run();
      }
    }
  };

  const scheduleRefresh = (
    delay = GIT_REVIEW_LIVE_DEBOUNCE_MS,
    advanceGeneration = true,
  ) => {
    if (state.disposed) return;
    if (advanceGeneration) state.generation += 1;
    state.dirty = true;
    if (state.running || state.refreshTimer !== null) return;
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      void run();
    }, delay);
  };

  const startWatchers = async (recoverSharedWatcher = false) => {
    watcherStartIdentity += 1;
    const identity = watcherStartIdentity;
    const roots = await dependencies.resolveWatchRoots(input.request.cwd);
    if (state.disposed || identity !== watcherStartIdentity || !roots) return;

    const nextHandle = await acquireSharedGitReviewWatcher({
      roots,
      watcher: dependencies.watcher,
      listener: (error, events) => {
        if (state.disposed || identity !== watcherStartIdentity) return;
        if (error) {
          state.requiresRecovery = true;
          invalidateGitReviewSnapshot(input.request.cwd);
          scheduleRefresh();
          return;
        }
        if (
          events.some((event) => {
            const change = classifyGitReviewRepositoryChange(roots, event.path);
            return change !== null && shouldRefreshGitReviewSummary(change);
          })
        ) {
          invalidateGitReviewSnapshot(input.request.cwd);
          scheduleRefresh();
        }
      },
    }).catch(() => null);

    if (
      state.disposed ||
      identity !== watcherStartIdentity ||
      nextHandle === null
    ) {
      await nextHandle?.release();
      if (!state.disposed && identity === watcherStartIdentity) {
        state.requiresRecovery = true;
      }
      return;
    }
    if (recoverSharedWatcher) {
      try {
        await nextHandle.recover();
      } catch {
        await nextHandle.release();
        state.requiresRecovery = true;
        return;
      }
    }
    await stopWatchers();
    watcherHandle = nextHandle;
    setRepositoryObserved(true);
  };

  void startWatchers().finally(() => scheduleRefresh(0));

  return {
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      watcherStartIdentity += 1;
      clearRefreshTimer();
      cancelCurrentRead();
      void stopWatchers();
    },
    recover() {
      if (state.disposed) return;
      state.requiresRecovery = false;
      invalidateGitReviewSnapshot(input.request.cwd);
      void startWatchers(true).finally(() => scheduleRefresh(0));
    },
    refresh() {
      if (state.disposed) return;
      invalidateGitReviewSnapshot(input.request.cwd);
      scheduleRefresh(0);
    },
  };
}
