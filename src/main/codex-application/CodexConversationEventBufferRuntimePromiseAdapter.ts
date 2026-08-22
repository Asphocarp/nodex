import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexConversationEventBufferError,
  type CodexConversationEventBufferRuntimeService,
} from "./CodexConversationEventBufferRuntime";

export interface CodexConversationEventBufferRuntimePromiseAdapter extends Omit<
  CodexConversationEventBufferRuntimeService,
  "completeThreadStartDeferral" | "endThreadStartDeferral" | "releaseResume"
> {
  readonly completeThreadStartDeferral: (threadId: string | null) => Promise<void>;
  readonly endThreadStartDeferral: () => Promise<void>;
  readonly releaseResume: (threadId: string) => Promise<void>;
}

export const makeCodexConversationEventBufferRuntimePromiseAdapter = (
  runtime: CodexConversationEventBufferRuntimeService,
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexConversationEventBufferRuntimePromiseAdapter => ({
  beginResume: runtime.beginResume,
  hasResume: runtime.hasResume,
  beginThreadStartDeferral: runtime.beginThreadStartDeferral,
  offerNotification: runtime.offerNotification,
  offerRequest: runtime.offerRequest,
  completeThreadStartDeferral: (threadId) =>
    callbacks.runPromise(runtime.completeThreadStartDeferral(threadId)),
  endThreadStartDeferral: () => callbacks.runPromise(runtime.endThreadStartDeferral),
  releaseResume: (threadId) =>
    callbacks.runPromise(runtime.releaseResume(threadId)).catch((error: unknown) => {
      if (error instanceof CodexConversationEventBufferError) throw error.cause;
      throw error;
    }),
  discardResume: runtime.discardResume,
  clear: runtime.clear,
});
