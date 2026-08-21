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
  | "thread/settings/update"
  | "thread/memoryMode/set"
  | "thread/compact/start"
  | "turn/start"
  | "turn/steer"
  | "turn/interrupt";

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
      return ConversationCommands.of({
        start: (hostId, params) => gateway.requestOnHost(hostId, "thread/start", params),
        request,
      });
    }),
  );
