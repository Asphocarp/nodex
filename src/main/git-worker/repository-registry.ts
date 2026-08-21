import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Hash from "effect/Hash";
import * as RcMap from "effect/RcMap";
import type * as Scope from "effect/Scope";
import { GitReviewRuntime, type GitReviewRepositoryPaths } from "./git-review-operations";
import type { GitCommandRunner, GitRepositoryExecutionIdentity } from "./git-command-runner";
import { makeWorktreeRepository, type WorktreeRepository } from "./worktree-repository";

class RepositoryKey implements Equal.Equal {
  readonly canonical: string;

  constructor(readonly identity: GitReviewRepositoryPaths & { readonly hostId: "local" }) {
    this.canonical = JSON.stringify([identity.hostId, identity.commonDir, identity.root]);
  }

  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof RepositoryKey && this.canonical === that.canonical;
  }

  [Hash.symbol](): number {
    return Hash.string(this.canonical);
  }
}

export interface GitRepositoryRegistry {
  readonly get: (cwd: string) => Effect.Effect<WorktreeRepository | null, never, Scope.Scope>;
  readonly initialize: (
    cwd: string,
  ) => Effect.Effect<WorktreeRepository | null, never, Scope.Scope>;
}

export const makeGitRepositoryRegistry = (
  runner: GitCommandRunner,
  reviewRuntime: GitReviewRuntime,
): Effect.Effect<GitRepositoryRegistry, never, Scope.Scope> =>
  Effect.gen(function* () {
    const repositories = yield* RcMap.make<RepositoryKey, WorktreeRepository, never, Scope.Scope>({
      lookup: (key) =>
        makeWorktreeRepository(key.identity, runner, {
          registerSnapshotGenerationProvider: (provider) =>
            reviewRuntime.registerSnapshotGenerationProvider(key.identity, provider),
        }),
      idleTimeToLive: Duration.infinity,
    });

    const discover = Effect.fn("GitRepositoryRegistry.discover")(function* (cwd: string) {
      const normalizedCwd = path.resolve(cwd.trim());
      const entry = yield* Effect.promise(() => stat(normalizedCwd).catch(() => null));
      if (!entry?.isDirectory()) return null;
      const provisional: GitRepositoryExecutionIdentity = {
        hostId: "local",
        commonDir: normalizedCwd,
        root: normalizedCwd,
      };
      const rootResult = yield* Effect.promise((signal) =>
        runner.run(provisional, ["rev-parse", "--show-toplevel"], {
          allowedNonZeroExitCodes: [128],
          signal,
        }),
      );
      if (!rootResult.success || rootResult.code !== 0 || !rootResult.stdout.trim()) return null;
      const root = yield* Effect.promise(() =>
        realpath(path.resolve(normalizedCwd, rootResult.stdout.trim())),
      );
      const rootIdentity: GitRepositoryExecutionIdentity = {
        hostId: "local",
        commonDir: root,
        root,
      };
      const [gitDirResult, commonDirResult] = yield* Effect.all(
        [
          Effect.promise((signal) =>
            runner.run(rootIdentity, ["rev-parse", "--git-dir"], { signal }),
          ),
          Effect.promise((signal) =>
            runner.run(rootIdentity, ["rev-parse", "--git-common-dir"], { signal }),
          ),
        ] as const,
        { concurrency: "unbounded" },
      );
      if (!gitDirResult.success || !commonDirResult.success) return null;
      const [gitDir, commonDir] = yield* Effect.all(
        [
          Effect.promise(() => realpath(path.resolve(root, gitDirResult.stdout.trim()))),
          Effect.promise(() => realpath(path.resolve(root, commonDirResult.stdout.trim()))),
        ] as const,
        { concurrency: "unbounded" },
      );
      const key = new RepositoryKey({ hostId: "local", root, gitDir, commonDir });
      reviewRuntime.registerRepositoryIdentity(normalizedCwd, key.identity);
      reviewRuntime.registerRepositoryIdentity(root, key.identity);
      return key;
    });

    const discoveries = yield* RcMap.make<string, RepositoryKey | null, never, never>({
      lookup: discover,
      idleTimeToLive: Duration.infinity,
    });

    const get = Effect.fn("GitRepositoryRegistry.get")(function* (cwd: string) {
      const normalizedCwd = path.resolve(cwd.trim());
      const key = yield* RcMap.get(discoveries, normalizedCwd);
      if (!key) return null;
      return yield* RcMap.get(repositories, key);
    });

    const initialize = Effect.fn("GitRepositoryRegistry.initialize")(function* (cwd: string) {
      const normalizedCwd = path.resolve(cwd.trim());
      const entry = yield* Effect.promise(() => stat(normalizedCwd).catch(() => null));
      if (!entry?.isDirectory()) return null;
      const provisional: GitRepositoryExecutionIdentity = {
        hostId: "local",
        commonDir: normalizedCwd,
        root: normalizedCwd,
      };
      let result = yield* Effect.promise((signal) =>
        runner.run(provisional, ["init", "-b", "main"], { signal }),
      );
      if (!result.success) {
        result = yield* Effect.promise((signal) => runner.run(provisional, ["init"], { signal }));
      }
      if (!result.success) return null;
      yield* RcMap.invalidate(discoveries, normalizedCwd);
      return yield* get(normalizedCwd);
    });

    return { get, initialize };
  });
