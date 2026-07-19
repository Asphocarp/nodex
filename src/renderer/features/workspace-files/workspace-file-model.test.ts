import { describe, expect, test } from "vitest";
import {
  getWorkspaceFileDomTabId,
  getWorkspaceFileName,
  getWorkspaceRelativePath,
  isWorkspacePathInsideRoot,
  resolveWorkspaceFilePreviewKind,
  resolveWorkspaceTreeFilePath,
  shouldIncludeWorkspaceTreeEntry,
} from "./workspace-file-model";
import type { WorkspaceFileDirectoryEntry } from "@/lib/types";

function makeEntry(name: string, path: string): WorkspaceFileDirectoryEntry {
  return {
    name,
    path,
    type: "file",
    isSymlink: false,
  };
}

describe("workspace-file-model", () => {
  test("builds Codex-style file DOM tab ids", () => {
    expect(getWorkspaceFileDomTabId("local", "/Users/asc/repo/nodex/README.md")).toBe(
      "file:local:/Users/asc/repo/nodex/README.md",
    );
  });

  test("resolves preview kinds from paths and mime types", () => {
    expect(resolveWorkspaceFilePreviewKind("/repo/README.md", null)).toBe("markdown");
    expect(resolveWorkspaceFilePreviewKind("/repo/image.png", null)).toBe("image");
    expect(resolveWorkspaceFilePreviewKind("/repo/file.pdf", null)).toBe("pdf");
    expect(resolveWorkspaceFilePreviewKind("/repo/data.csv", null)).toBe("spreadsheet");
    expect(resolveWorkspaceFilePreviewKind("/repo/main.ts", null)).toBe("text");
    expect(resolveWorkspaceFilePreviewKind("/repo/archive.zip", null)).toBe("unsupported");
  });

  test("filters tree entries by name or path", () => {
    const entry = makeEntry("README.md", "/repo/docs/README.md");

    expect(getWorkspaceFileName(entry.path)).toBe("README.md");
    expect(shouldIncludeWorkspaceTreeEntry(entry, "docs")).toBe(true);
    expect(shouldIncludeWorkspaceTreeEntry(entry, "missing")).toBe(false);
  });

  test("resolves tree coordinates without treating prefix collisions as descendants", () => {
    expect(resolveWorkspaceTreeFilePath("/repo/project", "src/file.ts")).toBe("/repo/project/src/file.ts");
    expect(isWorkspacePathInsideRoot("/repo/project", "/repo/project/src/file.ts")).toBe(true);
    expect(isWorkspacePathInsideRoot("/repo/project", "/repo/project-other/file.ts")).toBe(false);
    expect(getWorkspaceRelativePath("/repo/project", "/repo/project/src/file.ts")).toBe("src/file.ts");
    expect(getWorkspaceRelativePath("/repo/project", "/repo/project-other/file.ts")).toBe(null);
  });

  test("handles Windows workspace roots case-insensitively", () => {
    expect(resolveWorkspaceTreeFilePath("C:\\repo", "src/file.ts")).toBe("C:\\repo\\src\\file.ts");
    expect(isWorkspacePathInsideRoot("C:\\Repo", "c:\\repo\\src\\file.ts")).toBe(true);
  });
});
