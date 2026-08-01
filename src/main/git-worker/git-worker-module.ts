import type { GitStatusSummaryResult } from "../../shared/git-review";
import type {
  GitBranchMetadataResult,
  GitReviewRepositoryMetadataResult,
} from "../../shared/types";
import type {
  GitWorkerLiveQueryEvent,
  GitWorkerMethod,
  GitWorkerMethodMap,
  GitWorkerPerformanceOperationEvent,
  GitWorkerRequest,
} from "../../shared/git-worker-protocol";
import {
  GIT_WORKER_PROTOCOL_VERSION,
} from "../../shared/git-worker-protocol";
import {
  applyGitReviewPatch,
  isGitReviewStaleSnapshotError,
  readBranchDiffStats,
  readGitReviewBaseBranch,
  readGitReviewBlameFile,
  readGitReviewBranchCommits,
  readGitReviewCatFile,
  readGitReviewDiff,
  readGitReviewPatch,
  readGitReviewSnapshot,
  readGitReviewSummary,
  resolveGitMergeBase,
  runGitReviewOperationWithSignal,
  searchGitReview,
} from "./git-review-operations";
import {
  LocalGitCommandRunner,
  runGitPerformanceOperation,
} from "./git-command-runner";
import { GitLiveQueryRegistry } from "./live-query-registry";
import { GitRepositoryRegistry } from "./repository-registry";
import type { WorktreeRepository } from "./worktree-repository";

function commandErrorMessage(
  stderr: string,
  fallback: string,
): string {
  return stderr.trim() || fallback;
}

function parseTrackedStatusCounts(status: string): {
  stagedCount: number;
  unstagedCount: number;
} {
  let stagedCount = 0;
  let unstagedCount = 0;
  for (const record of status.split("\0")) {
    if (record.length < 3) continue;
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    if (indexStatus && indexStatus !== " " && indexStatus !== "?") {
      stagedCount += 1;
    }
    if (worktreeStatus && worktreeStatus !== " " && worktreeStatus !== "?") {
      unstagedCount += 1;
    }
  }
  return { stagedCount, unstagedCount };
}

function normalizeGitWorkerQueryParams(params: unknown): unknown {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const normalized = { ...params } as Record<string, unknown>;
  delete normalized.requestId;
  delete normalized.operationSource;
  return normalized;
}

const GIT_MUTATION_METHODS = new Set<GitWorkerMethod>([
  "apply-patch",
  "checkout-branch",
  "commit",
  "create-branch",
  "git-init-repo",
  "refresh-repository",
]);

function classifyGitWorkerOperationOutcome(
  result: unknown,
): import("../../shared/git-worker-protocol").GitPerformanceOperationOutcome {
  if (!result || typeof result !== "object") return "success";
  if ("type" in result && result.type === "stale-snapshot") return "stale";
  if ("type" in result && result.type === "error") {
    if (
      "failureReason" in result
      && (result.failureReason === "timed-out" || result.failureReason === "timed_out")
    ) return "timed-out";
    if ("failureReason" in result && result.failureReason === "canceled") {
      return "canceled";
    }
    return "operational-error";
  }
  if ("status" in result && result.status === "error") {
    return "operational-error";
  }
  return "success";
}

export class GitWorkerModule {
  readonly #registry: GitRepositoryRegistry;
  readonly #publish: (
    event: GitWorkerLiveQueryEvent | GitWorkerPerformanceOperationEvent,
  ) => void;
  readonly #liveQueries: GitLiveQueryRegistry;

  constructor(options: {
    publish?: (
      event: GitWorkerLiveQueryEvent | GitWorkerPerformanceOperationEvent,
    ) => void;
    registry?: GitRepositoryRegistry;
  } = {}) {
    this.#registry = options.registry
      ?? new GitRepositoryRegistry(new LocalGitCommandRunner());
    this.#publish = options.publish ?? (() => undefined);
    this.#liveQueries = new GitLiveQueryRegistry({
      registry: this.#registry,
      publish: this.#publish,
      execute: async (input) => await this.execute({
        id: input.id,
        method: input.method,
        params: input.params,
        enqueuedAtMs: Date.now(),
      } as GitWorkerRequest["request"], input.signal),
    });
  }

  async execute(
    request: GitWorkerRequest["request"],
    signal: AbortSignal,
  ): Promise<unknown> {
    const trigger = /:(?:tracked|complete)$/.test(request.id)
      ? "live"
      : GIT_MUTATION_METHODS.has(request.method)
        ? "mutation"
        : "direct";
    return await runGitPerformanceOperation({
      operation: request.method,
      trigger,
      classifyOutcome: classifyGitWorkerOperationOutcome,
      publish: (metric) => this.#publish({
        type: "git-performance-operation",
        workerId: "git",
        metric,
      }),
      run: async () => await this.#executeRequest(request, signal),
    });
  }

  async #executeRequest(
    request: GitWorkerRequest["request"],
    signal: AbortSignal,
  ): Promise<unknown> {
    switch (request.method) {
      case "probe":
        return {
          nonce: request.params.nonce,
          protocolVersion: GIT_WORKER_PROTOCOL_VERSION,
        };
      case "stable-metadata":
        return await this.#readStableMetadata(request.params.cwd, signal);
      case "branch-metadata":
        return await this.#readBranchMetadata(request.params.cwd, signal);
      case "status-summary":
        return await this.#readStatusSummary(
          request.params.cwd,
          request.params.includeUntrackedFiles === true,
          signal,
        );
      case "action-status":
        return await this.#readActionStatus(request.params.cwd, signal);
      case "review-summary":
        return await this.#runReviewRequest({
          method: request.method,
          params: request.params,
          signal,
          cwd: request.params.cwd,
          source: request.params.source,
          operation: async (operationSignal, repository) => {
            const includeUntracked = request.params.includeUntrackedFiles !== false
              && (request.params.source === "unstaged" || request.params.source === "branch");
            const [untracked, status] = repository
              ? await Promise.all([
                includeUntracked
                  ? repository.untrackedPaths.read(operationSignal)
                  : Promise.resolve(null),
                this.#readStatusSummary(
                  repository.identity.root,
                  includeUntracked,
                  operationSignal,
                ),
              ])
              : [null, null];
            return await readGitReviewSummary({
              ...request.params,
              requestId: request.id,
              ...(includeUntracked && repository
                ? {
                  precomputedUntrackedPaths: untracked?.success
                    ? untracked.paths
                    : null,
                  untrackedFilesOmitted: untracked?.omittedCount ?? 0,
                }
                : {}),
              ...(repository
                ? {
                  precomputedStageCounts: status?.type === "success"
                    ? {
                      stagedFileCount: status.stagedCount,
                      unstagedFileCount: status.unstagedCount,
                      untrackedFileCount: status.untrackedCount ?? 0,
                    }
                    : null,
                }
                : {}),
            });
          },
        });
      case "branch-diff-stats":
        return await this.#runReviewRequest({
          method: request.method,
          params: request.params,
          signal,
          cwd: request.params.cwd,
          source: "branch",
          operation: async (operationSignal, repository) => {
            const includeUntracked = request.params.includeUntrackedFiles === true;
            const untracked = includeUntracked && repository
              ? await repository.untrackedPaths.read(operationSignal)
              : null;
            return await readBranchDiffStats({
              ...request.params,
              requestId: request.id,
              ...(includeUntracked && repository
                ? {
                  precomputedUntrackedPaths: untracked?.success
                    ? untracked.paths
                    : null,
                  untrackedFilesOmitted: untracked?.omittedCount ?? 0,
                }
                : {}),
            });
          },
        });
      case "review-diff":
        return await this.#runReviewRequest({
          method: request.method,
          params: request.params,
          signal,
          cwd: request.params.cwd,
          source: request.params.source,
          operation: async () => await readGitReviewDiff({
            ...request.params,
            requestId: request.id,
          }),
        });
      case "review-cat-file": {
        const repository = await this.#registry.get(request.params.cwd, signal);
        signal.throwIfAborted();
        const result = await runGitReviewOperationWithSignal(
          signal,
          async () => await readGitReviewCatFile(request.params),
          repository ?? undefined,
        );
        signal.throwIfAborted();
        return { type: "success", value: result } satisfies GitWorkerMethodMap["review-cat-file"]["result"];
      }
      case "review-search":
        return await this.#runReviewRequest({
          method: request.method,
          params: request.params,
          signal,
          cwd: request.params.cwd,
          source: request.params.source,
          operation: async () => await searchGitReview({
            ...request.params,
            requestId: request.id,
          }),
        });
      case "review-patch":
        return await this.#runReviewRequest({
          method: request.method,
          params: request.params,
          signal,
          cwd: request.params.cwd,
          source: request.params.source,
          operation: async () => await readGitReviewPatch({
            ...request.params,
            requestId: request.id,
          }),
        });
      case "blame-file": {
        const repository = await this.#registry.get(request.params.cwd, signal);
        signal.throwIfAborted();
        return await runGitReviewOperationWithSignal(
          signal,
          async () => await readGitReviewBlameFile(request.params),
          repository ?? undefined,
        );
      }
      case "base-branch":
        return await this.#runReviewRequest({
          method: request.method,
          params: request.params,
          signal,
          cwd: request.params.cwd,
          source: "branch",
          operation: async () => await readGitReviewBaseBranch({
            ...request.params,
            requestId: request.id,
          }),
        });
      case "branch-commits":
        return await this.#runReviewRequest({
          method: request.method,
          params: request.params,
          signal,
          cwd: request.params.cwd,
          source: "branch",
          operation: async () => await readGitReviewBranchCommits({
            ...request.params,
            requestId: request.id,
          }),
        });
      case "merge-base": {
        const repository = await this.#registry.get(request.params.cwd, signal);
        signal.throwIfAborted();
        return await runGitReviewOperationWithSignal(
          signal,
          async () => await resolveGitMergeBase(request.params),
          repository ?? undefined,
        );
      }
      case "refresh-repository": {
        const repository = await this.#registry.get(request.params.cwd, signal);
        if (!repository) {
          return { type: "error", failureReason: "not-a-repository" };
        }
        return {
          type: "success",
          generation: await repository.invalidateGitReadCachesForRepoChange(
            "head",
          ),
        };
      }
      case "git-init-repo": {
        const repository = await this.#registry.initialize(
          request.params.cwd,
          signal,
        );
        if (!repository) {
          return {
            cwd: request.params.cwd,
            source: "unstaged",
            patch: "",
            files: [],
            isGitRepository: false,
            baseRef: null,
            currentBranch: null,
            defaultBranch: null,
            errorMessage: "Could not initialize Git repository.",
            snapshotGeneration: 0,
          };
        }
        await repository.invalidateGitReadCachesForRepoChange("head");
        return await runGitReviewOperationWithSignal(
          signal,
          async () => await readGitReviewSnapshot({
            cwd: repository.identity.root,
            source: "unstaged",
          }),
          repository,
        );
      }
      case "apply-patch": {
        const repository = await this.#registry.get(request.params.cwd, signal);
        signal.throwIfAborted();
        const result = await runGitReviewOperationWithSignal(
          signal,
          async () => await applyGitReviewPatch(request.params),
          repository ?? undefined,
        );
        if (result.status !== "error") {
          await repository?.invalidateGitReadCachesForRepoChange(
            request.params.target === "staged" ? "index" : "working-tree",
          );
        }
        return result;
      }
      case "checkout-branch":
        return await this.#mutateBranch(
          request.params.cwd,
          request.params.branch,
          false,
          signal,
        );
      case "create-branch":
        return await this.#mutateBranch(
          request.params.cwd,
          request.params.branch,
          true,
          signal,
        );
      case "commit":
        return await this.#commit(request.params, signal);
      case "subscribe-live-query": {
        await this.#liveQueries.subscribe(request.params);
        return { subscribed: true };
      }
      case "unsubscribe-live-query": {
        return {
          unsubscribed: this.#liveQueries.unsubscribe(
            request.params.subscriptionId,
          ),
        };
      }
      case "recover-live-query": {
        return {
          recovered: await this.#liveQueries.recover(
            request.params.subscriptionId,
          ),
        };
      }
      case "refresh-live-query": {
        return {
          refreshed: await this.#liveQueries.refresh(
            request.params.subscriptionId,
          ),
        };
      }
    }
  }

  dispose(): void {
    this.#liveQueries.dispose();
    this.#registry.dispose();
  }

  async #runReviewRequest<Result>(input: {
    method: GitWorkerMethod;
    params: unknown;
    signal: AbortSignal;
    cwd: string;
    source: import("../../shared/types").GitReviewSource;
    operation: (
      signal: AbortSignal,
      repository: WorktreeRepository | null,
    ) => Promise<Result>;
  },
  ): Promise<Result | import("../../shared/git-review").GitReviewStaleSnapshotResult> {
    const repository = await this.#registry.get(input.cwd, input.signal);
    if (!repository) {
      return await runGitReviewOperationWithSignal(
        input.signal,
        async () => await input.operation(input.signal, null),
      );
    }
    input.signal.throwIfAborted();
    return await repository.query({
      key: [
        "review-operation",
        input.method,
        normalizeGitWorkerQueryParams(input.params),
        repository.generation,
      ],
      meta: {
        gitReadDomains: ["config", "head", "index", "local-refs", "remote-refs", "working-tree"],
        gitReadGeneration: repository.generation,
      },
      signal: input.signal,
      staleTime: 0,
      run: async (sharedSignal) => {
        try {
          return await runGitReviewOperationWithSignal(
            sharedSignal,
            async () => await input.operation(sharedSignal, repository),
            repository,
          );
        } catch (error) {
          if (sharedSignal.aborted) throw sharedSignal.reason;
          if (isGitReviewStaleSnapshotError(error)) {
            return { type: "stale-snapshot", source: input.source };
          }
          throw error;
        }
      },
    });
  }

  async #readStableMetadata(
    cwd: string,
    signal: AbortSignal,
  ): Promise<GitReviewRepositoryMetadataResult> {
    const repository = await this.#registry.get(cwd, signal);
    if (!repository) {
      return {
        cwd,
        root: null,
        gitDir: null,
        commonDir: null,
        isGitRepository: false,
        currentBranch: null,
        defaultBranch: null,
        errorMessage: null,
      };
    }
    return await repository.query({
      key: ["stable-metadata", repository.identity.root],
      meta: {
        gitReadDomains: ["config", "head", "local-refs", "remote-refs"],
      },
      signal,
      run: async (querySignal) => await this.#loadStableMetadata(
        repository,
        cwd,
        querySignal,
      ),
    });
  }

  async #loadStableMetadata(
    repository: WorktreeRepository,
    cwd: string,
    signal: AbortSignal,
  ): Promise<GitReviewRepositoryMetadataResult> {
    const [currentResult, branchesResult, defaultResult] = await Promise.all([
      repository.runGit(["branch", "--show-current"], { signal }),
      repository.runGit(["branch", "--format=%(refname:short)"], { signal }),
      repository.runGit(
        ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        { allowedNonZeroExitCodes: [1, 128], signal },
      ),
    ]);
    signal.throwIfAborted();
    if (!currentResult.success || !branchesResult.success || !defaultResult.success) {
      const failure = [currentResult, branchesResult, defaultResult]
        .find((result) => !result.success);
      return {
        cwd,
        root: repository.identity.root,
        gitDir: repository.identity.gitDir,
        commonDir: repository.identity.commonDir,
        isGitRepository: true,
        currentBranch: null,
        defaultBranch: null,
        errorMessage: commandErrorMessage(
          failure?.stderr ?? "",
          "Could not read Git repository metadata.",
        ),
      };
    }
    const currentBranch = currentResult.stdout.trim() || null;
    const branches = branchesResult.stdout
      .split(/\r?\n/)
      .map((branch) => branch.trim())
      .filter(Boolean);
    const remoteDefault = defaultResult.stdout.trim();
    const defaultBranch = remoteDefault.startsWith("origin/")
      ? remoteDefault.slice("origin/".length)
      : remoteDefault || (branches.includes("main")
        ? "main"
        : branches.includes("master")
          ? "master"
          : currentBranch);
    return {
      cwd,
      root: repository.identity.root,
      gitDir: repository.identity.gitDir,
      commonDir: repository.identity.commonDir,
      isGitRepository: true,
      currentBranch,
      defaultBranch,
      errorMessage: null,
    };
  }

  async #readBranchMetadata(
    cwd: string,
    signal: AbortSignal,
  ): Promise<GitBranchMetadataResult> {
    const repository = await this.#registry.get(cwd, signal);
    if (!repository) {
      return { currentBranch: null, defaultBranch: null, branches: [] };
    }
    return await repository.query({
      key: ["branch-metadata", repository.generation],
      meta: {
        gitReadDomains: ["config", "head", "local-refs", "remote-refs"],
        gitReadGeneration: repository.generation,
      },
      signal,
      run: async (querySignal) => {
        const [current, branchList, remoteDefault] = await Promise.all([
          repository.runGit(["branch", "--show-current"], { signal: querySignal }),
          repository.runGit(["branch", "--format=%(refname:short)"], { signal: querySignal }),
          repository.runGit(
            ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
            { allowedNonZeroExitCodes: [1, 128], signal: querySignal },
          ),
        ]);
        if (!current.success || !branchList.success || !remoteDefault.success) {
          return { currentBranch: null, defaultBranch: null, branches: [] };
        }
        const currentBranch = current.stdout.trim() || null;
        const branches = [...new Set(
          branchList.stdout.split(/\r?\n/).map((branch) => branch.trim()).filter(Boolean),
        )];
        const remoteDefaultBranch = remoteDefault.stdout.trim();
        const defaultBranch = remoteDefaultBranch.startsWith("origin/")
          ? remoteDefaultBranch.slice("origin/".length)
          : remoteDefaultBranch || (branches.includes("main")
            ? "main"
            : branches.includes("master")
              ? "master"
              : currentBranch);
        return { currentBranch, defaultBranch, branches };
      },
    });
  }

  async #readStatusSummary(
    cwd: string,
    includeUntrackedFiles: boolean,
    signal: AbortSignal,
  ): Promise<GitStatusSummaryResult> {
    const repository = await this.#registry.get(cwd, signal);
    if (!repository) {
      return {
        type: "error",
        failureReason: "not-a-repository",
        errorMessage: null,
      };
    }
    return await repository.query({
      key: [
        "status-summary",
        includeUntrackedFiles ? "complete" : "tracked",
        repository.generation,
      ],
      meta: {
        gitReadDomains: ["index", "working-tree"],
        gitReadGeneration: repository.generation,
      },
      signal,
      staleTime: 0,
      run: async (querySignal) => {
        const configOverrides = await repository
          .readSafeAttributeFilterOverrides(querySignal)
          .catch(() => null);
        if (!configOverrides) {
          return {
            type: "error",
            failureReason: "status-config",
            errorMessage: "Could not read Git status configuration.",
          } satisfies GitStatusSummaryResult;
        }
        const result = await repository.runGit(
          [
            "status",
            "--no-renames",
            "--porcelain=v1",
            "-z",
            "--untracked-files=no",
          ],
          { configOverrides, signal: querySignal },
        );
        if (!result.success) {
          return {
            type: "error",
            failureReason: result.failureReason === "timed_out"
              ? "timed-out"
              : result.failureReason === "canceled"
                ? "canceled"
                : "status-command",
            errorMessage: commandErrorMessage(
              result.stderr,
              "Could not read Git status.",
            ),
          } satisfies GitStatusSummaryResult;
        }
        const counts = parseTrackedStatusCounts(result.stdout);
        if (!includeUntrackedFiles) {
          return {
            type: "success",
            ...counts,
            untrackedCount: null,
            snapshotGeneration: repository.generation,
          } satisfies GitStatusSummaryResult;
        }
        const untracked = await repository.untrackedPaths.read(querySignal);
        if (!untracked.success) {
          return {
            type: "error",
            failureReason: "untracked-paths",
            errorMessage: "Could not read untracked Git paths.",
          } satisfies GitStatusSummaryResult;
        }
        return {
          type: "success",
          ...counts,
          untrackedCount: untracked.paths.length + untracked.omittedCount,
          snapshotGeneration: repository.generation,
        } satisfies GitStatusSummaryResult;
      },
    });
  }

  async #mutateBranch(
    cwd: string,
    rawBranch: string,
    create: boolean,
    signal: AbortSignal,
  ): Promise<GitWorkerMethodMap["checkout-branch"]["result"]> {
    const repository = await this.#registry.get(cwd, signal);
    if (!repository) {
      return { type: "error", errorMessage: "Git repository is required." };
    }
    const branch = rawBranch.trim();
    const validation = await repository.runGit(
      ["check-ref-format", "--branch", branch],
      { signal },
    );
    if (!validation.success) {
      return { type: "error", errorMessage: "Branch name is invalid." };
    }
    const result = await repository.runGit(
      create ? ["checkout", "-b", branch] : ["checkout", branch],
      { timeoutMs: null, signal },
    );
    if (!result.success) {
      return {
        type: "error",
        errorMessage: commandErrorMessage(
          result.stderr,
          create ? "Could not create branch." : "Could not switch branch.",
        ),
      };
    }
    await repository.invalidateGitReadCachesForRepoChange("head");
    return {
      type: "success",
      value: await this.#readBranchMetadata(repository.identity.root, signal),
    };
  }

  async #readActionStatus(
    cwd: string,
    signal: AbortSignal,
  ): Promise<import("../../shared/types").GitActionStatusResult> {
    const repository = await this.#registry.get(cwd, signal);
    const empty = (errorMessage: string | null = null) => ({
      cwd,
      isGitRepository: false,
      currentBranch: null,
      defaultBranch: null,
      upstreamBranch: null,
      remotes: [],
      hasHeadCommit: false,
      hasStagedChanges: false,
      hasUnstagedChanges: false,
      hasUntrackedFiles: false,
      hasUncommittedChanges: false,
      commitsAhead: 0,
      canCommit: false,
      canPush: false,
      pushNeedsUpstream: false,
      errorMessage,
    });
    if (!repository) return empty();
    return await repository.query({
      key: ["action-status", repository.generation],
      meta: {
        gitReadDomains: ["config", "head", "index", "local-refs", "remote-refs", "working-tree"],
        gitReadGeneration: repository.generation,
      },
      signal,
      run: async (querySignal) => {
        const [branches, head, staged, unstaged, remotes, upstream, untracked] =
          await Promise.all([
            this.#readBranchMetadata(repository.identity.root, querySignal),
            repository.runGit(["rev-parse", "--verify", "HEAD"], {
              allowedNonZeroExitCodes: [128],
              signal: querySignal,
            }),
            repository.runGit(["diff", "--quiet", "--cached"], {
              allowedNonZeroExitCodes: [1],
              signal: querySignal,
            }),
            repository.runGit(["diff", "--quiet"], {
              allowedNonZeroExitCodes: [1],
              signal: querySignal,
            }),
            repository.runGit(["remote"], { signal: querySignal }),
            repository.runGit(
              ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
              { allowedNonZeroExitCodes: [128], signal: querySignal },
            ),
            repository.untrackedPaths.read(querySignal),
          ]);
        const required = [head, staged, unstaged, remotes, upstream];
        if (required.some((result) => !result.success) || !untracked.success) {
          return {
            ...empty("Could not read Git action status."),
            cwd: repository.identity.root,
          };
        }
        const hasHeadCommit = head.code === 0;
        const hasStagedChanges = staged.code === 1;
        const hasUntrackedFiles = untracked.paths.length + untracked.omittedCount > 0;
        const hasUnstagedChanges = unstaged.code === 1 || hasUntrackedFiles;
        const upstreamBranch = upstream.code === 0
          ? upstream.stdout.trim() || null
          : null;
        const remoteNames = remotes.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
        const ahead = upstreamBranch
          ? await repository.runGit(
            ["rev-list", "--count", `${upstreamBranch}..HEAD`],
            { allowedNonZeroExitCodes: [128], signal: querySignal },
          )
          : null;
        const commitsAhead = Number.parseInt(ahead?.stdout.trim() ?? "0", 10) || 0;
        const hasUncommittedChanges = hasStagedChanges || hasUnstagedChanges;
        const pushNeedsUpstream = hasHeadCommit
          && branches.currentBranch !== null
          && upstreamBranch === null;
        const canPush = hasHeadCommit
          && branches.currentBranch !== null
          && (upstreamBranch !== null
            ? commitsAhead > 0
            : remoteNames.includes("origin"));
        return {
          cwd: repository.identity.root,
          isGitRepository: true,
          currentBranch: branches.currentBranch,
          defaultBranch: branches.defaultBranch,
          upstreamBranch,
          remotes: remoteNames,
          hasHeadCommit,
          hasStagedChanges,
          hasUnstagedChanges,
          hasUntrackedFiles,
          hasUncommittedChanges,
          commitsAhead,
          canCommit: hasUncommittedChanges,
          canPush,
          pushNeedsUpstream,
          errorMessage: null,
        };
      },
    });
  }

  async #commit(
    input: import("../../shared/types").GitCommitInput,
    signal: AbortSignal,
  ): Promise<import("../../shared/types").GitActionMutationResult> {
    const repository = await this.#registry.get(input.cwd, signal);
    if (!repository) {
      return {
        cwd: input.cwd,
        status: "error",
        branch: null,
        stdout: "",
        stderr: "",
        errorMessage: "Git repository is required before committing.",
      };
    }
    const branches = await this.#readBranchMetadata(repository.identity.root, signal);
    if (input.includeUnstaged !== false) {
      const add = await repository.runGit(["add", "-A"], {
        timeoutMs: null,
        signal,
      });
      if (!add.success) {
        return {
          cwd: repository.identity.root,
          status: "error",
          branch: branches.currentBranch,
          stdout: add.stdout,
          stderr: add.stderr,
          errorMessage: commandErrorMessage(add.stderr, "Could not stage changes."),
        };
      }
    }
    const staged = await repository.runGit(["diff", "--quiet", "--cached"], {
      allowedNonZeroExitCodes: [1],
      signal,
    });
    if (!staged.success || staged.code !== 1) {
      return {
        cwd: repository.identity.root,
        status: "error",
        branch: branches.currentBranch,
        stdout: staged.stdout,
        stderr: staged.stderr,
        errorMessage: staged.success
          ? "No staged changes to commit."
          : commandErrorMessage(staged.stderr, "Could not inspect staged changes."),
      };
    }
    const commit = await repository.runGit(
      ["commit", "-m", input.message.trim()],
      { timeoutMs: null, signal },
    );
    if (!commit.success) {
      return {
        cwd: repository.identity.root,
        status: "error",
        branch: branches.currentBranch,
        stdout: commit.stdout,
        stderr: commit.stderr,
        errorMessage: commandErrorMessage(commit.stderr, "Could not commit changes."),
      };
    }
    await repository.invalidateGitReadCachesForRepoChange("head");
    return {
      cwd: repository.identity.root,
      status: "success",
      branch: branches.currentBranch,
      stdout: commit.stdout,
      stderr: commit.stderr,
      errorMessage: null,
    };
  }
}
