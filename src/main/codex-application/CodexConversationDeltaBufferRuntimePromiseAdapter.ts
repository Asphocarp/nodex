import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type {
  CodexConversationDeltaBufferRuntime,
  CodexConversationDeltaBufferRuntimePromiseAdapter,
} from "./CodexConversationDeltaBufferRuntime";

export const makeCodexConversationDeltaBufferRuntimePromiseAdapter = (
  runtime: CodexConversationDeltaBufferRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexConversationDeltaBufferRuntimePromiseAdapter => ({
  enqueueFrameText: runtime.enqueueFrameText,
  enqueueCommandOutput: runtime.enqueueCommandOutput,
  drainFrameText: (conversationId) => callbacks.runPromise(runtime.drainFrameText(conversationId)),
  clear: runtime.clear,
});
