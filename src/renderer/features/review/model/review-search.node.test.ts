import { parsePatchFiles } from "@pierre/diffs";
import { describe, expect, test } from "vite-plus/test";
import {
  REVIEW_SEARCH_MATCH_LIMIT,
  buildReviewSearchFiles,
  searchReviewFiles,
} from "./review-search";

function parseFile(diff: string) {
  const file = parsePatchFiles(diff).flatMap((patch) => patch.files)[0];
  if (!file) throw new Error("Expected parsed file");
  return file;
}

describe("review search model", () => {
  test("searches the path pseudo-hunk and maps hunk matches to exact lines and sides", () => {
    const diff = parseFile(
      [
        "diff --git a/src/old-name.ts b/src/new-name.ts",
        "similarity index 80%",
        "rename from src/old-name.ts",
        "rename to src/new-name.ts",
        "--- a/src/old-name.ts",
        "+++ b/src/new-name.ts",
        "@@ -10,2 +10,2 @@",
        " context needle",
        "-old needle",
        "+new needle",
      ].join("\n"),
    );
    const files = buildReviewSearchFiles(
      [{ path: "display/new-name.ts", gitPath: "src/new-name.ts", diff }],
      new Set(),
    );

    const result = searchReviewFiles(files, "needle");

    expect(result.totalMatches).toBe(3);
    expect(
      result.matches.map((match) => ({
        path: match.path,
        hunkId: match.hunkId,
        lineStart: match.lineStart,
        lineEnd: match.lineEnd,
        side: match.side,
        snippet: match.snippet.match,
      })),
    ).toEqual([
      {
        path: "display/new-name.ts",
        hunkId: "0",
        lineStart: 10,
        lineEnd: 10,
        side: "additions",
        snippet: "needle",
      },
      {
        path: "display/new-name.ts",
        hunkId: "0",
        lineStart: 11,
        lineEnd: 11,
        side: "deletions",
        snippet: "needle",
      },
      {
        path: "display/new-name.ts",
        hunkId: "0",
        lineStart: 11,
        lineEnd: 11,
        side: "additions",
        snippet: "needle",
      },
    ]);

    const pathResult = searchReviewFiles(files, "old-name");
    expect(pathResult.matches[0]).toMatchObject({
      path: "display/new-name.ts",
      hunkId: "path",
      lineStart: 1,
      lineEnd: 1,
      start: 4,
    });
  });

  test("excludes generated files including path matches", () => {
    const diff = parseFile(
      [
        "diff --git a/generated.ts b/generated.ts",
        "--- a/generated.ts",
        "+++ b/generated.ts",
        "@@ -1 +1 @@",
        "-old needle",
        "+new needle",
      ].join("\n"),
    );
    const files = buildReviewSearchFiles(
      [{ path: "generated.ts", gitPath: "generated.ts", diff }],
      new Set(["generated.ts"]),
    );

    expect(searchReviewFiles(files, "generated").matches).toEqual([]);
    expect(searchReviewFiles(files, "needle").matches).toEqual([]);
  });

  test("keeps a path-only pseudo-hunk for non-renderable transcript files", () => {
    const files = buildReviewSearchFiles(
      [
        {
          path: "assets/screenshot.png",
          gitPath: "assets/screenshot.png",
          diff: null,
        },
      ],
      new Set(),
    );

    expect(files).toEqual([
      {
        path: "assets/screenshot.png",
        gitPath: "assets/screenshot.png",
        hunks: [
          {
            hunkId: "path",
            lineStart: 1,
            lineEnd: 1,
            text: "assets/screenshot.png",
          },
        ],
      },
    ]);
    expect(searchReviewFiles(files, "screenshot").matches[0]).toMatchObject({
      path: "assets/screenshot.png",
      hunkId: "path",
      lineStart: 1,
      lineEnd: 1,
      snippet: { match: "screenshot" },
    });
    expect(searchReviewFiles(files, "binary body").matches).toEqual([]);
  });

  test("keeps both rename paths searchable when the diff body is unavailable", () => {
    const files = buildReviewSearchFiles(
      [
        {
          path: "src/new-name.ts",
          gitPath: "src/new-name.ts",
          previousGitPath: "src/old-name.ts",
          diff: null,
        },
      ],
      new Set(),
    );

    expect(files[0]?.hunks[0]?.text).toBe("src/old-name.ts -> src/new-name.ts");
    expect(searchReviewFiles(files, "old-name").matches[0]).toMatchObject({
      path: "src/new-name.ts",
      hunkId: "path",
    });
  });

  test("stores 250 matches while preserving the exact total", () => {
    const text = Array.from({ length: 251 }, () => "needle").join(" ");
    const files = [
      {
        path: "many.ts",
        gitPath: "many.ts",
        hunks: [
          {
            hunkId: "0" as const,
            lineStart: 1,
            lineEnd: 1,
            text,
          },
        ],
      },
    ];

    const result = searchReviewFiles(files, "needle");

    expect(result.matches).toHaveLength(REVIEW_SEARCH_MATCH_LIMIT);
    expect(result.totalMatches).toBe(251);
    expect(result.isCapped).toBe(true);
    expect(result.matches.at(-1)?.start).toBe(249 * "needle ".length);
  });

  test("uses non-overlapping case-insensitive UTF-16 offsets", () => {
    const files = [
      {
        path: "unicode.ts",
        gitPath: "unicode.ts",
        hunks: [
          {
            hunkId: "0" as const,
            lineStart: 1,
            lineEnd: 1,
            text: "😀Needle needleNeedle",
          },
        ],
      },
    ];

    const result = searchReviewFiles(files, "needle");

    expect(result.matches.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 2, end: 8 },
      { start: 9, end: 15 },
      { start: 15, end: 21 },
    ]);
  });
});
