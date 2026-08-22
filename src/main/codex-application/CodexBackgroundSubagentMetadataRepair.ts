import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import type * as Scope from "effect/Scope";

export const DEFAULT_BACKGROUND_SUBAGENT_METADATA_REPAIR_RETRY = "30 seconds";

export class CodexBackgroundSubagentMetadataRepairError extends Data.TaggedError(
  "CodexBackgroundSubagentMetadataRepairError",
)<{
  readonly cause: unknown;
}> {}

export interface CodexBackgroundSubagentMetadataRepairOptions {
  readonly isRepairNeeded: (parentThreadId: string, childThreadId: string) => boolean;
  /** Returns true once the child has a stable friendly identity. */
  readonly repair: (
    parentThreadId: string,
    childThreadId: string,
  ) => Effect.Effect<boolean, CodexBackgroundSubagentMetadataRepairError>;
  readonly retry?: Duration.Input;
}

export class CodexBackgroundSubagentMetadataRepair extends Context.Service<
  CodexBackgroundSubagentMetadataRepair,
  {
    readonly request: (parentThreadId: string, childThreadIds: readonly string[]) => void;
    readonly clear: (childThreadId: string) => void;
  }
>()("nodex/main/codex-application/CodexBackgroundSubagentMetadataRepair") {}

export const make = (
  options: CodexBackgroundSubagentMetadataRepairOptions,
): Effect.Effect<CodexBackgroundSubagentMetadataRepair["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const repairs = yield* FiberMap.make<string, void, never>();
    const runRepair = yield* FiberMap.runtime(repairs)();
    const completed = new Set<string>();
    const lastAttemptAt = new Map<string, number>();
    const retryMs = Duration.toMillis(
      Duration.fromInputUnsafe(options.retry ?? DEFAULT_BACKGROUND_SUBAGENT_METADATA_REPAIR_RETRY),
    );

    const requestOne = (parentThreadId: string, childThreadId: string): void => {
      if (completed.has(childThreadId)) return;
      if (FiberMap.hasUnsafe(repairs, childThreadId)) return;
      const now = clock.currentTimeMillisUnsafe();
      if (now - (lastAttemptAt.get(childThreadId) ?? Number.NEGATIVE_INFINITY) < retryMs) return;
      if (!options.isRepairNeeded(parentThreadId, childThreadId)) return;

      lastAttemptAt.set(childThreadId, now);
      runRepair(
        childThreadId,
        options.repair(parentThreadId, childThreadId).pipe(
          Effect.tap((isComplete) =>
            Effect.sync(() => {
              if (isComplete) completed.add(childThreadId);
            }),
          ),
          Effect.catch((error) =>
            Effect.logWarning("Could not repair background subagent metadata").pipe(
              Effect.annotateLogs({
                parentThreadId,
                childThreadId,
                error: String(error.cause),
              }),
            ),
          ),
          Effect.asVoid,
        ),
      );
    };

    const clear = (childThreadId: string): void => {
      completed.delete(childThreadId);
      lastAttemptAt.delete(childThreadId);
      runRepair(childThreadId, Effect.void);
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        completed.clear();
        lastAttemptAt.clear();
      }),
    );

    return CodexBackgroundSubagentMetadataRepair.of({
      request: (parentThreadId, childThreadIds) => {
        for (const childThreadId of childThreadIds) requestOne(parentThreadId, childThreadId);
      },
      clear,
    });
  });
