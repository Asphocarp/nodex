import type {
  CodexConversationResumeDemand,
  CodexConversationResumeInput,
  CodexConversationResumeRendererAdoption,
  CodexConversationResumeRendererState,
} from "../codex-application/CodexConversationResumeRuntime";
import type { CodexConversationResumeRuntimePromiseAdapter } from "../codex-application/CodexConversationResumeRuntimePromiseAdapter";
import type {
  CodexConversationSnapshot,
  CodexRendererConversationResumeResult,
} from "../../shared/types";

interface TestCodexConversationResumeRuntimeOptions {
  readonly run: (input: CodexConversationResumeDemand) => Promise<CodexConversationSnapshot | null>;
  readonly snapshot: (threadId: string) => Promise<CodexConversationSnapshot | null>;
  readonly readRendererState: (
    threadId: string,
  ) => CodexConversationResumeRendererState | Promise<CodexConversationResumeRendererState>;
  readonly isRendererClientDisposed: (clientId: string) => boolean | Promise<boolean>;
  readonly adoptRenderer: (input: {
    readonly threadId: string;
    readonly ownerClientId: string;
    readonly conversation: CodexConversationSnapshot;
  }) => CodexConversationResumeRendererAdoption | Promise<CodexConversationResumeRendererAdoption>;
  readonly releaseBuffer: (threadId: string) => Promise<boolean>;
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
  readonly #rendererTails = new Map<string, Promise<void>>();

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

  snapshot(threadId: string): Promise<CodexConversationSnapshot | null> {
    return this.options.snapshot(threadId);
  }

  async #runRendererSerial<A>(threadId: string, operation: () => Promise<A>): Promise<A> {
    const previous = this.#rendererTails.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const fence = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch(() => undefined).then(() => fence);
    this.#rendererTails.set(threadId, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#rendererTails.get(threadId) === current) this.#rendererTails.delete(threadId);
    }
  }

  async resumeForRenderer(
    threadId: string,
    ownerClientId: string,
  ): Promise<CodexRendererConversationResumeResult | null> {
    return await this.#runRendererSerial(threadId, async () => {
      const follower = (
        ownerId: string,
        state: CodexConversationResumeRendererState,
      ): CodexRendererConversationResumeResult | null => {
        if (!state.acceptedConversation) return null;
        if (!state.checkpoint) {
          throw new Error(`Accepted follower replica is unavailable for '${threadId}'`);
        }
        return {
          role: "follower",
          conversation: state.acceptedConversation,
          revision: state.revision,
          ownerClientId: ownerId,
          checkpoint: state.checkpoint,
        };
      };
      const before = await this.options.readRendererState(threadId);
      if (before.freshLaunchOwnerClientId && !before.ownerClientId) {
        if (before.freshLaunchOwnerClientId === ownerClientId) return null;
        return follower(before.freshLaunchOwnerClientId, before);
      }
      if (before.ownerClientId && before.ownerClientId !== ownerClientId) {
        return follower(before.ownerClientId, before);
      }
      if (await this.options.isRendererClientDisposed(ownerClientId)) {
        throw new Error(`Renderer client '${ownerClientId}' is unavailable`);
      }
      const existing =
        before.ownerClientId === ownerClientId && before.resumeState !== "needs_resume"
          ? (before.acceptedConversation ?? before.serializedConversation)
          : null;
      const conversation =
        existing ??
        (await this.resume({
          threadId,
          syncDormantConversationSnapshots: false,
          replayBufferedNotifications: false,
        }));
      if (!conversation || conversation.resumeState !== "resumed") return null;

      const afterResume = await this.options.readRendererState(threadId);
      if (afterResume.ownerClientId && afterResume.ownerClientId !== ownerClientId) {
        return follower(afterResume.ownerClientId, afterResume);
      }
      if (await this.options.isRendererClientDisposed(ownerClientId)) {
        throw new Error(`Renderer client '${ownerClientId}' became unavailable during resume`);
      }
      const adoption = await this.options.adoptRenderer({
        threadId,
        ownerClientId,
        conversation,
      });
      if (adoption.ownerClientId !== ownerClientId) {
        throw new Error(
          `Renderer client '${ownerClientId}' could not adopt conversation '${threadId}'`,
        );
      }
      if (!adoption.checkpoint) {
        throw new Error(`Accepted owner replica is unavailable for '${threadId}'`);
      }
      return {
        role: "owner",
        conversation,
        revision: adoption.revision,
        checkpoint: adoption.checkpoint,
      };
    });
  }

  releaseBuffer(threadId: string): Promise<boolean> {
    return this.#runRendererSerial(threadId, () => this.options.releaseBuffer(threadId));
  }

  clear(threadId: string): void {
    this.#active.delete(threadId);
  }

  dispose(): void {
    this.#active.clear();
    this.#rendererTails.clear();
  }
}
