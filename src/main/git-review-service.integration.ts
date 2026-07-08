import { afterEach, describe, expect, test } from "bun:test";
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
  readGitReviewDiff,
  readGitReviewFileContents,
  readGitReviewPatch,
  readGitReviewSnapshot,
  readGitReviewSummary,
  resolveGitMergeBase,
  searchGitReview,
} from "./git-review-service";

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

    expect(snapshot.isGitRepository).toBeFalse();
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

    expect(snapshot.isGitRepository).toBeTrue();
    expect(snapshot.files.length).toBe(2);
    expect(snapshot.files.some((file) => file.path === "README.md")).toBeTrue();
    expect(
      snapshot.files.some((file) => file.path === "new-file.ts"),
    ).toBeTrue();
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
      files: ["image.png"],
    });
    const contents = await readGitReviewFileContents({
      cwd,
      source: "unstaged",
      path: "image.png",
    });
    const bodySearch = await searchGitReview({
      cwd,
      source: "unstaged",
      query: "secret-binary-body",
    });
    const pathSearch = await searchGitReview({
      cwd,
      source: "unstaged",
      query: "image.png",
    });

    expect(file !== null).toBeTrue();
    expect(file?.safety.binary ?? false).toBeTrue();
    expect(file ? file.additions : "missing").toBe(null);
    expect(file ? file.deletions : "missing").toBe(null);
    expect(snapshot.patch.includes("secret-binary-body")).toBeFalse();
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

    expect(snapshot.isGitRepository).toBeTrue();
    expect(snapshot.files.length).toBe(1);
    expect(snapshot.files[0]?.path).toBe("README.md");
    expect(snapshot.files[0]?.revision !== null).toBeTrue();
    const diff = await readGitReviewDiff({
      cwd,
      source: "staged",
      files: ["README.md"],
    });
    expect(diff.patch.includes("@@ -1 +1,2 @@")).toBeTrue();
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
    expect(snapshot.files[0]?.safety.binary ?? false).toBeTrue();
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

    expect(snapshot.isGitRepository).toBeTrue();
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

    expect(snapshot.isGitRepository).toBeTrue();
    expect(snapshot.source).toBe("commit");
    expect(snapshot.files.length).toBe(1);
    expect(snapshot.files[0]?.path).toBe("feature.ts");
    expect(snapshot.patch).toBe("");
    const diff = await readGitReviewDiff({
      cwd,
      source: "commit",
      commitSha,
      files: ["feature.ts"],
    });
    expect(diff.patch.includes("+++ b/feature.ts")).toBeTrue();
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

    const result = await readGitReviewDiff({
      cwd,
      source: "unstaged",
      files: ["feature.ts"],
    });

    expect(result.isGitRepository).toBeTrue();
    expect(result.files.length).toBe(1);
    expect(result.files[0]?.path).toBe("feature.ts");
    expect(result.files[0]?.loadStatus).toBe("loaded");
    expect(result.patch.includes("README.md")).toBeFalse();
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

    expect(summary.isGitRepository).toBeTrue();
    expect(summary.source).toBe("unstaged");
    expect(summary.files.length).toBe(1);
    expect(summary.additions).toBe(1);
    expect(summary.deletions).toBe(0);
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
    ).toBeTrue();
    expect(Boolean(unifiedDiff.includes("+beta"))).toBeTrue();
  });

  test("initializes a git repository when requested", async () => {
    const cwd = createTempDir("nodex-git-review-init-");

    const snapshot = await initializeGitRepositoryAndReadReviewSnapshot(cwd);

    expect(snapshot.isGitRepository).toBeTrue();
    expect(snapshot.currentBranch).toBe("main");
  });

  test("stages an unstaged file patch through git apply", async () => {
    const cwd = createTempDir("nodex-git-review-apply-stage-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "README.md"), "alpha\nbeta\n", "utf8");
    const unstagedDiff = await readGitReviewDiff({
      cwd,
      source: "unstaged",
      files: ["README.md"],
    });

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
    const stagedDiff = await readGitReviewDiff({
      cwd,
      source: "staged",
      files: ["README.md"],
    });

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

    expect(result.oldExists).toBeTrue();
    expect(result.newExists).toBeTrue();
    expect(result.oldText?.includes("alpha")).toBeTrue();
    expect(result.newText?.includes("beta")).toBeTrue();
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

    expect(result.oldExists).toBeFalse();
    expect(result.newExists).toBeTrue();
    expect(result.newText?.includes("feature")).toBeTrue();
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

    expect(result.oldExists).toBeTrue();
    expect(result.newExists).toBeTrue();
    expect(result.oldText?.includes("beta")).toBeFalse();
    expect(result.newText?.includes("beta")).toBeTrue();
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

    const result = await searchGitReview({
      cwd,
      source: "staged",
      query: "reviewsearch",
    });

    expect(result.matchingPaths.length).toBe(1);
    expect(result.matchingPaths[0]).toBe("feature.ts");
  });
});
