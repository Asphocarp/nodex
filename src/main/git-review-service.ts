import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import type {
  GitApplyPatchInput,
  GitApplyPatchResult,
  GitReviewFileContents,
  GitReviewFileContentsInput,
  GitReviewSearchInput,
  GitReviewSearchResult,
  GitReviewFileStatus,
  GitReviewFileSummary,
  GitReviewSnapshot,
  GitReviewSource,
} from "../shared/types";
import { readGitBranchState } from "./git-branch-service";

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface GitCommandError extends Error {
  stderr?: string;
  exitCode?: number | null;
}

const GIT_COMMAND_TIMEOUT_MS = 8_000;

async function ensureDirectory(cwd: string): Promise<string> {
  const normalizedCwd = cwd.trim();
  if (!normalizedCwd) {
    throw new Error("Working directory is required");
  }

  const entry = await stat(normalizedCwd).catch(() => null);
  if (!entry?.isDirectory()) {
    throw new Error(`Working directory not found: ${normalizedCwd}`);
  }

  return normalizedCwd;
}

function runGitCommand(
  args: string[],
  cwd: string,
  allowedExitCodes: number[] = [0],
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        timeout: GIT_COMMAND_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode = typeof (error as { code?: unknown } | null)?.code === "number"
          ? ((error as { code: number }).code)
          : 0;
        if (error && !allowedExitCodes.includes(exitCode)) {
          const failure = error as GitCommandError;
          failure.stderr = typeof stderr === "string" ? stderr : "";
          failure.exitCode = exitCode;
          reject(failure);
          return;
        }

        resolve({
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
          exitCode,
        });
      },
    );
  });
}

function isNotGitRepositoryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  const message = `${error.message}\n${stderr}`.toLowerCase();
  return message.includes("not a git repository");
}

function resolvePatchErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "gitApplyFailed";

  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  const message = `${error.message}\n${stderr}`.toLowerCase();
  if (message.includes("patch does not apply")) return "patchDoesNotApply";
  if (message.includes("already exists in index")) return "alreadyApplied";
  if (message.includes("does not exist in index")) return "missingFromIndex";
  if (message.includes("corrupt patch")) return "corruptPatch";
  return "gitApplyFailed";
}

async function isGitRepository(cwd: string): Promise<boolean> {
  const result = await runGitCommand(["rev-parse", "--is-inside-work-tree"], cwd).catch(() => null);
  return result?.stdout.trim() === "true";
}

async function hasHeadCommit(cwd: string): Promise<boolean> {
  const result = await runGitCommand(["rev-parse", "--verify", "HEAD"], cwd, [0, 128]).catch(() => null);
  return result?.exitCode === 0;
}

function summarizeFileDiff(fileDiff: FileDiffMetadata): Pick<GitReviewFileSummary, "additions" | "deletions"> {
  return fileDiff.hunks.reduce(
    (summary, hunk) => ({
      additions: summary.additions + hunk.additionLines,
      deletions: summary.deletions + hunk.deletionLines,
    }),
    { additions: 0, deletions: 0 },
  );
}

function mapFileStatus(fileDiff: FileDiffMetadata): GitReviewFileStatus {
  if (fileDiff.type === "new") return "added";
  if (fileDiff.type === "deleted") return "deleted";
  if (fileDiff.type === "rename-pure" || fileDiff.type === "rename-changed") {
    return "renamed";
  }
  return "modified";
}

function toFileSummaries(patch: string): GitReviewFileSummary[] {
  if (!patch.trim()) return [];

  try {
    return parsePatchFiles(patch).flatMap((parsedPatch) =>
      parsedPatch.files.map((fileDiff) => {
        const summary = summarizeFileDiff(fileDiff);
        return {
          path: fileDiff.name,
          previousPath: fileDiff.prevName ?? null,
          status: mapFileStatus(fileDiff),
          additions: summary.additions,
          deletions: summary.deletions,
        } satisfies GitReviewFileSummary;
      }),
    );
  } catch {
    return [];
  }
}

function toPatchPaths(patch: string): string[] {
  return toFileSummaries(patch).map((file) => file.path);
}

async function readBranchDiffPatch(
  cwd: string,
  baseRef: string,
): Promise<string> {
  const result = await runGitCommand([
    "diff",
    "--no-ext-diff",
    "--find-renames",
    "--relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    `${baseRef}...HEAD`,
  ], cwd);
  return result.stdout;
}

async function listUntrackedFiles(cwd: string): Promise<string[]> {
  const result = await runGitCommand(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  return result.stdout
    .split("\0")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function readUntrackedFilePatch(cwd: string, relativePath: string): Promise<string> {
  const absolutePath = path.resolve(cwd, relativePath);
  const contents = await readFile(absolutePath, "utf8").catch(() => "");
  if (contents.length === 0) {
    return `diff --git a/${relativePath} b/${relativePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relativePath}\n`;
  }

  const result = await runGitCommand([
    "diff",
    "--no-index",
    "--relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--",
    "/dev/null",
    relativePath,
  ], cwd, [0, 1]);
  return result.stdout;
}

async function readUnstagedDiffPatch(cwd: string): Promise<string> {
  const trackedResult = await runGitCommand([
    "diff",
    "--no-ext-diff",
    "--find-renames",
    "--relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  ], cwd);
  const untrackedFiles = await listUntrackedFiles(cwd);
  if (untrackedFiles.length === 0) {
    return trackedResult.stdout;
  }

  const untrackedPatches = await Promise.all(
    untrackedFiles.map((relativePath) => readUntrackedFilePatch(cwd, relativePath)),
  );
  return [trackedResult.stdout, ...untrackedPatches.filter((patch) => patch.trim().length > 0)]
    .filter((patch) => patch.trim().length > 0)
    .join("\n");
}

async function readStagedDiffPatch(cwd: string): Promise<string> {
  const result = await runGitCommand([
    "diff",
    "--cached",
    "--no-ext-diff",
    "--find-renames",
    "--relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  ], cwd);
  return result.stdout;
}

async function resolveBaseRef(cwd: string, explicitBaseRef?: string | null): Promise<string | null> {
  const normalizedExplicitBaseRef = explicitBaseRef?.trim() || "";
  if (normalizedExplicitBaseRef) {
    return normalizedExplicitBaseRef;
  }

  const branchState = await readGitBranchState(cwd);
  if (branchState.defaultBranch) {
    return branchState.defaultBranch;
  }

  if (branchState.branches.includes("main")) {
    return "main";
  }

  if (branchState.branches.includes("master")) {
    return "master";
  }

  return branchState.currentBranch ?? null;
}

async function readGitBlobText(
  cwd: string,
  ref: string,
  relativePath: string | null | undefined,
): Promise<string | null> {
  const normalizedPath = relativePath?.trim() ?? "";
  if (!normalizedPath || normalizedPath === "/dev/null") return null;

  const objectSpec = ref === ":" ? `:${normalizedPath}` : `${ref}:${normalizedPath}`;
  const result = await runGitCommand(["show", objectSpec], cwd, [0, 128]).catch(() => null);
  if (!result || result.exitCode !== 0) return null;
  return result.stdout;
}

async function readWorktreeFileText(
  cwd: string,
  relativePath: string | null | undefined,
): Promise<string | null> {
  const normalizedPath = relativePath?.trim() ?? "";
  if (!normalizedPath || normalizedPath === "/dev/null") return null;

  const absolutePath = path.resolve(cwd, normalizedPath);
  return readFile(absolutePath, "utf8").catch(() => null);
}

export async function readGitReviewSnapshot(input: {
  cwd: string;
  source: GitReviewSource;
  baseRef?: string | null;
}): Promise<GitReviewSnapshot> {
  const cwd = await ensureDirectory(input.cwd);
  const gitRepository = await isGitRepository(cwd);
  const branchState = gitRepository
    ? await readGitBranchState(cwd)
    : { currentBranch: null, defaultBranch: null, branches: [] };

  if (!gitRepository) {
    return {
      cwd,
      source: input.source,
      patch: "",
      files: [],
      isGitRepository: false,
      baseRef: null,
      currentBranch: null,
      defaultBranch: null,
      errorMessage: null,
    };
  }

  try {
    const baseRef = input.source === "branch"
      ? await resolveBaseRef(cwd, input.baseRef)
      : null;
    const patch = input.source === "staged"
      ? await readStagedDiffPatch(cwd)
      : input.source === "unstaged"
        ? await readUnstagedDiffPatch(cwd)
        : baseRef
          ? await readBranchDiffPatch(cwd, baseRef)
          : "";

    return {
      cwd,
      source: input.source,
      patch,
      files: toFileSummaries(patch),
      isGitRepository: true,
      baseRef,
      currentBranch: branchState.currentBranch,
      defaultBranch: branchState.defaultBranch,
      errorMessage: null,
    };
  } catch (error) {
    if (isNotGitRepositoryError(error)) {
      return {
        cwd,
        source: input.source,
        patch: "",
        files: [],
        isGitRepository: false,
        baseRef: null,
        currentBranch: null,
        defaultBranch: null,
        errorMessage: null,
      };
    }

    return {
      cwd,
      source: input.source,
      patch: "",
      files: [],
      isGitRepository: true,
      baseRef: input.baseRef?.trim() || null,
      currentBranch: branchState.currentBranch,
      defaultBranch: branchState.defaultBranch,
      errorMessage: error instanceof Error ? error.message : "Could not load Git review snapshot.",
    };
  }
}

export async function readGitReviewFileContents(
  input: GitReviewFileContentsInput,
): Promise<GitReviewFileContents> {
  const cwd = await ensureDirectory(input.cwd);
  const source = input.source;
  const normalizedPath = input.path.trim();
  const normalizedPreviousPath = input.previousPath?.trim() || null;
  const previousPath = normalizedPreviousPath || normalizedPath;

  if (!normalizedPath) {
    return {
      path: normalizedPath,
      previousPath: normalizedPreviousPath,
      oldText: null,
      newText: null,
      oldExists: false,
      newExists: false,
      errorMessage: "File path is required.",
    };
  }

  const repository = await isGitRepository(cwd);
  if (!repository) {
    return {
      path: normalizedPath,
      previousPath: normalizedPreviousPath,
      oldText: null,
      newText: null,
      oldExists: false,
      newExists: false,
      errorMessage: "Git review is unavailable outside a Git repository.",
    };
  }

  try {
    const headExists = await hasHeadCommit(cwd);
    const baseRef = source === "branch"
      ? await resolveBaseRef(cwd, input.baseRef)
      : null;

    const oldText = source === "unstaged"
      ? await readGitBlobText(cwd, ":", previousPath)
      : source === "staged"
        ? headExists
          ? await readGitBlobText(cwd, "HEAD", previousPath)
          : null
        : baseRef
          ? await readGitBlobText(cwd, baseRef, previousPath)
          : null;

    const newText = source === "unstaged"
      ? await readWorktreeFileText(cwd, normalizedPath)
      : source === "staged"
        ? await readGitBlobText(cwd, ":", normalizedPath)
        : headExists
          ? await readGitBlobText(cwd, "HEAD", normalizedPath)
          : await readWorktreeFileText(cwd, normalizedPath);

    return {
      path: normalizedPath,
      previousPath: normalizedPreviousPath,
      oldText,
      newText,
      oldExists: oldText !== null,
      newExists: newText !== null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      path: normalizedPath,
      previousPath: normalizedPreviousPath,
      oldText: null,
      newText: null,
      oldExists: false,
      newExists: false,
      errorMessage: error instanceof Error ? error.message : "Could not load review file contents.",
    };
  }
}

export async function searchGitReview(
  input: GitReviewSearchInput,
): Promise<GitReviewSearchResult> {
  const normalizedQuery = input.query.trim().toLowerCase();
  if (!normalizedQuery) {
    return {
      query: input.query,
      matchingPaths: [],
    };
  }

  const snapshot = await readGitReviewSnapshot({
    cwd: input.cwd,
    source: input.source,
    baseRef: input.baseRef ?? null,
  });

  if (!snapshot.isGitRepository || snapshot.files.length === 0) {
    return {
      query: input.query,
      matchingPaths: [],
    };
  }

  const matchingPaths = new Set<string>();
  await Promise.all(snapshot.files.map(async (file) => {
    const haystacks = [file.path, file.previousPath ?? ""];
    if (haystacks.some((value) => value.toLowerCase().includes(normalizedQuery))) {
      matchingPaths.add(file.path);
      return;
    }

    const fullContents = await readGitReviewFileContents({
      cwd: input.cwd,
      source: input.source,
      path: file.path,
      previousPath: file.previousPath,
      baseRef: input.baseRef ?? null,
    });
    const contentHaystacks = [fullContents.oldText ?? "", fullContents.newText ?? ""];
    if (contentHaystacks.some((value) => value.toLowerCase().includes(normalizedQuery))) {
      matchingPaths.add(file.path);
    }
  }));

  return {
    query: input.query,
    matchingPaths: Array.from(matchingPaths),
  };
}

export async function initializeGitRepositoryAndReadReviewSnapshot(cwd: string): Promise<GitReviewSnapshot> {
  const normalizedCwd = await ensureDirectory(cwd);
  const alreadyRepository = await isGitRepository(normalizedCwd);
  if (!alreadyRepository) {
    await runGitCommand(["init", "-b", "main"], normalizedCwd).catch(async () => {
      await runGitCommand(["init"], normalizedCwd);
      const branchState = await readGitBranchState(normalizedCwd);
      if (!branchState.currentBranch) {
        await runGitCommand(["checkout", "-b", "main"], normalizedCwd).catch(() => undefined);
      }
    });
  }

  return readGitReviewSnapshot({
    cwd: normalizedCwd,
    source: "unstaged",
  });
}

export async function applyGitReviewPatch(input: GitApplyPatchInput): Promise<GitApplyPatchResult> {
  const cwd = await ensureDirectory(input.cwd);
  const diff = input.diff.trim();
  if (!diff) {
    return {
      status: "error",
      appliedPaths: [],
      skippedPaths: [],
      conflictedPaths: [],
      errorCode: "missingDiff",
      errorMessage: "Patch diff is required.",
    };
  }

  const args = [
    "apply",
    "--recount",
    "--whitespace=nowarn",
    ...(input.target === "staged" ? ["--cached"] : []),
    ...(input.revert ? ["-R"] : []),
  ];
  const patchFilePath = path.join(
    tmpdir(),
    `nodex-git-apply-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`,
  );

  try {
    await writeFile(patchFilePath, input.diff, "utf8");
    await runGitCommand([...args, patchFilePath], cwd);
    return {
      status: "success",
      appliedPaths: toPatchPaths(input.diff),
      skippedPaths: [],
      conflictedPaths: [],
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      status: "error",
      appliedPaths: [],
      skippedPaths: [],
      conflictedPaths: [],
      errorCode: resolvePatchErrorCode(error),
      errorMessage: error instanceof Error ? error.message : "Could not apply patch.",
    };
  } finally {
    await rm(patchFilePath, { force: true }).catch(() => undefined);
  }
}
