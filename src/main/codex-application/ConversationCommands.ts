import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as RcMap from "effect/RcMap";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type {
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
} from "@nodex/effect-codex-app-server/rpc";
import type { CodexThreadSummary } from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type BackgroundTerminal =
  ClientRequestResponsesByMethod["thread/backgroundTerminals/list"]["data"][number];

export class ConversationCommandProjectionError extends Data.TaggedError(
  "ConversationCommandProjectionError",
)<{
  readonly operation: "archive" | "unarchive";
  readonly threadId: string;
  readonly cause: unknown;
}> {}

export interface ConversationCommandProjection {
  readonly archive: (
    threadId: string,
  ) => Effect.Effect<boolean, ConversationCommandProjectionError>;
  readonly unarchive: (
    threadId: string,
  ) => Effect.Effect<CodexThreadSummary | null, ConversationCommandProjectionError>;
}

export class ConversationCommands extends Context.Service<
  ConversationCommands,
  {
    readonly archive: (
      threadId: string,
    ) => Effect.Effect<boolean, CodexRuntimeError | ConversationCommandProjectionError>;
    readonly unarchive: (
      threadId: string,
    ) => Effect.Effect<
      CodexThreadSummary | null,
      CodexRuntimeError | ConversationCommandProjectionError
    >;
    readonly setMemoryMode: (
      threadId: string,
      mode: ClientRequestParamsByMethod["thread/memoryMode/set"]["mode"],
    ) => Effect.Effect<void, CodexRuntimeError>;
    readonly startReview: (
      params: ClientRequestParamsByMethod["review/start"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["review/start"], CodexRuntimeError>;
    readonly uploadFeedback: (
      params: ClientRequestParamsByMethod["feedback/upload"],
    ) => Effect.Effect<void, CodexRuntimeError>;
    readonly listBackgroundTerminals: (
      threadId: string,
    ) => Effect.Effect<readonly BackgroundTerminal[], CodexRuntimeError>;
    readonly terminateBackgroundTerminal: (
      threadId: string,
      processId: string,
    ) => Effect.Effect<boolean, CodexRuntimeError>;
  }
>()("nodex/main/codex-application/ConversationCommands") {}

export const live = (
  projection: ConversationCommandProjection,
): Layer.Layer<ConversationCommands, never, CodexGateway | ConversationRuntimeMap> =>
  Layer.effect(
    ConversationCommands,
    Effect.gen(function* () {
      const gateway = yield* CodexGateway;
      const conversations = yield* ConversationRuntimeMap;
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
      const listBackgroundTerminals = (
        threadId: string,
        cursor: string | null = null,
        collected: readonly BackgroundTerminal[] = [],
      ): Effect.Effect<readonly BackgroundTerminal[], CodexRuntimeError> =>
        gateway
          .requestForThread(threadId, "thread/backgroundTerminals/list", {
            threadId,
            cursor,
            limit: 100,
          })
          .pipe(
            Effect.flatMap((response) => {
              const next = [...collected, ...response.data];
              return response.nextCursor
                ? listBackgroundTerminals(threadId, response.nextCursor, next)
                : Effect.succeed(next);
            }),
          );
      return ConversationCommands.of({
        archive: (threadId) =>
          runSerial(
            threadId,
            gateway.requestForThread(threadId, "thread/archive", { threadId }).pipe(
              Effect.andThen(projection.archive(threadId)),
              Effect.tap((archived) => (archived ? conversations.close(threadId) : Effect.void)),
            ),
          ),
        unarchive: (threadId) =>
          runSerial(
            threadId,
            gateway
              .requestForThread(threadId, "thread/unarchive", { threadId })
              .pipe(Effect.andThen(projection.unarchive(threadId))),
          ),
        setMemoryMode: (threadId, mode) =>
          gateway
            .requestForThread(threadId, "thread/memoryMode/set", { threadId, mode })
            .pipe(Effect.asVoid),
        startReview: (params) => gateway.requestForThread(params.threadId, "review/start", params),
        uploadFeedback: (params) =>
          gateway.requestLocal("feedback/upload", params).pipe(Effect.asVoid),
        listBackgroundTerminals: (threadId) => listBackgroundTerminals(threadId.trim()),
        terminateBackgroundTerminal: (threadId, processId) =>
          gateway
            .requestForThread(threadId, "thread/backgroundTerminals/terminate", {
              threadId,
              processId,
            })
            .pipe(Effect.map((response) => response.terminated)),
      });
    }),
  );
