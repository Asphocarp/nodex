import type { GitCatFileResult, GitReviewCatFileRequest } from "@/lib/types";
import { recordReviewRuntimeEvent } from "@/features/review/testing/review-runtime-probe";
import type { GitWorkerQueryClient } from "./git-query";
import { StaleReviewSnapshot } from "./review-diff-batcher";

interface ReviewCatFileWaiter {
  requests: GitReviewCatFileRequest[];
  resolve: (results: GitCatFileResult[]) => void;
  reject: (error: unknown) => void;
}

interface ReviewCatFileBucket {
  cwd: string;
  snapshotGeneration: number;
  client: GitWorkerQueryClient;
  waiters: ReviewCatFileWaiter[];
  timer: ReturnType<typeof setTimeout>;
}

const REVIEW_CAT_FILE_BATCH_DELAY_MS = 40;
const REVIEW_CAT_FILE_BATCH_MAX_OBJECTS = 4;
const buckets = new Map<string, ReviewCatFileBucket>();

function takeNextBatch(waiters: ReviewCatFileWaiter[]): ReviewCatFileWaiter[] {
  const batch: ReviewCatFileWaiter[] = [];
  let requestCount = 0;

  while (waiters.length > 0) {
    const candidate = waiters[0];
    if (!candidate) break;
    if (
      batch.length > 0 &&
      requestCount + candidate.requests.length > REVIEW_CAT_FILE_BATCH_MAX_OBJECTS
    ) {
      break;
    }
    waiters.shift();
    batch.push(candidate);
    requestCount += candidate.requests.length;
  }

  return batch;
}

async function flushBucket(key: string, bucket: ReviewCatFileBucket) {
  if (buckets.get(key) === bucket) buckets.delete(key);

  while (bucket.waiters.length > 0) {
    const waiters = takeNextBatch(bucket.waiters);
    const requests = waiters.flatMap((waiter) => waiter.requests);
    recordReviewRuntimeEvent({
      type: "cat-file-batch",
      objectCount: requests.length,
    });
    try {
      const result = await bucket.client.request({
        method: "review-cat-file",
        params: {
          cwd: bucket.cwd,
          snapshotGeneration: bucket.snapshotGeneration,
          requests,
        },
      });
      if (result.type === "stale-snapshot") throw new StaleReviewSnapshot();
      const output = result.value;
      if (output.snapshotGeneration !== bucket.snapshotGeneration) {
        throw new StaleReviewSnapshot();
      }
      let resultOffset = 0;
      for (const waiter of waiters) {
        const results = output.results.slice(resultOffset, resultOffset + waiter.requests.length);
        resultOffset += waiter.requests.length;
        waiter.resolve(results);
      }
    } catch (error) {
      for (const waiter of waiters) waiter.reject(error);
    }
  }
}

export function requestReviewCatFile(input: {
  bucketKey: string;
  cwd: string;
  snapshotGeneration: number;
  requests: GitReviewCatFileRequest[];
  client: GitWorkerQueryClient;
}): Promise<GitCatFileResult[]> {
  return new Promise((resolve, reject) => {
    const key = JSON.stringify([input.bucketKey, input.cwd, input.snapshotGeneration]);
    const waiter = { requests: input.requests, resolve, reject };
    const existing = buckets.get(key);
    if (existing) {
      existing.waiters.push(waiter);
      return;
    }

    const bucket: ReviewCatFileBucket = {
      cwd: input.cwd,
      snapshotGeneration: input.snapshotGeneration,
      client: input.client,
      waiters: [waiter],
      timer: setTimeout(() => {
        void flushBucket(key, bucket);
      }, REVIEW_CAT_FILE_BATCH_DELAY_MS),
    };
    buckets.set(key, bucket);
  });
}

export function __resetReviewCatFileBatcherForTests(): void {
  for (const bucket of buckets.values()) clearTimeout(bucket.timer);
  buckets.clear();
}
