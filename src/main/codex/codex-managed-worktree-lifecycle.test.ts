import { describe, expect, test, vi } from "vite-plus/test";
import { CodexExecutionHostRegistry } from "./codex-execution-host-registry";
import {
  CodexManagedWorktreeLifecycleService,
  snapshotPolicyForManagedWorktreeRemoval,
} from "./codex-managed-worktree-lifecycle";
import { createInProcessCodexWorktreeWorkerPort } from "./codex-worktree-worker-operation";

describe("CodexManagedWorktreeLifecycleService", () => {
  test("maps every destructive reason to a closed snapshot policy", () => {
    expect(snapshotPolicyForManagedWorktreeRemoval("archive")).toBe("required");
    expect(snapshotPolicyForManagedWorktreeRemoval("automatic-retention")).toBe("required");
    expect(snapshotPolicyForManagedWorktreeRemoval("automation-archive")).toBe("required");
    expect(snapshotPolicyForManagedWorktreeRemoval("settings-delete")).toBe("best-effort");
    expect(snapshotPolicyForManagedWorktreeRemoval("failed-create")).toBe("ephemeral");
    expect(snapshotPolicyForManagedWorktreeRemoval("retry")).toBe("ephemeral");
    expect(snapshotPolicyForManagedWorktreeRemoval("cancel")).toBe("ephemeral");
  });

  test("deduplicates one physical removal by host and normalized path", async () => {
    const registry = new CodexExecutionHostRegistry();
    const base = createInProcessCodexWorktreeWorkerPort({ hostId: "local" });
    let resolveRemoval!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveRemoval = resolve;
    });
    const remove = vi.fn(async (input: unknown) => {
      void input;
      await gate;
      return { removed: true, alreadyMissing: false, snapshot: null, warnings: [] };
    });
    registry.register({
      hostId: "local",
      managedRoot: "/managed",
      worktreeWorker: { ...base, remove },
      capabilities: ["remove"],
    });
    const lifecycle = new CodexManagedWorktreeLifecycleService({
      executionHosts: registry,
    });
    lifecycle.registerNewborn("local", "/managed/abcd/repo");

    const first = lifecycle.remove({
      hostId: "local",
      worktreeGitRoot: "/managed/abcd/repo",
      reason: "archive",
    });
    const second = lifecycle.remove({
      hostId: "local",
      worktreeGitRoot: "/managed/abcd/./repo",
      reason: "archive",
    });
    expect(first).toBe(second);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0]).toMatchObject({
      managedRoot: "/managed",
      reason: "archive",
      snapshotPolicy: "required",
    });
    resolveRemoval();
    await expect(first).resolves.toMatchObject({ removed: true });
    expect(lifecycle.isNewborn("local", "/managed/abcd/repo")).toBe(false);
  });
});
