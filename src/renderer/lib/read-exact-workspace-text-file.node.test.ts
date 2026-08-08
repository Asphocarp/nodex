import { describe, expect, test, vi } from "vitest";
import { readExactWorkspaceTextFile } from "./read-exact-workspace-text-file";

describe("readExactWorkspaceTextFile", () => {
  test("reads an absolute file without coupling the request to a workspace root", async () => {
    const readMetadata = vi.fn(async () => ({
      isFile: true,
      createdAtMs: 1,
      mtimeMs: 2,
      sizeBytes: 12,
      contentKind: "text" as const,
    }));
    const readText = vi.fn(async () => ({ contents: "outside root" }));

    await expect(readExactWorkspaceTextFile({
      path: "/tmp/worktree/README.md",
      maxBytes: 1_000,
      contentSampleByteLimit: 128,
    }, { readMetadata, readText })).resolves.toBe("outside root");

    expect(readMetadata).toHaveBeenCalledWith({
      path: "/tmp/worktree/README.md",
      contentSampleByteLimit: 128,
      contentSampleMaxFileBytes: 1_000,
    });
    expect(readText).toHaveBeenCalledWith({
      path: "/tmp/worktree/README.md",
      maxBytes: 1_000,
    });
  });

  test.each([
    { contentKind: "binary" as const, sizeBytes: 12 },
    { contentKind: "text" as const, sizeBytes: 1_001 },
    { contentKind: undefined, sizeBytes: null },
  ])("does not read unsupported content: %o", async (metadata) => {
    const readText = vi.fn(async () => ({ contents: "unexpected" }));
    const result = await readExactWorkspaceTextFile({
      path: "/tmp/file.bin",
      maxBytes: 1_000,
      contentSampleByteLimit: 128,
    }, {
      readMetadata: async () => ({
        isFile: true,
        createdAtMs: 1,
        mtimeMs: 2,
        ...metadata,
      }),
      readText,
    });

    expect(result).toBeNull();
    expect(readText).not.toHaveBeenCalled();
  });
});
