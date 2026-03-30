import { useConversation } from "../local-conversation-store";
import { ReviewDiffPanel } from "@/components/workbench/review-diff-panel";

interface ConnectedReviewDiffPanelProps {
  threadId: string | null;
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
}

export function ConnectedReviewDiffPanel({
  threadId,
  projectWorkspacePath,
  searchOpenTick,
}: ConnectedReviewDiffPanelProps) {
  const conversation = useConversation(threadId);

  return (
    <ReviewDiffPanel
      conversation={conversation}
      projectWorkspacePath={projectWorkspacePath ?? null}
      searchOpenTick={searchOpenTick}
    />
  );
}
