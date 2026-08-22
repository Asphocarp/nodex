import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
} from "@nodex/effect-codex-app-server/rpc";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type ThreadMethod =
  | "thread/resume"
  | "thread/fork"
  | "thread/archive"
  | "thread/unarchive"
  | "thread/delete"
  | "thread/read"
  | "thread/name/set"
  | "thread/memoryMode/set"
  | "turn/start"
  | "turn/steer"
  | "turn/interrupt";

type BackgroundTerminal =
  ClientRequestResponsesByMethod["thread/backgroundTerminals/list"]["data"][number];

export class ConversationCommands extends Context.Service<
  ConversationCommands,
  {
    readonly start: (
      hostId: string,
      params: ClientRequestParamsByMethod["thread/start"],
    ) => Effect.Effect<ClientRequestResponsesByMethod["thread/start"], CodexRuntimeError>;
    readonly request: <M extends ThreadMethod>(
      threadId: string,
      method: M,
      params: ClientRequestParamsByMethod[M],
    ) => Effect.Effect<ClientRequestResponsesByMethod[M], CodexRuntimeError>;
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

const closesRuntime = (method: ThreadMethod): boolean =>
  method === "thread/archive" || method === "thread/delete";

export const live: Layer.Layer<ConversationCommands, never, CodexGateway | ConversationRuntimeMap> =
  Layer.effect(
    ConversationCommands,
    Effect.gen(function* () {
      const gateway = yield* CodexGateway;
      const conversations = yield* ConversationRuntimeMap;
      const request: ConversationCommands["Service"]["request"] = (threadId, method, params) =>
        gateway
          .requestForThread(threadId, method, params)
          .pipe(
            Effect.tap(() => (closesRuntime(method) ? conversations.close(threadId) : Effect.void)),
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
        start: (hostId, params) => gateway.requestOnHost(hostId, "thread/start", params),
        request,
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
