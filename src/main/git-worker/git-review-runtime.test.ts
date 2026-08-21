import { describe, expect, test } from "vite-plus/test";
import { GitReviewRuntime } from "./git-review-operations";

describe("GitReviewRuntime", () => {
  test("isolates repository generations and rejects use after disposal", () => {
    const identity = {
      hostId: "local",
      commonDir: "/tmp/nodex-git-review-runtime/.git",
      root: "/tmp/nodex-git-review-runtime",
    };
    const first = new GitReviewRuntime({ environment: {} });
    first.registerRepositoryIdentity(identity.root, identity);

    expect(first.readSnapshotGeneration(identity)).toBe(1);
    first.invalidateSnapshot(identity.root);
    expect(first.readSnapshotGeneration(identity)).toBe(2);

    first.dispose();
    expect(() => first.readSnapshotGeneration(identity)).toThrow("Git review runtime is closed");

    const second = new GitReviewRuntime({ environment: {} });
    second.registerRepositoryIdentity(identity.root, identity);
    expect(second.readSnapshotGeneration(identity)).toBe(1);
    second.dispose();
  });
});
