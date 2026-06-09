export interface ReviewDiffModelFile {
  key: string;
  displayPath: string;
  patchText: string;
  additions: number;
  deletions: number;
}

export interface ReviewSearchableContent {
  oldText?: string | null;
  newText?: string | null;
}

export interface ReviewSearchMatch {
  path: string;
  key: string;
}

export interface ReviewLargeDiffStats {
  fileCount: number;
  totalChangedBytes: number;
  totalChangedLines: number;
  largestFileChangedLines?: number;
}

export interface ReviewRenderPlan<TFile> {
  visibleFiles: TFile[];
  fallbackFiles: TFile[];
  shouldDefer: boolean;
}

const REVIEW_LARGE_DIFF_FILE_THRESHOLD = 128;
const REVIEW_LARGE_DIFF_LINE_THRESHOLD = 9_000;
const REVIEW_LARGE_DIFF_BYTE_THRESHOLD = 12 * 1024 * 1024;
const REVIEW_LARGE_DIFF_SINGLE_FILE_CHANGED_LINE_THRESHOLD = 15_000;
export const REVIEW_CAPPED_MATCH_PAGE_SIZE = 20;
export const REVIEW_DEFERRED_RENDER_FALLBACK_COUNT = 2;
const REVIEW_CONTAIN_INTRINSIC_BASE_HEIGHT = 56;
const REVIEW_CONTAIN_INTRINSIC_LINE_HEIGHT = 20;
const REVIEW_CONTAIN_INTRINSIC_MAX_CHANGED_LINES = 480;

export function getReviewTotalChangedLines<TFile extends ReviewDiffModelFile>(files: TFile[]): number {
  return files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
}

export function getReviewTotalChangedBytes(patch: string): number {
  return new TextEncoder().encode(patch).length;
}

export function isReviewLargeDiff(stats: ReviewLargeDiffStats): boolean {
  return stats.fileCount > REVIEW_LARGE_DIFF_FILE_THRESHOLD
    || stats.totalChangedLines > REVIEW_LARGE_DIFF_LINE_THRESHOLD
    || stats.totalChangedBytes > REVIEW_LARGE_DIFF_BYTE_THRESHOLD
    || (stats.largestFileChangedLines ?? 0) > REVIEW_LARGE_DIFF_SINGLE_FILE_CHANGED_LINE_THRESHOLD;
}

export function filterReviewFiles<TFile extends ReviewDiffModelFile>(
  files: TFile[],
  fileFilterQuery: string,
): TFile[] {
  const normalizedFilter = fileFilterQuery.trim().toLowerCase();
  if (normalizedFilter.length === 0) return files;

  return files.filter((file) => file.displayPath.toLowerCase().includes(normalizedFilter));
}

export function buildReviewSearchMatches<TFile extends ReviewDiffModelFile>(
  files: TFile[],
  searchQuery: string,
  fullContentsByPath: Record<string, ReviewSearchableContent>,
): ReviewSearchMatch[] {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  if (normalizedSearch.length === 0) return [];

  return files.flatMap((file) => {
    const fullContents = fullContentsByPath[file.displayPath];
    const haystacks = [
      file.displayPath,
      file.patchText,
      fullContents?.oldText ?? "",
      fullContents?.newText ?? "",
    ];
    return haystacks.some((value) => value.toLowerCase().includes(normalizedSearch))
      ? [{ path: file.displayPath, key: file.key }]
      : [];
  });
}

export function resolveReviewSelectedPath<TFile extends ReviewDiffModelFile>(
  files: TFile[],
  currentSelectedPath: string | null,
  isCappedMode: boolean,
): string | null {
  if (!isCappedMode) {
    return currentSelectedPath;
  }

  if (files.length === 0) {
    return null;
  }

  if (currentSelectedPath && files.some((file) => file.displayPath === currentSelectedPath)) {
    return currentSelectedPath;
  }

  return files[0]?.displayPath ?? null;
}

export function buildReviewVisibleFiles<TFile extends ReviewDiffModelFile>(
  files: TFile[],
  selectedPath: string | null,
  isCappedMode: boolean,
  isSearchActive: boolean,
  visibleMatchCount: number,
): TFile[] {
  if (!isCappedMode) {
    return files;
  }

  if (!isSearchActive) {
    if (!selectedPath) {
      return files.slice(0, 1);
    }

    const selectedFile = files.find((file) => file.displayPath === selectedPath);
    return selectedFile ? [selectedFile] : files.slice(0, 1);
  }

  let nextVisibleCount = visibleMatchCount;
  if (selectedPath) {
    const selectedIndex = files.findIndex((file) => file.displayPath === selectedPath);
    if (selectedIndex >= nextVisibleCount) {
      nextVisibleCount = Math.ceil((selectedIndex + 1) / REVIEW_CAPPED_MATCH_PAGE_SIZE) * REVIEW_CAPPED_MATCH_PAGE_SIZE;
    }
  }

  return files.slice(0, nextVisibleCount);
}

export function buildReviewRenderPlan<TFile extends ReviewDiffModelFile>(
  files: TFile[],
  isCappedMode: boolean,
): ReviewRenderPlan<TFile> {
  if (isCappedMode) {
    return {
      visibleFiles: files,
      fallbackFiles: files,
      shouldDefer: false,
    };
  }

  if (files.length <= REVIEW_DEFERRED_RENDER_FALLBACK_COUNT) {
    return {
      visibleFiles: files,
      fallbackFiles: files,
      shouldDefer: false,
    };
  }

  return {
    visibleFiles: files,
    fallbackFiles: files.slice(0, REVIEW_DEFERRED_RENDER_FALLBACK_COUNT),
    shouldDefer: true,
  };
}

export function getReviewContainIntrinsicSize(
  additions: number,
  deletions: number,
  diffMode: "unified" | "split",
): string {
  const changedLineCount = Math.min(additions + deletions, REVIEW_CONTAIN_INTRINSIC_MAX_CHANGED_LINES);
  const multiplier = diffMode === "split" ? 2 : 1;
  const estimatedHeight = REVIEW_CONTAIN_INTRINSIC_BASE_HEIGHT
    + changedLineCount * REVIEW_CONTAIN_INTRINSIC_LINE_HEIGHT * multiplier;
  return `auto ${estimatedHeight}px`;
}
