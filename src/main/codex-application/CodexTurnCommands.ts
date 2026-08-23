import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Random from "effect/Random";
import type * as Scope from "effect/Scope";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import type {
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
} from "@nodex/codex-app-server-protocol/v2";
import type {
  CodexPreparedPrompt,
  CodexSteerTurnInput,
  CodexTurnStartOptions,
  CodexTurnSummary,
} from "../../shared/types";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type GatewayTurnStartParams = ClientRequestParamsByMethod["turn/start"];
type GatewayTurnSteerParams = ClientRequestParamsByMethod["turn/steer"];

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

export interface CodexPreparedTurnSteer {
  readonly threadId: string;
  readonly request: TurnSteerParams;
  readonly fallbackStart: {
    readonly prompt: string;
    readonly overrides: CodexTurnStartOverrides;
    readonly syncDormantConversationUpdates: boolean;
  };
  /** Opaque mutable transaction state owned exclusively by the projection. */
  readonly state: object;
}

export class CodexTurnCommandProjectionError extends Data.TaggedError(
  "CodexTurnCommandProjectionError",
)<{
  readonly operation:
    | "prepare-start"
    | "begin-start"
    | "recover-start"
    | "commit-start"
    | "rollback-start"
    | "prepare-steer"
    | "begin-steer"
    | "commit-steer"
    | "rollback-steer";
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
  readonly prepareSteer: (input: {
    readonly command: CodexSteerTurnInput;
    readonly steerId: string;
    readonly syncDormantConversationUpdates: boolean;
  }) => Effect.Effect<CodexPreparedTurnSteer, CodexTurnCommandProjectionError>;
  readonly beginSteer: (
    prepared: CodexPreparedTurnSteer,
  ) => Effect.Effect<void, CodexTurnCommandProjectionError>;
  readonly commitSteer: (
    prepared: CodexPreparedTurnSteer,
    response: TurnSteerResponse,
  ) => Effect.Effect<{ readonly turnId: string } | null, CodexTurnCommandProjectionError>;
  readonly rollbackSteer: (prepared: CodexPreparedTurnSteer, cause: unknown) => Effect.Effect<void>;
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
  readonly steer: (
    input: CodexSteerTurnInput,
    options?: { readonly syncDormantConversationUpdates?: boolean },
  ) => Effect.Effect<
    { readonly turnId: string } | null,
    CodexRuntimeError | CodexTurnCommandProjectionError
  >;
  readonly steerRendererOwned: (
    params: TurnSteerParams,
  ) => Effect.Effect<TurnSteerResponse, CodexRuntimeError>;
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

const isSteerTurnInactive = (
  error: CodexRuntimeError | CodexTurnCommandProjectionError,
): boolean => {
  if (error._tag !== "CodexRuntimeError") return false;
  const cause = error.cause;
  if (!(cause instanceof CodexAppServerRequestError)) return false;
  const codexErrorInfo =
    typeof cause.data === "object" && cause.data !== null
      ? (cause.data as Record<string, unknown>).codexErrorInfo
      : null;
  if (
    typeof codexErrorInfo === "object" &&
    codexErrorInfo !== null &&
    "activeTurnNotSteerable" in codexErrorInfo
  ) {
    return true;
  }
  const message = cause.message.toLowerCase();
  return (
    message.includes("steerturninactiveerror") ||
    message.includes("active turn not steerable") ||
    (message.includes("active turn") && message.includes("not") && message.includes("steer"))
  );
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

    const startInTransaction = (
      threadId: string,
      prompt: string,
      overrides: CodexTurnStartOverrides | undefined,
      rendererOwnsState: boolean,
      syncDormantConversationUpdates: boolean,
    ) =>
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
        );

    const start = (
      threadId: string,
      prompt: string,
      overrides: CodexTurnStartOverrides | undefined,
      rendererOwnsState: boolean,
      syncDormantConversationUpdates: boolean,
    ) =>
      conversations.runExclusive(
        threadId,
        startInTransaction(
          threadId,
          prompt,
          overrides,
          rendererOwnsState,
          syncDormantConversationUpdates,
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
      steer: (input, options) =>
        conversations
          .runExclusive(
            input.threadId,
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              const nonce = yield* Random.nextIntBetween(0, 36 ** 6);
              return yield* projection.prepareSteer({
                command: input,
                steerId: `steer:${input.threadId}:${now}:${nonce.toString(36).padStart(6, "0")}`,
                syncDormantConversationUpdates: options?.syncDormantConversationUpdates ?? true,
              });
            }).pipe(
              Effect.flatMap((prepared) =>
                projection.beginSteer(prepared).pipe(
                  Effect.andThen(
                    gateway.requestForThread(
                      prepared.threadId,
                      "turn/steer",
                      prepared.request as GatewayTurnSteerParams,
                    ),
                  ),
                  Effect.flatMap((response) =>
                    projection.commitSteer(prepared, response as unknown as TurnSteerResponse),
                  ),
                  Effect.onExit((exit) =>
                    Exit.isFailure(exit)
                      ? projection.rollbackSteer(prepared, exit.cause)
                      : Effect.void,
                  ),
                  Effect.catch((error) => {
                    if (!isSteerTurnInactive(error)) return Effect.fail(error);
                    return startInTransaction(
                      prepared.threadId,
                      prepared.fallbackStart.prompt,
                      prepared.fallbackStart.overrides,
                      false,
                      prepared.fallbackStart.syncDormantConversationUpdates,
                    ).pipe(
                      Effect.map((started) =>
                        started && "turnId" in started && started.turnId
                          ? { turnId: started.turnId }
                          : null,
                      ),
                    );
                  }),
                ),
              ),
            ),
          )
          .pipe(
            Effect.withSpan("CodexTurnCommands.steer", {
              attributes: { threadId: input.threadId },
            }),
          ),
      steerRendererOwned: (params) =>
        conversations
          .runExclusive(
            params.threadId,
            gateway
              .requestForThread(params.threadId, "turn/steer", params as GatewayTurnSteerParams)
              .pipe(Effect.map((response) => response as unknown as TurnSteerResponse)),
          )
          .pipe(
            Effect.withSpan("CodexTurnCommands.steerRendererOwned", {
              attributes: { threadId: params.threadId },
            }),
          ),
    });
  });
