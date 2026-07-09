import { CODEX_CLIENT_THREAD_ID_PREFIX } from "../../shared/codex-client-thread";
import type {
  CodexPendingWorktreeCreateInput,
  CodexPendingWorktreeCreateResult,
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeThreadResolution,
} from "../../shared/codex-pending-worktree";

type PendingConversationStart =
  | { readonly clientThreadId: string; readonly state: "waiting" }
  | { readonly clientThreadId: string; readonly state: "failed"; readonly errorMessage: string | null };

function createBrowserId(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) throw new Error("Browser pending worktrees require crypto.randomUUID");
  return id;
}

function makeEntry(
  request: CodexPendingWorktreeCreateInput,
  pendingWorktreeId: string,
  clientThreadId: string | null,
  createdAt: number,
): CodexPendingWorktreeEntry {
  const lifecycle = {
    createdAt,
    attempt: 1,
    phase: "queued" as const,
    labelEdited: false,
    worktreeOutputText: "",
    setupOutputText: "",
    errorMessage: null,
    worktreeWorkspaceRoot: null,
    worktreeGitRoot: null,
    needsAttention: false,
    isPinned: false,
    pinnedBeforeThreadId: null,
  };
  if (request.launchMode === "create-stable-worktree") {
    return { ...request, id: pendingWorktreeId, ...lifecycle };
  }
  if (!clientThreadId) throw new Error("Pending conversation requires a client thread id");
  return { ...request, id: pendingWorktreeId, clientThreadId, ...lifecycle };
}

/** Exact renderer-local fallback used when the Electron bridge is absent. */
export class BrowserPendingWorktreeFallback {
  private entries: CodexPendingWorktreeEntry[] = [];
  private readonly starts = new Map<string, PendingConversationStart>();
  private readonly listeners = new Set<(
    entries: readonly CodexPendingWorktreeEntry[],
  ) => void>();

  constructor(
    private readonly createId: () => string = createBrowserId,
    private readonly now: () => number = Date.now,
  ) {}

  list(): readonly CodexPendingWorktreeEntry[] {
    return this.entries;
  }

  subscribe(
    listener: (entries: readonly CodexPendingWorktreeEntry[]) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  create(input: CodexPendingWorktreeCreateInput): CodexPendingWorktreeCreateResult {
    const pendingWorktreeId = `${input.hostId}:${this.createId()}`;
    const clientThreadId = input.launchMode === "create-stable-worktree"
      ? null
      : `${CODEX_CLIENT_THREAD_ID_PREFIX}${this.createId()}`;
    const entry = makeEntry(input, pendingWorktreeId, clientThreadId, this.now());
    if (clientThreadId) {
      this.starts.set(pendingWorktreeId, { clientThreadId, state: "waiting" });
    }
    this.entries = [...this.entries, entry];
    this.publish();
    return { pendingWorktreeId, clientThreadId };
  }

  resolveThread(clientThreadId: string): CodexPendingWorktreeThreadResolution | null {
    for (const [pendingWorktreeId, start] of this.starts) {
      if (start.clientThreadId !== clientThreadId) continue;
      if (start.state === "failed") {
        return {
          state: "failed",
          clientThreadId,
          pendingWorktreeId,
          errorMessage: start.errorMessage,
        };
      }
      return { state: "waiting", clientThreadId, pendingWorktreeId };
    }
    return null;
  }

  retry(pendingWorktreeId: string): void {
    this.resetStart(pendingWorktreeId);
    this.updateEntry(pendingWorktreeId, (entry) => ({
      ...entry,
      attempt: entry.attempt + 1,
      phase: "queued",
      worktreeOutputText: "",
      setupOutputText: "",
      errorMessage: null,
      worktreeWorkspaceRoot: null,
      worktreeGitRoot: null,
      needsAttention: false,
    }));
  }

  continueWithoutSetup(pendingWorktreeId: string): void {
    this.resetStart(pendingWorktreeId);
    this.updateEntry(pendingWorktreeId, (entry) =>
      entry.phase === "failed"
        && entry.worktreeGitRoot !== null
        && entry.worktreeWorkspaceRoot !== null
        ? { ...entry, phase: "worktree-ready", needsAttention: false }
        : entry);
  }

  cancel(pendingWorktreeId: string): void {
    this.remove(pendingWorktreeId);
  }

  dismiss(pendingWorktreeId: string): void {
    this.remove(pendingWorktreeId);
  }

  rename(pendingWorktreeId: string, label: string): void {
    this.updateEntry(pendingWorktreeId, (entry) => ({
      ...entry,
      label,
      labelEdited: true,
    }));
  }

  setPinned(pendingWorktreeId: string, isPinned: boolean): void {
    this.updateEntry(pendingWorktreeId, (entry) => ({
      ...entry,
      isPinned,
      pinnedBeforeThreadId: isPinned ? entry.pinnedBeforeThreadId : null,
    }));
  }

  setPinnedBeforeThreadId(
    pendingWorktreeId: string,
    pinnedBeforeThreadId: string | null,
  ): void {
    this.updateEntry(pendingWorktreeId, (entry) => ({
      ...entry,
      pinnedBeforeThreadId,
    }));
  }

  clearAttention(pendingWorktreeId: string): void {
    this.updateEntry(pendingWorktreeId, (entry) => ({
      ...entry,
      needsAttention: false,
    }));
  }

  private resetStart(pendingWorktreeId: string): void {
    const start = this.starts.get(pendingWorktreeId);
    if (!start) return;
    this.starts.set(pendingWorktreeId, {
      clientThreadId: start.clientThreadId,
      state: "waiting",
    });
  }

  private remove(pendingWorktreeId: string): void {
    const nextEntries = this.entries.filter((entry) => entry.id !== pendingWorktreeId);
    const startRemoved = this.starts.delete(pendingWorktreeId);
    if (nextEntries.length === this.entries.length && !startRemoved) return;
    this.entries = nextEntries;
    this.publish();
  }

  private updateEntry(
    pendingWorktreeId: string,
    update: (entry: CodexPendingWorktreeEntry) => CodexPendingWorktreeEntry,
  ): void {
    let changed = false;
    const entries = this.entries.map((entry) => {
      if (entry.id !== pendingWorktreeId) return entry;
      const next = update(entry);
      changed ||= next !== entry;
      return next;
    });
    if (!changed) return;
    this.entries = entries;
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.entries);
  }
}

export const browserPendingWorktreeFallback = new BrowserPendingWorktreeFallback();
