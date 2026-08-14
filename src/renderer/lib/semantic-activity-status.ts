export type SemanticActivityStatus =
  | "pending"
  | "running"
  | "completed"
  | "skipped"
  | "failed";

const SEMANTIC_ACTIVITY_TEXT_CLASS_NAMES: Readonly<Record<SemanticActivityStatus, string>> = {
  pending: "text-tertiary",
  running: "text-info",
  completed: "text-info",
  skipped: "text-info",
  failed: "text-danger",
};

const SEMANTIC_ACTIVITY_SUMMARY_CLASS_NAMES: Readonly<Record<SemanticActivityStatus, string>> = {
  pending: "text-tertiary",
  running: "text-info",
  completed: "semantic-text-secondary",
  skipped: "semantic-text-secondary",
  failed: "text-danger",
};

export const semanticActivityTextClassName = (status: SemanticActivityStatus): string =>
  SEMANTIC_ACTIVITY_TEXT_CLASS_NAMES[status];

export const semanticActivitySummaryClassName = (status: SemanticActivityStatus): string =>
  SEMANTIC_ACTIVITY_SUMMARY_CLASS_NAMES[status];

/** Maps protocol/view lifecycle words into the small visual status vocabulary. */
export const semanticActivityStatusFromLifecycle = (
  status: string | null | undefined,
  fallback: SemanticActivityStatus,
): SemanticActivityStatus => {
  if (status === "inProgress" || status === "running" || status === "streaming") return "running";
  if (status === "pending") return "pending";
  if (
    status === "failed"
    || status === "declined"
    || status === "error"
    || status === "rejected"
  ) return "failed";
  if (status === "interrupted" || status === "stopped" || status === "skipped") return "skipped";
  if (
    status === "completed"
    || status === "done"
    || status === "updated"
    || status === "applied"
  ) return "completed";
  return fallback;
};
