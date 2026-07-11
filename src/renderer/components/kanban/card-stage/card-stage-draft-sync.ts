import type { Card, CardInput } from "@/lib/types";

export interface CardStageTextDraftState {
  assignee: string;
  agentStatus: string;
}

export function buildCardStageDraftOverlay(
  card: Pick<Card, "assignee" | "agentStatus">,
  draft: CardStageTextDraftState,
): Pick<Partial<CardInput>, "assignee" | "agentStatus"> {
  const overlay: Pick<Partial<CardInput>, "assignee" | "agentStatus"> = {};

  if (draft.assignee !== (card.assignee ?? "")) {
    overlay.assignee = draft.assignee;
  }
  if (draft.agentStatus !== (card.agentStatus ?? "")) {
    overlay.agentStatus = draft.agentStatus;
  }

  return overlay;
}
