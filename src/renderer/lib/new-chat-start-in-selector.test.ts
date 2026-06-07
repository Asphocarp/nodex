import { describe, expect, test } from "bun:test";
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

    expect(local?.label).toBe("Work locally");
    expect(local?.iconKey).toBe("local");
    expect(local?.selected).toBeTrue();
    expect(local?.disabled).toBeFalse();
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
    expect(worktree?.selected).toBeTrue();
    expect(worktree?.disabled).toBeFalse();
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
    expect(cloud?.disabled).toBeTrue();
  });

  test("disables new worktree for non-git projects", () => {
    const options = resolveNewChatStartInOptions({
      selectedRunInTarget: "localProject",
      worktreeAvailable: false,
    });
    const worktree = options.find((option) => option.value === "newWorktree");

    expect(worktree?.disabled).toBeTrue();
    expect(Boolean(worktree?.tooltipText?.includes("git repo"))).toBeTrue();
  });
});
