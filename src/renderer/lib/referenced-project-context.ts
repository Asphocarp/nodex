import type { Project } from "./types";

export interface ReferencedProjectContext {
  readonly projectName: string;
  readonly projectWorkspacePath: string | null;
}

/** Resolves execution/asset context from the target, never the host Project. */
export const resolveReferencedProjectContext = (
  targetProjectId: string,
  projects: readonly Pick<Project, "id" | "name" | "primaryWorkspaceRoot">[],
): ReferencedProjectContext => {
  const target = projects.find((project) => project.id === targetProjectId);
  return {
    projectName: target?.name.trim() || targetProjectId,
    projectWorkspacePath: target?.primaryWorkspaceRoot ?? null,
  };
};
