import type {
  CodexWorktreeWorkerInspectResult,
  CodexWorktreeWorkerListResult,
  CodexWorktreeWorkerRemoveResult,
  CodexWorktreeWorkerRestoreResult,
} from "../codex/codex-worktree-worker-port";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type {
  ManagedWorktreeInspectInput,
  ManagedWorktreeNewborn,
  ManagedWorktreeRemoveInput,
  ManagedWorktreeRestoreInput,
  ManagedWorktreeRuntime,
  ManagedWorktreeSetOwnerInput,
} from "./ManagedWorktreeRuntime";

export interface ManagedWorktreeRuntimePromiseAdapter {
  readonly remove: (input: ManagedWorktreeRemoveInput) => Promise<CodexWorktreeWorkerRemoveResult>;
  readonly inspect: (
    input: ManagedWorktreeInspectInput,
  ) => Promise<CodexWorktreeWorkerInspectResult>;
  readonly list: (hostId: string) => Promise<CodexWorktreeWorkerListResult>;
  readonly restore: (
    input: ManagedWorktreeRestoreInput,
  ) => Promise<CodexWorktreeWorkerRestoreResult>;
  readonly setOwner: (input: ManagedWorktreeSetOwnerInput) => Promise<void>;
  readonly registerNewborn: (hostId: string, worktreeGitRoot: string) => void;
  readonly releaseNewborn: (hostId: string, worktreeGitRoot: string) => void;
  readonly isNewborn: (hostId: string, worktreeGitRoot: string) => boolean;
  readonly listNewborns: () => readonly ManagedWorktreeNewborn[];
}

/** The sole Promise bridge used by CodexService until its worktree flows become Effects. */
export const makeManagedWorktreeRuntimePromiseAdapter = (
  runtime: ManagedWorktreeRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): ManagedWorktreeRuntimePromiseAdapter => ({
  remove: (input) => callbacks.runPromise(runtime.remove(input)),
  inspect: (input) => callbacks.runPromise(runtime.inspect(input)),
  list: (hostId) => callbacks.runPromise(runtime.list(hostId)),
  restore: (input) => callbacks.runPromise(runtime.restore(input)),
  setOwner: (input) => callbacks.runPromise(runtime.setOwner(input)),
  registerNewborn: runtime.legacyNewborns.register,
  releaseNewborn: runtime.legacyNewborns.release,
  isNewborn: runtime.legacyNewborns.has,
  listNewborns: runtime.legacyNewborns.list,
});
