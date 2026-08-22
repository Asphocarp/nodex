import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, test, vi } from "vite-plus/test";
import type { GitReviewRepositoryChangedEvent } from "./repository-watcher";
import {
  GIT_LIVE_QUERY_DEBOUNCE_MS,
  makeGitLiveQueryRegistry,
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
  watchReleases = 0;
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
        this.watchReleases += 1;
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
    if (existing) return (await existing) as Result;
    this.queryRuns += 1;
    const controller = new AbortController();
    const abort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", abort, { once: true });
    const promise = input.run(controller.signal).finally(() => {
      input.signal?.removeEventListener("abort", abort);
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
    expect(shouldRefreshGitLiveQuery("review-summary", "working-tree")).toBe(true);
    expect(shouldRefreshGitLiveQuery("branch-diff-stats", "index")).toBe(true);
    expect(shouldRefreshGitLiveQuery("base-branch", "working-tree")).toBe(false);
    expect(shouldRefreshGitLiveQuery("branch-commits", "remote-refs")).toBe(true);
  });

  it.effect("coalesces identical subscriptions and publishes tracked before complete", () =>
    Effect.gen(function* () {
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
      const registry = yield* makeGitLiveQueryRegistry({
        registry: { get: async () => repository },
        execute,
        publish: (event) => publications.push(event as (typeof publications)[number]),
      });
      const query = {
        method: "review-summary" as const,
        params: {
          cwd: "/repo",
          source: "unstaged" as const,
          includeUntrackedFiles: true,
        },
      };

      yield* Effect.promise(() =>
        Promise.all([
          registry.subscribe({ subscriptionId: "one", query }),
          registry.subscribe({ subscriptionId: "two", query }),
        ]),
      );
      yield* Effect.promise(() => vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2)));

      expect(repository.queryRuns).toBe(2);
      expect(publications.map(({ event }) => event.phase)).toEqual(["tracked", "tracked"]);

      complete.resolve({
        type: "success",
        source: "unstaged",
        files: [],
        snapshotGeneration: 1,
      });
      yield* Effect.promise(() =>
        vi.waitFor(() => {
          expect(publications.filter(({ event }) => event.phase === "complete")).toHaveLength(2);
        }),
      );
    }),
  );

  it.effect("retires old generations and publishes only the refreshed result", () =>
    Effect.gen(function* () {
      const repository = new FakeLiveRepository();
      const first = deferred<unknown>();
      let run = 0;
      const publications: Array<{ event: { generation: number; phase?: string } }> = [];
      const registry = yield* makeGitLiveQueryRegistry({
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
        publish: (event) => publications.push(event as (typeof publications)[number]),
      });
      yield* Effect.promise(() =>
        registry.subscribe({
          subscriptionId: "branch",
          query: { method: "branch-diff-stats", params: { cwd: "/repo" } },
        }),
      );
      repository.change({ changeType: "working-tree", changedPaths: ["/repo/a.ts"] });
      yield* TestClock.adjust(GIT_LIVE_QUERY_DEBOUNCE_MS);
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
      yield* Effect.promise(() => Promise.resolve());

      expect(publications).toHaveLength(1);
      expect(publications[0]?.event.generation).toBe(2);
    }),
  );

  it.effect("interrupts active refreshes and releases watch leases with its Scope", () =>
    Effect.gen(function* () {
      const repository = new FakeLiveRepository();
      const parentScope = yield* Scope.Scope;
      const registryScope = yield* Scope.fork(parentScope);
      let refreshAborted = false;
      const registry = yield* makeGitLiveQueryRegistry({
        registry: { get: async () => repository },
        execute: async ({ signal }) =>
          await new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                refreshAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
        publish: () => undefined,
      }).pipe(Scope.provide(registryScope));
      yield* Effect.promise(() =>
        registry.subscribe({
          subscriptionId: "branch",
          query: { method: "base-branch", params: { cwd: "/repo" } },
        }),
      );
      yield* Effect.promise(() => vi.waitFor(() => expect(repository.queryRuns).toBe(1)));

      yield* Scope.close(registryScope, Exit.void);

      expect(refreshAborted).toBe(true);
      expect(repository.watchReleases).toBe(1);
      expect(registry.unsubscribe("branch")).toBe(false);
      yield* Effect.promise(() =>
        expect(
          registry.subscribe({
            subscriptionId: "late",
            query: { method: "base-branch", params: { cwd: "/repo" } },
          }),
        ).rejects.toThrow("closed"),
      );
    }),
  );
});
