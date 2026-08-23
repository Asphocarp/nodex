import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Scope from "effect/Scope";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import type { TurnStartParams, TurnStartResponse } from "@nodex/codex-app-server-protocol/v2";
import type {
  CodexPreparedPrompt,
  CodexTurnStartOptions,
  CodexTurnSummary,
} from "../../shared/types";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type GatewayTurnStartParams = ClientRequestParamsByMethod["turn/start"];

export type CodexTurnStartOverrides = CodexTurnStartOptions & {
  readonly clientUserMessageId?: string;
  readonly preparedPrompt?: CodexPreparedPrompt;
};

export interface CodexPreparedTurnStart {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly request: TurnStartParams;
  readonly rendererOwnsState: boolean;
  /** Opaque mutable transaction state owned exclusively by the projection. */
  readonly state: object;
}

export class CodexTurnCommandProjectionError extends Data.TaggedError(
  "CodexTurnCommandProjectionError",
)<{
  readonly operation: "prepare" | "begin" | "recover" | "commit" | "rollback";
  readonly threadId: string;
  readonly cause: unknown;
}> {}

export interface CodexTurnCommandProjection {
  readonly prepareStart: (input: {
    readonly threadId: string;
    readonly prompt: string;
    readonly overrides?: CodexTurnStartOverrides;
    readonly rendererOwnsState: boolean;
    readonly syncDormantConversationUpdates: boolean;
  }) => Effect.Effect<CodexPreparedTurnStart, CodexTurnCommandProjectionError>;
  readonly beginStart: (
    prepared: CodexPreparedTurnStart,
  ) => Effect.Effect<void, CodexTurnCommandProjectionError>;
  readonly recoverStart: (
    prepared: CodexPreparedTurnStart,
  ) => Effect.Effect<TurnStartParams, CodexTurnCommandProjectionError>;
  readonly commitStart: (
    prepared: CodexPreparedTurnStart,
    response: TurnStartResponse,
  ) => Effect.Effect<CodexTurnSummary | TurnStartResponse | null, CodexTurnCommandProjectionError>;
  readonly rollbackStart: (prepared: CodexPreparedTurnStart, cause: unknown) => Effect.Effect<void>;
}

export interface CodexTurnCommandsService {
  readonly start: (
    threadId: string,
    prompt: string,
    overrides?: CodexTurnStartOverrides,
    options?: { readonly syncDormantConversationUpdates?: boolean },
  ) => Effect.Effect<CodexTurnSummary | null, CodexRuntimeError | CodexTurnCommandProjectionError>;
  readonly startRendererOwned: (
    threadId: string,
    prompt: string,
    overrides?: CodexTurnStartOverrides,
  ) => Effect.Effect<TurnStartResponse, CodexRuntimeError | CodexTurnCommandProjectionError>;
}

export class CodexTurnCommands extends Context.Service<
  CodexTurnCommands,
  CodexTurnCommandsService
>()("nodex/main/codex-application/CodexTurnCommands") {}

const requestErrorMessage = (error: CodexRuntimeError): string | null => {
  const cause = error.cause;
  if (cause instanceof CodexAppServerRequestError) return cause.message;
  return null;
};

const isThreadNotFound = (error: CodexRuntimeError): boolean => {
  const message = requestErrorMessage(error)?.toLowerCase();
  return Boolean(message?.includes("thread") && message.includes("not found"));
};

export const make = (
  projection: CodexTurnCommandProjection,
): Effect.Effect<
  CodexTurnCommandsService,
  never,
  CodexGateway | ConversationRuntimeMap | ProjectRuntimeLifecycleRuntime | Scope.Scope
> =>
  Effect.gen(function* () {
    const conversations = yield* ConversationRuntimeMap;
    const gateway = yield* CodexGateway;
    const projectLifecycle = yield* ProjectRuntimeLifecycleRuntime;

    const start = (
      threadId: string,
      prompt: string,
      overrides: CodexTurnStartOverrides | undefined,
      rendererOwnsState: boolean,
      syncDormantConversationUpdates: boolean,
    ) =>
      conversations.runExclusive(
        threadId,
        projection
          .prepareStart({
            threadId,
            prompt,
            ...(overrides ? { overrides } : {}),
            rendererOwnsState,
            syncDormantConversationUpdates,
          })
          .pipe(
            Effect.flatMap((prepared) =>
              projectLifecycle.runExclusive(
                prepared.projectId,
                projection.beginStart(prepared).pipe(
                  Effect.andThen(
                    gateway
                      .requestForThread(
                        prepared.threadId,
                        "turn/start",
                        prepared.request as GatewayTurnStartParams,
                      )
                      .pipe(
                        Effect.catch((error) => {
                          if (prepared.rendererOwnsState || !isThreadNotFound(error)) {
                            return Effect.fail(error);
                          }
                          return projection
                            .recoverStart(prepared)
                            .pipe(
                              Effect.flatMap((retryRequest) =>
                                gateway.requestForThread(
                                  prepared.threadId,
                                  "turn/start",
                                  retryRequest as GatewayTurnStartParams,
                                ),
                              ),
                            );
                        }),
                      ),
                  ),
                  Effect.flatMap((response) =>
                    projection.commitStart(prepared, response as unknown as TurnStartResponse),
                  ),
                  Effect.onExit((exit) =>
                    Exit.isFailure(exit)
                      ? projection.rollbackStart(prepared, exit.cause)
                      : Effect.void,
                  ),
                ),
              ),
            ),
          ),
      );

    return CodexTurnCommands.of({
      start: (threadId, prompt, overrides, options) =>
        start(
          threadId,
          prompt,
          overrides,
          false,
          options?.syncDormantConversationUpdates ?? true,
        ).pipe(
          Effect.map((result) => result as CodexTurnSummary | null),
          Effect.withSpan("CodexTurnCommands.start", { attributes: { threadId } }),
        ),
      startRendererOwned: (threadId, prompt, overrides) =>
        start(threadId, prompt, overrides, true, false).pipe(
          Effect.map((result) => result as TurnStartResponse),
          Effect.withSpan("CodexTurnCommands.startRendererOwned", {
            attributes: { threadId },
          }),
        ),
    });
  });
