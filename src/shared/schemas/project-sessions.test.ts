import { describe, expect, test } from "vitest";
import { parseProjectSessionTabConfig } from "./project-sessions";

describe("project session Page Stage config", () => {
  test("persists only Page identity, access context, and a title snapshot", () => {
    expect(parseProjectSessionTabConfig("page_stage", {
      projectId: "alpha",
      pageId: "nested",
      titleSnapshot: "Nested",
    })).toEqual({
      projectId: "alpha",
      pageId: "nested",
      titleSnapshot: "Nested",
    });
  });

  test("discards legacy interaction-derived ancestor trails", () => {
    expect(parseProjectSessionTabConfig("page_stage", {
      projectId: "alpha",
      pageId: "nested",
      ancestors: [{
        projectId: "stale-project",
        pageId: "root",
        titleSnapshot: "Stale title",
      }],
    })).toEqual({
      projectId: "alpha",
      pageId: "nested",
    });
  });
});

describe("project session Files config", () => {
  test("persists projectless exact-file tabs without inventing a workspace root", () => {
    expect(parseProjectSessionTabConfig("files", {
      projectId: null,
      hostId: "local",
      workspaceRoot: null,
      cwd: "/tmp/worktree",
      path: "/tmp/worktree/README.md",
    })).toEqual({
      projectId: null,
      hostId: "local",
      workspaceRoot: null,
      cwd: "/tmp/worktree",
      path: "/tmp/worktree/README.md",
    });
  });

  test("normalizes legacy empty browsing coordinates to no navigation root", () => {
    expect(parseProjectSessionTabConfig("files", {
      projectId: "alpha",
      workspaceRoot: "",
      cwd: "   ",
    })).toEqual({
      projectId: "alpha",
      hostId: "local",
      workspaceRoot: null,
      cwd: null,
    });
  });
});
