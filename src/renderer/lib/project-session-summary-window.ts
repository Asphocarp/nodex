import type { ProjectSessionSummaryWindow } from "./types";

/**
 * Canonical windows are monotonic by projection revision and, within one
 * revision, by loaded extent. A background first-page request must not trim
 * pages that the user has already loaded from the same snapshot.
 */
export function preferNewestProjectSessionSummaryWindow(
  current: ProjectSessionSummaryWindow | undefined,
  incoming: ProjectSessionSummaryWindow,
): ProjectSessionSummaryWindow {
  if (!current) return incoming;
  if (current.projectionRevision > incoming.projectionRevision) {
    return current;
  }
  if (
    current.projectionRevision === incoming.projectionRevision &&
    current.items.length > incoming.items.length &&
    (incoming.hasMore || incoming.nextCursor !== null)
  ) {
    return current;
  }
  return incoming;
}
