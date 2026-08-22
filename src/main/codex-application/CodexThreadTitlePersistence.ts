import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as RcMap from "effect/RcMap";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { normalizeCodexManualThreadTitle } from "../../shared/codex-thread-title";

export interface CodexThreadTitlePersistenceInput {
  readonly threadId: string;
  readonly name: string;
}

export interface CodexThreadTitleSetCommand extends CodexThreadTitlePersistenceInput {
  readonly normalization: "manual" | "trim";
  readonly syncDormantConversationUpdates?: boolean;
}

export class CodexThreadTitlePersistenceEffectError extends Data.TaggedError(
  "CodexThreadTitlePersistenceEffectError",
)<{
  readonly cause: unknown;
}> {}

export interface CodexThreadTitlePersistenceOptions {
  readonly project: (
    input: CodexThreadTitleSetCommand,
  ) => Effect.Effect<void, CodexThreadTitlePersistenceEffectError>;
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
    /** Commits local title projection, then persists both external targets best effort. */
    readonly set: (
      input: CodexThreadTitleSetCommand,
    ) => Effect.Effect<boolean, CodexThreadTitlePersistenceEffectError>;
    /** Commits local title projection and requires both persistence targets to succeed. */
    readonly setRequired: (
      input: CodexThreadTitleSetCommand,
    ) => Effect.Effect<boolean, CodexThreadTitlePersistenceEffectError>;
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

    const normalize = (
      input: CodexThreadTitleSetCommand,
    ): (CodexThreadTitleSetCommand & { readonly name: string }) | null => {
      const name =
        input.normalization === "manual"
          ? normalizeCodexManualThreadTitle(input.name)
          : input.name.trim();
      return name ? { ...input, name } : null;
    };

    const set = (
      input: CodexThreadTitleSetCommand,
    ): Effect.Effect<boolean, CodexThreadTitlePersistenceEffectError> => {
      const normalized = normalize(input);
      if (!normalized) return Effect.succeed(false);
      const persisted = { threadId: normalized.threadId, name: normalized.name };
      return runSerial(
        normalized.threadId,
        options.project(normalized).pipe(
          Effect.andThen(
            options.setRemote(persisted).pipe(
              Effect.catch((error) => logFailure("app-server", persisted, error)),
              Effect.andThen(
                options
                  .persistWorkspace(persisted)
                  .pipe(Effect.catch((error) => logFailure("project-workspace", persisted, error))),
              ),
            ),
          ),
          Effect.as(true),
        ),
      );
    };

    const setRequired = (
      input: CodexThreadTitleSetCommand,
    ): Effect.Effect<boolean, CodexThreadTitlePersistenceEffectError> => {
      const normalized = normalize(input);
      if (!normalized) return Effect.succeed(false);
      const persisted = { threadId: normalized.threadId, name: normalized.name };
      return runSerial(
        normalized.threadId,
        options
          .project(normalized)
          .pipe(
            Effect.andThen(options.setRemote(persisted)),
            Effect.andThen(options.persistWorkspace(persisted)),
            Effect.as(true),
          ),
      );
    };

    return CodexThreadTitlePersistence.of({
      set,
      setRequired,
    });
  });
