import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  cancelGitAction,
  commitGitChanges,
  type GitActionWorkerPort,
} from "./git-action-service";

const tempRoots: string[] = [];
const unreachableGitWorker: GitActionWorkerPort = {
  readStatus: async () => {
    throw new Error("Unexpected Git worker status request");
  },
  readReviewPatch: async () => {
    throw new Error("Unexpected Git worker patch request");
  },
  commit: async () => {
    throw new Error("Unexpected Git worker commit request");
  },
  refreshRepository: async () => undefined,
};

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "nodex-git-action-unit-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("git-action-service cancellation", () => {
  test("can cancel a commit before asynchronous preflight completes", async () => {
    const root = await createTempRoot();
    const operationId = "cancel-commit-preflight";
    const pendingCommit = commitGitChanges({
      cwd: root,
      message: "feat: should not commit",
      includeUnstaged: true,
      operationId,
    }, { gitWorker: unreachableGitWorker });

    const cancelResult = cancelGitAction({ operationId });
    const result = await pendingCommit;

    expect(cancelResult.canceled).toBe(true);
    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Git action was canceled.");
  });
});
