import { describe, expect, test, vi } from "vitest";
import type { GitReviewRepositoryChangedEvent } from "./repository-watcher";
import {
  GitLiveQueryRegistry,
  shouldRefreshGitLiveQuery,
  type GitLiveQueryRegistryOptions,
  type LiveQueryRepository,
} from "./live-query-registry";
import type { GitRepositoryWatchLease } from "./worktree-repository";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

class FakeLiveRepository implements LiveQueryRepository {
  generation = 1;
  queryRuns = 0;
  watchLeases = 0;
  readonly #runs = new Map<string, Promise<unknown>>();
  #member: {
    onChange(event: GitReviewRepositoryChangedEvent): void;
    onRequiresRecoveryChanged(requiresRecovery: boolean): void;
  } | null = null;

  async acquireWatchLease(member: {
    onChange(event: GitReviewRepositoryChangedEvent): void;
    onRequiresRecoveryChanged(requiresRecovery: boolean): void;
  }): Promise<GitRepositoryWatchLease> {
    this.watchLeases += 1;
    this.#member = member;
    return {
      recover: async () => undefined,
      release: () => {
        this.#member = null;
      },
    };
  }

  advanceGeneration(): number {
    this.generation += 1;
    this.#runs.clear();
    return this.generation;
  }

  async query<Result>(input: {
    key: readonly unknown[];
    signal?: AbortSignal;
    run: (signal: AbortSignal) => Promise<Result>;
  }): Promise<Result> {
    const key = JSON.stringify(input.key);
    const existing = this.#runs.get(key);
    if (existing) return await existing as Result;
    this.queryRuns += 1;
    const controller = new AbortController();
    const promise = input.run(controller.signal).finally(() => {
      if (this.#runs.get(key) === promise) this.#runs.delete(key);
    });
    this.#runs.set(key, promise);
    return await promise;
  }

  change(event: GitReviewRepositoryChangedEvent): void {
    this.advanceGeneration();
    this.#member?.onChange(event);
  }
}

describe("GitLiveQueryRegistry", () => {
  test("defines an exhaustive semantic invalidation matrix", () => {
    expect(shouldRefreshGitLiveQuery("review-summary", "working-tree"))
      .toBe(true);
    expect(shouldRefreshGitLiveQuery("branch-diff-stats", "index"))
      .toBe(true);
    expect(shouldRefreshGitLiveQuery("base-branch", "working-tree"))
      .toBe(false);
    expect(shouldRefreshGitLiveQuery("branch-commits", "remote-refs"))
      .toBe(true);
  });

  test("coalesces identical subscriptions and publishes tracked before complete", async () => {
    const repository = new FakeLiveRepository();
    const complete = deferred<unknown>();
    const execute: GitLiveQueryRegistryOptions["execute"] = vi.fn(async (input) => {
      const params = input.params as { includeUntrackedFiles?: boolean };
      if (params.includeUntrackedFiles === false) {
        return {
          type: "success",
          source: "unstaged",
          files: [],
          snapshotGeneration: 1,
        };
      }
      return await complete.promise;
    });
    const publications: Array<{ event: { phase?: string; subscriptionId: string } }> = [];
    const registry = new GitLiveQueryRegistry({
      registry: { get: async () => repository },
      execute,
      publish: (event) => publications.push(event as typeof publications[number]),
    });
    const query = {
      method: "review-summary" as const,
      params: {
        cwd: "/repo",
        source: "unstaged" as const,
        includeUntrackedFiles: true,
      },
    };

    await Promise.all([
      registry.subscribe({ subscriptionId: "one", query }),
      registry.subscribe({ subscriptionId: "two", query }),
    ]);
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });

    expect(repository.queryRuns).toBe(2);
    expect(publications.map(({ event }) => event.phase)).toEqual([
      "tracked",
      "tracked",
    ]);

    complete.resolve({
      type: "success",
      source: "unstaged",
      files: [],
      snapshotGeneration: 1,
    });
    await vi.waitFor(() => {
      expect(publications.filter(({ event }) => event.phase === "complete"))
        .toHaveLength(2);
    });
    registry.dispose();
  });

  test("retires old generations and publishes only the refreshed result", async () => {
    vi.useFakeTimers();
    const repository = new FakeLiveRepository();
    const first = deferred<unknown>();
    let run = 0;
    const publications: Array<{ event: { generation: number; phase?: string } }> = [];
    const registry = new GitLiveQueryRegistry({
      registry: { get: async () => repository },
      execute: async () => {
        run += 1;
        if (run === 1) return await first.promise;
        return {
          cwd: "/repo",
          baseRef: "main",
          files: [],
          additions: 2,
          deletions: 1,
          isGitRepository: true,
          currentBranch: "feature",
          defaultBranch: "main",
          errorMessage: null,
        };
      },
      publish: (event) => publications.push(event as typeof publications[number]),
    });
    await registry.subscribe({
      subscriptionId: "branch",
      query: { method: "branch-diff-stats", params: { cwd: "/repo" } },
    });
    repository.change({ changeType: "working-tree", changedPaths: ["/repo/a.ts"] });
    await vi.advanceTimersByTimeAsync(100);
    first.resolve({
      cwd: "/repo",
      baseRef: "main",
      files: [],
      additions: 99,
      deletions: 99,
      isGitRepository: true,
      currentBranch: "feature",
      defaultBranch: "main",
      errorMessage: null,
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(publications).toHaveLength(1);
    expect(publications[0]?.event.generation).toBe(2);
    registry.dispose();
    vi.useRealTimers();
  });
});
