import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  cancelGitAction,
  commitGitChanges,
  generateGitCommitMessage,
  generateGitPullRequestMessage,
  pushGitChanges,
  readGitActionStatus,
} from "./git-action-service";

interface CommandResult {
  stdout: string;
  stderr: string;
}

const tempRoots: string[] = [];

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("git-action-service", () => {
  test("commits unstaged changes when includeUnstaged is enabled", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");

    const before = await readGitActionStatus({ cwd: repo });
    expect(before.isGitRepository).toBeTrue();
    expect(before.hasUncommittedChanges).toBeTrue();
    expect(before.canCommit).toBeTrue();

    const result = await commitGitChanges({
      cwd: repo,
      message: "feat: add feature file",
      includeUnstaged: true,
    });

    expect(result.status).toBe("success");
    const log = await runCommand("git", ["log", "-1", "--pretty=%s"], repo);
    expect(log.stdout.trim()).toBe("feat: add feature file");
    const after = await readGitActionStatus({ cwd: repo });
    expect(after.hasUncommittedChanges).toBeFalse();
  });

  test("generates a commit message with the provided generator when the input message is blank", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");
    let capturedPrompt = "";

    const result = await commitGitChanges({
      cwd: repo,
      message: "",
      includeUnstaged: true,
    }, {
      generateCommitMessage: async ({ prompt }) => {
        capturedPrompt = prompt;
        return "feat: generated feature";
      },
    });

    expect(result.status).toBe("success");
    const log = await runCommand("git", ["log", "-1", "--pretty=%s"], repo);
    expect(log.stdout.trim()).toBe("feat: generated feature");
    expect(capturedPrompt.includes("Changes:")).toBeTrue();
    expect(capturedPrompt.includes("diff --git")).toBeTrue();
    expect(capturedPrompt.includes("feature.txt")).toBeTrue();
    expect(capturedPrompt.includes("Testing note:")).toBeTrue();
  });

  test("falls back to a local subject when no commit message generator is provided", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");

    const result = await commitGitChanges({
      cwd: repo,
      message: "",
      includeUnstaged: true,
    });

    expect(result.status).toBe("success");
    const log = await runCommand("git", ["log", "-1", "--pretty=%s"], repo);
    expect(log.stdout.trim()).toBe("Add feature.txt");
  });

  test("generates a commit message without committing", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");
    let capturedPrompt = "";

    const result = await generateGitCommitMessage({
      cwd: repo,
      draftMessage: "",
      includeUnstaged: true,
    }, {
      generateCommitMessage: async ({ prompt }) => {
        capturedPrompt = prompt;
        return "feat: generated feature";
      },
    });

    expect(result.status).toBe("success");
    expect(result.message).toBe("feat: generated feature");
    expect(capturedPrompt.includes("Changes:")).toBeTrue();
    expect(capturedPrompt.includes("feature.txt")).toBeTrue();

    const after = await readGitActionStatus({ cwd: repo });
    expect(after.hasStagedChanges).toBeTrue();
    expect(after.hasUncommittedChanges).toBeTrue();
  });

  test("generates a pull request title and body from branch diff context", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "README.md"), "base\n");
    await commitGitChanges({
      cwd: repo,
      message: "chore: initial commit",
      includeUnstaged: true,
    });
    await runCommand("git", ["branch", "-M", "main"], repo);
    await runCommand("git", ["checkout", "-b", "feature/summary-panel"], repo);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");
    await commitGitChanges({
      cwd: repo,
      message: "feat: add feature file",
      includeUnstaged: true,
    });

    let capturedPrompt = "";
    const result = await generateGitPullRequestMessage({
      cwd: repo,
      title: "",
      body: "",
      headBranch: "feature/summary-panel",
      baseBranch: "main",
    }, {
      generatePullRequestMessage: async ({ prompt }) => {
        capturedPrompt = prompt;
        return {
          title: "Generated PR title",
          body: "Generated PR body",
        };
      },
    });

    expect(result.status).toBe("success");
    expect(result.title).toBe("Generated PR title");
    expect(result.body).toBe("Generated PR body");
    expect(capturedPrompt.includes("Branches:")).toBeTrue();
    expect(capturedPrompt.includes("- Head: feature/summary-panel")).toBeTrue();
    expect(capturedPrompt.includes("- Base: main")).toBeTrue();
    expect(capturedPrompt.includes("Changes:")).toBeTrue();
    expect(capturedPrompt.includes("feature.txt")).toBeTrue();
  });

  test("does not commit when generated commit message is empty", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");

    const result = await commitGitChanges({
      cwd: repo,
      message: "",
      includeUnstaged: true,
    }, {
      generateCommitMessage: async () => "",
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Couldn't generate a commit message");

    const after = await readGitActionStatus({ cwd: repo });
    expect(after.hasUncommittedChanges).toBeTrue();
  });

  test("cancels an active commit operation by operation id", async () => {
    const root = await createTempRoot();
    const repo = await createRepo(root);
    const hookPath = path.join(repo, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, "#!/bin/sh\nsleep 10\n");
    await chmod(hookPath, 0o755);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");

    const operationId = "cancel-commit";
    const pendingCommit = commitGitChanges({
      cwd: repo,
      message: "feat: add feature file",
      includeUnstaged: true,
      operationId,
    });
    await wait(100);

    const cancelResult = cancelGitAction({ operationId });
    const result = await pendingCommit;

    expect(cancelResult.canceled).toBeTrue();
    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Git action was canceled.");
  });

  test("pushes the current branch and sets origin upstream when missing", async () => {
    const root = await createTempRoot();
    const remote = path.join(root, "remote.git");
    await runCommand("git", ["init", "--bare", remote], root);
    const repo = await createRepo(root);
    await runCommand("git", ["remote", "add", "origin", remote], repo);
    await writeFile(path.join(repo, "feature.txt"), "hello\n");
    await commitGitChanges({
      cwd: repo,
      message: "feat: add feature file",
      includeUnstaged: true,
    });

    const before = await readGitActionStatus({ cwd: repo });
    expect(before.canPush).toBeTrue();
    expect(before.pushNeedsUpstream).toBeTrue();

    const result = await pushGitChanges({ cwd: repo });

    expect(result.status).toBe("success");
    const after = await readGitActionStatus({ cwd: repo });
    expect(after.pushNeedsUpstream).toBeFalse();
    expect(Boolean(after.upstreamBranch)).toBeTrue();
    expect(after.commitsAhead).toBe(0);
  });
});
