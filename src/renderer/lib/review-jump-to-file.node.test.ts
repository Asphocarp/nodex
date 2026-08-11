import { describe, expect, test } from "vitest";
import {
  middleTruncateReviewJumpText,
  selectReviewJumpToFileMatches,
  splitReviewJumpToFilePath,
} from "./review-jump-to-file";

describe("review jump-to-file model", () => {
  test("splits display paths into file name and parent label", () => {
    const nested = splitReviewJumpToFilePath("src/renderer/editor/file.tsx");
    expect(nested.fileName).toBe("file.tsx");
    expect(nested.parentPath).toBe("src/renderer/editor");

    const root = splitReviewJumpToFilePath("README.md");
    expect(root.fileName).toBe("README.md");
    expect(root.parentPath).toBe("");
  });

  test("sorts empty jump results by file name before parent path", () => {
    const matches = selectReviewJumpToFileMatches([
      { displayPath: "src/workbench/zeta.ts" },
      { displayPath: "docs/foo.ts" },
      { displayPath: "src/renderer/foo.ts" },
    ], "");

    expect(matches.map((entry) => entry.displayPath).join("|")).toBe("docs/foo.ts|src/renderer/foo.ts|src/workbench/zeta.ts");
  });

  test("scores file name matches before falling back to full path matches", () => {
    const matches = selectReviewJumpToFileMatches([
      { displayPath: "src/renderer/components/board/editor/nfm-editor-popover-content.tsx" },
      { displayPath: "docs/editor.md" },
      { displayPath: "src/renderer/components/board/card.tsx" },
    ], "editor");

    expect(matches.map((entry) => entry.displayPath).join("|")).toBe("docs/editor.md|src/renderer/components/board/editor/nfm-editor-popover-content.tsx");
  });

  test("middle truncates parent labels when they do not fit", () => {
    const measureByCharacters = (value: string) => value.length;

    expect(middleTruncateReviewJumpText("src/editor", 20, measureByCharacters)).toBe("src/editor");

    const truncated = middleTruncateReviewJumpText("src/renderer/components/board/editor", 12, measureByCharacters);
    expect(truncated.includes("…")).toBe(true);
    expect(truncated.startsWith("src/")).toBe(true);
    expect(truncated.endsWith("itor")).toBe(true);
    expect(truncated.length <= 12).toBe(true);
  });
});
