import type { CodexThreadTitlePersistenceInput } from "../codex-application/CodexThreadTitlePersistence";
import type { CodexThreadTitlePersistencePromiseAdapter } from "../codex-application/CodexThreadTitlePersistencePromiseAdapter";

export interface TestCodexThreadTitlePersistenceOptions {
  readonly setRemote: (input: CodexThreadTitlePersistenceInput) => Promise<void>;
  readonly persistWorkspace: (input: CodexThreadTitlePersistenceInput) => Promise<void>;
}

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexThreadTitlePersistence implements CodexThreadTitlePersistencePromiseAdapter {
  private readonly pendingByThreadId = new Map<string, Promise<void>>();

  constructor(private readonly options: TestCodexThreadTitlePersistenceOptions) {}

  persistBestEffort(input: CodexThreadTitlePersistenceInput): Promise<void> {
    return this.runSerial(input, async () => {
      await this.options.setRemote(input).catch(() => undefined);
      await this.options.persistWorkspace(input).catch(() => undefined);
    });
  }

  persistRequired(input: CodexThreadTitlePersistenceInput): Promise<void> {
    return this.runSerial(input, async () => {
      await this.options.setRemote(input);
      await this.options.persistWorkspace(input);
    });
  }

  private runSerial(
    input: CodexThreadTitlePersistenceInput,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.pendingByThreadId.get(input.threadId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    this.pendingByThreadId.set(input.threadId, pending);
    return pending.finally(() => {
      if (this.pendingByThreadId.get(input.threadId) === pending) {
        this.pendingByThreadId.delete(input.threadId);
      }
    });
  }
}
