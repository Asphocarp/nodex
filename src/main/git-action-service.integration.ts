import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  cancelGitAction,
  commitGitChanges,
  generateGitCommitMessage,
  generateGitPullRequestMessage,
  pushGitChanges,
  type CommitGitChangesOptions,
  type GitActionWorkerPort,
} from "./git-action-service";
import type {
  GitWorkerMethod,
  GitWorkerMethodMap,
  GitWorkerRequest,
} from "../shared/git-worker-protocol";
import { GitWorkerModule } from "./git-worker/git-worker-module";

interface CommandResult {
  stdout: string;
  stderr: string;
}

const tempRoots: string[] = [];
const gitWorkerModules: GitWorkerModule[] = [];
let workerRequestSequence = 0;

async function executeWorkerRequest<Method extends GitWorkerMethod>(
  module: GitWorkerModule,
  method: Method,
  params: GitWorkerMethodMap[Method]["params"],
  signal?: AbortSignal,
): Promise<GitWorkerMethodMap[Method]["result"]> {
  workerRequestSequence += 1;
  return (await module.execute(
    {
      id: `git-action-test-${workerRequestSequence}`,
      method,
      params,
      enqueuedAtMs: Date.now(),
    } as GitWorkerRequest["request"],
    signal ?? new AbortController().signal,
  )) as GitWorkerMethodMap[Method]["result"];
}

function createGitActionWorkerPort(): GitActionWorkerPort {
  const module = new GitWorkerModule();
  gitWorkerModules.push(module);
  return {
    readStatus: async (cwd, signal) =>
      await executeWorkerRequest(module, "action-status", { cwd }, signal),
    readReviewPatch: async (input, signal) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await executeWorkerRequest(module, "review-patch", input, signal);
        if (!("type" in result) || result.type !== "stale-snapshot") {
          return result as import("../shared/types").GitReviewPatchResult;
        }
      }
      throw new Error("Git repository changed while preparing the message.");
    },
    commit: async (input, signal) => await executeWorkerRequest(module, "commit", input, signal),
    refreshRepository: async (cwd) => {
      await executeWorkerRequest(module, "refresh-repository", { cwd });
    },
  };
}

function createGitActionOptions(
  overrides: Omit<CommitGitChangesOptions, "gitWorker"> = {},
): CommitGitChangesOptions {
  return {
    gitWorker: createGitActionWorkerPort(),
    ...overrides,
  };
}

async function readActionStatus(cwd: string) {
  return await createGitActionWorkerPort().readStatus(cwd);
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
        });
      },
    );
  });
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "nodex-git-action-"));
  tempRoots.push(root);
  return root;
}

async function createRepo(root: string): Promise<string> {
  const repo = path.join(root, "repo");
  await mkdir(repo);
  await runCommand("git", ["init"], repo);
  await runCommand("git", ["config", "user.email", "nodex@example.test"], repo);
  await runCommand("git", ["config", "user.name", "Nodex Test"], repo);
  return repo;
}

afterEach(async () => {
  for (const module of gitWorkerModules.splice(0)) module.dispose();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("git-action-service", () => {
  test("commits unstaged changes when includeUnstaged is enabled", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");

    const before = await readActionStatus(repo);
    expect(before.isGitRepository).toBe(true);
    expect(before.hasUncommittedChanges).toBe(true);
    expect(before.canCommit).toBe(true);

    const result = await commitGitChanges(
      {
        cwd: repo,
        message: "feat: add feature file",
        includeUnstaged: true,
      },
      createGitActionOptions(),
    );

    expect(result.status).toBe("success");
    const log = await runCommand("git", ["log", "-1", "--pretty=%s"], repo);
    expect(log.stdout.trim()).toBe("feat: add feature file");
    const after = await readActionStatus(repo);
    expect(after.hasUncommittedChanges).toBe(false);
  });

  test("generates a commit message with the provided generator when the input message is blank", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");
    let capturedPrompt = "";

    const result = await commitGitChanges(
      {
        cwd: repo,
        message: "",
        includeUnstaged: true,
      },
      createGitActionOptions({
        generateCommitMessage: async ({ prompt }) => {
          capturedPrompt = prompt;
          return "feat: generated feature";
        },
      }),
    );

    expect(result.status).toBe("success");
    const log = await runCommand("git", ["log", "-1", "--pretty=%s"], repo);
    expect(log.stdout.trim()).toBe("feat: generated feature");
    expect(capturedPrompt.includes("Changes:")).toBe(true);
    expect(capturedPrompt.includes("diff --git")).toBe(true);
    expect(capturedPrompt.includes("feature.txt")).toBe(true);
    expect(capturedPrompt.includes("Testing note:")).toBe(true);
  });

  test("falls back to a local subject when no commit message generator is provided", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");

    const result = await commitGitChanges(
      {
        cwd: repo,
        message: "",
        includeUnstaged: true,
      },
      createGitActionOptions(),
    );

    expect(result.status).toBe("success");
    const log = await runCommand("git", ["log", "-1", "--pretty=%s"], repo);
    expect(log.stdout.trim()).toBe("Update feature.txt");
  });

  test("generates a commit message without committing", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");
    let capturedPrompt = "";

    const result = await generateGitCommitMessage(
      {
        cwd: repo,
        draftMessage: "",
        includeUnstaged: true,
      },
      createGitActionOptions({
        generateCommitMessage: async ({ prompt }) => {
          capturedPrompt = prompt;
          return "feat: generated feature";
        },
      }),
    );

    expect(result.status).toBe("success");
    expect(result.message).toBe("feat: generated feature");
    expect(capturedPrompt.includes("Changes:")).toBe(true);
    expect(capturedPrompt.includes("feature.txt")).toBe(true);

    const after = await readActionStatus(repo);
    expect(after.hasStagedChanges).toBe(false);
    expect(after.hasUncommittedChanges).toBe(true);
  });

  test("generates a pull request title and body from branch diff context", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "README.md"), "base\n");
    await commitGitChanges(
      {
        cwd: repo,
        message: "chore: initial commit",
        includeUnstaged: true,
      },
      createGitActionOptions(),
    );
    await runCommand("git", ["branch", "-M", "main"], repo);
    await runCommand("git", ["checkout", "-b", "feature/summary-panel"], repo);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");
    await commitGitChanges(
      {
        cwd: repo,
        message: "feat: add feature file",
        includeUnstaged: true,
      },
      createGitActionOptions(),
    );

    let capturedPrompt = "";
    const result = await generateGitPullRequestMessage(
      {
        cwd: repo,
        title: "",
        body: "",
        headBranch: "feature/summary-panel",
        baseBranch: "main",
      },
      createGitActionOptions({
        generatePullRequestMessage: async ({ prompt }) => {
          capturedPrompt = prompt;
          return {
            title: "Generated PR title",
            body: "Generated PR body",
          };
        },
      }),
    );

    expect(result.status).toBe("success");
    expect(result.title).toBe("Generated PR title");
    expect(result.body).toBe("Generated PR body");
    expect(capturedPrompt.includes("Branches:")).toBe(true);
    expect(capturedPrompt.includes("- Head: feature/summary-panel")).toBe(true);
    expect(capturedPrompt.includes("- Base: main")).toBe(true);
    expect(capturedPrompt.includes("Changes:")).toBe(true);
    expect(capturedPrompt.includes("feature.txt")).toBe(true);
  });

  test("does not commit when generated commit message is empty", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");

    const result = await commitGitChanges(
      {
        cwd: repo,
        message: "",
        includeUnstaged: true,
      },
      createGitActionOptions({
        generateCommitMessage: async () => "",
      }),
    );

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Couldn't generate a commit message");

    const after = await readActionStatus(repo);
    expect(after.hasUncommittedChanges).toBe(true);
  });

  test("cancels the active Git commit process by operation id", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");
    let markCommitStarted: (() => void) | undefined;
    const commitStarted = new Promise<void>((resolve) => {
      markCommitStarted = resolve;
    });
    const gitWorker = createGitActionWorkerPort();
    const cancelableGitWorker: GitActionWorkerPort = {
      ...gitWorker,
      commit: async (_input, signal) => {
        markCommitStarted?.();
        return await new Promise<never>((_resolve, reject) => {
          const rejectCanceled = () => {
            const error = new Error("Git action was canceled.");
            error.name = "AbortError";
            reject(error);
          };
          if (signal?.aborted) {
            rejectCanceled();
            return;
          }
          signal?.addEventListener("abort", rejectCanceled, { once: true });
        });
      },
    };

    const operationId = "cancel-commit";
    const pendingCommit = commitGitChanges(
      {
        cwd: repo,
        message: "feat: add feature file",
        includeUnstaged: true,
        operationId,
      },
      { gitWorker: cancelableGitWorker },
    );

    try {
      await commitStarted;

      const cancelResult = cancelGitAction({ operationId });
      const result = await pendingCommit;

      expect(cancelResult.canceled).toBe(true);
      expect(result.status).toBe("error");
      expect(result.errorMessage).toBe("Git action was canceled.");
      await expect(runCommand("git", ["rev-parse", "--verify", "HEAD"], repo)).rejects.toThrow();
    } finally {
      cancelGitAction({ operationId });
      await pendingCommit;
    }
  });

  test("pushes the current branch and sets origin upstream when missing", async () => {
    const root = await createTempRoot();
    const remote = path.join(root, "remote.git");
    await runCommand("git", ["init", "--bare", remote], root);
    const repo = await createRepo(root);
    await runCommand("git", ["remote", "add", "origin", remote], repo);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");
    await commitGitChanges(
      {
        cwd: repo,
        message: "feat: add feature file",
        includeUnstaged: true,
      },
      createGitActionOptions(),
    );

    const before = await readActionStatus(repo);
    expect(before.canPush).toBe(true);
    expect(before.pushNeedsUpstream).toBe(true);

    const result = await pushGitChanges({ cwd: repo });

    expect(result.status).toBe("success");
    const after = await readActionStatus(repo);
    expect(after.pushNeedsUpstream).toBe(false);
    expect(Boolean(after.upstreamBranch)).toBe(true);
    expect(after.commitsAhead).toBe(0);
  });
});
