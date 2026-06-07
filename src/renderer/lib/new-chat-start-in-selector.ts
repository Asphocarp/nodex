import type { CardRunInTarget } from "./types";

export type NewChatStartInIconKey = "local" | "worktree" | "codexWeb" | "cloud" | "usage" | "external";

export interface NewChatStartInTarget {
  runInTarget: CardRunInTarget;
  runInEnvironmentPath?: string | null;
  worktreeStartMode?: "autoBranch" | "detachedHead";
  worktreeBranchPrefix?: string | null;
}

export interface NewChatStartInOption {
  value: CardRunInTarget;
  label: string;
  iconKey: NewChatStartInIconKey;
  disabled: boolean;
  selected: boolean;
  tooltipText: string | null;
}

export interface ResolveNewChatStartInOptionsInput {
  selectedRunInTarget: CardRunInTarget | null | undefined;
  worktreeAvailable: boolean;
  cloudAvailable?: boolean;
}

export function normalizeNewChatStartInTarget(
  value: CardRunInTarget | null | undefined,
): CardRunInTarget {
  if (value === "newWorktree" || value === "cloud") return value;
  return "localProject";
}

export function getNewChatStartInTriggerLabel(target: CardRunInTarget | null | undefined): string {
  const normalized = normalizeNewChatStartInTarget(target);
  if (normalized === "newWorktree") return "New worktree";
  if (normalized === "cloud") return "Send to cloud";
  return "Work locally";
}

export function getNewChatStartInTriggerIconKey(
  target: CardRunInTarget | null | undefined,
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
      label: "Work locally",
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
