import { describe, expect, it } from "vite-plus/test";
import { resolveWorkbenchPanelCapabilities } from "./workbench-panel-capabilities";

describe("resolveWorkbenchPanelCapabilities", () => {
  it("offers Review first for an attached projectless chat in the right panel", () => {
    const result = resolveWorkbenchPanelCapabilities({
      panelId: "right",
      hasSession: true,
      projectId: null,
      hasAttachedThread: true,
      cwd: "/workspace",
    });

    expect(result.availableActionKinds).toEqual(["review", "side_chat", "browser", "terminal"]);
  });

  it("offers side chat, browser, then terminal to attached projectless chats in the bottom panel", () => {
    const result = resolveWorkbenchPanelCapabilities({
      panelId: "bottom",
      hasSession: true,
      projectId: null,
      hasAttachedThread: true,
      cwd: "/workspace",
    });

    expect(result.availableActionKinds).toEqual(["side_chat", "browser", "terminal"]);
  });

  it("keeps Review unavailable without an attached thread", () => {
    const result = resolveWorkbenchPanelCapabilities({
      panelId: "right",
      hasSession: true,
      projectId: null,
      hasAttachedThread: false,
      cwd: null,
    });

    expect(result.actions.review.reason).toBe("no_thread");
  });

  it("offers projectless actions independently of a workspace cwd", () => {
    const result = resolveWorkbenchPanelCapabilities({
      panelId: "right",
      hasSession: true,
      projectId: null,
      hasAttachedThread: true,
      cwd: null,
    });

    expect(result.availableActionKinds).toEqual(["review", "side_chat", "browser"]);
  });

  it("keeps side chat available when a projectless parent needs workspace repair", () => {
    const result = resolveWorkbenchPanelCapabilities({
      panelId: "right",
      hasSession: true,
      projectId: null,
      hasAttachedThread: true,
      cwd: null,
    });

    expect(result.availableActionKinds).toEqual(["review", "side_chat", "browser"]);
    expect(result.actions.terminal.reason).toBe("no_cwd");
  });

  it("only offers browser to a blank projectless session", () => {
    const result = resolveWorkbenchPanelCapabilities({
      panelId: "right",
      hasSession: true,
      projectId: null,
      hasAttachedThread: false,
      cwd: null,
    });

    expect(result.availableActionKinds).toEqual(["browser"]);
    expect(result.actions.side_chat.reason).toBe("no_thread");
    expect(result.actions.terminal.reason).toBe("no_cwd");
    expect(result.actions.files.reason).toBe("project_required");
  });

  it("keeps the existing project-backed action order and panel eligibility", () => {
    const right = resolveWorkbenchPanelCapabilities({
      panelId: "right",
      hasSession: true,
      projectId: "project-1",
      hasAttachedThread: true,
      cwd: null,
      projectWorkspaceRoot: "/project",
    });
    const bottom = resolveWorkbenchPanelCapabilities({
      panelId: "bottom",
      hasSession: true,
      projectId: "project-1",
      hasAttachedThread: true,
      cwd: null,
      projectWorkspaceRoot: "/project",
    });

    expect(right.availableActionKinds).toEqual([
      "review",
      "terminal",
      "browser",
      "files",
      "side_chat",
      "db_view",
      "page_stage",
      "canvas_stage",
    ]);
    expect(bottom.availableActionKinds).toEqual(["terminal", "browser", "files", "side_chat"]);
  });

  it("hides an existing singleton without changing other actions", () => {
    const result = resolveWorkbenchPanelCapabilities({
      panelId: "right",
      hasSession: true,
      projectId: "project-1",
      hasAttachedThread: true,
      cwd: "/workspace",
      existingTabKinds: ["review", "browser"],
    });

    expect(result.actions.review.reason).toBe("singleton_exists");
    expect(result.actions.browser.available).toBe(true);
  });
});
