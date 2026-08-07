import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import type {
  ProjectSession,
  ProjectSessionSummaryWindow,
} from "./types";
import { queryKeys } from "./query-keys";
import {
  getCachedProjectSessionDetail,
  invalidateProjectSessionScope,
  projectSessionToSummary,
  seedProjectSessionDetail,
  setProjectSessionSummaries,
} from "./project-session-query-cache";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 5 * 60_000,
      },
    },
  });
}

function createSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
  return {
    id: overrides.id ?? "session-1",
    projectId: overrides.projectId === undefined ? "project-1" : overrides.projectId,
    noThreadFallbackTitle: overrides.noThreadFallbackTitle ?? "Session",
    displayTitle: overrides.displayTitle ?? "Session",
    order: overrides.order ?? 0,
    pinned: overrides.pinned ?? false,
    pinnedOrder: overrides.pinnedOrder ?? null,
    archived: overrides.archived ?? false,
    archivedAt: overrides.archivedAt ?? null,
    unread: overrides.unread ?? false,
    thread: overrides.thread ?? null,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("project session query cache", () => {
  test("uses stable summary and detail keys", () => {
    expect(JSON.stringify(queryKeys.projectSessions.summaries("project-1"))).toBe(
      JSON.stringify(["projectSessions", "summaries", "project-1"]),
    );
    expect(JSON.stringify(queryKeys.projectSessions.summaries(null))).toBe(
      JSON.stringify(["projectSessions", "summaries", ""]),
    );
    expect(JSON.stringify(queryKeys.projectSessions.detail("session-1"))).toBe(
      JSON.stringify(["projectSessions", "detail", "session-1"]),
    );
  });

  test("seeds and reads session detail", () => {
    const queryClient = createQueryClient();
    const session = createSession();

    seedProjectSessionDetail(queryClient, session);

    expect(getCachedProjectSessionDetail(queryClient, "session-1")).toBe(session);
    queryClient.clear();
  });

  test("seeding detail updates cached summary-visible fields", () => {
    const queryClient = createQueryClient();
    const initial = createSession({ displayTitle: "Old title", unread: true });
    const updated = createSession({ displayTitle: "New title", unread: false, updatedAt: "2026-01-02T00:00:00.000Z" });
    setProjectSessionSummaries(queryClient, "project-1", [projectSessionToSummary(initial)]);

    seedProjectSessionDetail(queryClient, updated);

    const window = queryClient.getQueryData<ProjectSessionSummaryWindow>(
      queryKeys.projectSessions.summaries("project-1"),
    );
    const summary = window?.items[0] ?? null;
    expect(summary?.displayTitle).toBe("New title");
    expect(summary?.unread).toBe(false);
    expect(summary?.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    queryClient.clear();
  });

  test("summary refresh replaces the identical domain detail shape", () => {
    const queryClient = createQueryClient();
    const detail = createSession({ displayTitle: "Stale title", order: 7 });
    seedProjectSessionDetail(queryClient, detail);
    const summary = projectSessionToSummary(createSession({
      displayTitle: "Current title",
      order: 2,
      updatedAt: "2026-01-02T00:00:00.000Z",
    }));

    setProjectSessionSummaries(queryClient, "project-1", [summary]);

    const cached = getCachedProjectSessionDetail(queryClient, detail.id);
    expect(cached?.displayTitle).toBe("Current title");
    expect(cached?.order).toBe(2);
    expect(cached).toEqual(summary);
    queryClient.clear();
  });

  test("archive and delete events evict cached detail", async () => {
    const queryClient = createQueryClient();
    const session = createSession();
    seedProjectSessionDetail(queryClient, session);

    await invalidateProjectSessionScope(queryClient, {
      summaryScopes: [{ kind: "project", projectId: "project-1" }],
      detailInvalidation: { kind: "sessions", sessionIds: ["session-1"] },
      changeType: "archive",
    });

    expect(getCachedProjectSessionDetail(queryClient, "session-1")).toBe(null);

    seedProjectSessionDetail(queryClient, session);
    await invalidateProjectSessionScope(queryClient, {
      summaryScopes: [{ kind: "project", projectId: "project-1" }],
      detailInvalidation: { kind: "sessions", sessionIds: ["session-1"] },
      changeType: "delete",
    });

    expect(getCachedProjectSessionDetail(queryClient, "session-1")).toBe(null);
    queryClient.clear();
  });

  test("full resync invalidates every cached session detail", async () => {
    const queryClient = createQueryClient();
    seedProjectSessionDetail(queryClient, createSession({ id: "session-1" }));
    seedProjectSessionDetail(queryClient, createSession({ id: "session-2" }));

    await invalidateProjectSessionScope(queryClient, {
      summaryScopes: [{ kind: "all" }],
      detailInvalidation: { kind: "all" },
      changeType: "update",
    });

    expect(queryClient.getQueryState(
      queryKeys.projectSessions.detail("session-1"),
    )?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(
      queryKeys.projectSessions.detail("session-2"),
    )?.isInvalidated).toBe(true);
    queryClient.clear();
  });

  test("session changes invalidate complete Project activity aggregates", async () => {
    const queryClient = createQueryClient();
    const activityKey = queryKeys.projectActivity.summaries(["project-2", "project-1"]);
    queryClient.setQueryData(activityKey, []);

    await invalidateProjectSessionScope(queryClient, {
      summaryScopes: [{ kind: "project", projectId: "project-1" }],
      detailInvalidation: { kind: "sessions", sessionIds: ["session-1"] },
      changeType: "update",
    });

    expect(queryClient.getQueryState(activityKey)?.isInvalidated).toBe(true);
    queryClient.clear();
  });
});
