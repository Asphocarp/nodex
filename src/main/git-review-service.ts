import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import type {
  BranchDiffStatsRequest,
  BranchDiffStatsResult,
  GitApplyPatchInput,
  GitApplyPatchResult,
  GitReviewBlameInput,
  GitReviewBlameResult,
  GitReviewBranchCommit,
  GitReviewBranchCommitsRequest,
  GitReviewBranchCommitsResult,
  GitReviewCancelInput,
  GitMergeBaseRequest,
  GitMergeBaseResult,
  GitReviewFileContents,
  GitReviewFileContentsInput,
  GitReviewSearchInput,
  GitReviewSearchResult,
  GitReviewFileStatus,
  GitReviewFileSummary,
  GitReviewSnapshot,
  GitReviewSource,
  GitReviewSummaryRequest,
  GitReviewSummaryResult,
  ReviewDiffEntry,
  ReviewDiffRequest,
  ReviewDiffResult,
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

interface GitReviewSnapshotRequest {
  cwd: string;
  source: GitReviewSource;
  baseRef?: string | null;
  commitSha?: string | null;
  hideWhitespace?: boolean;
  requestId?: string | null;
}

const GIT_COMMAND_TIMEOUT_MS = 8_000;
const REVIEW_FILE_CHANGED_LINES_LIMIT = 15_000;
const gitReviewAbortControllers = new Map<string, AbortController>();

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
  options?: { signal?: AbortSignal },
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
        signal: options?.signal,
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

async function runGitReviewRequest<T>(
  requestId: string | null | undefined,
  run: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  const normalizedRequestId = requestId?.trim() || "";
  if (!normalizedRequestId) {
    return run();
  }

  gitReviewAbortControllers.get(normalizedRequestId)?.abort();
  const controller = new AbortController();
  gitReviewAbortControllers.set(normalizedRequestId, controller);
  try {
    return await run(controller.signal);
  } finally {
    if (gitReviewAbortControllers.get(normalizedRequestId) === controller) {
      gitReviewAbortControllers.delete(normalizedRequestId);
    }
  }
}

export function cancelGitReviewRequest(input: GitReviewCancelInput): { cancelled: boolean } {
  const normalizedRequestId = input.requestId.trim();
  if (!normalizedRequestId) return { cancelled: false };

  const controller = gitReviewAbortControllers.get(normalizedRequestId);
  if (!controller) return { cancelled: false };

  controller.abort();
  gitReviewAbortControllers.delete(normalizedRequestId);
  return { cancelled: true };
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

function splitPatchFileDiffs(patch: string): string[] {
  if (!patch.trim()) return [];

  const matches = Array.from(patch.matchAll(/^diff --git .+$/gm));
  if (matches.length === 0) return [];

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? patch.length;
    return patch.slice(start, end).trimEnd();
  });
}

function toReviewDiffEntries(patch: string): ReviewDiffEntry[] {
  const summaries = toFileSummaries(patch);
  const fileDiffs = splitPatchFileDiffs(patch);

  return summaries.map((file, index) => {
    const diff = fileDiffs[index] ?? "";
    const changedLines = file.additions + file.deletions;
    const tooLarge = changedLines > REVIEW_FILE_CHANGED_LINES_LIMIT;
    return {
      ...file,
      diff,
      loadStatus: tooLarge ? "diff-too-large" : "loaded",
      renderKey: `${file.previousPath ?? ""}->${file.path}:${file.additions}:${file.deletions}:${diff.length}`,
      revision: null,
      diffBytes: Buffer.byteLength(diff, "utf8"),
      diffError: null,
      canApplyPatchActions: true,
      changedBytes: Buffer.byteLength(diff, "utf8"),
      tooLarge,
      tooLargeReason: tooLarge
        ? `File changed ${changedLines} lines, above the ${REVIEW_FILE_CHANGED_LINES_LIMIT} line review limit.`
        : null,
    } satisfies ReviewDiffEntry;
  });
}

function filterReviewDiffEntries(
  entries: ReviewDiffEntry[],
  requestedFiles?: string[],
): ReviewDiffEntry[] {
  const requestedPaths = new Set(
    (requestedFiles ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

  if (requestedPaths.size === 0) return entries;

  return entries.filter((entry) =>
    requestedPaths.has(entry.path) || (entry.previousPath ? requestedPaths.has(entry.previousPath) : false)
  );
}

function buildDiffWhitespaceArgs(hideWhitespace?: boolean): string[] {
  return hideWhitespace ? ["--ignore-all-space"] : [];
}

async function readBranchDiffPatch(
  cwd: string,
  baseRef: string,
  hideWhitespace?: boolean,
  signal?: AbortSignal,
): Promise<string> {
  const result = await runGitCommand([
    "diff",
    ...buildDiffWhitespaceArgs(hideWhitespace),
    "--no-ext-diff",
    "--find-renames",
    "--relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    `${baseRef}...HEAD`,
  ], cwd, [0], { signal });
  return result.stdout;
}

async function listUntrackedFiles(cwd: string, signal?: AbortSignal): Promise<string[]> {
  const result = await runGitCommand(["ls-files", "--others", "--exclude-standard", "-z"], cwd, [0], { signal });
  return result.stdout
    .split("\0")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function readUntrackedFilePatch(
  cwd: string,
  relativePath: string,
  hideWhitespace?: boolean,
  signal?: AbortSignal,
): Promise<string> {
  const absolutePath = path.resolve(cwd, relativePath);
  const contents = await readFile(absolutePath, "utf8").catch(() => "");
  if (contents.length === 0) {
    return `diff --git a/${relativePath} b/${relativePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relativePath}\n`;
  }

  const result = await runGitCommand([
    "diff",
    ...buildDiffWhitespaceArgs(hideWhitespace),
    "--no-index",
    "--relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--",
    "/dev/null",
    relativePath,
  ], cwd, [0, 1], { signal });
  return result.stdout;
}

async function readUnstagedDiffPatch(cwd: string, hideWhitespace?: boolean, signal?: AbortSignal): Promise<string> {
  const trackedResult = await runGitCommand([
    "diff",
    ...buildDiffWhitespaceArgs(hideWhitespace),
    "--no-ext-diff",
    "--find-renames",
    "--relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  ], cwd, [0], { signal });
  const untrackedFiles = await listUntrackedFiles(cwd, signal);
  if (untrackedFiles.length === 0) {
    return trackedResult.stdout;
  }

  const untrackedPatches = await Promise.all(
    untrackedFiles.map((relativePath) => readUntrackedFilePatch(cwd, relativePath, hideWhitespace, signal)),
  );
  return [trackedResult.stdout, ...untrackedPatches.filter((patch) => patch.trim().length > 0)]
    .filter((patch) => patch.trim().length > 0)
    .join("\n");
}

async function readStagedDiffPatch(cwd: string, hideWhitespace?: boolean, signal?: AbortSignal): Promise<string> {
  const result = await runGitCommand([
    "diff",
    "--cached",
    ...buildDiffWhitespaceArgs(hideWhitespace),
    "--no-ext-diff",
    "--find-renames",
    "--relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  ], cwd, [0], { signal });
  return result.stdout;
}

async function readCommitDiffPatch(
  cwd: string,
  commitSha: string | null | undefined,
  hideWhitespace?: boolean,
  signal?: AbortSignal,
): Promise<string> {
  const normalizedCommitSha = commitSha?.trim() ?? "";
  if (!normalizedCommitSha) {
    throw new Error("Commit SHA is required for commit review.");
  }

  const result = await runGitCommand([
    "show",
    "--format=",
    ...buildDiffWhitespaceArgs(hideWhitespace),
    "--no-ext-diff",
    "--find-renames",
    "--relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    normalizedCommitSha,
  ], cwd, [0], { signal });
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

async function resolveBranchComparisonBase(
  cwd: string,
  explicitBaseBranch: string | null | undefined,
  signal?: AbortSignal,
): Promise<{ baseBranch: string | null; baseSha: string | null }> {
  const baseBranch = explicitBaseBranch?.trim() || (await resolveBaseRef(cwd, null));
  if (!baseBranch) {
    return {
      baseBranch: null,
      baseSha: null,
    };
  }

  const mergeBase = await runGitCommand(["merge-base", "HEAD", baseBranch], cwd, [0, 1, 128], { signal })
    .catch(() => null);
  const baseSha = mergeBase?.exitCode === 0 ? mergeBase.stdout.trim() : "";
  return {
    baseBranch,
    baseSha: baseSha || null,
  };
}

function parseBranchCommitLog(stdout: string): GitReviewBranchCommit[] {
  if (!stdout.trim()) return [];

  return stdout
    .split("\n")
    .flatMap((line): GitReviewBranchCommit[] => {
      const [sha, committedAt, subject] = line.split("\0");
      if (!sha || !committedAt || subject === undefined) return [];
      return [{
        sha,
        committedAt,
        subject: subject || sha.slice(0, 12),
      }];
    });
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

async function readGitReviewSnapshotWithSignal(
  input: GitReviewSnapshotRequest,
  signal?: AbortSignal,
): Promise<GitReviewSnapshot> {
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
      ? await readStagedDiffPatch(cwd, input.hideWhitespace, signal)
      : input.source === "unstaged"
        ? await readUnstagedDiffPatch(cwd, input.hideWhitespace, signal)
        : input.source === "commit"
          ? await readCommitDiffPatch(cwd, input.commitSha, input.hideWhitespace, signal)
        : baseRef
          ? await readBranchDiffPatch(cwd, baseRef, input.hideWhitespace, signal)
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

export async function readGitReviewSnapshot(input: GitReviewSnapshotRequest): Promise<GitReviewSnapshot> {
  return runGitReviewRequest(input.requestId, (signal) => readGitReviewSnapshotWithSignal(input, signal));
}

export async function readGitReviewDiff(input: ReviewDiffRequest): Promise<ReviewDiffResult> {
  return runGitReviewRequest(input.requestId, async (signal) => {
    const baseRef = input.baseBranch?.trim() || input.baseRef?.trim() || null;
    const snapshot = await readGitReviewSnapshotWithSignal({
      cwd: input.cwd,
      source: input.source,
      baseRef,
      commitSha: input.commitSha,
      hideWhitespace: input.hideWhitespace,
    }, signal);
    const filteredEntries = filterReviewDiffEntries(toReviewDiffEntries(snapshot.patch), input.files);
    const filteredPatch = filteredEntries
      .map((entry) => entry.diff)
      .filter((diff) => diff.trim().length > 0)
      .join("\n");

    return {
      cwd: snapshot.cwd,
      source: snapshot.source,
      patch: filteredPatch,
      files: filteredEntries,
      isGitRepository: snapshot.isGitRepository,
      baseRef: snapshot.baseRef,
      currentBranch: snapshot.currentBranch,
      defaultBranch: snapshot.defaultBranch,
      errorMessage: snapshot.errorMessage,
    };
  });
}

export async function readGitReviewSummary(input: GitReviewSummaryRequest): Promise<GitReviewSummaryResult> {
  const baseRef = input.baseBranch?.trim() || input.baseRef?.trim() || null;
  const snapshot = await readGitReviewSnapshot({
    cwd: input.cwd,
    source: input.source,
    baseRef,
    commitSha: input.commitSha,
    hideWhitespace: input.hideWhitespace,
    requestId: input.requestId,
  });
  const additions = snapshot.files.reduce((total, file) => total + file.additions, 0);
  const deletions = snapshot.files.reduce((total, file) => total + file.deletions, 0);

  return {
    cwd: snapshot.cwd,
    source: snapshot.source,
    baseRef: snapshot.baseRef,
    commitSha: input.commitSha?.trim() || null,
    files: snapshot.files,
    additions,
    deletions,
    isGitRepository: snapshot.isGitRepository,
    currentBranch: snapshot.currentBranch,
    defaultBranch: snapshot.defaultBranch,
    errorMessage: snapshot.errorMessage,
  };
}

export async function readBranchDiffStats(input: BranchDiffStatsRequest): Promise<BranchDiffStatsResult> {
  const baseRef = input.baseBranch?.trim() || input.baseRef?.trim() || null;
  const snapshot = await readGitReviewSnapshot({
    cwd: input.cwd,
    source: "branch",
    baseRef,
    hideWhitespace: input.hideWhitespace,
  });
  const additions = snapshot.files.reduce((total, file) => total + file.additions, 0);
  const deletions = snapshot.files.reduce((total, file) => total + file.deletions, 0);

  return {
    cwd: snapshot.cwd,
    baseRef: snapshot.baseRef,
    files: snapshot.files,
    additions,
    deletions,
    isGitRepository: snapshot.isGitRepository,
    currentBranch: snapshot.currentBranch,
    defaultBranch: snapshot.defaultBranch,
    errorMessage: snapshot.errorMessage,
  };
}

export async function readGitReviewBranchCommits(
  input: GitReviewBranchCommitsRequest,
): Promise<GitReviewBranchCommitsResult> {
  return runGitReviewRequest(input.requestId, async (signal) => {
    const cwd = await ensureDirectory(input.cwd);
    const gitRepository = await isGitRepository(cwd);
    if (!gitRepository) {
      return {
        cwd,
        baseBranch: null,
        commits: [],
        errorMessage: "Git review is unavailable outside a Git repository.",
      };
    }

    const { baseBranch, baseSha } = await resolveBranchComparisonBase(cwd, input.baseBranch, signal);
    if (!baseSha) {
      return {
        cwd,
        baseBranch,
        commits: [],
        errorMessage: baseBranch
          ? `Could not resolve a merge base for ${baseBranch}.`
          : "Could not resolve a base branch.",
      };
    }

    try {
      const result = await runGitCommand(
        ["log", "--format=%H%x00%cI%x00%s", `${baseSha}..HEAD`],
        cwd,
        [0],
        { signal },
      );
      return {
        cwd,
        baseBranch,
        commits: parseBranchCommitLog(result.stdout),
        errorMessage: null,
      };
    } catch (error) {
      return {
        cwd,
        baseBranch,
        commits: [],
        errorMessage: error instanceof Error ? error.message : "Could not load branch commits.",
      };
    }
  });
}

export async function resolveGitMergeBase(input: GitMergeBaseRequest): Promise<GitMergeBaseResult> {
  const cwd = await ensureDirectory(input.gitRoot?.trim() || input.cwd);
  const baseBranch = input.baseBranch.trim();
  if (!baseBranch) {
    return {
      cwd,
      baseBranch,
      mergeBaseSha: null,
      errorMessage: "Base branch is required.",
    };
  }

  const gitRepository = await isGitRepository(cwd);
  if (!gitRepository) {
    return {
      cwd,
      baseBranch,
      mergeBaseSha: null,
      errorMessage: "Git review is unavailable outside a Git repository.",
    };
  }

  try {
    const result = await runGitCommand(["merge-base", "HEAD", baseBranch], cwd);
    return {
      cwd,
      baseBranch,
      mergeBaseSha: result.stdout.trim() || null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      cwd,
      baseBranch,
      mergeBaseSha: null,
      errorMessage: error instanceof Error ? error.message : "Could not resolve merge base.",
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
        : source === "commit"
          ? await readGitBlobText(cwd, `${input.commitSha?.trim() || "HEAD"}^`, previousPath)
        : baseRef
          ? await readGitBlobText(cwd, baseRef, previousPath)
          : null;

    const newText = source === "unstaged"
      ? await readWorktreeFileText(cwd, normalizedPath)
      : source === "staged"
        ? await readGitBlobText(cwd, ":", normalizedPath)
        : source === "commit"
          ? await readGitBlobText(cwd, input.commitSha?.trim() || "HEAD", normalizedPath)
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
    baseRef: input.baseBranch ?? input.baseRef ?? null,
    commitSha: input.commitSha ?? null,
    hideWhitespace: input.hideWhitespace,
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
      baseRef: input.baseBranch ?? input.baseRef ?? null,
      commitSha: input.commitSha ?? null,
    });
    const contentHaystacks = [fullContents.oldText ?? "", fullContents.newText ?? ""];
    if (contentHaystacks.some((value) => value.toLowerCase().includes(normalizedQuery))) {
      matchingPaths.add(file.path);
    }
  }));

  return {
    query: input.query,
    matchingPaths: Array.from(matchingPaths).slice(0, input.limit ?? 250),
  };
}

function parseBlamePorcelain(stdout: string): GitReviewBlameResult["lines"] {
  const lines: GitReviewBlameResult["lines"] = [];
  const chunks = stdout.split("\n");
  let current: {
    commitSha: string;
    line: number;
    author: string | null;
    authorTime: number | null;
    summary: string | null;
  } | null = null;

  for (const chunk of chunks) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(chunk);
    if (header) {
      if (current) lines.push(current);
      current = {
        commitSha: header[1] ?? "",
        line: Number(header[2] ?? "0"),
        author: null,
        authorTime: null,
        summary: null,
      };
      continue;
    }
    if (!current) continue;
    if (chunk.startsWith("author ")) {
      current.author = chunk.slice("author ".length) || null;
      continue;
    }
    if (chunk.startsWith("author-time ")) {
      const authorTime = Number(chunk.slice("author-time ".length));
      current.authorTime = Number.isFinite(authorTime) ? authorTime : null;
      continue;
    }
    if (chunk.startsWith("summary ")) {
      current.summary = chunk.slice("summary ".length) || null;
      continue;
    }
  }
  if (current) lines.push(current);
  return lines.filter((line) => line.line > 0 && line.commitSha.length > 0);
}

export async function readGitReviewBlameFile(input: GitReviewBlameInput): Promise<GitReviewBlameResult> {
  const cwd = await ensureDirectory(input.cwd);
  const normalizedPath = input.path.trim();
  const ref = input.ref?.trim() || null;

  if (!normalizedPath) {
    return {
      cwd,
      path: normalizedPath,
      ref,
      lines: [],
      errorMessage: "File path is required.",
    };
  }

  try {
    const args = [
      "blame",
      "--line-porcelain",
      ...(ref ? [ref] : []),
      "--",
      normalizedPath,
    ];
    const result = await runGitCommand(args, cwd);
    return {
      cwd,
      path: normalizedPath,
      ref,
      lines: parseBlamePorcelain(result.stdout),
      errorMessage: null,
    };
  } catch (error) {
    return {
      cwd,
      path: normalizedPath,
      ref,
      lines: [],
      errorMessage: error instanceof Error ? error.message : "Could not load Git blame.",
    };
  }
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
