import { useConversation } from "../local-conversation-store";
import { ReviewDiffPanel } from "@/components/workbench/review-diff-panel";
import type { CodexTurnDiffReviewTarget } from "@/lib/types";

interface ConnectedReviewDiffPanelProps {
  threadId: string | null;
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
  selectedTurnDiff?: CodexTurnDiffReviewTarget | null;
}

export function ConnectedReviewDiffPanel({
  threadId,
  projectWorkspacePath,
  searchOpenTick,
  selectedTurnDiff = null,
}: ConnectedReviewDiffPanelProps) {
  const conversation = useConversation(threadId);

  return (
    <ReviewDiffPanel
      conversation={conversation}
      projectWorkspacePath={projectWorkspacePath ?? null}
      selectedTurnDiff={selectedTurnDiff}
      searchOpenTick={searchOpenTick}
    />
  );
}
