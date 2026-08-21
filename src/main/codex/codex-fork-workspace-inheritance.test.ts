import { describe, expect, test } from "vite-plus/test";
import { resolveCodexForkWorkspaceInheritance } from "./codex-fork-workspace-inheritance";

describe("Codex fork workspace inheritance", () => {
  test("copies the projectless identity and both workspace hints as one boundary", () => {
    const inherited = resolveCodexForkWorkspaceInheritance({
      projectId: null,
      projectlessOutputDirectory: "/outputs/thread",
      projectlessWorkspaceBrowserRoot: "/workspace/browser",
    });

    expect(inherited.projectId).toBe(null);
    expect(inherited.projectlessOutputDirectory).toBe("/outputs/thread");
    expect(inherited.projectlessWorkspaceBrowserRoot).toBe("/workspace/browser");
  });

  test("normalizes absent project workspace metadata to explicit nulls", () => {
    const inherited = resolveCodexForkWorkspaceInheritance({ projectId: "project-1" });

    expect(inherited.projectId).toBe("project-1");
    expect(inherited.projectlessOutputDirectory).toBe(null);
    expect(inherited.projectlessWorkspaceBrowserRoot).toBe(null);
  });
});
