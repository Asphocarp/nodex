import type {
  CodexFileChangeMap,
  CodexFileChangeView,
  CodexItemStatus,
  CodexVisualizationActivity,
} from "./types";
import {
  getCodexFileChangeEntries,
  resolveCodexPatchSuccess,
} from "./codex-file-change";

export type CodexFileChangeActivityVisibility = "active" | "terminal" | "suppressed";
export type CodexFileChangeActivityLifecycle = "inProgress" | "completed" | "failed" | "cancelled";

export interface CodexFileChangeActivityView {
  visibility: CodexFileChangeActivityVisibility;
  lifecycle: CodexFileChangeActivityLifecycle;
  success: boolean | null;
  hasMaterializedChanges: boolean;
  changes: CodexFileChangeMap;
  visualizationActivities: readonly CodexVisualizationActivity[];
  displayPaths: readonly string[];
  canExpandBody: boolean;
}

export function resolveCodexFileChangeActivity(input: {
  status?: CodexItemStatus;
  fileChange?: CodexFileChangeView | null;
  hasToolError?: boolean;
}): CodexFileChangeActivityView {
  const status = input.status ?? "completed";
  const changes = input.fileChange?.changes ?? {};
  const visualizationActivities = input.fileChange?.visualizationActivities ?? [];
  const hasMaterializedChanges = getCodexFileChangeEntries(changes).length > 0;
  const hasTerminalContent = hasMaterializedChanges
    || visualizationActivities.length > 0
    || input.hasToolError === true;
  const success = input.status ? resolveCodexPatchSuccess(input.status) : null;
  const lifecycle = resolveLifecycle(status);

  return {
    visibility: !hasTerminalContent
      ? "suppressed"
      : status === "inProgress"
        ? "active"
        : "terminal",
    lifecycle,
    success,
    hasMaterializedChanges,
    changes,
    visualizationActivities,
    displayPaths: [
      ...getCodexFileChangeEntries(changes).map(([path]) => path),
      ...visualizationActivities.map((activity) => activity.path),
    ],
    canExpandBody: hasMaterializedChanges || visualizationActivities.length > 0,
  };
}

function resolveLifecycle(status: CodexItemStatus): CodexFileChangeActivityLifecycle {
  if (status === "inProgress") return "inProgress";
  if (status === "completed") return "completed";
  if (status === "interrupted") return "cancelled";
  return "failed";
}
