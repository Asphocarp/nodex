import type {
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
} from "@nodex/effect-codex-app-server/rpc";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { CodexThreadSummary } from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import {
  CodexConversationArchive,
  type CodexConversationArchiveError,
} from "./CodexConversationArchive";
import {
  CodexConversationProjection,
  type CodexConversationProjectionError,
} from "./CodexConversationProjection";
import { CodexQueuedFollowUps } from "./CodexQueuedFollowUps";
import {
  CodexServerRequestResponses,
  type CodexServerRequestResponseProjectionError,
} from "./CodexServerRequestResponses";
import { type CodexThreadGoalError, CodexThreadGoalRuntime } from "./CodexThreadGoalRuntime";
import { ConversationEntityMap } from "./internal/ConversationEntityMap";

type BackgroundTerminal =
  ClientRequestResponsesByMethod["thread/backgroundTerminals/list"]["data"][number];

type ConversationCommandsError =
  | CodexRuntimeError
  | CodexConversationArchiveError
  | CodexConversationProjectionError
  | CodexServerRequestResponseProjectionError
  | CodexThreadGoalError;

export class ConversationCommands extends Context.Service<
  ConversationCommands,
  {
    readonly archive: (threadId: string) => Effect.Effect<boolean, CodexConversationArchiveError>;
    readonly unarchive: (
      threadId: string,
    ) => Effect.Effect<CodexThreadSummary | null, CodexConversationArchiveError>;
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
    readonly listBackgroundTerminalsPage: (
      threadId: string,
      options?: { readonly cursor?: string | null; readonly limit?: number },
    ) => Effect.Effect<
      ClientRequestResponsesByMethod["thread/backgroundTerminals/list"],
      CodexRuntimeError
    >;
    readonly terminateBackgroundTerminal: (
      threadId: string,
      processId: string,
    ) => Effect.Effect<boolean, CodexRuntimeError>;
    readonly interrupt: (
      threadId: string,
      turnId?: string,
    ) => Effect.Effect<boolean, ConversationCommandsError>;
    readonly cleanBackgroundTerminals: (
      threadId: string,
    ) => Effect.Effect<boolean, ConversationCommandsError>;
    readonly cleanBackgroundTerminalsSilently: (
      threadId: string,
    ) => Effect.Effect<boolean, ConversationCommandsError>;
  }
>()("nodex/main/codex-application/ConversationCommands") {}

export const live: Layer.Layer<
  ConversationCommands,
  never,
  | CodexConversationArchive
  | CodexConversationProjection
  | CodexGateway
  | CodexQueuedFollowUps
  | CodexServerRequestResponses
  | CodexThreadGoalRuntime
  | ConversationEntityMap
> = Layer.effect(
  ConversationCommands,
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const archive = yield* CodexConversationArchive;
    const conversations = yield* ConversationEntityMap;
    const serverRequestResponses = yield* CodexServerRequestResponses;
    const projection = yield* CodexConversationProjection;
    const queuedFollowUps = yield* CodexQueuedFollowUps;
    const threadGoals = yield* CodexThreadGoalRuntime;

    const runSerial = <A, E>(threadId: string, operation: Effect.Effect<A, E>) =>
      conversations.runCommand(threadId, operation);
    const listBackgroundTerminalsPage = (
      threadId: string,
      options?: { readonly cursor?: string | null; readonly limit?: number },
    ) =>
      gateway.requestForThread(threadId, "thread/backgroundTerminals/list", {
        threadId,
        cursor: options?.cursor ?? null,
        ...(options?.limit === undefined ? {} : { limit: options.limit }),
      });
    const listBackgroundTerminals = (
      threadId: string,
      cursor: string | null = null,
      collected: readonly BackgroundTerminal[] = [],
    ): Effect.Effect<readonly BackgroundTerminal[], CodexRuntimeError> =>
      listBackgroundTerminalsPage(threadId, { cursor, limit: 100 }).pipe(
        Effect.flatMap((response) => {
          const next = [...collected, ...response.data];
          return response.nextCursor
            ? listBackgroundTerminals(threadId, response.nextCursor, next)
            : Effect.succeed(next);
        }),
      );
    const pauseActiveGoal = (threadId: string) =>
      threadGoals
        .get(threadId)
        .pipe(
          Effect.flatMap((goal) =>
            goal?.status === "active"
              ? threadGoals
                  .set({ threadId, status: "paused", dismissResumeConfirmation: true })
                  .pipe(Effect.asVoid)
              : Effect.void,
          ),
        );
    const interruptInLane = (
      threadId: string,
      turnId?: string,
    ): Effect.Effect<boolean, ConversationCommandsError> =>
      Effect.gen(function* () {
        const resolvedTurnId = yield* projection.resolveInterruptTurn(threadId, turnId);
        yield* pauseActiveGoal(threadId);
        yield* serverRequestResponses.declineAllInTransaction(threadId);
        yield* Effect.logWarning("Interrupting Codex Turn").pipe(
          Effect.annotateLogs({ threadId, requestedTurnId: turnId ?? null, resolvedTurnId }),
        );
        yield* gateway.requestForThread(threadId, "turn/interrupt", {
          threadId,
          turnId: resolvedTurnId,
        });
        const observedAtMs = yield* Clock.currentTimeMillis;
        yield* projection
          .commitInterruptedTurn({ threadId, turnId: resolvedTurnId, observedAtMs })
          .pipe(
            Effect.catch((cause) =>
              Effect.logError("Failed to reconcile an accepted Turn interruption").pipe(
                Effect.annotateLogs({ threadId, turnId: resolvedTurnId, cause }),
              ),
            ),
          );
        yield* queuedFollowUps.requestDispatch(threadId);
        return true;
      });

    return ConversationCommands.of({
      archive: (threadId) =>
        runSerial(threadId, archive.archive(threadId)).pipe(
          Effect.tap((archived) => (archived ? conversations.retire(threadId) : Effect.void)),
        ),
      unarchive: (threadId) => runSerial(threadId, archive.unarchive(threadId)),
      setMemoryMode: (threadId, mode) =>
        gateway
          .requestForThread(threadId, "thread/memoryMode/set", { threadId, mode })
          .pipe(Effect.asVoid),
      startReview: (params) => gateway.requestForThread(params.threadId, "review/start", params),
      uploadFeedback: (params) =>
        gateway.requestLocal("feedback/upload", params).pipe(Effect.asVoid),
      listBackgroundTerminalsPage: (threadId, options) =>
        listBackgroundTerminalsPage(threadId.trim(), options),
      listBackgroundTerminals: (threadId) => listBackgroundTerminals(threadId.trim()),
      terminateBackgroundTerminal: (threadId, processId) =>
        gateway
          .requestForThread(threadId, "thread/backgroundTerminals/terminate", {
            threadId,
            processId,
          })
          .pipe(Effect.map((response) => response.terminated)),
      interrupt: (threadId, turnId) => runSerial(threadId, interruptInLane(threadId, turnId)),
      cleanBackgroundTerminals: (threadId) =>
        runSerial(
          threadId,
          projection.backgroundTerminalTurnIds(threadId).pipe(
            Effect.flatMap((turnIds) => {
              if (turnIds === null) return Effect.succeed(false);
              if (turnIds.length === 0) return Effect.succeed(true);
              return Effect.forEach(turnIds, (turnId) => interruptInLane(threadId, turnId), {
                discard: true,
              }).pipe(Effect.as(true));
            }),
          ),
        ),
      cleanBackgroundTerminalsSilently: (threadId) =>
        runSerial(
          threadId,
          gateway
            .requestForThread(threadId, "thread/backgroundTerminals/clean", { threadId })
            .pipe(
              Effect.andThen(
                Clock.currentTimeMillis.pipe(
                  Effect.flatMap((observedAtMs) =>
                    projection.backgroundTerminalsCleaned(threadId, observedAtMs),
                  ),
                ),
              ),
              Effect.as(true),
            ),
        ),
    });
  }),
);
