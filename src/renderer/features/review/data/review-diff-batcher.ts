import type {
  GitReviewCancelInput,
  ReviewDiffEntry,
  ReviewDiffRequest,
  ReviewDiffResult,
} from "@/lib/types";
import { recordReviewRuntimeEvent } from "@/features/review/testing/review-runtime-probe";

interface ReviewDiffWaiter {
  path: string;
  previousPath: string | null;
  untracked: boolean;
  status: ReviewDiffEntry["status"];
  revision: string | null;
  signal?: AbortSignal;
  resolve: (entry: ReviewDiffEntry | null) => void;
  reject: (error: unknown) => void;
}

interface ReviewDiffBucket {
  request: Omit<ReviewDiffRequest, "files" | "requestId">;
  invoke: (channel: string, input: unknown) => Promise<unknown>;
  waiters: ReviewDiffWaiter[];
}

const REVIEW_DIFF_TIMEOUT_MS = 15_000;
const buckets = new Map<string, ReviewDiffBucket>();
let requestSequence = 0;

function buildAbortError(): DOMException {
  return new DOMException("Review diff request aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isStaleSnapshotError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Git review snapshot changed")
  );
}

function isReviewDiffTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("timed out");
}

function findReviewDiffEntry(
  result: ReviewDiffResult,
  waiter: ReviewDiffWaiter,
): ReviewDiffEntry | null {
  if (result.type === "stale-snapshot") {
    throw new Error("Git review snapshot changed.");
  }
  return (
    result.files.find(
      (entry) =>
        entry.path === waiter.path ||
        entry.previousPath === waiter.path ||
        (waiter.previousPath !== null && entry.path === waiter.previousPath),
    ) ?? null
  );
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function invokeReviewDiffGroup(
  bucket: ReviewDiffBucket,
  waiters: ReviewDiffWaiter[],
): Promise<void> {
  const activeWaiters = waiters.filter((waiter) => !waiter.signal?.aborted);
  for (const waiter of waiters) {
    if (waiter.signal?.aborted) waiter.reject(buildAbortError());
  }
  if (activeWaiters.length === 0) return;

  const requestId = `review-diff-batch:${++requestSequence}`;
  recordReviewRuntimeEvent({
    type: "diff-batch",
    pathCount: activeWaiters.length,
    untracked: activeWaiters.every((waiter) => waiter.untracked),
  });
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const settledWaiters = new Set<ReviewDiffWaiter>();
  let groupCancelled = false;
  const cancelGroup = () => {
    if (groupCancelled) return;
    groupCancelled = true;
    recordReviewRuntimeEvent({ type: "abort", operation: "diff" });
    const cancelInput: GitReviewCancelInput = { requestId };
    void bucket.invoke("git:review:cancel", cancelInput).catch(() => {});
  };
  const rejectWaiter = (waiter: ReviewDiffWaiter, error: unknown) => {
    if (settledWaiters.has(waiter)) return;
    settledWaiters.add(waiter);
    waiter.reject(error);
  };
  const resolveWaiter = (
    waiter: ReviewDiffWaiter,
    entry: ReviewDiffEntry | null,
  ) => {
    if (settledWaiters.has(waiter)) return;
    settledWaiters.add(waiter);
    waiter.resolve(entry);
  };
  const abortListeners = activeWaiters.map((waiter) => {
    const listener = () => {
      rejectWaiter(waiter, buildAbortError());
      if (activeWaiters.every((candidate) => candidate.signal?.aborted)) {
        cancelGroup();
      }
    };
    waiter.signal?.addEventListener("abort", listener, { once: true });
    return { waiter, listener };
  });
  try {
    let result: ReviewDiffResult | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        if (activeWaiters.every((waiter) => waiter.signal?.aborted)) {
          throw buildAbortError();
        }
        result = (await Promise.race([
          bucket.invoke("git:review:diff", {
            ...bucket.request,
            files: activeWaiters.map((waiter) => ({
              path: waiter.path,
              previousPath: waiter.previousPath,
              status: waiter.status,
              revision: waiter.revision,
            })),
            requestId,
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              cancelGroup();
              reject(new Error("Review diff request timed out."));
            }, REVIEW_DIFF_TIMEOUT_MS);
          }),
        ])) as ReviewDiffResult;
        break;
      } catch (error) {
        lastError = error;
        if (
          attempt >= 3 ||
          isAbortError(error) ||
          isReviewDiffTimeoutError(error) ||
          isStaleSnapshotError(error)
        ) {
          throw error;
        }
        await delay(Math.min(300 * 2 ** attempt, 2_000));
      } finally {
        if (timeout !== null) {
          clearTimeout(timeout);
          timeout = null;
        }
      }
    }
    if (!result) throw lastError ?? new Error("Review diff request failed.");
    if (result.type === "stale-snapshot") {
      recordReviewRuntimeEvent({ type: "stale-discard", operation: "diff" });
      throw new Error("Git review snapshot changed.");
    }
    if (
      bucket.request.snapshotGeneration !== undefined &&
      bucket.request.snapshotGeneration !== null &&
      result.snapshotGeneration !== bucket.request.snapshotGeneration
    ) {
      recordReviewRuntimeEvent({ type: "stale-discard", operation: "diff" });
      throw new Error("Git review snapshot changed.");
    }
    for (const waiter of activeWaiters) {
      if (waiter.signal?.aborted) {
        rejectWaiter(waiter, buildAbortError());
        continue;
      }
      resolveWaiter(waiter, findReviewDiffEntry(result, waiter));
    }
  } catch (error) {
    cancelGroup();
    for (const waiter of activeWaiters) rejectWaiter(waiter, error);
  } finally {
    for (const { waiter, listener } of abortListeners) {
      waiter.signal?.removeEventListener("abort", listener);
    }
  }
}

async function flushBucket(key: string, bucket: ReviewDiffBucket) {
  if (buckets.get(key) === bucket) buckets.delete(key);
  const tracked = bucket.waiters.filter((waiter) => !waiter.untracked);
  const untracked = bucket.waiters.filter((waiter) => waiter.untracked);
  await Promise.all([
    invokeReviewDiffGroup(bucket, tracked),
    invokeReviewDiffGroup(bucket, untracked),
  ]);
}

function scheduleBucketFlush(key: string, bucket: ReviewDiffBucket): void {
  queueMicrotask(() => {
    queueMicrotask(() => {
      void flushBucket(key, bucket);
    });
  });
}

export function requestReviewDiffPath(input: {
  bucketKey: string;
  request: Omit<ReviewDiffRequest, "files" | "requestId">;
  path: string;
  previousPath: string | null;
  untracked: boolean;
  status: ReviewDiffEntry["status"];
  revision: string | null;
  signal?: AbortSignal;
  invoke: ReviewDiffBucket["invoke"];
}): Promise<ReviewDiffEntry | null> {
  if (input.signal?.aborted) return Promise.reject(buildAbortError());

  return new Promise((resolve, reject) => {
    const key = JSON.stringify([input.bucketKey, input.request]);
    const waiter: ReviewDiffWaiter = {
      path: input.path,
      previousPath: input.previousPath,
      untracked: input.untracked,
      status: input.status,
      revision: input.revision,
      signal: input.signal,
      resolve,
      reject,
    };
    const existing = buckets.get(key);
    if (existing) {
      existing.waiters.push(waiter);
      return;
    }

    const bucket: ReviewDiffBucket = {
      request: input.request,
      invoke: input.invoke,
      waiters: [waiter],
    };
    buckets.set(key, bucket);
    scheduleBucketFlush(key, bucket);
  });
}

export function __resetReviewDiffBatcherForTests(): void {
  buckets.clear();
}
