import { QueryClientProvider } from "@tanstack/react-query";
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { buildReviewFileSafety } from "../../../../shared/review-file-safety";
import { render } from "../../../test/dom";
import { createTestQueryClient } from "../../../test/query";
import type {
  GitReviewFileSummary,
  GitReviewSnapshot,
  ReviewDiffRequest,
  ReviewDiffResult,
} from "../../../lib/types";
import { __resetReviewDiffBatcherForTests } from "./review-diff-batcher";
import type { GitWorkerQueryClient } from "./git-query";
import { useReviewPathDiffs } from "./use-review-path-diffs";

function buildSummary(path: string, revision = `revision:${path}`): GitReviewFileSummary {
  return {
    path,
    previousPath: null,
    status: "modified",
    rawStatus: null,
    oldOid: "old",
    newOid: "new",
    revision,
    additions: 1,
    deletions: 0,
    safety: buildReviewFileSafety(),
  };
}

function buildSnapshot(
  snapshotGeneration: number,
  files: GitReviewFileSummary[],
): GitReviewSnapshot {
  return {
    cwd: "/repo",
    source: "unstaged",
    patch: "",
    files,
    isGitRepository: true,
    baseRef: null,
    currentBranch: "feature",
    defaultBranch: "main",
    errorMessage: null,
    snapshotGeneration,
  };
}

function buildDiffResult(input: ReviewDiffRequest): ReviewDiffResult {
  return {
    type: "success",
    cwd: input.cwd,
    source: input.source,
    patch: "",
    files: (input.files ?? []).map((file) => ({
      ...buildSummary(file.path, file.revision ?? `revision:${file.path}`),
      previousPath: file.previousPath ?? null,
      status: file.status,
      diff: `diff --git a/${file.path} b/${file.path}`,
      loadStatus: "loaded",
      renderKey: file.revision ?? file.path,
      diffBytes: 40,
      diffError: null,
      canApplyPatchActions: true,
      changedBytes: 40,
      tooLarge: false,
      tooLargeReason: null,
    })),
    isGitRepository: true,
    baseRef: null,
    currentBranch: "feature",
    defaultBranch: "main",
    errorMessage: null,
    snapshotGeneration: input.snapshotGeneration,
  };
}

function ReviewPathDiffProbe({
  snapshot,
  workerRequest,
  onStaleSnapshot,
}: {
  snapshot: GitReviewSnapshot;
  workerRequest: (input: ReviewDiffRequest) => Promise<ReviewDiffResult>;
  onStaleSnapshot: () => void;
}) {
  const workerClient = {
    request: async (input: { params: unknown }) =>
      await workerRequest(input.params as ReviewDiffRequest),
    subscribe: () => () => undefined,
  } as GitWorkerQueryClient;
  const states = useReviewPathDiffs({
    commitSha: null,
    commonDir: "/repo/.git",
    enabled: true,
    hideWhitespace: false,
    client: workerClient,
    onStaleSnapshot,
    root: "/repo",
    snapshot,
  });

  return <div data-loaded-count={[...states.values()].filter((state) => state.data).length} />;
}

beforeEach(() => {
  __resetReviewDiffBatcherForTests();
});

describe("useReviewPathDiffs", () => {
  test("reuses a path diff when only snapshot generation changes", async () => {
    const client = createTestQueryClient();
    const workerRequest = vi.fn(async (input: ReviewDiffRequest) => {
      return buildDiffResult(input);
    });
    const onStaleSnapshot = vi.fn();
    const summary = buildSummary("src/stable.ts");
    const view = render(
      <QueryClientProvider client={client}>
        <ReviewPathDiffProbe
          snapshot={buildSnapshot(1, [summary])}
          workerRequest={workerRequest}
          onStaleSnapshot={onStaleSnapshot}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(view.container.firstElementChild?.getAttribute("data-loaded-count")).toBe("1");
    });
    expect(workerRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <QueryClientProvider client={client}>
          <ReviewPathDiffProbe
            snapshot={buildSnapshot(2, [{ ...summary }])}
            workerRequest={workerRequest}
            onStaleSnapshot={onStaleSnapshot}
          />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    expect(view.container.firstElementChild?.getAttribute("data-loaded-count")).toBe("1");
    expect(workerRequest).toHaveBeenCalledTimes(1);
    expect(onStaleSnapshot).not.toHaveBeenCalled();
  });

  test("coalesces stale recovery across sibling paths once per generation", async () => {
    const client = createTestQueryClient();
    const workerRequest = vi.fn(async (input: ReviewDiffRequest) => {
      return {
        type: "stale-snapshot",
        source: input.source,
      } satisfies ReviewDiffResult;
    });
    const onStaleSnapshot = vi.fn();
    const firstFiles = [buildSummary("src/a.ts"), buildSummary("src/b.ts")];
    const view = render(
      <QueryClientProvider client={client}>
        <ReviewPathDiffProbe
          snapshot={buildSnapshot(1, firstFiles)}
          workerRequest={workerRequest}
          onStaleSnapshot={onStaleSnapshot}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(onStaleSnapshot).toHaveBeenCalledTimes(1));
    expect(workerRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <QueryClientProvider client={client}>
          <ReviewPathDiffProbe
            snapshot={buildSnapshot(
              2,
              firstFiles.map((file) => ({ ...file })),
            )}
            workerRequest={workerRequest}
            onStaleSnapshot={onStaleSnapshot}
          />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(onStaleSnapshot).toHaveBeenCalledTimes(2));
    expect(workerRequest).toHaveBeenCalledTimes(2);
  });

  test("loads stable tracked and untracked initial groups separately", async () => {
    const client = createTestQueryClient();
    const workerRequest = vi.fn(async (input: ReviewDiffRequest) => {
      return buildDiffResult(input);
    });
    const tracked = buildSummary("src/tracked.ts");
    const untracked = {
      ...buildSummary("src/untracked.ts"),
      status: "untracked" as const,
    };
    const view = render(
      <QueryClientProvider client={client}>
        <ReviewPathDiffProbe
          snapshot={buildSnapshot(1, [tracked, untracked])}
          workerRequest={workerRequest}
          onStaleSnapshot={() => {}}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(view.container.firstElementChild?.getAttribute("data-loaded-count")).toBe("2");
    });
    const requests = workerRequest.mock.calls.map(([input]) => input);
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.files?.map((file) => file.path))).toEqual([
      ["src/tracked.ts"],
      ["src/untracked.ts"],
    ]);
  });

  test("falls back only for an entry missing from the initial group", async () => {
    const client = createTestQueryClient();
    let diffRequestCount = 0;
    const workerRequest = vi.fn(async (request: ReviewDiffRequest) => {
      diffRequestCount += 1;
      const result = buildDiffResult(request);
      if (result.type !== "success" || diffRequestCount !== 1) return result;
      return {
        ...result,
        files: result.files.filter((file) => file.path === "src/a.ts"),
      } satisfies ReviewDiffResult;
    });
    const view = render(
      <QueryClientProvider client={client}>
        <ReviewPathDiffProbe
          snapshot={buildSnapshot(1, [buildSummary("src/a.ts"), buildSummary("src/b.ts")])}
          workerRequest={workerRequest}
          onStaleSnapshot={() => {}}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(view.container.firstElementChild?.getAttribute("data-loaded-count")).toBe("2");
    });
    const requests = workerRequest.mock.calls.map(([input]) => input);
    expect(requests.map((request) => request.files?.map((file) => file.path))).toEqual([
      ["src/a.ts", "src/b.ts"],
      ["src/b.ts"],
    ]);
  });
});
