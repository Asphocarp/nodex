import { describe, expect, test } from "vite-plus/test";
import {
  buildWorkspaceFileEditorSelection,
  buildWorkspaceFileLineSelection,
  buildWorkspaceFileScrollTarget,
  resolveWorkspaceFileRevealRange,
} from "./workspace-file-reveal";

describe("workspace file reveal", () => {
  test("builds a line target when a reference has only a start line", () => {
    expect(buildWorkspaceFileScrollTarget("file.ts", { line: 12, column: 3 })).toEqual({
      type: "line",
      id: "file.ts",
      lineNumber: 12,
      align: "center",
      behavior: "instant",
    });
    expect(buildWorkspaceFileLineSelection("file.ts", { line: 12 })).toBeNull();
  });

  test("keeps a column-only reference as a collapsed editor caret", () => {
    expect(buildWorkspaceFileEditorSelection({ line: 12, column: 3 })).toEqual({
      start: { line: 11, character: 2 },
      end: { line: 11, character: 2 },
      direction: "forward",
    });
  });

  test("builds a selected line range and editable character range", () => {
    const location = {
      line: 12,
      column: 3,
      endLine: 14,
      endColumn: 8,
    };

    expect(resolveWorkspaceFileRevealRange(location)).toEqual({ start: 12, end: 14 });
    expect(buildWorkspaceFileScrollTarget("file.ts", location)).toEqual({
      type: "range",
      id: "file.ts",
      range: { start: 12, end: 14 },
      align: "center",
      behavior: "instant",
    });
    expect(buildWorkspaceFileLineSelection("file.ts", location)).toEqual({
      id: "file.ts",
      range: { start: 12, end: 14 },
    });
    expect(buildWorkspaceFileEditorSelection(location)).toEqual({
      start: { line: 11, character: 2 },
      end: { line: 13, character: 7 },
      direction: "forward",
    });
  });

  test("rejects a reversed range", () => {
    expect(resolveWorkspaceFileRevealRange({ line: 14, endLine: 12 })).toBeNull();
    expect(buildWorkspaceFileEditorSelection({ line: 14, endLine: 12 })).toBeNull();
  });
});
