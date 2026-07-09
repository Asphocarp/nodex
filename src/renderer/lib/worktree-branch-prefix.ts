import {
  buildWorktreeThreadSlug,
  DEFAULT_WORKTREE_AUTO_BRANCH_PREFIX,
  normalizeWorktreeAutoBranchPrefix,
} from "../../shared/worktree-auto-branch";

export {
  buildWorktreeThreadSlug,
  DEFAULT_WORKTREE_AUTO_BRANCH_PREFIX,
  normalizeWorktreeAutoBranchPrefix,
};

export const WORKTREE_AUTO_BRANCH_PREFIX_STORAGE_KEY =
  "nodex-worktree-auto-branch-prefix-v1";

export function readWorktreeAutoBranchPrefix(): string {
  try {
    const raw = localStorage.getItem(WORKTREE_AUTO_BRANCH_PREFIX_STORAGE_KEY);
    return raw ?? DEFAULT_WORKTREE_AUTO_BRANCH_PREFIX;
  } catch {
    return DEFAULT_WORKTREE_AUTO_BRANCH_PREFIX;
  }
}

export function writeWorktreeAutoBranchPrefix(value: string): string {
  try {
    localStorage.setItem(WORKTREE_AUTO_BRANCH_PREFIX_STORAGE_KEY, value);
  } catch {
    // Ignore localStorage failures.
  }
  return value;
}
