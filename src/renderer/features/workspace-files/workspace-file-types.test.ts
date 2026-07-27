import { describe, expect, test } from "vitest";
import { normalizeWorkspaceFilesTabState } from "./workspace-file-types";

describe("normalizeWorkspaceFilesTabState", () => {
  test("keeps only serializable presentation state and recoverable drafts", () => {
    expect(normalizeWorkspaceFilesTabState({
      markdownMode: "rendered",
      treeVisible: false,
      treeWidth: 320,
      wordWrap: false,
      draft: {
        path: "/repo/index.ts",
        content: "local",
        baseMtimeMs: 1,
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
      runtimeEditor: { unsafe: true },
    })).toEqual({
      markdownMode: "rendered",
      treeVisible: false,
      treeWidth: 320,
      wordWrap: false,
      draft: {
        path: "/repo/index.ts",
        content: "local",
        baseMtimeMs: 1,
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    });
    expect(normalizeWorkspaceFilesTabState("invalid")).toEqual({});
  });
});
