import type { PageRunInTarget } from "./types";
import type { CodexPendingWorktreeStartingState } from "../../shared/codex-pending-worktree";

export type NewChatStartInIconKey =
  | "local"
  | "worktree"
  | "codexWeb"
  | "cloud"
  | "usage"
  | "external";

export interface NewChatStartInTarget {
  runInTarget: PageRunInTarget;
  runInEnvironmentPath?: string | null;
  worktreeStartingState?: CodexPendingWorktreeStartingState;
}

export interface NewChatStartInOption {
  value: PageRunInTarget;
  label: string;
  iconKey: NewChatStartInIconKey;
  disabled: boolean;
  selected: boolean;
  tooltipText: string | null;
}

export interface ResolveNewChatStartInOptionsInput {
  selectedRunInTarget: PageRunInTarget | null | undefined;
  worktreeAvailable: boolean;
  cloudAvailable?: boolean;
}

export function normalizeNewChatStartInTarget(
  value: PageRunInTarget | null | undefined,
): PageRunInTarget {
  if (value === "newWorktree" || value === "cloud") return value;
  return "localProject";
}

export function getNewChatStartInTriggerLabel(target: PageRunInTarget | null | undefined): string {
  const normalized = normalizeNewChatStartInTarget(target);
  if (normalized === "newWorktree") return "New worktree";
  if (normalized === "cloud") return "Send to cloud";
  return "Work locally";
}

export function getNewChatStartInTriggerIconKey(
  target: PageRunInTarget | null | undefined,
): NewChatStartInIconKey {
  const normalized = normalizeNewChatStartInTarget(target);
  if (normalized === "newWorktree") return "worktree";
  if (normalized === "cloud") return "cloud";
  return "local";
}

export function resolveNewChatStartInOptions(
  input: ResolveNewChatStartInOptionsInput,
): NewChatStartInOption[] {
  const selected = normalizeNewChatStartInTarget(input.selectedRunInTarget);
  const cloudAvailable = input.cloudAvailable === true;

  return [
    {
      value: "localProject",
      label: "Local",
      iconKey: "local",
      disabled: false,
      selected: selected === "localProject",
      tooltipText: null,
    },
    {
      value: "newWorktree",
      label: "New worktree",
      iconKey: "worktree",
      disabled: !input.worktreeAvailable,
      selected: selected === "newWorktree",
      tooltipText: input.worktreeAvailable
        ? null
        : "Initialize a git repo to run tasks in worktrees",
    },
    {
      value: "cloud",
      label: cloudAvailable ? "Cloud" : "Send to cloud",
      iconKey: "cloud",
      disabled: !cloudAvailable,
      selected: selected === "cloud",
      tooltipText: cloudAvailable ? null : "Cloud run target is not available in Nodex yet",
    },
  ];
}
