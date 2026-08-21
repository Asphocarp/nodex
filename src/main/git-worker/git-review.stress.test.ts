import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import type {
  GitPerformanceOperationMetric,
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
    id: `${method}-stress-request`,
    method,
    params,
    enqueuedAtMs: Date.now(),
  } as GitWorkerRequest["request"];
}

describe("Git review read wave stress", () => {
  test("shares one bounded untracked scan across concurrent review reads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodex-git-review-stress-"));
    temporaryDirectories.push(root);
    await execFileAsync("git", ["init", "-q", "-b", "main", root]);
    await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", root, "config", "user.name", "Nodex Test"]);
    await writeFile(path.join(root, "tracked.txt"), "initial\n", "utf8");
    await execFileAsync("git", ["-C", root, "add", "tracked.txt"]);
    await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "initial"]);
    const bulk = path.join(root, "bulk");
    await mkdir(bulk);
    await Promise.all(
      Array.from({ length: 270 }, (_, index) =>
        writeFile(path.join(bulk, `file-${index}.txt`), `${index}\n`, "utf8"),
      ),
    );

    const metrics: GitPerformanceOperationMetric[] = [];
    const module = new GitWorkerModule({
      publish: (event) => {
        if (event.type === "git-performance-operation") metrics.push(event.metric);
      },
    });
    const signal = new AbortController().signal;

    try {
      const [status, summary, branchStats] = await Promise.all([
        module.execute(
          request("status-summary", { cwd: root, includeUntrackedFiles: true }),
          signal,
        ),
        module.execute(
          request("review-summary", {
            cwd: root,
            source: "unstaged",
            includeUntrackedFiles: true,
          }),
          signal,
        ),
        module.execute(
          request("branch-diff-stats", {
            cwd: root,
            includeUntrackedFiles: true,
          }),
          signal,
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
      expect(metrics.reduce((total, metric) => total + metric.fullUntrackedScanCount, 0)).toBe(1);
      expect(metrics.reduce((total, metric) => total + metric.unscopedAllStatusCount, 0)).toBe(0);
      expect(Math.max(...metrics.map((metric) => metric.peakConcurrency))).toBe(1);
      expect(metrics.some((metric) => metric.coalescedQueries > 0)).toBe(true);
    } finally {
      module.dispose();
    }
  });
});
