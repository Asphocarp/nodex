import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalGitCommandRunner,
  isGitReadCommand,
  type GitRepositoryExecutionIdentity,
} from "./git-command-runner";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function createRepository(): Promise<GitRepositoryExecutionIdentity> {
  const root = await mkdtemp(path.join(tmpdir(), "nodex-git-runner-"));
  temporaryDirectories.push(root);
  await execFileAsync("git", ["init", "-q", root]);
  const commonDir = (await execFileAsync(
    "git",
    ["-C", root, "rev-parse", "--git-common-dir"],
  )).stdout.trim();
  return {
    hostId: "local",
    root,
    commonDir: path.resolve(root, commonDir),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("LocalGitCommandRunner", () => {
  it("runs with non-interactive, stable, no-optional-locks Git policy", async () => {
    const repository = await createRepository();
    const runner = new LocalGitCommandRunner();
    const result = await runner.run(repository, ["nodex-env"], {
      configOverrides: ["alias.nodex-env=!test \"$GIT_OPTIONAL_LOCKS\" = 0"
        + " && test \"$GIT_TERMINAL_PROMPT\" = 0"
        + " && test \"$LC_MESSAGES\" = C"
        + " && test \"$LANGUAGE\" = C"],
    });

    expect(result).toMatchObject({
      success: true,
      code: 0,
      failureReason: null,
      timedOut: false,
    });
  });

  it("returns timeout as structured data without fabricating exit code zero", async () => {
    const repository = await createRepository();
    const runner = new LocalGitCommandRunner();
    const result = await runner.run(
      repository,
      ["nodex-sleep"],
      {
        configOverrides: ["alias.nodex-sleep=!sleep 1"],
        timeoutMs: 20,
      },
    );

    expect(result).toMatchObject({
      success: false,
      code: null,
      failureReason: "timed_out",
      timedOut: true,
      aborted: false,
    });
  });

  it("distinguishes cancellation and output limits", async () => {
    const repository = await createRepository();
    const runner = new LocalGitCommandRunner();
    const controller = new AbortController();
    const canceled = runner.run(
      repository,
      ["nodex-sleep"],
      {
        configOverrides: ["alias.nodex-sleep=!sleep 1"],
        signal: controller.signal,
      },
    );
    controller.abort();

    await expect(canceled).resolves.toMatchObject({
      success: false,
      failureReason: "canceled",
      aborted: true,
      timedOut: false,
    });

    const capped = await runner.run(
      repository,
      ["nodex-output"],
      {
        configOverrides: ["alias.nodex-output=!yes x | head -c 4096"],
        outputBytesCap: 256,
      },
    );
    expect(capped).toMatchObject({
      success: false,
      failureReason: "output_limit",
      outputLimitExceeded: true,
    });
    expect(capped.stdoutBytes + capped.stderrBytes).toBeGreaterThan(256);
  });

  it("classifies only bounded background reads for the default timeout", () => {
    expect(isGitReadCommand(["status", "--porcelain=v1"])).toBe(true);
    expect(isGitReadCommand(["cat-file", "-e", "HEAD:file"])).toBe(true);
    expect(isGitReadCommand(["ls-files", "--others"])).toBe(true);
    expect(isGitReadCommand(["ls-files", "--cached"])).toBe(false);
    expect(isGitReadCommand(["diff", "--no-ext-diff"])).toBe(false);
    expect(isGitReadCommand(["apply", "patch.diff"])).toBe(false);
  });

  it("rejects global options outside the typed config override seam", async () => {
    const repository = await createRepository();
    const runner = new LocalGitCommandRunner();

    await expect(runner.run(repository, ["-c", "core.fsmonitor=false", "status"]))
      .rejects.toThrow("must begin with a subcommand");
  });
});
