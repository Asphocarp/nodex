import { describe, expect, test } from "vitest";
import type { ReviewFileTreeEntry } from "./review-file-tree-model";
import {
  buildReviewFileTreeDefaultExpandedPaths,
  buildReviewFileTreeExpandedPathsForSelection,
  buildReviewFileTreeModel,
  buildReviewFileTreeVisibleState,
  resolveReviewFileTreeItemIdForPath,
  resolveReviewFileTreeSelectedVisibleIndex,
} from "./review-file-tree-model";

function buildEntry(path: string, key = path): ReviewFileTreeEntry {
  return { key, displayPath: path };
}

describe("review file tree model", () => {
  test("builds folder and file rows instead of a flat file list", () => {
    const state = buildReviewFileTreeVisibleState(
      [
        buildEntry("src/example.ts"),
        buildEntry("src/nested/feature.ts"),
      ],
      {
        fileFilterQuery: "",
        expandedPaths: new Set(["src", "src/nested"]),
      },
    );

    expect(state.rows[0]?.type).toBe("folder");
    expect(state.rows[0]?.path).toBe("src");
    expect(state.rows[1]?.type).toBe("file");
    expect(state.rows[1]?.path).toBe("src/example.ts");
    expect(state.rows[2]?.type).toBe("folder");
    expect(state.rows[2]?.path).toBe("src/nested");
    expect(state.rows[3]?.type).toBe("file");
    expect(state.rows[3]?.path).toBe("src/nested/feature.ts");
  });

  test("flattens empty directory chains into one folder row", () => {
    const state = buildReviewFileTreeVisibleState(
      [buildEntry("src/features/review/panel.tsx")],
      {
        fileFilterQuery: "",
        expandedPaths: new Set(["src/features/review"]),
      },
    );

    expect(state.rows.length).toBe(2);
    expect(state.rows[0]?.type).toBe("folder");
    expect(state.rows[0]?.isFlattenedDirectory).toBe(true);
    expect(state.rows[0]?.flattenedParts.length).toBe(3);
    expect(state.rows[0]?.path).toBe("src/features/review");
    expect(state.rows[1]?.path).toBe("src/features/review/panel.tsx");
  });

  test("search preserves ancestor folders while hiding non-matching branches", () => {
    const state = buildReviewFileTreeVisibleState(
      [
        buildEntry("src/domain-01/feature-01/file-001.ts"),
        buildEntry("src/domain-02/feature-02/file-002.ts"),
      ],
      {
        fileFilterQuery: "file-001.ts",
        expandedPaths: new Set(),
      },
    );

    expect(state.filteredEntries.length).toBe(1);
    const visiblePaths = state.rows.map((row) => row.path).join("|");
    expect(visiblePaths.includes("src")).toBe(true);
    expect(visiblePaths.includes("src/domain-01")).toBe(true);
    expect(visiblePaths.includes("src/domain-01/feature-01")).toBe(true);
    expect(visiblePaths.includes("src/domain-01/feature-01/file-001.ts")).toBe(true);
    expect(visiblePaths.includes("domain-02")).toBe(false);
  });

  test("returns default expanded paths for all non-empty folders", () => {
    const expanded = buildReviewFileTreeDefaultExpandedPaths([
      buildEntry("src/example.ts"),
      buildEntry("src/nested/feature.ts"),
    ]);

    expect(expanded.includes("src")).toBe(true);
    expect(expanded.includes("src/nested")).toBe(true);
  });

  test("derives folder ancestors that must expand for the selected file", () => {
    const model = buildReviewFileTreeModel([
      buildEntry("src/nested/feature.ts"),
    ]);
    const ancestorPaths = buildReviewFileTreeExpandedPathsForSelection(model, "src/nested/feature.ts");

    expect(ancestorPaths.length).toBe(2);
    expect(ancestorPaths[0]).toBe("src");
    expect(ancestorPaths[1]).toBe("src/nested");
  });

  test("maps the selected file path to the visible tree row index", () => {
    const state = buildReviewFileTreeVisibleState(
      [
        buildEntry("src/example.ts"),
        buildEntry("src/feature.ts"),
      ],
      {
        fileFilterQuery: "",
        expandedPaths: new Set(["src"]),
      },
    );

    const selectedIndex = resolveReviewFileTreeSelectedVisibleIndex(state.rows, state.model.pathToId.get("src/feature.ts") ?? null);
    expect(selectedIndex).toBe(2);
  });

  test("marks selected and focused rows using tree item ids", () => {
    const model = buildReviewFileTreeModel([
      buildEntry("src/example.ts"),
      buildEntry("src/feature.ts"),
    ]);
    const selectedTreeItemId = resolveReviewFileTreeItemIdForPath(model, "src/feature.ts");
    const state = buildReviewFileTreeVisibleState(
      [
        buildEntry("src/example.ts"),
        buildEntry("src/feature.ts"),
      ],
      {
        fileFilterQuery: "",
        expandedPaths: new Set(["src"]),
        selectedTreeItemId,
        focusedTreeItemId: selectedTreeItemId,
      },
    );

    expect(state.rows[2]?.isSelected).toBe(true);
    expect(state.rows[2]?.isFocused).toBe(true);
  });

  test("derives folder git change indicators and file git status slots", () => {
    const state = buildReviewFileTreeVisibleState(
      [
        buildEntry("src/example.ts"),
        buildEntry("src/feature.ts"),
      ],
      {
        fileFilterQuery: "",
        expandedPaths: new Set(["src"]),
        gitStatusByPath: new Map([
          ["src/feature.ts", "modified"],
        ]),
      },
    );

    expect(state.rows[0]?.containsGitChange).toBe(true);
    expect(state.rows[0]?.gitStatus ?? null).toBe(null);
    expect(state.rows[2]?.gitStatus).toBe("modified");
  });

  test("marks locked rows from locked path state", () => {
    const state = buildReviewFileTreeVisibleState(
      [buildEntry("src/example.ts")],
      {
        fileFilterQuery: "",
        expandedPaths: new Set(["src"]),
        lockedPaths: new Set(["src/example.ts"]),
      },
    );

    expect(state.rows[1]?.isLocked).toBe(true);
  });
});
