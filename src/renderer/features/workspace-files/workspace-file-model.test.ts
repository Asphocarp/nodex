import { describe, expect, test } from "vitest";
import {
  getWorkspaceFileDomTabId,
  getWorkspaceFileName,
  resolveWorkspaceFilePreviewKind,
  shouldIncludeWorkspaceTreeEntry,
} from "./workspace-file-model";
import type { WorkspaceFileDirectoryEntry } from "@/lib/types";

function makeEntry(name: string, path: string): WorkspaceFileDirectoryEntry {
  return {
    name,
    path,
    kind: "file",
    isDirectory: false,
    isFile: true,
    isSymlink: false,
    size: 1,
    modifiedAtMs: 0,
    hidden: false,
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
});
