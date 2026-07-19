import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  GitReviewFileSummary,
  GitReviewLiveEvent,
  GitReviewLiveQuery,
  GitReviewSummaryResult,
} from "../shared/types";
import type { FileWatchHost, FileWatchSession } from "./file-watch-host";
import {
  GIT_REVIEW_LIVE_DEBOUNCE_MS,
  GIT_REVIEW_LIVE_ERROR_RETRY_MS,
  shouldRefreshGitReviewLiveQuery,
  subscribeGitReviewLiveQuery,
  subscribeGitReviewSummary,
  type GitReviewLiveSubscriptionDependencies,
  type GitReviewWatchRoots,
} from "./git-review-live-service";
import type {
  GitReviewRepositoryChange,
  GitReviewRepositoryWatcher,
  GitReviewRepositoryWatcherOptions,
} from "./git-review-repository-watcher";

const ROOTS: GitReviewWatchRoots = {
  root: "/repo",
  gitDir: "/repo/.git",
  commonDir: "/repo/.git",
  headPath: "/repo/.git/HEAD",
  indexPath: "/repo/.git/index",
  syncedBranchPath: "/repo/.git/codex-synced-branch.json",
};
const REPOSITORY_IDENTITY = {
  hostId: "local",
  commonDir: ROOTS.commonDir,
  root: ROOTS.root,
} as const;

function buildFile(): GitReviewFileSummary {
  return {
    path: "src/example.ts",
    previousPath: null,
    status: "modified",
    rawStatus: "M",
    oldOid: "a".repeat(40),
    newOid: "b".repeat(40),
    revision: "revision-1",
    additions: 1,
    deletions: 0,
    safety: {
      binary: false,
      tooLarge: false,
      invalidText: false,
      renderable: true,
      skipReason: null,
      sizeBytes: null,
      mimeType: null,
    },
  };
}

function buildSummary(
  snapshotGeneration: number,
  files: GitReviewFileSummary[] = [],
): GitReviewSummaryResult {
  return {
    type: "success",
    source: "unstaged",
    files,
    snapshotGeneration,
    stageCounts: {
      stagedFileCount: 0,
      unstagedFileCount: files.length,
      untrackedFileCount: 0,
    },
  };
}

class FakeRepositoryWatcher implements GitReviewRepositoryWatcher {
  requiresRecovery = false;
  readonly start = vi.fn(async () => {});
  readonly dispose = vi.fn();

  constructor(
    private readonly options: GitReviewRepositoryWatcherOptions,
  ) {}

  emit(
    changeType: GitReviewRepositoryChange,
    changedPaths?: readonly string[],
  ): Promise<void> {
    return Promise.resolve(this.options.onChange({
      changeType,
      ...(changedPaths === undefined ? {} : { changedPaths }),
    }));
  }

  setRequiresRecovery(requiresRecovery: boolean): void {
    this.requiresRecovery = requiresRecovery;
    this.options.onRequiresRecoveryChanged?.(requiresRecovery);
  }
}

function buildHarness(
  readSummary: GitReviewLiveSubscriptionDependencies["readSummary"],
) {
  const watchers: FakeRepositoryWatcher[] = [];
  const host: FileWatchHost = {
    startFileWatch: vi.fn(async () => {
      throw new Error("The live-query test does not start raw file watches.");
    }),
  };
  const dependencies: GitReviewLiveSubscriptionDependencies = {
    readSummary,
    readBranchDiffStats: vi.fn(async (request) => ({
      cwd: request.cwd,
      baseRef: request.baseBranch ?? request.baseRef ?? null,
      files: [],
      additions: 0,
      deletions: 0,
      isGitRepository: true,
      currentBranch: "feature",
      defaultBranch: "main",
      errorMessage: null,
    })),
    readBranchCommits: vi.fn(async (request) => ({
      cwd: request.cwd,
      baseBranch: request.baseBranch ?? "main",
      commits: [],
      errorMessage: null,
    })),
    readBaseBranch: vi.fn(async (request) => ({
      cwd: request.cwd,
      local: "main",
      remote: "origin/main",
      errorMessage: null,
    })),
    resolveWatchRoots: async () => ROOTS,
    fileWatchHost: host,
    createRepositoryWatcher: (options) => {
      const watcher = new FakeRepositoryWatcher(options);
      watchers.push(watcher);
      return watcher;
    },
    filterWorkingTreePaths: vi.fn(async ({ changedPaths }) => ({
      type: "filtered" as const,
      changedPaths: [...changedPaths],
    })),
    invalidateSnapshot: vi.fn(),
    markRepositoryObserved: vi.fn(),
    cancelRequest: vi.fn(),
  };
  return { dependencies, watchers };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function settleInitialRefresh(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(0);
  await flushPromises();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Git review live query", () => {
  test("routes repository changes by live-query method", () => {
    const summaryQuery = {
      method: "review-summary",
      params: { cwd: ROOTS.root, source: "staged" },
    } as const;
    const statsQuery = {
      method: "branch-diff-stats",
      params: { cwd: ROOTS.root },
    } as const;
    const commitsQuery = {
      method: "branch-commits",
      params: { cwd: ROOTS.root },
    } as const;
    const baseBranchQuery = {
      method: "base-branch",
      params: { cwd: ROOTS.root },
    } as const;

    for (const change of [
      "config",
      "head",
      "index",
      "remote-refs",
      "working-tree",
    ] as const) {
      expect(shouldRefreshGitReviewLiveQuery(summaryQuery, change)).toBe(true);
      expect(shouldRefreshGitReviewLiveQuery(statsQuery, change)).toBe(true);
    }
    for (const change of ["config", "head", "remote-refs"] as const) {
      expect(shouldRefreshGitReviewLiveQuery(commitsQuery, change)).toBe(true);
      expect(shouldRefreshGitReviewLiveQuery(baseBranchQuery, change)).toBe(true);
    }
    for (const change of [
      "index",
      "working-tree",
      "synced-branch",
      "worktree-topology",
    ] as const) {
      expect(shouldRefreshGitReviewLiveQuery(commitsQuery, change)).toBe(false);
      expect(shouldRefreshGitReviewLiveQuery(baseBranchQuery, change)).toBe(false);
    }
    for (const change of ["synced-branch", "worktree-topology"] as const) {
      expect(shouldRefreshGitReviewLiveQuery(summaryQuery, change)).toBe(false);
      expect(shouldRefreshGitReviewLiveQuery(statsQuery, change)).toBe(false);
    }
  });

  test("publishes non-summary methods as complete results through one shared watcher", async () => {
    vi.useFakeTimers();
    const events: GitReviewLiveEvent[] = [];
    const harness = buildHarness(vi.fn(async () => buildSummary(1)));
    const subscriptions = [
      subscribeGitReviewLiveQuery(
        {
          subscriptionId: "stats",
          query: {
            method: "branch-diff-stats",
            params: {
              cwd: ROOTS.root,
              baseBranch: "main",
              includeUntrackedFiles: true,
            },
          },
          publish: (event) => events.push(event),
        },
        harness.dependencies,
      ),
      subscribeGitReviewLiveQuery(
        {
          subscriptionId: "commits",
          query: {
            method: "branch-commits",
            params: { cwd: "/repo/src", baseBranch: "main" },
          },
          publish: (event) => events.push(event),
        },
        harness.dependencies,
      ),
      subscribeGitReviewLiveQuery(
        {
          subscriptionId: "base",
          query: { method: "base-branch", params: { cwd: ROOTS.root } },
          publish: (event) => events.push(event),
        },
        harness.dependencies,
      ),
    ];

    await settleInitialRefresh();
    expect(harness.watchers).toHaveLength(1);
    expect(events.map((event) =>
      event.type === "git-live-query-updated"
        ? `${event.method}:${event.phase}`
        : event.type
    ).sort()).toEqual([
      "base-branch:complete",
      "branch-commits:complete",
      "branch-diff-stats:complete",
      "branch-diff-stats:tracked",
    ]);

    const watcher = harness.watchers[0];
    if (!watcher) throw new Error("Missing repository watcher.");
    events.length = 0;
    await watcher.emit("index");
    expect(harness.dependencies.invalidateSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    await flushPromises();
    expect(events.map((event) => event.method)).toEqual([
      "branch-diff-stats",
      "branch-diff-stats",
    ]);

    events.length = 0;
    await watcher.emit("remote-refs");
    expect(harness.dependencies.invalidateSnapshot).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    await flushPromises();
    expect(events.map((event) => event.method).sort()).toEqual([
      "base-branch",
      "branch-commits",
      "branch-diff-stats",
      "branch-diff-stats",
    ]);

    subscriptions.forEach((subscription) => subscription.dispose());
  });

  test("publishes tracked then complete and coalesces semantic events for 100ms", async () => {
    vi.useFakeTimers();
    const events: GitReviewLiveEvent[] = [];
    const readSummary = vi.fn(async (request) =>
      buildSummary(request.includeUntrackedFiles === false ? 1 : 2, [
        buildFile(),
      ]),
    );
    const harness = buildHarness(readSummary);
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "test-live",
        request: { cwd: ROOTS.root, source: "unstaged" },
        publish: (event) => events.push(event),
      },
      harness.dependencies,
    );

    await settleInitialRefresh();
    expect(events.flatMap((event) =>
      event.type === "git-live-query-updated" ? [event.phase] : []
    )).toEqual(["tracked", "complete"]);
    expect(readSummary).toHaveBeenCalledTimes(2);

    const watcher = harness.watchers[0];
    if (!watcher) throw new Error("Missing repository watcher.");
    await watcher.emit("working-tree", ["/repo/src/example.ts"]);
    await watcher.emit("index");
    expect(harness.dependencies.invalidateSnapshot).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS - 1);
    expect(readSummary).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(readSummary).toHaveBeenCalledTimes(4);

    subscription.dispose();
  });

  test("continues to complete after a typed tracked summary error", async () => {
    vi.useFakeTimers();
    const events: GitReviewLiveEvent[] = [];
    const readSummary = vi
      .fn<GitReviewLiveSubscriptionDependencies["readSummary"]>()
      .mockResolvedValueOnce({
        type: "error",
        source: "unstaged",
        errorMessage: "tracked failed",
      })
      .mockResolvedValueOnce(buildSummary(2, [buildFile()]));
    const harness = buildHarness(readSummary);
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "tracked-error-complete-success",
        request: { cwd: ROOTS.root, source: "unstaged" },
        publish: (event) => events.push(event),
      },
      harness.dependencies,
    );

    await settleInitialRefresh();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "git-live-query-updated",
      phase: "complete",
      method: "review-summary",
      result: { type: "success", snapshotGeneration: 2 },
    });
    subscription.dispose();
  });

  test("keeps a non-empty tracked summary when the complete phase is a typed error", async () => {
    vi.useFakeTimers();
    const events: GitReviewLiveEvent[] = [];
    const tracked = buildSummary(1, [buildFile()]);
    const readSummary = vi
      .fn<GitReviewLiveSubscriptionDependencies["readSummary"]>()
      .mockResolvedValueOnce(tracked)
      .mockResolvedValueOnce({
        type: "error",
        source: "unstaged",
        errorMessage: "complete failed",
      });
    const harness = buildHarness(readSummary);
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "tracked-success-complete-error",
        request: { cwd: ROOTS.root, source: "unstaged" },
        publish: (event) => events.push(event),
      },
      harness.dependencies,
    );

    await settleInitialRefresh();
    expect(events.map((event) =>
      event.type === "git-live-query-updated" ? event.phase : event.type
    )).toEqual(["tracked", "complete"]);
    expect(events.at(-1)).toMatchObject({
      type: "git-live-query-updated",
      phase: "complete",
      method: "review-summary",
      result: { type: "success", snapshotGeneration: 1 },
    });
    subscription.dispose();
  });

  test("retries a typed complete summary error three times without publishing a failed event", async () => {
    vi.useFakeTimers();
    const events: GitReviewLiveEvent[] = [];
    const readSummary = vi.fn(async (): Promise<GitReviewSummaryResult> => ({
      type: "error",
      source: "staged",
      errorMessage: "typed summary error",
    }));
    const harness = buildHarness(readSummary);
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "typed-error-retry",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: (event) => events.push(event),
      },
      harness.dependencies,
    );

    await settleInitialRefresh();
    for (let retry = 0; retry < 3; retry += 1) {
      await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_ERROR_RETRY_MS);
      await flushPromises();
    }
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_ERROR_RETRY_MS);
    await flushPromises();

    expect(readSummary).toHaveBeenCalledTimes(4);
    expect(events).toHaveLength(4);
    expect(events.every((event) =>
      event.type === "git-live-query-updated" &&
      event.method === "review-summary" &&
      event.result.type === "error"
    )).toBe(true);
    subscription.dispose();
  });

  test("waits for a new 100ms window after an in-flight query becomes dirty", async () => {
    vi.useFakeTimers();
    const events: GitReviewLiveEvent[] = [];
    const firstRead = deferred<GitReviewSummaryResult>();
    const readSummary = vi
      .fn<GitReviewLiveSubscriptionDependencies["readSummary"]>()
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValue(buildSummary(2));
    const harness = buildHarness(readSummary);
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "test-dirty-in-flight",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: (event) => events.push(event),
      },
      harness.dependencies,
    );

    await settleInitialRefresh();
    expect(readSummary).toHaveBeenCalledTimes(1);
    const watcher = harness.watchers[0];
    if (!watcher) throw new Error("Missing repository watcher.");
    await watcher.emit("working-tree", ["/repo/src/example.ts"]);
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);

    firstRead.resolve(buildSummary(1));
    await flushPromises();
    expect(events).toHaveLength(0);
    expect(readSummary).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS - 1);
    expect(readSummary).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(readSummary).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    expect(events[0]?.generation).toBe(2);

    subscription.dispose();
  });

  test("shares a root-and-host watcher and invalidates once per semantic event", async () => {
    vi.useFakeTimers();
    const readSummary = vi.fn(async () => buildSummary(1));
    const harness = buildHarness(readSummary);
    const first = subscribeGitReviewSummary(
      {
        subscriptionId: "shared-first",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: () => {},
      },
      harness.dependencies,
    );
    const second = subscribeGitReviewSummary(
      {
        subscriptionId: "shared-second",
        request: { cwd: "/repo/src", source: "staged" },
        publish: () => {},
      },
      harness.dependencies,
    );

    await settleInitialRefresh();
    expect(harness.watchers).toHaveLength(1);
    expect(readSummary).toHaveBeenCalledTimes(2);
    expect(harness.dependencies.markRepositoryObserved).toHaveBeenCalledWith(
      ROOTS.root,
      true,
      REPOSITORY_IDENTITY,
    );
    expect(harness.dependencies.markRepositoryObserved).toHaveBeenCalledWith(
      "/repo/src",
      true,
      REPOSITORY_IDENTITY,
    );

    const watcher = harness.watchers[0];
    if (!watcher) throw new Error("Missing repository watcher.");
    await watcher.emit("working-tree", ["/repo/src/example.ts"]);
    expect(harness.dependencies.invalidateSnapshot).toHaveBeenCalledWith(
      ROOTS.root,
      REPOSITORY_IDENTITY,
    );
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    await flushPromises();
    expect(readSummary).toHaveBeenCalledTimes(4);

    first.dispose();
    await flushPromises();
    expect(watcher.dispose).not.toHaveBeenCalled();
    expect(harness.dependencies.markRepositoryObserved).toHaveBeenCalledWith(
      ROOTS.root,
      false,
      REPOSITORY_IDENTITY,
    );
    second.dispose();
    await flushPromises();
    expect(watcher.dispose).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.markRepositoryObserved).toHaveBeenCalledWith(
      "/repo/src",
      false,
      REPOSITORY_IDENTITY,
    );
  });

  test("drops no-op working-tree paths and falls back to a full refresh when filtering fails", async () => {
    vi.useFakeTimers();
    const readSummary = vi.fn(async () => buildSummary(1));
    const harness = buildHarness(readSummary);
    const filterWorkingTreePaths = vi.mocked(
      harness.dependencies.filterWorkingTreePaths,
    );
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "filtered-working-tree-paths",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: () => {},
      },
      harness.dependencies,
    );

    await settleInitialRefresh();
    const watcher = harness.watchers[0];
    if (!watcher) throw new Error("Missing repository watcher.");
    filterWorkingTreePaths.mockResolvedValueOnce({
      type: "filtered",
      changedPaths: [],
    });
    await watcher.emit("working-tree", ["/repo/ignored.log"]);
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    await flushPromises();

    expect(filterWorkingTreePaths).toHaveBeenCalledWith({
      root: ROOTS.root,
      changedPaths: ["/repo/ignored.log"],
    });
    expect(harness.dependencies.invalidateSnapshot).not.toHaveBeenCalled();
    expect(readSummary).toHaveBeenCalledTimes(1);

    filterWorkingTreePaths.mockRejectedValueOnce(new Error("git status failed"));
    await watcher.emit("working-tree", ["/repo/unknown"]);
    expect(harness.dependencies.invalidateSnapshot).toHaveBeenCalledWith(
      ROOTS.root,
      REPOSITORY_IDENTITY,
    );
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    await flushPromises();
    expect(readSummary).toHaveBeenCalledTimes(2);

    subscription.dispose();
  });

  test("does not invalidate or refresh for review-irrelevant semantic changes", async () => {
    vi.useFakeTimers();
    const readSummary = vi.fn(async () => buildSummary(1));
    const harness = buildHarness(readSummary);
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "irrelevant-events",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: () => {},
      },
      harness.dependencies,
    );

    await settleInitialRefresh();
    const watcher = harness.watchers[0];
    if (!watcher) throw new Error("Missing repository watcher.");
    await watcher.emit("synced-branch");
    await watcher.emit("worktree-topology");
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    await flushPromises();

    expect(harness.dependencies.invalidateSnapshot).not.toHaveBeenCalled();
    expect(readSummary).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });

  test("publishes recovery state changes through the next debounced result", async () => {
    vi.useFakeTimers();
    const events: GitReviewLiveEvent[] = [];
    const readSummary = vi.fn(async () => buildSummary(1));
    const harness = buildHarness(readSummary);
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "recovery-state",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: (event) => events.push(event),
      },
      harness.dependencies,
    );

    await settleInitialRefresh();
    const watcher = harness.watchers[0];
    if (!watcher) throw new Error("Missing repository watcher.");
    watcher.setRequiresRecovery(true);
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    await flushPromises();

    expect(events.at(-1)?.requiresRecovery).toBe(true);
    expect(harness.dependencies.invalidateSnapshot).not.toHaveBeenCalled();
    subscription.dispose();
  });

  test.each([
    {
      method: "branch-diff-stats" as const,
      params: { cwd: ROOTS.root },
      dependency: "readBranchDiffStats" as const,
    },
    {
      method: "branch-commits" as const,
      params: { cwd: ROOTS.root },
      dependency: "readBranchCommits" as const,
    },
    {
      method: "base-branch" as const,
      params: { cwd: ROOTS.root },
      dependency: "readBaseBranch" as const,
    },
  ])("cancels an in-flight $method read on dispose", async ({
    method,
    params,
    dependency,
  }) => {
    vi.useFakeTimers();
    const pending = deferred<never>();
    const harness = buildHarness(vi.fn(async () => buildSummary(1)));
    vi.mocked(harness.dependencies[dependency]).mockImplementation(
      () => pending.promise,
    );
    const events: GitReviewLiveEvent[] = [];
    const subscription = subscribeGitReviewLiveQuery(
      {
        subscriptionId: `cancel-${method}`,
        query: { method, params } as GitReviewLiveQuery,
        publish: (event) => events.push(event),
      },
      harness.dependencies,
    );

    await settleInitialRefresh();
    const request = vi.mocked(harness.dependencies[dependency]).mock.calls[0]?.[0];
    expect(request?.requestId).toBe(`cancel-${method}:1:complete`);
    subscription.dispose();
    expect(harness.dependencies.cancelRequest).toHaveBeenCalledWith(
      `cancel-${method}:1:complete`,
    );
    expect(events).toEqual([]);
  });

  test("resolves refresh only after the requested generation settles", async () => {
    vi.useFakeTimers();
    const refreshed = deferred<GitReviewSummaryResult>();
    const readSummary = vi
      .fn<GitReviewLiveSubscriptionDependencies["readSummary"]>()
      .mockResolvedValueOnce(buildSummary(1))
      .mockReturnValueOnce(refreshed.promise);
    const harness = buildHarness(readSummary);
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "await-refresh",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: () => {},
      },
      harness.dependencies,
    );
    await settleInitialRefresh();

    let settled = false;
    const refresh = subscription.refresh().then(() => {
      settled = true;
    });
    await flushPromises();
    expect(readSummary).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);

    refreshed.resolve(buildSummary(2));
    await refresh;
    expect(settled).toBe(true);
    subscription.dispose();
  });

  test("watches for Git initialization and attaches repository watchers after .git appears", async () => {
    vi.useFakeTimers();
    const harness = buildHarness(vi.fn(async () => buildSummary(1)));
    const resolveWatchRoots = vi
      .fn<GitReviewLiveSubscriptionDependencies["resolveWatchRoots"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(ROOTS);
    const emitInit = vi.fn<(changedPaths: readonly string[]) => void>();
    let resolveClosed!: (value: { reason: "disposed" }) => void;
    const closed = new Promise<{ reason: "disposed" }>((resolve) => {
      resolveClosed = resolve;
    });
    const initSession: FileWatchSession = {
      coverage: { recursive: false, typedPathChanges: false },
      path: ROOTS.root,
      closed,
      dispose: vi.fn(async () => resolveClosed({ reason: "disposed" })),
    };
    harness.dependencies.resolveWatchRoots = resolveWatchRoots;
    harness.dependencies.fileWatchHost = {
      startFileWatch: vi.fn(async (input) => {
        emitInit.mockImplementation((changedPaths) => {
          input.onChange({ changedPaths });
        });
        return initSession;
      }),
    };

    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "git-init",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: () => {},
      },
      harness.dependencies,
    );
    await settleInitialRefresh();
    expect(harness.watchers).toHaveLength(0);
    expect(emitInit.getMockImplementation()).toBeTypeOf("function");

    emitInit([`${ROOTS.root}/.git`]);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(resolveWatchRoots).toHaveBeenCalledTimes(2);
    expect(harness.watchers).toHaveLength(1);
    expect(harness.dependencies.markRepositoryObserved).toHaveBeenCalledWith(
      ROOTS.root,
      true,
      REPOSITORY_IDENTITY,
    );
    subscription.dispose();
  });
});
