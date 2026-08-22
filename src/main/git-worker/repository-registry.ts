import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Scope from "effect/Scope";
import { GitReviewRuntime, type GitReviewRepositoryPaths } from "./git-review-operations";
import type { GitCommandRunner, GitRepositoryExecutionIdentity } from "./git-command-runner";
import { makeWorktreeRepository, type WorktreeRepository } from "./worktree-repository";

function cwdKey(hostId: string, cwd: string): string {
  return JSON.stringify([hostId, path.resolve(cwd)]);
}

function repositoryKey(identity: GitReviewRepositoryPaths): string {
  return JSON.stringify([identity.hostId, identity.commonDir, identity.root]);
}

export interface GitRepositoryRegistry {
  get(cwd: string, signal?: AbortSignal): Promise<WorktreeRepository | null>;
  initialize(cwd: string, signal?: AbortSignal): Promise<WorktreeRepository | null>;
}

class GitRepositoryRegistryState implements GitRepositoryRegistry {
  readonly #runner: GitCommandRunner;
  readonly #reviewRuntime: GitReviewRuntime;
  readonly #makeRepository: (
    identity: GitReviewRepositoryPaths & { hostId: "local" },
  ) => Promise<WorktreeRepository>;
  readonly #repositories = new Map<string, WorktreeRepository>();
  readonly #repositoryKeysByCwd = new Map<string, string>();
  readonly #discoveries = new Map<string, Promise<WorktreeRepository | null>>();
  readonly #repositoryCreations = new Map<string, Promise<WorktreeRepository>>();
  readonly #generationProviderCleanups = new Map<string, () => void>();
  #closed = false;

  constructor(options: {
    makeRepository: (
      identity: GitReviewRepositoryPaths & { hostId: "local" },
    ) => Promise<WorktreeRepository>;
    reviewRuntime: GitReviewRuntime;
    runner: GitCommandRunner;
  }) {
    this.#makeRepository = options.makeRepository;
    this.#reviewRuntime = options.reviewRuntime;
    this.#runner = options.runner;
  }

  async get(cwd: string, signal?: AbortSignal): Promise<WorktreeRepository | null> {
    if (this.#closed) throw new Error("Git repository registry is closed");
    signal?.throwIfAborted();
    const normalizedCwd = path.resolve(cwd.trim());
    const entry = await stat(normalizedCwd).catch(() => null);
    signal?.throwIfAborted();
    if (!entry?.isDirectory()) return null;
    const key = cwdKey("local", normalizedCwd);
    const registeredKey = this.#repositoryKeysByCwd.get(key);
    if (registeredKey) return this.#repositories.get(registeredKey) ?? null;
    const existing = this.#discoveries.get(key);
    if (existing) return await existing;
    const discovery = this.#discover(normalizedCwd, signal);
    this.#discoveries.set(key, discovery);
    try {
      return await discovery;
    } finally {
      if (this.#discoveries.get(key) === discovery) this.#discoveries.delete(key);
    }
  }

  async initialize(cwd: string, signal?: AbortSignal): Promise<WorktreeRepository | null> {
    if (this.#closed) throw new Error("Git repository registry is closed");
    const normalizedCwd = path.resolve(cwd.trim());
    const entry = await stat(normalizedCwd).catch(() => null);
    if (!entry?.isDirectory()) return null;
    const provisional: GitRepositoryExecutionIdentity = {
      hostId: "local",
      commonDir: normalizedCwd,
      root: normalizedCwd,
    };
    let result = await this.#runner.run(provisional, ["init", "-b", "main"], { signal });
    if (!result.success) result = await this.#runner.run(provisional, ["init"], { signal });
    if (!result.success) return null;
    return await this.get(normalizedCwd, signal);
  }

  release(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const cleanup of this.#generationProviderCleanups.values()) cleanup();
    this.#repositories.clear();
    this.#repositoryKeysByCwd.clear();
    this.#discoveries.clear();
    this.#repositoryCreations.clear();
    this.#generationProviderCleanups.clear();
  }

  async #discover(cwd: string, signal?: AbortSignal): Promise<WorktreeRepository | null> {
    const provisional: GitRepositoryExecutionIdentity = {
      hostId: "local",
      commonDir: cwd,
      root: cwd,
    };
    const rootResult = await this.#runner.run(provisional, ["rev-parse", "--show-toplevel"], {
      allowedNonZeroExitCodes: [128],
      signal,
    });
    signal?.throwIfAborted();
    if (!rootResult.success || rootResult.code !== 0 || !rootResult.stdout.trim()) return null;
    const root = await realpath(path.resolve(cwd, rootResult.stdout.trim()));
    const rootIdentity: GitRepositoryExecutionIdentity = {
      hostId: "local",
      commonDir: root,
      root,
    };
    const [gitDirResult, commonDirResult] = await Promise.all([
      this.#runner.run(rootIdentity, ["rev-parse", "--git-dir"], { signal }),
      this.#runner.run(rootIdentity, ["rev-parse", "--git-common-dir"], { signal }),
    ]);
    signal?.throwIfAborted();
    if (!gitDirResult.success || !commonDirResult.success) return null;
    const [gitDir, commonDir] = await Promise.all([
      realpath(path.resolve(root, gitDirResult.stdout.trim())),
      realpath(path.resolve(root, commonDirResult.stdout.trim())),
    ]);
    const identity: GitReviewRepositoryPaths & { hostId: "local" } = {
      hostId: "local",
      root,
      gitDir,
      commonDir,
    };
    if (this.#closed) throw new Error("Git repository registry is closed");
    const key = repositoryKey(identity);
    let repository = this.#repositories.get(key);
    if (!repository) {
      let creation = this.#repositoryCreations.get(key);
      if (!creation) {
        creation = this.#makeRepository(identity);
        this.#repositoryCreations.set(key, creation);
      }
      try {
        repository = await creation;
      } finally {
        if (this.#repositoryCreations.get(key) === creation) {
          this.#repositoryCreations.delete(key);
        }
      }
      if (this.#closed) throw new Error("Git repository registry is closed");
      const existing = this.#repositories.get(key);
      if (existing) {
        repository = existing;
      } else {
        this.#repositories.set(key, repository);
        const ownedRepository = repository;
        this.#generationProviderCleanups.set(
          key,
          this.#reviewRuntime.registerSnapshotGenerationProvider(identity, {
            advance: () => ownedRepository.advanceGeneration(),
            current: () => ownedRepository.generation,
          }),
        );
      }
    }
    this.#reviewRuntime.registerRepositoryIdentity(cwd, identity);
    this.#repositoryKeysByCwd.set(cwdKey("local", cwd), key);
    this.#repositoryKeysByCwd.set(cwdKey("local", root), key);
    return repository;
  }
}

export const makeGitRepositoryRegistry = (
  runner: GitCommandRunner,
  reviewRuntime = new GitReviewRuntime({ commandRunner: runner }),
): Effect.Effect<GitRepositoryRegistry, never, Scope.Scope> =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    const runPromise = yield* FiberSet.makeRuntimePromise<never, unknown, never>();
    const registry = new GitRepositoryRegistryState({
      runner,
      reviewRuntime,
      makeRepository: async (identity) =>
        await runPromise(makeWorktreeRepository(identity, runner).pipe(Scope.provide(ownerScope))),
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => registry.release()));
    return registry;
  });
