import { describe, expect, test } from "vitest";
import { CodexExecutionHostRegistry } from "./codex-execution-host-registry";
import { createInProcessCodexWorktreeWorkerPort } from "./codex-worktree-worker-operation";

describe("CodexExecutionHostRegistry", () => {
  test("routes only advertised capabilities to the exact host worker", () => {
    const registry = new CodexExecutionHostRegistry();
    const worker = createInProcessCodexWorktreeWorkerPort({ hostId: "remote:build" });
    registry.register({
      hostId: "remote:build",
      managedRoot: "/remote/worktrees",
      worktreeWorker: worker,
      capabilities: ["create", "remove"],
    });

    expect(registry.requireWorktreeWorker("remote:build", "create")).toBe(worker);
    expect(registry.hasCapability("remote:build", "remove")).toBe(true);
    expect(() => registry.requireWorktreeWorker("remote:build", "restore")).toThrow(
      "does not support worktree restore",
    );
    expect(() => registry.requireWorktreeWorker("remote:missing", "create")).toThrow(
      "Execution host is unavailable",
    );
  });

  test("rejects a registration whose worker belongs to another host", () => {
    const registry = new CodexExecutionHostRegistry();
    const worker = createInProcessCodexWorktreeWorkerPort({ hostId: "local" });

    expect(() =>
      registry.register({
        hostId: "remote:build",
        managedRoot: "/remote/worktrees",
        worktreeWorker: worker,
        capabilities: ["create"],
      }),
    ).toThrow("identity does not match");
  });

  test("keeps historical roots authorized while future creation follows the latest root", () => {
    const registry = new CodexExecutionHostRegistry();
    const worker = createInProcessCodexWorktreeWorkerPort({ hostId: "local" });
    registry.register({
      hostId: "local",
      managedRoot: "/managed/current",
      knownManagedRoots: ["/managed/previous"],
      worktreeWorker: worker,
      capabilities: ["create", "inspect"],
    });

    registry.updateManagedRoot("local", "/managed/next");
    expect(registry.requireManagedRoot("local")).toBe("/managed/next");
    expect(registry.resolveManagedRoot("local", "/managed/previous/a1b2/repo")).toBe(
      "/managed/previous",
    );
    expect(registry.listManagedRoots("local")).toEqual([
      "/managed/current",
      "/managed/next",
      "/managed/previous",
    ]);
    expect(() => registry.resolveManagedRoot("local", "/outside/repo")).toThrow(
      "outside every authorized managed root",
    );
  });
});
