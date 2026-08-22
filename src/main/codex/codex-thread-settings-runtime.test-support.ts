import type { CodexThreadSettingsRuntimePromiseAdapter } from "../codex-application/CodexThreadSettingsRuntimePromiseAdapter";
import type { CodexThreadSettingsUpdateSupport } from "../codex-application/CodexThreadSettingsRuntime";

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexThreadSettingsRuntime implements CodexThreadSettingsRuntimePromiseAdapter {
  private readonly pendingByThreadId = new Map<string, Promise<unknown>>();
  private support: CodexThreadSettingsUpdateSupport = "unknown";

  runMutation<A>(threadId: string, mutation: (signal: AbortSignal) => Promise<A>): Promise<A> {
    const previous = this.pendingByThreadId.get(threadId) ?? Promise.resolve();
    const controller = new AbortController();
    const pending = previous.catch(() => undefined).then(() => mutation(controller.signal));
    this.pendingByThreadId.set(threadId, pending);
    return pending.finally(() => {
      if (this.pendingByThreadId.get(threadId) === pending) {
        this.pendingByThreadId.delete(threadId);
      }
    });
  }

  async awaitCurrent(threadId: string): Promise<void> {
    await this.pendingByThreadId.get(threadId);
  }

  remoteUpdateSupport(): CodexThreadSettingsUpdateSupport {
    return this.support;
  }

  recordRemoteUpdateSupported(): void {
    if (this.support === "unsupported") return;
    this.support = "supported";
  }

  recordRemoteUpdateUnsupported(): void {
    this.support = "unsupported";
  }
}
