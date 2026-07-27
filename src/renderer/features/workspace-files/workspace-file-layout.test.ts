import { describe, expect, test } from "vitest";
import {
  clampWorkspaceTreeWidth,
  WORKSPACE_TREE_DEFAULT_WIDTH,
  WORKSPACE_TREE_MIN_WIDTH,
} from "./workspace-file-layout";

describe("workspace file tree layout", () => {
  test("clamps restored and resized widths to the usable panel boundary", () => {
    expect(clampWorkspaceTreeWidth(Number.NaN, 1_000)).toBe(
      WORKSPACE_TREE_DEFAULT_WIDTH,
    );
    expect(clampWorkspaceTreeWidth(100, 1_000)).toBe(WORKSPACE_TREE_MIN_WIDTH);
    expect(clampWorkspaceTreeWidth(900, 1_000)).toBe(600);
    expect(clampWorkspaceTreeWidth(300, 300)).toBe(WORKSPACE_TREE_MIN_WIDTH);
  });
});
