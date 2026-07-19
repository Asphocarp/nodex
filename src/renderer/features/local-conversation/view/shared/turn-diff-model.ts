import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { buildCodexFileChangeUnifiedDiff, isCodexFileChange } from "../../../../../shared/codex-file-change";
import type {
  CodexTranscriptEntry,
  CodexTurnDiffPatchBatch,
  CodexTurnDiffReviewSource,
} from "../../../../lib/types";
import { canonicalizeReviewPath } from "@/features/review/model/review-path";
import type {
  CanonicalReviewPath,
  ReviewOpenIntent,
} from "@/features/review/model/review-view-state";
import {
  basename,
  normalizePathSegments,
  resolveOpenPath,
  stripPatchPrefix,
  summarizeDiff,
  summarizeFileDiffMetadata,
} from "./tools/diff-file-shared";

export const TURN_DIFF_DEFAULT_VISIBLE_FILE_COUNT = 3;
export const TURN_DIFF_MAX_INLINE_LINES = 5000;

export interface TurnDiffPayload {
  unifiedDiff: string;
  cwd?: string;
  showRevertButton?: boolean;
  patchBatches?: CodexTurnDiffPatchBatch[] | null;
}

export interface TurnDiffFileStat {
  path: string;
  additions: number;
  deletions: number;
  renderedLineEstimate: number;
}

export interface TurnDiffSummary {
  fileCount: number;
  additions: number;
  deletions: number;
}

export interface TurnDiffRowModel {
  key: string;
  displayPath: string;
  reviewPath: CanonicalReviewPath;
  fileName: string;
  openPath: string | null;
  openLine?: number;
  fileDiff: FileDiffMetadata | null;
  additions: number;
  deletions: number;
  renderedLineEstimate: number;
  isTooLarge: boolean;
}

export interface TurnDiffApplyBatch {
  cwd: string;
  diff: string;
}

export function extractTurnDiffPayload(item: CodexTranscriptEntry): TurnDiffPayload | null {
  const rawItem = item.rawItem;
  if (typeof rawItem !== "object" || rawItem === null) return null;

  const unifiedDiff = (rawItem as { unifiedDiff?: unknown }).unifiedDiff;
  if (typeof unifiedDiff !== "string" || unifiedDiff.trim().length === 0) return null;

  const cwd = (rawItem as { cwd?: unknown }).cwd;
  const showRevertButton = (rawItem as { showRevertButton?: unknown }).showRevertButton;
  const patchBatches = (rawItem as { patchBatches?: unknown }).patchBatches;

  return {
    unifiedDiff,
    cwd: typeof cwd === "string" && cwd.trim().length > 0 ? cwd : undefined,
    showRevertButton: showRevertButton === true,
    patchBatches: Array.isArray(patchBatches) ? normalizePatchBatches(patchBatches) : undefined,
  };
}

export function normalizeTurnDiffBasePath(
  payload: TurnDiffPayload | null,
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
): string | null {
  const basePath = payload?.cwd ?? threadCwd ?? projectWorkspacePath ?? null;
  if (!basePath) return null;
  const normalizedPath = normalizePathSegments(basePath);
  return normalizedPath.length > 0 ? normalizedPath : null;
}

export function buildTurnDiffReviewIntent(input: {
  item: CodexTranscriptEntry;
  threadCwd?: string;
  projectWorkspacePath?: string;
  source?: CodexTurnDiffReviewSource;
  path?: CanonicalReviewPath | null;
}): ReviewOpenIntent | null {
  const payload = extractTurnDiffPayload(input.item);
  if (!payload || input.item.turnId === null) return null;

  return {
    source: input.source === "selected-turn"
      ? {
          kind: "selected-turn",
          threadId: input.item.threadId,
          turnId: input.item.turnId,
          entryId: input.item.entryId ?? input.item.itemId,
        }
      : { kind: "last-turn", threadId: input.item.threadId },
    ...(input.path ? { targetPath: input.path } : {}),
  };
}

export function parseUnifiedDiffFileStats(diffText: string): TurnDiffFileStat[] {
  const stats = new Map<string, TurnDiffFileStat>();
  let currentPath: string | null = null;
  let inHunk = false;

  for (const line of diffText.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    const nextPath = parseDiffGitHeaderPath(line);
    if (nextPath !== null) {
      currentPath = stripPatchPrefix(nextPath);
      inHunk = false;
      ensureFileStat(stats, currentPath);
      continue;
    }

    if (!currentPath) continue;
    const stat = ensureFileStat(stats, currentPath);

    if (line.startsWith("@@")) {
      inHunk = true;
      stat.renderedLineEstimate += 1;
      continue;
    }

    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      stat.additions += 1;
      stat.renderedLineEstimate += 1;
      continue;
    }
    if (line.startsWith("-")) {
      stat.deletions += 1;
      stat.renderedLineEstimate += 1;
      continue;
    }
    if (inHunk && (line.startsWith(" ") || line.startsWith("\\"))) {
      stat.renderedLineEstimate += 1;
    }
  }

  const fileStats = Array.from(stats.values()).filter((stat) => (
    stat.additions > 0 || stat.deletions > 0 || stat.renderedLineEstimate > 0
  ));
  if (fileStats.length > 0 || diffText.trim().length === 0) return fileStats;

  return fallbackPatchStats(diffText);
}

export function isLargeTurnDiffFile(input: {
  additions: number;
  deletions: number;
  renderedLineEstimate: number;
}): boolean {
  return Math.max(input.renderedLineEstimate, input.additions + input.deletions) > TURN_DIFF_MAX_INLINE_LINES;
}

export function buildTurnDiffDisplayPath(path: string, basePath: string | null): string {
  const rawPath = stripPatchPrefix(path);
  if (!basePath) return rawPath;

  const normalizedPath = normalizePathSegments(rawPath);
  if (normalizedPath.length === 0) return rawPath;
  if (!isAbsoluteDisplayPath(normalizedPath)) return rawPath;

  const normalizedBasePath = normalizePathSegments(basePath);
  if (normalizedBasePath.length === 0) return rawPath;
  if (!isAbsoluteDisplayPath(normalizedBasePath)) return rawPath;

  const relativePath = relativeDisplayPath(normalizedPath, normalizedBasePath);
  return relativePath.length > 0 ? relativePath : basename(normalizedPath);
}

export function buildTurnDiffRows(
  item: CodexTranscriptEntry,
  threadCwd: string | undefined,
  projectWorkspacePath: string | undefined,
): TurnDiffRowModel[] {
  const payload = extractTurnDiffPayload(item);
  if (!payload) return [];

  const basePath = normalizeTurnDiffBasePath(payload, threadCwd, projectWorkspacePath);
  const fileStats = parseUnifiedDiffFileStats(payload.unifiedDiff);
  if (fileStats.length === 0) return [];

  const parsedFilesByPath = new Map<string, FileDiffMetadata[]>();
  const hasInlineCandidate = fileStats.some((stat) => !isLargeTurnDiffFile(stat));
  if (hasInlineCandidate) {
    try {
      for (const patch of parsePatchFiles(payload.unifiedDiff)) {
        for (const fileDiff of patch.files) {
          const path = stripPatchPrefix(fileDiff.name ?? fileDiff.prevName ?? "");
          if (path.length === 0) continue;
          const files = parsedFilesByPath.get(path) ?? [];
          files.push(fileDiff);
          parsedFilesByPath.set(path, files);
        }
      }
    } catch {
      parsedFilesByPath.clear();
    }
  }

  return fileStats.map((stat, index) => {
    const parsedFiles = parsedFilesByPath.get(stat.path) ?? [];
    const fileDiff = parsedFiles.shift() ?? null;
    if (parsedFiles.length > 0) parsedFilesByPath.set(stat.path, parsedFiles);
    const renderedLineEstimate = fileDiff
      ? Math.max(fileDiff.unifiedLineCount, fileDiff.splitLineCount, stat.renderedLineEstimate)
      : stat.renderedLineEstimate;
    const additions = fileDiff ? summarizeFileDiffMetadata(fileDiff).additions : stat.additions;
    const deletions = fileDiff ? summarizeFileDiffMetadata(fileDiff).deletions : stat.deletions;
    const rawPath = stripPatchPrefix(stat.path);
    const displayPath = buildTurnDiffDisplayPath(rawPath, basePath);
    const reviewPath = canonicalizeReviewPath(rawPath, [basePath]);

    return {
      key: `${item.entryId ?? item.itemId}:${rawPath}:${index}`,
      displayPath,
      reviewPath,
      fileName: basename(displayPath),
      openPath: resolveOpenPath(rawPath, basePath),
      openLine: resolveOpenLine(fileDiff),
      fileDiff,
      additions,
      deletions,
      renderedLineEstimate,
      isTooLarge: isLargeTurnDiffFile({ additions, deletions, renderedLineEstimate }),
    };
  });
}

export function summarizeTurnDiffRows(rows: readonly TurnDiffRowModel[]): TurnDiffSummary {
  return rows.reduce(
    (summary, row) => ({
      fileCount: summary.fileCount + 1,
      additions: summary.additions + row.additions,
      deletions: summary.deletions + row.deletions,
    }),
    { fileCount: 0, additions: 0, deletions: 0 },
  );
}

export function getTurnDiffTitle(summary: TurnDiffSummary, firstPath: string | null): string {
  if (summary.fileCount === 1 && firstPath) return `Edited ${basename(firstPath)}`;
  return `Edited ${summary.fileCount} files`;
}

export function getVisibleTurnDiffRows(
  rows: readonly TurnDiffRowModel[],
  expanded: boolean,
): readonly TurnDiffRowModel[] {
  if (expanded) return rows;
  return rows.slice(0, TURN_DIFF_DEFAULT_VISIBLE_FILE_COUNT);
}

export function getTurnDiffDisclosureLabel(totalFiles: number, expanded: boolean): string {
  if (expanded) return "Collapse files";
  return `Show ${Math.max(0, totalFiles - TURN_DIFF_DEFAULT_VISIBLE_FILE_COUNT)} more files`;
}

export function buildTurnDiffApplyBatches(
  payload: TurnDiffPayload | null,
  fallbackCwd: string | null,
): TurnDiffApplyBatch[] {
  if (!payload) return [];

  if (payload.patchBatches !== undefined && payload.patchBatches !== null) {
    return payload.patchBatches.flatMap((batch) => {
      const cwd = normalizeApplyCwd(batch.cwd ?? fallbackCwd);
      if (!cwd) return [];
      const diff = batch.changes
        .flatMap((change: unknown) => {
          if (!isCodexFileChange(change)) return [];
          const changeDiff = buildCodexFileChangeUnifiedDiff(change);
          return changeDiff ? [changeDiff] : [];
        })
        .join("\n");
      if (diff.trim().length === 0) return [];
      return [{ cwd, diff }];
    });
  }

  const cwd = normalizeApplyCwd(fallbackCwd ?? payload.cwd ?? null);
  if (!cwd || payload.unifiedDiff.trim().length === 0) return [];
  return [{ cwd, diff: payload.unifiedDiff }];
}

function normalizePatchBatches(value: unknown[]): CodexTurnDiffPatchBatch[] {
  return value.flatMap((batch) => {
    if (typeof batch !== "object" || batch === null) return [];
    const cwd = (batch as { cwd?: unknown }).cwd;
    const changes = (batch as { changes?: unknown }).changes;
    return [{
      cwd: typeof cwd === "string" && cwd.trim().length > 0 ? cwd : null,
      changes: Array.isArray(changes) ? changes : [],
    }];
  });
}

function normalizeApplyCwd(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalizedPath = normalizePathSegments(value);
  return normalizedPath.length > 0 ? normalizedPath : null;
}

function ensureFileStat(stats: Map<string, TurnDiffFileStat>, path: string): TurnDiffFileStat {
  const existing = stats.get(path);
  if (existing) return existing;

  const stat: TurnDiffFileStat = {
    path,
    additions: 0,
    deletions: 0,
    renderedLineEstimate: 0,
  };
  stats.set(path, stat);
  return stat;
}

function parseDiffGitHeaderPath(line: string): string | null {
  if (!line.startsWith("diff --git ")) return null;
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith("\"")) {
    const paths = parseQuotedDiffGitPaths(rest);
    const targetPath = paths.findLast((path) => path.startsWith("b/")) ?? paths[paths.length - 1];
    return targetPath ? stripPatchPrefix(targetPath) : null;
  }

  const markerIndex = rest.lastIndexOf(" b/");
  if (markerIndex === -1) return null;
  return rest.slice(markerIndex + " b/".length);
}

function parseQuotedDiffGitPaths(value: string): string[] {
  const paths: string[] = [];
  let index = 0;

  while (index < value.length) {
    while (value[index] === " ") index += 1;
    if (value[index] !== "\"") break;
    index += 1;

    let path = "";
    while (index < value.length) {
      const char = value[index];
      if (char === "\"") {
        index += 1;
        break;
      }
      if (char === "\\" && index + 1 < value.length) {
        path += value[index + 1];
        index += 2;
        continue;
      }
      path += char;
      index += 1;
    }
    paths.push(path);
  }

  return paths;
}

function fallbackPatchStats(diffText: string): TurnDiffFileStat[] {
  try {
    return parsePatchFiles(diffText).flatMap((patch) => patch.files).map((fileDiff) => {
      const path = stripPatchPrefix(fileDiff.name ?? fileDiff.prevName ?? "changed-file");
      const summary = summarizeFileDiffMetadata(fileDiff);
      return {
        path,
        additions: summary.additions,
        deletions: summary.deletions,
        renderedLineEstimate: Math.max(fileDiff.unifiedLineCount, fileDiff.splitLineCount),
      };
    });
  } catch {
    const summary = summarizeDiff(diffText);
    if (summary.additions === 0 && summary.deletions === 0) return [];
    return [{
      path: "changed-file",
      additions: summary.additions,
      deletions: summary.deletions,
      renderedLineEstimate: summary.additions + summary.deletions,
    }];
  }
}

function resolveOpenLine(fileDiff: FileDiffMetadata | null): number | undefined {
  const firstHunk = fileDiff?.hunks[0];
  if (!firstHunk) return undefined;

  const line = firstHunk.additionStart > 0 ? firstHunk.additionStart : firstHunk.deletionStart;
  return line > 0 ? line : 1;
}

function isAbsoluteDisplayPath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:\//.test(path);
}

function relativeDisplayPath(path: string, basePath: string): string {
  const pathSegments = splitDisplayPathSegments(path);
  const baseSegments = splitDisplayPathSegments(basePath);
  const compareCaseInsensitive = usesWindowsDrive(path) || usesWindowsDrive(basePath);
  let sharedSegmentCount = 0;

  while (
    sharedSegmentCount < pathSegments.length
    && sharedSegmentCount < baseSegments.length
    && sameDisplayPathSegment(
      pathSegments[sharedSegmentCount] ?? "",
      baseSegments[sharedSegmentCount] ?? "",
      compareCaseInsensitive,
    )
  ) {
    sharedSegmentCount += 1;
  }

  const parentSegments = Array.from({ length: baseSegments.length - sharedSegmentCount }, () => "..");
  const childSegments = pathSegments.slice(sharedSegmentCount);
  return [...parentSegments, ...childSegments].join("/");
}

function splitDisplayPathSegments(path: string): string[] {
  return normalizePathSegments(path).split("/").filter((segment) => segment.length > 0);
}

function sameDisplayPathSegment(left: string, right: string, compareCaseInsensitive: boolean): boolean {
  if (!compareCaseInsensitive) return left === right;
  return left.toLowerCase() === right.toLowerCase();
}

function usesWindowsDrive(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path);
}
