import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildReviewFileSafety } from "../../../../shared/review-file-safety";
import type { ReviewDiffRequest, ReviewDiffResult } from "@/lib/types";
import {
  __resetReviewDiffBatcherForTests,
  requestReviewDiffPath,
  StaleReviewSnapshot,
} from "./review-diff-batcher";
import type { GitWorkerQueryClient } from "./git-query";

function createWorkerClient(
  request: (input: ReviewDiffRequest) => Promise<ReviewDiffResult>,
  onAbort: () => void = () => undefined,
): GitWorkerQueryClient {
  return {
    request: async (input) => {
      input.signal?.addEventListener("abort", onAbort, { once: true });
      return (await request(input.params as ReviewDiffRequest)) as never;
    },
    subscribe: () => () => undefined,
  };
}

beforeEach(() => {
  __resetReviewDiffBatcherForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("review diff batcher", () => {
  test("double-microtask coalesces paths into separate tracked and untracked requests", async () => {
    const workerRequest = vi.fn(async (input: ReviewDiffRequest) => {
      const result: ReviewDiffResult = {
        type: "success",
        cwd: input.cwd,
        source: input.source,
        patch: "",
        files: (input.files ?? []).map((requestFile) => ({
          path: requestFile.path,
          previousPath: null,
          status: requestFile.status,
          rawStatus: null,
          oldOid: "old",
          newOid: "new",
          revision: requestFile.revision ?? requestFile.path,
          additions: 1,
          deletions: 0,
          safety: buildReviewFileSafety(),
          diff: `diff --git a/${requestFile.path} b/${requestFile.path}`,
          loadStatus: "loaded",
          renderKey: requestFile.path,
          diffBytes: 1,
          diffError: null,
          canApplyPatchActions: true,
          changedBytes: 1,
          tooLarge: false,
          tooLargeReason: null,
        })),
        isGitRepository: true,
        baseRef: null,
        currentBranch: "feature",
        defaultBranch: "main",
        errorMessage: null,
        snapshotGeneration: 3,
      };
      return result;
    });
    const request = {
      cwd: "/repo",
      source: "unstaged" as const,
      snapshotGeneration: 3,
    };

    const results = await Promise.all([
      requestReviewDiffPath({
        bucketKey: "snapshot-3",
        request,
        path: "tracked-a.ts",
        previousPath: null,
        untracked: false,
        status: "modified",
        revision: "tracked-a",
        client: createWorkerClient(workerRequest),
      }),
      requestReviewDiffPath({
        bucketKey: "snapshot-3",
        request,
        path: "tracked-b.ts",
        previousPath: null,
        untracked: false,
        status: "modified",
        revision: "tracked-b",
        client: createWorkerClient(workerRequest),
      }),
      requestReviewDiffPath({
        bucketKey: "snapshot-3",
        request,
        path: "untracked.ts",
        previousPath: null,
        untracked: true,
        status: "untracked",
        revision: "untracked",
        client: createWorkerClient(workerRequest),
      }),
    ]);

    const diffCalls = workerRequest.mock.calls;
    expect(diffCalls).toHaveLength(2);
    expect(diffCalls.map(([input]) => input.files)).toEqual([
      [
        {
          path: "tracked-a.ts",
          previousPath: null,
          status: "modified",
          revision: "tracked-a",
        },
        {
          path: "tracked-b.ts",
          previousPath: null,
          status: "modified",
          revision: "tracked-b",
        },
      ],
      [
        {
          path: "untracked.ts",
          previousPath: null,
          status: "untracked",
          revision: "untracked",
        },
      ],
    ]);
    expect(results.map((entry) => entry?.path)).toEqual([
      "tracked-a.ts",
      "tracked-b.ts",
      "untracked.ts",
    ]);
  });

  test("rejects only an aborted path and cancels main when the whole group is empty", async () => {
    let resolveDiff!: (result: ReviewDiffResult) => void;
    const workerRequest = vi.fn(async (input: ReviewDiffRequest) => {
      return new Promise<ReviewDiffResult>((resolve) => {
        resolveDiff = resolve;
      }).then((result) => ({ ...result, source: input.source }));
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const request = {
      cwd: "/repo",
      source: "unstaged" as const,
      snapshotGeneration: 3,
    };
    let workerAborts = 0;
    const workerClient = createWorkerClient(workerRequest, () => {
      workerAborts += 1;
    });
    const first = requestReviewDiffPath({
      bucketKey: "snapshot-3",
      request,
      path: "first.ts",
      previousPath: null,
      untracked: false,
      status: "modified",
      revision: "first",
      signal: firstController.signal,
      client: workerClient,
    });
    const second = requestReviewDiffPath({
      bucketKey: "snapshot-3",
      request,
      path: "second.ts",
      previousPath: null,
      untracked: false,
      status: "modified",
      revision: "second",
      signal: secondController.signal,
      client: workerClient,
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(workerAborts).toBe(0);

    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(workerAborts).toBe(1);

    resolveDiff({
      type: "success",
      cwd: "/repo",
      source: "unstaged",
      patch: "",
      files: [],
      isGitRepository: true,
      baseRef: null,
      currentBranch: "main",
      defaultBranch: "main",
      errorMessage: null,
      snapshotGeneration: 3,
    });
  });

  test("does not retry stale snapshot failures", async () => {
    const workerRequest = vi.fn(async () => {
      return { type: "stale-snapshot" as const, source: "unstaged" as const };
    });

    await expect(
      requestReviewDiffPath({
        bucketKey: "snapshot-2",
        request: {
          cwd: "/repo",
          source: "unstaged",
          snapshotGeneration: 2,
        },
        path: "stale.ts",
        previousPath: null,
        untracked: false,
        status: "modified",
        revision: "stale",
        client: createWorkerClient(workerRequest),
      }),
    ).rejects.toBeInstanceOf(StaleReviewSnapshot);

    expect(workerRequest.mock.calls).toHaveLength(1);
  });

  test("cancels the main request when a group reaches the fifteen second timeout", async () => {
    vi.useFakeTimers();
    const workerRequest = vi.fn(() => {
      return new Promise<never>(() => {});
    });
    let workerAborts = 0;
    const result = requestReviewDiffPath({
      bucketKey: "snapshot-timeout",
      request: {
        cwd: "/repo",
        source: "unstaged",
        snapshotGeneration: 3,
      },
      path: "slow.ts",
      previousPath: null,
      untracked: false,
      status: "modified",
      revision: "slow",
      client: createWorkerClient(workerRequest, () => {
        workerAborts += 1;
      }),
    });
    const rejection = expect(result).rejects.toThrow("timed out");
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(workerAborts).toBe(1);
    expect(workerRequest.mock.calls).toHaveLength(1);
  });
});
