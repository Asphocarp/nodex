import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { describe, expect, vi } from "vite-plus/test";
import type {
  FileWatchError,
  FileWatchEvent,
  FileWatchHost,
  FileWatchInput,
} from "../file-watch-host";
import type { GitCommandResult, GitCommandRunner } from "./git-command-runner";
import { makeWorktreeRepository, type WorktreeRepository } from "./worktree-repository";

const identity = {
  hostId: "local" as const,
  root: "/repo/worktree",
  gitDir: "/repo/worktree/.git",
  commonDir: "/repo/common",
};

const unusedRunner: GitCommandRunner = {
  run: vi.fn(),
};

class CountingWatchHost implements FileWatchHost {
  starts = 0;
  disposals = 0;

  readonly watch = (input: FileWatchInput): Stream.Stream<FileWatchEvent, FileWatchError> =>
    Stream.callback<FileWatchEvent, FileWatchError>((events) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          this.starts += 1;
          Queue.offerUnsafe(events, {
            _tag: "Ready",
            coverage: { recursive: input.recursive, typedPathChanges: false },
            path: input.path,
          });
        }),
        () =>
          Effect.sync(() => {
            this.disposals += 1;
          }),
      ),
    );
}

function isAborted(signal: AbortSignal | null): boolean {
  return signal?.aborted ?? false;
}

function deferred<Result>(): {
  promise: Promise<Result>;
  resolve: (value: Result) => void;
} {
  let resolve: (value: Result) => void = () => undefined;
  const promise = new Promise<Result>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function commandResult(stdout: string): GitCommandResult {
  return {
    success: true,
    code: 0,
    signal: null,
    stdout,
    stderr: "",
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: 0,
    failureReason: null,
    aborted: false,
    timedOut: false,
    outputLimitExceeded: false,
  };
}

const withRepository = <A>(
  runner: GitCommandRunner,
  run: (repository: WorktreeRepository) => Promise<A>,
) =>
  makeWorktreeRepository(identity, runner).pipe(
    Effect.flatMap((repository) => Effect.promise(() => run(repository))),
  );

describe("WorktreeRepository", () => {
  it.effect("shares one query run and aborts only after the last consumer leaves", () =>
    withRepository(unusedRunner, async (repository) => {
      const execution = deferred<string>();
      let runSignal: AbortSignal | null = null;
      const run = vi.fn(async (signal: AbortSignal) => {
        runSignal = signal;
        return await execution.promise;
      });
      const firstController = new AbortController();
      const secondController = new AbortController();
      const first = repository.query({
        key: ["status"],
        run,
        signal: firstController.signal,
      });
      const second = repository.query({
        key: ["status"],
        run,
        signal: secondController.signal,
      });
      await Promise.resolve();
      expect(run).toHaveBeenCalledTimes(1);

      firstController.abort(new Error("first canceled"));
      await expect(first).rejects.toThrow("first canceled");
      expect(isAborted(runSignal)).toBe(false);

      execution.resolve("done");
      await expect(second).resolves.toBe("done");
      expect(isAborted(runSignal)).toBe(false);
    }),
  );

  it.effect("retires generation-bound work", () =>
    withRepository(unusedRunner, async (repository) => {
      const controller = new AbortController();
      const started = deferred<void>();
      let querySignal: AbortSignal | null = null;
      const result = repository.query({
        key: ["review-summary", 1],
        meta: { gitReadDomains: ["working-tree"] },
        run: async (signal) => {
          querySignal = signal;
          await started.promise;
          signal.throwIfAborted();
          return "obsolete";
        },
        signal: controller.signal,
      });
      await Promise.resolve();

      expect(repository.advanceGeneration()).toBe(2);
      started.resolve();
      await expect(result).rejects.toMatchObject({ message: "CancelledError" });
      expect(isAborted(querySignal)).toBe(true);
    }),
  );

  it.effect("discovers attribute filters once and neutralizes every execution hook", () => {
    const runner: GitCommandRunner = {
      run: vi.fn(async () =>
        commandResult(
          ["filter.lfs.process", "filter.lfs.required", "filter.custom.clean", ""].join("\n"),
        ),
      ),
    };
    return withRepository(runner, async (repository) => {
      const [first, second] = await Promise.all([
        repository.readSafeAttributeFilterOverrides(),
        repository.readSafeAttributeFilterOverrides(),
      ]);

      expect(runner.run).toHaveBeenCalledTimes(1);
      expect(first).toEqual(second);
      expect(first).toEqual([
        "attr.tree=",
        "core.attributesFile=",
        "filter.lfs.clean=",
        "filter.lfs.smudge=",
        "filter.lfs.process=",
        "filter.lfs.required=false",
        "filter.custom.clean=",
        "filter.custom.smudge=",
        "filter.custom.process=",
        "filter.custom.required=false",
      ]);
    });
  });

  it.effect("shares one lazy watcher until the last live lease releases", () =>
    Effect.gen(function* () {
      const host = new CountingWatchHost();
      const repository = yield* makeWorktreeRepository(identity, unusedRunner, { watchHost: host });
      const member = () => ({
        onChange: () => undefined,
        onRequiresRecoveryChanged: () => undefined,
      });

      const first = yield* Effect.promise(() => repository.acquireWatchLease(member()));
      const started = host.starts;
      expect(started).toBeGreaterThan(0);
      const second = yield* Effect.promise(() => repository.acquireWatchLease(member()));
      expect(host.starts).toBe(started);

      first.release();
      yield* Effect.yieldNow;
      expect(host.disposals).toBe(0);

      second.release();
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(host.disposals).toBe(started);
    }),
  );

  it.effect("cancels shared reads and fences admission with its owner Scope", () =>
    Effect.gen(function* () {
      const parentScope = yield* Scope.Scope;
      const repositoryScope = yield* Scope.fork(parentScope);
      const repository = yield* makeWorktreeRepository(identity, unusedRunner).pipe(
        Scope.provide(repositoryScope),
      );
      let querySignal: AbortSignal | null = null;
      const pending = repository.query({
        key: ["scope-bound-read"],
        run: async (signal) => {
          querySignal = signal;
          return await new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      });
      yield* Effect.promise(() => Promise.resolve());

      yield* Scope.close(repositoryScope, Exit.void);

      yield* Effect.promise(() =>
        expect(pending).rejects.toMatchObject({ message: "CancelledError" }),
      );
      expect(isAborted(querySignal)).toBe(true);
      yield* Effect.promise(() =>
        expect(repository.query({ key: ["after-close"], run: async () => "late" })).rejects.toThrow(
          "Git repository is closed",
        ),
      );
    }),
  );
});
