import { normalizeCodexManualThreadTitle } from "../shared/codex-thread-title";
import { ProjectSessionRenameInputSchema } from "../shared/schemas/project-sessions";
import type { ProjectSession, ProjectSessionRenameInput, ProjectSessionUpdateInput } from "../shared/types";

export interface ProjectSessionRenameServiceDeps {
  getProjectSession: (sessionId: string) => ProjectSession | null;
  updateProjectSession: (sessionId: string, input: ProjectSessionUpdateInput) => ProjectSession | null;
  setThreadName: (threadId: string, rawTitle: string) => Promise<boolean>;
  notifyProjectSessionsChanged: (projectId: string, changeType: "update", sessionId: string) => void;
}

export async function renameProjectSessionChat(
  sessionId: string,
  input: ProjectSessionRenameInput,
  deps: ProjectSessionRenameServiceDeps,
): Promise<ProjectSession | null> {
  const parsed = ProjectSessionRenameInputSchema.parse(input);
  const existing = deps.getProjectSession(sessionId);
  if (!existing) return null;
  if (existing.isOverview) {
    throw new Error("Overview session cannot be renamed");
  }

  const normalizedTitle = normalizeCodexManualThreadTitle(parsed.title);
  if (!normalizedTitle) {
    return existing;
  }

  if (existing.thread) {
    const renamedThread = await deps.setThreadName(existing.thread.threadId, parsed.title);
    if (!renamedThread) return existing;
  }

  const updated = deps.updateProjectSession(sessionId, { title: normalizedTitle });
  if (updated) {
    deps.notifyProjectSessionsChanged(updated.projectId, "update", updated.id);
  }
  return updated;
}
