import { normalizeCodexManualThreadTitle } from "../shared/codex-thread-title";
import { ProjectSessionRenameInputSchema } from "../shared/schemas/project-sessions";
import type { ProjectSession, ProjectSessionRenameInput } from "../shared/types";

export interface ProjectSessionRenameServiceDeps {
  getProjectSession: (sessionId: string) => ProjectSession | null | Promise<ProjectSession | null>;
  renameProjectSession: (
    sessionId: string,
    input: ProjectSessionRenameInput,
  ) => ProjectSession | null | Promise<ProjectSession | null>;
  setThreadName: (threadId: string, rawTitle: string) => Promise<boolean>;
}

export async function renameProjectSessionChat(
  sessionId: string,
  input: ProjectSessionRenameInput,
  deps: ProjectSessionRenameServiceDeps,
): Promise<ProjectSession | null> {
  const parsed = ProjectSessionRenameInputSchema.parse(input);
  const existing = await deps.getProjectSession(sessionId);
  if (!existing) return null;

  const normalizedTitle = normalizeCodexManualThreadTitle(parsed.title);
  if (!normalizedTitle) {
    return existing;
  }

  if (existing.thread) {
    const renamedThread = await deps.setThreadName(existing.thread.threadId, parsed.title);
    if (!renamedThread) return existing;
    return (
      (await deps.renameProjectSession(sessionId, {
        title: normalizedTitle,
      })) ?? existing
    );
  }

  return await deps.renameProjectSession(sessionId, {
    title: normalizedTitle,
  });
}
