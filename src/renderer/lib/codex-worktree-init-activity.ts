export type CodexWorktreeInitActivityKind = "worktree" | "setup" | "conversation";

export type CodexWorktreeInitActivityStatus =
  | "running"
  | "completed"
  | "skipped"
  | "failed";

export interface CodexWorktreeInitActivity {
  id: string;
  kind: CodexWorktreeInitActivityKind;
  status: CodexWorktreeInitActivityStatus;
  outputText: string;
}

export function codexWorktreeInitActivityLabel(
  activity: CodexWorktreeInitActivity,
): string {
  if (activity.kind === "worktree") {
    if (activity.status === "running") return "Creating a worktree";
    if (activity.status === "failed") return "Failed to create worktree";
    return "Worktree created";
  }

  if (activity.kind === "setup") {
    if (activity.status === "running") return "Setting up the environment";
    if (activity.status === "completed") return "Environment set up";
    if (activity.status === "skipped") return "Environment setup skipped";
    return "Failed to set up the environment";
  }

  return activity.status === "failed"
    ? "Failed to start the conversation"
    : "Starting the conversation";
}
