import { describe, expect, test } from "vite-plus/test";
import { resolveWorkspaceFileClickMode, toPierreWorkspaceTreePaths } from "./workspace-file-tree";

describe("toPierreWorkspaceTreePaths", () => {
  test("preserves files and marks explicit empty directories with a trailing slash", () => {
    expect(
      toPierreWorkspaceTreePaths([
        { path: ".hidden", kind: "directory" },
        { path: ".hidden/empty", kind: "directory" },
        { path: ".hidden/LICENSE", kind: "file" },
        { path: "src/index.ts", kind: "file" },
      ]),
    ).toEqual([".hidden/", ".hidden/empty/", ".hidden/LICENSE", "src/index.ts"]);
  });

  test("previews once before a double click delegates one durable open", () => {
    expect(resolveWorkspaceFileClickMode(1)).toBe("preview");
    expect(resolveWorkspaceFileClickMode(2)).toBeNull();
  });
});
