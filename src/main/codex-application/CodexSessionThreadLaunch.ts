import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import type { ThreadStartParams, ThreadStartResponse } from "@nodex/codex-app-server-protocol/v2";
import type {
  CodexThreadStartForSessionInput,
  CodexThreadStartForSessionResult,
  CodexTurnSummary,
} from "../../shared/types";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import {
  CodexTurnCommands,
  type CodexTurnCommandsError,
  type CodexTurnStartOverrides,
} from "./CodexTurnCommands";

type GatewayThreadStartParams = ClientRequestParamsByMethod["thread/start"];

export interface CodexSessionThreadLaunchContext {
  readonly browserViewScopeId: string;
  readonly ownerClientId: string | null;
}

export type CodexPreparedSessionThreadLaunch =
  | {
      readonly kind: "pending";
      readonly sessionId: string;
      /** Opaque immutable preparation state owned by the projection. */
      readonly state: object;
    }
  | {
      readonly kind: "immediate";
      readonly sessionId: string;
      readonly request: ThreadStartParams;
      /** Opaque immutable preparation state owned by the projection. */
      readonly state: object;
    };

export interface CodexCommittedSessionThreadLaunch {
  readonly sessionId: string;
  readonly threadId: string;
  /** Opaque committed state owned by the projection. */
  readonly state: object;
}

export type CodexPreparedSessionThreadCompletion =
  | {
      readonly kind: "complete";
      readonly result: CodexThreadStartForSessionResult;
    }
  | {
      readonly kind: "main-owned-first-turn";
      readonly sessionId: string;
      readonly threadId: string;
      readonly prompt: string;
      readonly overrides: CodexTurnStartOverrides;
      /** Opaque immutable completion state owned by the projection. */
      readonly state: object;
    };

export class CodexSessionThreadLaunchProjectionError extends Data.TaggedError(
  "CodexSessionThreadLaunchProjectionError",
)<{
  readonly operation:
    | "prepare"
    | "enqueue-pending"
    | "begin"
    | "commit"
    | "end"
    | "prepare-completion"
    | "finish-first-turn";
  readonly sessionId: string;
  readonly cause: unknown;
}> {}

export interface CodexSessionThreadLaunchProjection {
  readonly prepare: (
    input: CodexThreadStartForSessionInput,
    context: CodexSessionThreadLaunchContext,
  ) => Effect.Effect<CodexPreparedSessionThreadLaunch, CodexSessionThreadLaunchProjectionError>;
  readonly enqueuePending: (
    prepared: Extract<CodexPreparedSessionThreadLaunch, { readonly kind: "pending" }>,
  ) => Effect.Effect<
    Extract<CodexThreadStartForSessionResult, { readonly kind: "pending" }>,
    CodexSessionThreadLaunchProjectionError
  >;
  readonly begin: (
    prepared: Extract<CodexPreparedSessionThreadLaunch, { readonly kind: "immediate" }>,
  ) => Effect.Effect<void, CodexSessionThreadLaunchProjectionError>;
  readonly commit: (
    prepared: Extract<CodexPreparedSessionThreadLaunch, { readonly kind: "immediate" }>,
    response: ThreadStartResponse,
  ) => Effect.Effect<CodexCommittedSessionThreadLaunch, CodexSessionThreadLaunchProjectionError>;
  readonly end: (
    prepared: Extract<CodexPreparedSessionThreadLaunch, { readonly kind: "immediate" }>,
  ) => Effect.Effect<void, CodexSessionThreadLaunchProjectionError>;
  readonly prepareCompletion: (
    committed: CodexCommittedSessionThreadLaunch,
  ) => Effect.Effect<CodexPreparedSessionThreadCompletion, CodexSessionThreadLaunchProjectionError>;
  readonly finishFirstTurn: (
    prepared: Extract<
      CodexPreparedSessionThreadCompletion,
      { readonly kind: "main-owned-first-turn" }
    >,
    turn: CodexTurnSummary,
  ) => Effect.Effect<CodexThreadStartForSessionResult, CodexSessionThreadLaunchProjectionError>;
  readonly fail: (input: {
    readonly request: CodexThreadStartForSessionInput;
    readonly prepared: CodexPreparedSessionThreadLaunch | null;
    readonly committedThreadId: string | null;
    readonly cause: unknown;
  }) => Effect.Effect<void>;
}

type CodexSessionThreadLaunchError =
  | CodexRuntimeError
  | CodexTurnCommandsError
  | CodexSessionThreadLaunchProjectionError;

export interface CodexSessionThreadLaunchService {
  readonly start: (
    input: CodexThreadStartForSessionInput,
    context: CodexSessionThreadLaunchContext,
  ) => Effect.Effect<CodexThreadStartForSessionResult, CodexSessionThreadLaunchError>;
}

export class CodexSessionThreadLaunch extends Context.Service<
  CodexSessionThreadLaunch,
  CodexSessionThreadLaunchService
>()("nodex/main/codex-application/CodexSessionThreadLaunch") {}

class SessionLaunchLane extends Context.Service<
  SessionLaunchLane,
  {
    readonly runExclusive: <A, E, R>(operation: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  }
>()("nodex/main/codex-application/CodexSessionThreadLaunch/SessionLaunchLane") {}

const laneLayer = (_sessionId: string): Layer.Layer<SessionLaunchLane> =>
  Layer.effect(
    SessionLaunchLane,
    Semaphore.make(1).pipe(
      Effect.map((semaphore) =>
        SessionLaunchLane.of({
          runExclusive: (operation) => semaphore.withPermits(1)(operation),
        }),
      ),
    ),
  );

export const make = (
  projection: CodexSessionThreadLaunchProjection,
): Effect.Effect<
  CodexSessionThreadLaunchService,
  never,
  CodexGateway | CodexTurnCommands | ProjectRuntimeLifecycleRuntime | Scope.Scope
> =>
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const projectLifecycle = yield* ProjectRuntimeLifecycleRuntime;
    const turns = yield* CodexTurnCommands;
    const lanes = yield* LayerMap.make(laneLayer);

    const runExclusive = <A, E, R>(sessionId: string, operation: Effect.Effect<A, E, R>) =>
      Effect.scoped(
        lanes
          .contextEffect(sessionId)
          .pipe(
            Effect.flatMap((context) =>
              Context.get(context, SessionLaunchLane).runExclusive(operation),
            ),
          ),
      );

    const cleanupUnlinkedThread = (threadId: string) =>
      gateway.requestLocal("thread/delete", { threadId }).pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to delete an unlinked Session Thread").pipe(
            Effect.annotateLogs({ threadId, cause: String(cause) }),
          ),
        ),
      );

    const start: CodexSessionThreadLaunchService["start"] = (input, context) =>
      runExclusive(
        input.sessionId,
        Effect.gen(function* () {
          const preparedRef = yield* Ref.make<CodexPreparedSessionThreadLaunch | null>(null);
          const startedThreadId = yield* Ref.make<string | null>(null);
          const committedThreadId = yield* Ref.make<string | null>(null);

          const operation = projection.prepare(input, context).pipe(
            Effect.tap((prepared) => Ref.set(preparedRef, prepared)),
            Effect.flatMap((prepared) => {
              if (prepared.kind === "pending") {
                return projectLifecycle.runExclusive(
                  input.projectId,
                  projection.enqueuePending(prepared),
                );
              }
              return projectLifecycle.runExclusive(
                input.projectId,
                Effect.acquireUseRelease(
                  projection.begin(prepared),
                  () =>
                    gateway
                      .requestLocal("thread/start", prepared.request as GatewayThreadStartParams)
                      .pipe(
                        Effect.map((response) => response as unknown as ThreadStartResponse),
                        Effect.tap((response) => {
                          const threadId = response.thread.id.trim();
                          if (!threadId || threadId !== response.thread.id) {
                            return Effect.fail(
                              new CodexSessionThreadLaunchProjectionError({
                                operation: "commit",
                                sessionId: prepared.sessionId,
                                cause: new Error("Thread start did not return a valid thread id"),
                              }),
                            );
                          }
                          return Ref.set(startedThreadId, threadId);
                        }),
                        Effect.flatMap((response) => projection.commit(prepared, response)),
                        Effect.tap((committed) => Ref.set(committedThreadId, committed.threadId)),
                      ),
                  () => projection.end(prepared),
                ).pipe(
                  Effect.flatMap(projection.prepareCompletion),
                  Effect.flatMap((completion) => {
                    if (completion.kind === "complete") return Effect.succeed(completion.result);
                    return turns
                      .start(completion.threadId, completion.prompt, completion.overrides)
                      .pipe(
                        Effect.flatMap((turn) => {
                          if (turn) return projection.finishFirstTurn(completion, turn);
                          return Effect.fail(
                            new CodexSessionThreadLaunchProjectionError({
                              operation: "finish-first-turn",
                              sessionId: completion.sessionId,
                              cause: new Error("Codex turn/start returned an invalid turn payload"),
                            }),
                          );
                        }),
                      );
                  }),
                ),
              );
            }),
          );

          return yield* operation.pipe(
            Effect.onExit((exit) => {
              if (Exit.isSuccess(exit)) return Effect.void;
              return Effect.gen(function* () {
                const prepared = yield* Ref.get(preparedRef);
                const started = yield* Ref.get(startedThreadId);
                const committed = yield* Ref.get(committedThreadId);
                if (started && !committed) yield* cleanupUnlinkedThread(started);
                yield* projection.fail({
                  request: input,
                  prepared,
                  committedThreadId: committed,
                  cause: exit.cause,
                });
              });
            }),
          );
        }),
      ).pipe(
        Effect.withSpan("CodexSessionThreadLaunch.start", {
          attributes: { sessionId: input.sessionId },
        }),
      );

    return CodexSessionThreadLaunch.of({ start });
  });
