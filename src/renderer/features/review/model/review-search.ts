import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { GitReviewSearchMatch, GitReviewSearchSnippet } from "../../../../shared/types";

export const REVIEW_SEARCH_MATCH_LIMIT = 250;
const REVIEW_SEARCH_SNIPPET_RADIUS = 24;

type ReviewSearchSide = "additions" | "deletions";

interface ReviewSearchLineSpan {
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
  side: ReviewSearchSide;
}

interface ReviewSearchHunk {
  hunkId: "path" | `${number}`;
  lineStart: number;
  lineEnd: number;
  text: string;
  lineSpans?: readonly ReviewSearchLineSpan[];
}

export interface ReviewSearchFile {
  path: string;
  gitPath: string;
  hunks: readonly ReviewSearchHunk[];
}

export interface ReviewSearchLocation extends GitReviewSearchMatch {
  side?: ReviewSearchSide;
}

export interface ReviewSearchResult {
  matches: ReviewSearchLocation[];
  totalMatches: number;
  isCapped: boolean;
}

interface ReviewSearchFileInput {
  path: string;
  gitPath: string;
  previousGitPath?: string | null;
  diff: FileDiffMetadata | null;
}

function stripLineEnding(value: string): string {
  return value.replace(/\r?\n$/, "");
}

function buildPathText(diff: FileDiffMetadata): string {
  const oldPath = diff.prevName ?? diff.name;
  return oldPath === diff.name ? diff.name : `${oldPath} -> ${diff.name}`;
}

function appendLines(input: {
  lines: readonly string[];
  startIndex: number;
  count: number;
  lineNumber: number;
  side: ReviewSearchSide;
  output: Array<{ lineNumber: number; side: ReviewSearchSide; text: string }>;
}): void {
  for (let offset = 0; offset < input.count; offset += 1) {
    const text = input.lines[input.startIndex + offset];
    if (text === undefined) continue;
    input.output.push({
      lineNumber: input.lineNumber + offset,
      side: input.side,
      text: stripLineEnding(text),
    });
  }
}

function buildHunkText(
  diff: FileDiffMetadata,
  hunk: FileDiffMetadata["hunks"][number],
): { text: string; lineSpans: ReviewSearchLineSpan[] } {
  const lines: Array<{
    lineNumber: number;
    side: ReviewSearchSide;
    text: string;
  }> = [];
  let additionLine = hunk.additionStart;
  let deletionLine = hunk.deletionStart;

  for (const content of hunk.hunkContent) {
    if (content.type === "context") {
      appendLines({
        lines: diff.additionLines,
        startIndex: content.additionLineIndex,
        count: content.lines,
        lineNumber: additionLine,
        side: "additions",
        output: lines,
      });
      additionLine += content.lines;
      deletionLine += content.lines;
      continue;
    }

    appendLines({
      lines: diff.deletionLines,
      startIndex: content.deletionLineIndex,
      count: content.deletions,
      lineNumber: deletionLine,
      side: "deletions",
      output: lines,
    });
    deletionLine += content.deletions;
    appendLines({
      lines: diff.additionLines,
      startIndex: content.additionLineIndex,
      count: content.additions,
      lineNumber: additionLine,
      side: "additions",
      output: lines,
    });
    additionLine += content.additions;
  }

  const textParts: string[] = [];
  const lineSpans: ReviewSearchLineSpan[] = [];
  let offset = 0;
  lines.forEach((line, index) => {
    const end = offset + line.text.length;
    textParts.push(line.text);
    lineSpans.push({
      start: offset,
      end,
      lineStart: line.lineNumber,
      lineEnd: line.lineNumber,
      side: line.side,
    });
    offset = end + (index === lines.length - 1 ? 0 : 1);
  });

  return { text: textParts.join("\n"), lineSpans };
}

export function buildReviewSearchFiles(
  entries: readonly ReviewSearchFileInput[],
  generatedPaths: ReadonlySet<string>,
): ReviewSearchFile[] {
  return entries.flatMap((entry) => {
    if (generatedPaths.has(entry.gitPath)) return [];
    const diff = entry.diff;
    const pathHunk: ReviewSearchHunk = {
      hunkId: "path",
      lineStart: 1,
      lineEnd: 1,
      text:
        diff === null
          ? entry.previousGitPath && entry.previousGitPath !== entry.gitPath
            ? `${entry.previousGitPath} -> ${entry.gitPath}`
            : entry.gitPath
          : buildPathText(diff),
    };
    if (diff === null) {
      return [
        {
          path: entry.path,
          gitPath: entry.gitPath,
          hunks: [pathHunk],
        },
      ];
    }
    return [
      {
        path: entry.path,
        gitPath: entry.gitPath,
        hunks: [
          pathHunk,
          ...diff.hunks.map((hunk, index) => {
            const additionEnd = hunk.additionStart + Math.max(hunk.additionCount, 0) - 1;
            const deletionEnd = hunk.deletionStart + Math.max(hunk.deletionCount, 0) - 1;
            const text = buildHunkText(diff, hunk);
            return {
              hunkId: `${index}` as `${number}`,
              lineStart: Math.min(hunk.additionStart, hunk.deletionStart),
              lineEnd: Math.max(
                Math.min(hunk.additionStart, hunk.deletionStart),
                additionEnd,
                deletionEnd,
              ),
              text: text.text,
              lineSpans: text.lineSpans,
            };
          }),
        ],
      },
    ];
  });
}

function buildSnippet(text: string, start: number, end: number): GitReviewSearchSnippet {
  return {
    before: text.slice(Math.max(0, start - REVIEW_SEARCH_SNIPPET_RADIUS), start),
    match: text.slice(start, end),
    after: text.slice(end, Math.min(text.length, end + REVIEW_SEARCH_SNIPPET_RADIUS)),
  };
}

function resolveMatchLine(
  hunk: ReviewSearchHunk,
  start: number,
  end: number,
): Pick<ReviewSearchLocation, "lineStart" | "lineEnd" | "side"> {
  const startSpan = hunk.lineSpans?.find((span) => start >= span.start && start < span.end);
  if (!startSpan) {
    return { lineStart: hunk.lineStart, lineEnd: hunk.lineEnd };
  }
  const endOffset = Math.max(start, end - 1);
  const endSpan =
    hunk.lineSpans?.find((span) => endOffset >= span.start && endOffset < span.end) ?? startSpan;
  return {
    lineStart: startSpan.lineStart,
    lineEnd: endSpan.lineEnd,
    ...(startSpan.side === endSpan.side ? { side: startSpan.side } : {}),
  };
}

export function searchReviewFiles(
  files: readonly ReviewSearchFile[],
  query: string,
  limit = REVIEW_SEARCH_MATCH_LIMIT,
): ReviewSearchResult {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || limit <= 0) {
    return { matches: [], totalMatches: 0, isCapped: false };
  }

  const needle = normalizedQuery.toLowerCase();
  const storedLimit = Math.min(limit, REVIEW_SEARCH_MATCH_LIMIT);
  const matches: ReviewSearchLocation[] = [];
  let totalMatches = 0;

  for (const file of files) {
    for (const hunk of file.hunks) {
      const haystack = hunk.text.toLowerCase();
      let cursor = 0;
      while (cursor < haystack.length) {
        const start = haystack.indexOf(needle, cursor);
        if (start < 0) break;
        const end = start + normalizedQuery.length;
        totalMatches += 1;
        if (matches.length < storedLimit) {
          matches.push({
            path: file.path,
            hunkId: hunk.hunkId,
            ...resolveMatchLine(hunk, start, end),
            start,
            end,
            snippet: buildSnippet(hunk.text, start, end),
          });
        }
        cursor = end;
      }
    }
  }

  return {
    matches,
    totalMatches,
    isCapped: totalMatches > matches.length,
  };
}
