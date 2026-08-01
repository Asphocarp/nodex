import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type {
  GitPerformanceOperationMetric,
  GitWorkerLiveQueryEvent,
  GitWorkerMethod,
  GitWorkerMethodMap,
  GitWorkerRequest,
} from "../../shared/git-worker-protocol";
import { GitWorkerModule } from "./git-worker-module";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { force: true, recursive: true });
  }));
});

function request<Method extends GitWorkerMethod>(
  id: string,
  method: Method,
  params: GitWorkerMethodMap[Method]["params"],
): GitWorkerRequest["request"] {
  return { id, method, params, enqueuedAtMs: Date.now() } as GitWorkerRequest["request"];
}

function waitForCondition(
  condition: () => boolean,
  timeoutMs = 30_000,
): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - startedAt < timeoutMs) return;
      clearInterval(interval);
      reject(new Error("Timed out waiting for Git stress fixture to settle"));
    }, 10);
  });
}

describe("Git review worker stress", () => {
  it("coalesces a complete live wave and bounds repository reads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nodex-git-review-stress-"));
    temporaryDirectories.push(root);
    await execFileAsync("git", ["init", "-q", "-b", "main", root]);
    await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", root, "config", "user.name", "Nodex Test"]);
    await mkdir(path.join(root, "bulk"));
    await writeFile(path.join(root, ".gitignore"), "ignored/\nbulk/*.tmp\n", "utf8");
    await writeFile(path.join(root, "bulk", ".gitignore"), "nested-ignored/\n", "utf8");
    await writeFile(path.join(root, "tracked.txt"), "initial\n", "utf8");
    await execFileAsync("git", ["-C", root, "add", ".gitignore", "bulk/.gitignore", "tracked.txt"]);
    await execFileAsync("git", ["-C", root, "commit", "-q", "-m", "initial"]);
    await writeFile(path.join(root, "tracked.txt"), "changed\n", "utf8");
    await Promise.all([
      ...Array.from({ length: 270 }, (_, index) =>
        writeFile(path.join(root, "bulk", `file-${index}.txt`), `${index}\n`, "utf8")),
      ...Array.from({ length: 20 }, (_, index) =>
        writeFile(path.join(root, "bulk", `ignored-${index}.tmp`), `${index}\n`, "utf8")),
    ]);

    const metrics: GitPerformanceOperationMetric[] = [];
    const publications: GitWorkerLiveQueryEvent["event"][] = [];
    const module = new GitWorkerModule({
      publish: (event) => {
        if (event.type === "git-performance-operation") {
          metrics.push(event.metric);
          return;
        }
        publications.push(event.event);
      },
    });
    const signal = new AbortController().signal;
    await Promise.all([
      module.execute(request("subscribe-status", "subscribe-live-query", {
        subscriptionId: "status",
        query: {
          method: "status-summary",
          params: { cwd: root, includeUntrackedFiles: true },
        },
      }), signal),
      module.execute(request("subscribe-summary", "subscribe-live-query", {
        subscriptionId: "summary",
        query: {
          method: "review-summary",
          params: { cwd: root, source: "unstaged", includeUntrackedFiles: true },
        },
      }), signal),
      module.execute(request("subscribe-stats", "subscribe-live-query", {
        subscriptionId: "stats",
        query: {
          method: "branch-diff-stats",
          params: { cwd: root, includeUntrackedFiles: true },
        },
      }), signal),
    ]);

    await waitForCondition(() => publications.some((event) =>
      event.type === "git-live-query-updated"
      && event.subscriptionId === "summary"
      && event.phase === "tracked"));
    const directSummary = module.execute(
      request("direct-summary", "review-summary", {
        cwd: root,
        source: "unstaged",
        includeUntrackedFiles: true,
      }),
      signal,
    );
    await waitForCondition(() => ["status", "summary", "stats"].every(
      (subscriptionId) => publications.some((event) =>
        event.type === "git-live-query-updated"
        && event.subscriptionId === subscriptionId
        && event.phase === "complete"),
    ));
    await expect(directSummary).resolves.toMatchObject({
      type: "success",
      untrackedFilesOmitted: 14,
    });

    const summaryPhases = publications.flatMap((event) =>
      event.type === "git-live-query-updated" && event.subscriptionId === "summary"
        ? [event.phase]
        : []);
    expect(summaryPhases.indexOf("tracked")).toBeLessThan(
      summaryPhases.indexOf("complete"),
    );
    const branchComplete = publications.find((event) =>
      event.type === "git-live-query-updated"
      && event.subscriptionId === "stats"
      && event.phase === "complete");
    expect(branchComplete).toMatchObject({
      result: { fileCount: 270, untrackedFilesOmitted: 14 },
    });
    expect(metrics.reduce(
      (total, metric) => total + metric.fullUntrackedScanCount,
      0,
    )).toBe(1);
    expect(metrics.reduce(
      (total, metric) => total + metric.unscopedAllStatusCount,
      0,
    )).toBe(0);
    expect(Math.max(...metrics.map((metric) => metric.peakConcurrency))).toBe(1);
    expect(metrics.some((metric) => metric.coalescedQueries > 0)).toBe(true);
    module.dispose();
  });
});
