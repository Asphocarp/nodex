import { QueryClient, type QueryKey, type QueryMeta } from "@tanstack/query-core";
import path from "node:path";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Scope from "effect/Scope";
import type { FileWatchHost } from "../file-watch-host";
import { localFileWatchHost } from "../file-watch-host";
import type { GitReviewRepositoryPaths } from "./git-review-operations";
import {
  makeGitReviewRepositoryWatcher,
  type GitReviewRepositoryChangedEvent,
  type GitReviewRepositoryChange,
  type GitReviewRepositoryWatcher,
} from "./repository-watcher";
import {
  recordGitQueryCacheOutcome,
  type GitCommandOptions,
  type GitCommandResult,
  type GitCommandRunner,
} from "./git-command-runner";
import { UntrackedPathCache } from "./untracked-cache";

interface SharedRun<Result> {
  consumers: Set<symbol>;
  key: QueryKey;
  promise: Promise<Result>;
}

interface WatchLeaseMember {
  onChange(event: GitReviewRepositoryChangedEvent): void;
  onRequiresRecoveryChanged(requiresRecovery: boolean): void;
}

interface AcquiredWatcher {
  readonly watcher: GitReviewRepositoryWatcher;
  release(): void;
}

export interface GitRepositoryWatchLease {
  recover(): Promise<void>;
  release(): void;
}

export interface GitReadQueryMeta extends QueryMeta {
  gitReadDomains?: readonly (
    | "config"
    | "head"
    | "index"
    | "local-refs"
    | "remote-refs"
    | "working-tree"
  )[];
  gitReadPaths?: readonly string[];
  gitReadGeneration?: number;
}

export interface WorktreeRepository {
  readonly generation: number;
  readonly identity: GitReviewRepositoryPaths & { hostId: "local" };
  readonly untrackedPaths: UntrackedPathCache;
  acquireWatchLease(member: WatchLeaseMember): Promise<GitRepositoryWatchLease>;
  advanceGeneration(options?: { invalidateUntracked?: boolean }): number;
  invalidateGitReadCachesForRepoChange(
    change: GitReviewRepositoryChange,
    changedPaths?: readonly string[],
  ): Promise<number>;
  query<Result>(input: {
    key: QueryKey;
    meta?: GitReadQueryMeta;
    signal?: AbortSignal;
    staleTime?: number;
    run: (signal: AbortSignal) => Promise<Result>;
  }): Promise<Result>;
  readSafeAttributeFilterOverrides(signal?: AbortSignal): Promise<readonly string[]>;
  runGit(args: readonly string[], options?: GitCommandOptions): Promise<GitCommandResult>;
}

class RepositoryWatcher extends Context.Service<RepositoryWatcher, GitReviewRepositoryWatcher>()(
  "nodex/main/git-worker/RepositoryWatcher",
) {}

class WorktreeRepositoryState implements WorktreeRepository {
  readonly identity: GitReviewRepositoryPaths & { hostId: "local" };
  readonly untrackedPaths: UntrackedPathCache;
  readonly #acquireWatcher: () => Promise<AcquiredWatcher>;
  readonly #runner: GitCommandRunner;
  readonly #queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
  });
  readonly #sharedRuns = new Map<string, SharedRun<unknown>>();
  readonly #watchMembers = new Set<WatchLeaseMember>();
  #generation = 1;
  #closed = false;

  constructor(
    identity: GitReviewRepositoryPaths & { hostId: "local" },
    runner: GitCommandRunner,
    acquireWatcher: () => Promise<AcquiredWatcher>,
  ) {
    this.identity = identity;
    this.#runner = runner;
    this.#acquireWatcher = acquireWatcher;
    this.untrackedPaths = new UntrackedPathCache(this);
  }

  get generation(): number {
    return this.#generation;
  }

  runGit(args: readonly string[], options?: GitCommandOptions): Promise<GitCommandResult> {
    if (this.#closed) return Promise.reject(new Error("Git repository is closed"));
    return this.#runner.run(this.identity, args, options);
  }

  readSafeAttributeFilterOverrides(signal?: AbortSignal): Promise<readonly string[]> {
    return this.query({
      key: ["safe-attribute-filter-overrides"],
      meta: { gitReadDomains: ["config"] },
      signal,
      run: async (querySignal) => {
        const result = await this.runGit(
          [
            "config",
            "--name-only",
            "--get-regexp",
            "^filter\\..*\\.(clean|smudge|process|required)$",
          ],
          { allowedNonZeroExitCodes: [1], signal: querySignal },
        );
        if (!result.success) throw new Error("Could not discover Git attribute filters");
        const filterNames = new Set<string>();
        for (const line of result.stdout.split(/\r?\n/)) {
          const match = /^filter\.(.+)\.(?:clean|smudge|process|required)$/.exec(line.trim());
          if (match?.[1]) filterNames.add(match[1]);
        }
        return [
          "attr.tree=",
          "core.attributesFile=",
          ...[...filterNames].flatMap((name) => [
            `filter.${name}.clean=`,
            `filter.${name}.smudge=`,
            `filter.${name}.process=`,
            `filter.${name}.required=false`,
          ]),
        ];
      },
    });
  }

  query<Result>(input: {
    key: QueryKey;
    meta?: GitReadQueryMeta;
    signal?: AbortSignal;
    staleTime?: number;
    run: (signal: AbortSignal) => Promise<Result>;
  }): Promise<Result> {
    if (this.#closed) return Promise.reject(new Error("Git repository is closed"));
    input.signal?.throwIfAborted();
    const cacheKey = JSON.stringify(input.key);
    let shared = this.#sharedRuns.get(cacheKey) as SharedRun<Result> | undefined;
    if (shared) recordGitQueryCacheOutcome("coalesced");
    if (!shared) {
      const cached = this.#queryClient.getQueryData(input.key);
      recordGitQueryCacheOutcome(
        cached !== undefined && (input.staleTime ?? Infinity) === Infinity ? "hit" : "miss",
      );
      const generation = this.#generation;
      // The caller owns the complete operation identity in `input.key`.
      // `run` is an execution adapter, not query data.
      // eslint-disable-next-line @tanstack/query/exhaustive-deps
      const promise = this.#queryClient.fetchQuery({
        queryKey: input.key,
        meta: {
          ...input.meta,
          gitReadGeneration: input.meta?.gitReadGeneration ?? generation,
        },
        queryFn: async ({ signal }) => await input.run(signal),
        staleTime: input.staleTime ?? Infinity,
      });
      shared = {
        consumers: new Set(),
        key: input.key,
        promise,
      };
      this.#sharedRuns.set(cacheKey, shared);
      void promise
        .finally(() => {
          if (this.#sharedRuns.get(cacheKey) === shared) this.#sharedRuns.delete(cacheKey);
        })
        .catch(() => undefined);
    }
    const consumer = Symbol(cacheKey);
    shared.consumers.add(consumer);
    return this.#waitForSharedRun(shared, consumer, input.signal);
  }

  advanceGeneration(options: { invalidateUntracked?: boolean } = {}): number {
    if (this.#closed) return this.#generation;
    this.#generation += 1;
    if (options.invalidateUntracked !== false) this.untrackedPaths.invalidateFull();
    void this.#queryClient.cancelQueries({
      predicate: (query) => {
        const meta = query.meta as GitReadQueryMeta | undefined;
        return (meta?.gitReadGeneration ?? this.#generation) < this.#generation;
      },
    });
    this.#queryClient.removeQueries({
      predicate: (query) => {
        const meta = query.meta as GitReadQueryMeta | undefined;
        return (
          query.getObserversCount() === 0 &&
          (meta?.gitReadGeneration ?? this.#generation) < this.#generation
        );
      },
    });
    return this.#generation;
  }

  #invalidate(domains: readonly NonNullable<GitReadQueryMeta["gitReadDomains"]>[number][]): void {
    const changed = new Set(domains);
    void this.#queryClient.invalidateQueries({
      predicate: (query) => {
        const meta = query.meta as GitReadQueryMeta | undefined;
        return meta?.gitReadDomains?.some((domain) => changed.has(domain)) ?? false;
      },
      refetchType: "none",
    });
  }

  async acquireWatchLease(member: WatchLeaseMember): Promise<GitRepositoryWatchLease> {
    if (this.#closed) throw new Error("Git repository is closed");
    this.#watchMembers.add(member);
    let acquired: AcquiredWatcher;
    try {
      acquired = await this.#acquireWatcher();
    } catch (error) {
      this.#watchMembers.delete(member);
      throw error;
    }
    if (this.#closed) {
      this.#watchMembers.delete(member);
      acquired.release();
      throw new Error("Git repository is closed");
    }
    member.onRequiresRecoveryChanged(acquired.watcher.requiresRecovery);
    let released = false;
    return {
      recover: async () => {
        if (released || this.#closed) return;
        await acquired.watcher.recover();
      },
      release: () => {
        if (released) return;
        released = true;
        this.#watchMembers.delete(member);
        acquired.release();
      },
    };
  }

  async invalidateGitReadCachesForRepoChange(
    change: GitReviewRepositoryChange,
    changedPaths?: readonly string[],
  ): Promise<number> {
    if (this.#closed) return this.#generation;
    const domains: NonNullable<GitReadQueryMeta["gitReadDomains"]> =
      change === "config"
        ? ["config"]
        : change === "head" || change === "worktree-topology"
          ? ["head", "index", "local-refs", "working-tree"]
          : change === "index"
            ? ["index"]
            : change === "remote-refs" || change === "synced-branch"
              ? ["remote-refs"]
              : ["working-tree"];
    if (change === "working-tree" && changedPaths && changedPaths.length > 0) {
      await this.untrackedPaths.invalidatePaths(changedPaths).catch(() => {
        this.untrackedPaths.invalidateFull();
      });
    } else {
      this.untrackedPaths.invalidateFull();
    }
    this.#invalidate(domains);
    const generation = this.advanceGeneration({ invalidateUntracked: false });
    const event = { changeType: change, ...(changedPaths ? { changedPaths } : {}) };
    for (const member of this.#watchMembers) member.onChange(event);
    return generation;
  }

  notifyRequiresRecovery(requiresRecovery: boolean): void {
    for (const member of this.#watchMembers) {
      member.onRequiresRecoveryChanged(requiresRecovery);
    }
  }

  async release(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#watchMembers.clear();
    await this.#queryClient.cancelQueries();
    this.#sharedRuns.clear();
    this.#queryClient.clear();
  }

  async #waitForSharedRun<Result>(
    shared: SharedRun<Result>,
    consumer: symbol,
    signal?: AbortSignal,
  ): Promise<Result> {
    if (!signal) {
      try {
        return await shared.promise;
      } finally {
        shared.consumers.delete(consumer);
      }
    }
    return await new Promise<Result>((resolve, reject) => {
      let settled = false;
      const release = (cancelUnderlying: boolean) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        shared.consumers.delete(consumer);
        if (cancelUnderlying && shared.consumers.size === 0) {
          void this.#queryClient.cancelQueries({ queryKey: shared.key, exact: true });
        }
      };
      const abort = () => {
        release(true);
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      shared.promise.then(
        (value) => {
          if (settled) return;
          release(false);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          release(false);
          reject(error);
        },
      );
    });
  }
}

export interface WorktreeRepositoryOptions {
  readonly watchHost?: FileWatchHost;
}

/** Creates one repository owner; watcher resources are acquired lazily per live-query lease. */
export const makeWorktreeRepository = (
  identity: GitReviewRepositoryPaths & { hostId: "local" },
  runner: GitCommandRunner,
  options: WorktreeRepositoryOptions = {},
): Effect.Effect<WorktreeRepository, never, Scope.Scope> =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    const runPromise = yield* FiberSet.makeRuntimePromise<never, unknown, never>();
    let repository!: WorktreeRepositoryState;
    const watchers = yield* LayerMap.make(
      (_key: "watcher") =>
        Layer.effect(
          RepositoryWatcher,
          makeGitReviewRepositoryWatcher({
            roots: {
              root: identity.root,
              gitDir: identity.gitDir,
              commonDir: identity.commonDir,
              headPath: path.join(identity.gitDir, "HEAD"),
              indexPath: path.join(identity.gitDir, "index"),
              syncedBranchPath: path.join(identity.gitDir, "codex-synced-branch.json"),
            },
            host: options.watchHost ?? localFileWatchHost,
            onChange: async (event) => {
              await repository.invalidateGitReadCachesForRepoChange(
                event.changeType,
                event.changedPaths,
              );
            },
            onRequiresRecoveryChanged: (requiresRecovery) => {
              repository.notifyRequiresRecovery(requiresRecovery);
            },
          }),
        ),
      { idleTimeToLive: Duration.zero },
    );
    const acquireWatcher = async (): Promise<AcquiredWatcher> =>
      await runPromise(
        Effect.gen(function* () {
          const leaseScope = yield* Scope.fork(ownerScope);
          const contextExit = yield* Effect.exit(
            watchers.contextEffect("watcher").pipe(Scope.provide(leaseScope)),
          );
          if (Exit.isFailure(contextExit)) {
            yield* Scope.close(leaseScope, Exit.void);
            return yield* Effect.failCause(contextExit.cause);
          }
          let released = false;
          return {
            watcher: Context.get(contextExit.value, RepositoryWatcher),
            release: () => {
              if (released) return;
              released = true;
              void runPromise(Scope.close(leaseScope, Exit.void)).catch(() => undefined);
            },
          };
        }),
      );
    repository = new WorktreeRepositoryState(identity, runner, acquireWatcher);
    yield* Effect.addFinalizer(() => Effect.promise(() => repository.release()));
    return repository;
  });
