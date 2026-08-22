import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
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

export const make: Effect.Effect<CodexSidebarThreadMoveRuntime["Service"]> = Effect.gen(
  function* () {
    const admission = yield* Semaphore.make(1);
    return CodexSidebarThreadMoveRuntime.of({
      run: (operation) => admission.withPermits(1)(operation),
    });
  },
);
