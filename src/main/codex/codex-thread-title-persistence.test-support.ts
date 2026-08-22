import {
  type CodexThreadTitlePersistenceInput,
  type CodexThreadTitleSetCommand,
} from "../codex-application/CodexThreadTitlePersistence";
import type { CodexThreadTitlePersistencePromiseAdapter } from "../codex-application/CodexThreadTitlePersistencePromiseAdapter";
import { normalizeCodexManualThreadTitle } from "../../shared/codex-thread-title";

export interface TestCodexThreadTitlePersistenceOptions {
  readonly project: (input: CodexThreadTitleSetCommand) => Promise<void> | void;
  readonly setRemote: (input: CodexThreadTitlePersistenceInput) => Promise<void>;
  readonly persistWorkspace: (input: CodexThreadTitlePersistenceInput) => Promise<void>;
}

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexThreadTitlePersistence implements CodexThreadTitlePersistencePromiseAdapter {
  private readonly pendingByThreadId = new Map<string, Promise<void>>();

  constructor(private readonly options: TestCodexThreadTitlePersistenceOptions) {}

  set(input: CodexThreadTitleSetCommand): Promise<boolean> {
    const name =
      input.normalization === "manual"
        ? normalizeCodexManualThreadTitle(input.name)
        : input.name.trim();
    if (!name) return Promise.resolve(false);
    return this.runSerial({ threadId: input.threadId, name }, async () => {
      await this.options.project({ ...input, name });
      await this.options.setRemote({ threadId: input.threadId, name }).catch(() => undefined);
      await this.options
        .persistWorkspace({ threadId: input.threadId, name })
        .catch(() => undefined);
    }).then(() => true);
  }

  setRequired(input: CodexThreadTitleSetCommand): Promise<boolean> {
    const name =
      input.normalization === "manual"
        ? normalizeCodexManualThreadTitle(input.name)
        : input.name.trim();
    if (!name) return Promise.resolve(false);
    return this.runSerial({ threadId: input.threadId, name }, async () => {
      await this.options.project({ ...input, name });
      await this.options.setRemote({ threadId: input.threadId, name });
      await this.options.persistWorkspace({ threadId: input.threadId, name });
    }).then(() => true);
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
