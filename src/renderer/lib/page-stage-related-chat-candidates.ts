import type { PageStageRelatedChatCandidate } from "@/components/board/page-stage/types";
import type { Project, ProjectSession } from "./types";

/** Presents the loaded Chat catalog without leaking Workbench Scene state into Page Stage. */
export function presentPageStageRelatedChatCandidates(
  sessions: readonly ProjectSession[],
  projects: readonly Project[],
): PageStageRelatedChatCandidate[] {
  const projectNames = new Map(projects.map((project) => [project.id, project.name.trim()]));
  return sessions.flatMap((session) => {
    if (session.archived) return [];
    const displayTitle =
      session.displayTitle.trim() || session.noThreadFallbackTitle.trim() || "New chat";
    return [
      {
        sessionId: session.id,
        displayTitle,
        projectName: session.projectId ? projectNames.get(session.projectId) || null : null,
      },
    ];
  });
}
