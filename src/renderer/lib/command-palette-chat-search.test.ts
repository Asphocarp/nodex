import { describe, expect, test } from "bun:test";
import type { CommandPaletteThread } from "./command-palette";
import { selectCommandPaletteChatResults } from "./command-palette-chat-search";
import { createCommandPaletteThreadSearchIndex } from "./command-palette-thread-search";
import type { CommandPaletteThreadContentSearchResult } from "./types";

function makeThread(overrides: Partial<CommandPaletteThread> = {}): CommandPaletteThread {
  return {
    kind: "thread",
    id: overrides.id ?? "thread:thr-1",
    threadId: overrides.threadId ?? "thr-1",
    sessionId: overrides.sessionId === undefined ? "session-1" : overrides.sessionId,
    projectId: overrides.projectId === undefined ? "project-1" : overrides.projectId,
    projectName: overrides.projectName === undefined ? "Project" : overrides.projectName,
    title: overrides.title ?? "Command palette chat search",
    preview: overrides.preview ?? "Add shared chat search to pickers.",
    cwd: overrides.cwd ?? "/tmp/project",
    projectless: overrides.projectless ?? false,
    pinned: overrides.pinned ?? false,
    pinnedOrder: overrides.pinnedOrder ?? null,
    statusType: overrides.statusType ?? "notLoaded",
    statusActiveFlags: overrides.statusActiveFlags ?? [],
    createdAt: overrides.createdAt ?? 1_781_990_400,
    updatedAt: overrides.updatedAt ?? 1_781_990_400,
    linkedAt: overrides.linkedAt ?? "2026-06-20T00:00:00.000Z",
    inActiveProject: overrides.inActiveProject ?? true,
  };
}

function makeContentResult(
  overrides: Partial<CommandPaletteThreadContentSearchResult> = {},
): CommandPaletteThreadContentSearchResult {
  return {
    threadId: overrides.threadId ?? "thr-1",
    snippet: overrides.snippet ?? "Transcript excerpt",
    score: overrides.score ?? -1,
    matchKind: "fts",
    snippetSegments: overrides.snippetSegments,
  };
}

describe("command palette chat result selection", () => {
  test("searches projectless and sessionless sidebar chats through metadata labels", () => {
    const thread = makeThread({
      threadId: "thr-projectless",
      id: "thread:thr-projectless",
      sessionId: null,
      projectId: null,
      projectName: null,
      projectless: true,
      title: "Inbox research",
    });
    const threads = [thread];

    const results = selectCommandPaletteChatResults({
      query: "chats",
      threads,
      threadSearchIndex: createCommandPaletteThreadSearchIndex(threads),
    });

    expect(results.length).toBe(1);
    expect(results[0]?.threadId).toBe("thr-projectless");
    expect(results[0]?.searchDecorations?.projectNameSegments?.some((segment) => segment.highlight)).toBeTrue();
  });

  test("merges content-only transcript hits into chat results", () => {
    const thread = makeThread({
      threadId: "thr-content",
      id: "thread:thr-content",
      title: "General chat",
      preview: "No matching metadata here.",
    });
    const threads = [thread];

    const results = selectCommandPaletteChatResults({
      query: "approval heuristic",
      threads,
      threadSearchIndex: createCommandPaletteThreadSearchIndex(threads),
      threadContentSearchResults: [
        makeContentResult({
          threadId: "thr-content",
          snippet: "Tune the approval heuristic before merging.",
        }),
      ],
    });

    expect(results.length).toBe(1);
    expect(results[0]?.threadId).toBe("thr-content");
    expect(results[0]?.searchPreview?.source).toBe("content");
    expect(results[0]?.searchPreview?.excerpt.includes("approval heuristic")).toBeTrue();
  });

  test("keeps metadata preview when content search also returns the same chat", () => {
    const thread = makeThread({
      threadId: "thr-preview",
      id: "thread:thr-preview",
      title: "Incident review",
      preview: "Discuss retry budget and queue recovery.",
    });
    const threads = [thread];

    const results = selectCommandPaletteChatResults({
      query: "retry budget",
      threads,
      threadSearchIndex: createCommandPaletteThreadSearchIndex(threads),
      threadContentSearchResults: [
        makeContentResult({
          threadId: "thr-preview",
          snippet: "Server retry budget transcript snippet.",
        }),
      ],
    });

    expect(results.length).toBe(1);
    expect(results[0]?.threadId).toBe("thr-preview");
    expect(results[0]?.searchPreview?.source).toBe("metadata");
    expect(results[0]?.searchPreview?.excerpt.includes("Discuss retry budget")).toBeTrue();
  });
});
