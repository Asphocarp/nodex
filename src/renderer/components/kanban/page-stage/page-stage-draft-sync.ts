import type { DatabasePage, PageInput } from "@/lib/types";

export interface PageStageTextDraftState {
  assignee: string;
}

export function buildPageStageDraftOverlay(
  page: Pick<DatabasePage, "assignee">,
  draft: PageStageTextDraftState,
): Pick<Partial<PageInput>, "assignee"> {
  const overlay: Pick<Partial<PageInput>, "assignee"> = {};

  if (draft.assignee !== (page.assignee ?? "")) {
    overlay.assignee = draft.assignee;
  }
  return overlay;
}
