import type {
  ProjectCatalogChangeKind,
} from "../../shared/core-modules/project-workspace-module";
import type {
  ProjectSessionsChangeEvent,
  ProjectsChangeEvent,
} from "../../shared/ipc-api";
import type { CoreProjectWorkspaceInvalidation } from "./desktop-project-workspace-bridge";

const projectChangeType = (
  kind: ProjectCatalogChangeKind,
): ProjectsChangeEvent["changeType"] => {
  switch (kind) {
    case "created": return "create";
    case "metadata_updated": return "metadata";
    case "sources_updated": return "sources";
    case "lifecycle_updated": return "lifecycle";
    case "reordered": return "reorder";
    case "pin_updated": return "pin";
  }
};

export interface CoreWorkspaceNotificationPlan {
  readonly project?: ProjectsChangeEvent;
  readonly sessions?: ProjectSessionsChangeEvent;
  readonly invalidateStandaloneRoots: boolean;
}

export function planCoreWorkspaceNotifications(
  event: CoreProjectWorkspaceInvalidation,
): CoreWorkspaceNotificationPlan {
  const project = event.projectCatalogChange
    ? {
        changeType: projectChangeType(event.projectCatalogChange),
        ...(event.projectIds.length === 1
          ? { projectId: event.projectIds[0] }
          : {}),
      }
    : undefined;
  const sessions = event.sessionSummaryScopes.length > 0
    || event.sessionDetailIds.length > 0
    ? {
        summaryScopes: event.sessionSummaryScopes,
        detailInvalidation: {
          kind: "sessions" as const,
          sessionIds: event.sessionDetailIds,
        },
        changeType: "update" as const,
      }
    : undefined;
  const invalidateStandaloneRoots = event.projectCatalogChange === "created"
    || event.projectCatalogChange === "lifecycle_updated";
  return { project, sessions, invalidateStandaloneRoots };
}

export const allProjectSessionInvalidation = (): ProjectSessionsChangeEvent => ({
  summaryScopes: [{ kind: "all" }],
  detailInvalidation: { kind: "all" },
  changeType: "update",
});
