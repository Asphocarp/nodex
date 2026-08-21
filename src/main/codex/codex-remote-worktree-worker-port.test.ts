import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, test, vi } from "vite-plus/test";
import type { CodexWorktreeWorkerCreateInput } from "./codex-worktree-worker-port";
import { CodexRemoteWorktreeWorkerPort } from "./codex-remote-worktree-worker-port";

function createInput(): CodexWorktreeWorkerCreateInput {
  return {
    requestId: "request-1",
    hostId: "ssh:devbox",
    repositoryPath: "/repo",
    nodexHome: "/nodex",
    managedRoot: "/nodex/worktrees",
    projectId: "project-1",
    targetId: "pending-1",
    threadTitle: "Implement feature",
    startingState: { type: "branch", branchName: "main" },
    localEnvironmentConfigPath: "/repo/.codex/environments/environment.toml",
    setUpSyncedBranch: true,
    propagateLocalWorkspaceFiles: false,
  };
}

describe("Codex remote worktree worker port", () => {
  test("rejects protocol drift before opening an SSH worker", async () => {
    const openWorker = vi.fn(async (): Promise<ChildProcessWithoutNullStreams> => {
      throw new Error("SSH should not open");
    });
    const port = new CodexRemoteWorktreeWorkerPort({
      hostId: "ssh:devbox",
      openWorker,
    });

    await expect(
      port.create(createInput(), {
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    ).rejects.toThrow("violates protocol version");
    expect(openWorker).not.toHaveBeenCalled();
  });
});
