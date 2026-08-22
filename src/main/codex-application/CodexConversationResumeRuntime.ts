import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import type { CodexConversationSnapshot } from "../../shared/types";

export interface CodexConversationResumeInput {
  readonly threadId: string;
  readonly syncDormantConversationSnapshots?: boolean;
  readonly replayBufferedNotifications?: boolean;
}

export interface CodexConversationResumeDemand {
  readonly threadId: string;
  readonly syncDormantConversationSnapshots: boolean;
  readonly replayBufferedNotifications: boolean;
}

export interface CodexConversationResumeOutcome {
  readonly input: CodexConversationResumeDemand;
  readonly join: boolean;
  readonly durationMs: number;
  readonly result?: CodexConversationSnapshot | null;
  readonly error?: unknown;
}

export class CodexConversationResumeError extends Data.TaggedError("CodexConversationResumeError")<{
  readonly cause: unknown;
}> {}

export interface CodexConversationResumeRuntimeOptions {
  readonly run: (
    input: CodexConversationResumeDemand,
  ) => Effect.Effect<CodexConversationSnapshot | null, CodexConversationResumeError>;
  readonly observe?: (outcome: CodexConversationResumeOutcome) => void;
}

export class CodexConversationResumeRuntime extends Context.Service<
  CodexConversationResumeRuntime,
  {
    readonly resume: (
      input: CodexConversationResumeInput,
    ) => Effect.Effect<CodexConversationSnapshot | null, CodexConversationResumeError>;
    readonly clear: (threadId: string) => void;
  }
>()("nodex/main/codex-application/CodexConversationResumeRuntime") {}

interface ActiveResume {
  readonly token: object;
  readonly demand: CodexConversationResumeDemand;
}

const normalizeDemand = (input: CodexConversationResumeInput): CodexConversationResumeDemand => ({
  threadId: input.threadId,
  syncDormantConversationSnapshots: input.syncDormantConversationSnapshots !== false,
  replayBufferedNotifications: input.replayBufferedNotifications !== false,
});

const sameDemand = (
  left: CodexConversationResumeDemand,
  right: CodexConversationResumeDemand,
): boolean =>
  left.syncDormantConversationSnapshots === right.syncDormantConversationSnapshots &&
  left.replayBufferedNotifications === right.replayBufferedNotifications;

export const make = (
  options: CodexConversationResumeRuntimeOptions,
): Effect.Effect<CodexConversationResumeRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const resumes = yield* FiberMap.make<
      string,
      CodexConversationSnapshot | null,
      CodexConversationResumeError
    >();
    const runResume = yield* FiberMap.runtime(resumes)();
    const admission = yield* Semaphore.make(1);
    const active = new Map<string, ActiveResume>();

    const acquire = (demand: CodexConversationResumeDemand) =>
      admission.withPermits(1)(
        Effect.gen(function* () {
          const current = active.get(demand.threadId);
          if (current) {
            const fiber = yield* FiberMap.get(resumes, demand.threadId);
            if (Option.isSome(fiber)) {
              return {
                fiber: fiber.value,
                compatible: sameDemand(current.demand, demand),
                joined: true,
              } as const;
            }
            active.delete(demand.threadId);
          }

          const token = {};
          active.set(demand.threadId, { token, demand });
          const physical = options.run(demand).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (active.get(demand.threadId)?.token === token) active.delete(demand.threadId);
              }),
            ),
          );
          const fiber = yield* FiberMap.run(resumes, demand.threadId, physical, {
            startImmediately: true,
          });
          return { fiber, compatible: true, joined: false } as const;
        }),
      );

    const runDemand = (
      demand: CodexConversationResumeDemand,
    ): Effect.Effect<
      { readonly result: CodexConversationSnapshot | null; readonly joined: boolean },
      CodexConversationResumeError
    > =>
      Effect.gen(function* () {
        let joined = false;
        for (;;) {
          const acquired = yield* acquire(demand);
          joined ||= acquired.joined;
          const result = yield* Fiber.join(acquired.fiber);
          if (acquired.compatible) return { result, joined };
          // A different demand must observe the completed canonical transition,
          // then run its own idempotent replay/projection upgrade.
        }
      });

    const resume = (
      input: CodexConversationResumeInput,
    ): Effect.Effect<CodexConversationSnapshot | null, CodexConversationResumeError> =>
      Effect.gen(function* () {
        const demand = normalizeDemand(input);
        const startedAt = yield* Clock.currentTimeMillis;
        const outcome = yield* runDemand(demand).pipe(Effect.result);
        const completedAt = yield* Clock.currentTimeMillis;
        if (outcome._tag === "Failure") {
          options.observe?.({
            input: demand,
            join: false,
            durationMs: Math.max(0, completedAt - startedAt),
            error: outcome.failure.cause,
          });
          return yield* Effect.fail(outcome.failure);
        }
        options.observe?.({
          input: demand,
          join: outcome.success.joined,
          durationMs: Math.max(0, completedAt - startedAt),
          result: outcome.success.result,
        });
        return outcome.success.result;
      });

    const clear = (threadId: string): void => {
      active.delete(threadId);
      runResume(threadId, Effect.succeed(null));
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        active.clear();
      }),
    );

    return CodexConversationResumeRuntime.of({ resume, clear });
  });
