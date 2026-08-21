import { describe, expect, test } from "vitest";
import {
  getWorkspaceFileDomTabId,
  getWorkspaceRelativePath,
  isWorkspacePathInsideRoot,
  resolveWorkspaceFilePresentation,
  resolveWorkspaceSourceLanguage,
  resolveWorkspaceTreeFilePath,
  WORKSPACE_TEXT_EDITABLE_MAX_BYTES,
  WORKSPACE_TEXT_LOAD_MAX_BYTES,
} from "./workspace-file-model";
describe("workspace-file-model", () => {
  test("builds Codex-style file DOM tab ids", () => {
    expect(getWorkspaceFileDomTabId("local", "/Users/asc/repo/nodex/README.md")).toBe(
      "file:local:/Users/asc/repo/nodex/README.md",
    );
  });

  test("routes files from sampled metadata instead of filename alone", () => {
    expect(
      resolveWorkspaceFilePresentation({
        path: "/repo/LICENSE",
        contentKind: "text",
        sizeBytes: 1_024,
      }),
    ).toBe("readonly-text");
    expect(
      resolveWorkspaceFilePresentation({
        path: "/repo/main.ts",
        contentKind: "text",
        sizeBytes: 1_024,
      }),
    ).toBe("editable-text");
    expect(
      resolveWorkspaceFilePresentation({
        path: "/repo/image.png",
        contentKind: "binary",
        sizeBytes: 1_024,
      }),
    ).toBe("image");
    expect(
      resolveWorkspaceFilePresentation({
        path: "/repo/extensionless-asset",
        contentKind: "binary",
        mimeType: "image/png",
        sizeBytes: WORKSPACE_TEXT_LOAD_MAX_BYTES + 1,
      }),
    ).toBe("image");
    expect(
      resolveWorkspaceFilePresentation({
        path: "/repo/file.pdf",
        contentKind: "binary",
        sizeBytes: 1_024,
      }),
    ).toBe("pdf");
    expect(
      resolveWorkspaceFilePresentation({
        path: "/repo/archive.zip",
        contentKind: "binary",
        sizeBytes: 1_024,
      }),
    ).toBe("unsupported");
  });

  test("uses the public source-language registry without treating unknown text as code", () => {
    expect(resolveWorkspaceSourceLanguage("/repo/main.ts")).toBe("typescript");
    expect(resolveWorkspaceSourceLanguage("/repo/Dockerfile")).toBe("dockerfile");
    expect(resolveWorkspaceSourceLanguage("/repo/LICENSE")).toBeNull();
  });

  test("makes the edit and full-load size boundaries explicit", () => {
    expect(
      resolveWorkspaceFilePresentation({
        path: "/repo/main.ts",
        contentKind: "text",
        sizeBytes: WORKSPACE_TEXT_EDITABLE_MAX_BYTES - 1,
      }),
    ).toBe("editable-text");
    expect(
      resolveWorkspaceFilePresentation({
        path: "/repo/main.ts",
        contentKind: "text",
        sizeBytes: WORKSPACE_TEXT_EDITABLE_MAX_BYTES,
      }),
    ).toBe("readonly-text");
    expect(
      resolveWorkspaceFilePresentation({
        path: "/repo/main.ts",
        contentKind: "text",
        sizeBytes: WORKSPACE_TEXT_LOAD_MAX_BYTES,
      }),
    ).toBe("readonly-text");
    expect(
      resolveWorkspaceFilePresentation({
        path: "/repo/main.ts",
        contentKind: "text",
        sizeBytes: WORKSPACE_TEXT_LOAD_MAX_BYTES + 1,
      }),
    ).toBe("too-large");
  });

  test("resolves tree coordinates without treating prefix collisions as descendants", () => {
    expect(resolveWorkspaceTreeFilePath("/repo/project", "src/file.ts")).toBe(
      "/repo/project/src/file.ts",
    );
    expect(isWorkspacePathInsideRoot("/repo/project", "/repo/project/src/file.ts")).toBe(true);
    expect(isWorkspacePathInsideRoot("/repo/project", "/repo/project-other/file.ts")).toBe(false);
    expect(getWorkspaceRelativePath("/repo/project", "/repo/project/src/file.ts")).toBe(
      "src/file.ts",
    );
    expect(getWorkspaceRelativePath("/repo/project", "/repo/project-other/file.ts")).toBe(null);
  });

  test("handles Windows workspace roots case-insensitively", () => {
    expect(resolveWorkspaceTreeFilePath("C:\\repo", "src/file.ts")).toBe("C:\\repo\\src\\file.ts");
    expect(isWorkspacePathInsideRoot("C:\\Repo", "c:\\repo\\src\\file.ts")).toBe(true);
  });
});
