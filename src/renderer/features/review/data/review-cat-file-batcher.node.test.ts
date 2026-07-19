import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  GitReviewCatFileInput,
  GitReviewCatFileOutput,
} from "@/lib/types";
import {
  __resetReviewCatFileBatcherForTests,
  requestReviewCatFile,
} from "./review-cat-file-batcher";

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
    const invoke = vi.fn(
      async (
        _channel: "git:review:cat-file",
        input: GitReviewCatFileInput,
      ): Promise<GitReviewCatFileOutput> => ({
        snapshotGeneration: input.snapshotGeneration,
        results: input.requests.map((request) => ({
          type: "success" as const,
          lines: [`${request.path}\n`],
        })),
      }),
    );
    const requestRow = (path: string) =>
      requestReviewCatFile({
        bucketKey: "local",
        cwd: "/repo",
        snapshotGeneration: 7,
        requests: [
          { oid: `${path}:old`, path },
          { oid: `${path}:new`, path },
        ],
        invoke,
      });

    const rows = [requestRow("a"), requestRow("b"), requestRow("c")];
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);
    const results = await Promise.all(rows);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0]?.[1].requests).toHaveLength(4);
    expect(invoke.mock.calls[1]?.[1].requests).toHaveLength(2);
    expect(results[2]?.map((result) => result.type)).toEqual([
      "success",
      "success",
    ]);
  });
});
