import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import type { ThreadForkParams, ThreadForkResponse } from "@nodex/codex-app-server-protocol/v2";
import type { CodexSideChatStartInput, CodexSideChatStartResult } from "../../shared/types";
import { CodexGateway, CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import {
  CodexEphemeralThreadRouting,
  type CodexEphemeralThreadRoutingError,
} from "../codex-runtime/CodexEphemeralThreadRouting";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import {
  CodexTurnCommands,
  type CodexTurnCommandsError,
  type CodexTurnStartOverrides,
} from "./CodexTurnCommands";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";
import { SIDE_CHAT_BOUNDARY_TEXT } from "./CodexSideChatPolicy";

type GatewayThreadForkParams = ClientRequestParamsByMethod["thread/fork"];
type GatewayThreadInjectItemsParams = ClientRequestParamsByMethod["thread/inject_items"];

export interface CodexPreparedSideChat {
  readonly parentThreadId: string;
  readonly forkRequest: ThreadForkParams;
  readonly initialTurn: {
    readonly prompt: string;
    readonly overrides: CodexTurnStartOverrides;
  } | null;
  /** Opaque immutable preparation state owned by the projection. */
  readonly state: object;
}

export interface CodexCommittedSideChat {
  readonly parentThreadId: string;
  readonly threadId: string;
  readonly initialTurn: CodexPreparedSideChat["initialTurn"];
  /** Opaque committed state owned by the projection. */
  readonly state: object;
}

export class CodexSideChatProjectionError extends Data.TaggedError("CodexSideChatProjectionError")<{
  readonly operation: "prepare" | "commit" | "finish" | "inspect" | "discard" | "rollback";
  readonly threadId: string;
  readonly cause: unknown;
}> {}

export interface CodexSideChatProjection {
  readonly prepare: (
    input: CodexSideChatStartInput,
  ) => Effect.Effect<CodexPreparedSideChat, CodexSideChatProjectionError>;
  readonly commit: (
    prepared: CodexPreparedSideChat,
    response: ThreadForkResponse,
  ) => Effect.Effect<CodexCommittedSideChat, CodexSideChatProjectionError>;
  readonly finish: (
    committed: CodexCommittedSideChat,
  ) => Effect.Effect<CodexSideChatStartResult, CodexSideChatProjectionError>;
  readonly inspect: (
    threadId: string,
  ) => Effect.Effect<{ readonly parentThreadId: string } | null, CodexSideChatProjectionError>;
  readonly discard: (threadId: string) => Effect.Effect<void, CodexSideChatProjectionError>;
  readonly rollback: (threadId: string) => Effect.Effect<void, CodexSideChatProjectionError>;
}

type CodexSideChatError =
  | CodexRuntimeError
  | CodexEphemeralThreadRoutingError
  | CodexTurnCommandsError
  | CodexSideChatProjectionError;

export interface CodexSideChatCommandsService {
  readonly start: (
    input: CodexSideChatStartInput,
  ) => Effect.Effect<CodexSideChatStartResult, CodexSideChatError>;
  readonly discard: (threadId: string) => Effect.Effect<boolean, CodexSideChatError>;
}

export class CodexSideChatCommands extends Context.Service<
  CodexSideChatCommands,
  CodexSideChatCommandsService
>()("nodex/main/codex-application/CodexSideChatCommands") {}

export const make = (
  projection: CodexSideChatProjection,
): Effect.Effect<
  CodexSideChatCommandsService,
  never,
  | CodexGateway
  | CodexThreadHostResolver
  | CodexEphemeralThreadRouting
  | CodexTurnCommands
  | ConversationRuntimeMap
> =>
  Effect.gen(function* () {
    const conversations = yield* ConversationRuntimeMap;
    const gateway = yield* CodexGateway;
    const hostResolver = yield* CodexThreadHostResolver;
    const routing = yield* CodexEphemeralThreadRouting;
    const turns = yield* CodexTurnCommands;

    const ignoreCleanupFailure = <A, E>(
      operation: string,
      threadId: string,
      effect: Effect.Effect<A, E>,
    ): Effect.Effect<void> =>
      effect.pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.logWarning("Side chat cleanup step failed").pipe(
            Effect.annotateLogs({ operation, threadId, cause: String(cause) }),
          ),
        ),
      );

    const cleanup = (hostId: string, threadId: string) =>
      Effect.all(
        [
          ignoreCleanupFailure(
            "unsubscribe",
            threadId,
            gateway.requestOnHost(hostId, "thread/unsubscribe", { threadId }),
          ),
          ignoreCleanupFailure("route-remove", threadId, routing.remove(threadId)),
          ignoreCleanupFailure("projection-rollback", threadId, projection.rollback(threadId)),
        ],
        { concurrency: 1, discard: true },
      );

    const start: CodexSideChatCommandsService["start"] = (input) => {
      const parentThreadId = input.parentThreadId.trim();
      return conversations.runExclusive(
        parentThreadId,
        projection.prepare(input).pipe(
          Effect.flatMap((prepared) =>
            hostResolver.resolve(prepared.parentThreadId).pipe(
              Effect.flatMap((hostId) =>
                gateway
                  .requestOnHost(
                    hostId,
                    "thread/fork",
                    prepared.forkRequest as GatewayThreadForkParams,
                  )
                  .pipe(
                    Effect.map((response) => response as unknown as ThreadForkResponse),
                    Effect.flatMap((response) => {
                      const threadId = response.thread.id.trim();
                      if (!threadId || threadId !== response.thread.id) {
                        return Effect.fail(
                          new CodexSideChatProjectionError({
                            operation: "commit",
                            threadId: prepared.parentThreadId,
                            cause: new Error("Thread fork did not return a valid thread id"),
                          }),
                        );
                      }
                      return Effect.acquireUseRelease(
                        routing.register(threadId, hostId).pipe(Effect.as({ hostId, threadId })),
                        () =>
                          gateway
                            .requestOnHost(hostId, "thread/inject_items", {
                              threadId,
                              items: [
                                {
                                  type: "message",
                                  role: "user",
                                  content: [
                                    {
                                      type: "input_text",
                                      text: SIDE_CHAT_BOUNDARY_TEXT,
                                    },
                                  ],
                                },
                              ],
                            } as GatewayThreadInjectItemsParams)
                            .pipe(
                              Effect.andThen(projection.commit(prepared, response)),
                              Effect.tap((committed) =>
                                committed.initialTurn
                                  ? turns
                                      .start(
                                        committed.threadId,
                                        committed.initialTurn.prompt,
                                        committed.initialTurn.overrides,
                                      )
                                      .pipe(Effect.asVoid)
                                  : Effect.void,
                              ),
                              Effect.flatMap(projection.finish),
                            ),
                        (lease, exit) =>
                          Exit.isFailure(exit)
                            ? cleanup(lease.hostId, lease.threadId)
                            : Effect.void,
                      );
                    }),
                  ),
              ),
            ),
          ),
        ),
      );
    };

    const discard: CodexSideChatCommandsService["discard"] = (rawThreadId) => {
      const threadId = rawThreadId.trim();
      if (!threadId) return Effect.succeed(false);
      return conversations
        .runExclusive(
          threadId,
          projection.inspect(threadId).pipe(
            Effect.flatMap((sideChat) => {
              if (!sideChat) return Effect.succeed(false);
              const unsubscribe = routing.resolve(threadId).pipe(
                Effect.flatMap((ephemeralHostId) =>
                  ephemeralHostId
                    ? Effect.succeed(ephemeralHostId)
                    : hostResolver.resolve(sideChat.parentThreadId),
                ),
                Effect.flatMap((hostId) =>
                  gateway.requestOnHost(hostId, "thread/unsubscribe", { threadId }),
                ),
                Effect.catch((cause) =>
                  Effect.logWarning("Failed to unsubscribe side chat").pipe(
                    Effect.annotateLogs({ threadId, cause: cause.message }),
                  ),
                ),
              );
              return unsubscribe.pipe(
                Effect.onExit(() =>
                  routing.remove(threadId).pipe(Effect.andThen(projection.discard(threadId))),
                ),
                Effect.as(true),
              );
            }),
          ),
        )
        .pipe(
          Effect.tap((discarded) => (discarded ? conversations.close(threadId) : Effect.void)),
          Effect.withSpan("CodexSideChatCommands.discard", { attributes: { threadId } }),
        );
    };

    return CodexSideChatCommands.of({
      start: (input) =>
        start(input).pipe(
          Effect.withSpan("CodexSideChatCommands.start", {
            attributes: { parentThreadId: input.parentThreadId },
          }),
        ),
      discard,
    });
  });
