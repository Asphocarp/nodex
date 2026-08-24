import type {
  ClientRequestParamsByMethod,
  ClientRequestResponsesByMethod,
  ServerNotificationParamsByMethod,
} from "@nodex/effect-codex-app-server/rpc";
import { randomUUID } from "node:crypto";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Latch from "effect/Latch";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { CodexEndpointEvent } from "../codex-runtime/CodexEventHub";
import {
  buildThreadTitleGenerationPrompt,
  CODEX_THREAD_TITLE_CONFIG,
  CODEX_THREAD_TITLE_MODEL,
  CODEX_THREAD_TITLE_OUTPUT_SCHEMA,
  CODEX_THREAD_TITLE_TIMEOUT_MS,
  parseGeneratedThreadTitleResponse,
} from "../codex/thread-title-generator";
import { CodexInternalThreadRegistry } from "./CodexInternalThreadRegistry";
import { CodexThreadStartNotificationGate } from "./CodexThreadStartNotificationGate";

type ThreadStartParams = ClientRequestParamsByMethod["thread/start"];
type ThreadStartResponse = ClientRequestResponsesByMethod["thread/start"];
type TurnStartParams = ClientRequestParamsByMethod["turn/start"];
type TurnStartResponse = ClientRequestResponsesByMethod["turn/start"];
type TitleNotification =
  | {
      readonly _tag: "Delta";
      readonly params: ServerNotificationParamsByMethod["item/agentMessage/delta"];
    }
  | {
      readonly _tag: "ItemCompleted";
      readonly params: ServerNotificationParamsByMethod["item/completed"];
    }
  | {
      readonly _tag: "TurnError";
      readonly params: ServerNotificationParamsByMethod["error"];
    }
  | {
      readonly _tag: "TurnCompleted";
      readonly params: ServerNotificationParamsByMethod["turn/completed"];
    };

export interface CodexStructuredThreadTitleInput {
  readonly prompt: string;
  readonly cwd: string | null;
  readonly serviceName?: string;
}

export class CodexStructuredThreadTitleError extends Data.TaggedError(
  "CodexStructuredThreadTitleError",
)<{
  readonly reason: "request-failed" | "runtime-closed" | "timeout" | "turn-failed";
  readonly message: string;
  readonly cause?: unknown;
  readonly status?: string;
  readonly threadId?: string;
  readonly turnId?: string;
}> {}

export interface CodexStructuredThreadTitleOptions {
  readonly hostId: string;
  readonly events: Stream.Stream<CodexEndpointEvent>;
  readonly startThread: (
    params: ThreadStartParams,
  ) => Effect.Effect<ThreadStartResponse, CodexStructuredThreadTitleError>;
  readonly startTurn: (
    params: TurnStartParams,
  ) => Effect.Effect<TurnStartResponse, CodexStructuredThreadTitleError>;
  readonly interruptTurn: (
    threadId: string,
    turnId: string,
  ) => Effect.Effect<unknown, CodexStructuredThreadTitleError>;
  readonly unsubscribeThread: (
    threadId: string,
  ) => Effect.Effect<unknown, CodexStructuredThreadTitleError>;
  readonly timeout?: Duration.Input;
}

export class CodexStructuredThreadTitle extends Context.Service<
  CodexStructuredThreadTitle,
  {
    readonly generate: (
      input: CodexStructuredThreadTitleInput,
    ) => Effect.Effect<string | null, CodexStructuredThreadTitleError>;
  }
>()("nodex/main/codex-application/CodexStructuredThreadTitle") {}

const titleNotification = (event: CodexEndpointEvent, hostId: string): TitleNotification | null => {
  if (event.kind !== "notification" || event.hostId !== hostId) return null;
  switch (event.value.method) {
    case "item/agentMessage/delta":
      return {
        _tag: "Delta",
        params: event.value.params as ServerNotificationParamsByMethod["item/agentMessage/delta"],
      };
    case "item/completed":
      return {
        _tag: "ItemCompleted",
        params: event.value.params as ServerNotificationParamsByMethod["item/completed"],
      };
    case "error":
      return {
        _tag: "TurnError",
        params: event.value.params as ServerNotificationParamsByMethod["error"],
      };
    case "turn/completed":
      return {
        _tag: "TurnCompleted",
        params: event.value.params as ServerNotificationParamsByMethod["turn/completed"],
      };
    default:
      return null;
  }
};

const requestError = (operation: string, cause: unknown, threadId?: string) =>
  new CodexStructuredThreadTitleError({
    reason: "request-failed",
    message: `Structured thread title ${operation} failed`,
    cause,
    ...(threadId === undefined ? {} : { threadId }),
  });

const terminalError = (
  params: ServerNotificationParamsByMethod["turn/completed"],
  observedError: ServerNotificationParamsByMethod["error"]["error"] | null,
) => {
  const status = params.turn.status;
  const error = params.turn.error ?? observedError;
  const details = [error?.message, error?.additionalDetails]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
  const prefix =
    status === "failed"
      ? "Structured turn failed"
      : status === "interrupted"
        ? "Structured turn was interrupted"
        : `Structured turn ended with status ${status}`;
  return new CodexStructuredThreadTitleError({
    reason: "turn-failed",
    message: details ? `${prefix}: ${details}` : `${prefix}.`,
    cause: error ?? undefined,
    status,
    threadId: params.threadId,
    turnId: params.turn.id,
  });
};

const textFromCompletedItem = (
  params: ServerNotificationParamsByMethod["item/completed"],
): string | null => {
  if (params.item.type !== "agentMessage") return null;
  return params.item.text;
};

export const make = (
  options: CodexStructuredThreadTitleOptions,
): Effect.Effect<
  CodexStructuredThreadTitle["Service"],
  never,
  CodexInternalThreadRegistry | CodexThreadStartNotificationGate | Scope.Scope
> =>
  Effect.gen(function* () {
    const internalThreads = yield* CodexInternalThreadRegistry;
    const threadStarts = yield* CodexThreadStartNotificationGate;
    const closed = yield* Latch.make();
    yield* Effect.addFinalizer(() => closed.open);

    const awaitTitle = (
      threadId: string,
      turnId: string,
      notifications: Queue.Queue<TitleNotification>,
    ) => {
      const loop = (
        assistantText: string | null,
        observedError: ServerNotificationParamsByMethod["error"]["error"] | null,
      ): Effect.Effect<string | null, CodexStructuredThreadTitleError> =>
        Queue.take(notifications).pipe(
          Effect.flatMap((notification) => {
            if (notification.params.threadId !== threadId) {
              return loop(assistantText, observedError);
            }
            if (notification._tag === "TurnCompleted") {
              if (notification.params.turn.id !== turnId) {
                return loop(assistantText, observedError);
              }
              if (notification.params.turn.status !== "completed") {
                return Effect.fail(terminalError(notification.params, observedError));
              }
              return Effect.try({
                try: () => parseGeneratedThreadTitleResponse(assistantText),
                catch: (cause) => requestError("result parsing", cause, threadId),
              });
            }
            if (notification.params.turnId !== turnId) {
              return loop(assistantText, observedError);
            }
            if (notification._tag === "TurnError") {
              return loop(assistantText, notification.params.error);
            }
            if (notification._tag === "Delta") {
              return loop(`${assistantText ?? ""}${notification.params.delta}`, observedError);
            }
            return loop(textFromCompletedItem(notification.params) ?? assistantText, observedError);
          }),
        );
      return loop(null, null);
    };

    const run = (input: CodexStructuredThreadTitleInput) =>
      Effect.scoped(
        Effect.gen(function* () {
          const prompt = buildThreadTitleGenerationPrompt(input.prompt.trim());
          if (!prompt) return null;

          const thread = yield* Effect.acquireRelease(
            threadStarts.materialize(
              options.hostId,
              options
                .startThread({
                  model: CODEX_THREAD_TITLE_MODEL,
                  modelProvider: null,
                  cwd: input.cwd,
                  approvalPolicy: "never",
                  permissions: ":read-only",
                  runtimeWorkspaceRoots: [],
                  config: CODEX_THREAD_TITLE_CONFIG,
                  personality: null,
                  ephemeral: true,
                  threadSource: "system",
                  experimentalRawEvents: false,
                  dynamicTools: null,
                  serviceTier: null,
                  ...(input.serviceName === undefined ? {} : { serviceName: input.serviceName }),
                })
                .pipe(
                  Effect.tap((response) =>
                    internalThreads.leaseStructuredTitle(response.thread.id),
                  ),
                ),
              (response) => response.thread.id,
            ),
            (response) => options.unsubscribeThread(response.thread.id).pipe(Effect.ignore),
          );
          const threadId = thread.thread.id;
          const notifications = yield* Queue.unbounded<TitleNotification>();
          yield* Effect.addFinalizer(() => Queue.shutdown(notifications).pipe(Effect.asVoid));
          yield* options.events.pipe(
            Stream.runForEach((event) => {
              const notification = titleNotification(event, options.hostId);
              return notification === null
                ? Effect.void
                : Queue.offer(notifications, notification).pipe(Effect.asVoid);
            }),
            Effect.forkScoped,
          );
          yield* Effect.yieldNow;

          const waitForTurn = Effect.acquireUseRelease(
            options.startTurn({
              threadId,
              clientUserMessageId: randomUUID(),
              input: [{ type: "text", text: prompt, text_elements: [] }],
              cwd: null,
              approvalPolicy: null,
              permissions: ":read-only",
              runtimeWorkspaceRoots: [],
              model: null,
              effort: null,
              serviceTier: null,
              summary: "none",
              personality: null,
              outputSchema: CODEX_THREAD_TITLE_OUTPUT_SCHEMA,
              collaborationMode: null,
            }),
            (response) => awaitTitle(threadId, response.turn.id, notifications),
            (response, exit) =>
              Exit.isSuccess(exit)
                ? Effect.void
                : options.interruptTurn(threadId, response.turn.id).pipe(Effect.ignore),
          );
          return yield* Effect.raceFirst(
            waitForTurn,
            Effect.sleep(options.timeout ?? CODEX_THREAD_TITLE_TIMEOUT_MS).pipe(
              Effect.andThen(
                Effect.fail(
                  new CodexStructuredThreadTitleError({
                    reason: "timeout",
                    message: "Timed out waiting for structured result.",
                    threadId,
                  }),
                ),
              ),
            ),
          );
        }),
      );

    return CodexStructuredThreadTitle.of({
      generate: (input) =>
        Effect.raceFirst(
          run(input),
          closed.await.pipe(
            Effect.andThen(
              Effect.fail(
                new CodexStructuredThreadTitleError({
                  reason: "runtime-closed",
                  message: "The structured thread title runtime is closing",
                }),
              ),
            ),
          ),
        ),
    });
  });
