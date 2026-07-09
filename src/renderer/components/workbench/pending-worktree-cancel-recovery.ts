import {
  extractCodexUserRequestSection,
  type CodexPendingWorktreeEntry,
} from "../../../shared/codex-pending-worktree";
import type { CodexComposerIntent } from "../../../shared/types";

export function resolveCancelledPendingWorktreeProjectId(
  entry: CodexPendingWorktreeEntry,
  existingProjectIds: ReadonlySet<string>,
): string | null {
  const projectId = entry.launchMode === "start-conversation"
    ? entry.startConversationParamsInput.projectAssignment?.projectId ?? null
    : entry.launchMode === "fork-conversation"
      ? entry.projectAssignment?.projectId ?? null
      : null;
  return projectId !== null && existingProjectIds.has(projectId) ? projectId : null;
}

export function buildCancelledPendingWorktreeComposerIntent(
  entry: CodexPendingWorktreeEntry,
  focusNonce: number,
): CodexComposerIntent {
  const prompt = extractCodexUserRequestSection(entry.prompt).trim();
  const commentAttachments = entry.launchMode === "start-conversation"
    ? entry.startConversationParamsInput.commentAttachments
    : [];

  return {
    prompt,
    focusNonce,
    ...(commentAttachments.length > 0
      ? {
          promptInput: {
            text: prompt,
            commentAttachments: [...commentAttachments],
          },
        }
      : {}),
  };
}
