import { afterEach, describe, expect, test, vi } from "vitest";
import type { AsyncSubscription, SubscribeCallback } from "@parcel/watcher";
import type {
  GitReviewLiveSummaryEvent,
  GitReviewFileSummary,
  GitReviewSummaryResult,
} from "../shared/types";
import {
  GIT_REVIEW_LIVE_DEBOUNCE_MS,
  classifyGitReviewRepositoryChange,
  shouldRefreshGitReviewSummary,
  subscribeGitReviewSummary,
  type GitReviewLiveSubscriptionDependencies,
  type GitReviewWatchRoots,
} from "./git-review-live-service";

const ROOTS: GitReviewWatchRoots = {
  root: "/repo",
  gitDir: "/repo/.git",
  commonDir: "/repo/.git",
};

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

function buildDependencies(input: {
  readSummary: GitReviewLiveSubscriptionDependencies["readSummary"];
  callbacks: SubscribeCallback[];
}): GitReviewLiveSubscriptionDependencies {
  return {
    readSummary: input.readSummary,
    resolveWatchRoots: async () => ROOTS,
    watcher: {
      subscribe: async (_directory, callback) => {
        input.callbacks.push(callback);
        return {
          unsubscribe: async () => undefined,
        } satisfies AsyncSubscription;
      },
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
  test("classifies repository changes with the reference invalidation matrix", () => {
    expect(
      classifyGitReviewRepositoryChange(ROOTS, "/repo/src/example.ts"),
    ).toBe("working-tree");
    expect(classifyGitReviewRepositoryChange(ROOTS, "/repo/.git/index")).toBe(
      "index",
    );
    expect(
      classifyGitReviewRepositoryChange(
        ROOTS,
        "/repo/.git/refs/remotes/origin/main",
      ),
    ).toBe("remote-refs");
    expect(
      classifyGitReviewRepositoryChange(ROOTS, "/repo/.git/objects/aa/bb"),
    ).toBeNull();
    expect(shouldRefreshGitReviewSummary("working-tree")).toBe(true);
    expect(shouldRefreshGitReviewSummary("synced-branch")).toBe(false);
    expect(shouldRefreshGitReviewSummary("worktree-topology")).toBe(false);
  });

  test("publishes tracked then complete and coalesces rapid repository events", async () => {
    vi.useFakeTimers();
    const callbacks: SubscribeCallback[] = [];
    const events: GitReviewLiveSummaryEvent[] = [];
    const readSummary = vi.fn(async (request) =>
      buildSummary(request.includeUntrackedFiles === false ? 1 : 2, [
        {
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
        },
      ]),
    );
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "test-live",
        request: { cwd: ROOTS.root, source: "unstaged" },
        publish: (event) => events.push(event),
      },
      buildDependencies({ readSummary, callbacks }),
    );

    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(events.map((event) => event.type)).toEqual([
      "git-live-query-updated",
      "git-live-query-updated",
    ]);
    expect(
      events.flatMap((event) =>
        event.type === "git-live-query-updated" ? [event.phase] : [],
      ),
    ).toEqual(["tracked", "complete"]);

    for (const callback of callbacks) {
      callback(null, [{ type: "update", path: "/repo/src/example.ts" }]);
      callback(null, [{ type: "update", path: "/repo/src/example.ts" }]);
    }
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS - 1);
    expect(readSummary).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(readSummary).toHaveBeenCalledTimes(4);

    subscription.dispose();
  });

  test("marks watcher failures as requiring recovery", async () => {
    vi.useFakeTimers();
    const callbacks: SubscribeCallback[] = [];
    const events: GitReviewLiveSummaryEvent[] = [];
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "test-recovery",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: (event) => events.push(event),
      },
      buildDependencies({
        callbacks,
        readSummary: async () => buildSummary(1),
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    callbacks[0]?.(new Error("watch overflow"), []);
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    await flushPromises();

    expect(events.at(-1)?.requiresRecovery).toBe(true);
    subscription.dispose();
  });

  test("shares one repository watcher hub across live subscriptions", async () => {
    vi.useFakeTimers();
    const callbacks: SubscribeCallback[] = [];
    const readSummary = vi.fn(async () => buildSummary(1));
    const dependencies = buildDependencies({ readSummary, callbacks });
    const first = subscribeGitReviewSummary(
      {
        subscriptionId: "shared-first",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: () => {},
      },
      dependencies,
    );
    const second = subscribeGitReviewSummary(
      {
        subscriptionId: "shared-second",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: () => {},
      },
      dependencies,
    );

    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(callbacks).toHaveLength(2);
    expect(readSummary).toHaveBeenCalledTimes(2);

    for (const callback of callbacks) {
      callback(null, [{ type: "update", path: "/repo/src/example.ts" }]);
    }
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    await flushPromises();
    expect(readSummary).toHaveBeenCalledTimes(4);

    first.dispose();
    callbacks[0]?.(null, [
      { type: "update", path: "/repo/src/example.ts" },
    ]);
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    await flushPromises();
    expect(readSummary).toHaveBeenCalledTimes(5);

    second.dispose();
  });

  test("does not publish an in-flight generation after a repository event", async () => {
    vi.useFakeTimers();
    const callbacks: SubscribeCallback[] = [];
    const events: GitReviewLiveSummaryEvent[] = [];
    const firstRead = deferred<GitReviewSummaryResult>();
    const readSummary = vi
      .fn<GitReviewLiveSubscriptionDependencies["readSummary"]>()
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValue(buildSummary(2));
    const subscription = subscribeGitReviewSummary(
      {
        subscriptionId: "test-stale-live-generation",
        request: { cwd: ROOTS.root, source: "staged" },
        publish: (event) => events.push(event),
      },
      buildDependencies({ readSummary, callbacks }),
    );

    await vi.advanceTimersByTimeAsync(0);
    callbacks[0]?.(null, [{ type: "update", path: "/repo/src/example.ts" }]);
    await vi.advanceTimersByTimeAsync(GIT_REVIEW_LIVE_DEBOUNCE_MS);
    firstRead.resolve(buildSummary(1));
    await flushPromises();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("git-live-query-updated");
    if (events[0]?.type === "git-live-query-updated") {
      expect(events[0].generation).toBe(2);
      expect(events[0].result.type === "success" ? events[0].result.snapshotGeneration : 0).toBe(2);
    }
    subscription.dispose();
  });
});
