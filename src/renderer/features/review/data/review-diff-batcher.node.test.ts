import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildReviewFileSafety } from "../../../../shared/review-file-safety";
import type { ReviewDiffRequest, ReviewDiffResult } from "@/lib/types";
import {
  __resetReviewDiffBatcherForTests,
  requestReviewDiffPath,
} from "./review-diff-batcher";

beforeEach(() => {
  __resetReviewDiffBatcherForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("review diff batcher", () => {
  test("double-microtask coalesces paths into separate tracked and untracked requests", async () => {
    const invoke = vi.fn(async (channel: string, rawInput: unknown) => {
      if (channel !== "git:review:diff") return { cancelled: false };
      const input = rawInput as ReviewDiffRequest;
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
        invoke,
      }),
      requestReviewDiffPath({
        bucketKey: "snapshot-3",
        request,
        path: "tracked-b.ts",
        previousPath: null,
        untracked: false,
        status: "modified",
        revision: "tracked-b",
        invoke,
      }),
      requestReviewDiffPath({
        bucketKey: "snapshot-3",
        request,
        path: "untracked.ts",
        previousPath: null,
        untracked: true,
        status: "untracked",
        revision: "untracked",
        invoke,
      }),
    ]);

    const diffCalls = invoke.mock.calls.filter(
      ([channel]) => channel === "git:review:diff",
    );
    expect(diffCalls).toHaveLength(2);
    expect(
      diffCalls.map(([, input]) => (input as ReviewDiffRequest).files),
    ).toEqual([
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
    const invoke = vi.fn(async (channel: string, rawInput: unknown) => {
      if (channel === "git:review:cancel") return { cancelled: true };
      const input = rawInput as ReviewDiffRequest;
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
    const first = requestReviewDiffPath({
      bucketKey: "snapshot-3",
      request,
      path: "first.ts",
      previousPath: null,
      untracked: false,
      status: "modified",
      revision: "first",
      signal: firstController.signal,
      invoke,
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
      invoke,
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(
      invoke.mock.calls.filter(([channel]) => channel === "git:review:cancel"),
    ).toHaveLength(0);

    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(
      invoke.mock.calls.filter(([channel]) => channel === "git:review:cancel"),
    ).toHaveLength(1);

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
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "git:review:cancel") return { cancelled: true };
      throw new Error("Git review snapshot changed (2 -> 3).");
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
        invoke,
      }),
    ).rejects.toThrow("snapshot changed");

    expect(
      invoke.mock.calls.filter(([channel]) => channel === "git:review:diff"),
    ).toHaveLength(1);
  });

  test("cancels the main request when a group reaches the fifteen second timeout", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn((channel: string) => {
      if (channel === "git:review:cancel") {
        return Promise.resolve({ cancelled: true });
      }
      return new Promise<never>(() => {});
    });
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
      invoke,
    });
    const rejection = expect(result).rejects.toThrow("timed out");
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(
      invoke.mock.calls.filter(([channel]) => channel === "git:review:cancel"),
    ).toHaveLength(1);
    expect(
      invoke.mock.calls.filter(([channel]) => channel === "git:review:diff"),
    ).toHaveLength(1);
  });
});
