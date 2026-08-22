import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type {
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeRequest,
  CodexPendingWorktreeThreadResolution,
} from "../../shared/codex-pending-worktree";
import {
  CodexPendingWorktreeRuntimeError,
  type CodexPendingWorktreeRuntime,
} from "./CodexPendingWorktreeRuntime";

export interface CodexPendingWorktreeRuntimePromiseAdapter {
  readonly list: () => readonly CodexPendingWorktreeEntry[];
  readonly resolveThread: (clientThreadId: string) => CodexPendingWorktreeThreadResolution | null;
  readonly create: (request: CodexPendingWorktreeRequest, createdAt?: number) => void;
  readonly retry: (pendingWorktreeId: string) => void;
  readonly workLocally: (pendingWorktreeId: string) => Promise<{ readonly threadId: string }>;
  readonly continueWithoutSetup: (pendingWorktreeId: string) => void;
  readonly cancel: (pendingWorktreeId: string) => void;
  readonly dismiss: (pendingWorktreeId: string) => void;
  readonly rename: (pendingWorktreeId: string, label: string) => void;
  readonly setPinned: (pendingWorktreeId: string, isPinned: boolean) => void;
  readonly setPinnedBeforeThreadId: (
    pendingWorktreeId: string,
    beforeThreadId: string | null,
  ) => void;
  readonly clearAttention: (pendingWorktreeId: string) => void;
}

const unwrapRuntimeError = (error: unknown): never => {
  if (error instanceof CodexPendingWorktreeRuntimeError) throw error.cause;
  throw error;
};

/** Promise projection for the remaining CodexService call sites; it owns no state or fibers. */
export const makeCodexPendingWorktreeRuntimePromiseAdapter = (
  runtime: CodexPendingWorktreeRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexPendingWorktreeRuntimePromiseAdapter => ({
  list: runtime.list,
  resolveThread: runtime.resolveThread,
  create: runtime.create,
  retry: runtime.retry,
  workLocally: (pendingWorktreeId) =>
    callbacks.runPromise(runtime.workLocally(pendingWorktreeId)).catch(unwrapRuntimeError),
  continueWithoutSetup: runtime.continueWithoutSetup,
  cancel: runtime.cancel,
  dismiss: runtime.dismiss,
  rename: runtime.rename,
  setPinned: runtime.setPinned,
  setPinnedBeforeThreadId: runtime.setPinnedBeforeThreadId,
  clearAttention: runtime.clearAttention,
});
