import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyGitReviewPatch,
  initializeGitRepositoryAndReadReviewSnapshot,
  readGitReviewFileContents,
  readGitReviewSnapshot,
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
    writeFileSync(path.join(cwd, "new-file.ts"), "export const staged = false;\n", "utf8");

    const snapshot = await readGitReviewSnapshot({
      cwd,
      source: "unstaged",
    });

    expect(snapshot.isGitRepository).toBeTrue();
    expect(snapshot.files.length).toBe(2);
    expect(snapshot.files.some((file) => file.path === "README.md")).toBeTrue();
    expect(snapshot.files.some((file) => file.path === "new-file.ts")).toBeTrue();
    expect(snapshot.patch.includes("+++ b/new-file.ts")).toBeTrue();
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
    expect(snapshot.patch.includes("@@ -1 +1,2 @@")).toBeTrue();
  });

  test("returns branch snapshots against the default branch", async () => {
    const cwd = createTempDir("nodex-git-review-branch-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");
    runGit(cwd, ["checkout", "-b", "feature/review"]);
    writeFileSync(path.join(cwd, "feature.ts"), "export const branchDiff = true;\n", "utf8");
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
    const unstagedSnapshot = await readGitReviewSnapshot({
      cwd,
      source: "unstaged",
    });

    const result = await applyGitReviewPatch({
      cwd,
      diff: unstagedSnapshot.patch,
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

    const result = await applyGitReviewPatch({
      cwd,
      diff: stagedSnapshot.patch,
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

    writeFileSync(path.join(cwd, "feature.ts"), "export const feature = true;\n", "utf8");
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

  test("searches git review content across file paths and contents", async () => {
    const cwd = createTempDir("nodex-git-review-search-");
    initializeRepository(cwd);
    writeFileSync(path.join(cwd, "README.md"), "alpha\n", "utf8");
    commitAll(cwd, "initial");

    writeFileSync(path.join(cwd, "feature.ts"), "export const reviewSearch = true;\n", "utf8");
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
