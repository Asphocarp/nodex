import type { CodexQueuedFollowUp } from "../../shared/types";
import type { CodexQueuedFollowUpDispatchRuntime } from "../codex-application/CodexQueuedFollowUpDispatchRuntime";

type CodexQueuedFollowUpDispatchService = CodexQueuedFollowUpDispatchRuntime["Service"];

export interface TestCodexQueuedFollowUpDispatchRuntimeOptions {
  readonly isEligible: (threadId: string) => boolean;
  readonly take: (threadId: string) => CodexQueuedFollowUp | null;
  readonly submit: (threadId: string, followUp: CodexQueuedFollowUp) => Promise<void>;
  readonly restore: (threadId: string, followUp: CodexQueuedFollowUp, reason: string) => void;
}

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexQueuedFollowUpDispatchRuntime implements CodexQueuedFollowUpDispatchService {
  private readonly active = new Map<string, symbol>();

  constructor(private readonly options: TestCodexQueuedFollowUpDispatchRuntimeOptions) {}

  request(threadId: string): void {
    if (!this.options.isEligible(threadId) || this.active.has(threadId)) return;
    const followUp = this.options.take(threadId);
    if (!followUp) return;
    const token = Symbol(threadId);
    this.active.set(threadId, token);
    void this.options
      .submit(threadId, followUp)
      .catch((error: unknown) => {
        if (this.active.get(threadId) !== token) return;
        this.options.restore(
          threadId,
          followUp,
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (this.active.get(threadId) === token) this.active.delete(threadId);
      });
  }

  clear(threadId: string): void {
    this.active.delete(threadId);
  }
}
