import { describe, expect, test } from "vite-plus/test";
import {
  getNewChatStartInTriggerIconKey,
  getNewChatStartInTriggerLabel,
  resolveNewChatStartInOptions,
} from "./new-chat-start-in-selector";

describe("new-chat start-in selector", () => {
  test("resolves local option metadata", () => {
    const options = resolveNewChatStartInOptions({
      selectedRunInTarget: "localProject",
      worktreeAvailable: true,
    });
    const local = options.find((option) => option.value === "localProject");

    expect(local?.label).toBe("Local");
    expect(local?.iconKey).toBe("local");
    expect(local?.selected).toBe(true);
    expect(local?.disabled).toBe(false);
    expect(getNewChatStartInTriggerLabel("localProject")).toBe("Work locally");
    expect(getNewChatStartInTriggerIconKey("localProject")).toBe("local");
  });

  test("resolves worktree option metadata", () => {
    const options = resolveNewChatStartInOptions({
      selectedRunInTarget: "newWorktree",
      worktreeAvailable: true,
    });
    const worktree = options.find((option) => option.value === "newWorktree");

    expect(worktree?.label).toBe("New worktree");
    expect(worktree?.iconKey).toBe("worktree");
    expect(worktree?.selected).toBe(true);
    expect(worktree?.disabled).toBe(false);
    expect(getNewChatStartInTriggerLabel("newWorktree")).toBe("New worktree");
    expect(getNewChatStartInTriggerIconKey("newWorktree")).toBe("worktree");
  });

  test("keeps cloud unavailable when no backend is available", () => {
    const options = resolveNewChatStartInOptions({
      selectedRunInTarget: "localProject",
      worktreeAvailable: true,
      cloudAvailable: false,
    });
    const cloud = options.find((option) => option.value === "cloud");

    expect(cloud?.label).toBe("Send to cloud");
    expect(cloud?.iconKey).toBe("cloud");
    expect(cloud?.disabled).toBe(true);
  });

  test("disables new worktree for non-git projects", () => {
    const options = resolveNewChatStartInOptions({
      selectedRunInTarget: "localProject",
      worktreeAvailable: false,
    });
    const worktree = options.find((option) => option.value === "newWorktree");

    expect(worktree?.disabled).toBe(true);
    expect(Boolean(worktree?.tooltipText?.includes("git repo"))).toBe(true);
  });
});
