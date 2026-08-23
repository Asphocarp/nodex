import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
  readonly operation:
    | "archive"
    | "unarchive"
    | "interrupt-prepare"
    | "interrupt-apply"
    | "background-terminal-turns"
    | "background-terminals-cleaned";
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
  readonly prepareInterrupt: (
    threadId: string,
    turnId?: string,
  ) => Effect.Effect<string, ConversationCommandProjectionError>;
  readonly applyInterrupt: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly syncDormantConversationUpdates: boolean;
  }) => Effect.Effect<boolean, ConversationCommandProjectionError>;
  readonly backgroundTerminalTurnIds: (
    threadId: string,
  ) => Effect.Effect<readonly string[] | null, ConversationCommandProjectionError>;
  readonly backgroundTerminalsCleaned: (
    threadId: string,
  ) => Effect.Effect<void, ConversationCommandProjectionError>;
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
    readonly interrupt: (
      threadId: string,
      turnId?: string,
      options?: { readonly syncDormantConversationUpdates?: boolean },
    ) => Effect.Effect<boolean, CodexRuntimeError | ConversationCommandProjectionError>;
    readonly cleanBackgroundTerminals: (
      threadId: string,
    ) => Effect.Effect<boolean, CodexRuntimeError | ConversationCommandProjectionError>;
    readonly cleanBackgroundTerminalsSilently: (
      threadId: string,
    ) => Effect.Effect<boolean, CodexRuntimeError | ConversationCommandProjectionError>;
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
      const runSerial = <A, E>(
        threadId: string,
        operation: Effect.Effect<A, E>,
      ): Effect.Effect<A, E> => conversations.runExclusive(threadId, operation);
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
      const interruptInLane = (
        threadId: string,
        turnId: string | undefined,
        syncDormantConversationUpdates: boolean,
      ): Effect.Effect<boolean, CodexRuntimeError | ConversationCommandProjectionError> =>
        projection.prepareInterrupt(threadId, turnId).pipe(
          Effect.tap((resolvedTurnId) =>
            Effect.logWarning("Interrupting Codex turn").pipe(
              Effect.annotateLogs({
                threadId,
                requestedTurnId: turnId ?? null,
                resolvedTurnId,
              }),
            ),
          ),
          Effect.flatMap((resolvedTurnId) =>
            gateway
              .requestForThread(threadId, "turn/interrupt", {
                threadId,
                turnId: resolvedTurnId,
              })
              .pipe(
                Effect.andThen(
                  projection.applyInterrupt({
                    threadId,
                    turnId: resolvedTurnId,
                    syncDormantConversationUpdates,
                  }),
                ),
              ),
          ),
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
        interrupt: (threadId, turnId, options) =>
          runSerial(
            threadId,
            interruptInLane(threadId, turnId, options?.syncDormantConversationUpdates ?? true),
          ),
        cleanBackgroundTerminals: (threadId) =>
          runSerial(
            threadId,
            projection.backgroundTerminalTurnIds(threadId).pipe(
              Effect.flatMap((turnIds) => {
                if (turnIds === null) return Effect.succeed(false);
                if (turnIds.length === 0) return Effect.succeed(true);
                return Effect.logWarning("Cleaning background terminals").pipe(
                  Effect.annotateLogs({ threadId, turnIds }),
                  Effect.andThen(
                    Effect.forEach(turnIds, (turnId) => interruptInLane(threadId, turnId, true), {
                      discard: true,
                    }),
                  ),
                  Effect.as(true),
                );
              }),
            ),
          ),
        cleanBackgroundTerminalsSilently: (threadId) =>
          runSerial(
            threadId,
            gateway
              .requestForThread(threadId, "thread/backgroundTerminals/clean", { threadId })
              .pipe(
                Effect.andThen(projection.backgroundTerminalsCleaned(threadId)),
                Effect.as(true),
              ),
          ),
      });
    }),
  );
