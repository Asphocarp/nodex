import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import type { TurnStartParams } from "@nodex/codex-app-server-protocol/v2/TurnStartParams";
import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2/TurnStartResponse";
import type {
  CodexCanonicalLiveTurnParams,
  CodexLiveFileAttachment,
  CodexRendererConversationResumeResult,
  CodexReviewDiffCommentAttachment,
  CodexThreadGoalDraftInput,
  CodexThreadStartForSessionInput,
  PageRunInTarget,
} from "../../shared/types";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type GatewayTurnStartParams = ClientRequestParamsByMethod["turn/start"];

export type CodexFreshThreadLaunchTurnStartParams = TurnStartParams & {
  readonly attachments: readonly CodexLiveFileAttachment[];
};

export interface CodexFreshThreadLaunch {
  readonly launchId: string;
  readonly rendererClientId: string;
  readonly projectId: string | null;
  readonly sessionId: string;
  readonly threadId: string;
  readonly runInTarget: PageRunInTarget;
  readonly startedAt: number;
  readonly clientUserMessageId: string;
  readonly canonicalParams: CodexCanonicalLiveTurnParams<
    CodexLiveFileAttachment,
    CodexReviewDiffCommentAttachment
  >;
  readonly turnStartParams: CodexFreshThreadLaunchTurnStartParams;
  readonly verifiedBuiltinFullAccess: boolean;
  readonly goalObjective: string;
  readonly rawGoalDraft: CodexThreadGoalDraftInput | null;
  readonly heartbeatAutomation: CodexThreadStartForSessionInput["heartbeatAutomation"];
}

export interface CodexFreshThreadLaunchIdentity {
  readonly launchId: string;
  readonly ownerClientId: string;
  readonly threadId: string;
}

export interface CodexFreshThreadLaunchReservation {
  readonly rendererClientId: string;
  readonly state: "prepared" | "adopting" | "adopted" | "starting";
}

export interface CodexPreparedFreshThreadFirstTurn {
  readonly launchId: string;
  readonly ownerClientId: string;
  readonly projectId: string | null;
  readonly threadId: string;
  readonly request: TurnStartParams;
  /** Opaque mutable transaction state owned exclusively by the projection. */
  readonly state: object;
}

type AdoptionResult = Extract<CodexRendererConversationResumeResult, { readonly role: "owner" }>;

type FreshLaunchErrorReason =
  | "duplicate"
  | "not-adopted"
  | "operation-failed"
  | "unavailable"
  | "wrong-owner";

export class CodexFreshThreadLaunchError extends Error {
  readonly _tag = "CodexFreshThreadLaunchError";

  constructor(
    readonly reason: FreshLaunchErrorReason,
    readonly identity: CodexFreshThreadLaunchIdentity,
    options: { readonly cause?: unknown } = {},
  ) {
    const message = (() => {
      switch (reason) {
        case "duplicate":
          return `Fresh thread '${identity.threadId}' already has a launch`;
        case "not-adopted":
          return `Fresh thread launch '${identity.launchId}' must be adopted before its first turn starts`;
        case "unavailable":
          return `Fresh thread launch '${identity.launchId}' is unavailable`;
        case "wrong-owner":
          return `Renderer client '${identity.ownerClientId}' cannot use fresh thread '${identity.threadId}'`;
        case "operation-failed":
          return `Fresh thread launch '${identity.launchId}' operation failed`;
      }
    })();
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
  }
}

export interface CodexFreshThreadLaunchRuntimeOptions {
  readonly adopt: (
    launch: CodexFreshThreadLaunch,
  ) => Effect.Effect<AdoptionResult, CodexFreshThreadLaunchError>;
  readonly readAdopted: (
    launch: CodexFreshThreadLaunch,
  ) => Effect.Effect<AdoptionResult, CodexFreshThreadLaunchError>;
  readonly prepareStart: (
    launch: CodexFreshThreadLaunch,
  ) => Effect.Effect<CodexPreparedFreshThreadFirstTurn, CodexFreshThreadLaunchError>;
  readonly beginStart: (
    prepared: CodexPreparedFreshThreadFirstTurn,
  ) => Effect.Effect<void, CodexFreshThreadLaunchError>;
  readonly commitStart: (
    prepared: CodexPreparedFreshThreadFirstTurn,
    response: TurnStartResponse,
  ) => Effect.Effect<TurnStartResponse, CodexFreshThreadLaunchError>;
  readonly finishStart: (
    prepared: CodexPreparedFreshThreadFirstTurn,
    response: TurnStartResponse,
  ) => Effect.Effect<TurnStartResponse, CodexFreshThreadLaunchError>;
  readonly rollbackStart: (
    prepared: CodexPreparedFreshThreadFirstTurn,
    cause: unknown,
  ) => Effect.Effect<void>;
  readonly abandon: (launch: CodexFreshThreadLaunch, reason: unknown) => void;
}

export interface CodexFreshThreadLaunchRuntimeService {
  readonly register: (launch: CodexFreshThreadLaunch) => void;
  readonly reservation: (threadId: string) => CodexFreshThreadLaunchReservation | null;
  readonly adopt: (
    identity: CodexFreshThreadLaunchIdentity,
  ) => Effect.Effect<AdoptionResult, CodexFreshThreadLaunchError>;
  readonly start: (
    identity: CodexFreshThreadLaunchIdentity,
  ) => Effect.Effect<TurnStartResponse, CodexFreshThreadLaunchError>;
  readonly releaseRenderer: (rendererClientId: string, reason: unknown) => void;
  readonly clear: (threadId: string) => void;
}

export class CodexFreshThreadLaunchRuntime extends Context.Service<
  CodexFreshThreadLaunchRuntime,
  CodexFreshThreadLaunchRuntimeService
>()("nodex/main/codex-application/CodexFreshThreadLaunchRuntime") {}

interface FreshLaunchEntry {
  readonly launch: CodexFreshThreadLaunch;
  state: CodexFreshThreadLaunchReservation["state"];
}

const operationError = (
  identity: CodexFreshThreadLaunchIdentity,
  cause: unknown,
): CodexFreshThreadLaunchError => {
  if (cause instanceof CodexFreshThreadLaunchError) return cause;
  return new CodexFreshThreadLaunchError("operation-failed", identity, { cause });
};

export const make = (
  options: CodexFreshThreadLaunchRuntimeOptions,
): Effect.Effect<
  CodexFreshThreadLaunchRuntimeService,
  never,
  CodexGateway | ConversationRuntimeMap | ProjectRuntimeLifecycleRuntime | Scope.Scope
> =>
  Effect.gen(function* () {
    const conversations = yield* ConversationRuntimeMap;
    const gateway = yield* CodexGateway;
    const projectLifecycle = yield* ProjectRuntimeLifecycleRuntime;
    const adoptions = yield* FiberMap.make<string, AdoptionResult, CodexFreshThreadLaunchError>();
    const starts = yield* FiberMap.make<string, TurnStartResponse, CodexFreshThreadLaunchError>();
    const runAdoption = yield* FiberMap.runtime(adoptions)();
    const runStart = yield* FiberMap.runtime(starts)();
    const admission = yield* Semaphore.make(1);
    const entries = new Map<string, FreshLaunchEntry>();
    let closed = false;

    const startFirstTurn = (launch: CodexFreshThreadLaunch) =>
      conversations.runExclusive(
        launch.threadId,
        options.prepareStart(launch).pipe(
          Effect.flatMap((prepared) =>
            projectLifecycle.runExclusive(
              prepared.projectId,
              options.beginStart(prepared).pipe(
                Effect.andThen(
                  gateway.requestForThread(
                    prepared.threadId,
                    "turn/start",
                    prepared.request as GatewayTurnStartParams,
                  ),
                ),
                Effect.map((response) => response as unknown as TurnStartResponse),
                Effect.flatMap((response) =>
                  options.commitStart(prepared, response).pipe(Effect.uninterruptible),
                ),
                Effect.onExit((exit) =>
                  Exit.isFailure(exit) ? options.rollbackStart(prepared, exit.cause) : Effect.void,
                ),
                Effect.flatMap((response) => options.finishStart(prepared, response)),
              ),
            ),
          ),
        ),
      );

    const lookup = (
      identity: CodexFreshThreadLaunchIdentity,
    ): Effect.Effect<FreshLaunchEntry, CodexFreshThreadLaunchError> =>
      Effect.gen(function* () {
        const entry = entries.get(identity.threadId);
        if (!entry || entry.launch.launchId !== identity.launchId) {
          return yield* Effect.fail(new CodexFreshThreadLaunchError("unavailable", identity));
        }
        if (entry.launch.rendererClientId !== identity.ownerClientId) {
          return yield* Effect.fail(new CodexFreshThreadLaunchError("wrong-owner", identity));
        }
        return entry;
      });

    const acquireAdoption = (identity: CodexFreshThreadLaunchIdentity) =>
      admission.withPermits(1)(
        Effect.gen(function* () {
          const entry = yield* lookup(identity);
          const current = yield* FiberMap.get(adoptions, identity.threadId);
          if (Option.isSome(current)) return { _tag: "Fiber", fiber: current.value } as const;
          if (entry.state === "adopted" || entry.state === "starting") {
            return { _tag: "Read", launch: entry.launch } as const;
          }
          if (entry.state === "adopting") entry.state = "prepared";

          entry.state = "adopting";
          const physical = options.adopt(entry.launch).pipe(
            Effect.mapError((cause) => operationError(identity, cause)),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (entries.get(identity.threadId) !== entry) return;
                entry.state = Exit.isSuccess(exit) ? "adopted" : "prepared";
              }),
            ),
          );
          const fiber = yield* FiberMap.run(adoptions, identity.threadId, physical, {
            startImmediately: true,
          });
          return { _tag: "Fiber", fiber } as const;
        }),
      );

    const adopt = (
      identity: CodexFreshThreadLaunchIdentity,
    ): Effect.Effect<AdoptionResult, CodexFreshThreadLaunchError> =>
      Effect.gen(function* () {
        const acquired = yield* acquireAdoption(identity);
        if (acquired._tag === "Fiber") return yield* Fiber.join(acquired.fiber);
        return yield* options
          .readAdopted(acquired.launch)
          .pipe(Effect.mapError((cause) => operationError(identity, cause)));
      });

    const acquireStart = (identity: CodexFreshThreadLaunchIdentity) =>
      admission.withPermits(1)(
        Effect.gen(function* () {
          const entry = yield* lookup(identity);
          const activeStart = yield* FiberMap.get(starts, identity.threadId);
          if (Option.isSome(activeStart)) {
            return { _tag: "Start", fiber: activeStart.value } as const;
          }
          const activeAdoption = yield* FiberMap.get(adoptions, identity.threadId);
          if (Option.isSome(activeAdoption)) {
            return { _tag: "Adoption", fiber: activeAdoption.value } as const;
          }
          if (entry.state !== "adopted") {
            return yield* Effect.fail(new CodexFreshThreadLaunchError("not-adopted", identity));
          }

          entry.state = "starting";
          const physical = startFirstTurn(entry.launch).pipe(
            Effect.mapError((cause) => operationError(identity, cause)),
            Effect.ensuring(
              Effect.sync(() => {
                if (entries.get(identity.threadId) === entry) entries.delete(identity.threadId);
              }),
            ),
          );
          const fiber = yield* FiberMap.run(starts, identity.threadId, physical, {
            startImmediately: true,
          });
          return { _tag: "Start", fiber } as const;
        }),
      );

    const start = (
      identity: CodexFreshThreadLaunchIdentity,
    ): Effect.Effect<TurnStartResponse, CodexFreshThreadLaunchError> =>
      Effect.gen(function* () {
        for (;;) {
          const acquired = yield* acquireStart(identity);
          if (acquired._tag === "Start") return yield* Fiber.join(acquired.fiber);
          yield* Fiber.join(acquired.fiber);
        }
      });

    const interrupt = (threadId: string): void => {
      runAdoption(threadId, Effect.interrupt);
      runStart(threadId, Effect.interrupt);
    };

    const release = Effect.gen(function* () {
      if (closed) return;
      closed = true;
      entries.clear();
      yield* FiberMap.clear(adoptions);
      yield* FiberMap.clear(starts);
    });

    yield* Effect.addFinalizer(() => release);

    return CodexFreshThreadLaunchRuntime.of({
      register: (launch) => {
        const identity = {
          launchId: launch.launchId,
          ownerClientId: launch.rendererClientId,
          threadId: launch.threadId,
        };
        if (closed) throw new CodexFreshThreadLaunchError("unavailable", identity);
        if (entries.has(launch.threadId)) {
          throw new CodexFreshThreadLaunchError("duplicate", identity);
        }
        entries.set(launch.threadId, { launch, state: "prepared" });
      },
      reservation: (threadId) => {
        const entry = entries.get(threadId);
        return entry
          ? { rendererClientId: entry.launch.rendererClientId, state: entry.state }
          : null;
      },
      adopt,
      start,
      releaseRenderer: (rendererClientId, reason) => {
        for (const [threadId, entry] of entries) {
          if (entry.launch.rendererClientId !== rendererClientId || entry.state === "starting") {
            continue;
          }
          entries.delete(threadId);
          interrupt(threadId);
          options.abandon(entry.launch, reason);
        }
      },
      clear: (threadId) => {
        entries.delete(threadId);
        interrupt(threadId);
      },
    });
  });
