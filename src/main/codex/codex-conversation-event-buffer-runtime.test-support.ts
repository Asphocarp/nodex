import type {
  CodexBufferedConversationEvent,
  CodexBufferedConversationRequestCompletion,
  CodexConversationEventBufferRuntimeOptions,
} from "../codex-application/CodexConversationEventBufferRuntime";
import type { CodexConversationEventBufferRuntimePromiseAdapter } from "../codex-application/CodexConversationEventBufferRuntimePromiseAdapter";

interface TestCodexConversationEventBufferRuntimeOptions {
  readonly compact: CodexConversationEventBufferRuntimeOptions["compact"];
  readonly replayNotification: (
    input: Parameters<CodexConversationEventBufferRuntimeOptions["replayNotification"]>[0],
  ) => Promise<void>;
  readonly replayRequest: (
    input: Parameters<CodexConversationEventBufferRuntimeOptions["replayRequest"]>[0],
  ) => Promise<void>;
  readonly reportThreadStartReplayFailure?: CodexConversationEventBufferRuntimeOptions["reportThreadStartReplayFailure"];
}

const rejectRequests = (
  events: Iterable<CodexBufferedConversationEvent>,
  reason: unknown,
): void => {
  for (const event of events) {
    if (event.type === "request") event.reject(reason);
  }
};

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexConversationEventBufferRuntime implements CodexConversationEventBufferRuntimePromiseAdapter {
  readonly #resume = new Map<string, CodexBufferedConversationEvent[]>();
  readonly #threadStart = new Map<string, CodexBufferedConversationEvent[]>();
  readonly #deferredThreadStarts = new Set<string>();
  readonly #readyThreadStarts = new Set<string>();
  #threadStartDeferralDepth = 0;
  #closed = false;

  constructor(private readonly options: TestCodexConversationEventBufferRuntimeOptions) {}

  beginResume(threadId: string): boolean {
    if (this.#closed || this.#resume.has(threadId)) return false;
    this.#resume.set(threadId, []);
    return true;
  }

  hasResume(threadId: string): boolean {
    return this.#resume.has(threadId);
  }

  beginThreadStartDeferral(): void {
    if (!this.#closed) this.#threadStartDeferralDepth += 1;
  }

  offerNotification(
    input: Parameters<CodexConversationEventBufferRuntimePromiseAdapter["offerNotification"]>[0],
  ): boolean {
    if (this.#closed) return false;
    const resume = input.bypassResume ? undefined : this.#resume.get(input.threadId);
    if (resume) {
      resume.push({ type: "notification", notification: input.notification });
      return true;
    }
    const threadStart = this.#threadStart.get(input.threadId);
    if (threadStart) {
      threadStart.push({ type: "notification", notification: input.notification });
      return true;
    }
    if (
      !input.startsThread ||
      this.#threadStartDeferralDepth === 0 ||
      this.#readyThreadStarts.has(input.threadId)
    ) {
      return false;
    }
    this.#deferredThreadStarts.add(input.threadId);
    this.#threadStart.set(input.threadId, [
      { type: "notification", notification: input.notification },
    ]);
    return true;
  }

  offerRequest(
    input: Parameters<CodexConversationEventBufferRuntimePromiseAdapter["offerRequest"]>[0],
  ): boolean {
    if (this.#closed) return false;
    const buffer = this.#resume.get(input.threadId) ?? this.#threadStart.get(input.threadId);
    if (!buffer) return false;
    const completion: CodexBufferedConversationRequestCompletion = input.completion();
    buffer.push({ type: "request", request: input.request, ...completion });
    return true;
  }

  async #replay(
    phase: "resume" | "thread-start",
    threadId: string,
    events: readonly CodexBufferedConversationEvent[],
  ): Promise<void> {
    for (const event of this.options.compact(threadId, events)) {
      if (event.type === "request") {
        const outer = this.#threadStart.get(threadId);
        if (outer) outer.push(event);
        else await this.options.replayRequest({ phase, threadId, event });
        continue;
      }
      if (phase === "resume") {
        await this.options.replayNotification({
          phase,
          threadId,
          notification: event.notification,
        });
        continue;
      }
      try {
        await this.options.replayNotification({
          phase,
          threadId,
          notification: event.notification,
        });
      } catch (cause) {
        this.options.reportThreadStartReplayFailure?.({ threadId, cause });
      }
    }
  }

  async releaseResume(threadId: string): Promise<void> {
    const events = this.#resume.get(threadId);
    this.#resume.delete(threadId);
    if (events) await this.#replay("resume", threadId, events);
  }

  async #releaseThreadStart(threadId: string): Promise<void> {
    if (!this.#deferredThreadStarts.delete(threadId)) return;
    const events = this.#threadStart.get(threadId) ?? [];
    this.#threadStart.delete(threadId);
    await this.#replay("thread-start", threadId, events);
  }

  async completeThreadStartDeferral(threadId: string | null): Promise<void> {
    if (!threadId || this.#closed) return;
    this.#readyThreadStarts.add(threadId);
    await this.#releaseThreadStart(threadId);
  }

  async endThreadStartDeferral(): Promise<void> {
    if (this.#closed || this.#threadStartDeferralDepth <= 0) return;
    this.#threadStartDeferralDepth -= 1;
    if (this.#threadStartDeferralDepth > 0) return;
    for (const threadId of [...this.#deferredThreadStarts]) {
      await this.#releaseThreadStart(threadId);
    }
    if (this.#threadStartDeferralDepth === 0) this.#readyThreadStarts.clear();
  }

  discardResume(threadId: string, reason: unknown): void {
    const events = this.#resume.get(threadId);
    this.#resume.delete(threadId);
    if (events) rejectRequests(events, reason);
  }

  clear(threadId: string, reason: unknown): void {
    this.discardResume(threadId, reason);
    const events = this.#threadStart.get(threadId);
    this.#threadStart.delete(threadId);
    this.#deferredThreadStarts.delete(threadId);
    this.#readyThreadStarts.delete(threadId);
    if (events) rejectRequests(events, reason);
  }

  async shutdown(reason: unknown): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const events of this.#resume.values()) rejectRequests(events, reason);
    for (const events of this.#threadStart.values()) rejectRequests(events, reason);
    this.#resume.clear();
    this.#threadStart.clear();
    this.#deferredThreadStarts.clear();
    this.#readyThreadStarts.clear();
    this.#threadStartDeferralDepth = 0;
  }
}
