import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  ConversationCommandProjectionError,
  type ConversationCommands,
} from "./ConversationCommands";

export interface ConversationCommandsPromiseAdapter {
  readonly archive: (threadId: string) => Promise<boolean>;
  readonly unarchive: (
    threadId: string,
  ) => Promise<import("../../shared/types").CodexThreadSummary | null>;
  readonly interrupt: (
    threadId: string,
    turnId?: string,
    options?: { readonly syncDormantConversationUpdates?: boolean },
  ) => Promise<boolean>;
}

const unwrapProjectionError = (error: unknown): never => {
  if (error instanceof ConversationCommandProjectionError) throw error.cause;
  throw error;
};

/** Promise projection for transitional Codex consumers; it owns no ordering or lifecycle. */
export const makeConversationCommandsPromiseAdapter = (
  commands: ConversationCommands["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): ConversationCommandsPromiseAdapter => ({
  archive: (threadId) =>
    callbacks.runPromise(commands.archive(threadId)).catch(unwrapProjectionError),
  unarchive: (threadId) =>
    callbacks.runPromise(commands.unarchive(threadId)).catch(unwrapProjectionError),
  interrupt: (threadId, turnId, options) =>
    callbacks
      .runPromise(commands.interrupt(threadId, turnId, options))
      .catch(unwrapProjectionError),
});
