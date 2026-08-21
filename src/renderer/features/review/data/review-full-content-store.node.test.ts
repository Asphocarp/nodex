import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { buildReviewFileSafety } from "../../../../shared/review-file-safety";
import {
  __resetReviewFullContentStoreForTests,
  loadReviewFullContent,
  readReviewFullContentState,
  type ReviewFullFileContents,
} from "./review-full-content-store";

const FULL_CONTENTS: ReviewFullFileContents = {
  path: "src/example.ts",
  previousPath: null,
  oldText: "old\n",
  newText: "new\n",
  oldExists: true,
  newExists: true,
  oldStatus: "loaded",
  newStatus: "loaded",
  safety: buildReviewFileSafety(),
  errorMessage: null,
};
const FULL_METADATA = {
  name: "src/example.ts",
  isPartial: false,
} as FileDiffMetadata;

beforeEach(() => {
  __resetReviewFullContentStoreForTests();
});

describe("review full content store", () => {
  test("deduplicates the same cell identity and publishes one row-local result", async () => {
    const load = vi.fn(async () => FULL_CONTENTS);
    const input = {
      key: "snapshot-1:src/example.ts",
      identity: "snapshot-1",
      load,
      expand: () => FULL_METADATA,
    };

    await Promise.all([loadReviewFullContent(input), loadReviewFullContent(input)]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(readReviewFullContentState(input.key)).toMatchObject({
      fullDiffMetadata: FULL_METADATA,
      fullContents: FULL_CONTENTS,
      fullContentLoadFailed: false,
      fullContentUnavailable: false,
      isLoadingFullContent: false,
    });
  });

  test("discards an older identity that resolves after a replacement load", async () => {
    let resolveOld!: (contents: ReviewFullFileContents) => void;
    const oldLoad = new Promise<ReviewFullFileContents>((resolve) => {
      resolveOld = resolve;
    });
    const key = "src/example.ts";
    const first = loadReviewFullContent({
      key,
      identity: "snapshot-1",
      load: () => oldLoad,
      expand: () => ({ ...FULL_METADATA, cacheKey: "old" }),
    });
    const second = loadReviewFullContent({
      key,
      identity: "snapshot-2",
      load: async () => FULL_CONTENTS,
      expand: () => ({ ...FULL_METADATA, cacheKey: "new" }),
    });

    await second;
    resolveOld(FULL_CONTENTS);
    await first;

    expect(readReviewFullContentState(key).fullDiffMetadata?.cacheKey).toBe("new");
  });

  test("keeps partial metadata when full content cannot be validated", async () => {
    const key = "snapshot-1:src/mismatch.ts";
    await loadReviewFullContent({
      key,
      identity: "snapshot-1",
      load: async () => FULL_CONTENTS,
      expand: () => null,
    });

    expect(readReviewFullContentState(key)).toMatchObject({
      fullDiffMetadata: null,
      fullContentLoadFailed: false,
      fullContentUnavailable: true,
      isLoadingFullContent: false,
    });
  });
});
