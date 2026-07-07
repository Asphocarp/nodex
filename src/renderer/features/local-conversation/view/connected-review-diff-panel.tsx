import { useConversation } from "../local-conversation-store";
import { ReviewDiffPanel } from "@/components/workbench/review-diff-panel";
import type { CodexConversationSnapshot, GitReviewSource, CodexTurnDiffReviewTarget } from "@/lib/types";

interface ConnectedReviewDiffPanelProps {
  threadId: string | null;
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
  initialGitSource?: GitReviewSource | null;
  initialGitSourceRequestKey?: number | null;
  selectedTurnDiff?: CodexTurnDiffReviewTarget | null;
}

function refreshSelectedTurnDiffTarget(
  selectedTurnDiff: CodexTurnDiffReviewTarget | null,
  conversation: CodexConversationSnapshot | null,
  projectWorkspacePath: string | null,
): CodexTurnDiffReviewTarget | null {
  if (!selectedTurnDiff || !conversation) return selectedTurnDiff;

  const turn = conversation.turns.find((candidate) => candidate.turnId === selectedTurnDiff.turnId);
  const item = turn?.items.find((candidate) => (candidate.entryId ?? candidate.itemId) === selectedTurnDiff.entryId);
  if (!item || item.rawItem === null || typeof item.rawItem !== "object") return selectedTurnDiff;

  const rawItem = item.rawItem as {
    unifiedDiff?: unknown;
    cwd?: unknown;
    showRevertButton?: unknown;
    patchBatches?: unknown;
  };
  if (typeof rawItem.unifiedDiff !== "string" || rawItem.unifiedDiff.trim().length === 0) {
    return selectedTurnDiff;
  }

  const cwd = typeof rawItem.cwd === "string" && rawItem.cwd.trim().length > 0
    ? rawItem.cwd
    : selectedTurnDiff.cwd ?? conversation.cwd ?? projectWorkspacePath;

  return {
    ...selectedTurnDiff,
    patch: rawItem.unifiedDiff,
    cwd: cwd ?? null,
    showRevertButton: rawItem.showRevertButton === true,
    patchBatches: Array.isArray(rawItem.patchBatches)
      ? rawItem.patchBatches.flatMap((batch) => {
          if (typeof batch !== "object" || batch === null) return [];
          const batchCwd = (batch as { cwd?: unknown }).cwd;
          const changes = (batch as { changes?: unknown }).changes;
          return [{
            cwd: typeof batchCwd === "string" && batchCwd.trim().length > 0 ? batchCwd : null,
            changes: Array.isArray(changes) ? changes : [],
          }];
        })
      : selectedTurnDiff.patchBatches,
  };
}

export function ConnectedReviewDiffPanel({
  threadId,
  projectWorkspacePath,
  searchOpenTick,
  initialGitSource = null,
  initialGitSourceRequestKey = null,
  selectedTurnDiff = null,
}: ConnectedReviewDiffPanelProps) {
  const conversation = useConversation(threadId);
  const refreshedSelectedTurnDiff = refreshSelectedTurnDiffTarget(
    selectedTurnDiff,
    conversation,
    projectWorkspacePath ?? null,
  );

  return (
    <ReviewDiffPanel
      conversation={conversation}
      threadId={threadId}
      projectWorkspacePath={projectWorkspacePath ?? null}
      initialSource={initialGitSource ?? undefined}
      initialSourceRequestKey={initialGitSourceRequestKey}
      selectedTurnDiff={refreshedSelectedTurnDiff}
      searchOpenTick={searchOpenTick}
    />
  );
}

export const connectedReviewDiffPanelTestHelpers = {
  refreshSelectedTurnDiffTarget,
};
