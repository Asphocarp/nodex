import { describe, expect, test } from "bun:test";
import type { Project } from "./types";
import {
  buildNewChatProjectSelectorOptions,
  filterNewChatProjectSelectorOptions,
  resolveSelectedNewChatProjectSelectorOption,
} from "./new-chat-project-selector";

function makeProject(input: {
  id: string;
  name: string;
  description?: string;
  primaryWorkspaceRoot?: string;
}): Project {
  const primaryWorkspaceRoot = input.primaryWorkspaceRoot?.trim() || null;
  return {
    id: input.id,
    name: input.name,
    description: input.description ?? "",
    icon: "",
    sources: primaryWorkspaceRoot ? [{ root: primaryWorkspaceRoot, order: 0 }] : [],
    primaryWorkspaceRoot,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-06-07T00:00:00.000Z"),
    updated: new Date("2026-06-07T00:00:00.000Z"),
  };
}

describe("new-chat project selector options", () => {
  const options = buildNewChatProjectSelectorOptions([
    makeProject({
      id: "nodex",
      name: "Nodex",
      description: "Local-first agent orchestrator",
      primaryWorkspaceRoot: "/Users/asc/repo/nodex",
    }),
    makeProject({
      id: "devtools-codex",
      name: "Devtools Codex",
      primaryWorkspaceRoot: "/Users/asc/repo/devtools-codex",
    }),
    makeProject({
      id: "videos",
      name: "Videos",
      description: "Production scripts",
    }),
  ]);

  test("matches projects by display name", () => {
    const filtered = filterNewChatProjectSelectorOptions(options, "nodex");
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.id).toBe("nodex");
  });

  test("matches projects by workspace path", () => {
    const filtered = filterNewChatProjectSelectorOptions(options, "devtools");
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.id).toBe("devtools-codex");
  });

  test("returns all projects for empty search", () => {
    const filtered = filterNewChatProjectSelectorOptions(options, "   ");
    expect(filtered.length).toBe(3);
    expect(filtered[0]?.id).toBe("nodex");
    expect(filtered[2]?.id).toBe("videos");
  });

  test("preserves selected-project metadata", () => {
    const selected = resolveSelectedNewChatProjectSelectorOption(options, "devtools-codex");
    expect(selected?.label).toBe("Devtools Codex");
    expect(selected?.primaryWorkspaceRoot).toBe("/Users/asc/repo/devtools-codex");
  });
});
