import { afterEach, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyGitReviewPatch,
  initializeGitRepositoryAndReadReviewSnapshot,
  readBranchDiffStats,
  readGitReviewBlameFile,
  readGitReviewBranchCommits,
  readGitReviewCatFile,
  readGitReviewDiff,
  readGitReviewFileContents,
  readGitReviewPatch,
  readGitReviewSnapshot,
  readGitReviewSummary,
  resolveGitMergeBase,
  searchGitReview,
} from "./git-review-service";
import { subscribeGitReviewSummary } from "./git-review-live-service";
import type {
  GitReviewLiveSummaryEvent,
  GitReviewSearchResult,
  ReviewDiffResult,
  ReviewDiffSuccessResult,
} from "../shared/types";

type GitReviewSearchSuccess = Extract<GitReviewSearchResult, { type: "success" }>;

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function initializeRepository(cwd: string): void {
  runGit(cwd, ["init", "-b", "main"]);
  runGit(cwd, ["config", "user.name", "Nodex Test"]);
  runGit(cwd, ["config", "user.email", "nodex@example.com"]);
}

function commitAll(cwd: string, message: string): void {
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", message]);
}

function expectSuccessfulDiff(
  result: ReviewDiffResult,
): asserts result is ReviewDiffSuccessResult {
  expect(result.type).toBe("success");
  if (result.type !== "success") throw new Error("Expected a successful diff.");
}

function expectSuccessfulSearch(
  result: GitReviewSearchResult,
): asserts result is GitReviewSearchSuccess {
  expect(result.type).toBe("success");
  if (result.type !== "success") throw new Error("Expected search result.");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("git review service", () => {
  test("reports non-git directories without throwing", async () => {
    const cwd = createTempDir("nodex-git-review-non-git-");

    const snapshot = await readGitReviewSnapshot({
      cwd,
      source: "unstaged",
    });

    expect(snapshot.isGitRepository).toBe(false);
    expect(snapshot.files.length).toBe(0);
    expect(snapshot.patch).toBe("");
  });

  test("returns unstaged snapshots with tracked and untracked files", async () => {
    const cwd = createTempDir("nodex-git-review-unstaged-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
    writeFileSync(
      path.join(cwd, "new-file.ts"),
      "export const staged = false;\n",
      "utf8",
    );

    const snapshot = await readGitReviewSnapshot({
      cwd,
      source: "unstaged",
    });

    expect(snapshot.isGitRepository).toBe(true);
    expect(snapshot.files.length).toBe(2);
    expect(snapshot.files.some((file) => file.path === "README.md")).toBe(true);
    expect(
      snapshot.files.some((file) => file.path === "new-file.ts"),
    ).toBe(true);
    expect(snapshot.patch).toBe("");
  });

  test("reports untracked binary files without decoding them as text", async () => {
    const cwd = createTempDir("nodex-git-review-untracked-binary-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(
      path.join(cwd, "image.png"),
      Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x00,
        ...Buffer.from("secret-binary-body"),
      ]),
    );

    const snapshot = await readGitReviewSnapshot({
      cwd,
      source: "unstaged",
    });
    const file =
      snapshot.files.find((candidate) => candidate.path === "image.png") ??
      null;
    const diff = await readGitReviewDiff({
      cwd,
      source: "unstaged",
      files: [{
        path: "image.png",
        status: file?.status ?? "untracked",
        revision: file?.revision,
      }],
      snapshotGeneration: snapshot.snapshotGeneration,
    });
    expectSuccessfulDiff(diff);
    const contents = await readGitReviewFileContents({
      cwd,
      source: "unstaged",
      path: "image.png",
    });
    const bodySearch = await searchGitReview({
      cwd,
      source: "unstaged",
      query: "secret-binary-body",
      snapshotGeneration: snapshot.snapshotGeneration,
    });
    const pathSearch = await searchGitReview({
      cwd,
      source: "unstaged",
      query: "image.png",
      snapshotGeneration: snapshot.snapshotGeneration,
    });
    expectSuccessfulSearch(bodySearch);
    expectSuccessfulSearch(pathSearch);

    expect(file !== null).toBe(true);
    expect(file?.safety.binary ?? false).toBe(true);
    expect(file ? file.additions : "missing").toBe(null);
    expect(file ? file.deletions : "missing").toBe(null);
    expect(snapshot.patch.includes("secret-binary-body")).toBe(false);
    expect(diff.files[0]?.loadStatus ?? "").toBe("binary");
    expect(diff.files[0]?.diff ?? "not-empty").toBe("");
    expect(contents.newStatus).toBe("binary");
    expect(contents.newText).toBe(null);
    expect(bodySearch.matchingPaths.length).toBe(0);
    expect(pathSearch.matchingPaths[0] ?? "").toBe("image.png");
  });

  test("returns staged snapshots from the git index", async () => {
    const cwd = createTempDir("nodex-git-review-staged-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
    runGit(cwd, ["add", "README.md"]);

    const snapshot = await readGitReviewSnapshot({
      cwd,
      source: "staged",
    });

    expect(snapshot.isGitRepository).toBe(true);
    expect(snapshot.files.length).toBe(1);
    expect(snapshot.files[0]?.path).toBe("README.md");
    expect(snapshot.files[0]?.revision !== null).toBe(true);
    const diff = await readGitReviewDiff({
      cwd,
      source: "staged",
      files: [{
        path: "README.md",
        status: snapshot.files[0]?.status ?? "modified",
        revision: snapshot.files[0]?.revision,
      }],
      snapshotGeneration: snapshot.snapshotGeneration,
    });
    expectSuccessfulDiff(diff);
    expect(diff.patch.includes("@@ -1 +1,2 @@")).toBe(true);
  });

  test("reports staged binary files from numstat metadata", async () => {
    const cwd = createTempDir("nodex-git-review-staged-binary-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(
      path.join(cwd, "logo.png"),
      Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x00,
        ...Buffer.from("binary-logo-body"),
      ]),
    );
    runGit(cwd, ["add", "logo.png"]);

    const snapshot = await readGitReviewSnapshot({
      cwd,
      source: "staged",
    });

    expect(snapshot.files.length).toBe(1);
    expect(snapshot.files[0]?.path ?? "").toBe("logo.png");
    expect(snapshot.files[0]?.safety.binary ?? false).toBe(true);
    expect(snapshot.files[0] ? snapshot.files[0].additions : "missing").toBe(
      null,
    );
    expect(snapshot.files[0] ? snapshot.files[0].deletions : "missing").toBe(
      null,
    );
  });

  test("returns branch snapshots against the default branch", async () => {
    const cwd = createTempDir("nodex-git-review-branch-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");
    runGit(cwd, ["checkout", "--quiet", "-b", "feature/review"]);
    writeFileSync(
      path.join(cwd, "feature.ts"),
      "export const branchDiff = true;\n",
      "utf8",
    );
    commitAll(cwd, "feature");

    const snapshot = await readGitReviewSnapshot({
      cwd,
      source: "branch",
    });

    expect(snapshot.isGitRepository).toBe(true);
    expect(snapshot.baseRef).toBe("main");
    expect(snapshot.files.length).toBe(1);
    expect(snapshot.files[0]?.path).toBe("feature.ts");
  });

  test("returns branch commits against the merge base", async () => {
    const cwd = createTempDir("nodex-git-review-branch-commits-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");
    runGit(cwd, ["checkout", "--quiet", "-b", "feature/review"]);
    writeFileSync(
      path.join(cwd, "feature-a.ts"),
      "export const featureA = true;\n",
      "utf8",
    );
    commitAll(cwd, "feat: add feature a");
    writeFileSync(
      path.join(cwd, "feature-b.ts"),
      "export const featureB = true;\n",
      "utf8",
    );
    commitAll(cwd, "fix: add feature b");

    const result = await readGitReviewBranchCommits({
      cwd,
      baseBranch: "main",
      operationSource: "review_model",
    });

    expect(result.errorMessage).toBe(null);
    expect(result.baseBranch).toBe("main");
    expect(result.commits.length).toBe(2);
    expect(result.commits.map((commit) => commit.subject).join("|")).toBe(
      "fix: add feature b|feat: add feature a",
    );
  });

  test("returns commit snapshots for a selected commit", async () => {
    const cwd = createTempDir("nodex-git-review-commit-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");
    writeFileSync(
      path.join(cwd, "feature.ts"),
      "export const committed = true;\n",
      "utf8",
    );
    commitAll(cwd, "feature");
    const commitSha = runGit(cwd, ["rev-parse", "HEAD"]).trim();

    const snapshot = await readGitReviewSnapshot({
      cwd,
      source: "commit",
      commitSha,
    });

    expect(snapshot.isGitRepository).toBe(true);
    expect(snapshot.source).toBe("commit");
    expect(snapshot.files.length).toBe(1);
    expect(snapshot.files[0]?.path).toBe("feature.ts");
    expect(snapshot.patch).toBe("");
    const diff = await readGitReviewDiff({
      cwd,
      source: "commit",
      commitSha,
      files: [{
        path: "feature.ts",
        status: snapshot.files[0]?.status ?? "added",
        revision: snapshot.files[0]?.revision,
      }],
      snapshotGeneration: snapshot.snapshotGeneration,
    });
    expectSuccessfulDiff(diff);
    expect(diff.patch.includes("+++ b/feature.ts")).toBe(true);
  });

  test("returns codex-shaped per-file review diffs", async () => {
    const cwd = createTempDir("nodex-git-review-diff-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
    writeFileSync(
      path.join(cwd, "feature.ts"),
      "export const feature = true;\n",
      "utf8",
    );

    const snapshot = await readGitReviewSnapshot({
      cwd,
      source: "unstaged",
    });
    const result = await readGitReviewDiff({
      cwd,
      source: "unstaged",
      files: [{
        path: "feature.ts",
        status:
          snapshot.files.find((file) => file.path === "feature.ts")?.status ??
          "untracked",
        revision:
          snapshot.files.find((file) => file.path === "feature.ts")?.revision,
      }],
      snapshotGeneration: snapshot.snapshotGeneration,
    });
    expectSuccessfulDiff(result);

    expect(result.isGitRepository).toBe(true);
    expect(result.files.length).toBe(1);
    expect(result.files[0]?.path).toBe("feature.ts");
    expect(result.files[0]?.loadStatus).toBe("loaded");
    expect(result.patch.includes("README.md")).toBe(false);
  });

  test("returns branch diff stats and merge base", async () => {
    const cwd = createTempDir("nodex-git-review-branch-stats-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");
    const mainHead = runGit(cwd, ["rev-parse", "HEAD"]).trim();
    runGit(cwd, ["checkout", "--quiet", "-b", "feature/review"]);
    writeFileSync(
      path.join(cwd, "feature.ts"),
      "export const branchDiff = true;\n",
      "utf8",
    );
    commitAll(cwd, "feature");

    const stats = await readBranchDiffStats({
      cwd,
      baseBranch: "main",
    });
    const mergeBase = await resolveGitMergeBase({
      cwd,
      baseBranch: "main",
    });

    expect(stats.files.length).toBe(1);
    expect(stats.additions).toBe(1);
    expect(mergeBase.mergeBaseSha).toBe(mainHead);
  });

  test("returns generic review summary totals", async () => {
    const cwd = createTempDir("nodex-git-review-summary-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
    const summary = await readGitReviewSummary({
      cwd,
      source: "unstaged",
    });

    expect(summary.type).toBe("success");
    if (summary.type !== "success") throw new Error("Expected summary.");
    expect(summary.source).toBe("unstaged");
    expect(summary.files.length).toBe(1);
    expect(summary.files[0]?.additions).toBe(1);
    expect(summary.files[0]?.deletions).toBe(0);
  });

  test("publishes a debounced complete live summary with a new snapshot generation", async () => {
    const cwd = createTempDir("nodex-git-review-live-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");
    const initial = await readGitReviewSummary({ cwd, source: "unstaged" });
    if (initial.type !== "success") throw new Error("Expected summary.");

    let resolveEvent: ((event: GitReviewLiveSummaryEvent) => void) | null = null;
    let rejectEvent: ((error: Error) => void) | null = null;
    const eventPromise = new Promise<GitReviewLiveSummaryEvent>(
      (resolve, reject) => {
        resolveEvent = resolve;
        rejectEvent = reject;
      },
    );
    const timeout = setTimeout(() => {
      rejectEvent?.(new Error("Timed out waiting for live review summary."));
    }, 5_000);
    const subscription = subscribeGitReviewSummary({
      subscriptionId: "integration-live",
      request: { cwd, source: "unstaged" },
      publish: (event) => {
        if (
          event.type !== "git-live-query-updated" ||
          event.phase !== "complete"
        )
          return;
        clearTimeout(timeout);
        resolveEvent?.(event);
      },
    });
    try {
      writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
      subscription.refresh();
      const event = await eventPromise;

      expect(event.type).toBe("git-live-query-updated");
      if (event.type !== "git-live-query-updated") {
        throw new Error("Expected update event.");
      }
      if (event.result.type !== "success") throw new Error("Expected summary.");
      expect(event.result.snapshotGeneration).toBeGreaterThan(
        initial.snapshotGeneration,
      );
      expect(event.result.files[0]?.path).toBe("README.md");
    } finally {
      clearTimeout(timeout);
      subscription.dispose();
    }
  });

  test("reads a full review patch separately from the metadata snapshot", async () => {
    const cwd = createTempDir("nodex-git-review-full-patch-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
    const snapshot = await readGitReviewSnapshot({
      cwd,
      source: "unstaged",
    });
    const patch = await readGitReviewPatch({
      cwd,
      source: "unstaged",
    });

    expect(snapshot.patch).toBe("");
    expect(patch.diff.type).toBe("success");
    const unifiedDiff =
      patch.diff.type === "success" ? patch.diff.unifiedDiff : "";
    expect(
      Boolean(unifiedDiff.includes("diff --git a/README.md b/README.md")),
    ).toBe(true);
    expect(Boolean(unifiedDiff.includes("+beta"))).toBe(true);
  });

  test("initializes a git repository when requested", async () => {
    const cwd = createTempDir("nodex-git-review-init-");

    const snapshot = await initializeGitRepositoryAndReadReviewSnapshot(cwd);

    expect(snapshot.isGitRepository).toBe(true);
    expect(snapshot.currentBranch).toBe("main");
  });

  test("stages an unstaged file patch through git apply", async () => {
    const cwd = createTempDir("nodex-git-review-apply-stage-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
    const unstagedSnapshot = await readGitReviewSnapshot({
      cwd,
      source: "unstaged",
    });
    const unstagedDiff = await readGitReviewDiff({
      cwd,
      source: "unstaged",
      files: [{
        path: "README.md",
        status: unstagedSnapshot.files[0]?.status ?? "modified",
        revision: unstagedSnapshot.files[0]?.revision,
      }],
      snapshotGeneration: unstagedSnapshot.snapshotGeneration,
    });
    expectSuccessfulDiff(unstagedDiff);

    const result = await applyGitReviewPatch({
      cwd,
      diff: unstagedDiff.patch,
      target: "staged",
    });
    const stagedSnapshot = await readGitReviewSnapshot({
      cwd,
      source: "staged",
    });

    expect(result.status).toBe("success");
    expect(stagedSnapshot.files.length).toBe(1);
    expect(stagedSnapshot.files[0]?.path).toBe("README.md");
  });

  test("reverts a staged file patch through git apply", async () => {
    const cwd = createTempDir("nodex-git-review-apply-revert-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
    runGit(cwd, ["add", "README.md"]);
    const stagedSnapshot = await readGitReviewSnapshot({
      cwd,
      source: "staged",
    });
    const stagedDiff = await readGitReviewDiff({
      cwd,
      source: "staged",
      files: [{
        path: "README.md",
        status: stagedSnapshot.files[0]?.status ?? "modified",
        revision: stagedSnapshot.files[0]?.revision,
      }],
      snapshotGeneration: stagedSnapshot.snapshotGeneration,
    });
    expectSuccessfulDiff(stagedDiff);

    const result = await applyGitReviewPatch({
      cwd,
      diff: stagedDiff.patch,
      target: "staged",
      revert: true,
    });
    const nextStagedSnapshot = await readGitReviewSnapshot({
      cwd,
      source: "staged",
    });

    expect(result.status).toBe("success");
    expect(nextStagedSnapshot.files.length).toBe(0);
  });

  test("applies and reverts binary patches through git apply", async () => {
    const cwd = createTempDir("nodex-git-review-apply-binary-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "logo.bin"), Buffer.from([0, 1, 2, 3, 4]));
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "logo.bin"), Buffer.from([0, 1, 9, 9, 4]));
    const binaryPatch = runGit(cwd, ["diff", "--binary", "--", "logo.bin"]);

    const applyResult = await applyGitReviewPatch({
      cwd,
      diff: binaryPatch,
      target: "staged",
    });
    const stagedSnapshot = await readGitReviewSnapshot({
      cwd,
      source: "staged",
    });

    expect(applyResult.status).toBe("success");
    expect(stagedSnapshot.files.length).toBe(1);
    expect(stagedSnapshot.files[0]?.path ?? "").toBe("logo.bin");

    const revertResult = await applyGitReviewPatch({
      cwd,
      diff: binaryPatch,
      target: "staged",
      revert: true,
    });
    const nextStagedSnapshot = await readGitReviewSnapshot({
      cwd,
      source: "staged",
    });

    expect(revertResult.status).toBe("success");
    expect(nextStagedSnapshot.files.length).toBe(0);
  });

  test("reads review file contents for unstaged diffs", async () => {
    const cwd = createTempDir("nodex-git-review-file-contents-unstaged-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");

    const result = await readGitReviewFileContents({
      cwd,
      source: "unstaged",
      path: "README.md",
    });

    expect(result.oldExists).toBe(true);
    expect(result.newExists).toBe(true);
    expect(result.oldText?.includes("alpha")).toBe(true);
    expect(result.newText?.includes("beta")).toBe(true);
  });

  test("reads Git objects in a generation-bound batch with disk fallback", async () => {
    const cwd = createTempDir("nodex-git-review-cat-file-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");
    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");

    const snapshot = await readGitReviewSnapshot({ cwd, source: "unstaged" });
    const file = snapshot.files[0];
    if (!file) throw new Error("Expected an unstaged file.");
    const result = await readGitReviewCatFile({
      cwd,
      snapshotGeneration: snapshot.snapshotGeneration,
      requests: [
        {
          oid: file.oldOid,
          path: file.previousPath ?? file.path,
        },
        {
          oid: null,
          path: file.path,
          fallbackToDisk: true,
        },
      ],
    });

    expect(result.results[0]).toEqual({
      type: "success",
      lines: ["alpha\n"],
    });
    expect(result.results[1]).toEqual({
      type: "success",
      lines: ["alpha\n", "beta\n"],
    });
  });

  test("parses multibyte object sizes and applies the five MiB disk cap", async () => {
    const cwd = createTempDir("nodex-git-review-cat-file-bytes-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "utf8.txt"), "你好🙂\nsecond\n", "utf8");
    commitAll(cwd, "initial");
    writeFileSync(path.join(cwd, "medium.txt"), Buffer.alloc(2 * 1024 * 1024, 97));
    writeFileSync(path.join(cwd, "too-large.txt"), Buffer.alloc(5_242_881, 98));

    const snapshot = await readGitReviewSnapshot({ cwd, source: "unstaged" });
    const result = await readGitReviewCatFile({
      cwd,
      snapshotGeneration: snapshot.snapshotGeneration,
      requests: [
        { oid: "HEAD:utf8.txt", path: "utf8.txt" },
        { oid: null, path: "medium.txt", fallbackToDisk: true },
        { oid: null, path: "too-large.txt", fallbackToDisk: true },
      ],
    });

    expect(result.results[0]).toEqual({
      type: "success",
      lines: ["你好🙂\n", "second\n"],
    });
    expect(result.results[1]).toMatchObject({ type: "success" });
    expect(result.results[2]).toEqual({
      type: "error",
      error: { type: "too-large", limitBytes: 5_242_880 },
    });
  });

  test("rejects stale snapshot generations before publishing file data", async () => {
    const cwd = createTempDir("nodex-git-review-stale-generation-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");
    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
    const snapshot = await readGitReviewSnapshot({ cwd, source: "unstaged" });

    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\ngamma\n", "utf8");
    const catFile = await readGitReviewCatFile({
      cwd,
      snapshotGeneration: snapshot.snapshotGeneration,
      requests: [
        {
          oid: snapshot.files[0]?.oldOid ?? null,
          path: "README.md",
        },
      ],
    });

    expect(catFile.results).toEqual([
      { type: "error", error: { type: "unknown" } },
    ]);
    await expect(
      readGitReviewDiff({
        cwd,
        source: "unstaged",
        files: [{ path: "README.md", status: "modified" }],
        snapshotGeneration: snapshot.snapshotGeneration,
      }),
    ).resolves.toEqual({ type: "stale-snapshot", source: "unstaged" });
  });

  test("reads review file contents for staged new files", async () => {
    const cwd = createTempDir("nodex-git-review-file-contents-staged-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(
      path.join(cwd, "feature.ts"),
      "export const feature = true;\n",
      "utf8",
    );
    runGit(cwd, ["add", "feature.ts"]);

    const result = await readGitReviewFileContents({
      cwd,
      source: "staged",
      path: "feature.ts",
    });

    expect(result.oldExists).toBe(false);
    expect(result.newExists).toBe(true);
    expect(result.newText?.includes("feature")).toBe(true);
  });

  test("reads review file contents for commit sources", async () => {
    const cwd = createTempDir("nodex-git-review-file-contents-commit-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");
    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
    commitAll(cwd, "feature");
    const commitSha = runGit(cwd, ["rev-parse", "HEAD"]).trim();

    const result = await readGitReviewFileContents({
      cwd,
      source: "commit",
      path: "README.md",
      commitSha,
    });

    expect(result.oldExists).toBe(true);
    expect(result.newExists).toBe(true);
    expect(result.oldText?.includes("beta")).toBe(false);
    expect(result.newText?.includes("beta")).toBe(true);
  });

  test("reads git blame for file source tabs", async () => {
    const cwd = createTempDir("nodex-git-review-blame-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    const result = await readGitReviewBlameFile({
      cwd,
      path: "README.md",
    });

    expect(result.errorMessage).toBe(null);
    expect(result.lines.length).toBe(1);
    expect(result.lines[0]?.author).toBe("Nodex Test");
  });

  test("searches git review content across file paths and contents", async () => {
    const cwd = createTempDir("nodex-git-review-search-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(
      path.join(cwd, "feature.ts"),
      "export const reviewSearch = true;\n",
      "utf8",
    );
    runGit(cwd, ["add", "feature.ts"]);
    const snapshot = await readGitReviewSnapshot({ cwd, source: "staged" });

    const result = await searchGitReview({
      cwd,
      source: "staged",
      query: "reviewsearch",
      snapshotGeneration: snapshot.snapshotGeneration,
    });
    expectSuccessfulSearch(result);

    expect(result.matchingPaths.length).toBe(1);
    expect(result.matchingPaths[0]).toBe("feature.ts");
  });

  test("excludes generated file bodies while preserving generated path matches", async () => {
    const cwd = createTempDir("nodex-git-review-search-generated-");
    initializeRepository(cwd);
    writeFileSync(
      path.join(cwd, ".gitattributes"),
      "generated.ts linguist-generated\n",
      "utf8",
    );
    writeFileSync(path.join(cwd, "generated.ts"), "export const base = 1;\n", "utf8");
    commitAll(cwd, "initial");
    writeFileSync(
      path.join(cwd, "generated.ts"),
      "export const generatedNeedle = true;\n",
      "utf8",
    );
    const snapshot = await readGitReviewSnapshot({ cwd, source: "unstaged" });

    const bodyResult = await searchGitReview({
      cwd,
      source: "unstaged",
      query: "generatedneedle",
      snapshotGeneration: snapshot.snapshotGeneration,
    });
    const pathResult = await searchGitReview({
      cwd,
      source: "unstaged",
      query: "generated.ts",
      snapshotGeneration: snapshot.snapshotGeneration,
    });
    expectSuccessfulSearch(bodyResult);
    expectSuccessfulSearch(pathResult);

    expect(bodyResult.matchingPaths).toEqual([]);
    expect(pathResult.matchingPaths).toEqual(["generated.ts"]);
  });

  test("caps stored search matches at 250 while counting the full diff stream", async () => {
    const cwd = createTempDir("nodex-git-review-search-cap-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "matches.ts"), "export const base = 1;\n", "utf8");
    commitAll(cwd, "initial");
    writeFileSync(
      path.join(cwd, "matches.ts"),
      Array.from({ length: 300 }, (_, index) => `needle ${index}\n`).join(""),
      "utf8",
    );
    const snapshot = await readGitReviewSnapshot({ cwd, source: "unstaged" });

    const result = await searchGitReview({
      cwd,
      source: "unstaged",
      query: "needle",
      limit: 250,
      snapshotGeneration: snapshot.snapshotGeneration,
    });
    expectSuccessfulSearch(result);

    expect(result.matchingPaths).toHaveLength(250);
    expect(result.totalMatches).toBe(300);
    expect(result.isCapped).toBe(true);
  });
});
