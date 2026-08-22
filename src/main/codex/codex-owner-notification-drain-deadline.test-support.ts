import type { CodexOwnerNotificationDrainDeadlineLegacyPort } from "../codex-application/CodexOwnerNotificationDrainDeadline";

interface TestCodexOwnerNotificationDrainDeadlineOptions {
  readonly timeoutMs: number;
  readonly onTimeout: (conversationId: string, sentSequence: number, ackSequence: number) => void;
}

/** Synchronous timer fixture for legacy CodexService integration tests only. */
export class TestCodexOwnerNotificationDrainDeadline implements CodexOwnerNotificationDrainDeadlineLegacyPort {
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: TestCodexOwnerNotificationDrainDeadlineOptions) {}

  schedule(conversationId: string, sentSequence: number, ackSequence: number): void {
    if (this.#timers.has(conversationId)) return;
    this.#timers.set(
      conversationId,
      setTimeout(() => {
        this.#timers.delete(conversationId);
        this.options.onTimeout(conversationId, sentSequence, ackSequence);
      }, this.options.timeoutMs),
    );
  }

  clear(conversationId: string): void {
    const timer = this.#timers.get(conversationId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(conversationId);
  }

  dispose(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }
}
