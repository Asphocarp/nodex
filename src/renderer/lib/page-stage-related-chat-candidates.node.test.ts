import { describe, expect, test } from "vite-plus/test";

import type { Project, ProjectSession } from "./types";
import { presentPageStageRelatedChatCandidates } from "./page-stage-related-chat-candidates";

const session = (overrides: Partial<ProjectSession> = {}): ProjectSession => ({
  id: "session:one",
  projectId: "project:one",
  noThreadFallbackTitle: "Fallback",
  displayTitle: "Chat one",
  order: 0,
  pinned: false,
  pinnedOrder: null,
  archived: false,
  archivedAt: null,
  unread: false,
  thread: null,
  createdAt: "2026-08-24T00:00:00Z",
  updatedAt: "2026-08-24T00:00:00Z",
  ...overrides,
});

describe("Page Stage related Chat candidates", () => {
  test("keeps threadless Chats, omits archived Chats, and resolves only useful picker context", () => {
    const projects = [{ id: "project:one", name: "Alpha" }] as Project[];
    expect(
      presentPageStageRelatedChatCandidates(
        [
          session(),
          session({
            id: "session:fallback",
            displayTitle: " ",
            noThreadFallbackTitle: "Planning",
            projectId: null,
          }),
          session({ id: "session:archived", archived: true }),
        ],
        projects,
      ),
    ).toEqual([
      { sessionId: "session:one", displayTitle: "Chat one", projectName: "Alpha" },
      { sessionId: "session:fallback", displayTitle: "Planning", projectName: null },
    ]);
  });
});
