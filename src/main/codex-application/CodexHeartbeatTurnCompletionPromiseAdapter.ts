import type { TurnStartParams } from "@nodex/codex-app-server-protocol/v2/TurnStartParams";
import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2/TurnStartResponse";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexHeartbeatTurnCompletion } from "./CodexHeartbeatTurnCompletion";

export interface CodexHeartbeatTurnCompletionPromiseAdapter {
  readonly startAndWait: (
    params: TurnStartParams,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TurnStartResponse>;
}

/** Stateless projection for the remaining scheduled-automation policy in CodexService. */
export const makeCodexHeartbeatTurnCompletionPromiseAdapter = (
  runtime: CodexHeartbeatTurnCompletion["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexHeartbeatTurnCompletionPromiseAdapter => ({
  startAndWait: (params, options) =>
    callbacks
      .runPromise(
        runtime.startAndWait(params as unknown as ClientRequestParamsByMethod["turn/start"]),
        options,
      )
      .then((response) => response as unknown as TurnStartResponse),
});
