import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect } from "vite-plus/test";
import {
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
import { makeGitWorkerModule, type GitWorkerModule } from "./git-worker/git-worker-module";

interface CommandResult {
  stdout: string;
  stderr: string;
}

const tempRoots: string[] = [];
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

function createGitActionWorkerPort(module: GitWorkerModule): GitActionWorkerPort {
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
    push: async (input, signal) => await executeWorkerRequest(module, "push", input, signal),
  };
}

function createGitActionOptions(
  module: GitWorkerModule,
  overrides: Omit<CommitGitChangesOptions, "gitWorker"> = {},
): CommitGitChangesOptions {
  return {
    gitWorker: createGitActionWorkerPort(module),
    ...overrides,
  };
}

async function readActionStatus(module: GitWorkerModule, cwd: string) {
  return await createGitActionWorkerPort(module).readStatus(cwd);
}

const withGitWorkerModule = <A>(run: (module: GitWorkerModule) => Promise<A>) =>
  makeGitWorkerModule().pipe(Effect.flatMap((module) => Effect.promise(() => run(module))));

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
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("git-action-service", () => {
  it.effect("commits unstaged changes when includeUnstaged is enabled", () =>
    withGitWorkerModule(async (module) => {
      const root = await createTempRoot();
      const repo = await createRepo(root);
      await writeFile(path.join(repo, "feature.txt"), "hello\n");

      const before = await readActionStatus(module, repo);
      expect(before.isGitRepository).toBe(true);
      expect(before.hasUncommittedChanges).toBe(true);
      expect(before.canCommit).toBe(true);

      const result = await commitGitChanges(
        {
          cwd: repo,
          message: "feat: add feature file",
          includeUnstaged: true,
        },
        createGitActionOptions(module),
      );

      expect(result.status).toBe("success");
      const log = await runCommand("git", ["log", "-1", "--pretty=%s"], repo);
      expect(log.stdout.trim()).toBe("feat: add feature file");
      const after = await readActionStatus(module, repo);
      expect(after.hasUncommittedChanges).toBe(false);
    }),
  );

  it.effect(
    "generates a commit message with the provided generator when the input message is blank",
    () =>
      withGitWorkerModule(async (module) => {
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
          createGitActionOptions(module, {
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
      }),
  );

  it.effect("falls back to a local subject when no commit message generator is provided", () =>
    withGitWorkerModule(async (module) => {
      const root = await createTempRoot();
      const repo = await createRepo(root);
      await writeFile(path.join(repo, "feature.txt"), "hello\n");

      const result = await commitGitChanges(
        {
          cwd: repo,
          message: "",
          includeUnstaged: true,
        },
        createGitActionOptions(module),
      );

      expect(result.status).toBe("success");
      const log = await runCommand("git", ["log", "-1", "--pretty=%s"], repo);
      expect(log.stdout.trim()).toBe("Update feature.txt");
    }),
  );

  it.effect("generates a commit message without committing", () =>
    withGitWorkerModule(async (module) => {
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
        createGitActionOptions(module, {
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

      const after = await readActionStatus(module, repo);
      expect(after.hasStagedChanges).toBe(false);
      expect(after.hasUncommittedChanges).toBe(true);
    }),
  );

  it.effect("generates a pull request title and body from branch diff context", () =>
    withGitWorkerModule(async (module) => {
      const root = await createTempRoot();
      const repo = await createRepo(root);
      await writeFile(path.join(repo, "README.md"), "base\n");
      await commitGitChanges(
        {
          cwd: repo,
          message: "chore: initial commit",
          includeUnstaged: true,
        },
        createGitActionOptions(module),
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
        createGitActionOptions(module),
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
        createGitActionOptions(module, {
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
    }),
  );

  it.effect("does not commit when generated commit message is empty", () =>
    withGitWorkerModule(async (module) => {
      const root = await createTempRoot();
      const repo = await createRepo(root);
      await writeFile(path.join(repo, "feature.txt"), "hello\n");

      const result = await commitGitChanges(
        {
          cwd: repo,
          message: "",
          includeUnstaged: true,
        },
        createGitActionOptions(module, {
          generateCommitMessage: async () => "",
        }),
      );

      expect(result.status).toBe("error");
      expect(result.errorMessage).toBe("Couldn't generate a commit message");

      const after = await readActionStatus(module, repo);
      expect(after.hasUncommittedChanges).toBe(true);
    }),
  );

  it.effect("cancels the active Git commit process by operation id", () =>
    withGitWorkerModule(async (module) => {
      const root = await createTempRoot();
      const repo = await createRepo(root);
      await writeFile(path.join(repo, "feature.txt"), "hello\n");
      let markCommitStarted: (() => void) | undefined;
      const commitStarted = new Promise<void>((resolve) => {
        markCommitStarted = resolve;
      });
      const gitWorker = createGitActionWorkerPort(module);
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
      const controller = new AbortController();
      const pendingCommit = commitGitChanges(
        {
          cwd: repo,
          message: "feat: add feature file",
          includeUnstaged: true,
          operationId,
        },
        { gitWorker: cancelableGitWorker },
        controller.signal,
      );

      try {
        await commitStarted;

        controller.abort();
        const result = await pendingCommit;

        expect(result.status).toBe("error");
        expect(result.errorMessage).toBe("Git action was canceled.");
        await expect(runCommand("git", ["rev-parse", "--verify", "HEAD"], repo)).rejects.toThrow();
      } finally {
        controller.abort();
        await pendingCommit;
      }
    }),
  );

  it.effect("pushes the current branch and sets origin upstream when missing", () =>
    withGitWorkerModule(async (module) => {
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
        createGitActionOptions(module),
      );

      const before = await readActionStatus(module, repo);
      expect(before.canPush).toBe(true);
      expect(before.pushNeedsUpstream).toBe(true);

      const result = await pushGitChanges({ cwd: repo }, createGitActionOptions(module));

      expect(result.status).toBe("success");
      const after = await readActionStatus(module, repo);
      expect(after.pushNeedsUpstream).toBe(false);
      expect(Boolean(after.upstreamBranch)).toBe(true);
      expect(after.commitsAhead).toBe(0);
    }),
  );
});
