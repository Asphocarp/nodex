import type { ProjectSessionThreadSummary } from "../../shared/types";

export type ThreadStatusDisplayLabel =
  | "Error"
  | "Approval"
  | "Waiting"
  | "Running"
  | "Ready"
  | "Archived"
  | "Thread";

export function resolveThreadStatusDisplayLabel(
  thread: Pick<
    ProjectSessionThreadSummary,
    "archived" | "statusActiveFlags" | "statusType"
  >,
): ThreadStatusDisplayLabel {
  if (thread.archived) return "Archived";
  if (thread.statusType === "systemError") return "Error";
  if (thread.statusActiveFlags.includes("waitingOnApproval")) {
    return "Approval";
  }
  if (thread.statusActiveFlags.includes("waitingOnUserInput")) {
    return "Waiting";
  }
  if (thread.statusType === "active") return "Running";
  if (thread.statusType === "idle") return "Ready";
  return "Thread";
}
