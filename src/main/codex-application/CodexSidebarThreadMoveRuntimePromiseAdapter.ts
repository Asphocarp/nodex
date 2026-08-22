import * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexSidebarThreadMoveError,
  type CodexSidebarThreadMoveRuntime,
} from "./CodexSidebarThreadMoveRuntime";

export interface CodexSidebarThreadMoveRuntimePromiseAdapter {
  readonly run: <A>(operation: () => Promise<A>) => Promise<A>;
}

/** Stateless projection for the remaining Promise-shaped sidebar domain transition. */
export const makeCodexSidebarThreadMoveRuntimePromiseAdapter = (
  runtime: CodexSidebarThreadMoveRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexSidebarThreadMoveRuntimePromiseAdapter => ({
  run: (operation) =>
    callbacks
      .runPromise(
        runtime.run(
          Effect.tryPromise({
            try: operation,
            catch: (cause) => new CodexSidebarThreadMoveError({ cause }),
          }),
        ),
      )
      .catch((error: unknown) => {
        if (error instanceof CodexSidebarThreadMoveError) throw error.cause;
        throw error;
      }),
});
