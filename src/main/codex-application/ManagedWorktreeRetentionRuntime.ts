import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type { CodexManagedWorktreeRetentionPlan } from "../codex/codex-managed-worktree-retention";

export class ManagedWorktreeRetentionRuntimeError extends Schema.TaggedError<ManagedWorktreeRetentionRuntimeError>()(
  "ManagedWorktreeRetentionRuntimeError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

type RetentionSweep = Effect.Effect<
  CodexManagedWorktreeRetentionPlan,
  ManagedWorktreeRetentionRuntimeError
>;

interface RetentionCommand {
  readonly sweep: RetentionSweep;
  readonly reply?: Deferred.Deferred<
    CodexManagedWorktreeRetentionPlan,
    ManagedWorktreeRetentionRuntimeError
  >;
}

export class ManagedWorktreeRetentionRuntime extends Context.Service<
  ManagedWorktreeRetentionRuntime,
  {
    /** Schedules a best-effort sweep after the fixed coalescing window. */
    readonly request: (sweep: RetentionSweep) => Effect.Effect<void>;
    /** Flushes the coalescing window and awaits the latest admitted sweep. */
    readonly run: (
      sweep: RetentionSweep,
    ) => Effect.Effect<CodexManagedWorktreeRetentionPlan, ManagedWorktreeRetentionRuntimeError>;
  }
>()("nodex/main/codex-application/ManagedWorktreeRetentionRuntime") {}

export interface ManagedWorktreeRetentionRuntimeOptions {
  readonly debounce?: Duration.Input;
}

const DEFAULT_DEBOUNCE = "300 millis";

export const live = (
  options: ManagedWorktreeRetentionRuntimeOptions = {},
): Layer.Layer<ManagedWorktreeRetentionRuntime> =>
  Layer.effect(
    ManagedWorktreeRetentionRuntime,
    Effect.gen(function* () {
      const commands = yield* Queue.unbounded<RetentionCommand>();
      yield* Effect.addFinalizer(() => Queue.shutdown(commands).pipe(Effect.asVoid));

      const drainAvailable = Effect.gen(function* () {
        const drained: RetentionCommand[] = [];
        while (true) {
          const next = yield* Queue.poll(commands);
          if (Option.isNone(next)) return drained;
          drained.push(next.value);
        }
      });

      const awaitBatch = Effect.gen(function* () {
        const batch: RetentionCommand[] = [yield* Queue.take(commands)];
        if (batch[0]?.reply !== undefined) return batch;

        return yield* Effect.scoped(
          Effect.gen(function* () {
            const deadline = yield* Effect.sleep(options.debounce ?? DEFAULT_DEBOUNCE).pipe(
              Effect.as({ _tag: "Elapsed" as const }),
              Effect.forkScoped,
            );
            while (true) {
              const next = yield* Effect.raceFirst(
                Queue.take(commands).pipe(
                  Effect.map((command) => ({ _tag: "Command" as const, command })),
                ),
                Fiber.join(deadline),
              );
              if (next._tag === "Elapsed") {
                batch.push(...(yield* drainAvailable));
                return batch;
              }
              batch.push(next.command);
              if (next.command.reply !== undefined) {
                batch.push(...(yield* drainAvailable));
                return batch;
              }
            }
          }),
        );
      });

      const actor = Effect.gen(function* () {
        let immediate: RetentionCommand[] = [];
        while (true) {
          const batch = immediate.length > 0 ? immediate : yield* awaitBatch;
          const latest = batch[batch.length - 1];
          if (latest === undefined) continue;

          const result = yield* Effect.exit(latest.sweep);
          let hasReply = false;
          for (const command of batch) {
            if (command.reply === undefined) continue;
            hasReply = true;
            yield* Deferred.done(command.reply, result);
          }
          if (!hasReply && Exit.isFailure(result)) {
            yield* Effect.logWarning("Managed worktree retention sweep failed").pipe(
              Effect.annotateLogs({ cause: Cause.pretty(result.cause) }),
            );
          }

          // Requests admitted during a sweep collapse into one immediate rerun.
          immediate = yield* drainAvailable;
        }
      });
      yield* Effect.forkScoped(actor);

      return ManagedWorktreeRetentionRuntime.of({
        request: (sweep) => Queue.offer(commands, { sweep }).pipe(Effect.asVoid),
        run: (sweep) =>
          Effect.gen(function* () {
            const reply = yield* Deferred.make<
              CodexManagedWorktreeRetentionPlan,
              ManagedWorktreeRetentionRuntimeError
            >();
            yield* Queue.offer(commands, { sweep, reply });
            return yield* Deferred.await(reply);
          }),
      });
    }),
  );
