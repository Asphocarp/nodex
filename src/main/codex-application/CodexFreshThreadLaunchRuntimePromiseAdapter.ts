import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2/TurnStartResponse";
import type { CodexRendererConversationResumeResult } from "../../shared/types";
import {
  CodexFreshThreadLaunchError,
  type CodexFreshThreadLaunchRuntimeService,
} from "./CodexFreshThreadLaunchRuntime";

export interface CodexFreshThreadLaunchRuntimePromiseAdapter extends Omit<
  CodexFreshThreadLaunchRuntimeService,
  "adopt" | "start"
> {
  readonly adopt: (
    input: Parameters<CodexFreshThreadLaunchRuntimeService["adopt"]>[0],
  ) => Promise<Extract<CodexRendererConversationResumeResult, { readonly role: "owner" }>>;
  readonly start: (
    input: Parameters<CodexFreshThreadLaunchRuntimeService["start"]>[0],
  ) => Promise<TurnStartResponse>;
}

const unwrap = (error: unknown): never => {
  if (
    error instanceof CodexFreshThreadLaunchError &&
    error.reason === "operation-failed" &&
    error.cause !== undefined
  ) {
    throw error.cause;
  }
  throw error;
};

export const makeCodexFreshThreadLaunchRuntimePromiseAdapter = (
  runtime: CodexFreshThreadLaunchRuntimeService,
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexFreshThreadLaunchRuntimePromiseAdapter => ({
  register: runtime.register,
  reservation: runtime.reservation,
  adopt: (input) => callbacks.runPromise(runtime.adopt(input)).catch(unwrap),
  start: (input) => callbacks.runPromise(runtime.start(input)).catch(unwrap),
  releaseRenderer: runtime.releaseRenderer,
  clear: runtime.clear,
});
