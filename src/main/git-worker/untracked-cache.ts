import path from "node:path";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type { GitRepositoryError } from "./worktree-repository";
import {
  recordGitQueryCacheOutcomeEffect,
  type GitCommandOptions,
  type GitCommandResult,
} from "./git-command-runner";

export const GIT_UNTRACKED_FRESH_MS = 10_000;
export const GIT_UNTRACKED_SLOW_FRESH_MS = 20_000;
export const GIT_UNTRACKED_SLOW_THRESHOLD_MS = 7_000;
export const GIT_UNTRACKED_CHANGED_PATH_LIMIT = 64;
export const GIT_UNTRACKED_MATERIALIZED_PATH_LIMIT = 256;

export interface UntrackedPathsResult {
  success: boolean;
  paths: readonly string[];
  omittedCount: number;
}

interface UntrackedRepositoryAdapter {
  readonly identity: { root: string };
  query<Result>(input: {
    key: readonly unknown[];
    staleTime?: number;
    run: Effect.Effect<Result, GitRepositoryError, Scope.Scope>;
  }): Effect.Effect<Result, GitRepositoryError, Scope.Scope>;
  readSafeAttributeFilterOverrides: Effect.Effect<
    readonly string[],
    GitRepositoryError,
    Scope.Scope
  >;
  runGit(args: readonly string[], options?: GitCommandOptions): Effect.Effect<GitCommandResult>;
}

interface CachedUntrackedPaths {
  generation: number;
  expiresAt: number;
  result: UntrackedPathsResult;
}

function failedResult(): UntrackedPathsResult {
  return { success: false, paths: [], omittedCount: 0 };
}

function materializePaths(paths: readonly string[]): UntrackedPathsResult {
  const unique = [...new Set(paths)].sort();
  return {
    success: true,
    paths: unique.slice(0, GIT_UNTRACKED_MATERIALIZED_PATH_LIMIT),
    omittedCount: Math.max(0, unique.length - GIT_UNTRACKED_MATERIALIZED_PATH_LIMIT),
  };
}

export class UntrackedPathCache {
  readonly #repository: UntrackedRepositoryAdapter;
  readonly #now: () => number;
  #generation = 1;
  #slow = false;
  #cached: CachedUntrackedPaths | null = null;

  constructor(repository: UntrackedRepositoryAdapter, options: { now?: () => number } = {}) {
    this.#repository = repository;
    this.#now = options.now ?? Date.now;
  }

  readonly read: () => Effect.Effect<UntrackedPathsResult, GitRepositoryError, Scope.Scope> =
    Effect.fn("UntrackedPathCache.read")(function* (this: UntrackedPathCache) {
      const cached = this.#cached;
      if (cached && cached.generation === this.#generation && cached.expiresAt > this.#now()) {
        yield* recordGitQueryCacheOutcomeEffect("hit");
        return cached.result;
      }
      const generation = this.#generation;
      const startedAt = this.#now();
      const result = yield* this.#repository.query({
        key: ["all-untracked-paths", generation],
        staleTime: 0,
        run: this.#scanAll(),
      });
      if (generation !== this.#generation) return yield* this.read();
      const duration = this.#now() - startedAt;
      if (duration >= GIT_UNTRACKED_SLOW_THRESHOLD_MS) this.#slow = true;
      if (!result.success) {
        this.invalidateFull();
        return result;
      }
      this.#cached = {
        generation,
        expiresAt:
          this.#now() + (this.#slow ? GIT_UNTRACKED_SLOW_FRESH_MS : GIT_UNTRACKED_FRESH_MS),
        result,
      };
      return result;
    });

  invalidateFull(): void {
    this.#generation += 1;
    this.#slow = false;
    this.#cached = null;
  }

  readonly invalidatePaths = Effect.fn("UntrackedPathCache.invalidatePaths")(function* (
    this: UntrackedPathCache,
    changedPaths: readonly string[],
  ) {
    if (
      changedPaths.length === 0 ||
      changedPaths.length > GIT_UNTRACKED_CHANGED_PATH_LIMIT ||
      !this.#cached?.result.success ||
      this.#cached.result.omittedCount > 0
    ) {
      this.invalidateFull();
      return "full";
    }
    const relativePaths = changedPaths.flatMap((changedPath) => {
      const absolutePath = path.resolve(changedPath);
      const relativePath = path.relative(this.#repository.identity.root, absolutePath);
      if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return [];
      }
      return [relativePath.split(path.sep).join("/")];
    });
    if (
      relativePaths.length !== changedPaths.length ||
      relativePaths.some((changedPath) => changedPath === ".gitignore")
    ) {
      this.invalidateFull();
      return "full";
    }
    const scopes = relativePaths.map((changedPath) =>
      changedPath.endsWith("/.gitignore")
        ? changedPath.slice(0, -"/.gitignore".length)
        : changedPath,
    );
    const overrides = yield* this.#repository.readSafeAttributeFilterOverrides;
    const status = yield* this.#repository.runGit(
      [
        "status",
        "--no-renames",
        "--ignored=matching",
        "--untracked-files=all",
        "--porcelain=v1",
        "-z",
        "--",
        ...scopes,
      ],
      { configOverrides: overrides, literalPathspecs: true },
    );
    if (!status.success) {
      this.invalidateFull();
      return "full";
    }
    const nextPaths = this.#cached.result.paths.filter(
      (cachedPath) =>
        !scopes.some((scope) => cachedPath === scope || cachedPath.startsWith(`${scope}/`)),
    );
    for (const record of status.stdout.split("\0")) {
      if (record.startsWith("?? ")) nextPaths.push(record.slice(3));
    }
    this.#generation += 1;
    this.#cached = {
      generation: this.#generation,
      expiresAt: this.#now() + (this.#slow ? GIT_UNTRACKED_SLOW_FRESH_MS : GIT_UNTRACKED_FRESH_MS),
      result: materializePaths(nextPaths),
    };
    return "filtered";
  });

  readonly #scanAll = Effect.fn("UntrackedPathCache.scanAll")(function* (this: UntrackedPathCache) {
    const overrides = yield* this.#repository.readSafeAttributeFilterOverrides.pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (!overrides) return failedResult();
    const status = yield* this.#repository.runGit(
      ["status", "--no-renames", "--porcelain=v1", "-z", "--untracked-files=normal"],
      { configOverrides: overrides },
    );
    if (!status.success) return failedResult();
    const candidates = status.stdout
      .split("\0")
      .filter((record) => record.startsWith("?? "))
      .map((record) => record.slice(3));
    const directories = candidates.filter((candidate) => candidate.endsWith("/"));
    const files = candidates.filter((candidate) => !candidate.endsWith("/"));
    if (directories.length === 0) return materializePaths(files);
    const expanded = yield* this.#repository.runGit([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...directories,
    ]);
    if (!expanded.success) return failedResult();
    return materializePaths([
      ...files,
      ...expanded.stdout
        .split("\0")
        .filter(Boolean)
        .map((entry) => (entry.endsWith("/") ? entry.slice(0, -1) : entry)),
    ]);
  });
}
