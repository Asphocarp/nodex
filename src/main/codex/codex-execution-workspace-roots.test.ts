import { describe, expect, test } from "vite-plus/test";
import {
  isExecutionWorkspacePathWithinRoot,
  rewriteExecutionWorkspacePath,
  rewriteExecutionWorkspaceRoots,
} from "./codex-execution-workspace-roots";

describe("execution workspace root rewriting", () => {
  test("replaces only the primary root and preserves additional root order", () => {
    expect(
      rewriteExecutionWorkspaceRoots({
        sourcePrimary: "/repo/primary",
        targetPrimary: "/worktrees/a1b2/primary",
        workspaceRoots: ["/repo/primary", "/repo/shared-a", "/repo/shared-b", "/repo/primary/"],
      }),
    ).toEqual(["/worktrees/a1b2/primary", "/repo/shared-a", "/repo/shared-b"]);
  });

  test("retains an external custom cwd as an explicit permission root", () => {
    expect(
      rewriteExecutionWorkspaceRoots({
        sourcePrimary: "/repo/primary",
        targetPrimary: "/worktrees/a1b2/primary",
        workspaceRoots: ["/repo/primary", "/repo/shared"],
        explicitRoots: ["/repo/primary/packages/app", "/scratch/custom-cwd"],
      }),
    ).toEqual(["/worktrees/a1b2/primary", "/repo/shared", "/scratch/custom-cwd"]);
  });

  test("compares Windows and UNC roots path-equivalently", () => {
    expect(isExecutionWorkspacePathWithinRoot("C:\\Repo\\src", "c:/repo/")).toBe(true);
    expect(
      rewriteExecutionWorkspacePath({
        path: "C:\\Repo\\src",
        sourcePrimary: "c:/repo",
        targetPrimary: "D:/worktrees/a1b2/repo",
      }),
    ).toBe("D:/worktrees/a1b2/repo/src");
    expect(
      rewriteExecutionWorkspaceRoots({
        sourcePrimary: "//HOST/Repo",
        targetPrimary: "//host/Worktrees/a1b2/Repo",
        workspaceRoots: ["//host/repo/", "//host/shared", "//HOST/SHARED/"],
      }),
    ).toEqual(["//host/Worktrees/a1b2/Repo", "//host/shared"]);
  });
});
