import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as RcMap from "effect/RcMap";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

export interface CodexThreadTitlePersistenceInput {
  readonly threadId: string;
  readonly name: string;
}

export class CodexThreadTitlePersistenceEffectError extends Data.TaggedError(
  "CodexThreadTitlePersistenceEffectError",
)<{
  readonly cause: unknown;
}> {}

export interface CodexThreadTitlePersistenceOptions {
  readonly setRemote: (
    input: CodexThreadTitlePersistenceInput,
  ) => Effect.Effect<void, CodexThreadTitlePersistenceEffectError>;
  readonly persistWorkspace: (
    input: CodexThreadTitlePersistenceInput,
  ) => Effect.Effect<void, CodexThreadTitlePersistenceEffectError>;
}

export class CodexThreadTitlePersistence extends Context.Service<
  CodexThreadTitlePersistence,
  {
    /** Local projection has already committed; both persistence targets are best effort. */
    readonly persistBestEffort: (input: CodexThreadTitlePersistenceInput) => Effect.Effect<void>;
    /** Used by transactional Thread creation paths that must surface persistence failure. */
    readonly persistRequired: (
      input: CodexThreadTitlePersistenceInput,
    ) => Effect.Effect<void, CodexThreadTitlePersistenceEffectError>;
  }
>()("nodex/main/codex-application/CodexThreadTitlePersistence") {}

export const make = (
  options: CodexThreadTitlePersistenceOptions,
): Effect.Effect<CodexThreadTitlePersistence["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    const lanes = yield* RcMap.make({
      lookup: (_threadId: string) => Semaphore.make(1),
    });

    const runOwned = <A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.acquireUseRelease(
        operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
        Fiber.join,
        Fiber.interrupt,
      );

    const runSerial = <A, E>(
      threadId: string,
      operation: Effect.Effect<A, E>,
    ): Effect.Effect<A, E> =>
      runOwned(
        Effect.scoped(
          Effect.gen(function* () {
            const lane = yield* RcMap.get(lanes, threadId);
            return yield* lane.withPermit(operation);
          }),
        ),
      );

    const logFailure = (
      phase: "app-server" | "project-workspace",
      input: CodexThreadTitlePersistenceInput,
      error: CodexThreadTitlePersistenceEffectError,
    ): Effect.Effect<void> =>
      Effect.logWarning("Could not persist Thread title").pipe(
        Effect.annotateLogs({
          phase,
          threadId: input.threadId,
          error: String(error.cause),
        }),
      );

    const persistRequired = (
      input: CodexThreadTitlePersistenceInput,
    ): Effect.Effect<void, CodexThreadTitlePersistenceEffectError> =>
      runSerial(
        input.threadId,
        options.setRemote(input).pipe(Effect.andThen(options.persistWorkspace(input))),
      );

    return CodexThreadTitlePersistence.of({
      persistRequired,
      persistBestEffort: (input) =>
        runSerial(
          input.threadId,
          options.setRemote(input).pipe(
            Effect.catch((error) => logFailure("app-server", input, error)),
            Effect.andThen(
              options
                .persistWorkspace(input)
                .pipe(Effect.catch((error) => logFailure("project-workspace", input, error))),
            ),
          ),
        ),
    });
  });
