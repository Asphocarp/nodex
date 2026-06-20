import { describe, expect, test } from "bun:test";
import type { CommandPaletteThread } from "./command-palette";
import { createCommandPaletteThreadSearchIndex } from "./command-palette-thread-search";

function makeThread(overrides: Partial<CommandPaletteThread> = {}): CommandPaletteThread {
  return {
    kind: "thread",
    id: overrides.id ?? "thread:thr-command-palette",
    threadId: overrides.threadId ?? "thr-command-palette",
    sessionId: overrides.sessionId ?? "session-command-palette",
    projectId: overrides.projectId ?? "project-1",
    projectName: overrides.projectName ?? "Nodex",
    title: overrides.title ?? "Command palette thread search",
    preview: overrides.preview ?? "Add thread search and content snippets to the launcher.",
    cwd: overrides.cwd ?? "/Users/asc/nodex",
    statusType: overrides.statusType ?? "notLoaded",
    statusActiveFlags: overrides.statusActiveFlags ?? [],
    createdAt: overrides.createdAt ?? 1_781_990_400,
    updatedAt: overrides.updatedAt ?? 1_781_990_400,
    linkedAt: overrides.linkedAt ?? "2026-06-20T00:00:00.000Z",
    inActiveProject: overrides.inActiveProject ?? true,
  };
}

describe("command palette thread search index", () => {
  test("matches fuzzy title queries and highlights the title", () => {
    const index = createCommandPaletteThreadSearchIndex([
      makeThread({
        threadId: "thr-target",
        id: "thread:thr-target",
        title: "Command palette thread search",
      }),
      makeThread({
        threadId: "thr-other",
        id: "thread:thr-other",
        title: "Terminal layout polish",
      }),
    ]);

    const results = index.search("commnd palete");

    expect(results.length > 0).toBeTrue();
    expect(results[0]?.item.threadId).toBe("thr-target");
    expect(results[0]?.item.searchDecorations?.titleSegments?.some((segment) => segment.highlight)).toBeTrue();
  });

  test("builds preview snippets for metadata preview matches", () => {
    const index = createCommandPaletteThreadSearchIndex([
      makeThread({
        threadId: "thr-preview",
        id: "thread:thr-preview",
        title: "General investigation",
        preview: "Explore command palette content snippets for historical threads.",
      }),
    ]);

    const results = index.search("content snippets");

    expect(results.length).toBe(1);
    expect(results[0]?.item.threadId).toBe("thr-preview");
    expect(results[0]?.item.searchPreview?.source).toBe("metadata");
    expect(results[0]?.item.searchPreview?.segments.some((segment) => segment.highlight)).toBeTrue();
  });

  test("matches project and cwd fields without inventing a content preview", () => {
    const index = createCommandPaletteThreadSearchIndex([
      makeThread({
        threadId: "thr-cwd",
        id: "thread:thr-cwd",
        title: "General investigation",
        preview: "No searched terms here.",
        projectName: "Codex app",
        cwd: "/Users/asc/codex-app",
      }),
    ]);

    const results = index.search("codex app");

    expect(results.length).toBe(1);
    expect(results[0]?.item.threadId).toBe("thr-cwd");
    expect(results[0]?.item.searchPreview ?? null).toBe(null);
    expect(results[0]?.item.searchDecorations?.projectNameSegments?.some((segment) => segment.highlight)).toBeTrue();
  });
});
