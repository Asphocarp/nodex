import type {
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeRequest,
  CodexPendingWorktreeThreadResolution,
} from "../../shared/codex-pending-worktree";
import {
  CodexPendingWorktreeStateStore,
  type CodexPendingWorktreeAction,
  type CodexPendingWorktreeEffect,
  type CodexPendingWorktreeMetadataUpdate,
} from "./codex-pending-worktree-state";

export interface CodexPendingWorktreeCreationResult {
  readonly worktreeGitRoot: string;
  readonly worktreeWorkspaceRoot: string;
  readonly setupError?: string | null;
}

export interface CodexPendingWorktreeRuntimeDependencies {
  readonly createWorktree: (
    entry: CodexPendingWorktreeEntry,
    context: {
      readonly signal: AbortSignal;
      readonly onOutput: (output: string) => void;
      readonly onSetupStarted: () => void;
    },
  ) => Promise<CodexPendingWorktreeCreationResult>;
  readonly launchConversation: (
    entry: CodexPendingWorktreeEntry,
    workspaceRoot: string,
    context: {
      readonly onThreadCreated: (threadId: string) => void;
      readonly includeWorktreeInit: boolean;
    },
  ) => Promise<{ readonly threadId: string }>;
  readonly removeWorktree: (worktreeGitRoot: string) => Promise<void>;
  readonly cleanupGoalSources: (entry: CodexPendingWorktreeEntry) => Promise<void>;
  readonly addWorkspaceRoot?: (workspaceRoot: string, label: string) => Promise<void> | void;
  readonly onConversationThreadMapped?: (input: {
    readonly entry: CodexPendingWorktreeEntry;
    readonly pendingWorktreeId: string;
    readonly threadId: string;
    readonly workspaceRoot: string;
  }) => void;
  readonly onChanged?: (entries: readonly CodexPendingWorktreeEntry[]) => void;
  readonly onError?: (
    phase: "create" | "launch" | "remove" | "cleanup-goal-sources" | "add-workspace-root",
    error: unknown,
    pendingWorktreeId: string,
  ) => void;
}

interface CodexPendingWorktreeAttemptRuntime {
  readonly attempt: number;
  readonly abortController: AbortController;
}

interface CodexPendingWorktreeLocalLaunch {
  readonly promise: Promise<{ readonly threadId: string }>;
  readonly resolve: (result: { readonly threadId: string }) => void;
  readonly reject: (error: Error) => void;
}

function createLocalLaunch(): CodexPendingWorktreeLocalLaunch {
  let resolve!: CodexPendingWorktreeLocalLaunch["resolve"];
  let reject!: CodexPendingWorktreeLocalLaunch["reject"];
  const promise = new Promise<{ readonly threadId: string }>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Main-process counterpart of the exact Electron pending-worktree service plus
 * its renderer conversation-start coordinator. The reducer remains the sole
 * lifecycle authority; this class only executes emitted effects.
 */
export class CodexPendingWorktreeRuntime {
  private readonly store = new CodexPendingWorktreeStateStore();
  private readonly runtimesByPendingWorktreeId = new Map<
    string,
    CodexPendingWorktreeAttemptRuntime
  >();
  private readonly localLaunchesByPendingWorktreeId = new Map<
    string,
    CodexPendingWorktreeLocalLaunch
  >();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(private readonly dependencies: CodexPendingWorktreeRuntimeDependencies) {
    this.unsubscribe = this.store.subscribe(() => {
      this.dependencies.onChanged?.(this.store.getSnapshot());
    });
  }

  create(request: CodexPendingWorktreeRequest, createdAt = Date.now()): void {
    if (this.disposed) return;
    this.dispatch({ type: "create", request, createdAt });
  }

  list(): readonly CodexPendingWorktreeEntry[] {
    return this.store.getSnapshot();
  }

  resolveThread(clientThreadId: string): CodexPendingWorktreeThreadResolution | null {
    return this.store.resolveThread(clientThreadId);
  }

  retry(pendingWorktreeId: string): void {
    if (this.disposed) return;
    const state = this.store.getState();
    const entry = state.entriesById.get(pendingWorktreeId);
    const conversationStart = state.conversationStartsByPendingWorktreeId.get(
      pendingWorktreeId,
    );
    if (entry?.phase === "worktree-ready" && conversationStart?.value.state === "failed") {
      this.dispatch({ type: "retryConversationStart", pendingWorktreeId });
      return;
    }
    this.dispatch({ type: "retry", pendingWorktreeId });
  }

  workLocally(pendingWorktreeId: string): Promise<{ readonly threadId: string }> {
    if (this.disposed) return Promise.reject(new Error("Pending worktree runtime is shut down"));
    const existing = this.localLaunchesByPendingWorktreeId.get(pendingWorktreeId);
    if (existing) return existing.promise;

    const launch = createLocalLaunch();
    this.localLaunchesByPendingWorktreeId.set(pendingWorktreeId, launch);
    const effects = this.dispatch({ type: "workLocally", pendingWorktreeId });
    const started = effects.some((effect) =>
      effect.type === "launchConversation" && effect.includeWorktreeInit === false
    );
    if (started) return launch.promise;

    this.localLaunchesByPendingWorktreeId.delete(pendingWorktreeId);
    launch.reject(new Error(`Pending worktree cannot start locally: ${pendingWorktreeId}`));
    return launch.promise;
  }

  continueWithoutSetup(pendingWorktreeId: string): void {
    if (this.disposed) return;
    this.dispatch({ type: "continueWithoutSetup", pendingWorktreeId });
  }

  cancel(pendingWorktreeId: string): void {
    if (this.disposed) return;
    this.rejectLocalLaunch(pendingWorktreeId, new Error("Pending worktree launch canceled"));
    this.dispatch({ type: "cancel", pendingWorktreeId });
  }

  dismiss(pendingWorktreeId: string): void {
    if (this.disposed) return;
    this.rejectLocalLaunch(pendingWorktreeId, new Error("Pending worktree launch dismissed"));
    this.dispatch({ type: "dismiss", pendingWorktreeId });
  }

  rename(pendingWorktreeId: string, label: string): void {
    const nextLabel = label.trim();
    if (this.disposed || !nextLabel) return;
    this.updateMetadata(pendingWorktreeId, { type: "label", label: nextLabel });
    this.updateMetadata(pendingWorktreeId, { type: "labelEdited", labelEdited: true });
  }

  setPinned(pendingWorktreeId: string, isPinned: boolean): void {
    if (this.disposed) return;
    this.updateMetadata(pendingWorktreeId, { type: "isPinned", isPinned });
    if (!isPinned) {
      this.updateMetadata(pendingWorktreeId, {
        type: "pinnedBeforeThreadId",
        beforeThreadId: null,
      });
    }
  }

  setPinnedBeforeThreadId(
    pendingWorktreeId: string,
    beforeThreadId: string | null,
  ): void {
    if (this.disposed) return;
    this.updateMetadata(pendingWorktreeId, {
      type: "pinnedBeforeThreadId",
      beforeThreadId,
    });
  }

  clearAttention(pendingWorktreeId: string): void {
    if (this.disposed) return;
    this.updateMetadata(pendingWorktreeId, {
      type: "needsAttention",
      needsAttention: false,
    });
  }

  shutdown(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const runtime of this.runtimesByPendingWorktreeId.values()) {
      runtime.abortController.abort();
    }
    this.runtimesByPendingWorktreeId.clear();
    for (const launch of this.localLaunchesByPendingWorktreeId.values()) {
      launch.reject(new Error("Pending worktree runtime is shut down"));
    }
    this.localLaunchesByPendingWorktreeId.clear();
  }

  private dispatch(action: CodexPendingWorktreeAction): readonly CodexPendingWorktreeEffect[] {
    const effects = this.store.dispatch(action);
    for (const effect of effects) this.executeEffect(effect);
    return effects;
  }

  private executeEffect(effect: CodexPendingWorktreeEffect): void {
    if (this.disposed) return;
    switch (effect.type) {
      case "startWorktree":
        void this.startWorktree(effect.pendingWorktreeId, effect.attempt);
        return;
      case "launchConversation":
        void this.launchConversation(effect);
        return;
      case "abort":
        this.abort(effect.pendingWorktreeId);
        return;
      case "delete":
        void this.removeWorktree(effect.pendingWorktreeId, effect.worktreeGitRoot);
        return;
      case "remove":
        this.abort(effect.pendingWorktreeId);
        return;
      case "cleanupGoalSources":
        void this.cleanupGoalSources(effect.pendingWorktreeId, effect.entry);
        return;
      case "addWorkspaceRoot":
        this.addWorkspaceRoot(
          effect.pendingWorktreeId,
          effect.attempt,
          effect.workspaceRoot,
          effect.label,
        );
    }
  }

  private abort(pendingWorktreeId: string): void {
    const runtime = this.runtimesByPendingWorktreeId.get(pendingWorktreeId);
    runtime?.abortController.abort();
    this.runtimesByPendingWorktreeId.delete(pendingWorktreeId);
  }

  private isCurrentAttempt(pendingWorktreeId: string, attempt: number): boolean {
    const runtime = this.runtimesByPendingWorktreeId.get(pendingWorktreeId);
    return runtime?.attempt === attempt && !runtime.abortController.signal.aborted;
  }

  private async startWorktree(pendingWorktreeId: string, attempt: number): Promise<void> {
    const entry = this.store.getState().entriesById.get(pendingWorktreeId);
    if (!entry || entry.attempt !== attempt) return;

    const abortController = new AbortController();
    this.abort(pendingWorktreeId);
    this.runtimesByPendingWorktreeId.set(pendingWorktreeId, {
      attempt,
      abortController,
    });
    this.dispatch({ type: "start", pendingWorktreeId });

    try {
      const result = await this.dependencies.createWorktree(entry, {
        signal: abortController.signal,
        onOutput: (output) => {
          if (!this.isCurrentAttempt(pendingWorktreeId, attempt)) return;
          this.dispatch({ type: "appendOutput", pendingWorktreeId, output });
        },
        onSetupStarted: () => {
          if (!this.isCurrentAttempt(pendingWorktreeId, attempt)) return;
          this.dispatch({ type: "setupStarted", pendingWorktreeId });
        },
      });
      if (!this.isCurrentAttempt(pendingWorktreeId, attempt)) {
        await this.removeWorktree(pendingWorktreeId, result.worktreeGitRoot);
        return;
      }

      this.runtimesByPendingWorktreeId.delete(pendingWorktreeId);
      if (result.setupError) {
        this.dispatch({
          type: "setupFailed",
          pendingWorktreeId,
          errorMessage: result.setupError,
          worktreeGitRoot: result.worktreeGitRoot,
          worktreeWorkspaceRoot: result.worktreeWorkspaceRoot,
        });
        return;
      }
      this.dispatch({
        type: "worktreeReady",
        pendingWorktreeId,
        worktreeGitRoot: result.worktreeGitRoot,
        worktreeWorkspaceRoot: result.worktreeWorkspaceRoot,
      });
    } catch (error) {
      const aborted = abortController.signal.aborted;
      if (this.runtimesByPendingWorktreeId.get(pendingWorktreeId)?.attempt === attempt) {
        this.runtimesByPendingWorktreeId.delete(pendingWorktreeId);
      }
      if (aborted) return;
      this.dependencies.onError?.("create", error, pendingWorktreeId);
      this.dispatch({
        type: "worktreeFailed",
        pendingWorktreeId,
        errorMessage: errorMessage(error),
      });
    }
  }

  private async launchConversation(
    effect: Extract<CodexPendingWorktreeEffect, { readonly type: "launchConversation" }>,
  ): Promise<void> {
    const {
      attempt,
      entry,
      includeWorktreeInit,
      pendingWorktreeId,
      workspaceRoot,
    } = effect;
    const currentEntry = this.store.getState().entriesById.get(pendingWorktreeId);
    if (includeWorktreeInit) {
      if (
        !currentEntry
        || currentEntry.attempt !== attempt
        || currentEntry.phase !== "worktree-ready"
      ) {
        return;
      }
    } else {
      if (!this.localLaunchesByPendingWorktreeId.has(pendingWorktreeId)) {
        return;
      }
    }

    let mappedThreadId: string | null = null;
    const onThreadCreated = (threadId: string): void => {
      if (mappedThreadId !== null || !threadId) return;
      const state = this.store.getState();
      const current = state.entriesById.get(pendingWorktreeId);
      if (
        includeWorktreeInit
          ? !current || current.attempt !== attempt || current.phase !== "worktree-ready"
          : !this.localLaunchesByPendingWorktreeId.has(pendingWorktreeId)
      ) {
        return;
      }
      mappedThreadId = threadId;
      if (includeWorktreeInit) {
        this.dependencies.onConversationThreadMapped?.({
          entry,
          pendingWorktreeId,
          threadId,
          workspaceRoot,
        });
      }
    };

    try {
      const result = await this.dependencies.launchConversation(entry, workspaceRoot, {
        onThreadCreated,
        includeWorktreeInit,
      });
      onThreadCreated(result.threadId);
      if (includeWorktreeInit) {
        this.dispatch({
          type: "conversationStartSucceeded",
          pendingWorktreeId,
        });
      } else {
        this.resolveLocalLaunch(pendingWorktreeId, result.threadId);
      }
    } catch (error) {
      this.dependencies.onError?.("launch", error, pendingWorktreeId);
      if (mappedThreadId !== null) {
        if (includeWorktreeInit) {
          this.dispatch({
            type: "conversationStartSucceeded",
            pendingWorktreeId,
          });
        } else {
          this.resolveLocalLaunch(pendingWorktreeId, mappedThreadId);
        }
        return;
      }
      const message = errorMessage(error);
      if (includeWorktreeInit) {
        this.dispatch({
          type: "conversationStartFailed",
          pendingWorktreeId,
          errorMessage: message,
        });
      } else {
        this.rejectLocalLaunch(pendingWorktreeId, new Error(message));
      }
    }
  }

  private resolveLocalLaunch(pendingWorktreeId: string, threadId: string): void {
    const launch = this.localLaunchesByPendingWorktreeId.get(pendingWorktreeId);
    if (!launch) return;
    this.localLaunchesByPendingWorktreeId.delete(pendingWorktreeId);
    launch.resolve({ threadId });
  }

  private rejectLocalLaunch(pendingWorktreeId: string, error: Error): void {
    const launch = this.localLaunchesByPendingWorktreeId.get(pendingWorktreeId);
    if (!launch) return;
    this.localLaunchesByPendingWorktreeId.delete(pendingWorktreeId);
    launch.reject(error);
  }

  private updateMetadata(
    pendingWorktreeId: string,
    update: CodexPendingWorktreeMetadataUpdate,
  ): void {
    this.dispatch({ type: "updateMetadata", pendingWorktreeId, update });
  }

  private async removeWorktree(
    pendingWorktreeId: string,
    worktreeGitRoot: string,
  ): Promise<void> {
    try {
      await this.dependencies.removeWorktree(worktreeGitRoot);
    } catch (error) {
      this.dependencies.onError?.("remove", error, pendingWorktreeId);
    }
  }

  private async cleanupGoalSources(
    pendingWorktreeId: string,
    entry: CodexPendingWorktreeEntry,
  ): Promise<void> {
    try {
      await this.dependencies.cleanupGoalSources(entry);
    } catch (error) {
      this.dependencies.onError?.("cleanup-goal-sources", error, pendingWorktreeId);
    }
  }

  private addWorkspaceRoot(
    pendingWorktreeId: string,
    attempt: number,
    workspaceRoot: string,
    label: string,
  ): void {
    try {
      const registration = this.dependencies.addWorkspaceRoot?.(workspaceRoot, label);
      if (registration === undefined) {
        this.completeWorkspaceRootRegistration(pendingWorktreeId, attempt);
        return;
      }
      void registration.then(
        () => this.completeWorkspaceRootRegistration(pendingWorktreeId, attempt),
        (error) => this.failWorkspaceRootRegistration(pendingWorktreeId, attempt, error),
      );
    } catch (error) {
      this.failWorkspaceRootRegistration(pendingWorktreeId, attempt, error);
    }
  }

  private completeWorkspaceRootRegistration(pendingWorktreeId: string, attempt: number): void {
    if (this.disposed) return;
    this.dispatch({ type: "workspaceRootAdded", pendingWorktreeId, attempt });
  }

  private failWorkspaceRootRegistration(
    pendingWorktreeId: string,
    attempt: number,
    error: unknown,
  ): void {
    if (this.disposed) return;
    this.dispatch({
      type: "workspaceRootAddFailed",
      pendingWorktreeId,
      attempt,
      errorMessage: errorMessage(error),
    });
    this.dependencies.onError?.("add-workspace-root", error, pendingWorktreeId);
  }
}
