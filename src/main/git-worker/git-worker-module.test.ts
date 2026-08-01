import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitWorkerMethod,
  GitWorkerMethodMap,
  GitWorkerRequest,
} from "../../shared/git-worker-protocol";
import { GitWorkerModule } from "./git-worker-module";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

function request<Method extends GitWorkerMethod>(
  method: Method,
  params: GitWorkerMethodMap[Method]["params"],
): GitWorkerRequest["request"] {
  return {
    id: `${method}-request`,
    method,
    params,
    enqueuedAtMs: Date.now(),
  } as GitWorkerRequest["request"];
}

describe("GitWorkerModule", () => {
  it("reads canonical metadata and tracked-first status from one repository owner", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodex-git-module-"));
    temporaryDirectories.push(root);
    await execFileAsync("git", ["init", "-q", "-b", "main", root]);
    await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", root, "config", "user.name", "Nodex Test"]);
    await writeFile(path.join(root, "tracked.txt"), "initial\n", "utf8");
    await execFileAsync("git", ["-C", root, "add", "tracked.txt"]);
    await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "initial"]);
    await writeFile(path.join(root, "tracked.txt"), "changed\n", "utf8");
    await writeFile(path.join(root, "staged.txt"), "staged\n", "utf8");
    await execFileAsync("git", ["-C", root, "add", "staged.txt"]);
    await writeFile(path.join(root, "untracked.txt"), "untracked\n", "utf8");

    const module = new GitWorkerModule();
    const metadata = await module.execute(
      request("stable-metadata", { cwd: root }),
      new AbortController().signal,
    );
    expect(metadata).toMatchObject({
      isGitRepository: true,
      currentBranch: "main",
      defaultBranch: "main",
    });
    const status = await module.execute(
      request("status-summary", { cwd: root }),
      new AbortController().signal,
    );
    expect(status).toEqual({
      type: "success",
      stagedCount: 1,
      unstagedCount: 1,
      untrackedCount: null,
      snapshotGeneration: 1,
    });
    const completeStatus = await module.execute(
      request("status-summary", { cwd: root, includeUntrackedFiles: true }),
      new AbortController().signal,
    );
    expect(completeStatus).toEqual({
      type: "success",
      stagedCount: 1,
      unstagedCount: 1,
      untrackedCount: 1,
      snapshotGeneration: 1,
    });

    const summary = await module.execute(
      request("review-summary", {
        cwd: root,
        source: "unstaged",
        includeUntrackedFiles: false,
      }),
      new AbortController().signal,
    ) as GitWorkerMethodMap["review-summary"]["result"];
    expect(summary).toMatchObject({
      type: "success",
      source: "unstaged",
      stageCounts: {
        stagedFileCount: 1,
        unstagedFileCount: 1,
      },
    });
    if (summary.type !== "success") throw new Error("Expected review summary");
    const changedFile = summary.files.find((file) => file.path === "tracked.txt");
    expect(changedFile).toBeDefined();
    const diff = await module.execute(
      request("review-diff", {
        cwd: root,
        source: "unstaged",
        files: changedFile ? [{
          path: changedFile.path,
          previousPath: changedFile.previousPath,
          revision: changedFile.revision,
          status: changedFile.status,
        }] : [],
        snapshotGeneration: summary.snapshotGeneration,
      }),
      new AbortController().signal,
    );
    expect(diff).toMatchObject({
      type: "success",
      source: "unstaged",
      files: [{ path: "tracked.txt", loadStatus: "loaded" }],
    });
    module.dispose();
  });

  it("returns typed non-repository results", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodex-git-module-empty-"));
    temporaryDirectories.push(root);
    const module = new GitWorkerModule();

    await expect(module.execute(
      request("stable-metadata", { cwd: root }),
      new AbortController().signal,
    )).resolves.toMatchObject({
      isGitRepository: false,
      errorMessage: null,
    });
    await expect(module.execute(
      request("status-summary", { cwd: root }),
      new AbortController().signal,
    )).resolves.toEqual({
      type: "error",
      failureReason: "not-a-repository",
      errorMessage: null,
    });
    module.dispose();
  });

  it("shares one bounded untracked scan across a complete read wave", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodex-git-module-wave-"));
    temporaryDirectories.push(root);
    await execFileAsync("git", ["init", "-q", "-b", "main", root]);
    await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", root, "config", "user.name", "Nodex Test"]);
    await writeFile(path.join(root, "tracked.txt"), "initial\n", "utf8");
    await execFileAsync("git", ["-C", root, "add", "tracked.txt"]);
    await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "initial"]);
    const bulk = path.join(root, "bulk");
    await mkdir(bulk);
    await Promise.all(Array.from({ length: 270 }, (_, index) =>
      writeFile(path.join(bulk, `file-${index}.txt`), `${index}\n`, "utf8")));
    const metrics: import("../../shared/git-worker-protocol").GitPerformanceOperationMetric[] = [];
    const module = new GitWorkerModule({
      publish: (event) => {
        if (event.type === "git-performance-operation") metrics.push(event.metric);
      },
    });

    const [status, summary, branchStats] = await Promise.all([
      module.execute(
        request("status-summary", { cwd: root, includeUntrackedFiles: true }),
        new AbortController().signal,
      ),
      module.execute(
        request("review-summary", {
          cwd: root,
          source: "unstaged",
          includeUntrackedFiles: true,
        }),
        new AbortController().signal,
      ),
      module.execute(
        request("branch-diff-stats", {
          cwd: root,
          includeUntrackedFiles: true,
        }),
        new AbortController().signal,
      ),
    ]);

    expect(status).toMatchObject({ type: "success", untrackedCount: 270 });
    expect(summary).toMatchObject({
      type: "success",
      untrackedFilesOmitted: 14,
    });
    expect(branchStats).toMatchObject({
      fileCount: 270,
      untrackedFilesOmitted: 14,
    });
    expect(metrics.reduce(
      (total, metric) => total + metric.fullUntrackedScanCount,
      0,
    )).toBe(1);
    expect(Math.max(...metrics.map((metric) => metric.peakConcurrency))).toBe(1);
    module.dispose();
  });

  it("serializes repository mutations and advances the shared generation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodex-git-module-mutate-"));
    temporaryDirectories.push(root);
    const module = new GitWorkerModule();
    const initialized = await module.execute(
      request("git-init-repo", { cwd: root }),
      new AbortController().signal,
    ) as GitWorkerMethodMap["git-init-repo"]["result"];
    expect(initialized.isGitRepository).toBe(true);
    const initialGeneration = initialized.snapshotGeneration;
    await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", root, "config", "user.name", "Nodex Test"]);
    await writeFile(path.join(root, "note.txt"), "initial\n", "utf8");

    const committed = await module.execute(
      request("commit", {
        cwd: root,
        message: "initial",
        includeUnstaged: true,
        nextStep: "commit",
      }),
      new AbortController().signal,
    ) as GitWorkerMethodMap["commit"]["result"];
    expect(committed).toMatchObject({ status: "success", branch: "main" });

    const created = await module.execute(
      request("create-branch", { cwd: root, branch: "feature/worker" }),
      new AbortController().signal,
    ) as GitWorkerMethodMap["create-branch"]["result"];
    expect(created).toEqual({
      type: "success",
      value: {
        currentBranch: "feature/worker",
        defaultBranch: "main",
        branches: ["feature/worker", "main"],
      },
    });
    const refreshed = await module.execute(
      request("refresh-repository", { cwd: root }),
      new AbortController().signal,
    ) as GitWorkerMethodMap["refresh-repository"]["result"];
    expect(refreshed.type).toBe("success");
    if (refreshed.type === "success") {
      expect(refreshed.generation).toBeGreaterThan(initialGeneration);
    }
    module.dispose();
  });
});
