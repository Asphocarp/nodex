import { describe, expect, test } from "vitest";
import { formatBoundedWorktreeOutput, WORKTREE_OUTPUT_TRUNCATION_MARKER } from "./worktree-output";

describe("formatBoundedWorktreeOutput", () => {
  test("adds the truncation marker outside the retained tail", () => {
    expect(formatBoundedWorktreeOutput({ text: "tail", didTruncate: true })).toBe(
      `${WORKTREE_OUTPUT_TRUNCATION_MARKER}tail`,
    );
    expect(formatBoundedWorktreeOutput({ text: "complete", didTruncate: false })).toBe("complete");
  });
});
