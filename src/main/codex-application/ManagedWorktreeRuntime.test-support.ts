import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type { CodexExecutionHostRegistry } from "../codex/codex-execution-host-registry";
import { normalizeWorktreePathForIdentity } from "../codex/codex-managed-worktree-effects";
import { snapshotPolicyForManagedWorktreeRemoval } from "../codex/codex-managed-worktree-lifecycle";
import type {
  CodexWorktreeWorkerListResult,
  CodexWorktreeWorkerOperation,
  CodexWorktreeWorkerRemoveResult,
} from "../codex/codex-worktree-worker-port";
import type { ManagedWorktreeNewborn, ManagedWorktreeRemoveInput } from "./ManagedWorktreeRuntime";
import type { ManagedWorktreeRuntimePromiseAdapter } from "./ManagedWorktreeRuntimePromiseAdapter";

export interface ManagedWorktreeRuntimeTestHarness {
  readonly adapter: ManagedWorktreeRuntimePromiseAdapter;
  readonly close: () => Promise<void>;
}

/**
 * Promise-facing CodexService tests use a direct worker test double. The
 * production Effect owner's single-flight and Scope interruption contracts are
 * covered independently by ManagedWorktreeRuntime.node.test.ts.
 */
export const makeManagedWorktreeRuntimeTestHarness = (
  registry: CodexExecutionHostRegistry,
): ManagedWorktreeRuntimeTestHarness => {
  const activeControllers = new Set<AbortController>();
  const newborns = new Map<string, ManagedWorktreeNewborn>();
  const removals = new Map<string, Promise<CodexWorktreeWorkerRemoveResult>>();
  let closed = false;

  const key = (hostId: string, worktreeGitRoot: string): string =>
    `${hostId.trim()}\0${normalizeWorktreePathForIdentity(path.resolve(worktreeGitRoot))}`;
  const worker = (hostId: string, operation: CodexWorktreeWorkerOperation) =>
    registry.requireWorktreeWorker(hostId, operation);
  const signalFor = (controller: AbortController, external?: AbortSignal): AbortSignal =>
    external ? AbortSignal.any([controller.signal, external]) : controller.signal;
  const run = async <A>(
    operation: (signal: AbortSignal) => Promise<A>,
    external?: AbortSignal,
  ): Promise<A> => {
    if (closed) throw new Error("Managed worktree test harness is closed");
    const controller = new AbortController();
    activeControllers.add(controller);
    try {
      return await operation(signalFor(controller, external));
    } finally {
      activeControllers.delete(controller);
    }
  };
  const runRemoval = async (input: ManagedWorktreeRemoveInput) => {
    const target = worker(input.hostId, "remove");
    const managedRoot = registry.resolveManagedRoot(input.hostId, input.worktreeGitRoot);
    return await run(
      (signal) =>
        target.remove(
          {
            requestId: `test:lifecycle:remove:${randomUUID()}`,
            hostId: input.hostId,
            managedRoot,
            worktreeGitRoot: input.worktreeGitRoot,
            reason: input.reason,
            snapshotPolicy: snapshotPolicyForManagedWorktreeRemoval(input.reason),
          },
          { signal, onEvent: input.onEvent },
        ),
      input.signal,
    );
  };
  const adapter: ManagedWorktreeRuntimePromiseAdapter = {
    remove: (input) => {
      const removalKey = key(input.hostId, input.worktreeGitRoot);
      const existing = removals.get(removalKey);
      if (existing) return existing;
      const removal = runRemoval(input).finally(() => {
        if (removals.get(removalKey) === removal) removals.delete(removalKey);
        newborns.delete(removalKey);
      });
      removals.set(removalKey, removal);
      return removal;
    },
    inspect: async (input) => {
      const target = worker(input.hostId, "inspect");
      const managedRoot = registry.resolveManagedRoot(input.hostId, input.worktreeGitRoot);
      return await run(
        (signal) =>
          target.inspect(
            {
              requestId: `test:lifecycle:inspect:${randomUUID()}`,
              hostId: input.hostId,
              managedRoot,
              worktreeGitRoot: input.worktreeGitRoot,
              cwd: input.cwd,
              candidateRepositoryPaths: input.candidateRepositoryPaths,
            },
            { signal },
          ),
        input.signal,
      );
    },
    list: async (hostId) => {
      const target = worker(hostId, "list");
      const inventories = await Promise.all(
        registry.listManagedRoots(hostId).map(
          async (managedRoot) =>
            await run((signal) =>
              target.list(
                {
                  requestId: `test:lifecycle:list:${randomUUID()}`,
                  hostId,
                  managedRoot,
                },
                { signal },
              ),
            ),
        ),
      );
      const entries = new Map<string, CodexWorktreeWorkerListResult["entries"][number]>();
      for (const inventory of inventories) {
        for (const entry of inventory.entries) {
          entries.set(normalizeWorktreePathForIdentity(entry.worktreeGitRoot), entry);
        }
      }
      return { entries: [...entries.values()] };
    },
    restore: async (input) => {
      const target = worker(input.hostId, "restore");
      const managedRoot = registry.resolveManagedRoot(input.hostId, input.worktreeGitRoot);
      return await run(
        (signal) =>
          target.restore(
            {
              requestId: `test:lifecycle:restore:${randomUUID()}`,
              hostId: input.hostId,
              managedRoot,
              worktreeGitRoot: input.worktreeGitRoot,
              cwd: input.cwd,
              candidateRepositoryPaths: input.candidateRepositoryPaths,
              ownerThreadId: input.ownerThreadId,
            },
            { signal, onEvent: input.onEvent ?? (() => undefined) },
          ),
        input.signal,
      );
    },
    setOwner: async (input) => {
      const target = worker(input.hostId, "set-owner");
      const managedRoot = registry.resolveManagedRoot(input.hostId, input.worktreeGitRoot);
      await run(async (signal) => {
        await target.setOwner(
          {
            requestId: `test:lifecycle:set-owner:${randomUUID()}`,
            hostId: input.hostId,
            managedRoot,
            worktreeGitRoot: input.worktreeGitRoot,
            ownerThreadId: input.ownerThreadId,
          },
          { signal },
        );
      }, input.signal);
    },
    registerNewborn: (hostId, worktreeGitRoot) => {
      newborns.set(key(hostId, worktreeGitRoot), { hostId, worktreeGitRoot });
    },
    releaseNewborn: (hostId, worktreeGitRoot) => {
      newborns.delete(key(hostId, worktreeGitRoot));
    },
    isNewborn: (hostId, worktreeGitRoot) => newborns.has(key(hostId, worktreeGitRoot)),
    listNewborns: () => [...newborns.values()],
  };

  return {
    adapter,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const controller of activeControllers) controller.abort();
      await Promise.allSettled(removals.values());
      activeControllers.clear();
      newborns.clear();
      removals.clear();
    },
  };
};
