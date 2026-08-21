import type { DatabaseViewGroupsSnapshot } from "../../../src/shared/database-views";
import { WORKFLOW_STATUS_ORDER, type WorkflowStatus } from "../../../src/shared/workflow-status";

export const normalizeScenarioBoardGroups = (
  snapshot: DatabaseViewGroupsSnapshot,
): Readonly<Record<WorkflowStatus, number>> => {
  const groups = Object.fromEntries(WORKFLOW_STATUS_ORDER.map((status) => [status, 0])) as Record<
    WorkflowStatus,
    number
  >;
  for (const group of snapshot.groups) {
    if (
      group.subgroupKey === null &&
      group.groupKey &&
      WORKFLOW_STATUS_ORDER.includes(group.groupKey as WorkflowStatus)
    ) {
      groups[group.groupKey as WorkflowStatus] = group.totalRows;
    }
  }
  return groups;
};
