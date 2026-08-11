import { ARCHIVED_CARD_OPTION_ID } from "./board-options";
import type { PageOccurrence, WorkflowStatus } from "./types";
import { COMPLETED_WORKFLOW_STATUS } from "../../shared/workflow-status";

export function resolveOccurrenceMutationStatus(
  columnId: string,
  occurrence?: Pick<PageOccurrence, "status"> | null,
): WorkflowStatus {
  if (columnId === ARCHIVED_CARD_OPTION_ID) {
    return occurrence?.status ?? COMPLETED_WORKFLOW_STATUS;
  }
  return columnId as WorkflowStatus;
}
