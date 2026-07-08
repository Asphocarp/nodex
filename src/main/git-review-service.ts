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
  GitReviewPatchRequest,
  GitReviewPatchResult,
  GitReviewSearchInput,
  GitReviewSearchResult,
  GitReviewFileStatus,
  GitReviewFileSummary,
  GitReviewSnapshot,
  GitReviewSnapshotRequest,
  GitReviewSource,
  GitReviewSummaryRequest,
  GitReviewSummaryResult,
  ReviewDiffEntry,
  ReviewDiffRequest,
  ReviewDiffResult,
  ReviewFileSafety,
} from "../shared/types";
import { readGitBranchState } from "./git-branch-service";
import {
  buildReviewFileSafety,
  classifyReviewFileMetadata,
  classifyReviewTextPayload,
  REVIEW_GIT_DIFF_MAX_BYTES,
  REVIEW_RENDERABLE_TEXT_MAX_BYTES,
  REVIEW_UNTRACKED_DIFF_CONCURRENCY,
} from "../shared/review-file-safety";

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
const REVIEW_FILE_CHANGED_LINES_LIMIT = 15_000;
const gitReviewAbortControllers = new Map<string, AbortController>();
const GIT_CONFIG_OVERRIDES = [
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "core.quotePath=false",
];
const GIT_REVIEW_DIFF_BASE_ARGS = [
  "--no-ext-diff",
  "--no-textconv",
  "--color=never",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--find-renames",
];

interface GitDiffFileMetadata {
  path: string;
  previousPath: string | null;
  status: GitReviewFileStatus;
  rawStatus: string | null;
  oldOid: string | null;
  newOid: string | null;
  revision: string | null;
  additions: number | null;
  deletions: number | null;
  safety: ReviewFileSafety;
}

interface GitDiffRawMetadata {
  path: string;
  previousPath: string | null;
  rawStatus: string | null;
  oldOid: string | null;
  newOid: string | null;
}

interface ReviewFileTextRead {
  text: string | null;
  exists: boolean;
  status: ReviewDiffEntry["loadStatus"];
  safety: ReviewFileSafety;
}

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
      [...GIT_CONFIG_OVERRIDES, ...args],
      {
        cwd,
        encoding: "utf8",
        timeout: GIT_COMMAND_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: REVIEW_GIT_DIFF_MAX_BYTES,
        signal: options?.signal,
      },
      (error, stdout, stderr) => {
        const rawExitCode = (error as { code?: unknown } | null)?.code;
        const exitCode = typeof rawExitCode === "number" ? rawExitCode : 0;
        if (
          error &&
          (typeof rawExitCode !== "number" ||
            !allowedExitCodes.includes(exitCode))
        ) {
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

export function cancelGitReviewRequest(input: GitReviewCancelInput): {
  cancelled: boolean;
} {
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

  const stderr =
    "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  const message = `${error.message}\n${stderr}`.toLowerCase();
  return message.includes("not a git repository");
}

function resolvePatchErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "gitApplyFailed";

  const stderr =
    "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  const message = `${error.message}\n${stderr}`.toLowerCase();
  if (message.includes("patch does not apply")) return "patchDoesNotApply";
  if (message.includes("already exists in index")) return "alreadyApplied";
  if (message.includes("does not exist in index")) return "missingFromIndex";
  if (message.includes("corrupt patch")) return "corruptPatch";
  return "gitApplyFailed";
}

async function isGitRepository(cwd: string): Promise<boolean> {
  const result = await runGitCommand(
    ["rev-parse", "--is-inside-work-tree"],
    cwd,
  ).catch(() => null);
  return result?.stdout.trim() === "true";
}

async function hasHeadCommit(cwd: string): Promise<boolean> {
  const result = await runGitCommand(
    ["rev-parse", "--verify", "HEAD"],
    cwd,
    [0, 128],
  ).catch(() => null);
  return result?.exitCode === 0;
}

function countNullableChangedLines(
  file: Pick<GitReviewFileSummary, "additions" | "deletions">,
): number {
  return (file.additions ?? 0) + (file.deletions ?? 0);
}

function summarizeFileDiff(
  fileDiff: FileDiffMetadata,
): Pick<GitReviewFileSummary, "additions" | "deletions"> {
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

function splitNul(stdout: string): string[] {
  return stdout.split("\0").filter((entry) => entry.length > 0);
}

function mapNameStatusCode(statusToken: string): GitReviewFileStatus {
  const statusCode = statusToken.trim().charAt(0);
  if (statusCode === "A") return "added";
  if (statusCode === "C") return "copied";
  if (statusCode === "D") return "deleted";
  if (statusCode === "R") return "renamed";
  if (statusCode === "T") return "type-changed";
  if (statusCode === "U") return "unmerged";
  return "modified";
}

function parseNameStatusZ(
  stdout: string,
): Array<Pick<GitDiffFileMetadata, "path" | "previousPath" | "status">> {
  const tokens = splitNul(stdout);
  const rows: Array<
    Pick<GitDiffFileMetadata, "path" | "previousPath" | "status">
  > = [];
  let index = 0;

  while (index < tokens.length) {
    const statusToken = tokens[index++]?.trim() ?? "";
    if (!statusToken) continue;

    const status = mapNameStatusCode(statusToken);
    if (status === "renamed" || status === "copied") {
      const previousPath = tokens[index++]?.trim() ?? "";
      const nextPath = tokens[index++]?.trim() ?? "";
      if (!nextPath) continue;
      rows.push({
        path: nextPath,
        previousPath: previousPath || null,
        status,
      });
      continue;
    }

    const nextPath = tokens[index++]?.trim() ?? "";
    if (!nextPath) continue;
    rows.push({
      path: nextPath,
      previousPath: null,
      status,
    });
  }

  return rows;
}

function parseRawZ(stdout: string): GitDiffRawMetadata[] {
  const tokens = splitNul(stdout);
  const rows: GitDiffRawMetadata[] = [];
  let index = 0;

  while (index < tokens.length) {
    const header = tokens[index++]?.trim() ?? "";
    if (!header.startsWith(":")) continue;

    const parts = header.split(/\s+/);
    const oldOid = parts[2] ?? null;
    const newOid = parts[3] ?? null;
    const rawStatus = parts[4] ?? null;
    const status = rawStatus ? mapNameStatusCode(rawStatus) : "modified";

    if (status === "renamed" || status === "copied") {
      const previousPath = tokens[index++]?.trim() ?? "";
      const nextPath = tokens[index++]?.trim() ?? "";
      if (!nextPath) continue;
      rows.push({
        path: nextPath,
        previousPath: previousPath || null,
        rawStatus,
        oldOid,
        newOid,
      });
      continue;
    }

    const nextPath = tokens[index++]?.trim() ?? "";
    if (!nextPath) continue;
    rows.push({
      path: nextPath,
      previousPath: null,
      rawStatus,
      oldOid,
      newOid,
    });
  }

  return rows;
}

function parseNumstatCount(value: string | undefined): number | null {
  if (value === "-") return null;
  const count = Number(value ?? "");
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function parseNumstatZ(
  stdout: string,
): Array<
  Pick<GitDiffFileMetadata, "path" | "previousPath" | "additions" | "deletions">
> {
  const tokens = splitNul(stdout);
  const rows: Array<
    Pick<
      GitDiffFileMetadata,
      "path" | "previousPath" | "additions" | "deletions"
    >
  > = [];
  let index = 0;

  while (index < tokens.length) {
    const statsToken = tokens[index++] ?? "";
    const [rawAdditions, rawDeletions, rawPath = ""] = statsToken.split("\t");
    const additions = parseNumstatCount(rawAdditions);
    const deletions = parseNumstatCount(rawDeletions);

    if (rawPath.length > 0) {
      rows.push({
        path: rawPath,
        previousPath: null,
        additions,
        deletions,
      });
      continue;
    }

    const previousPath = tokens[index++]?.trim() ?? "";
    const nextPath = tokens[index++]?.trim() ?? "";
    if (!nextPath) continue;
    rows.push({
      path: nextPath,
      previousPath: previousPath || null,
      additions,
      deletions,
    });
  }

  return rows;
}

async function hashWorktreePaths(
  cwd: string,
  paths: string[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const uniquePaths = Array.from(
    new Set(paths.filter((entry) => entry.trim().length > 0)),
  );
  if (uniquePaths.length === 0) return new Map();

  const result = await runGitCommand(
    ["hash-object", "--no-filters", "--", ...uniquePaths],
    cwd,
    [0],
    { signal },
  ).catch(() => null);
  if (!result) return new Map();

  const hashes = result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return new Map(
    uniquePaths.flatMap((filePath, index) => {
      const hash = hashes[index];
      return hash ? [[filePath, hash] as const] : [];
    }),
  );
}

async function buildWorktreeStatRevisionPart(
  cwd: string,
  filePath: string,
): Promise<string | null> {
  const entry = await stat(path.resolve(cwd, filePath)).catch(() => null);
  if (!entry?.isFile()) return null;
  return `${entry.size}:${Math.trunc(entry.mtimeMs)}`;
}

async function buildGitFileRevision(input: {
  cwd: string;
  source: GitReviewSource;
  path: string;
  status: GitReviewFileStatus;
  oldOid: string | null;
  newOid: string | null;
  worktreeHash: string | null;
}): Promise<string | null> {
  if (input.status === "untracked") {
    if (input.worktreeHash) return `untracked:${input.worktreeHash}`;
    const statRevisionPart = await buildWorktreeStatRevisionPart(
      input.cwd,
      input.path,
    );
    return statRevisionPart
      ? `untracked:${statRevisionPart}:${input.path}`
      : `untracked:${input.path}`;
  }

  if (input.source !== "unstaged" || input.status === "deleted") {
    return `${input.source}:${input.status}:${input.oldOid ?? ""}:${input.newOid ?? ""}`;
  }

  if (input.worktreeHash) {
    return `${input.source}:${input.status}:${input.oldOid ?? ""}:worktree:${input.worktreeHash}`;
  }

  const statRevisionPart = await buildWorktreeStatRevisionPart(
    input.cwd,
    input.path,
  );
  if (statRevisionPart) {
    return `${input.source}:${input.status}:${input.oldOid ?? ""}:worktree:${statRevisionPart}`;
  }

  return `${input.source}:${input.status}:${input.oldOid ?? ""}:${input.newOid ?? ""}`;
}

async function mergeGitDiffMetadata(input: {
  cwd: string;
  source: GitReviewSource;
  nameStatusRows: Array<
    Pick<GitDiffFileMetadata, "path" | "previousPath" | "status">
  >;
  numstatRows: Array<
    Pick<
      GitDiffFileMetadata,
      "path" | "previousPath" | "additions" | "deletions"
    >
  >;
  rawRows: GitDiffRawMetadata[];
  signal?: AbortSignal;
}): Promise<GitDiffFileMetadata[]> {
  const statsByPath = new Map(input.numstatRows.map((row) => [row.path, row]));
  const statusByPath = new Map(
    input.nameStatusRows.map((row) => [row.path, row]),
  );
  const rawByPath = new Map(input.rawRows.map((row) => [row.path, row]));
  const orderedPaths =
    input.nameStatusRows.length > 0
      ? input.nameStatusRows.map((row) => row.path)
      : input.numstatRows.map((row) => row.path);
  const seen = new Set<string>();
  const worktreeHashByPath =
    input.source === "unstaged"
      ? await hashWorktreePaths(input.cwd, orderedPaths, input.signal)
      : new Map<string, string>();
  const rows = await Promise.all(
    orderedPaths.flatMap(
      (filePath): Array<Promise<GitDiffFileMetadata | null>> => {
        if (seen.has(filePath)) return [];
        seen.add(filePath);
        const statusRow = statusByPath.get(filePath) ?? null;
        const statsRow = statsByPath.get(filePath) ?? null;
        const rawRow = rawByPath.get(filePath) ?? null;
        const pathName =
          statusRow?.path ?? statsRow?.path ?? rawRow?.path ?? filePath;
        const previousPath =
          statusRow?.previousPath ??
          statsRow?.previousPath ??
          rawRow?.previousPath ??
          null;
        const status =
          statusRow?.status ??
          mapNameStatusCode(rawRow?.rawStatus ?? "") ??
          "modified";
        const additions = statsRow?.additions ?? 0;
        const deletions = statsRow?.deletions ?? 0;
        const safety = classifyReviewFileMetadata({
          path: pathName,
          additions,
          deletions,
        });

        return [
          buildGitFileRevision({
            cwd: input.cwd,
            source: input.source,
            path: pathName,
            status,
            oldOid: rawRow?.oldOid ?? null,
            newOid: rawRow?.newOid ?? null,
            worktreeHash: worktreeHashByPath.get(pathName) ?? null,
          }).then((revision) => ({
            path: pathName,
            previousPath,
            status,
            rawStatus: rawRow?.rawStatus ?? null,
            oldOid: rawRow?.oldOid ?? null,
            newOid: rawRow?.newOid ?? null,
            revision,
            additions: safety.binary ? null : additions,
            deletions: safety.binary ? null : deletions,
            safety,
          })),
        ];
      },
    ),
  );

  return rows.filter((row): row is GitDiffFileMetadata => row !== null);
}

async function readGitDiffMetadata(
  cwd: string,
  source: GitReviewSource,
  diffArgs: string[],
  signal?: AbortSignal,
): Promise<GitDiffFileMetadata[]> {
  const [nameStatusResult, numstatResult, rawResult] = await Promise.all([
    runGitCommand(["diff", ...diffArgs, "--name-status", "-z"], cwd, [0], {
      signal,
    }),
    runGitCommand(["diff", ...diffArgs, "--numstat", "-z"], cwd, [0], {
      signal,
    }),
    runGitCommand(["diff", ...diffArgs, "--raw", "-z"], cwd, [0], {
      signal,
    }).catch(() => null),
  ]);

  return mergeGitDiffMetadata({
    cwd,
    source,
    nameStatusRows: parseNameStatusZ(nameStatusResult.stdout),
    numstatRows: parseNumstatZ(numstatResult.stdout),
    rawRows: parseRawZ(rawResult?.stdout ?? ""),
    signal,
  });
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
          rawStatus: null,
          oldOid: null,
          newOid: null,
          revision: null,
          additions: summary.additions,
          deletions: summary.deletions,
          safety: classifyReviewFileMetadata({
            path: fileDiff.name,
            additions: summary.additions,
            deletions: summary.deletions,
          }),
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

function parseDiffGitCurrentPath(filePatch: string): string | null {
  const header = filePatch.split(/\r?\n/, 1)[0] ?? "";
  const quotedMatch = /^diff --git "a\/(.+)" "b\/(.+)"$/.exec(header);
  if (quotedMatch?.[2]) return quotedMatch[2];

  const plainMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(header);
  return plainMatch?.[2] ?? null;
}

function splitPatchFileDiffsByPath(patch: string): Map<string, string> {
  const fileDiffs = splitPatchFileDiffs(patch);
  const byPath = new Map<string, string>();

  for (const fileDiff of fileDiffs) {
    const currentPath = parseDiffGitCurrentPath(fileDiff);
    if (!currentPath) continue;
    const existing = byPath.get(currentPath);
    byPath.set(currentPath, existing ? `${existing}\n${fileDiff}` : fileDiff);
  }

  return byPath;
}

function resolveDiffLoadStatus(input: {
  safety: ReviewFileSafety;
  changedLines: number;
}): ReviewDiffEntry["loadStatus"] {
  if (input.safety.skipReason === "binary") return "binary";
  if (input.safety.skipReason === "tooLarge") return "diff-too-large";
  if (
    input.safety.skipReason === "invalidText" ||
    input.safety.skipReason === "unsupported"
  )
    return "unsupported";
  if (input.changedLines > REVIEW_FILE_CHANGED_LINES_LIMIT)
    return "diff-too-large";
  return "loaded";
}

function toReviewDiffEntries(
  patch: string,
  summaries: GitReviewFileSummary[] = toFileSummaries(patch),
): ReviewDiffEntry[] {
  const diffsByPath = splitPatchFileDiffsByPath(patch);

  return summaries.map((file) => {
    const diff = file.safety.renderable
      ? (diffsByPath.get(file.path) ?? "")
      : "";
    const diffSafety =
      diff.trim().length > 0
        ? classifyReviewTextPayload({
            path: file.path,
            text: diff,
            maxBytes: REVIEW_RENDERABLE_TEXT_MAX_BYTES,
          })
        : file.safety;
    const safety = file.safety.renderable ? diffSafety : file.safety;
    const changedLines = countNullableChangedLines(file);
    const loadStatus = resolveDiffLoadStatus({ safety, changedLines });
    const tooLarge = loadStatus === "diff-too-large";
    return {
      ...file,
      diff,
      safety,
      loadStatus,
      renderKey: `${file.previousPath ?? ""}->${file.path}:${file.additions ?? "-"}:${file.deletions ?? "-"}:${diff.length}:${loadStatus}`,
      diffBytes: Buffer.byteLength(diff, "utf8"),
      diffError: null,
      canApplyPatchActions:
        file.safety.renderable &&
        diff.trim().length > 0 &&
        loadStatus === "loaded",
      changedBytes: Buffer.byteLength(diff, "utf8"),
      tooLarge,
      tooLargeReason: tooLarge
        ? safety.skipReason === "tooLarge"
          ? "File diff is above the review display limit."
          : `File changed ${changedLines} lines, above the ${REVIEW_FILE_CHANGED_LINES_LIMIT} line review limit.`
        : null,
    } satisfies ReviewDiffEntry;
  });
}

function buildDiffWhitespaceArgs(hideWhitespace?: boolean): string[] {
  return hideWhitespace ? ["--ignore-all-space"] : [];
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index]!);
      }
    }),
  );

  return results;
}

function buildGitReviewDiffArgs(input?: {
  hideWhitespace?: boolean;
  cached?: boolean;
  revisions?: string[];
}): string[] {
  return [
    ...GIT_REVIEW_DIFF_BASE_ARGS,
    ...buildDiffWhitespaceArgs(input?.hideWhitespace),
    ...(input?.cached ? ["--cached"] : []),
    ...(input?.revisions ?? []),
  ];
}

function buildGitReviewSourceDiffArgs(input: {
  source: GitReviewSource;
  hideWhitespace?: boolean;
  baseRef?: string | null;
  commitSha?: string | null;
}): string[] | null {
  if (input.source === "staged") {
    return buildGitReviewDiffArgs({
      hideWhitespace: input.hideWhitespace,
      cached: true,
    });
  }

  if (input.source === "unstaged") {
    return buildGitReviewDiffArgs({ hideWhitespace: input.hideWhitespace });
  }

  if (input.source === "commit") {
    const normalizedCommitSha = input.commitSha?.trim() ?? "";
    if (!normalizedCommitSha) {
      throw new Error("Commit SHA is required for commit review.");
    }
    return buildGitReviewDiffArgs({
      hideWhitespace: input.hideWhitespace,
      revisions: [`${normalizedCommitSha}^`, normalizedCommitSha],
    });
  }

  const baseRef = input.baseRef?.trim() ?? "";
  if (!baseRef) return null;
  return buildGitReviewDiffArgs({
    hideWhitespace: input.hideWhitespace,
    revisions: [`${baseRef}...HEAD`],
  });
}

async function listUntrackedFiles(
  cwd: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await runGitCommand(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    cwd,
    [0],
    { signal },
  );
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
  binary = false,
): Promise<string> {
  const result = await runGitCommand(
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--color=never",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      ...(binary ? ["--binary"] : []),
      ...buildDiffWhitespaceArgs(hideWhitespace),
      "--no-index",
      "--",
      "/dev/null",
      relativePath,
    ],
    cwd,
    [0, 1],
    { signal },
  ).catch(() => null);
  return result?.stdout ?? "";
}

async function readUntrackedFileMetadata(
  cwd: string,
  relativePath: string,
  hideWhitespace?: boolean,
  signal?: AbortSignal,
): Promise<GitDiffFileMetadata> {
  const absolutePath = path.resolve(cwd, relativePath);
  const sizeBytes = (await stat(absolutePath).catch(() => null))?.size ?? null;
  const result = await runGitCommand(
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--color=never",
      ...buildDiffWhitespaceArgs(hideWhitespace),
      "--no-index",
      "--numstat",
      "-z",
      "--",
      "/dev/null",
      relativePath,
    ],
    cwd,
    [0, 1],
    { signal },
  ).catch(() => null);
  const stats = parseNumstatZ(result?.stdout ?? "")[0] ?? null;
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;
  const safety = classifyReviewFileMetadata({
    path: relativePath,
    additions,
    deletions,
    sizeBytes,
  });

  return {
    path: relativePath,
    previousPath: null,
    status: "untracked",
    rawStatus: null,
    oldOid: null,
    newOid: null,
    revision: await buildGitFileRevision({
      cwd,
      source: "unstaged",
      path: relativePath,
      status: "untracked",
      oldOid: null,
      newOid: null,
      worktreeHash:
        (await hashWorktreePaths(cwd, [relativePath], signal)).get(
          relativePath,
        ) ?? null,
    }),
    additions: safety.binary ? null : additions,
    deletions: safety.binary ? null : deletions,
    safety,
  };
}

async function readUntrackedMetadata(
  cwd: string,
  hideWhitespace?: boolean,
  signal?: AbortSignal,
): Promise<GitDiffFileMetadata[]> {
  const untrackedFiles = await listUntrackedFiles(cwd, signal);
  if (untrackedFiles.length === 0) return [];

  return mapWithConcurrency(
    untrackedFiles,
    REVIEW_UNTRACKED_DIFF_CONCURRENCY,
    (relativePath) =>
      readUntrackedFileMetadata(cwd, relativePath, hideWhitespace, signal),
  );
}

async function readGitReviewFiles(
  input: GitReviewSnapshotRequest,
  resolvedBaseRef: string | null,
  signal?: AbortSignal,
): Promise<GitReviewFileSummary[]> {
  if (input.source === "unstaged") {
    const diffArgs = buildGitReviewSourceDiffArgs({
      source: input.source,
      hideWhitespace: input.hideWhitespace,
      baseRef: resolvedBaseRef,
      commitSha: input.commitSha,
    });
    if (!diffArgs) return [];
    const [trackedFiles, untrackedFiles] = await Promise.all([
      readGitDiffMetadata(input.cwd, input.source, diffArgs, signal),
      readUntrackedMetadata(input.cwd, input.hideWhitespace, signal),
    ]);
    return [...trackedFiles, ...untrackedFiles];
  }

  const diffArgs = buildGitReviewSourceDiffArgs({
    source: input.source,
    hideWhitespace: input.hideWhitespace,
    baseRef: resolvedBaseRef,
    commitSha: input.commitSha,
  });
  if (!diffArgs) return [];
  return readGitDiffMetadata(input.cwd, input.source, diffArgs, signal);
}

async function resolveBaseRef(
  cwd: string,
  explicitBaseRef?: string | null,
): Promise<string | null> {
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
  const baseBranch =
    explicitBaseBranch?.trim() || (await resolveBaseRef(cwd, null));
  if (!baseBranch) {
    return {
      baseBranch: null,
      baseSha: null,
    };
  }

  const mergeBase = await runGitCommand(
    ["merge-base", "HEAD", baseBranch],
    cwd,
    [0, 1, 128],
    { signal },
  ).catch(() => null);
  const baseSha = mergeBase?.exitCode === 0 ? mergeBase.stdout.trim() : "";
  return {
    baseBranch,
    baseSha: baseSha || null,
  };
}

function parseBranchCommitLog(stdout: string): GitReviewBranchCommit[] {
  if (!stdout.trim()) return [];

  return stdout.split("\n").flatMap((line): GitReviewBranchCommit[] => {
    const [sha, committedAt, subject] = line.split("\0");
    if (!sha || !committedAt || subject === undefined) return [];
    return [
      {
        sha,
        committedAt,
        subject: subject || sha.slice(0, 12),
      },
    ];
  });
}

function buildMissingReviewFileTextRead(): ReviewFileTextRead {
  return {
    text: null,
    exists: false,
    status: "loaded",
    safety: buildReviewFileSafety(),
  };
}

function buildReviewFileTextRead(
  pathName: string,
  text: string,
  sizeBytes: number | null,
): ReviewFileTextRead {
  const safety = classifyReviewTextPayload({
    path: pathName,
    text,
    maxBytes: REVIEW_RENDERABLE_TEXT_MAX_BYTES,
  });
  if (!safety.renderable) {
    return {
      text: null,
      exists: true,
      status:
        safety.skipReason === "binary"
          ? "binary"
          : safety.skipReason === "tooLarge"
            ? "diff-too-large"
            : "unsupported",
      safety: {
        ...safety,
        sizeBytes: safety.sizeBytes ?? sizeBytes,
      },
    };
  }

  return {
    text,
    exists: true,
    status: "loaded",
    safety: {
      ...safety,
      sizeBytes: safety.sizeBytes ?? sizeBytes,
    },
  };
}

function mergeReviewFileTextSafety(
  left: ReviewFileTextRead,
  right: ReviewFileTextRead,
): ReviewFileSafety {
  if (!left.safety.renderable) return left.safety;
  if (!right.safety.renderable) return right.safety;
  return buildReviewFileSafety({
    sizeBytes: (left.safety.sizeBytes ?? 0) + (right.safety.sizeBytes ?? 0),
  });
}

async function readGitBlobText(
  cwd: string,
  ref: string,
  relativePath: string | null | undefined,
): Promise<ReviewFileTextRead> {
  const normalizedPath = relativePath?.trim() ?? "";
  if (!normalizedPath || normalizedPath === "/dev/null")
    return buildMissingReviewFileTextRead();

  const objectSpec =
    ref === ":" ? `:${normalizedPath}` : `${ref}:${normalizedPath}`;
  const sizeResult = await runGitCommand(
    ["cat-file", "-s", objectSpec],
    cwd,
    [0, 128],
  ).catch(() => null);
  if (!sizeResult || sizeResult.exitCode !== 0)
    return buildMissingReviewFileTextRead();

  const sizeBytes = Number(sizeResult.stdout.trim());
  if (
    Number.isFinite(sizeBytes) &&
    sizeBytes > REVIEW_RENDERABLE_TEXT_MAX_BYTES
  ) {
    const safety = buildReviewFileSafety({
      tooLarge: true,
      sizeBytes,
    });
    return {
      text: null,
      exists: true,
      status: "diff-too-large",
      safety,
    };
  }

  const result = await runGitCommand(["show", objectSpec], cwd, [0, 128]).catch(
    () => null,
  );
  if (!result || result.exitCode !== 0) return buildMissingReviewFileTextRead();
  return buildReviewFileTextRead(normalizedPath, result.stdout, sizeBytes);
}

async function readWorktreeFileText(
  cwd: string,
  relativePath: string | null | undefined,
): Promise<ReviewFileTextRead> {
  const normalizedPath = relativePath?.trim() ?? "";
  if (!normalizedPath || normalizedPath === "/dev/null")
    return buildMissingReviewFileTextRead();

  const absolutePath = path.resolve(cwd, normalizedPath);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) return buildMissingReviewFileTextRead();

  if (fileStat.size > REVIEW_RENDERABLE_TEXT_MAX_BYTES) {
    const safety = buildReviewFileSafety({
      tooLarge: true,
      sizeBytes: fileStat.size,
    });
    return {
      text: null,
      exists: true,
      status: "diff-too-large",
      safety,
    };
  }

  const contents = await readFile(absolutePath, "utf8").catch(() => null);
  if (contents === null) return buildMissingReviewFileTextRead();
  return buildReviewFileTextRead(normalizedPath, contents, fileStat.size);
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
    const baseRef =
      input.source === "branch"
        ? await resolveBaseRef(cwd, input.baseRef)
        : null;
    const files = await readGitReviewFiles(
      {
        ...input,
        cwd,
      },
      baseRef,
      signal,
    );

    return {
      cwd,
      source: input.source,
      patch: "",
      files,
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
      errorMessage:
        error instanceof Error
          ? error.message
          : "Could not load Git review snapshot.",
    };
  }
}

export async function readGitReviewSnapshot(
  input: GitReviewSnapshotRequest,
): Promise<GitReviewSnapshot> {
  return runGitReviewRequest(input.requestId, (signal) =>
    readGitReviewSnapshotWithSignal(input, signal),
  );
}

function filterGitReviewFileSummaries(
  files: GitReviewFileSummary[],
  requestedFiles?: string[],
): GitReviewFileSummary[] {
  const requestedPaths = new Set(
    (requestedFiles ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

  if (requestedPaths.size === 0) return files;

  return files.filter(
    (entry) =>
      requestedPaths.has(entry.path) ||
      (entry.previousPath ? requestedPaths.has(entry.previousPath) : false),
  );
}

function shouldLoadReviewFilePatch(file: GitReviewFileSummary): boolean {
  return (
    file.safety.renderable &&
    countNullableChangedLines(file) <= REVIEW_FILE_CHANGED_LINES_LIMIT
  );
}

function buildDiffPathspecs(files: GitReviewFileSummary[]): string[] {
  return Array.from(
    new Set(
      files.flatMap((file) =>
        file.previousPath ? [file.previousPath, file.path] : [file.path],
      ),
    ),
  );
}

function isGitOutputLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes("maxbuffer");
}

function buildFailedReviewDiffEntries(
  files: GitReviewFileSummary[],
  input: {
    loadStatus: ReviewDiffEntry["loadStatus"];
    errorMessage: string | null;
  },
): ReviewDiffEntry[] {
  return toReviewDiffEntries("", files).map((entry) => {
    if (!shouldLoadReviewFilePatch(entry)) return entry;

    const tooLarge = input.loadStatus === "diff-too-large";
    return {
      ...entry,
      loadStatus: input.loadStatus,
      diffError: input.errorMessage,
      canApplyPatchActions: false,
      tooLarge,
      tooLargeReason: tooLarge
        ? "File diff is above the review display limit."
        : entry.tooLargeReason,
      renderKey: `${entry.renderKey}:error:${input.loadStatus}`,
    };
  });
}

async function readTrackedReviewPatchForFiles(input: {
  cwd: string;
  diffArgs: string[];
  files: GitReviewFileSummary[];
  signal?: AbortSignal;
}): Promise<string> {
  const pathspecs = buildDiffPathspecs(input.files);
  if (pathspecs.length === 0) return "";

  const result = await runGitCommand(
    ["diff", ...input.diffArgs, "--", ...pathspecs],
    input.cwd,
    [0, 1],
    { signal: input.signal },
  );
  return result.stdout;
}

async function readUntrackedReviewPatchForFiles(input: {
  cwd: string;
  files: GitReviewFileSummary[];
  hideWhitespace?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const patches = await mapWithConcurrency(
    input.files,
    REVIEW_UNTRACKED_DIFF_CONCURRENCY,
    (file) =>
      readUntrackedFilePatch(
        input.cwd,
        file.path,
        input.hideWhitespace,
        input.signal,
      ),
  );
  return patches.filter((patch) => patch.trim().length > 0).join("\n");
}

async function readReviewPatchForFileSummaries(input: {
  cwd: string;
  source: GitReviewSource;
  hideWhitespace?: boolean;
  baseRef: string | null;
  commitSha?: string | null;
  files: GitReviewFileSummary[];
  signal?: AbortSignal;
}): Promise<{
  patch: string;
  errorMessage: string | null;
  outputLimitExceeded: boolean;
}> {
  const loadableFiles = input.files.filter(shouldLoadReviewFilePatch);
  if (loadableFiles.length === 0) {
    return { patch: "", errorMessage: null, outputLimitExceeded: false };
  }

  const untrackedFiles =
    input.source === "unstaged"
      ? loadableFiles.filter((file) => file.status === "untracked")
      : [];
  const trackedFiles =
    input.source === "unstaged"
      ? loadableFiles.filter((file) => file.status !== "untracked")
      : loadableFiles;

  try {
    const diffArgs = buildGitReviewSourceDiffArgs({
      source: input.source,
      hideWhitespace: input.hideWhitespace,
      baseRef: input.baseRef,
      commitSha: input.commitSha,
    });
    const [trackedPatch, untrackedPatch] = await Promise.all([
      diffArgs && trackedFiles.length > 0
        ? readTrackedReviewPatchForFiles({
            cwd: input.cwd,
            diffArgs,
            files: trackedFiles,
            signal: input.signal,
          })
        : Promise.resolve(""),
      untrackedFiles.length > 0
        ? readUntrackedReviewPatchForFiles({
            cwd: input.cwd,
            files: untrackedFiles,
            hideWhitespace: input.hideWhitespace,
            signal: input.signal,
          })
        : Promise.resolve(""),
    ]);
    return {
      patch: [trackedPatch, untrackedPatch]
        .filter((patch) => patch.trim().length > 0)
        .join("\n"),
      errorMessage: null,
      outputLimitExceeded: false,
    };
  } catch (error) {
    return {
      patch: "",
      errorMessage:
        error instanceof Error ? error.message : "Could not load review diff.",
      outputLimitExceeded: isGitOutputLimitError(error),
    };
  }
}

function buildFullReviewPatchFailure(input: {
  snapshot: GitReviewSnapshot;
  errorMessage: string | null;
  outputLimitExceeded: boolean;
}): GitReviewPatchResult {
  return {
    cwd: input.snapshot.cwd,
    source: input.snapshot.source,
    diff: {
      type: "error",
      errorMessage: input.errorMessage,
      outputLimitExceeded: input.outputLimitExceeded,
    },
    isGitRepository: input.snapshot.isGitRepository,
    baseRef: input.snapshot.baseRef,
    currentBranch: input.snapshot.currentBranch,
    defaultBranch: input.snapshot.defaultBranch,
    errorMessage: input.snapshot.errorMessage,
  };
}

async function readFullReviewPatch(input: {
  cwd: string;
  source: GitReviewSource;
  baseRef: string | null;
  commitSha?: string | null;
  files: GitReviewFileSummary[];
  signal?: AbortSignal;
}): Promise<{
  patch: string;
  errorMessage: string | null;
  outputLimitExceeded: boolean;
}> {
  const untrackedFiles =
    input.source === "unstaged"
      ? input.files.filter((file) => file.status === "untracked")
      : [];
  const trackedFiles =
    input.source === "unstaged"
      ? input.files.filter((file) => file.status !== "untracked")
      : input.files;

  try {
    const diffArgs = buildGitReviewSourceDiffArgs({
      source: input.source,
      baseRef: input.baseRef,
      commitSha: input.commitSha,
    });
    const [trackedPatch, untrackedPatch] = await Promise.all([
      diffArgs && trackedFiles.length > 0
        ? runGitCommand(["diff", ...diffArgs], input.cwd, [0, 1], {
            signal: input.signal,
          }).then((result) => result.stdout)
        : Promise.resolve(""),
      untrackedFiles.length > 0
        ? readUntrackedReviewPatchForFiles({
            cwd: input.cwd,
            files: untrackedFiles,
            signal: input.signal,
          })
        : Promise.resolve(""),
    ]);
    const patch = [trackedPatch, untrackedPatch]
      .filter((entry) => entry.trim().length > 0)
      .join("\n");
    if (Buffer.byteLength(patch, "utf8") > REVIEW_GIT_DIFF_MAX_BYTES) {
      return {
        patch: "",
        errorMessage: "Review patch is above the output limit.",
        outputLimitExceeded: true,
      };
    }
    return {
      patch,
      errorMessage: null,
      outputLimitExceeded: false,
    };
  } catch (error) {
    return {
      patch: "",
      errorMessage:
        error instanceof Error ? error.message : "Could not load review patch.",
      outputLimitExceeded: isGitOutputLimitError(error),
    };
  }
}

export async function readGitReviewPatch(
  input: GitReviewPatchRequest,
): Promise<GitReviewPatchResult> {
  return runGitReviewRequest(input.requestId, async (signal) => {
    const baseRef = input.baseBranch?.trim() || input.baseRef?.trim() || null;
    const snapshot = await readGitReviewSnapshotWithSignal(
      {
        cwd: input.cwd,
        source: input.source,
        baseRef,
        commitSha: input.commitSha,
      },
      signal,
    );

    if (!snapshot.isGitRepository || snapshot.errorMessage) {
      return buildFullReviewPatchFailure({
        snapshot,
        errorMessage: snapshot.errorMessage,
        outputLimitExceeded: false,
      });
    }

    const patchResult = await readFullReviewPatch({
      cwd: snapshot.cwd,
      source: snapshot.source,
      baseRef: snapshot.baseRef,
      commitSha: input.commitSha,
      files: snapshot.files,
      signal,
    });
    if (patchResult.errorMessage || patchResult.outputLimitExceeded) {
      return buildFullReviewPatchFailure({
        snapshot,
        errorMessage: patchResult.errorMessage,
        outputLimitExceeded: patchResult.outputLimitExceeded,
      });
    }

    return {
      cwd: snapshot.cwd,
      source: snapshot.source,
      diff: {
        type: "success",
        unifiedDiff: patchResult.patch,
        unifiedDiffBytes: Buffer.byteLength(patchResult.patch, "utf8"),
      },
      isGitRepository: snapshot.isGitRepository,
      baseRef: snapshot.baseRef,
      currentBranch: snapshot.currentBranch,
      defaultBranch: snapshot.defaultBranch,
      errorMessage: snapshot.errorMessage,
    };
  });
}

export async function readGitReviewDiff(
  input: ReviewDiffRequest,
): Promise<ReviewDiffResult> {
  return runGitReviewRequest(input.requestId, async (signal) => {
    const baseRef = input.baseBranch?.trim() || input.baseRef?.trim() || null;
    const snapshot = await readGitReviewSnapshotWithSignal(
      {
        cwd: input.cwd,
        source: input.source,
        baseRef,
        commitSha: input.commitSha,
        hideWhitespace: input.hideWhitespace,
      },
      signal,
    );
    const requestedFiles = filterGitReviewFileSummaries(
      snapshot.files,
      input.files,
    );
    const patchResult = await readReviewPatchForFileSummaries({
      cwd: snapshot.cwd,
      source: snapshot.source,
      hideWhitespace: input.hideWhitespace,
      baseRef: snapshot.baseRef,
      commitSha: input.commitSha,
      files: requestedFiles,
      signal,
    });
    const filteredEntries = patchResult.errorMessage
      ? buildFailedReviewDiffEntries(requestedFiles, {
          loadStatus: patchResult.outputLimitExceeded
            ? "diff-too-large"
            : "load-failed",
          errorMessage: patchResult.errorMessage,
        })
      : toReviewDiffEntries(patchResult.patch, requestedFiles);
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

export async function readGitReviewSummary(
  input: GitReviewSummaryRequest,
): Promise<GitReviewSummaryResult> {
  const baseRef = input.baseBranch?.trim() || input.baseRef?.trim() || null;
  const snapshot = await readGitReviewSnapshot({
    cwd: input.cwd,
    source: input.source,
    baseRef,
    commitSha: input.commitSha,
    hideWhitespace: input.hideWhitespace,
    requestId: input.requestId,
  });
  const additions = snapshot.files.reduce(
    (total, file) => total + (file.additions ?? 0),
    0,
  );
  const deletions = snapshot.files.reduce(
    (total, file) => total + (file.deletions ?? 0),
    0,
  );

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

export async function readBranchDiffStats(
  input: BranchDiffStatsRequest,
): Promise<BranchDiffStatsResult> {
  const baseRef = input.baseBranch?.trim() || input.baseRef?.trim() || null;
  const snapshot = await readGitReviewSnapshot({
    cwd: input.cwd,
    source: "branch",
    baseRef,
    hideWhitespace: input.hideWhitespace,
  });
  const additions = snapshot.files.reduce(
    (total, file) => total + (file.additions ?? 0),
    0,
  );
  const deletions = snapshot.files.reduce(
    (total, file) => total + (file.deletions ?? 0),
    0,
  );

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

    const { baseBranch, baseSha } = await resolveBranchComparisonBase(
      cwd,
      input.baseBranch,
      signal,
    );
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
        errorMessage:
          error instanceof Error
            ? error.message
            : "Could not load branch commits.",
      };
    }
  });
}

export async function resolveGitMergeBase(
  input: GitMergeBaseRequest,
): Promise<GitMergeBaseResult> {
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
      errorMessage:
        error instanceof Error
          ? error.message
          : "Could not resolve merge base.",
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
      oldStatus: "load-failed",
      newStatus: "load-failed",
      safety: buildReviewFileSafety({ unsupported: true }),
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
      oldStatus: "load-failed",
      newStatus: "load-failed",
      safety: buildReviewFileSafety({ unsupported: true }),
      errorMessage: "Git review is unavailable outside a Git repository.",
    };
  }

  try {
    const headExists = await hasHeadCommit(cwd);
    const baseRef =
      source === "branch" ? await resolveBaseRef(cwd, input.baseRef) : null;

    const oldRead =
      source === "unstaged"
        ? await readGitBlobText(cwd, ":", previousPath)
        : source === "staged"
          ? headExists
            ? await readGitBlobText(cwd, "HEAD", previousPath)
            : buildMissingReviewFileTextRead()
          : source === "commit"
            ? await readGitBlobText(
                cwd,
                `${input.commitSha?.trim() || "HEAD"}^`,
                previousPath,
              )
            : baseRef
              ? await readGitBlobText(cwd, baseRef, previousPath)
              : buildMissingReviewFileTextRead();

    const newRead =
      source === "unstaged"
        ? await readWorktreeFileText(cwd, normalizedPath)
        : source === "staged"
          ? await readGitBlobText(cwd, ":", normalizedPath)
          : source === "commit"
            ? await readGitBlobText(
                cwd,
                input.commitSha?.trim() || "HEAD",
                normalizedPath,
              )
            : headExists
              ? await readGitBlobText(cwd, "HEAD", normalizedPath)
              : await readWorktreeFileText(cwd, normalizedPath);

    return {
      path: normalizedPath,
      previousPath: normalizedPreviousPath,
      oldText: oldRead.text,
      newText: newRead.text,
      oldExists: oldRead.exists,
      newExists: newRead.exists,
      oldStatus: oldRead.status,
      newStatus: newRead.status,
      safety: mergeReviewFileTextSafety(oldRead, newRead),
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
      oldStatus: "load-failed",
      newStatus: "load-failed",
      safety: buildReviewFileSafety({ unsupported: true }),
      errorMessage:
        error instanceof Error
          ? error.message
          : "Could not load review file contents.",
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
  await Promise.all(
    snapshot.files.map(async (file) => {
      const haystacks = [file.path, file.previousPath ?? ""];
      if (
        haystacks.some((value) => value.toLowerCase().includes(normalizedQuery))
      ) {
        matchingPaths.add(file.path);
        return;
      }

      if (!file.safety.renderable) return;

      const fullContents = await readGitReviewFileContents({
        cwd: input.cwd,
        source: input.source,
        path: file.path,
        previousPath: file.previousPath,
        baseRef: input.baseBranch ?? input.baseRef ?? null,
        commitSha: input.commitSha ?? null,
      });
      if (!fullContents.safety.renderable) return;

      const contentHaystacks = [
        fullContents.oldText ?? "",
        fullContents.newText ?? "",
      ];
      if (
        contentHaystacks.some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        )
      ) {
        matchingPaths.add(file.path);
      }
    }),
  );

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

export async function readGitReviewBlameFile(
  input: GitReviewBlameInput,
): Promise<GitReviewBlameResult> {
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
      errorMessage:
        error instanceof Error ? error.message : "Could not load Git blame.",
    };
  }
}

export async function initializeGitRepositoryAndReadReviewSnapshot(
  cwd: string,
): Promise<GitReviewSnapshot> {
  const normalizedCwd = await ensureDirectory(cwd);
  const alreadyRepository = await isGitRepository(normalizedCwd);
  if (!alreadyRepository) {
    await runGitCommand(["init", "-b", "main"], normalizedCwd).catch(
      async () => {
        await runGitCommand(["init"], normalizedCwd);
        const branchState = await readGitBranchState(normalizedCwd);
        if (!branchState.currentBranch) {
          await runGitCommand(["checkout", "-b", "main"], normalizedCwd).catch(
            () => undefined,
          );
        }
      },
    );
  }

  return readGitReviewSnapshot({
    cwd: normalizedCwd,
    source: "unstaged",
  });
}

export async function applyGitReviewPatch(
  input: GitApplyPatchInput,
): Promise<GitApplyPatchResult> {
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
    "--binary",
    "--3way",
    "--recount",
    "--whitespace=nowarn",
    ...(input.target === "staged" ? ["--cached"] : []),
    ...(input.revert ? ["-R"] : []),
  ];
  const patchFilePath = path.join(
    tmpdir(),
    `nodex-git-apply-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`,
  );
  const patchText = input.diff.endsWith("\n") ? input.diff : `${input.diff}\n`;

  try {
    await writeFile(patchFilePath, patchText, "utf8");
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
      errorMessage:
        error instanceof Error ? error.message : "Could not apply patch.",
    };
  } finally {
    await rm(patchFilePath, { force: true }).catch(() => undefined);
  }
}
