import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  registerGitReviewRepositoryIdentity,
  registerGitReviewSnapshotGenerationProvider,
  type GitReviewRepositoryPaths,
} from "./git-review-operations";
import type { GitCommandRunner, GitRepositoryExecutionIdentity } from "./git-command-runner";
import { WorktreeRepository } from "./worktree-repository";

function cwdKey(hostId: string, cwd: string): string {
  return JSON.stringify([hostId, path.resolve(cwd)]);
}

function repositoryKey(identity: GitReviewRepositoryPaths): string {
  return JSON.stringify([identity.hostId, identity.commonDir, identity.root]);
}

export class GitRepositoryRegistry {
  readonly #runner: GitCommandRunner;
  readonly #repositories = new Map<string, WorktreeRepository>();
  readonly #repositoryKeysByCwd = new Map<string, string>();
  readonly #discoveries = new Map<string, Promise<WorktreeRepository | null>>();
  readonly #generationProviderCleanups = new Map<string, () => void>();

  constructor(runner: GitCommandRunner) {
    this.#runner = runner;
  }

  async get(cwd: string, signal?: AbortSignal): Promise<WorktreeRepository | null> {
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

  async initialize(
    cwd: string,
    signal?: AbortSignal,
  ): Promise<WorktreeRepository | null> {
    const normalizedCwd = path.resolve(cwd.trim());
    const entry = await stat(normalizedCwd).catch(() => null);
    if (!entry?.isDirectory()) return null;
    const provisional: GitRepositoryExecutionIdentity = {
      hostId: "local",
      commonDir: normalizedCwd,
      root: normalizedCwd,
    };
    let result = await this.#runner.run(
      provisional,
      ["init", "-b", "main"],
      { signal },
    );
    if (!result.success) {
      result = await this.#runner.run(provisional, ["init"], { signal });
    }
    if (!result.success) return null;
    return await this.get(normalizedCwd, signal);
  }

  dispose(): void {
    for (const repository of this.#repositories.values()) repository.dispose();
    for (const cleanup of this.#generationProviderCleanups.values()) cleanup();
    this.#repositories.clear();
    this.#repositoryKeysByCwd.clear();
    this.#discoveries.clear();
    this.#generationProviderCleanups.clear();
  }

  async #discover(
    cwd: string,
    signal?: AbortSignal,
  ): Promise<WorktreeRepository | null> {
    const provisional: GitRepositoryExecutionIdentity = {
      hostId: "local",
      commonDir: cwd,
      root: cwd,
    };
    const rootResult = await this.#runner.run(
      provisional,
      ["rev-parse", "--show-toplevel"],
      { allowedNonZeroExitCodes: [128], signal },
    );
    signal?.throwIfAborted();
    if (!rootResult.success || rootResult.code !== 0 || !rootResult.stdout.trim()) {
      return null;
    }
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
    const key = repositoryKey(identity);
    let repository = this.#repositories.get(key);
    if (!repository) {
      repository = new WorktreeRepository(identity, this.#runner);
      this.#repositories.set(key, repository);
      const ownedRepository = repository;
      this.#generationProviderCleanups.set(
        key,
        registerGitReviewSnapshotGenerationProvider(identity, {
          advance: () => ownedRepository.advanceGeneration(),
          current: () => ownedRepository.generation,
        }),
      );
    }
    registerGitReviewRepositoryIdentity(cwd, identity);
    this.#repositoryKeysByCwd.set(cwdKey("local", cwd), key);
    this.#repositoryKeysByCwd.set(cwdKey("local", root), key);
    return repository;
  }
}
