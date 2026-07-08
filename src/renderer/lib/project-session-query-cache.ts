import type { QueryClient } from "@tanstack/react-query";
import type { ProjectSessionsChangeEvent } from "../../shared/ipc-api";
import type { ProjectSession, ProjectSessionSummary } from "./types";
import { projectSessionDetailQueryOptions } from "./query-options";
import { queryKeys } from "./query-keys";

function sortProjectSessionSummariesForSidebar(summaries: ProjectSessionSummary[]): ProjectSessionSummary[] {
  return [...summaries].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    if (left.pinned && right.pinned) {
      const leftPinnedOrder = left.pinnedOrder ?? Number.MAX_SAFE_INTEGER;
      const rightPinnedOrder = right.pinnedOrder ?? Number.MAX_SAFE_INTEGER;
      if (leftPinnedOrder !== rightPinnedOrder) return leftPinnedOrder - rightPinnedOrder;
    }
    if (left.order !== right.order) return left.order - right.order;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function projectSessionToSummary(session: ProjectSession): ProjectSessionSummary {
  return {
    id: session.id,
    projectId: session.projectId,
    noThreadFallbackTitle: session.noThreadFallbackTitle,
    displayTitle: session.displayTitle,
    order: session.order,
    pinned: session.pinned,
    pinnedOrder: session.pinnedOrder,
    archived: session.archived,
    archivedAt: session.archivedAt,
    unread: session.unread,
    leftPaneCollapsed: session.leftPaneCollapsed,
    thread: session.thread,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function getCachedProjectSessionDetail(
  queryClient: QueryClient,
  sessionId: string,
): ProjectSession | null {
  return queryClient.getQueryData<ProjectSession | null>(queryKeys.projectSessions.detail(sessionId)) ?? null;
}

export function setProjectSessionSummaries(
  queryClient: QueryClient,
  projectId: string | null,
  summaries: readonly ProjectSessionSummary[],
): void {
  queryClient.setQueryData(
    queryKeys.projectSessions.summaries(projectId),
    sortProjectSessionSummariesForSidebar([...summaries]),
  );
}

export function seedProjectSessionDetail(
  queryClient: QueryClient,
  session: ProjectSession | null | undefined,
): void {
  if (!session) return;

  queryClient.setQueryData(queryKeys.projectSessions.detail(session.id), session);
  const summary = projectSessionToSummary(session);
  queryClient.setQueryData<ProjectSessionSummary[] | undefined>(
    queryKeys.projectSessions.summaries(session.projectId),
    (current) => {
      if (!current) return current;
      const next = current.some((candidate) => candidate.id === summary.id)
        ? current.map((candidate) => candidate.id === summary.id ? summary : candidate)
        : [...current, summary];
      return sortProjectSessionSummariesForSidebar(next);
    },
  );
}

export function seedProjectSessionDetails(
  queryClient: QueryClient,
  sessions: readonly ProjectSession[],
): void {
  for (const session of sessions) {
    seedProjectSessionDetail(queryClient, session);
  }
}

export async function prefetchProjectSessionDetail(
  queryClient: QueryClient,
  sessionId: string,
): Promise<ProjectSession | null> {
  if (sessionId.trim().length === 0) return null;
  return await queryClient.fetchQuery(projectSessionDetailQueryOptions(sessionId));
}

export async function invalidateProjectSessionScope(
  queryClient: QueryClient,
  event: ProjectSessionsChangeEvent,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.projectSessions.summaries(event.projectId),
    exact: true,
  });

  if (!event.sessionId) return;

  if (event.changeType === "delete" || event.changeType === "archive") {
    queryClient.removeQueries({
      queryKey: queryKeys.projectSessions.detail(event.sessionId),
      exact: true,
    });
    return;
  }

  await queryClient.invalidateQueries({
    queryKey: queryKeys.projectSessions.detail(event.sessionId),
    exact: true,
  });
}
