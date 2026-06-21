import { describe, expect, test } from "bun:test";
import type { ProjectSession, ProjectSessionUpdateInput } from "../shared/types";
import { renameProjectSessionChat, type ProjectSessionRenameServiceDeps } from "./project-session-rename-service";

function makeSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
  return {
    id: "session-1",
    projectId: "project-1",
    noThreadFallbackTitle: "Current title",
    displayTitle: "Current title",
    order: 1,
    pinned: false,
    pinnedOrder: null,
    archived: false,
    archivedAt: null,
    unread: false,
    leftPaneCollapsed: false,
    panels: {} as ProjectSession["panels"],
    thread: null,
    tabs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDeps(session: ProjectSession, events: string[] = []): ProjectSessionRenameServiceDeps {
  return {
    getProjectSession: () => {
      events.push("get");
      return session;
    },
    updateProjectSession: (_sessionId: string, input: ProjectSessionUpdateInput) => {
      events.push(`update:${input.noThreadFallbackTitle ?? ""}`);
      const noThreadFallbackTitle = input.noThreadFallbackTitle ?? session.noThreadFallbackTitle;
      return {
        ...session,
        noThreadFallbackTitle,
        displayTitle: noThreadFallbackTitle,
      };
    },
    setThreadName: async (_threadId: string, rawTitle: string) => {
      events.push(`thread:${rawTitle}`);
      return true;
    },
    notifyProjectSessionsChanged: (_projectId: string | null, changeType: "update", sessionId: string) => {
      events.push(`notify:${changeType}:${sessionId}`);
    },
  };
}

describe("renameProjectSessionChat", () => {
  test("returns the existing session without effects for whitespace-only titles", async () => {
    const events: string[] = [];
    const session = makeSession();
    const renamed = await renameProjectSessionChat("session-1", { title: " \n\t " }, makeDeps(session, events));

    expect(renamed?.id).toBe("session-1");
    expect(renamed?.displayTitle).toBe("Current title");
    expect(events.join("|")).toBe("get");
  });

  test("updates an unbound session fallback title with the sanitized title", async () => {
    const events: string[] = [];
    const renamed = await renameProjectSessionChat(
      "session-1",
      { title: "  hello   world  " },
      makeDeps(makeSession(), events),
    );

    expect(renamed?.displayTitle).toBe("hello world");
    expect(events.join("|")).toBe("get|update:hello world|notify:update:session-1");
  });

  test("renames a bound thread without updating the session fallback title", async () => {
    const events: string[] = [];
    const session = makeSession({
      thread: {
        sessionId: "session-1",
        projectId: "project-1",
        threadId: "thread-1",
        threadPreview: "",
        modelProvider: "openai",
        statusType: "active",
        statusActiveFlags: [],
        archived: false,
        linkedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: 1,
        createdAt: 1,
      },
    });

    const renamed = await renameProjectSessionChat(
      "session-1",
      { title: "  hello   world  " },
      makeDeps(session, events),
    );

    expect(renamed?.displayTitle).toBe("Current title");
    expect(events.join("|")).toBe("get|thread:  hello   world  |get");
  });
});
