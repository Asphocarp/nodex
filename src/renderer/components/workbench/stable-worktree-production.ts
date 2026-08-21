import type {
  CodexPendingWorktreeCreateInput,
  CodexPendingWorktreeEntry,
} from "../../../shared/codex-pending-worktree";

export const STABLE_WORKTREE_CREATE_PROMPT =
  "Create a new git worktree from HEAD, add it as a project, and keep it until you remove it";

export type StableWorktreeEntry = Extract<
  CodexPendingWorktreeEntry,
  { readonly launchMode: "create-stable-worktree" }
>;

export function suggestStableWorktreeProjectName({
  base,
  workspaceRootOptions,
  workspaceRootLabels,
}: {
  base: string;
  workspaceRootOptions?: readonly string[];
  workspaceRootLabels?: Readonly<Record<string, string | undefined>>;
}): string {
  const normalizedBase = base.trim();
  if (!normalizedBase) return "Workspace_2";

  const occupiedNames = new Set<string>();
  for (const workspaceRoot of workspaceRootOptions ?? []) {
    const label = workspaceRootLabels?.[workspaceRoot]?.trim();
    if (label) {
      occupiedNames.add(label);
      continue;
    }

    const folderName = workspaceRoot
      .split(/[/\\]+/)
      .filter(Boolean)
      .at(-1)
      ?.trim();
    if (folderName) occupiedNames.add(folderName);
  }

  for (let suffix = 2; suffix <= 9_999; suffix += 1) {
    const candidate = `${normalizedBase}_${suffix}`;
    if (!occupiedNames.has(candidate)) return candidate;
  }
  return `${normalizedBase}_2`;
}

export function buildStableWorktreeCreateInput({
  sourceWorkspaceRoot,
  sourceWorkspaceRoots,
  label,
}: {
  sourceWorkspaceRoot: string;
  sourceWorkspaceRoots: readonly string[];
  label: string;
}): CodexPendingWorktreeCreateInput {
  return {
    hostId: "local",
    label,
    sourceWorkspaceRoot,
    sourceWorkspaceRoots: [...sourceWorkspaceRoots],
    startingState: {
      type: "branch",
      branchName: "HEAD",
    },
    localEnvironmentConfigPath: null,
    prompt: STABLE_WORKTREE_CREATE_PROMPT,
    launchMode: "create-stable-worktree",
    startConversationParamsInput: null,
    sourceConversationId: null,
    sourceCollaborationMode: null,
  };
}

export function listStableWorktrees(
  entries: readonly CodexPendingWorktreeEntry[],
): StableWorktreeEntry[] {
  return entries.filter(
    (entry): entry is StableWorktreeEntry => entry.launchMode === "create-stable-worktree",
  );
}
