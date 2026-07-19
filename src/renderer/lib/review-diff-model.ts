export interface ReviewDiffModelFile {
  key: string;
  displayPath: string;
  patchText: string;
  additions: number | null;
  deletions: number | null;
  changedBytes: number;
}

export interface ReviewLargeDiffStats {
  fileCount: number;
  totalChangedBytes: number;
  totalChangedLines: number;
  largestFileChangedLines?: number;
}

const REVIEW_LARGE_DIFF_FILE_THRESHOLD = 128;
const REVIEW_LARGE_DIFF_LINE_THRESHOLD = 9_000;
const REVIEW_LARGE_DIFF_BYTE_THRESHOLD = 12 * 1024 * 1024;
const REVIEW_LARGE_DIFF_SINGLE_FILE_CHANGED_LINE_THRESHOLD = 15_000;
const REVIEW_WORD_DIFF_CHANGED_LINE_THRESHOLD = 2_000;
export const REVIEW_CAPPED_MATCH_PAGE_SIZE = 20;

export function getReviewTotalChangedLines<TFile extends ReviewDiffModelFile>(files: TFile[]): number {
  return files.reduce((sum, file) => sum + (file.additions ?? 0) + (file.deletions ?? 0), 0);
}

export function getReviewTotalChangedBytes<TFile extends ReviewDiffModelFile>(files: TFile[]): number {
  return files.reduce((sum, file) => sum + file.changedBytes, 0);
}

export function isReviewLargeDiff(stats: ReviewLargeDiffStats): boolean {
  return stats.fileCount > REVIEW_LARGE_DIFF_FILE_THRESHOLD
    || stats.totalChangedLines > REVIEW_LARGE_DIFF_LINE_THRESHOLD
    || stats.totalChangedBytes > REVIEW_LARGE_DIFF_BYTE_THRESHOLD
    || (stats.largestFileChangedLines ?? 0) > REVIEW_LARGE_DIFF_SINGLE_FILE_CHANGED_LINE_THRESHOLD;
}

export function isReviewWordDiffEnabled(
  changedLines: number,
  requested: boolean,
): boolean {
  return requested && changedLines <= REVIEW_WORD_DIFF_CHANGED_LINE_THRESHOLD;
}

export function filterReviewFiles<TFile extends ReviewDiffModelFile>(
  files: TFile[],
  fileFilterQuery: string,
): TFile[] {
  const normalizedFilter = fileFilterQuery.trim().toLowerCase();
  if (normalizedFilter.length === 0) return files;

  return files.filter((file) => file.displayPath.toLowerCase().includes(normalizedFilter));
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
