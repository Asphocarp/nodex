import { useConversation } from "../local-conversation-store";
import { ReviewDiffPanel } from "@/components/workbench/review-diff-panel";
import type { CodexConversationSnapshot, CodexTurnDiffReviewTarget } from "@/lib/types";

interface ConnectedReviewDiffPanelProps {
  threadId: string | null;
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
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

  const rawItem = item.rawItem as { unifiedDiff?: unknown; cwd?: unknown; showRevertButton?: unknown };
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
  };
}

export function ConnectedReviewDiffPanel({
  threadId,
  projectWorkspacePath,
  searchOpenTick,
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
      projectWorkspacePath={projectWorkspacePath ?? null}
      selectedTurnDiff={refreshedSelectedTurnDiff}
      searchOpenTick={searchOpenTick}
    />
  );
}

export const connectedReviewDiffPanelTestHelpers = {
  refreshSelectedTurnDiffTarget,
};
