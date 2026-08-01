import type {
  GitReviewLiveEvent,
  GitReviewLiveQuery,
  GitReviewLiveQueryMethod,
  GitReviewLiveQueryResult,
} from "../../shared/types";
import type { GitWorkerLiveQueryEvent } from "../../shared/git-worker-protocol";
import type { GitReviewRepositoryChange } from "./repository-watcher";
import type { QueryKey } from "@tanstack/query-core";
import type {
  GitReadQueryMeta,
  GitRepositoryWatchLease,
} from "./worktree-repository";

export const GIT_LIVE_QUERY_DEBOUNCE_MS = 100;
export const GIT_LIVE_QUERY_RETRY_MS = 1_000;
export const GIT_LIVE_QUERY_MAX_RETRIES = 3;

export interface LiveQueryRepository {
  readonly generation: number;
  acquireWatchLease(member: {
    onChange(event: import("./repository-watcher").GitReviewRepositoryChangedEvent): void;
    onRequiresRecoveryChanged(requiresRecovery: boolean): void;
  }): Promise<GitRepositoryWatchLease>;
  advanceGeneration(): number;
  query<Result>(input: {
    key: QueryKey;
    meta?: GitReadQueryMeta;
    signal?: AbortSignal;
    run: (signal: AbortSignal) => Promise<Result>;
  }): Promise<Result>;
}

interface LiveQueryState {
  controller: AbortController | null;
  dirty: boolean;
  disposed: boolean;
  errorRetryCount: number;
  generation: number;
  query: GitReviewLiveQuery;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  repository: LiveQueryRepository | null;
  requiresRecovery: boolean;
  running: boolean;
  settledGeneration: number;
  subscriptionId: string;
  waiters: Map<number, Set<() => void>>;
  watchLease: GitRepositoryWatchLease | null;
}

export interface GitLiveQueryRegistryOptions {
  execute(input: {
    id: string;
    method: GitReviewLiveQueryMethod;
    params: GitReviewLiveQuery["params"];
    signal: AbortSignal;
  }): Promise<unknown>;
  publish(event: GitWorkerLiveQueryEvent): void;
  registry: {
    get(cwd: string, signal?: AbortSignal): Promise<LiveQueryRepository | null>;
  };
}

function normalizeQueryParams(params: GitReviewLiveQuery["params"]): object {
  const normalized = { ...params } as Record<string, unknown>;
  delete normalized.requestId;
  delete normalized.operationSource;
  return normalized;
}

function isStaleResult(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "type" in value
    && value.type === "stale-snapshot";
}

function isRetryableOperationalError(value: unknown): boolean {
  if (
    typeof value !== "object"
    || value === null
    || !("type" in value)
    || value.type !== "error"
  ) return false;
  return !("failureReason" in value && value.failureReason === "canceled");
}

export function shouldRefreshGitLiveQuery(
  method: GitReviewLiveQueryMethod,
  change: GitReviewRepositoryChange,
): boolean {
  if (
    method === "status-summary"
    || method === "review-summary"
    || method === "branch-diff-stats"
  ) {
    return change === "config"
      || change === "head"
      || change === "index"
      || change === "remote-refs"
      || change === "working-tree";
  }
  return change === "config"
    || change === "head"
    || change === "remote-refs"
    || change === "worktree-topology";
}

export class GitLiveQueryRegistry {
  readonly #execute: GitLiveQueryRegistryOptions["execute"];
  readonly #publish: GitLiveQueryRegistryOptions["publish"];
  readonly #registry: GitLiveQueryRegistryOptions["registry"];
  readonly #subscriptions = new Map<string, LiveQueryState>();

  constructor(options: GitLiveQueryRegistryOptions) {
    this.#execute = options.execute;
    this.#publish = options.publish;
    this.#registry = options.registry;
  }

  async subscribe(input: {
    subscriptionId: string;
    query: GitReviewLiveQuery;
  }): Promise<void> {
    this.unsubscribe(input.subscriptionId);
    const state: LiveQueryState = {
      controller: null,
      dirty: true,
      disposed: false,
      errorRetryCount: 0,
      generation: 1,
      query: input.query,
      refreshTimer: null,
      repository: null,
      requiresRecovery: false,
      running: false,
      settledGeneration: 0,
      subscriptionId: input.subscriptionId,
      waiters: new Map(),
      watchLease: null,
    };
    this.#subscriptions.set(input.subscriptionId, state);
    await this.#attachRepository(state);
    this.#schedule(state, 0);
  }

  unsubscribe(subscriptionId: string): boolean {
    const state = this.#subscriptions.get(subscriptionId);
    if (!state) return false;
    state.disposed = true;
    state.controller?.abort();
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.watchLease?.release();
    for (const waiters of state.waiters.values()) {
      for (const resolve of waiters) resolve();
    }
    state.waiters.clear();
    this.#subscriptions.delete(subscriptionId);
    return true;
  }

  async recover(subscriptionId: string): Promise<boolean> {
    const state = this.#subscriptions.get(subscriptionId);
    if (!state) return false;
    await state.watchLease?.recover();
    if (!state.repository) await this.#attachRepository(state);
    await this.#requestRefresh(state, true);
    return true;
  }

  async refresh(subscriptionId: string): Promise<boolean> {
    const state = this.#subscriptions.get(subscriptionId);
    if (!state) return false;
    if (state.repository) {
      state.repository.advanceGeneration();
    } else {
      await this.#attachRepository(state);
    }
    await this.#requestRefresh(state, true);
    return true;
  }

  dispose(): void {
    for (const subscriptionId of [...this.#subscriptions.keys()]) {
      this.unsubscribe(subscriptionId);
    }
  }

  async #attachRepository(state: LiveQueryState): Promise<void> {
    if (state.disposed || state.repository) return;
    const repository = await this.#registry.get(state.query.params.cwd)
      .catch(() => null);
    if (state.disposed || !repository) return;
    state.repository = repository;
    state.watchLease = await repository.acquireWatchLease({
      onChange: (event) => {
        if (
          state.disposed
          || !shouldRefreshGitLiveQuery(state.query.method, event.changeType)
        ) return;
        void this.#requestRefresh(state, false);
      },
      onRequiresRecoveryChanged: (requiresRecovery) => {
        if (state.disposed || state.requiresRecovery === requiresRecovery) return;
        state.requiresRecovery = requiresRecovery;
        void this.#requestRefresh(state, false);
      },
    }).catch(() => {
      state.requiresRecovery = true;
      return null;
    });
  }

  async #requestRefresh(
    state: LiveQueryState,
    immediate: boolean,
  ): Promise<void> {
    if (state.disposed) return;
    state.generation += 1;
    state.dirty = true;
    state.errorRetryCount = 0;
    state.controller?.abort();
    const generation = state.generation;
    this.#schedule(state, immediate ? 0 : GIT_LIVE_QUERY_DEBOUNCE_MS);
    await this.#waitForGeneration(state, generation);
  }

  #schedule(state: LiveQueryState, delay: number): void {
    if (state.disposed || state.running || state.refreshTimer) return;
    if (delay === 0) {
      void this.#run(state);
      return;
    }
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      void this.#run(state);
    }, delay);
  }

  async #run(state: LiveQueryState): Promise<void> {
    if (state.disposed || state.running || !state.dirty) return;
    state.running = true;
    state.dirty = false;
    const generation = state.generation;
    const controller = new AbortController();
    state.controller = controller;
    let retryDelay: number | null = null;
    try {
      const trackedParams = this.#trackedPhaseParams(state.query);
      if (trackedParams) {
        const tracked = await this.#read(state, generation, "tracked", trackedParams, controller.signal);
        if (!this.#isCurrent(state, generation) || isStaleResult(tracked)) return;
        this.#publishResult(state, generation, "tracked", tracked);
      }
      const complete = await this.#read(
        state,
        generation,
        "complete",
        state.query.params,
        controller.signal,
      );
      if (!this.#isCurrent(state, generation) || isStaleResult(complete)) return;
      this.#publishResult(state, generation, "complete", complete);
      if (
        isRetryableOperationalError(complete)
        && state.errorRetryCount < GIT_LIVE_QUERY_MAX_RETRIES
      ) {
        state.errorRetryCount += 1;
        state.dirty = true;
        retryDelay = GIT_LIVE_QUERY_RETRY_MS;
      } else {
        state.errorRetryCount = 0;
      }
    } catch (error) {
      if (!this.#isCurrent(state, generation)) return;
      this.#publishFailure(state, generation, error);
      if (state.errorRetryCount < GIT_LIVE_QUERY_MAX_RETRIES) {
        state.errorRetryCount += 1;
        state.dirty = true;
        retryDelay = GIT_LIVE_QUERY_RETRY_MS;
      }
    } finally {
      if (state.controller === controller) state.controller = null;
      state.running = false;
      this.#settleGeneration(state, generation);
      if (!state.disposed && state.dirty) {
        if (retryDelay !== null && generation === state.generation) {
          state.generation += 1;
        }
        this.#schedule(
          state,
          retryDelay ?? GIT_LIVE_QUERY_DEBOUNCE_MS,
        );
      }
    }
  }

  async #read(
    state: LiveQueryState,
    generation: number,
    phase: "tracked" | "complete",
    params: GitReviewLiveQuery["params"],
    signal: AbortSignal,
  ): Promise<unknown> {
    const repository = state.repository;
    if (!repository) {
      return await this.#execute({
        id: `${state.subscriptionId}:${generation}:${phase}`,
        method: state.query.method,
        params,
        signal,
      });
    }
    return await repository.query({
      key: [
        "live-query",
        state.query.method,
        normalizeQueryParams(params),
        phase,
        repository.generation,
      ],
      meta: {
        gitReadDomains: state.query.method === "status-summary"
          || state.query.method === "review-summary"
          || state.query.method === "branch-diff-stats"
          ? ["config", "head", "index", "local-refs", "remote-refs", "working-tree"]
          : ["config", "head", "local-refs", "remote-refs"],
        gitReadGeneration: repository.generation,
      },
      signal,
      run: async (sharedSignal) => await this.#execute({
        id: `${state.subscriptionId}:${generation}:${phase}`,
        method: state.query.method,
        params,
        signal: sharedSignal,
      }),
    });
  }

  #trackedPhaseParams(
    query: GitReviewLiveQuery,
  ): GitReviewLiveQuery["params"] | null {
    if (
      query.method === "status-summary"
      && query.params.includeUntrackedFiles === true
    ) {
      return { ...query.params, includeUntrackedFiles: false };
    }
    if (
      query.method === "review-summary"
      && (query.params.source === "unstaged" || query.params.source === "branch")
      && query.params.includeUntrackedFiles !== false
    ) {
      return { ...query.params, includeUntrackedFiles: false };
    }
    if (
      query.method === "branch-diff-stats"
      && query.params.includeUntrackedFiles === true
    ) {
      return { ...query.params, includeUntrackedFiles: false };
    }
    return null;
  }

  #publishResult(
    state: LiveQueryState,
    generation: number,
    phase: "tracked" | "complete",
    result: unknown,
  ): void {
    const output = {
      method: state.query.method,
      result,
    } as GitReviewLiveQueryResult;
    const event: GitReviewLiveEvent = {
      type: "git-live-query-updated",
      subscriptionId: state.subscriptionId,
      generation,
      phase,
      requiresRecovery: state.requiresRecovery,
      ...output,
    };
    this.#publish({ type: "git-live-query-event", workerId: "git", event });
  }

  #publishFailure(
    state: LiveQueryState,
    generation: number,
    error: unknown,
  ): void {
    const event: GitReviewLiveEvent = {
      type: "git-live-query-failed",
      subscriptionId: state.subscriptionId,
      generation,
      requiresRecovery: state.requiresRecovery,
      method: state.query.method,
      errorMessage: error instanceof Error
        ? error.message
        : "Could not refresh the Git live query.",
    };
    this.#publish({ type: "git-live-query-event", workerId: "git", event });
  }

  #isCurrent(state: LiveQueryState, generation: number): boolean {
    return !state.disposed && state.generation === generation;
  }

  #settleGeneration(state: LiveQueryState, generation: number): void {
    state.settledGeneration = Math.max(state.settledGeneration, generation);
    for (const [target, waiters] of state.waiters) {
      if (target > state.settledGeneration) continue;
      state.waiters.delete(target);
      for (const resolve of waiters) resolve();
    }
  }

  #waitForGeneration(state: LiveQueryState, generation: number): Promise<void> {
    if (state.disposed || state.settledGeneration >= generation) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiters = state.waiters.get(generation) ?? new Set();
      waiters.add(resolve);
      state.waiters.set(generation, waiters);
    });
  }
}
