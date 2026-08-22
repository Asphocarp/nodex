import type { CodexActiveGoalContinuationLegacyPort } from "../codex-application/CodexActiveGoalContinuation";

interface TestCodexActiveGoalContinuationOptions {
  readonly isEligible: (conversationId: string) => boolean;
  readonly continueGoal: (conversationId: string) => Promise<void>;
  readonly delayMs: number;
}

interface PendingDelay {
  readonly timer: ReturnType<typeof setTimeout>;
  readonly release: () => void;
}

/** Synchronous timer fixture for legacy CodexService integration tests only. */
export class TestCodexActiveGoalContinuation implements CodexActiveGoalContinuationLegacyPort {
  readonly #continuations = new Map<string, Promise<void>>();
  readonly #delays = new Map<string, PendingDelay>();
  #accepting = true;

  constructor(private readonly options: TestCodexActiveGoalContinuationOptions) {}

  request(conversationId: string): void {
    const existing = this.#continuations.get(conversationId);
    if (existing) return;
    if (!this.#accepting || !this.options.isEligible(conversationId)) return;

    const delay = new Promise<void>((resolve) => {
      const release = () => {
        this.#delays.delete(conversationId);
        resolve();
      };
      const timer = setTimeout(release, Math.max(0, this.options.delayMs));
      this.#delays.set(conversationId, { timer, release });
    });
    const continuation = delay
      .then(async () => {
        if (
          !this.#accepting ||
          this.#continuations.get(conversationId) !== continuation ||
          !this.options.isEligible(conversationId)
        )
          return;
        await this.options.continueGoal(conversationId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.#continuations.get(conversationId) === continuation) {
          this.#continuations.delete(conversationId);
        }
      });
    this.#continuations.set(conversationId, continuation);
  }

  clear(conversationId: string): void {
    const delay = this.#delays.get(conversationId);
    if (delay) {
      clearTimeout(delay.timer);
      delay.release();
    }
    this.#delays.delete(conversationId);
    this.#continuations.delete(conversationId);
  }

  dispose(): void {
    this.#accepting = false;
    for (const delay of this.#delays.values()) {
      clearTimeout(delay.timer);
      delay.release();
    }
    this.#delays.clear();
    this.#continuations.clear();
  }
}
