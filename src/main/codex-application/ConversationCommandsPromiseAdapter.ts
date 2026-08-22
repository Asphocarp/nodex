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
});
