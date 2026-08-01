import { QueryClient, type QueryKey, type QueryMeta } from "@tanstack/query-core";
import path from "node:path";
import type { GitReviewRepositoryPaths } from "./git-review-operations";
import { localFileWatchHost } from "../file-watch-host";
import {
  NodeGitReviewRepositoryWatcher,
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
  controller: AbortController;
  consumers: Set<symbol>;
  generation: number;
  promise: Promise<Result>;
}

interface WatchLeaseMember {
  onChange(event: GitReviewRepositoryChangedEvent): void;
  onRequiresRecoveryChanged(requiresRecovery: boolean): void;
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

export class WorktreeRepository {
  readonly identity: GitReviewRepositoryPaths & { hostId: "local" };
  readonly untrackedPaths: UntrackedPathCache;
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
  #snapshotController = new AbortController();
  #watcher: GitReviewRepositoryWatcher | null = null;
  #watcherStart: Promise<void> | null = null;
  #disposed = false;

  constructor(
    identity: GitReviewRepositoryPaths & { hostId: "local" },
    runner: GitCommandRunner,
  ) {
    this.identity = identity;
    this.#runner = runner;
    this.untrackedPaths = new UntrackedPathCache(this);
  }

  get generation(): number {
    return this.#generation;
  }

  runGit(
    args: readonly string[],
    options?: GitCommandOptions,
  ): Promise<GitCommandResult> {
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
        if (!result.success) {
          throw new Error("Could not discover Git attribute filters");
        }
        const filterNames = new Set<string>();
        for (const line of result.stdout.split(/\r?\n/)) {
          const match = /^filter\.(.+)\.(?:clean|smudge|process|required)$/.exec(
            line.trim(),
          );
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
    if (this.#disposed) return Promise.reject(new Error("Git repository is disposed"));
    input.signal?.throwIfAborted();
    const cacheKey = JSON.stringify(input.key);
    let shared = this.#sharedRuns.get(cacheKey) as SharedRun<Result> | undefined;
    if (shared) recordGitQueryCacheOutcome("coalesced");
    if (!shared) {
      const cached = this.#queryClient.getQueryData(input.key);
      recordGitQueryCacheOutcome(
        cached !== undefined && (input.staleTime ?? Infinity) === Infinity
          ? "hit"
          : "miss",
      );
      const controller = new AbortController();
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
        queryFn: async () => await input.run(controller.signal),
        staleTime: input.staleTime ?? Infinity,
      });
      shared = {
        controller,
        consumers: new Set(),
        generation,
        promise,
      };
      this.#sharedRuns.set(cacheKey, shared);
      void promise.finally(() => {
        if (this.#sharedRuns.get(cacheKey) === shared) {
          this.#sharedRuns.delete(cacheKey);
        }
      }).catch(() => undefined);
    }
    const consumer = Symbol(cacheKey);
    shared.consumers.add(consumer);
    return this.#waitForSharedRun(shared, consumer, input.signal);
  }

  advanceGeneration(
    options: { invalidateUntracked?: boolean } = {},
  ): number {
    if (this.#disposed) return this.#generation;
    this.#generation += 1;
    this.#snapshotController.abort();
    this.#snapshotController = new AbortController();
    if (options.invalidateUntracked !== false) this.untrackedPaths.invalidateFull();
    for (const run of this.#sharedRuns.values()) {
      if (run.generation < this.#generation) run.controller.abort();
    }
    void this.#queryClient.cancelQueries({
      predicate: (query) => {
        const meta = query.meta as GitReadQueryMeta | undefined;
        return (meta?.gitReadGeneration ?? this.#generation) < this.#generation;
      },
    });
    this.#queryClient.removeQueries({
      predicate: (query) => {
        const meta = query.meta as GitReadQueryMeta | undefined;
        return query.getObserversCount() === 0
          && (meta?.gitReadGeneration ?? this.#generation) < this.#generation;
      },
    });
    return this.#generation;
  }

  invalidate(domains: readonly NonNullable<GitReadQueryMeta["gitReadDomains"]>[number][]): void {
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
    if (this.#disposed) throw new Error("Git repository is disposed");
    this.#watchMembers.add(member);
    const watcher = this.#ensureWatcher();
    try {
      await this.#startWatcher(watcher);
    } catch (error) {
      this.#watchMembers.delete(member);
      this.#disposeWatcherIfUnused();
      throw error;
    }
    member.onRequiresRecoveryChanged(watcher.requiresRecovery);
    let released = false;
    return {
      recover: async () => {
        if (released || this.#disposed) return;
        await this.#startWatcher(watcher);
      },
      release: () => {
        if (released) return;
        released = true;
        this.#watchMembers.delete(member);
        this.#disposeWatcherIfUnused();
      },
    };
  }

  async invalidateGitReadCachesForRepoChange(
    change: GitReviewRepositoryChange,
    changedPaths?: readonly string[],
  ): Promise<number> {
    if (this.#disposed) return this.#generation;
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
    this.invalidate(domains);
    const generation = this.advanceGeneration({ invalidateUntracked: false });
    const event = { changeType: change, ...(changedPaths ? { changedPaths } : {}) };
    for (const member of this.#watchMembers) member.onChange(event);
    return generation;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#snapshotController.abort();
    this.#watcher?.dispose();
    this.#watcher = null;
    this.#watcherStart = null;
    this.#watchMembers.clear();
    for (const run of this.#sharedRuns.values()) run.controller.abort();
    this.#sharedRuns.clear();
    this.#queryClient.clear();
  }

  #ensureWatcher(): GitReviewRepositoryWatcher {
    if (this.#watcher) return this.#watcher;
    const watcher = new NodeGitReviewRepositoryWatcher({
      roots: {
        root: this.identity.root,
        gitDir: this.identity.gitDir,
        commonDir: this.identity.commonDir,
        headPath: path.join(this.identity.gitDir, "HEAD"),
        indexPath: path.join(this.identity.gitDir, "index"),
        syncedBranchPath: path.join(
          this.identity.gitDir,
          "codex-synced-branch.json",
        ),
      },
      host: localFileWatchHost,
      onChange: async (event) => {
        await this.invalidateGitReadCachesForRepoChange(
          event.changeType,
          event.changedPaths,
        );
      },
      onRequiresRecoveryChanged: (requiresRecovery) => {
        for (const member of this.#watchMembers) {
          member.onRequiresRecoveryChanged(requiresRecovery);
        }
      },
    });
    this.#watcher = watcher;
    return watcher;
  }

  async #startWatcher(watcher: GitReviewRepositoryWatcher): Promise<void> {
    if (this.#watcherStart) return await this.#watcherStart;
    const start = watcher.start().finally(() => {
      if (this.#watcherStart === start) this.#watcherStart = null;
    });
    this.#watcherStart = start;
    await start;
  }

  #disposeWatcherIfUnused(): void {
    if (this.#watchMembers.size > 0) return;
    this.#watcher?.dispose();
    this.#watcher = null;
    this.#watcherStart = null;
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
          shared.controller.abort();
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
