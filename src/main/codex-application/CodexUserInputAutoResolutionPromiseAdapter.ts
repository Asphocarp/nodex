import * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type {
  CodexUserInputAutoResolution,
  CodexUserInputAutoResolutionLegacyPort,
} from "./CodexUserInputAutoResolution";
import { CodexUserInputAutoResolutionError } from "./CodexUserInputAutoResolution";

/** Temporary projection for synchronous Codex application callbacks during the class cut-over. */
export const makeCodexUserInputAutoResolutionPromiseAdapter = (
  runtime: CodexUserInputAutoResolution["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): CodexUserInputAutoResolutionLegacyPort => ({
  observeRequest: (conversationId, requestId, resolve) => {
    callbacks.fork(
      runtime.observeRequest(
        conversationId,
        requestId,
        Effect.tryPromise({
          try: resolve,
          catch: (cause) => new CodexUserInputAutoResolutionError({ cause }),
        }),
      ),
    );
  },
  observeResponse: (conversationId, requestId) => {
    callbacks.fork(runtime.observeResponse(conversationId, requestId));
  },
  observeServerResolution: (conversationId, requestId) => {
    callbacks.fork(runtime.observeServerResolution(conversationId, requestId));
  },
  reevaluatePresentation: (conversationId) => {
    callbacks.fork(runtime.reevaluatePresentation(conversationId));
  },
  clearConversation: (conversationId) => {
    callbacks.fork(runtime.clearConversation(conversationId));
  },
  reconcilePendingRequests: (conversationId, requestIds) => {
    callbacks.fork(runtime.reconcilePendingRequests(conversationId, requestIds));
  },
  handleDisconnect: () => {
    callbacks.fork(runtime.handleDisconnect);
  },
});
