import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  GitWorkerMessageForView,
  GitWorkerMethod,
  GitWorkerMethodMap,
} from "../../../../shared/git-worker-protocol";
import {
  buildGitWorkerQueryKey,
  createGitLiveWorkerQuery,
  GitLiveQueryCoordinator,
  type GitWorkerQueryClient,
} from "./git-query";

class FakeGitWorkerClient implements GitWorkerQueryClient {
  readonly requests: Array<{ method: GitWorkerMethod; params: unknown }> = [];
  readonly #listeners = new Set<(message: GitWorkerMessageForView) => void>();

  async request<Method extends GitWorkerMethod>(input: {
    method: Method;
    params: GitWorkerMethodMap[Method]["params"];
    signal?: AbortSignal;
  }): Promise<GitWorkerMethodMap[Method]["result"]> {
    this.requests.push({ method: input.method, params: input.params });
    const value =
      input.method === "subscribe-live-query"
        ? { subscribed: true }
        : input.method === "unsubscribe-live-query"
          ? { unsubscribed: true }
          : input.method === "recover-live-query"
            ? { recovered: true }
            : input.method === "refresh-live-query"
              ? { refreshed: true }
              : {
                  cwd: "/repo",
                  baseRef: "main",
                  files: [],
                  additions: 0,
                  deletions: 0,
                  isGitRepository: true,
                  currentBranch: "feature",
                  defaultBranch: "main",
                  errorMessage: null,
                };
    return value as GitWorkerMethodMap[Method]["result"];
  }

  subscribe(listener: (message: GitWorkerMessageForView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(message: GitWorkerMessageForView): void {
    for (const listener of this.#listeners) listener(message);
  }
}

function subscriptionId(client: FakeGitWorkerClient): string {
  const request = client.requests.find((candidate) => candidate.method === "subscribe-live-query");
  if (!request) throw new Error("Expected a live query subscription");
  return (request.params as { subscriptionId: string }).subscriptionId;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Git query adapter", () => {
  test("normalizes transient request fields out of repository query keys", () => {
    const repository = {
      hostId: "local" as const,
      commonDir: "/repo/.git",
      root: "/repo",
    };
    const first = buildGitWorkerQueryKey({
      method: "review-summary",
      params: { cwd: "/alias", source: "unstaged", requestId: "one" },
      repository,
    });
    const second = buildGitWorkerQueryKey({
      method: "review-summary",
      params: { cwd: "/alias", source: "unstaged", requestId: "two" },
      repository,
    });

    expect(first).toEqual(second);
  });

  test("shares one worker subscription for active observers and delays release", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const workerClient = new FakeGitWorkerClient();
    const coordinator = new GitLiveQueryCoordinator(queryClient, workerClient);
    const options = createGitLiveWorkerQuery(
      {
        method: "branch-diff-stats",
        params: { cwd: "/repo" },
        repository: {
          hostId: "local",
          commonDir: "/repo/.git",
          root: "/repo",
        },
      },
      workerClient,
    );
    const first = new QueryObserver(queryClient, options);
    const second = new QueryObserver(queryClient, options);
    const releaseFirst = first.subscribe(() => undefined);
    const releaseSecond = second.subscribe(() => undefined);
    await Promise.resolve();

    expect(
      workerClient.requests.filter((request) => request.method === "subscribe-live-query"),
    ).toHaveLength(1);

    releaseFirst();
    releaseSecond();
    await vi.advanceTimersByTimeAsync(249);
    expect(
      workerClient.requests.some((request) => request.method === "unsubscribe-live-query"),
    ).toBe(false);

    const remounted = new QueryObserver(queryClient, options);
    const releaseRemounted = remounted.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      workerClient.requests.filter((request) => request.method === "subscribe-live-query"),
    ).toHaveLength(1);

    releaseRemounted();
    await vi.advanceTimersByTimeAsync(250);
    expect(
      workerClient.requests.filter((request) => request.method === "unsubscribe-live-query"),
    ).toHaveLength(1);
    coordinator.dispose();
  });

  test("publishes exact query data and resubscribes active queries after restart", async () => {
    const queryClient = new QueryClient();
    const workerClient = new FakeGitWorkerClient();
    const coordinator = new GitLiveQueryCoordinator(queryClient, workerClient);
    const options = createGitLiveWorkerQuery(
      {
        method: "branch-diff-stats",
        params: { cwd: "/repo" },
      },
      workerClient,
    );
    const observer = new QueryObserver(queryClient, options);
    const release = observer.subscribe(() => undefined);
    await Promise.resolve();
    const result = {
      cwd: "/repo",
      baseRef: "main",
      files: [],
      fileCount: 0,
      additions: 7,
      deletions: 3,
      untrackedFilesOmitted: 0,
      isGitRepository: true,
      currentBranch: "feature",
      defaultBranch: "main",
      errorMessage: null,
    };
    workerClient.emit({
      type: "git-live-query-event",
      workerId: "git",
      event: {
        type: "git-live-query-updated",
        subscriptionId: subscriptionId(workerClient),
        generation: 2,
        requiresRecovery: false,
        phase: "complete",
        method: "branch-diff-stats",
        result,
      },
    });

    expect(queryClient.getQueryData(options.queryKey)).toEqual(result);
    workerClient.emit({
      type: "worker-restarted",
      workerId: "git",
      epoch: 2,
    });
    expect(
      workerClient.requests.filter((request) => request.method === "subscribe-live-query"),
    ).toHaveLength(2);

    release();
    coordinator.dispose();
  });
});
