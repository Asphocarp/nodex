import type { ProjectSession } from "../../shared/types";

export interface ProjectAgentDockMaterializationPort {
  readonly createBlank: (projectId: string) => Promise<ProjectSession>;
  readonly promoteDraftIdentity: (input: {
    readonly draftId: string;
    readonly sessionId: string;
  }) => void;
  readonly commitMaterializedSession: (input: {
    readonly projectId: string;
    readonly draftId: string;
    readonly sessionId: string;
  }) => void;
}

export interface ProjectAgentDockMaterializer {
  readonly materialize: (
    input: {
      readonly projectId: string;
      readonly draftId: string;
    },
    port: ProjectAgentDockMaterializationPort,
  ) => Promise<ProjectSession>;
}

function draftKey(projectId: string, draftId: string): string {
  return `${projectId}\u0000${draftId}`;
}

/**
 * Owns the one-way Project draft -> Session transition for one Window Session.
 * Successful results remain memoized because a Scene draft id is never reused;
 * this also makes repeated submit events unable to create a second Session.
 */
export function createProjectAgentDockMaterializer(): ProjectAgentDockMaterializer {
  const materializations = new Map<string, Promise<ProjectSession>>();

  return {
    materialize(input, port) {
      const key = draftKey(input.projectId, input.draftId);
      const current = materializations.get(key);
      if (current) return current;

      const materialization = port.createBlank(input.projectId)
        .then((session) => {
          if (session.projectId !== input.projectId) {
            throw new Error("Created chat does not belong to the Project Agent Dock");
          }
          port.promoteDraftIdentity({
            draftId: input.draftId,
            sessionId: session.id,
          });
          port.commitMaterializedSession({
            projectId: input.projectId,
            draftId: input.draftId,
            sessionId: session.id,
          });
          return session;
        })
        .catch((error: unknown) => {
          materializations.delete(key);
          throw error;
        });
      materializations.set(key, materialization);
      return materialization;
    },
  };
}

export function createProjectAgentDockDraftSession(
  projectId: string,
  draftId: string,
): ProjectSession {
  const timestamp = new Date(0).toISOString();
  return {
    id: `project-draft:${draftId}`,
    projectId,
    noThreadFallbackTitle: "New chat",
    displayTitle: "New chat",
    order: Number.MAX_SAFE_INTEGER,
    pinned: false,
    pinnedOrder: null,
    archived: false,
    archivedAt: null,
    unread: false,
    thread: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
