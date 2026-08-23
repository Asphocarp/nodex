import { describe, expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { it } from "@effect/vitest";
import type { ProjectSession, ProjectSessionRenameInput } from "../shared/types";
import {
  renameProjectSessionChat,
  type ProjectSessionRenameServiceDeps,
} from "./project-session-rename-service";

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
    thread: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDeps(
  session: ProjectSession,
  events: string[] = [],
): ProjectSessionRenameServiceDeps<never, never, never, never> {
  return {
    getProjectSession: () => {
      events.push("get");
      return Effect.succeed(session);
    },
    renameProjectSession: (_sessionId: string, input: ProjectSessionRenameInput) => {
      events.push(`rename:${input.title}`);
      const noThreadFallbackTitle = input.title;
      return Effect.succeed({
        ...session,
        noThreadFallbackTitle,
        displayTitle: noThreadFallbackTitle,
      });
    },
    setThreadName: (_threadId: string, rawTitle: string) => {
      events.push(`thread:${rawTitle}`);
      return Effect.succeed(true);
    },
  };
}

describe("renameProjectSessionChat", () => {
  it.effect("returns the existing session without effects for whitespace-only titles", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const session = makeSession();
      const renamed = yield* renameProjectSessionChat(
        "session-1",
        { title: " \n\t " },
        makeDeps(session, events),
      );

      expect(renamed?.id).toBe("session-1");
      expect(renamed?.displayTitle).toBe("Current title");
      expect(events.join("|")).toBe("get");
    }),
  );

  it.effect("updates an unbound session fallback title with the sanitized title", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const renamed = yield* renameProjectSessionChat(
        "session-1",
        { title: "  hello   world  " },
        makeDeps(makeSession(), events),
      );

      expect(renamed?.displayTitle).toBe("hello world");
      expect(events.join("|")).toBe("get|rename:hello world");
    }),
  );

  it.effect("renames a bound thread without updating the session fallback title", () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const session = makeSession({
        thread: {
          sessionId: "session-1",
          projectId: "project-1",
          threadId: "thread-1",
          threadPreview: "",
          modelProvider: "openai",
          executionHostId: "local",
          statusType: "active",
          statusActiveFlags: [],
          archived: false,
          linkedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: 1,
          createdAt: 1,
        },
      });

      const renamed = yield* renameProjectSessionChat(
        "session-1",
        { title: "  hello   world  " },
        makeDeps(session, events),
      );

      expect(renamed?.displayTitle).toBe("hello world");
      expect(events.join("|")).toBe("get|thread:  hello   world  |rename:hello world");
    }),
  );
});
