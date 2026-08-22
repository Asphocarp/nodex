import type * as Effect from "effect/Effect";
import type { CodexConversationThreadSettings } from "../../shared/types";
import type {
  CodexThreadSettingsUpdateCommand,
  CodexThreadSettingsUpdateSupport,
} from "../codex-application/CodexThreadSettingsRuntime";
import type { CodexThreadSettingsRuntimePromiseAdapter } from "../codex-application/CodexThreadSettingsRuntimePromiseAdapter";

type UpdateOperation = (
  input: CodexThreadSettingsUpdateCommand,
  signal: AbortSignal,
) => Promise<CodexConversationThreadSettings>;

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexThreadSettingsRuntime implements CodexThreadSettingsRuntimePromiseAdapter {
  private readonly pendingByThreadId = new Map<string, Promise<unknown>>();
  private support: CodexThreadSettingsUpdateSupport = "unknown";
  private updateOperation: UpdateOperation = async () => {
    throw new Error("Thread settings update is unavailable in this fixture");
  };

  setUpdateOperation(operation: UpdateOperation): void {
    this.updateOperation = operation;
  }

  update(
    input: CodexThreadSettingsUpdateCommand,
    options?: Effect.RunOptions,
  ): Promise<CodexConversationThreadSettings> {
    return this.enqueue(input.threadId, (signal) => this.updateOperation(input, signal), options);
  }

  /** Test-only admission hook for exercising consumers that wait on the settings lane. */
  holdMutation<A>(threadId: string, mutation: (signal: AbortSignal) => Promise<A>): Promise<A> {
    return this.enqueue(threadId, mutation);
  }

  private enqueue<A>(
    threadId: string,
    mutation: (signal: AbortSignal) => Promise<A>,
    options?: Effect.RunOptions,
  ): Promise<A> {
    const previous = this.pendingByThreadId.get(threadId) ?? Promise.resolve();
    const controller = new AbortController();
    const callerSignal = options?.signal;
    const abort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) abort();
    callerSignal?.addEventListener("abort", abort, { once: true });
    const pending = previous.catch(() => undefined).then(() => mutation(controller.signal));
    this.pendingByThreadId.set(threadId, pending);
    return pending.finally(() => {
      callerSignal?.removeEventListener("abort", abort);
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
