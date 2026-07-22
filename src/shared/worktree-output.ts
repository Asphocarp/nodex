export const WORKTREE_OUTPUT_TAIL_MAX_CHARS = 32_000;
export const WORKTREE_OUTPUT_TRUNCATION_MARKER = "[earlier output truncated]\n";

export function formatBoundedWorktreeOutput(input: {
  readonly text: string;
  readonly didTruncate: boolean;
}): string {
  return input.didTruncate
    ? `${WORKTREE_OUTPUT_TRUNCATION_MARKER}${input.text}`
    : input.text;
}
