import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import {
  CodexAppServerRequestError,
  type CodexAppServerError,
} from "@nodex/effect-codex-app-server/errors";
import { CodexAppServerNoResponse } from "@nodex/effect-codex-app-server/protocol";
import { CodexApplicationRequestInbox } from "../codex-runtime/CodexApplicationRequestInbox";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

export const CodexApplicationRequestPending = Symbol.for(
  "nodex/main/codex-application/CodexApplicationRequestPending",
);

export class CodexGlobalServerRequestRuntime extends Context.Service<
  CodexGlobalServerRequestRuntime,
  {
    readonly handle: (
      hostId: string,
      generation: number,
      requestId: string | number,
      method: string,
      params: unknown,
      occurrenceToken?: number,
    ) => Effect.Effect<unknown, CodexAppServerError>;
  }
>()("nodex/main/codex-application/CodexGlobalServerRequestRuntime") {}

export class ApprovalCoordinator extends Context.Service<
  ApprovalCoordinator,
  {
    readonly handle: CodexGlobalServerRequestRuntime["Service"]["handle"];
    readonly handleUnknown: CodexGlobalServerRequestRuntime["Service"]["handle"];
    readonly respond: (
      threadId: string,
      generation: number,
      requestId: string | number,
      response: unknown,
    ) => Effect.Effect<boolean>;
    readonly reject: (
      threadId: string,
      generation: number,
      requestId: string | number,
      error: CodexAppServerError,
    ) => Effect.Effect<boolean>;
    readonly respondToken: (
      threadId: string,
      token: number,
      response: unknown,
    ) => Effect.Effect<boolean>;
    readonly rejectToken: (
      threadId: string,
      token: number,
      error: CodexAppServerError,
    ) => Effect.Effect<boolean>;
  }
>()("nodex/main/codex-application/ApprovalCoordinator") {}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/** Method metadata is the only place where a server request is mapped to thread ownership. */
export const serverRequestThreadId = (method: string, params: unknown): string | undefined => {
  const record = asRecord(params);
  if (record === undefined) return undefined;
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/tool/requestUserInput":
    case "item/permissions/requestApproval":
    case "item/tool/call":
    case "currentTime/read":
      return typeof record.threadId === "string" ? record.threadId : undefined;
    case "applyPatchApproval":
    case "execCommandApproval":
      return typeof record.conversationId === "string" ? record.conversationId : undefined;
    case "mcpServer/elicitation/request":
      return typeof record.threadId === "string" ? record.threadId : undefined;
    case "account/chatgptAuthTokens/refresh":
    case "attestation/generate":
      return undefined;
    default:
      if (typeof record.threadId === "string") return record.threadId;
      return typeof record.conversationId === "string" ? record.conversationId : undefined;
  }
};

export const live: Layer.Layer<
  ApprovalCoordinator,
  never,
  ConversationRuntimeMap | CodexGlobalServerRequestRuntime
> = Layer.effect(
  ApprovalCoordinator,
  Effect.gen(function* () {
    const conversations = yield* ConversationRuntimeMap;
    const global = yield* CodexGlobalServerRequestRuntime;
    const handle: ApprovalCoordinator["Service"]["handle"] = (
      hostId,
      generation,
      requestId,
      method,
      params,
      occurrenceToken,
    ) => {
      if (method === "currentTime/read") {
        return Clock.currentTimeMillis.pipe(
          Effect.map((milliseconds) => ({ currentTimeAt: Math.floor(milliseconds / 1_000) })),
        );
      }
      const threadId = serverRequestThreadId(method, params);
      if (threadId === undefined) {
        return global.handle(hostId, generation, requestId, method, params, occurrenceToken);
      }
      return conversations
        .runtime(threadId)
        .pipe(
          Effect.flatMap((runtime) =>
            runtime.request({ hostId, generation, requestId, method, params }),
          ),
        );
    };
    return ApprovalCoordinator.of({
      handle,
      handleUnknown: handle,
      respond: (threadId, generation, requestId, response) =>
        conversations
          .runtime(threadId)
          .pipe(Effect.flatMap((runtime) => runtime.respond(generation, requestId, response))),
      reject: (threadId, generation, requestId, error) =>
        conversations
          .runtime(threadId)
          .pipe(Effect.flatMap((runtime) => runtime.reject(generation, requestId, error))),
      respondToken: (threadId, token, response) =>
        conversations
          .runtime(threadId)
          .pipe(Effect.flatMap((runtime) => runtime.respondToken(token, response))),
      rejectToken: (threadId, token, error) =>
        conversations
          .runtime(threadId)
          .pipe(Effect.flatMap((runtime) => runtime.rejectToken(token, error))),
    });
  }),
);

/**
 * Transfers admitted physical occurrences into the application interpreter without ever occupying
 * the app-server wire reader. The Inbox remains the sole owner of the eventual wire settlement.
 */
export const applicationRequestIngressLive: Layer.Layer<
  never,
  never,
  ApprovalCoordinator | CodexApplicationRequestInbox
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const coordinator = yield* ApprovalCoordinator;
    const inbox = yield* CodexApplicationRequestInbox;
    yield* inbox.requests.pipe(
      Stream.mapEffect(
        (occurrence) =>
          coordinator
            .handle(
              occurrence.hostId,
              occurrence.generation,
              occurrence.requestId,
              occurrence.method,
              occurrence.params,
              occurrence.occurrenceToken,
            )
            .pipe(
              Effect.matchEffect({
                onFailure: (error) =>
                  inbox.settle(occurrence, {
                    kind: "error",
                    error: CodexAppServerRequestError.fromAppServerError(error, occurrence.method),
                  }),
                onSuccess: (response) => {
                  if (response === CodexApplicationRequestPending) return Effect.void;
                  return inbox.settle(
                    occurrence,
                    response === CodexAppServerNoResponse
                      ? { kind: "abandon" }
                      : { kind: "result", value: response },
                  );
                },
              }),
              Effect.asVoid,
            ),
        { concurrency: "unbounded", unordered: true },
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );
  }),
);

/**
 * Runs application request handling outside the endpoint reader. Each thread remains independent:
 * an approval waiting on UI never blocks requests for other conversations.
 */
export const applicationRequestDispatcherLive: Layer.Layer<
  never,
  never,
  ConversationRuntimeMap | CodexGlobalServerRequestRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const conversations = yield* ConversationRuntimeMap;
    const application = yield* CodexGlobalServerRequestRuntime;
    yield* conversations.requests.pipe(
      Stream.mapEffect(
        (envelope) => {
          const request = envelope.event.value;
          return conversations.runtime(envelope.threadId).pipe(
            Effect.flatMap((runtime) =>
              application
                .handle(
                  request.hostId,
                  request.generation,
                  request.requestId,
                  request.method,
                  request.params,
                  request.token,
                )
                .pipe(
                  Effect.matchEffect({
                    onFailure: (error) =>
                      runtime.reject(request.generation, request.requestId, error),
                    onSuccess: (response) =>
                      response === CodexApplicationRequestPending
                        ? Effect.void
                        : runtime.respond(request.generation, request.requestId, response),
                  }),
                  Effect.asVoid,
                ),
            ),
          );
        },
        { concurrency: "unbounded", unordered: true },
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );
  }),
);

export const unhandledGlobal: Layer.Layer<CodexGlobalServerRequestRuntime> = Layer.succeed(
  CodexGlobalServerRequestRuntime,
  CodexGlobalServerRequestRuntime.of({
    handle: (_hostId, _generation, requestId, method) =>
      Effect.fail(
        new CodexAppServerRequestError({
          code: -32_601,
          errorMessage: `Method not found: ${method}`,
          method,
          requestId: String(requestId),
          operation: "handle-request",
        }),
      ),
  }),
);
