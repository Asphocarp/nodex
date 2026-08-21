import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GitReviewCatFileInput, GitReviewCatFileOutput } from "@/lib/types";
import {
  __resetReviewCatFileBatcherForTests,
  requestReviewCatFile,
} from "./review-cat-file-batcher";
import type { GitWorkerQueryClient } from "./git-query";

beforeEach(() => {
  vi.useFakeTimers();
  __resetReviewCatFileBatcherForTests();
});

afterEach(() => {
  __resetReviewCatFileBatcherForTests();
  vi.useRealTimers();
});

describe("review cat-file batcher", () => {
  test("waits 40ms and packs complete row requests into four-object batches", async () => {
    const workerRequest = vi.fn(
      async (input: GitReviewCatFileInput): Promise<GitReviewCatFileOutput> => ({
        snapshotGeneration: input.snapshotGeneration,
        results: input.requests.map((request) => ({
          type: "success" as const,
          lines: [`${request.path}\n`],
        })),
      }),
    );
    const client = {
      request: async (input: { params: GitReviewCatFileInput }) => ({
        type: "success",
        value: await workerRequest(input.params),
      }),
      subscribe: () => () => undefined,
    } as GitWorkerQueryClient;
    const requestRow = (path: string) =>
      requestReviewCatFile({
        bucketKey: "local",
        cwd: "/repo",
        snapshotGeneration: 7,
        requests: [
          { oid: `${path}:old`, path },
          { oid: `${path}:new`, path },
        ],
        client,
      });

    const rows = [requestRow("a"), requestRow("b"), requestRow("c")];
    expect(workerRequest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);
    const results = await Promise.all(rows);

    expect(workerRequest).toHaveBeenCalledTimes(2);
    expect(workerRequest.mock.calls[0]?.[0].requests).toHaveLength(4);
    expect(workerRequest.mock.calls[1]?.[0].requests).toHaveLength(2);
    expect(results[2]?.map((result) => result.type)).toEqual(["success", "success"]);
  });
});
