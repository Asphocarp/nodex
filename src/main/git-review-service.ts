import { execFile, spawn } from "node:child_process";
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
  GitCatFileResult,
  GitReviewCatFileInput,
  GitReviewCatFileOutput,
  GitMergeBaseRequest,
  GitMergeBaseResult,
  GitReviewFileContents,
  GitReviewFileContentsInput,
  GitReviewPatchRequest,
  GitReviewPatchResult,
  GitReviewRepositoryMetadataRequest,
  GitReviewRepositoryMetadataResult,
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
const REVIEW_CAT_FILE_MAX_BYTES = 5_242_880;
const REVIEW_CAT_FILE_TIMEOUT_MS = 30_000;
const gitReviewAbortControllers = new Map<string, AbortController>();
const gitReviewSnapshotStates = new Map<
  string,
  {
    fingerprint: string;
    generation: number;
    verifiedAt: number;
    invalidationEpoch: number;
  }
>();
const gitReviewSnapshotGenerationReads = new Map<
  string,
  { invalidationEpoch: number; promise: Promise<number> }
>();
const gitReviewSnapshotInvalidationEpochs = new Map<string, number>();
const gitReviewObservedRepositoryCounts = new Map<string, number>();
let gitReviewSnapshotInvalidationSequence = 0;
const GIT_REVIEW_SNAPSHOT_COMMAND_CACHE_MS = 250;
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
  generated?: boolean | null;
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

class GitReviewStaleSnapshotError extends Error {
  constructor(
    readonly expectedGeneration: number,
    readonly actualGeneration: number,
  ) {
    super(
      `Git review snapshot changed (${expectedGeneration} -> ${actualGeneration}).`,
    );
    this.name = "GitReviewStaleSnapshotError";
  }
}

function parseDirtyWorktreePaths(status: string): string[] {
  const records = status.split("\0").filter(Boolean);
  const paths: string[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.length < 4) continue;
    const statusCode = record.slice(0, 2);
    const filePath = record.slice(3);
    if (filePath) paths.push(filePath);
    if (
      statusCode.includes("R") ||
      statusCode.includes("C")
    ) {
      index += 1;
    }
  }

  return paths;
}

async function readGitReviewRepositoryFingerprint(
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const [head, index, status] = await Promise.all([
    runGitCommand(["rev-parse", "--verify", "HEAD"], cwd, [0, 128], {
      signal,
    }).then((result) => result.stdout.trim()),
    runGitCommand(["ls-files", "-s", "-z"], cwd, [0], { signal }).then(
      (result) => result.stdout,
    ),
    runGitCommand(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      cwd,
      [0],
      { signal },
    ).then((result) => result.stdout),
  ]);
  const dirtyPaths = parseDirtyWorktreePaths(status);
  if (signal?.aborted) throw signal.reason;
  const worktreeIdentities = await Promise.all(
    dirtyPaths.map(async (filePath) => {
      const entry = await stat(path.resolve(cwd, filePath), {
        bigint: true,
      }).catch(() => null);
      if (!entry?.isFile()) return [filePath, null] as const;
      return [
        filePath,
        [
          entry.dev,
          entry.ino,
          entry.size,
          entry.mtimeNs,
          entry.ctimeNs,
        ].join(":"),
      ] as const;
    }),
  );
  if (signal?.aborted) throw signal.reason;

  return JSON.stringify([
    head,
    index,
    status,
    worktreeIdentities,
  ]);
}

async function readGitReviewSnapshotGeneration(
  cwd: string,
  signal?: AbortSignal,
  force = false,
): Promise<number> {
  const invalidationEpoch = gitReviewSnapshotInvalidationEpochs.get(cwd) ?? 0;
  const previous = gitReviewSnapshotStates.get(cwd);
  if (
    !force &&
    previous?.invalidationEpoch === invalidationEpoch &&
    Date.now() - previous.verifiedAt < GIT_REVIEW_SNAPSHOT_COMMAND_CACHE_MS
  ) {
    return previous.generation;
  }

  const existing = gitReviewSnapshotGenerationReads.get(cwd);
  if (!force && existing?.invalidationEpoch === invalidationEpoch) {
    return existing.promise;
  }

  const promise = readGitReviewRepositoryFingerprint(cwd, signal).then(
    async (fingerprint) => {
      const currentEpoch = gitReviewSnapshotInvalidationEpochs.get(cwd) ?? 0;
      if (currentEpoch !== invalidationEpoch) {
        return readGitReviewSnapshotGeneration(cwd, signal, force);
      }
      const current = gitReviewSnapshotStates.get(cwd);
      const generation = current?.fingerprint.startsWith("invalidated:")
        ? current.generation
        : current?.fingerprint === fingerprint
          ? current.generation
          : (current?.generation ?? 0) + 1;
      gitReviewSnapshotStates.set(cwd, {
        fingerprint,
        generation,
        verifiedAt: Date.now(),
        invalidationEpoch,
      });
      return generation;
    },
  );
  gitReviewSnapshotGenerationReads.set(cwd, { invalidationEpoch, promise });
  try {
    return await promise;
  } finally {
    if (gitReviewSnapshotGenerationReads.get(cwd)?.promise === promise) {
      gitReviewSnapshotGenerationReads.delete(cwd);
    }
  }
}

export function invalidateGitReviewSnapshot(cwd: string): void {
  const normalizedCwd = cwd.trim();
  if (!normalizedCwd) return;
  const previous = gitReviewSnapshotStates.get(normalizedCwd);
  gitReviewSnapshotInvalidationSequence += 1;
  const invalidationEpoch =
    (gitReviewSnapshotInvalidationEpochs.get(normalizedCwd) ?? 0) + 1;
  gitReviewSnapshotInvalidationEpochs.set(normalizedCwd, invalidationEpoch);
  gitReviewSnapshotStates.set(normalizedCwd, {
    fingerprint: `invalidated:${gitReviewSnapshotInvalidationSequence}`,
    generation: (previous?.generation ?? 0) + 1,
    verifiedAt: 0,
    invalidationEpoch,
  });
}

export function markGitReviewRepositoryObserved(
  cwd: string,
  observed: boolean,
): void {
  const normalizedCwd = cwd.trim();
  if (!normalizedCwd) return;
  const current = gitReviewObservedRepositoryCounts.get(normalizedCwd) ?? 0;
  const next = observed ? current + 1 : Math.max(0, current - 1);
  if (next === 0) {
    gitReviewObservedRepositoryCounts.delete(normalizedCwd);
    return;
  }
  gitReviewObservedRepositoryCounts.set(normalizedCwd, next);
}

async function assertGitReviewSnapshotGeneration(
  cwd: string,
  expectedGeneration: number,
  signal?: AbortSignal,
): Promise<void> {
  const observed = (gitReviewObservedRepositoryCounts.get(cwd) ?? 0) > 0;
  const actualGeneration = observed
    ? (gitReviewSnapshotStates.get(cwd)?.generation ??
      (await readGitReviewSnapshotGeneration(cwd, signal, true)))
    : await readGitReviewSnapshotGeneration(cwd, signal, true);
  if (actualGeneration === expectedGeneration) return;
  throw new GitReviewStaleSnapshotError(
    expectedGeneration,
    actualGeneration,
  );
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

async function readGeneratedReviewPaths(
  cwd: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  if (paths.length === 0) return new Set();
  const generated = new Set<string>();

  try {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const batch = paths.slice(offset, offset + 100);
      const result = await runGitCommand(
        ["check-attr", "-z", "linguist-generated", "--", ...batch],
        cwd,
        [0],
        { signal },
      );
      const records = result.stdout.split("\0");
      for (let index = 0; index + 2 < records.length; index += 3) {
        const filePath = records[index] ?? "";
        const attribute = records[index + 1] ?? "";
        const value = (records[index + 2] ?? "").toLowerCase();
        if (
          attribute === "linguist-generated" &&
          (value === "set" || value === "true")
        ) {
          generated.add(filePath);
        }
      }
    }
    return generated;
  } catch {
    return null;
  }
}

async function annotateGeneratedReviewFiles(
  cwd: string,
  files: GitDiffFileMetadata[],
  signal?: AbortSignal,
): Promise<GitDiffFileMetadata[]> {
  const generatedPaths = await readGeneratedReviewPaths(
    cwd,
    files.map((file) => file.path),
    signal,
  );
  return files.map((file) => ({
    ...file,
    generated:
      generatedPaths === null ? null : generatedPaths.has(file.path),
  }));
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
      input.includeUntrackedFiles === false
        ? Promise.resolve([])
        : readUntrackedMetadata(input.cwd, input.hideWhitespace, signal),
    ]);
    return annotateGeneratedReviewFiles(
      input.cwd,
      [...trackedFiles, ...untrackedFiles],
      signal,
    );
  }

  const diffArgs = buildGitReviewSourceDiffArgs({
    source: input.source,
    hideWhitespace: input.hideWhitespace,
    baseRef: resolvedBaseRef,
    commitSha: input.commitSha,
  });
  if (!diffArgs) return [];
  const files = await readGitDiffMetadata(
    input.cwd,
    input.source,
    diffArgs,
    signal,
  );
  return annotateGeneratedReviewFiles(input.cwd, files, signal);
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

function splitGitObjectLines(contents: string): string[] {
  const lines = contents.split(/(?<=\n)/);
  if (lines.length === 1 && lines[0] === "") return [];
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function runGitCatFileBatch(cwd: string, objectSpecs: string[]): Promise<Buffer> {
  if (objectSpecs.length === 0) return Promise.resolve(Buffer.alloc(0));

  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [...GIT_CONFIG_OVERRIDES, "cat-file", "--batch"],
      {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const outputChunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    const outputLimit =
      objectSpecs.length * (REVIEW_CAT_FILE_MAX_BYTES + 512);
    let outputBytes = 0;
    let settled = false;
    let outputLimitReached = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
    }, REVIEW_CAT_FILE_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      if (outputLimitReached) return;
      const remaining = outputLimit - outputBytes;
      if (remaining <= 0) {
        outputLimitReached = true;
        child.kill("SIGKILL");
        return;
      }
      const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      outputChunks.push(accepted);
      outputBytes += accepted.length;
      if (accepted.length !== chunk.length) {
        outputLimitReached = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => errorChunks.push(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = Buffer.concat(outputChunks);
      if (exitCode === 0 || outputLimitReached) {
        resolve(output);
        return;
      }
      reject(
        new Error(
          Buffer.concat(errorChunks).toString("utf8").trim() ||
            "Could not read Git objects.",
        ),
      );
    });

    child.stdin.end(`${objectSpecs.join("\n")}\n`);
  });
}

function parseGitCatFileBatch(
  output: Buffer,
  requestCount: number,
): { results: GitCatFileResult[]; processed: number } {
  const results: GitCatFileResult[] = [];
  let offset = 0;

  for (let index = 0; index < requestCount; index += 1) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) break;
    const header = output.subarray(offset, headerEnd).toString("utf8");
    offset = headerEnd + 1;

    if (header.endsWith(" missing")) {
      results.push({ type: "error", error: { type: "not-found" } });
      continue;
    }

    const match = /^\S+\s+\S+\s+(\d+)$/.exec(header);
    const sizeBytes = Number(match?.[1] ?? "NaN");
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
      results.push({ type: "error", error: { type: "unknown" } });
      continue;
    }
    if (sizeBytes > REVIEW_CAT_FILE_MAX_BYTES) {
      results.push({
        type: "error",
        error: {
          type: "too-large",
          limitBytes: REVIEW_CAT_FILE_MAX_BYTES,
        },
      });
      if (offset + sizeBytes + 1 <= output.length) {
        offset += sizeBytes + 1;
        continue;
      }
      return { results, processed: index + 1 };
    }
    if (offset + sizeBytes > output.length) {
      results.push({ type: "error", error: { type: "unknown" } });
      return { results, processed: index + 1 };
    }

    const contents = output.subarray(offset, offset + sizeBytes).toString("utf8");
    offset += sizeBytes;
    if (output[offset] === 0x0a) offset += 1;
    results.push({ type: "success", lines: splitGitObjectLines(contents) });
  }

  return { results, processed: results.length };
}

async function readGitCatFileObjectBatch(
  cwd: string,
  objectSpecs: string[],
): Promise<GitCatFileResult[]> {
  if (objectSpecs.length === 0) return [];

  try {
    const output = await runGitCatFileBatch(cwd, objectSpecs);
    const parsed = parseGitCatFileBatch(output, objectSpecs.length);
    if (parsed.processed >= objectSpecs.length) return parsed.results;
    const remaining = await readGitCatFileObjectBatch(
      cwd,
      objectSpecs.slice(parsed.processed),
    );
    return [...parsed.results, ...remaining];
  } catch {
    return objectSpecs.map(() => ({
      type: "error" as const,
      error: { type: "unknown" as const },
    }));
  }
}

async function readGitCatFileFallback(
  cwd: string,
  relativePath: string,
): Promise<GitCatFileResult> {
  const normalizedPath = relativePath.trim();
  if (!normalizedPath || normalizedPath === "/dev/null") {
    return { type: "error", error: { type: "not-found" } };
  }
  const absolutePath = path.resolve(cwd, normalizedPath);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return { type: "error", error: { type: "not-found" } };
  }
  if (fileStat.size > REVIEW_CAT_FILE_MAX_BYTES) {
    return {
      type: "error",
      error: {
        type: "too-large",
        limitBytes: REVIEW_CAT_FILE_MAX_BYTES,
      },
    };
  }
  const contents = await readFile(absolutePath).catch(() => null);
  if (contents === null) {
    return { type: "error", error: { type: "unknown" } };
  }
  if (contents.byteLength > REVIEW_CAT_FILE_MAX_BYTES) {
    return {
      type: "error",
      error: {
        type: "too-large",
        limitBytes: REVIEW_CAT_FILE_MAX_BYTES,
      },
    };
  }
  const text = contents.toString("utf8");
  const safety = classifyReviewTextPayload({
    path: normalizedPath,
    text,
    maxBytes: REVIEW_CAT_FILE_MAX_BYTES,
  });
  if (!safety.renderable) {
    return { type: "error", error: { type: "unknown" } };
  }
  return { type: "success", lines: splitGitObjectLines(text) };
}

export async function readGitReviewCatFile(
  input: GitReviewCatFileInput,
): Promise<GitReviewCatFileOutput> {
  const cwd = await ensureDirectory(input.cwd);
  try {
    await assertGitReviewSnapshotGeneration(
      cwd,
      input.snapshotGeneration,
    );
  } catch (error) {
    if (!(error instanceof GitReviewStaleSnapshotError)) throw error;
    return {
      snapshotGeneration: input.snapshotGeneration,
      results: input.requests.map(() => ({
        type: "error",
        error: { type: "unknown" },
      })),
    };
  }

  const results: GitCatFileResult[] = input.requests.map(() => ({
    type: "error",
    error: { type: "not-found" },
  }));
  const objectRequests = input.requests.flatMap((request, index) => {
    const objectSpec = request.oid?.trim() ?? "";
    if (!objectSpec || objectSpec.includes("\n") || objectSpec.includes("\r")) {
      return [];
    }
    return [{ index, objectSpec }];
  });

  for (let offset = 0; offset < objectRequests.length; offset += 4) {
    const batch = objectRequests.slice(offset, offset + 4);
    const batchResults = await readGitCatFileObjectBatch(
      cwd,
      batch.map((request) => request.objectSpec),
    );
    batch.forEach((request, index) => {
      results[request.index] =
        batchResults[index] ?? { type: "error", error: { type: "unknown" } };
    });
  }

  await Promise.all(
    input.requests.map(async (request, index) => {
      const result = results[index];
      if (
        result?.type !== "error" ||
        result.error.type !== "not-found" ||
        request.fallbackToDisk !== true
      ) {
        return;
      }
      results[index] = await readGitCatFileFallback(cwd, request.path);
    }),
  );
  try {
    await assertGitReviewSnapshotGeneration(cwd, input.snapshotGeneration);
    return { snapshotGeneration: input.snapshotGeneration, results };
  } catch (error) {
    if (!(error instanceof GitReviewStaleSnapshotError)) throw error;
    return {
      snapshotGeneration: input.snapshotGeneration,
      results: input.requests.map(() => ({
        type: "error",
        error: { type: "unknown" },
      })),
    };
  }
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
  const snapshotGeneration = gitRepository
    ? await readGitReviewSnapshotGeneration(cwd, signal)
    : 0;

  if (
    gitRepository &&
    input.snapshotGeneration !== undefined &&
    input.snapshotGeneration !== null
  ) {
    await assertGitReviewSnapshotGeneration(
      cwd,
      input.snapshotGeneration,
      signal,
    );
  }

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
      snapshotGeneration,
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
    await assertGitReviewSnapshotGeneration(cwd, snapshotGeneration, signal);

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
      snapshotGeneration,
    };
  } catch (error) {
    if (error instanceof GitReviewStaleSnapshotError) throw error;
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
        snapshotGeneration: 0,
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
      snapshotGeneration,
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

function buildRequestedGitReviewFileSummaries(
  requestedFiles: NonNullable<ReviewDiffRequest["files"]>,
): GitReviewFileSummary[] {
  return requestedFiles.flatMap((file): GitReviewFileSummary[] => {
    const pathName = file.path.trim();
    if (!pathName) return [];
    const previousPath = file.previousPath?.trim() || null;
    return [{
      path: pathName,
      previousPath,
      status: file.status,
      rawStatus: null,
      oldOid: null,
      newOid: null,
      revision: file.revision?.trim() || null,
      additions: null,
      deletions: null,
      safety: classifyReviewFileMetadata({ path: pathName }),
    }];
  });
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
  try {
    return await runGitReviewRequest(input.requestId, async (signal) => {
      const cwd = await ensureDirectory(input.cwd);
      const snapshotGeneration = input.snapshotGeneration;
      if (snapshotGeneration === undefined || snapshotGeneration === null) {
        throw new Error("Git review snapshot generation is required.");
      }
      if (!(await isGitRepository(cwd))) {
        return {
          type: "success",
          cwd,
          source: input.source,
          patch: "",
          files: [],
          isGitRepository: false,
          baseRef: null,
          currentBranch: null,
          defaultBranch: null,
          errorMessage: null,
          snapshotGeneration,
        };
      }

      await assertGitReviewSnapshotGeneration(
        cwd,
        snapshotGeneration,
        signal,
      );
      const requestedFiles = buildRequestedGitReviewFileSummaries(
        input.files ?? [],
      );
      const baseRef = input.baseBranch?.trim() || input.baseRef?.trim() || null;
      const patchResult = await readReviewPatchForFileSummaries({
        cwd,
        source: input.source,
        hideWhitespace: input.hideWhitespace,
        baseRef,
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
      await assertGitReviewSnapshotGeneration(cwd, snapshotGeneration, signal);

      return {
        type: "success",
        cwd,
        source: input.source,
        patch: filteredPatch,
        files: filteredEntries,
        isGitRepository: true,
        baseRef,
        currentBranch: null,
        defaultBranch: null,
        errorMessage: null,
        snapshotGeneration,
      };
    });
  } catch (error) {
    if (!(error instanceof GitReviewStaleSnapshotError)) throw error;
    return { type: "stale-snapshot", source: input.source };
  }
}

async function readGitReviewStageCounts(cwd: string): Promise<{
  stagedFileCount: number;
  unstagedFileCount: number;
  untrackedFileCount: number;
}> {
  const result = await runGitCommand(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    cwd,
  );
  const records = result.stdout.split("\0").filter(Boolean);
  let stagedFileCount = 0;
  let unstagedFileCount = 0;
  let untrackedFileCount = 0;

  for (let index = 0; index < records.length; index += 1) {
    const statusCode = (records[index] ?? "").slice(0, 2);
    if (statusCode === "??") {
      untrackedFileCount += 1;
      continue;
    }
    if (statusCode[0] && statusCode[0] !== " ") stagedFileCount += 1;
    if (statusCode[1] && statusCode[1] !== " ") unstagedFileCount += 1;
    if (statusCode.includes("R") || statusCode.includes("C")) index += 1;
  }

  return { stagedFileCount, unstagedFileCount, untrackedFileCount };
}

export async function readGitReviewSummary(
  input: GitReviewSummaryRequest,
): Promise<GitReviewSummaryResult> {
  try {
    const baseRef = input.baseBranch?.trim() || input.baseRef?.trim() || null;
    const snapshot = await readGitReviewSnapshot({
      cwd: input.cwd,
      source: input.source,
      baseRef,
      commitSha: input.commitSha,
      hideWhitespace: input.hideWhitespace,
      requestId: input.requestId,
      includeUntrackedFiles: input.includeUntrackedFiles,
    });
    if (snapshot.errorMessage) {
      return {
        type: "error",
        source: input.source,
        errorMessage: snapshot.errorMessage,
      };
    }
    const stageCounts = snapshot.isGitRepository
      ? await readGitReviewStageCounts(snapshot.cwd)
      : {
          stagedFileCount: 0,
          unstagedFileCount: 0,
          untrackedFileCount: 0,
        };
    if (snapshot.isGitRepository) {
      await assertGitReviewSnapshotGeneration(
        snapshot.cwd,
        snapshot.snapshotGeneration,
      );
    }

    return {
      type: "success",
      source: snapshot.source,
      files: snapshot.files,
      snapshotGeneration: snapshot.snapshotGeneration,
      stageCounts,
    };
  } catch (error) {
    if (error instanceof GitReviewStaleSnapshotError) throw error;
    return {
      type: "error",
      source: input.source,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Could not load the Git review summary.",
    };
  }
}

export async function readGitReviewRepositoryMetadata(
  input: GitReviewRepositoryMetadataRequest,
): Promise<GitReviewRepositoryMetadataResult> {
  try {
    const cwd = await ensureDirectory(input.cwd);
    const gitRepository = await isGitRepository(cwd);
    if (!gitRepository) {
      return {
        cwd,
        root: null,
        gitDir: null,
        commonDir: null,
        isGitRepository: false,
        currentBranch: null,
        defaultBranch: null,
        errorMessage: null,
      };
    }

    const [branchState, rootResult, gitDirResult, commonDirResult] =
      await Promise.all([
        readGitBranchState(cwd),
        runGitCommand(["rev-parse", "--show-toplevel"], cwd),
        runGitCommand(["rev-parse", "--git-dir"], cwd),
        runGitCommand(["rev-parse", "--git-common-dir"], cwd),
      ]);
    return {
      cwd,
      root: path.resolve(cwd, rootResult.stdout.trim()),
      gitDir: path.resolve(cwd, gitDirResult.stdout.trim()),
      commonDir: path.resolve(cwd, commonDirResult.stdout.trim()),
      isGitRepository: true,
      currentBranch: branchState.currentBranch,
      defaultBranch: branchState.defaultBranch,
      errorMessage: null,
    };
  } catch (error) {
    return {
      cwd: input.cwd,
      root: null,
      gitDir: null,
      commonDir: null,
      isGitRepository: false,
      currentBranch: null,
      defaultBranch: null,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Could not read Git repository metadata.",
    };
  }
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

interface GitReviewSearchAccumulator {
  query: string;
  limit: number;
  matchingPaths: string[];
  totalMatches: number;
}

function countSearchOccurrences(value: string, query: string): number {
  if (!value || !query) return 0;
  const normalizedValue = value.toLowerCase();
  let count = 0;
  let offset = 0;
  for (;;) {
    const index = normalizedValue.indexOf(query, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + Math.max(1, query.length);
  }
}

function addGitReviewSearchMatches(
  accumulator: GitReviewSearchAccumulator,
  filePath: string,
  count: number,
): void {
  if (count <= 0) return;
  accumulator.totalMatches += count;
  const available = Math.max(0, accumulator.limit - accumulator.matchingPaths.length);
  const storedCount = Math.min(available, count);
  for (let index = 0; index < storedCount; index += 1) {
    accumulator.matchingPaths.push(filePath);
  }
}

function normalizeGitPatchSearchPath(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || normalized === "/dev/null") return null;
  if (normalized.startsWith("b/")) return normalized.slice(2);
  return normalized;
}

function scanGitReviewPatchLines(input: {
  lines: readonly string[];
  generatedPaths: ReadonlySet<string>;
  accumulator: GitReviewSearchAccumulator;
  state: { currentPath: string | null; inHunk: boolean };
}): void {
  for (const line of input.lines) {
    if (line.startsWith("diff --git ")) {
      input.state.currentPath = null;
      input.state.inHunk = false;
      continue;
    }
    if (line.startsWith("+++ ")) {
      input.state.currentPath = normalizeGitPatchSearchPath(line.slice(4));
      continue;
    }
    if (line.startsWith("@@")) {
      input.state.inHunk = true;
      continue;
    }
    const filePath = input.state.currentPath;
    if (!filePath || !input.state.inHunk) continue;
    if (input.generatedPaths.has(filePath)) continue;
    const prefix = line.charAt(0);
    if (prefix !== "+" && prefix !== "-" && prefix !== " ") continue;
    addGitReviewSearchMatches(
      input.accumulator,
      filePath,
      countSearchOccurrences(line.slice(1), input.accumulator.query),
    );
  }
}

function streamTrackedGitReviewSearch(input: {
  cwd: string;
  diffArgs: string[];
  paths: string[];
  generatedPaths: ReadonlySet<string>;
  accumulator: GitReviewSearchAccumulator;
  signal?: AbortSignal;
}): Promise<void> {
  if (input.paths.length === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        ...GIT_CONFIG_OVERRIDES,
        "diff",
        ...input.diffArgs,
        "--unified=3",
        "--",
        ...input.paths,
      ],
      {
        cwd: input.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const state = { currentPath: null as string | null, inHunk: false };
    let pending = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
    const abort = () => child.kill("SIGKILL");
    input.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      scanGitReviewPatchLines({
        lines,
        generatedPaths: input.generatedPaths,
        accumulator: input.accumulator,
        state,
      });
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 8_192) stderr += chunk;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      if (pending) {
        scanGitReviewPatchLines({
          lines: [pending],
          generatedPaths: input.generatedPaths,
          accumulator: input.accumulator,
          state,
        });
      }
      if (input.signal?.aborted) {
        reject(new DOMException("Git review search aborted", "AbortError"));
        return;
      }
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || "Could not search the Git review diff."));
    });
  });
}

export async function searchGitReview(
  input: GitReviewSearchInput,
): Promise<GitReviewSearchResult> {
  const normalizedQuery = input.query.trim().toLowerCase();
  if (!normalizedQuery) {
    return {
      type: "success",
      source: input.source,
      query: input.query,
      matchingPaths: [],
      totalMatches: 0,
      isCapped: false,
      snapshotGeneration: input.snapshotGeneration ?? 0,
    };
  }

  try {
    return await runGitReviewRequest(input.requestId, async (signal) => {
      const cwd = await ensureDirectory(input.cwd);
      if (!(await isGitRepository(cwd))) {
        return {
          type: "success" as const,
          source: input.source,
          query: input.query,
          matchingPaths: [],
          totalMatches: 0,
          isCapped: false,
          snapshotGeneration: 0,
        };
      }
      const snapshotGeneration =
        input.snapshotGeneration ??
        (await readGitReviewSnapshotGeneration(cwd, signal));
      await assertGitReviewSnapshotGeneration(cwd, snapshotGeneration, signal);

      const baseRef =
        input.source === "branch"
          ? await resolveBaseRef(
              cwd,
              input.baseBranch ?? input.baseRef ?? null,
            )
          : null;
      const diffArgs = buildGitReviewSourceDiffArgs({
        source: input.source,
        hideWhitespace: input.hideWhitespace,
        baseRef,
        commitSha: input.commitSha,
      });
      const trackedPaths = diffArgs
        ? (
            await runGitCommand(
              ["diff", ...diffArgs, "--name-only", "-z"],
              cwd,
              [0, 1],
              { signal },
            )
          ).stdout.split("\0").filter(Boolean)
        : [];
      const untrackedPaths =
        input.source === "unstaged"
          ? (
              await runGitCommand(
                ["ls-files", "--others", "--exclude-standard", "-z"],
                cwd,
                [0],
                { signal },
              )
            ).stdout.split("\0").filter(Boolean)
          : [];
      const paths = Array.from(new Set([...trackedPaths, ...untrackedPaths]));
      const generatedPaths = await readGeneratedReviewPaths(cwd, paths, signal);
      if (generatedPaths === null) {
        throw new Error("Could not resolve generated-file attributes.");
      }

      const accumulator: GitReviewSearchAccumulator = {
        query: normalizedQuery,
        limit: Math.max(0, Math.min(input.limit ?? 250, 250)),
        matchingPaths: [],
        totalMatches: 0,
      };
      for (const filePath of paths) {
        addGitReviewSearchMatches(
          accumulator,
          filePath,
          countSearchOccurrences(filePath, normalizedQuery) > 0 ? 1 : 0,
        );
      }

      if (diffArgs && trackedPaths.length > 0) {
        await streamTrackedGitReviewSearch({
          cwd,
          diffArgs,
          paths: trackedPaths,
          generatedPaths,
          accumulator,
          signal,
        });
      }
      await mapWithConcurrency(untrackedPaths, 4, async (filePath) => {
        if (generatedPaths.has(filePath)) return;
        const patch = await readUntrackedFilePatch(
          cwd,
          filePath,
          input.hideWhitespace,
          signal,
        );
        scanGitReviewPatchLines({
          lines: patch.split(/\r?\n/),
          generatedPaths,
          accumulator,
          state: { currentPath: null, inHunk: false },
        });
      });
      await assertGitReviewSnapshotGeneration(cwd, snapshotGeneration, signal);

      return {
        type: "success" as const,
        source: input.source,
        query: input.query,
        matchingPaths: accumulator.matchingPaths,
        totalMatches: accumulator.totalMatches,
        isCapped: accumulator.totalMatches > accumulator.matchingPaths.length,
        snapshotGeneration,
      };
    });
  } catch (error) {
    if (error instanceof GitReviewStaleSnapshotError) {
      return {
        type: "stale-snapshot",
        source: input.source,
        query: input.query,
      };
    }
    return {
      type: "error",
      source: input.source,
      query: input.query,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Could not search the Git review.",
    };
  }
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
    invalidateGitReviewSnapshot(normalizedCwd);
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
    invalidateGitReviewSnapshot(cwd);
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
