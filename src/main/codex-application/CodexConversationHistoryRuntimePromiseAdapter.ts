import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexConversationHistoryError,
  type CodexConversationHistoryRuntime,
} from "./CodexConversationHistoryRuntime";

export interface CodexConversationHistoryRuntimePromiseAdapter {
  readonly loadPage: (threadId: string) => Promise<void>;
  readonly loadComplete: (threadId: string, broadcastResult: boolean) => Promise<void>;
  readonly requestRemaining: (threadId: string) => void;
  readonly clear: (threadId: string) => void;
}

const unwrapHistoryError = (error: unknown): never => {
  if (error instanceof CodexConversationHistoryError) throw error.cause;
  throw error;
};

/** Awaited Promise projection for legacy CodexService pagination call sites. */
export const makeCodexConversationHistoryRuntimePromiseAdapter = (
  runtime: CodexConversationHistoryRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexConversationHistoryRuntimePromiseAdapter => ({
  loadPage: (threadId) =>
    callbacks.runPromise(runtime.loadPage(threadId)).catch(unwrapHistoryError),
  loadComplete: (threadId, broadcastResult) =>
    callbacks.runPromise(runtime.loadComplete(threadId, broadcastResult)).catch(unwrapHistoryError),
  requestRemaining: runtime.requestRemaining,
  clear: runtime.clear,
});
