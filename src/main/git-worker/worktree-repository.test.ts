import { describe, expect, it, vi } from "vite-plus/test";
import type { GitCommandResult, GitCommandRunner } from "./git-command-runner";
import { WorktreeRepository } from "./worktree-repository";

const identity = {
  hostId: "local" as const,
  root: "/repo/worktree",
  gitDir: "/repo/worktree/.git",
  commonDir: "/repo/common",
};

const unusedRunner: GitCommandRunner = {
  run: vi.fn(),
};

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

describe("WorktreeRepository", () => {
  it("shares one query run and aborts only after the last consumer leaves", async () => {
    const repository = new WorktreeRepository(identity, unusedRunner);
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
    repository.dispose();
  });

  it("retires generation-bound work", async () => {
    const repository = new WorktreeRepository(identity, unusedRunner);
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
    repository.dispose();
  });

  it("discovers attribute filters once and neutralizes every execution hook", async () => {
    const runner: GitCommandRunner = {
      run: vi.fn(async () =>
        commandResult(
          ["filter.lfs.process", "filter.lfs.required", "filter.custom.clean", ""].join("\n"),
        ),
      ),
    };
    const repository = new WorktreeRepository(identity, runner);

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
    repository.dispose();
  });
});
