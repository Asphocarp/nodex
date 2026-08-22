import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type {
  CodexOwnerNotificationDrainRuntime,
  CodexOwnerNotificationDrainRuntimePromiseAdapter,
} from "./CodexOwnerNotificationDrainRuntime";

export const makeCodexOwnerNotificationDrainRuntimePromiseAdapter = (
  runtime: CodexOwnerNotificationDrainRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexOwnerNotificationDrainRuntimePromiseAdapter => ({
  next: runtime.next,
  ack: runtime.ack,
  awaitCurrent: (conversationId) => callbacks.runPromise(runtime.awaitCurrent(conversationId)),
  resetOwner: runtime.resetOwner,
  release: runtime.release,
  clear: runtime.clear,
});
