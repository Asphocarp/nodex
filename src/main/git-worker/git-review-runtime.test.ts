import { describe, expect, test } from "vite-plus/test";
import type { GitCommandRunner } from "./git-command-runner";
import { GitReviewRuntime } from "./git-review-operations";

const unusedRunner: GitCommandRunner = {
  run: async () => {
    throw new Error("Unexpected Git command");
  },
};

describe("GitReviewRuntime", () => {
  test("isolates repository generations between runtime instances", () => {
    const identity = {
      hostId: "local",
      commonDir: "/tmp/nodex-git-review-runtime/.git",
      root: "/tmp/nodex-git-review-runtime",
    };
    const first = new GitReviewRuntime({ commandRunner: unusedRunner, environment: {} });
    first.registerRepositoryIdentity(identity.root, identity);

    expect(first.readSnapshotGeneration(identity)).toBe(1);
    first.invalidateSnapshot(identity.root);
    expect(first.readSnapshotGeneration(identity)).toBe(2);

    const second = new GitReviewRuntime({ commandRunner: unusedRunner, environment: {} });
    second.registerRepositoryIdentity(identity.root, identity);
    expect(second.readSnapshotGeneration(identity)).toBe(1);
  });
});
