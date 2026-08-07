import { describe, expect, test, vi } from "vitest";
import {
  createFileReferenceRouter,
  openFileReferenceExternally,
} from "./file-reference-router";

describe("file reference router", () => {
  test("uses the panel port for an ordinary file reference", async () => {
    const openWorkspaceFileTab = vi.fn(async () => true);
    const router = createFileReferenceRouter({
      opener: "vscode",
      port: { openWorkspaceFileTab },
    });

    await expect(router.open({
      path: "/workspace/project/src/index.ts",
      line: 19,
      column: 4,
    }, {
      cwd: "/workspace/project",
      workspaceRoot: "/workspace/project",
      title: "index.ts",
    })).resolves.toBe(true);

    expect(openWorkspaceFileTab).toHaveBeenCalledWith({
      cwd: "/workspace/project",
      hostId: "local",
      path: "/workspace/project/src/index.ts",
      title: "index.ts",
      panelId: "right",
      mode: "preview",
      workspaceRoot: "/workspace/project",
      location: { line: 19, column: 4 },
    });
  });

  test("falls back to Finder when the selected external opener cannot open", async () => {
    const invokeImpl = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(openFileReferenceExternally(
      { path: "/workspace/project/src/index.ts", line: 19 },
      "vscode",
      invokeImpl as never,
    )).resolves.toBe(true);

    expect(invokeImpl).toHaveBeenNthCalledWith(
      2,
      "shell:open-file-link",
      { path: "/workspace/project/src/index.ts", line: 19 },
      "fileManager",
    );
  });

});
