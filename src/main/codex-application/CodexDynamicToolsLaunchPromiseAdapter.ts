import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";
import * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexDynamicToolsLaunchError,
  type CodexDynamicToolsLaunch,
} from "./CodexDynamicToolsLaunch";

export interface CodexDynamicToolsLaunchPromiseAdapter {
  readonly load: (operation: () => Promise<DynamicToolSpec[]>) => Promise<DynamicToolSpec[]>;
}

/** Stateless Promise projection for the legacy launch-parameter builder. */
export const makeCodexDynamicToolsLaunchPromiseAdapter = (
  runtime: CodexDynamicToolsLaunch["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexDynamicToolsLaunchPromiseAdapter => ({
  load: (operation) =>
    callbacks
      .runPromise(
        runtime.load(
          Effect.tryPromise({
            try: operation,
            catch: (cause) => new CodexDynamicToolsLaunchError({ cause }),
          }),
        ),
      )
      .then((tools) => [...tools]),
});
