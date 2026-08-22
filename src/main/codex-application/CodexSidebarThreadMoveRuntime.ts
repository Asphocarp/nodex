import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

export class CodexSidebarThreadMoveError extends Data.TaggedError("CodexSidebarThreadMoveError")<{
  readonly cause: unknown;
}> {}

export class CodexSidebarThreadMoveRuntime extends Context.Service<
  CodexSidebarThreadMoveRuntime,
  {
    readonly run: <A>(
      operation: Effect.Effect<A, CodexSidebarThreadMoveError>,
    ) => Effect.Effect<A, CodexSidebarThreadMoveError>;
  }
>()("nodex/main/codex-application/CodexSidebarThreadMoveRuntime") {}

export const make = (): CodexSidebarThreadMoveRuntime["Service"] => {
  const admission = Semaphore.makeUnsafe(1);
  return CodexSidebarThreadMoveRuntime.of({
    run: (operation) => admission.withPermits(1)(operation),
  });
};
