import { scoreSettingsQueryMatch } from "@/lib/settings-search-score";

const MIDDLE_ELLIPSIS = "…";

export interface ReviewJumpToFileEntry {
  displayPath: string;
}

export interface ReviewJumpToFilePathParts {
  fileName: string;
  parentPath: string;
}

export function splitReviewJumpToFilePath(displayPath: string): ReviewJumpToFilePathParts {
  const separatorIndex = displayPath.lastIndexOf("/");
  if (separatorIndex === -1) {
    return {
      fileName: displayPath,
      parentPath: "",
    };
  }

  return {
    fileName: displayPath.slice(separatorIndex + 1),
    parentPath: displayPath.slice(0, separatorIndex),
  };
}

export function compareReviewJumpToFileEntries(
  left: ReviewJumpToFileEntry,
  right: ReviewJumpToFileEntry,
): number {
  const leftParts = splitReviewJumpToFilePath(left.displayPath);
  const rightParts = splitReviewJumpToFilePath(right.displayPath);
  return (
    leftParts.fileName.localeCompare(rightParts.fileName)
    || leftParts.parentPath.localeCompare(rightParts.parentPath)
  );
}

export function selectReviewJumpToFileMatches<T extends ReviewJumpToFileEntry>(
  entries: readonly T[],
  query: string,
): T[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return [...entries].sort(compareReviewJumpToFileEntries);
  }

  return entries
    .map((entry) => {
      const { fileName } = splitReviewJumpToFilePath(entry.displayPath);
      const fileNameScore = scoreSettingsQueryMatch(fileName, trimmedQuery);
      return {
        entry,
        score: fileNameScore > 0 ? fileNameScore : scoreSettingsQueryMatch(entry.displayPath, trimmedQuery),
      };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => (
      right.score - left.score
      || compareReviewJumpToFileEntries(left.entry, right.entry)
    ))
    .map(({ entry }) => entry);
}

export function middleTruncateReviewJumpText(
  text: string,
  maxWidthPx: number,
  measureTextWidth: (value: string) => number | null,
): string {
  if (text.length === 0 || maxWidthPx <= 0) return text;

  const fullWidth = measureTextWidth(text);
  if (fullWidth !== null && fullWidth <= maxWidthPx) return text;

  const characters = Array.from(text);
  let low = 0;
  let high = characters.length - 1;
  let best = MIDDLE_ELLIPSIS;

  while (low <= high) {
    const keptCount = Math.floor((low + high) / 2);
    const headCount = Math.ceil(keptCount / 2);
    const tailCount = Math.floor(keptCount / 2);
    const candidate = `${characters.slice(0, headCount).join("")}${MIDDLE_ELLIPSIS}${characters.slice(characters.length - tailCount).join("")}`;
    const candidateWidth = measureTextWidth(candidate);

    if (candidateWidth !== null && candidateWidth <= maxWidthPx) {
      best = candidate;
      low = keptCount + 1;
      continue;
    }

    high = keptCount - 1;
  }

  return best;
}
