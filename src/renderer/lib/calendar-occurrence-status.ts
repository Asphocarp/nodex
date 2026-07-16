import { ARCHIVED_CARD_OPTION_ID } from "./kanban-options";
import type { PageOccurrence, WorkflowStatus } from "./types";

export function resolveOccurrenceMutationStatus(
  columnId: string,
  occurrence?: Pick<PageOccurrence, "status"> | null,
): WorkflowStatus {
  if (columnId === ARCHIVED_CARD_OPTION_ID) {
    return occurrence?.status ?? "done";
  }
  return columnId as WorkflowStatus;
}
