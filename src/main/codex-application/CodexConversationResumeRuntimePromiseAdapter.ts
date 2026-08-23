import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexConversationResumeError,
  type CodexConversationResumeInput,
  type CodexConversationResumeRuntime,
} from "./CodexConversationResumeRuntime";
import type { CodexConversationSnapshot } from "../../shared/types";
import type { CodexRendererConversationResumeResult } from "../../shared/types";

export interface CodexConversationResumeRuntimePromiseAdapter {
  readonly resume: (
    input: CodexConversationResumeInput,
  ) => Promise<CodexConversationSnapshot | null>;
  readonly snapshot: (threadId: string) => Promise<CodexConversationSnapshot | null>;
  readonly resumeForRenderer: (
    threadId: string,
    ownerClientId: string,
  ) => Promise<CodexRendererConversationResumeResult | null>;
  readonly releaseBuffer: (threadId: string) => Promise<boolean>;
  readonly clear: (threadId: string) => void;
}

const unwrapResumeError = (error: unknown): never => {
  if (error instanceof CodexConversationResumeError) throw error.cause;
  throw error;
};

export const makeCodexConversationResumeRuntimePromiseAdapter = (
  runtime: CodexConversationResumeRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexConversationResumeRuntimePromiseAdapter => ({
  resume: (input) => callbacks.runPromise(runtime.resume(input)).catch(unwrapResumeError),
  snapshot: (threadId) => callbacks.runPromise(runtime.snapshot(threadId)).catch(unwrapResumeError),
  resumeForRenderer: (threadId, ownerClientId) =>
    callbacks
      .runPromise(runtime.resumeForRenderer(threadId, ownerClientId))
      .catch(unwrapResumeError),
  releaseBuffer: (threadId) =>
    callbacks.runPromise(runtime.releaseBuffer(threadId)).catch(unwrapResumeError),
  clear: runtime.clear,
});
