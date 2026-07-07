import type { PanelId, CodexConversationSnapshot } from "../../../lib/types";
import type { ThreadSummaryPanelAuxiliaryRow } from "../thread-stage-types";

export interface ThreadSummaryPanelSideChatRowInput {
  id: string;
  title: string;
  threadId: string | null;
  panelId?: PanelId;
  leafId?: string | null;
}

export function buildThreadSummaryPanelSideChatRow(
  input: ThreadSummaryPanelSideChatRowInput,
  conversation: Pick<CodexConversationSnapshot, "statusType" | "statusActiveFlags" | "turns"> | null | undefined,
): ThreadSummaryPanelAuxiliaryRow {
  return {
    id: input.id,
    title: input.title,
    isResponseInProgress: isThreadSummarySideChatResponseInProgress(conversation),
    panelId: input.panelId,
    leafId: input.leafId ?? null,
  };
}

export function isThreadSummarySideChatResponseInProgress(
  conversation: Pick<CodexConversationSnapshot, "statusType" | "statusActiveFlags" | "turns"> | null | undefined,
): boolean {
  if (!conversation) return false;
  if (conversation.statusType === "active") return true;
  if (conversation.statusActiveFlags.length > 0) return true;
  return conversation.turns.some((turn) => turn.status === "inProgress");
}
