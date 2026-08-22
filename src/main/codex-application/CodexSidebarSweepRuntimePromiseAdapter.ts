import * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexSidebarSweepStepError,
  type CodexSidebarSweepRuntime,
} from "./CodexSidebarSweepRuntime";

export interface CodexSidebarSweepLegacyState {
  readonly archived: boolean;
  readonly cursor: string | null;
  readonly phase: string;
}

export interface CodexSidebarSweepRuntimePromiseAdapter {
  readonly start: <State extends CodexSidebarSweepLegacyState>(
    initialState: State,
    step: (state: State) => Promise<State | null>,
  ) => Promise<void>;
  readonly cancel: () => Promise<void>;
}

/**
 * Temporary boundary while sidebar page materialization still lives in
 * CodexService. The runtime cooperatively drains one physical Promise page on
 * replacement, while Scope interruption can still abandon it during shutdown.
 */
export const makeCodexSidebarSweepRuntimePromiseAdapter = (
  runtime: CodexSidebarSweepRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexSidebarSweepRuntimePromiseAdapter => {
  const fromLegacyStep = <State extends CodexSidebarSweepLegacyState>(
    state: State,
    step: (state: State) => Promise<State | null>,
  ): Effect.Effect<State | null, CodexSidebarSweepStepError> =>
    Effect.tryPromise({
      try: () => step(state),
      catch: (cause) =>
        new CodexSidebarSweepStepError({
          cause,
          state: {
            archived: state.archived,
            cursorPresent: state.cursor !== null,
            phase: state.phase,
          },
        }),
    });

  return {
    start: <State extends CodexSidebarSweepLegacyState>(
      initialState: State,
      step: (state: State) => Promise<State | null>,
    ) => callbacks.runPromise(runtime.start(initialState, (state) => fromLegacyStep(state, step))),
    cancel: () => callbacks.runPromise(runtime.cancel),
  };
};
