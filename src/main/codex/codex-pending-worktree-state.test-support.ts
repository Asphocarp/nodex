import {
  createCodexPendingWorktreeState,
  getCodexPendingWorktreeSnapshot,
  reduceCodexPendingWorktreeState,
  resolveCodexPendingWorktreeThread,
  type CodexPendingWorktreeAction,
  type CodexPendingWorktreeEffect,
  type CodexPendingWorktreeEntry,
  type CodexPendingWorktreeState,
  type CodexPendingWorktreeThreadResolution,
} from "./codex-pending-worktree-state";

/** Mutable convenience wrapper used only by reducer and legacy vertical tests. */
export class CodexPendingWorktreeStateStore {
  private state: CodexPendingWorktreeState = createCodexPendingWorktreeState();
  private snapshot: readonly CodexPendingWorktreeEntry[] = [];
  private readonly listeners = new Set<() => void>();

  readonly getSnapshot = (): readonly CodexPendingWorktreeEntry[] => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState(): CodexPendingWorktreeState {
    return this.state;
  }

  resolveThread(clientThreadId: string): CodexPendingWorktreeThreadResolution | null {
    return resolveCodexPendingWorktreeThread(this.state, clientThreadId);
  }

  dispatch(action: CodexPendingWorktreeAction): readonly CodexPendingWorktreeEffect[] {
    const transition = reduceCodexPendingWorktreeState(this.state, action);
    if (transition.state === this.state) return transition.effects;
    this.state = transition.state;
    this.snapshot = getCodexPendingWorktreeSnapshot(this.state);
    for (const listener of this.listeners) listener();
    return transition.effects;
  }
}
