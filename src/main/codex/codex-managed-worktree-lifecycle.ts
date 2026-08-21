import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  CodexManagedWorktreeRemovalReason,
  CodexManagedWorktreeSnapshotPolicy,
  CodexWorktreeWorkerEvent,
  CodexWorktreeWorkerInspectResult,
  CodexWorktreeWorkerListResult,
  CodexWorktreeWorkerRemoveResult,
  CodexWorktreeWorkerRestoreResult,
} from "./codex-worktree-worker-port";
import type { CodexExecutionHostRegistry } from "./codex-execution-host-registry";
import { normalizeWorktreePathForIdentity } from "./codex-managed-worktree-effects";

export function snapshotPolicyForManagedWorktreeRemoval(
  reason: CodexManagedWorktreeRemovalReason,
): CodexManagedWorktreeSnapshotPolicy {
  switch (reason) {
    case "archive":
    case "automatic-retention":
    case "automation-archive":
    case "handoff":
      return "required";
    case "settings-delete":
      return "best-effort";
    case "failed-create":
    case "retry":
    case "cancel":
      return "ephemeral";
  }
}

export interface CodexManagedWorktreeLifecycleOptions {
  readonly executionHosts: CodexExecutionHostRegistry;
}

/** Main-owned policy and single-flight boundary for every managed worktree. */
export class CodexManagedWorktreeLifecycleService {
  readonly #executionHosts: CodexExecutionHostRegistry;
  readonly #removals = new Map<string, Promise<CodexWorktreeWorkerRemoveResult>>();
  readonly #newborns = new Set<string>();

  constructor(options: CodexManagedWorktreeLifecycleOptions) {
    this.#executionHosts = options.executionHosts;
  }

  registerNewborn(hostId: string, worktreeGitRoot: string): void {
    this.#newborns.add(this.#key(hostId, worktreeGitRoot));
  }

  releaseNewborn(hostId: string, worktreeGitRoot: string): void {
    this.#newborns.delete(this.#key(hostId, worktreeGitRoot));
  }

  isNewborn(hostId: string, worktreeGitRoot: string): boolean {
    return this.#newborns.has(this.#key(hostId, worktreeGitRoot));
  }

  listNewborns(): readonly {
    readonly hostId: string;
    readonly worktreeGitRoot: string;
  }[] {
    return [...this.#newborns].map((key) => {
      const separator = key.indexOf("\0");
      return {
        hostId: key.slice(0, separator),
        worktreeGitRoot: key.slice(separator + 1),
      };
    });
  }

  remove(input: {
    readonly hostId: string;
    readonly worktreeGitRoot: string;
    readonly reason: CodexManagedWorktreeRemovalReason;
    readonly signal?: AbortSignal;
    readonly onEvent?: (event: CodexWorktreeWorkerEvent) => void;
  }): Promise<CodexWorktreeWorkerRemoveResult> {
    const key = this.#key(input.hostId, input.worktreeGitRoot);
    const existing = this.#removals.get(key);
    if (existing) return existing;
    const worker = this.#executionHosts.requireWorktreeWorker(input.hostId, "remove");
    const operation = worker
      .remove(
        {
          requestId: `lifecycle:remove:${randomUUID()}`,
          hostId: input.hostId,
          managedRoot: this.#executionHosts.resolveManagedRoot(input.hostId, input.worktreeGitRoot),
          worktreeGitRoot: input.worktreeGitRoot,
          reason: input.reason,
          snapshotPolicy: snapshotPolicyForManagedWorktreeRemoval(input.reason),
        },
        {
          signal: input.signal,
          onEvent: input.onEvent,
        },
      )
      .finally(() => {
        if (this.#removals.get(key) === operation) this.#removals.delete(key);
        this.#newborns.delete(key);
      });
    this.#removals.set(key, operation);
    return operation;
  }

  async inspect(input: {
    readonly hostId: string;
    readonly worktreeGitRoot: string;
    readonly cwd: string;
    readonly candidateRepositoryPaths: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<CodexWorktreeWorkerInspectResult> {
    const worker = this.#executionHosts.requireWorktreeWorker(input.hostId, "inspect");
    return await worker.inspect(
      {
        requestId: `lifecycle:inspect:${randomUUID()}`,
        hostId: input.hostId,
        managedRoot: this.#executionHosts.resolveManagedRoot(input.hostId, input.worktreeGitRoot),
        worktreeGitRoot: input.worktreeGitRoot,
        cwd: input.cwd,
        candidateRepositoryPaths: input.candidateRepositoryPaths,
      },
      { signal: input.signal },
    );
  }

  async list(hostId: string): Promise<CodexWorktreeWorkerListResult> {
    const worker = this.#executionHosts.requireWorktreeWorker(hostId, "list");
    const inventories = await Promise.all(
      this.#executionHosts.listManagedRoots(hostId).map(
        async (managedRoot) =>
          await worker.list({
            requestId: `lifecycle:list:${randomUUID()}`,
            hostId,
            managedRoot,
          }),
      ),
    );
    const entries = new Map<string, CodexWorktreeWorkerListResult["entries"][number]>();
    for (const inventory of inventories) {
      for (const entry of inventory.entries) {
        entries.set(normalizeWorktreePathForIdentity(entry.worktreeGitRoot), entry);
      }
    }
    return { entries: [...entries.values()] };
  }

  async restore(input: {
    readonly hostId: string;
    readonly worktreeGitRoot: string;
    readonly cwd: string;
    readonly candidateRepositoryPaths: readonly string[];
    readonly ownerThreadId: string | null;
    readonly signal?: AbortSignal;
    readonly onEvent?: (event: CodexWorktreeWorkerEvent) => void;
  }): Promise<CodexWorktreeWorkerRestoreResult> {
    const worker = this.#executionHosts.requireWorktreeWorker(input.hostId, "restore");
    return await worker.restore(
      {
        requestId: `lifecycle:restore:${randomUUID()}`,
        hostId: input.hostId,
        managedRoot: this.#executionHosts.resolveManagedRoot(input.hostId, input.worktreeGitRoot),
        worktreeGitRoot: input.worktreeGitRoot,
        cwd: input.cwd,
        candidateRepositoryPaths: input.candidateRepositoryPaths,
        ownerThreadId: input.ownerThreadId,
      },
      {
        signal: input.signal ?? new AbortController().signal,
        onEvent: input.onEvent ?? (() => undefined),
      },
    );
  }

  async setOwner(input: {
    readonly hostId: string;
    readonly worktreeGitRoot: string;
    readonly ownerThreadId: string;
    readonly signal?: AbortSignal;
  }): Promise<void> {
    const worker = this.#executionHosts.requireWorktreeWorker(input.hostId, "set-owner");
    await worker.setOwner(
      {
        requestId: `lifecycle:set-owner:${randomUUID()}`,
        hostId: input.hostId,
        managedRoot: this.#executionHosts.resolveManagedRoot(input.hostId, input.worktreeGitRoot),
        worktreeGitRoot: input.worktreeGitRoot,
        ownerThreadId: input.ownerThreadId,
      },
      { signal: input.signal },
    );
  }

  #key(hostId: string, worktreeGitRoot: string): string {
    return `${hostId.trim()}\0${normalizeWorktreePathForIdentity(path.resolve(worktreeGitRoot))}`;
  }
}
