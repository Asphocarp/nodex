import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as RcMap from "effect/RcMap";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import type {
  CodexConversationResumeState,
  CodexConversationSnapshot,
  CodexRendererConversationResumeResult,
  CodexThreadStreamCheckpoint,
} from "../../shared/types";

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

export interface CodexConversationResumeRendererState {
  readonly acceptedConversation: CodexConversationSnapshot | null;
  readonly checkpoint: CodexThreadStreamCheckpoint | null;
  readonly freshLaunchOwnerClientId: string | null;
  readonly ownerClientId: string | null;
  readonly resumeState: CodexConversationResumeState | null;
  readonly revision: number;
  readonly serializedConversation: CodexConversationSnapshot | null;
}

export interface CodexConversationResumeRendererAdoption {
  readonly checkpoint: CodexThreadStreamCheckpoint | null;
  readonly ownerClientId: string | null;
  readonly revision: number;
}

export interface CodexConversationResumeProjection {
  readonly snapshot: (
    threadId: string,
  ) => Effect.Effect<CodexConversationSnapshot | null, CodexConversationResumeError>;
  readonly readRendererState: (
    threadId: string,
  ) => Effect.Effect<CodexConversationResumeRendererState, CodexConversationResumeError>;
  readonly isRendererClientDisposed: (
    clientId: string,
  ) => Effect.Effect<boolean, CodexConversationResumeError>;
  readonly adoptRenderer: (input: {
    readonly threadId: string;
    readonly ownerClientId: string;
    readonly conversation: CodexConversationSnapshot;
  }) => Effect.Effect<CodexConversationResumeRendererAdoption, CodexConversationResumeError>;
  readonly releaseBuffer: (
    threadId: string,
  ) => Effect.Effect<boolean, CodexConversationResumeError>;
}

export interface CodexConversationResumeRuntimeOptions {
  readonly run: (
    input: CodexConversationResumeDemand,
  ) => Effect.Effect<CodexConversationSnapshot | null, CodexConversationResumeError>;
  readonly projection: CodexConversationResumeProjection;
  readonly observe?: (outcome: CodexConversationResumeOutcome) => void;
}

export class CodexConversationResumeRuntime extends Context.Service<
  CodexConversationResumeRuntime,
  {
    readonly resume: (
      input: CodexConversationResumeInput,
    ) => Effect.Effect<CodexConversationSnapshot | null, CodexConversationResumeError>;
    readonly snapshot: (
      threadId: string,
    ) => Effect.Effect<CodexConversationSnapshot | null, CodexConversationResumeError>;
    readonly resumeForRenderer: (
      threadId: string,
      ownerClientId: string,
    ) => Effect.Effect<CodexRendererConversationResumeResult | null, CodexConversationResumeError>;
    readonly releaseBuffer: (
      threadId: string,
    ) => Effect.Effect<boolean, CodexConversationResumeError>;
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

const invalidIdentity = (kind: "renderer client" | "Thread"): CodexConversationResumeError =>
  new CodexConversationResumeError({ cause: new Error(`${kind} identity is required`) });

const unavailableReplica = (
  threadId: string,
  role: "follower" | "owner",
): CodexConversationResumeError =>
  new CodexConversationResumeError({
    cause: new Error(`Accepted ${role} replica is unavailable for '${threadId}'`),
  });

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
    const rendererLanes = yield* RcMap.make({
      lookup: (_threadId: string) => Semaphore.make(1),
    });
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

    const runRendererSerial = <A>(
      threadId: string,
      operation: Effect.Effect<A, CodexConversationResumeError>,
    ): Effect.Effect<A, CodexConversationResumeError> =>
      Effect.scoped(
        Effect.gen(function* () {
          const lane = yield* RcMap.get(rendererLanes, threadId);
          return yield* lane.withPermit(operation);
        }),
      );

    const followerResult = (
      threadId: string,
      ownerClientId: string,
      state: CodexConversationResumeRendererState,
    ): Effect.Effect<
      CodexRendererConversationResumeResult | null,
      CodexConversationResumeError
    > => {
      if (!state.acceptedConversation) return Effect.succeed(null);
      if (!state.checkpoint) return Effect.fail(unavailableReplica(threadId, "follower"));
      return Effect.succeed({
        role: "follower",
        conversation: state.acceptedConversation,
        revision: state.revision,
        ownerClientId,
        checkpoint: state.checkpoint,
      });
    };

    const resumeForRenderer = (
      rawThreadId: string,
      rawOwnerClientId: string,
    ): Effect.Effect<
      CodexRendererConversationResumeResult | null,
      CodexConversationResumeError
    > => {
      const threadId = rawThreadId.trim();
      const ownerClientId = rawOwnerClientId.trim();
      if (!threadId) return Effect.fail(invalidIdentity("Thread"));
      if (!ownerClientId) return Effect.fail(invalidIdentity("renderer client"));

      return runRendererSerial(
        threadId,
        Effect.gen(function* () {
          const before = yield* options.projection.readRendererState(threadId);
          if (before.freshLaunchOwnerClientId && !before.ownerClientId) {
            if (before.freshLaunchOwnerClientId === ownerClientId) return null;
            return yield* followerResult(threadId, before.freshLaunchOwnerClientId, before);
          }
          if (before.ownerClientId && before.ownerClientId !== ownerClientId) {
            return yield* followerResult(threadId, before.ownerClientId, before);
          }
          if (yield* options.projection.isRendererClientDisposed(ownerClientId)) {
            return yield* Effect.fail(
              new CodexConversationResumeError({
                cause: new Error(`Renderer client '${ownerClientId}' is unavailable`),
              }),
            );
          }

          const conversation =
            before.ownerClientId === ownerClientId && before.resumeState !== "needs_resume"
              ? (before.acceptedConversation ?? before.serializedConversation)
              : null;
          const resumed =
            conversation ??
            (yield* resume({
              threadId,
              syncDormantConversationSnapshots: false,
              replayBufferedNotifications: false,
            }));
          if (!resumed || resumed.resumeState !== "resumed") return null;

          const afterResume = yield* options.projection.readRendererState(threadId);
          if (afterResume.ownerClientId && afterResume.ownerClientId !== ownerClientId) {
            return yield* followerResult(threadId, afterResume.ownerClientId, afterResume);
          }
          if (yield* options.projection.isRendererClientDisposed(ownerClientId)) {
            return yield* Effect.fail(
              new CodexConversationResumeError({
                cause: new Error(
                  `Renderer client '${ownerClientId}' became unavailable during resume`,
                ),
              }),
            );
          }

          const adoption = yield* options.projection.adoptRenderer({
            threadId,
            ownerClientId,
            conversation: resumed,
          });
          if (adoption.ownerClientId !== ownerClientId) {
            return yield* Effect.fail(
              new CodexConversationResumeError({
                cause: new Error(
                  `Renderer client '${ownerClientId}' could not adopt conversation '${threadId}'`,
                ),
              }),
            );
          }
          if (!adoption.checkpoint) {
            return yield* Effect.fail(unavailableReplica(threadId, "owner"));
          }
          return {
            role: "owner",
            conversation: resumed,
            revision: adoption.revision,
            checkpoint: adoption.checkpoint,
          };
        }),
      );
    };

    const snapshot = (
      rawThreadId: string,
    ): Effect.Effect<CodexConversationSnapshot | null, CodexConversationResumeError> => {
      const threadId = rawThreadId.trim();
      return threadId ? options.projection.snapshot(threadId) : Effect.succeed(null);
    };

    const releaseBuffer = (
      rawThreadId: string,
    ): Effect.Effect<boolean, CodexConversationResumeError> => {
      const threadId = rawThreadId.trim();
      if (!threadId) return Effect.fail(invalidIdentity("Thread"));
      return runRendererSerial(threadId, options.projection.releaseBuffer(threadId));
    };

    const clear = (threadId: string): void => {
      active.delete(threadId);
      runResume(threadId, Effect.succeed(null));
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        active.clear();
      }),
    );

    return CodexConversationResumeRuntime.of({
      resume,
      snapshot,
      resumeForRenderer,
      releaseBuffer,
      clear,
    });
  });
