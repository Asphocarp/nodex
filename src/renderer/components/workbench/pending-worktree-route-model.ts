import type {
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeThreadResolution,
} from "../../../shared/codex-pending-worktree";
import { canCreateCodexPendingWorktreeSetupRepair } from "../../../shared/codex-pending-worktree";
import type {
  CodexWorktreeInitActivity,
  CodexWorktreeInitActivityStatus,
} from "../../lib/codex-worktree-init-activity";

export interface PendingWorktreeRouteActions {
  canAutoFix: boolean;
  canCancel: boolean;
  canContinue: boolean;
  canEditEnvironment: boolean;
  canRetry: boolean;
  canWorkLocally: boolean;
}

function hasCreatedWorktree(entry: CodexPendingWorktreeEntry): boolean {
  return entry.worktreeGitRoot !== null && entry.worktreeWorkspaceRoot !== null;
}

function resolveWorktreeActivityStatus(
  entry: CodexPendingWorktreeEntry,
): CodexWorktreeInitActivityStatus {
  if (entry.phase === "queued" || entry.phase === "creating") return "running";
  if (entry.phase === "setting-up" || entry.phase === "worktree-ready") return "completed";
  return hasCreatedWorktree(entry) ? "completed" : "failed";
}

function resolveSetupActivityStatus(
  entry: CodexPendingWorktreeEntry,
): CodexWorktreeInitActivityStatus | null {
  if (entry.phase === "queued" || entry.phase === "creating") return null;
  if (entry.phase === "setting-up") return "running";

  if (entry.phase === "worktree-ready") {
    if (entry.localEnvironmentConfigPath === null || entry.localEnvironmentConfigPath === undefined) {
      return null;
    }
    return entry.errorMessage === null ? "completed" : "skipped";
  }

  return hasCreatedWorktree(entry) ? "failed" : null;
}

export function resolvePendingWorktreeActivities(
  entry: CodexPendingWorktreeEntry,
  resolution: CodexPendingWorktreeThreadResolution | null,
): CodexWorktreeInitActivity[] {
  const activities: CodexWorktreeInitActivity[] = [
    {
      id: `${entry.id}:${entry.attempt}:worktree`,
      kind: "worktree",
      status: resolveWorktreeActivityStatus(entry),
      outputText: entry.worktreeOutputText,
    },
  ];

  const setupStatus = resolveSetupActivityStatus(entry);
  if (setupStatus) {
    activities.push({
      id: `${entry.id}:${entry.attempt}:setup`,
      kind: "setup",
      status: setupStatus,
      outputText: entry.setupOutputText,
    });
  }

  if (entry.phase === "worktree-ready" && resolution?.state === "failed") {
    activities.push({
      id: `${entry.id}:${entry.attempt}:conversation`,
      kind: "conversation",
      status: "failed",
      outputText: "",
    });
  } else if (entry.phase === "worktree-ready" && resolution?.state === "waiting") {
    activities.push({
      id: `${entry.id}:${entry.attempt}:conversation`,
      kind: "conversation",
      status: "running",
      outputText: "",
    });
  }

  return activities;
}

export function resolvePendingWorktreeRouteActions(
  entry: CodexPendingWorktreeEntry,
  resolution: CodexPendingWorktreeThreadResolution | null,
): PendingWorktreeRouteActions {
  const worktreeIsActive = entry.phase === "queued"
    || entry.phase === "creating"
    || entry.phase === "setting-up";
  const worktreeFailed = entry.phase === "failed";
  const conversationFailed = resolution?.state === "failed";

  return {
    canAutoFix: canCreateCodexPendingWorktreeSetupRepair(entry),
    canCancel: worktreeIsActive,
    canContinue: worktreeFailed && hasCreatedWorktree(entry),
    canEditEnvironment: worktreeFailed,
    canRetry: worktreeFailed || conversationFailed,
    canWorkLocally: worktreeIsActive,
  };
}
