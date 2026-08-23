import { randomUUID } from "node:crypto";
import type {
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
} from "@nodex/codex-app-server-protocol/v2";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type {
  CodexPreparedPrompt,
  CodexSteerTurnInput,
  CodexTurnStartOptions,
  CodexTurnSummary,
} from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { CoreModules } from "../core-runtime/CoreModules";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexAutomationRunAcceptance } from "./CodexAutomationRunAcceptance";
import { CodexConversationMaterialization } from "./CodexConversationMaterialization";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { CodexQueuedFollowUps } from "./CodexQueuedFollowUps";
import { CodexTurnAuthority, type CodexTurnAuthorityLaunch } from "./CodexTurnAuthority";
import {
  CodexTurnPreparation,
  type CodexTurnStartPlan,
  type CodexTurnSteerPlan,
} from "./CodexTurnPreparation";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type GatewayTurnStartParams = ClientRequestParamsByMethod["turn/start"];
type GatewayTurnSteerParams = ClientRequestParamsByMethod["turn/steer"];

export type CodexTurnStartOverrides = CodexTurnStartOptions & {
  readonly clientUserMessageId?: string;
  readonly preparedPrompt?: CodexPreparedPrompt;
  readonly responsesapiClientMetadata?: TurnStartParams["responsesapiClientMetadata"];
};

export class CodexTurnCommandError extends Schema.TaggedError<CodexTurnCommandError>()(
  "CodexTurnCommandError",
  {
    operation: Schema.Literals(["start", "steer"]),
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type CodexTurnCommandsError = CodexRuntimeError | CodexTurnCommandError;

export interface CodexTurnCommandsService {
  readonly start: (
    threadId: string,
    prompt: string,
    overrides?: CodexTurnStartOverrides,
  ) => Effect.Effect<CodexTurnSummary | null, CodexTurnCommandsError>;
  readonly startRendererOwned: (
    threadId: string,
    prompt: string,
    overrides?: CodexTurnStartOverrides,
  ) => Effect.Effect<TurnStartResponse, CodexTurnCommandsError>;
  readonly steer: (
    input: CodexSteerTurnInput,
  ) => Effect.Effect<{ readonly turnId: string } | null, CodexTurnCommandsError>;
  readonly steerRendererOwned: (
    params: TurnSteerParams,
  ) => Effect.Effect<TurnSteerResponse, CodexRuntimeError>;
}

export class CodexTurnCommands extends Context.Service<
  CodexTurnCommands,
  CodexTurnCommandsService
>()("nodex/main/codex-application/CodexTurnCommands") {}

const isSteerTurnInactive = (error: unknown): boolean => {
  if (!(typeof error === "object" && error !== null && "_tag" in error)) return false;
  if ((error as { readonly _tag: string })._tag !== "CodexRuntimeError") return false;
  const cause = (error as CodexRuntimeError).cause;
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

const isThreadNotFound = (error: unknown): boolean => {
  if (!(typeof error === "object" && error !== null && "_tag" in error)) return false;
  if ((error as { readonly _tag: string })._tag !== "CodexRuntimeError") return false;
  const cause = (error as CodexRuntimeError).cause;
  if (!(cause instanceof CodexAppServerRequestError)) return false;
  const message = cause.message.toLowerCase();
  return (
    !message.includes("method not found") &&
    (message.includes("thread not found") ||
      (message.includes("thread") && message.includes("not found")))
  );
};

export const make: Effect.Effect<
  CodexTurnCommandsService,
  never,
  | CodexConversationProjection
  | CodexConversationMaterialization
  | CodexAutomationRunAcceptance
  | CodexGateway
  | CodexQueuedFollowUps
  | CodexTurnAuthority
  | CodexTurnPreparation
  | ConversationRuntimeMap
  | CoreModules
  | ProjectRuntimeLifecycleRuntime
  | Scope.Scope
> = Effect.gen(function* () {
  const conversations = yield* ConversationRuntimeMap;
  const gateway = yield* CodexGateway;
  const projectLifecycle = yield* ProjectRuntimeLifecycleRuntime;
  const automationRuns = yield* CodexAutomationRunAcceptance;
  const materialization = yield* CodexConversationMaterialization;
  const projection = yield* CodexConversationProjection;
  const preparation = yield* CodexTurnPreparation;
  const authority = yield* CodexTurnAuthority;
  const queuedFollowUps = yield* CodexQueuedFollowUps;
  const core = yield* CoreModules;

  const commandError = (
    operation: "start" | "steer",
    threadId: string,
    cause: unknown,
  ): CodexTurnCommandError =>
    cause instanceof CodexTurnCommandError
      ? cause
      : new CodexTurnCommandError({ operation, threadId, cause });

  const assertProjectActive = (plan: CodexTurnStartPlan) => {
    if (!plan.projectId) return Effect.void;
    return core.workspace
      .read({ kind: "project", project_id: plan.projectId }, undefined, plan.projectId)
      .pipe(
        Effect.flatMap((snapshot) => {
          if (snapshot.value.kind !== "project" || snapshot.value.project.lifecycle !== "active") {
            return Effect.fail(
              commandError(
                "start",
                plan.threadId,
                new Error("Codex turns cannot start for an inactive or removed Project"),
              ),
            );
          }
          return Effect.void;
        }),
        Effect.mapError((cause) => commandError("start", plan.threadId, cause)),
      );
  };

  const rollbackStart = (
    plan: CodexTurnStartPlan,
    state: {
      readonly launch: CodexTurnAuthorityLaunch | null;
      readonly optimisticAdmitted: boolean;
      readonly protocolCommitted: boolean;
    },
  ) =>
    Effect.gen(function* () {
      if (state.protocolCommitted) return;
      authority.abort(state.launch);
      if (!state.optimisticAdmitted) return;
      const observedAtMs = yield* Clock.currentTimeMillis;
      yield* projection.rejectTurn({
        threadId: plan.threadId,
        clientUserMessageId: plan.clientUserMessageId,
        failureItemId: randomUUID(),
        observedAtMs,
      });
      yield* projection
        .reconcileThreadStatus(plan.threadId)
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Failed to reconcile rejected Turn status").pipe(
              Effect.annotateLogs({ threadId: plan.threadId, cause: String(cause) }),
            ),
          ),
        );
    });

  const startTransaction = (plan: CodexTurnStartPlan) =>
    projectLifecycle.runExclusive(
      plan.projectId,
      Effect.gen(function* () {
        yield* assertProjectActive(plan);
        const canonicalParams = plan.canonicalParams;
        if (!plan.rendererOwnsState && (!canonicalParams || !plan.permissionContext)) {
          return yield* commandError(
            "start",
            plan.threadId,
            new Error("Main-owned Turn requires a hydrated canonical conversation"),
          );
        }

        const transaction: {
          launch: CodexTurnAuthorityLaunch | null;
          optimisticAdmitted: boolean;
          protocolCommitted: boolean;
        } = { launch: null, optimisticAdmitted: false, protocolCommitted: false };

        return yield* Effect.gen(function* () {
          if (!plan.rendererOwnsState && canonicalParams && plan.permissionContext) {
            yield* projection.configureTurn({
              threadId: plan.threadId,
              settings: plan.settings,
              permissions: plan.permissionContext,
            });
          }
          transaction.launch = yield* authority.begin(
            plan.threadId,
            plan.verifiedBuiltinFullAccess,
          );
          if (!plan.rendererOwnsState && canonicalParams) {
            yield* projection.admitTurn({
              threadId: plan.threadId,
              params: canonicalParams,
              currentCollaborationModel: plan.currentCollaborationModel,
              startedAtMs: plan.startedAtMs,
            });
            transaction.optimisticAdmitted = true;
            yield* projection.markThreadActive(plan.threadId);
          }

          const response = (yield* gateway.requestForThread(
            plan.threadId,
            "turn/start",
            plan.request as GatewayTurnStartParams,
          )) as unknown as TurnStartResponse;

          yield* Effect.uninterruptible(
            Effect.sync(() => {
              transaction.protocolCommitted = true;
            }).pipe(
              Effect.andThen(
                authority.bind(plan.threadId, transaction.launch, response.turn.id).pipe(
                  Effect.catch((cause) =>
                    Effect.logError("Accepted Turn authority could not be persisted").pipe(
                      Effect.annotateLogs({
                        threadId: plan.threadId,
                        turnId: response.turn.id,
                        cause: String(cause),
                      }),
                    ),
                  ),
                ),
              ),
              Effect.andThen(
                !plan.rendererOwnsState && canonicalParams
                  ? Clock.currentTimeMillis.pipe(
                      Effect.flatMap((observedAtMs) =>
                        projection.acceptTurn({
                          threadId: plan.threadId,
                          clientUserMessageId: plan.clientUserMessageId,
                          turn: response.turn,
                          recovery: {
                            params: canonicalParams,
                            currentCollaborationModel: plan.currentCollaborationModel,
                            startedAtMs: plan.startedAtMs,
                          },
                          observedAtMs,
                        }),
                      ),
                      Effect.catch((cause) =>
                        Effect.logError(
                          "Accepted Turn canonical projection could not converge",
                        ).pipe(
                          Effect.annotateLogs({
                            threadId: plan.threadId,
                            turnId: response.turn.id,
                            cause: String(cause),
                          }),
                        ),
                      ),
                    )
                  : Effect.void,
              ),
              Effect.andThen(
                automationRuns.accept(plan.threadId).pipe(
                  Effect.catch((cause) =>
                    Effect.logWarning("Accepted Turn could not accept its automation run").pipe(
                      Effect.annotateLogs({
                        threadId: plan.threadId,
                        turnId: response.turn.id,
                        cause: String(cause),
                      }),
                    ),
                  ),
                ),
              ),
            ),
          );

          yield* queuedFollowUps.clearPaused(plan.threadId);
          yield* projection
            .markThreadActive(plan.threadId)
            .pipe(
              Effect.catch((cause) =>
                Effect.logWarning("Turn accepted but secondary active projection failed").pipe(
                  Effect.annotateLogs({ threadId: plan.threadId, cause: String(cause) }),
                ),
              ),
            );
          if (plan.rendererOwnsState) return response;
          return {
            threadId: plan.threadId,
            turnId: response.turn.id,
            status: response.turn.status,
            itemIds: response.turn.items.map((item) => item.id),
          } satisfies CodexTurnSummary;
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? rollbackStart(plan, transaction) : Effect.void,
          ),
        );
      }),
    );

  const prepareStart = (
    threadId: string,
    prompt: string,
    overrides: CodexTurnStartOverrides | undefined,
    rendererOwnsState: boolean,
  ) =>
    preparation
      .start({
        threadId,
        prompt,
        ...(overrides ? { overrides } : {}),
        rendererOwnsState,
      })
      .pipe(Effect.mapError((cause) => commandError("start", threadId, cause)));

  const startInLane = (
    threadId: string,
    prompt: string,
    overrides: CodexTurnStartOverrides | undefined,
    rendererOwnsState: boolean,
  ) => {
    const execute = () =>
      prepareStart(threadId, prompt, overrides, rendererOwnsState).pipe(
        Effect.flatMap(startTransaction),
      );
    if (rendererOwnsState) return execute();
    return materialization.ensure(threadId).pipe(
      Effect.mapError((cause) => commandError("start", threadId, cause)),
      Effect.andThen(execute()),
      Effect.catch((cause) => {
        if (!isThreadNotFound(cause)) return Effect.fail(cause);
        return Effect.logWarning("Turn start is rematerializing a missing app-server Thread").pipe(
          Effect.annotateLogs({ threadId }),
          Effect.andThen(materialization.reload(threadId)),
          Effect.andThen(execute()),
        );
      }),
    );
  };

  const start = (
    threadId: string,
    prompt: string,
    overrides: CodexTurnStartOverrides | undefined,
    rendererOwnsState: boolean,
  ) =>
    conversations.runExclusive(
      threadId,
      startInLane(threadId, prompt, overrides, rendererOwnsState),
    );

  const steerInLane = (input: CodexSteerTurnInput) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const nonce = yield* Random.nextIntBetween(0, 36 ** 6);
      const plan = yield* preparation
        .steer({
          command: input,
          steerId: `steer:${input.threadId}:${now}:${nonce.toString(36).padStart(6, "0")}`,
        })
        .pipe(Effect.mapError((cause) => commandError("steer", input.threadId, cause)));
      return yield* runSteerTransaction(plan);
    });

  const runSteerTransaction = (plan: CodexTurnSteerPlan) => {
    let optimisticAdmitted = false;
    const rollback = Clock.currentTimeMillis.pipe(
      Effect.flatMap((observedAtMs) =>
        optimisticAdmitted
          ? projection.rejectSteer({
              threadId: plan.threadId,
              turnId: plan.expectedTurnId,
              itemId: plan.steerId,
              observedAtMs,
            })
          : Effect.void,
      ),
    );
    return Effect.gen(function* () {
      const observedAtMs = yield* Clock.currentTimeMillis;
      yield* projection.admitSteer({
        threadId: plan.threadId,
        turnId: plan.expectedTurnId,
        item: plan.item,
        observedAtMs,
      });
      optimisticAdmitted = true;
      const response = (yield* gateway.requestForThread(
        plan.threadId,
        "turn/steer",
        plan.request as GatewayTurnSteerParams,
      )) as unknown as TurnSteerResponse;
      if (typeof response.turnId !== "string") {
        yield* rollback;
        optimisticAdmitted = false;
        return null;
      }
      yield* queuedFollowUps.clearPaused(plan.threadId);
      return { turnId: response.turnId };
    }).pipe(
      Effect.onExit((exit) => (Exit.isFailure(exit) ? rollback : Effect.void)),
      Effect.catch((error) => {
        if (!isSteerTurnInactive(error)) return Effect.fail(error);
        return rollback.pipe(
          Effect.andThen(
            startInLane(
              plan.threadId,
              plan.fallbackStart.prompt,
              plan.fallbackStart.overrides,
              false,
            ),
          ),
          Effect.map((started) =>
            started && "turnId" in started && typeof started.turnId === "string"
              ? { turnId: started.turnId }
              : null,
          ),
        );
      }),
      Effect.mapError((cause) =>
        cause instanceof Object && "_tag" in cause && cause._tag === "CodexRuntimeError"
          ? (cause as CodexRuntimeError)
          : commandError("steer", plan.threadId, cause),
      ),
    );
  };

  return CodexTurnCommands.of({
    start: (threadId, prompt, overrides) =>
      start(threadId, prompt, overrides, false).pipe(
        Effect.map((result) => result as CodexTurnSummary | null),
        Effect.mapError((cause) =>
          cause instanceof Object && "_tag" in cause && cause._tag === "CodexRuntimeError"
            ? (cause as CodexRuntimeError)
            : commandError("start", threadId, cause),
        ),
        Effect.withSpan("CodexTurnCommands.start", { attributes: { threadId } }),
      ),
    startRendererOwned: (threadId, prompt, overrides) =>
      start(threadId, prompt, overrides, true).pipe(
        Effect.map((result) => result as TurnStartResponse),
        Effect.mapError((cause) =>
          cause instanceof Object && "_tag" in cause && cause._tag === "CodexRuntimeError"
            ? (cause as CodexRuntimeError)
            : commandError("start", threadId, cause),
        ),
        Effect.withSpan("CodexTurnCommands.startRendererOwned", { attributes: { threadId } }),
      ),
    steer: (input) =>
      conversations.runExclusive(input.threadId, steerInLane(input)).pipe(
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
