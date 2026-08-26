import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as RcMap from "effect/RcMap";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type {
  CodexConversationThreadSettings,
  CodexConversationThreadSettingsPatch,
} from "../../shared/types";
import type { AgentExecutionProfile } from "../../shared/agent-runtime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import type { ProjectWorkspaceReadSnapshot } from "../core-client/types";
import { CoreModules } from "../core-runtime/CoreModules";
import { createOperationId } from "../core-runtime/operation-identity";
import { AgentProviderRuntime } from "./AgentProviderRuntime";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { projectCodexConversationThreadSettings } from "./CodexConversationSnapshotProjection";
import { CodexSidebarSyncRuntime } from "./CodexSidebarSyncRuntime";
import { buildCoreWorkspaceThreadSummary } from "./CodexThreadCatalogProjection";
import {
  buildThreadSettingsUpdateParams,
  mergeAgentModelChange,
  mergeThreadSettingsPatch,
  normalizeThreadSettingsModel,
} from "./CodexThreadSettingsProjection";

export type CodexThreadSettingsUpdateSupport = "unknown" | "supported" | "unsupported";

export interface CodexThreadSettingsUpdateCommand {
  readonly threadId: string;
  readonly patch: CodexConversationThreadSettingsPatch;
}

export interface CodexPreparedThreadSettingsUpdate {
  readonly nextSettings: CodexConversationThreadSettings;
  readonly params: ClientRequestParamsByMethod["thread/settings/update"];
}

export class CodexThreadSettingsOperationError extends Schema.TaggedError<CodexThreadSettingsOperationError>()(
  "CodexThreadSettingsOperationError",
  {
    operation: Schema.Literal("prepare-update"),
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type CodexThreadSettingsError = CodexRuntimeError | CodexThreadSettingsOperationError;

/**
 * Owns the complete next-turn settings transaction.
 *
 * Updates are FIFO per Thread but independent across Threads. Local validation
 * and projection commit before the typed remote update, matching the durable
 * fallback contract for unloaded or older app-server Threads.
 */
export class CodexThreadSettingsRuntime extends Context.Service<
  CodexThreadSettingsRuntime,
  {
    readonly update: (
      input: CodexThreadSettingsUpdateCommand,
    ) => Effect.Effect<CodexConversationThreadSettings, CodexThreadSettingsError>;
    readonly awaitCurrent: (threadId: string) => Effect.Effect<void>;
    readonly remoteUpdateSupport: () => CodexThreadSettingsUpdateSupport;
    readonly recordRemoteUpdateSupported: () => void;
    readonly recordRemoteUpdateUnsupported: () => void;
  }
>()("nodex/main/codex-application/CodexThreadSettingsRuntime") {}

const isRequestError = Schema.is(CodexAppServerRequestError);

const requestError = (error: CodexRuntimeError): CodexAppServerRequestError | null =>
  isRequestError(error.cause) ? error.cause : null;

const isThreadNotFoundError = (error: CodexRuntimeError): boolean => {
  const message = requestError(error)?.message.toLowerCase();
  return Boolean(
    message &&
    !message.includes("method not found") &&
    (message.includes("thread not found") ||
      (message.includes("thread") && message.includes("not found"))),
  );
};

const isUnsupportedUpdateError = (error: CodexRuntimeError): boolean => {
  const request = requestError(error);
  if (!request) return false;
  if (request.code === -32601) return true;
  const message = request.message.toLowerCase();
  return (
    message.includes("method not found") ||
    message.includes("unknown method") ||
    (message.includes("thread/settings/update") && message.includes("unsupported"))
  );
};

type CoreThread = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { readonly kind: "thread" }
>["thread"];

export const make: Effect.Effect<
  CodexThreadSettingsRuntime["Service"],
  never,
  | AgentProviderRuntime
  | CodexApplicationEventHub
  | CodexConversationProjection
  | CodexGateway
  | CodexSidebarSyncRuntime
  | CoreModules
  | Scope.Scope
> = Effect.gen(function* () {
  const agentProviders = yield* AgentProviderRuntime;
  const events = yield* CodexApplicationEventHub;
  const projection = yield* CodexConversationProjection;
  const gateway = yield* CodexGateway;
  const sidebar = yield* CodexSidebarSyncRuntime;
  const core = yield* CoreModules;
  const ownerScope = yield* Scope.Scope;
  const lanes = yield* RcMap.make({
    lookup: (_threadId: string) => Semaphore.make(1),
  });
  let remoteUpdateSupport: CodexThreadSettingsUpdateSupport = "unknown";
  const recordRemoteUpdateSupported = (): void => {
    if (remoteUpdateSupport === "unsupported") return;
    remoteUpdateSupport = "supported";
  };
  const recordRemoteUpdateUnsupported = (): void => {
    remoteUpdateSupport = "unsupported";
  };

  const runOwned = <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
      Fiber.join,
      Fiber.interrupt,
    );

  const runMutation = <A, E, R>(
    threadId: string,
    mutation: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    runOwned(
      Effect.scoped(
        Effect.gen(function* () {
          const lane = yield* RcMap.get(lanes, threadId);
          return yield* lane.withPermit(mutation);
        }),
      ),
    );

  const operationError = (threadId: string, cause: unknown): CodexThreadSettingsOperationError =>
    cause instanceof CodexThreadSettingsOperationError
      ? cause
      : new CodexThreadSettingsOperationError({
          operation: "prepare-update",
          threadId,
          cause,
        });

  const readCoreThread = (
    threadId: string,
  ): Effect.Effect<CoreThread, CodexThreadSettingsOperationError> =>
    core.workspace.read({ kind: "thread", thread_id: threadId }).pipe(
      Effect.flatMap((snapshot) =>
        snapshot.value.kind === "thread"
          ? Effect.succeed(snapshot.value.thread)
          : Effect.fail(
              operationError(
                threadId,
                new Error(`Core returned a non-Thread read for '${threadId}'`),
              ),
            ),
      ),
      Effect.mapError((cause) => operationError(threadId, cause)),
    );

  const validateAndPersistExecutionProfile = Effect.fn(
    "CodexThreadSettingsRuntime.validateExecutionProfile",
  )(function* (
    threadId: string,
    requested: AgentExecutionProfile,
    change: CodexConversationThreadSettingsPatch["executionProfileChange"],
    currentSettings: CodexConversationThreadSettings | null,
  ) {
    const workspaceThread = yield* readCoreThread(threadId);
    const current = buildCoreWorkspaceThreadSummary(workspaceThread).executionProfile ?? null;
    const modelChangeCatalog =
      current && change === "model"
        ? yield* agentProviders
            .list()
            .pipe(Effect.mapError((cause) => operationError(threadId, cause)))
        : null;
    const requestedModel =
      modelChangeCatalog?.providers
        .find((provider) => provider.id === current?.providerId)
        ?.models.find((model) => model.modelId === requested.modelId) ?? null;
    const requestedUpdate =
      current && change === "model"
        ? mergeAgentModelChange(current, requested, requestedModel)
        : current && change === "reasoningEffort"
          ? { ...current, reasoningEffort: requested.reasoningEffort }
          : current && change === "serviceTier"
            ? { ...current, serviceTier: requested.serviceTier }
            : requested;
    const resolved = yield* agentProviders
      .resolveExecutionProfile(requestedUpdate)
      .pipe(Effect.mapError((cause) => operationError(threadId, cause)));
    const boundProviderId =
      current?.providerId ?? normalizeThreadSettingsModel(workspaceThread.model_provider);
    if (boundProviderId && resolved.providerId !== boundProviderId) {
      return yield* operationError(threadId, new Error("Start a new thread to change provider"));
    }
    if (current && resolved.harnessId !== current.harnessId) {
      return yield* operationError(
        threadId,
        new Error("Start a new thread to change the agent harness"),
      );
    }
    const currentModelId = current?.modelId ?? normalizeThreadSettingsModel(currentSettings?.model);
    if (currentModelId && resolved.modelId !== currentModelId) {
      const catalog =
        modelChangeCatalog ??
        (yield* agentProviders
          .list()
          .pipe(Effect.mapError((cause) => operationError(threadId, cause))));
      const model = catalog.providers
        .find((provider) => provider.id === resolved.providerId)
        ?.models.find((candidate) => candidate.modelId === resolved.modelId);
      if (!model || model.switchPolicy !== "same-thread") {
        return yield* operationError(threadId, new Error("Start a new thread to use this model"));
      }
    }

    const observedAtMs = yield* Clock.currentTimeMillis;
    yield* core.workspace
      .apply({
        operationId: createOperationId("thread-settings.update"),
        intent: {
          kind: "update_thread",
          thread_id: threadId,
          patch: {
            model_provider: resolved.providerId,
            harness_id: resolved.harnessId,
            model_id: resolved.modelId,
            reasoning_effort: resolved.reasoningEffort,
            service_tier: resolved.serviceTier,
            updated_at: observedAtMs,
          },
        },
      })
      .pipe(Effect.mapError((cause) => operationError(threadId, cause)));
    const persisted = yield* readCoreThread(threadId);
    events.publish({
      kind: "codex",
      value: { type: "threadSummary", thread: buildCoreWorkspaceThreadSummary(persisted) },
    });
    sidebar.scheduleNotification({
      notificationMethod: "thread/settings/updated",
      threadId,
    });
    return resolved;
  });

  const prepare = Effect.fn("CodexThreadSettingsRuntime.prepare")(function* (
    input: CodexThreadSettingsUpdateCommand,
  ) {
    const currentProjection = yield* projection
      .read(input.threadId)
      .pipe(Effect.mapError((cause) => operationError(input.threadId, cause)));
    const currentSettings =
      currentProjection.snapshot?.latestThreadSettings ??
      projectCodexConversationThreadSettings(currentProjection.canonical);
    const executionProfile = input.patch.executionProfile
      ? yield* validateAndPersistExecutionProfile(
          input.threadId,
          input.patch.executionProfile,
          input.patch.executionProfileChange,
          currentSettings,
        )
      : null;
    const patch = executionProfile ? { ...input.patch, executionProfile } : input.patch;
    const nextSettings = mergeThreadSettingsPatch({
      patch,
      current: currentSettings,
      currentCollaborationMode:
        currentProjection.snapshot?.latestCollaborationMode ??
        currentSettings?.collaborationMode ??
        null,
    });
    const permissions = currentProjection.canonical.sidecar.hydrationContext?.currentPermissions;
    if (!permissions) {
      return yield* operationError(
        input.threadId,
        new Error(`Thread '${input.threadId}' has no hydrated permission context`),
      );
    }
    yield* projection
      .configureTurn({ threadId: input.threadId, settings: nextSettings, permissions })
      .pipe(Effect.mapError((cause) => operationError(input.threadId, cause)));
    const projected = yield* projection
      .read(input.threadId)
      .pipe(Effect.mapError((cause) => operationError(input.threadId, cause)));
    const snapshot = projected.snapshot;
    if (snapshot) {
      events.publish({ kind: "codex", value: { type: "threadSummary", thread: snapshot } });
    }
    return {
      nextSettings,
      params: buildThreadSettingsUpdateParams({
        threadId: input.threadId,
        patch,
        nextSettings,
      }),
    } satisfies CodexPreparedThreadSettingsUpdate;
  });

  const update = Effect.fn("CodexThreadSettingsRuntime.update")(function* (
    input: CodexThreadSettingsUpdateCommand,
  ) {
    return yield* runMutation(
      input.threadId,
      Effect.gen(function* () {
        const prepared = yield* prepare(input);
        if (remoteUpdateSupport === "unsupported") return prepared.nextSettings;

        const result = yield* gateway
          .requestForThread(input.threadId, "thread/settings/update", prepared.params)
          .pipe(Effect.result);
        if (result._tag === "Success") {
          recordRemoteUpdateSupported();
          return prepared.nextSettings;
        }

        const error = result.failure;
        if (isThreadNotFoundError(error)) {
          yield* Effect.logInfo(
            "Task settings will be applied when the unloaded task starts its next turn",
          ).pipe(Effect.annotateLogs({ threadId: input.threadId }));
          return prepared.nextSettings;
        }
        if (!isUnsupportedUpdateError(error)) return yield* Effect.fail(error);

        recordRemoteUpdateUnsupported();
        yield* Effect.logWarning(
          "Codex app-server does not support thread/settings/update; using local next-turn settings fallback",
        ).pipe(Effect.annotateLogs({ threadId: input.threadId }));
        return prepared.nextSettings;
      }),
    );
  });

  return CodexThreadSettingsRuntime.of({
    update,
    awaitCurrent: (threadId) => runMutation(threadId, Effect.void),
    remoteUpdateSupport: () => remoteUpdateSupport,
    recordRemoteUpdateSupported,
    recordRemoteUpdateUnsupported,
  });
});
