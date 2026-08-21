import { describe, expect, test } from "vite-plus/test";
import {
  buildStableWorktreeCreateInput,
  STABLE_WORKTREE_CREATE_PROMPT,
  suggestStableWorktreeProjectName,
} from "./stable-worktree-production";

describe("stable worktree production helpers", () => {
  test("suggests the first free project suffix from labels and folder names", () => {
    expect(
      suggestStableWorktreeProjectName({
        base: " Nodex ",
        workspaceRootOptions: ["/repo/first", "/repo/Nodex_3"],
        workspaceRootLabels: { "/repo/first": "Nodex_2" },
      }),
    ).toBe("Nodex_4");
    expect(suggestStableWorktreeProjectName({ base: "   " })).toBe("Workspace_2");
  });

  test("builds the exact stable create request", () => {
    const input = buildStableWorktreeCreateInput({
      sourceWorkspaceRoot: "/repo/nodex",
      sourceWorkspaceRoots: ["/repo/nodex", "/repo/shared"],
      label: "Nodex_2",
    });

    expect(input.hostId).toBe("local");
    expect(input.label).toBe("Nodex_2");
    expect(input.sourceWorkspaceRoot).toBe("/repo/nodex");
    expect(input.launchMode).toBe("create-stable-worktree");
    if (input.launchMode !== "create-stable-worktree") {
      throw new Error("Expected stable worktree input");
    }
    expect(input.sourceWorkspaceRoots).toEqual(["/repo/nodex", "/repo/shared"]);
    expect(input.startingState?.type).toBe("branch");
    expect(input.startingState?.type === "branch" ? input.startingState.branchName : null).toBe(
      "HEAD",
    );
    expect(input.localEnvironmentConfigPath).toBe(null);
    expect(input.prompt).toBe(STABLE_WORKTREE_CREATE_PROMPT);
    expect(input.launchMode).toBe("create-stable-worktree");
    expect(input.startConversationParamsInput).toBe(null);
    expect(input.sourceConversationId).toBe(null);
    expect(input.sourceCollaborationMode).toBe(null);
  });
});
