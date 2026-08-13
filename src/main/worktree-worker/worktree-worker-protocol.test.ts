import { describe, expect, test } from "vitest";
import {
  CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
  isCodexWorktreeWorkerHostMessage,
  isCodexWorktreeWorkerThreadMessage,
} from "./worktree-worker-protocol";

describe("worktree worker protocol", () => {
  test("accepts a branch create request with the exact remote ref", () => {
    expect(isCodexWorktreeWorkerHostMessage({
      type: "create",
      id: "create:1",
      input: {
        requestId: "pending-1:1",
        hostId: "local",
        repositoryPath: "/repo",
        nodexHome: "/nodex-home",
        projectId: "project-1",
        targetId: "pending-1",
        threadTitle: "Implement feature",
        startingState: {
          type: "branch",
          branchName: "feature",
          remoteRef: "refs/remotes/origin/feature",
        },
        localEnvironmentConfigPath: "/repo/.codex/environments/environment.toml",
        setUpSyncedBranch: true,
        propagateLocalWorkspaceFiles: true,
      },
    })).toBe(true);

    expect(isCodexWorktreeWorkerHostMessage({
      type: "create",
      id: "create:2",
      input: {
        requestId: "pending-2:1",
        hostId: "remote-1",
        repositoryPath: "/repo",
        nodexHome: "/nodex-home",
        projectId: "project-2",
        targetId: "pending-2",
        threadTitle: "Use the host default",
        startingState: null,
        localEnvironmentConfigPath: null,
        setUpSyncedBranch: true,
        propagateLocalWorkspaceFiles: false,
      },
    })).toBe(true);
  });

  test("rejects malformed mutation messages at the thread boundary", () => {
    expect(isCodexWorktreeWorkerHostMessage({
      type: "create",
      id: "create:1",
      input: {
        requestId: "pending-1:1",
        hostId: "local",
        repositoryPath: "/repo",
        nodexHome: "/nodex-home",
        projectId: "project-1",
        targetId: "pending-1",
        threadTitle: "Implement feature",
        startingState: { type: "branch", branchName: "" },
        localEnvironmentConfigPath: null,
        setUpSyncedBranch: true,
        propagateLocalWorkspaceFiles: true,
      },
    })).toBe(false);
    expect(isCodexWorktreeWorkerHostMessage({
      type: "remove",
      id: "remove:1",
      worktreeGitRoot: "",
    })).toBe(false);
  });

  test("validates streamed lifecycle events and terminal results", () => {
    expect(isCodexWorktreeWorkerThreadMessage({
      type: "ready",
      epoch: 2,
      protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
    })).toBe(true);
    expect(isCodexWorktreeWorkerThreadMessage({
      type: "event",
      id: "create:1",
      event: {
        type: "path-allocated",
        worktreeGitRoot: "/worktrees/abcd/repo",
        worktreeWorkspaceRoot: "/worktrees/abcd/repo/packages/app",
      },
    })).toBe(true);
    expect(isCodexWorktreeWorkerThreadMessage({
      type: "event",
      id: "create:1",
      event: {
        type: "output",
        phase: "setup",
        stream: "stdout",
        data: "installing\n",
      },
    })).toBe(true);
    expect(isCodexWorktreeWorkerThreadMessage({
      type: "result",
      id: "create:1",
      result: {
        type: "ok",
        value: {
          worktreeGitRoot: "/worktrees/abcd/repo",
          worktreeWorkspaceRoot: "/worktrees/abcd/repo/packages/app",
          setupError: null,
          shellEnvironment: null,
        },
      },
    })).toBe(true);
  });
});
