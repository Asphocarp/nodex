import type {
  CodexManagedWorktreeRemovalReason,
  CodexManagedWorktreeSnapshotPolicy,
} from "./codex-worktree-worker-port";

export function snapshotPolicyForManagedWorktreeRemoval(
  reason: CodexManagedWorktreeRemovalReason,
): CodexManagedWorktreeSnapshotPolicy {
  switch (reason) {
    case "archive":
    case "automatic-retention":
    case "automation-archive":
    case "handoff":
      return "required";
    case "settings-delete":
      return "best-effort";
    case "failed-create":
    case "retry":
    case "cancel":
      return "ephemeral";
  }
}
