import type {
  CodexRendererOwnerCleanupReason,
  CodexRendererOwnerRetentionLegacyPort,
} from "../codex-application/CodexRendererOwnerRetention";

interface TestCodexRendererOwnerRetentionOptions {
  readonly isCandidate: (conversationId: string) => boolean;
  readonly cleanup: (
    conversationId: string,
    reason: CodexRendererOwnerCleanupReason,
  ) => Promise<void>;
  readonly retentionMs: number;
  readonly maxRetained: number;
  readonly retryMs: number;
}

/** Synchronous timer fixture for legacy CodexService integration tests only. */
export class TestCodexRendererOwnerRetention implements CodexRendererOwnerRetentionLegacyPort {
  readonly #candidateSince = new Map<string, number>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #rechecks = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #inFlight = new Set<string>();

  constructor(private readonly options: TestCodexRendererOwnerRetentionOptions) {}

  reconcile(conversationId: string): void {
    if (!this.options.isCandidate(conversationId)) {
      this.clear(conversationId);
      return;
    }
    const candidateSince = this.#candidateSince.get(conversationId) ?? Date.now();
    this.#candidateSince.set(conversationId, candidateSince);
    if (!this.#timers.has(conversationId) && !this.#inFlight.has(conversationId)) {
      this.#schedule(
        conversationId,
        Math.max(0, this.options.retentionMs - (Date.now() - candidateSince)),
        "inactive-owner-retention",
      );
    }
    const candidates = [...this.#candidateSince]
      .filter(([id]) => this.options.isCandidate(id))
      .sort((left, right) => {
        const since = left[1] - right[1];
        return since !== 0 ? since : left[0].localeCompare(right[0]);
      });
    const overflow = candidates.length - this.options.maxRetained;
    for (const [id] of candidates.slice(0, Math.max(0, overflow))) {
      this.#clearTimer(id);
      void this.#cleanup(id, "inactive-owner-retained-limit");
    }
  }

  recheckAfter(conversationId: string, delayMs: number): void {
    const existing = this.#rechecks.get(conversationId);
    if (existing) clearTimeout(existing);
    this.#rechecks.set(
      conversationId,
      setTimeout(
        () => {
          this.#rechecks.delete(conversationId);
          this.reconcile(conversationId);
        },
        Math.max(0, delayMs),
      ),
    );
  }

  clear(conversationId: string): void {
    this.#candidateSince.delete(conversationId);
    this.#clearTimer(conversationId);
    const recheck = this.#rechecks.get(conversationId);
    if (recheck) clearTimeout(recheck);
    this.#rechecks.delete(conversationId);
  }

  dispose(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    for (const recheck of this.#rechecks.values()) clearTimeout(recheck);
    this.#timers.clear();
    this.#rechecks.clear();
    this.#candidateSince.clear();
  }

  #schedule(
    conversationId: string,
    delayMs: number,
    reason: CodexRendererOwnerCleanupReason,
  ): void {
    this.#timers.set(
      conversationId,
      setTimeout(
        () => {
          this.#timers.delete(conversationId);
          void this.#cleanup(conversationId, reason);
        },
        Math.max(0, delayMs),
      ),
    );
  }

  async #cleanup(conversationId: string, reason: CodexRendererOwnerCleanupReason): Promise<void> {
    if (this.#inFlight.has(conversationId) || !this.options.isCandidate(conversationId)) return;
    this.#inFlight.add(conversationId);
    try {
      await this.options.cleanup(conversationId, reason);
      this.#candidateSince.delete(conversationId);
    } catch {
      if (this.options.isCandidate(conversationId)) {
        this.#schedule(conversationId, this.options.retryMs, "inactive-owner-retry");
      }
    } finally {
      this.#inFlight.delete(conversationId);
    }
  }

  #clearTimer(conversationId: string): void {
    const timer = this.#timers.get(conversationId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(conversationId);
  }
}
