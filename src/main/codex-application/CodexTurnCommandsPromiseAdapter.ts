import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2";
import type { CodexTurnSummary } from "../../shared/types";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexTurnCommandsService, CodexTurnStartOverrides } from "./CodexTurnCommands";

export interface CodexTurnCommandsPromiseAdapter {
  readonly start: (
    threadId: string,
    prompt: string,
    overrides?: CodexTurnStartOverrides,
    options?: { readonly syncDormantConversationUpdates?: boolean },
  ) => Promise<CodexTurnSummary | null>;
  readonly startRendererOwned: (
    threadId: string,
    prompt: string,
    overrides?: CodexTurnStartOverrides,
  ) => Promise<TurnStartResponse>;
}

export const makeCodexTurnCommandsPromiseAdapter = (
  commands: CodexTurnCommandsService,
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexTurnCommandsPromiseAdapter => ({
  start: (threadId, prompt, overrides, options) =>
    callbacks.runPromise(commands.start(threadId, prompt, overrides, options)),
  startRendererOwned: (threadId, prompt, overrides) =>
    callbacks.runPromise(commands.startRendererOwned(threadId, prompt, overrides)),
});
