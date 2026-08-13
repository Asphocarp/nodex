import { describe, expect, test } from "vitest";
import { resolveCodexSidebarWorktreeLabel } from "./codex-sidebar-run-location";

describe("resolveCodexSidebarWorktreeLabel", () => {
  test.each([
    ["/Users/me/.codex/worktrees/91a6/nodex", "nodex"],
    ["/Users/me/.nodex/worktrees/91A6/nodex/packages/app", "nodex"],
    ["C:\\Users\\me\\.codex\\worktrees\\91a6\\nodex", "nodex"],
    ["/srv/.codex/worktrees/019ff6ec-83b8-77a2-9e57-c1e16dd8cfea/nodex", "nodex"],
    ["/srv/.codex/worktrees/nodex/packages/app", "nodex"],
    ["/srv/custom-managed-root/nodex", "nodex"],
  ])("derives a stable label from %s", (path, expected) => {
    expect(resolveCodexSidebarWorktreeLabel(path)).toBe(expected);
  });

  test.each([null, "", "   ", "/Users/me/.codex/worktrees/"])(
    "does not invent a label for incomplete path %s",
    (path) => {
      expect(resolveCodexSidebarWorktreeLabel(path)).toBeNull();
    },
  );
});
