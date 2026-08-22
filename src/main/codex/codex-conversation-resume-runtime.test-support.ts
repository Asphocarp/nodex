import type {
  CodexConversationResumeDemand,
  CodexConversationResumeInput,
} from "../codex-application/CodexConversationResumeRuntime";
import type { CodexConversationResumeRuntimePromiseAdapter } from "../codex-application/CodexConversationResumeRuntimePromiseAdapter";
import type { CodexConversationSnapshot } from "../../shared/types";

interface TestCodexConversationResumeRuntimeOptions {
  readonly run: (input: CodexConversationResumeDemand) => Promise<CodexConversationSnapshot | null>;
}

interface ActiveResume {
  readonly demand: CodexConversationResumeDemand;
  readonly promise: Promise<CodexConversationSnapshot | null>;
}

const normalize = (input: CodexConversationResumeInput): CodexConversationResumeDemand => ({
  threadId: input.threadId,
  syncDormantConversationSnapshots: input.syncDormantConversationSnapshots !== false,
  replayBufferedNotifications: input.replayBufferedNotifications !== false,
});

const sameDemand = (
  left: CodexConversationResumeDemand,
  right: CodexConversationResumeDemand,
): boolean =>
  left.syncDormantConversationSnapshots === right.syncDormantConversationSnapshots &&
  left.replayBufferedNotifications === right.replayBufferedNotifications;

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexConversationResumeRuntime implements CodexConversationResumeRuntimePromiseAdapter {
  readonly #active = new Map<string, ActiveResume>();

  constructor(private readonly options: TestCodexConversationResumeRuntimeOptions) {}

  async resume(input: CodexConversationResumeInput): Promise<CodexConversationSnapshot | null> {
    const demand = normalize(input);
    const existing = this.#active.get(demand.threadId);
    if (existing) {
      const result = await existing.promise;
      if (sameDemand(existing.demand, demand)) return result;
      return await this.resume(demand);
    }

    const promise = this.options.run(demand);
    const active = { demand, promise };
    this.#active.set(demand.threadId, active);
    try {
      return await promise;
    } finally {
      if (this.#active.get(demand.threadId) === active) this.#active.delete(demand.threadId);
    }
  }

  clear(threadId: string): void {
    this.#active.delete(threadId);
  }

  dispose(): void {
    this.#active.clear();
  }
}
