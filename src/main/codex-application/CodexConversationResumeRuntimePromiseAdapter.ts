import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexConversationResumeError,
  type CodexConversationResumeInput,
  type CodexConversationResumeRuntime,
} from "./CodexConversationResumeRuntime";
import type { CodexConversationSnapshot } from "../../shared/types";

export interface CodexConversationResumeRuntimePromiseAdapter {
  readonly resume: (
    input: CodexConversationResumeInput,
  ) => Promise<CodexConversationSnapshot | null>;
  readonly clear: (threadId: string) => void;
}

export const makeCodexConversationResumeRuntimePromiseAdapter = (
  runtime: CodexConversationResumeRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexConversationResumeRuntimePromiseAdapter => ({
  resume: (input) =>
    callbacks.runPromise(runtime.resume(input)).catch((error: unknown) => {
      if (error instanceof CodexConversationResumeError) throw error.cause;
      throw error;
    }),
  clear: runtime.clear,
});
