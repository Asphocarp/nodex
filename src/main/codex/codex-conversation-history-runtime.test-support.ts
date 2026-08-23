import type { CodexConversationHistoryLoadInput } from "../codex-application/CodexConversationHistoryRuntime";
import type { CodexConversationHistoryRuntimePromiseAdapter } from "../codex-application/CodexConversationHistoryRuntimePromiseAdapter";
import type { CodexConversationSnapshot } from "../../shared/types";

export interface TestCodexConversationHistoryRuntimeOptions {
  readonly shouldLoadRemaining: (threadId: string) => boolean;
  readonly load: (input: CodexConversationHistoryLoadInput) => Promise<void>;
  readonly snapshot: (threadId: string) => CodexConversationSnapshot | null;
}

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexConversationHistoryRuntime implements CodexConversationHistoryRuntimePromiseAdapter {
  private readonly active = new Map<
    string,
    { readonly promise: Promise<void>; readonly loadCompleteHistory: boolean }
  >();

  constructor(private readonly options: TestCodexConversationHistoryRuntimeOptions) {}

  async loadPage(threadId: string): Promise<CodexConversationSnapshot | null> {
    await this.load({ threadId, loadCompleteHistory: false, broadcastResult: true });
    return this.options.snapshot(threadId);
  }

  async loadComplete(
    threadId: string,
    broadcastResult: boolean,
  ): Promise<CodexConversationSnapshot | null> {
    await this.load({ threadId, loadCompleteHistory: true, broadcastResult });
    return this.options.snapshot(threadId);
  }

  requestRemaining(threadId: string): void {
    if (!this.options.shouldLoadRemaining(threadId)) return;
    void this.loadComplete(threadId, true).catch(() => undefined);
  }

  clear(threadId: string): void {
    this.active.delete(threadId);
  }

  private async load(input: CodexConversationHistoryLoadInput): Promise<void> {
    const existing = this.active.get(input.threadId);
    if (existing) {
      await existing.promise;
      if (input.loadCompleteHistory && !existing.loadCompleteHistory) {
        await this.load(input);
      }
      return;
    }

    const promise = this.options.load(input);
    this.active.set(input.threadId, {
      promise,
      loadCompleteHistory: input.loadCompleteHistory,
    });
    try {
      await promise;
    } finally {
      if (this.active.get(input.threadId)?.promise === promise) {
        this.active.delete(input.threadId);
      }
    }
  }
}
