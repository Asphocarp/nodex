import {
  CodexCommandOutputQueue,
  type CodexCommandOutputUpdate,
} from "../../shared/codex-conversation-state/codex-command-output-queue";
import {
  CodexFrameTextDeltaQueue,
  createCodexFrameTextDeltaTimeoutScheduler,
  type CodexFrameTextDeltaUpdate,
} from "../../shared/codex-conversation-state/codex-frame-text-delta-queue";
import type { CodexConversationDeltaBufferRuntimePromiseAdapter } from "../codex-application/CodexConversationDeltaBufferRuntime";

export interface TestCodexConversationDeltaBufferRuntimeOptions {
  readonly flushFrameText: (updates: readonly CodexFrameTextDeltaUpdate[]) => void;
  readonly flushCommandOutput: (updates: readonly CodexCommandOutputUpdate[]) => void;
}

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexConversationDeltaBufferRuntime implements CodexConversationDeltaBufferRuntimePromiseAdapter {
  readonly #frameText: CodexFrameTextDeltaQueue;
  readonly #commandOutput: CodexCommandOutputQueue;

  constructor(options: TestCodexConversationDeltaBufferRuntimeOptions) {
    this.#frameText = new CodexFrameTextDeltaQueue({
      scheduler: createCodexFrameTextDeltaTimeoutScheduler(),
      onFlush: options.flushFrameText,
    });
    this.#commandOutput = new CodexCommandOutputQueue({
      onFlush: options.flushCommandOutput,
    });
  }

  enqueueFrameText(update: CodexFrameTextDeltaUpdate): void {
    this.#frameText.enqueue(update);
  }

  enqueueCommandOutput(update: CodexCommandOutputUpdate): void {
    this.#commandOutput.enqueue(update);
  }

  drainFrameText(_conversationId: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.#frameText.drainBefore(resolve)) resolve();
    });
  }

  clear(conversationId: string): void {
    this.#frameText.discardConversation(conversationId);
    this.#commandOutput.discardConversation(conversationId);
  }

  dispose(): void {
    this.#frameText.dispose();
    this.#commandOutput.dispose();
  }
}
