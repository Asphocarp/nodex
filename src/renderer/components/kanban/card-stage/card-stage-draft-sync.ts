import type { Card, CardInput } from "@/lib/types";

export interface CardStageTextDraftState {
  assignee: string;
}

export function buildCardStageDraftOverlay(
  card: Pick<Card, "assignee">,
  draft: CardStageTextDraftState,
): Pick<Partial<CardInput>, "assignee"> {
  const overlay: Pick<Partial<CardInput>, "assignee"> = {};

  if (draft.assignee !== (card.assignee ?? "")) {
    overlay.assignee = draft.assignee;
  }
  return overlay;
}
