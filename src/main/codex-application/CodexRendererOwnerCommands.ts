import { randomUUID } from "node:crypto";
import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2/ThreadGoal";
import type { ThreadGoalSetParams } from "@nodex/codex-app-server-protocol/v2/ThreadGoalSetParams";
import type { ThreadForkParams } from "@nodex/codex-app-server-protocol/v2/ThreadForkParams";
import type { ThreadForkResponse } from "@nodex/codex-app-server-protocol/v2/ThreadForkResponse";
import type { TurnSteerParams } from "@nodex/codex-app-server-protocol/v2/TurnSteerParams";
import type { ClientRequestParamsByMethod } from "@nodex/effect-codex-app-server/rpc";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { appendCodexCanonicalForkedFromConversationItem } from "../../shared/codex-conversation-state/codex-conversation-state";
import { createEmptyCodexPreparedPrompt } from "../../shared/codex-prompt-preparation";
import { CodexThreadGoalStatusSchema } from "../../shared/schemas/codex";
import {
  resolveCodexForkChildThreadTitleFromCatalog,
  resolveCodexForkSourceConversationTitle,
  type CodexForkTitleThread,
} from "../../shared/codex-thread-title";
import type {
  CodexLiveFileAttachment,
  CodexOwnerAppServerRequestInput,
  CodexPreparedPrompt,
  CodexThreadActionResult,
} from "../../shared/types";
import { buildCodexThreadConfigOverrides } from "../codex/codex-thread-capabilities";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { ProjectWorkspaceReadSnapshot } from "../core-client/types";
import { CoreModules } from "../core-runtime/CoreModules";
import { ConversationCommands } from "./ConversationCommands";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { CodexForkSidePanelTransfer } from "./CodexForkSidePanelTransferRuntime";
import { CodexFreshThreadLaunchRuntime } from "./CodexFreshThreadLaunchRuntime";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import { CodexManualCompactionRuntime } from "./CodexManualCompactionRuntime";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
import { CodexRendererConversationRegistry } from "./CodexRendererConversationRegistry";
import { CodexThreadDirectory } from "./CodexThreadDirectory";
import { CodexThreadGoalRuntime } from "./CodexThreadGoalRuntime";
import { CodexThreadSettingsRuntime } from "./CodexThreadSettingsRuntime";
import { CodexThreadTitlePersistence } from "./CodexThreadTitlePersistence";
import { CodexThreadRollbackCommands } from "./CodexThreadRollbackCommands";
import { CodexTurnCommands } from "./CodexTurnCommands";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

type GatewayThreadForkParams = ClientRequestParamsByMethod["thread/fork"];

export class CodexRendererOwnerCommandError extends Schema.TaggedError<CodexRendererOwnerCommandError>()(
  "CodexRendererOwnerCommandError",
  {
    method: Schema.String,
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexRendererOwnerCommands extends Context.Service<
  CodexRendererOwnerCommands,
  {
    readonly execute: (
      ownerClientId: string,
      input: CodexOwnerAppServerRequestInput,
    ) => Effect.Effect<unknown, CodexRendererOwnerCommandError>;
  }
>()("nodex/main/codex-application/CodexRendererOwnerCommands") {}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const isOwnerTurnUserInput = (value: unknown): value is TurnSteerParams["input"][number] => {
  const input = asRecord(value);
  if (!input || typeof input.type !== "string") return false;

  switch (input.type) {
    case "text":
      return typeof input.text === "string" && Array.isArray(input.text_elements);
    case "image":
      return typeof input.url === "string";
    case "localImage":
      return typeof input.path === "string";
    case "skill":
    case "mention":
      return typeof input.name === "string" && typeof input.path === "string";
    default:
      return false;
  }
};

const readSteerParams = (threadId: string, value: unknown): TurnSteerParams => {
  const params = asRecord(value);
  if (!params || params.threadId !== threadId) {
    throw new Error(`Owner turn/steer request must target ${threadId}`);
  }
  if (typeof params.expectedTurnId !== "string" || !params.expectedTurnId.trim()) {
    throw new Error("Owner turn/steer request requires expectedTurnId");
  }
  if (
    params.clientUserMessageId !== undefined &&
    params.clientUserMessageId !== null &&
    typeof params.clientUserMessageId !== "string"
  ) {
    throw new Error("Owner turn/steer request has an invalid clientUserMessageId");
  }
  if (
    !Array.isArray(params.input) ||
    params.input.length === 0 ||
    !params.input.every(isOwnerTurnUserInput)
  ) {
    throw new Error("Owner turn/steer request requires valid input");
  }
  if (
    params.additionalContext !== undefined &&
    params.additionalContext !== null &&
    !asRecord(params.additionalContext)
  ) {
    throw new Error("Owner turn/steer request has invalid additionalContext");
  }
  return value as TurnSteerParams;
};

const isLiveFileAttachment = (value: unknown): value is CodexLiveFileAttachment => {
  const attachment = asRecord(value);
  return Boolean(
    attachment &&
    typeof attachment.label === "string" &&
    typeof attachment.path === "string" &&
    typeof attachment.fsPath === "string",
  );
};

const readPreparedPrompt = (value: unknown): CodexPreparedPrompt => {
  const prepared = asRecord(value);
  if (!prepared || typeof prepared.promptText !== "string") {
    throw new Error("Owner turn/start request requires a prepared prompt");
  }
  if (
    !Array.isArray(prepared.inputItems) ||
    !prepared.inputItems.every(isOwnerTurnUserInput) ||
    !Array.isArray(prepared.pendingInputItems) ||
    !prepared.pendingInputItems.every(isOwnerTurnUserInput)
  ) {
    throw new Error("Owner turn/start request has invalid prepared input");
  }
  if (
    !Array.isArray(prepared.fileAttachments) ||
    !prepared.fileAttachments.every(isLiveFileAttachment) ||
    !Array.isArray(prepared.addedFiles) ||
    !prepared.addedFiles.every(isLiveFileAttachment) ||
    !Array.isArray(prepared.pastedTextAttachments) ||
    !Array.isArray(prepared.commentAttachments) ||
    !Array.isArray(prepared.agentConfigs)
  ) {
    throw new Error("Owner turn/start request has invalid prepared sidecars");
  }
  if (prepared.inputItems.length === 0 && prepared.pastedTextAttachments.length === 0) {
    throw new Error("Owner turn/start request requires prepared input or pasted text");
  }
  if (prepared.additionalContext !== undefined && !asRecord(prepared.additionalContext)) {
    throw new Error("Owner turn/start request has invalid prepared additionalContext");
  }
  return value as CodexPreparedPrompt;
};

const readGoalSetParams = (threadId: string, value: unknown): ThreadGoalSetParams => {
  const params = asRecord(value);
  if (!params) throw new Error("Invalid thread goal input");
  const input: ThreadGoalSetParams = { threadId };
  if (Object.prototype.hasOwnProperty.call(params, "objective")) {
    if (typeof params.objective !== "string" && params.objective !== null) {
      throw new Error("Invalid thread goal objective");
    }
    input.objective = params.objective;
  }
  if (Object.prototype.hasOwnProperty.call(params, "status")) {
    const status = params.status;
    if (status !== null && !CodexThreadGoalStatusSchema.safeParse(status).success) {
      throw new Error("Invalid thread goal status");
    }
    input.status = status as ThreadGoal["status"] | null;
  }
  if (Object.prototype.hasOwnProperty.call(params, "tokenBudget")) {
    input.tokenBudget =
      typeof params.tokenBudget === "number" && Number.isFinite(params.tokenBudget)
        ? params.tokenBudget
        : null;
  }
  return input;
};

const validateIdentity = (
  ownerClientId: string,
  input: CodexOwnerAppServerRequestInput,
  rendererConversations: CodexRendererConversationRegistry["Service"],
): string => {
  const threadId = input.conversationId.trim();
  if (!ownerClientId || rendererConversations.getOwnerClientId(threadId) !== ownerClientId) {
    throw new Error(`Renderer client ${ownerClientId || "unknown"} is not owner for ${threadId}`);
  }
  const params = asRecord(input.request.params);
  if (!params || params.threadId !== threadId) {
    throw new Error(`Owner app-server request '${input.request.method}' must target ${threadId}`);
  }
  return threadId;
};

export const make: Effect.Effect<
  CodexRendererOwnerCommands["Service"],
  never,
  | CodexConversationProjection
  | CodexForkSidePanelTransfer
  | CodexGateway
  | CodexOwnerNotificationDrainRuntime
  | CodexRendererConversationRegistry
  | CodexRendererConversationCoordinator
  | CodexFreshThreadLaunchRuntime
  | CodexManualCompactionRuntime
  | CodexThreadDirectory
  | CodexThreadGoalRuntime
  | CodexThreadSettingsRuntime
  | CodexThreadTitlePersistence
  | CodexThreadRollbackCommands
  | CodexTurnCommands
  | ConversationCommands
  | ConversationRuntimeMap
  | CoreModules
> = Effect.gen(function* () {
  const core = yield* CoreModules;
  const gateway = yield* CodexGateway;
  const projection = yield* CodexConversationProjection;
  const ownerNotificationDrain = yield* CodexOwnerNotificationDrainRuntime;
  const rendererConversations = yield* CodexRendererConversationRegistry;
  const rendererConversationCoordinator = yield* CodexRendererConversationCoordinator;
  const freshThreadLaunch = yield* CodexFreshThreadLaunchRuntime;
  const forkSidePanelTransfers = yield* CodexForkSidePanelTransfer;
  const manualCompaction = yield* CodexManualCompactionRuntime;
  const directory = yield* CodexThreadDirectory;
  const threadGoals = yield* CodexThreadGoalRuntime;
  const threadSettings = yield* CodexThreadSettingsRuntime;
  const threadTitles = yield* CodexThreadTitlePersistence;
  const threadRollback = yield* CodexThreadRollbackCommands;
  const turnCommands = yield* CodexTurnCommands;
  const conversations = yield* ConversationCommands;
  const conversationRuntimes = yield* ConversationRuntimeMap;
  const forkError = (threadId: string, cause: unknown) =>
    new CodexRendererOwnerCommandError({ method: "thread/fork", threadId, cause });

  const listForkTitleCatalog = Effect.fn("CodexRendererOwnerCommands.listForkTitleCatalog")(
    function* (threadId: string, projectId: string | null) {
      const titles: CodexForkTitleThread[] = [];
      const seenCursors = new Set<string>();
      let after: string | null = null;
      do {
        const response: ProjectWorkspaceReadSnapshot = yield* core.workspace.read({
          kind: "task_window",
          project_id: projectId,
          include_archived: false,
          window: { after, first: 200 },
        });
        if (response.value.kind !== "task_window") {
          return yield* forkError(
            threadId,
            new Error("Core returned a non-task-window read variant for fork title derivation"),
          );
        }
        for (const task of response.value.tasks.items) {
          if (!task.thread) continue;
          titles.push({
            conversationId: task.thread.thread_id,
            forkedFromId: task.thread.forked_from_id ?? null,
            title: task.thread.thread_name ?? null,
          });
        }
        const next: string | null = response.value.tasks.next_cursor ?? null;
        if (!next || seenCursors.has(next)) break;
        seenCursors.add(next);
        after = next;
      } while (after);
      return titles;
    },
  );

  const forkFromTurn = Effect.fn("CodexRendererOwnerCommands.forkFromTurn")(function* (input: {
    readonly ownerClientId: string;
    readonly threadId: string;
    readonly turnId: string;
  }): Effect.fn.Return<CodexThreadActionResult, object> {
    const turnId = input.turnId.trim();
    if (!turnId) {
      return yield* forkError(input.threadId, new Error("Owner thread/fork requires a turnId"));
    }
    const source = yield* directory.resolve({ threadId: input.threadId, fidelity: "durable" });
    if (!source) {
      return yield* forkError(
        input.threadId,
        new Error(`Thread '${input.threadId}' was not found`),
      );
    }
    return yield* conversationRuntimes.runExclusive(
      input.threadId,
      Effect.gen(function* () {
        yield* ownerNotificationDrain.awaitCurrent(input.threadId);
        const current = yield* projection.read(input.threadId);
        const sourceTurn = current.canonical.turns.find((turn) => turn.protocol.id === turnId);
        if (!sourceTurn) {
          return yield* forkError(
            input.threadId,
            new Error(`Turn '${turnId}' was not found in thread '${input.threadId}'`),
          );
        }
        if (sourceTurn.protocol.status === "inProgress") {
          return yield* forkError(
            input.threadId,
            new Error(`Turn '${turnId}' is still in progress`),
          );
        }
        const knownTitles = yield* listForkTitleCatalog(input.threadId, source.durable.projectId);
        const sourceTitle = resolveCodexForkSourceConversationTitle({
          explicitTitle: source.summary.threadName,
          firstTurnInput: current.canonical.turns[0]?.sidecar.params?.input,
          firstTurnCommentAttachments:
            current.canonical.turns[0]?.sidecar.params?.commentAttachments,
        });
        const childTitle = resolveCodexForkChildThreadTitleFromCatalog({
          source: {
            conversationId: input.threadId,
            forkedFromId: source.summary.forkedFromId ?? null,
            title: source.summary.threadName,
          },
          storedThreads: knownTitles,
          activeThreads: [],
          pendingForks: [],
        });
        const execution = yield* core.workspace.read({
          kind: "execution_context",
          thread_id: input.threadId,
        });
        if (execution.value.kind !== "execution_context") {
          return yield* forkError(
            input.threadId,
            new Error("Core returned a non-execution-context read variant for Thread fork"),
          );
        }
        const profile = source.durable.executionProfile;
        const request = {
          threadId: input.threadId,
          lastTurnId: turnId,
          path: null,
          model: profile?.modelId ?? null,
          modelProvider: profile?.providerId ?? null,
          serviceTier: profile?.serviceTier ?? null,
          cwd: source.durable.cwd,
          runtimeWorkspaceRoots: [...execution.value.context.thread.writable_roots],
          threadSource: "user",
          config: {
            ...(profile?.harnessId ? { harness: profile.harnessId } : {}),
            ...(profile?.reasoningEffort
              ? { model_reasoning_effort: profile.reasoningEffort }
              : {}),
            ...buildCodexThreadConfigOverrides(),
          },
        } satisfies ThreadForkParams;
        const response = (yield* gateway.requestOnHost(
          source.durable.executionHostId,
          "thread/fork",
          request as GatewayThreadForkParams,
        )) as unknown as ThreadForkResponse;
        if (response.thread.turns.at(-1)?.id !== turnId) {
          return yield* forkError(
            input.threadId,
            new Error(`Thread fork did not return the requested exact cut through '${turnId}'`),
          );
        }
        const child = yield* directory.acceptForkResult({
          sourceThreadId: input.threadId,
          response,
        });
        if (!child.canonical || !child.snapshot?.turnPagination) {
          return yield* forkError(
            child.summary.threadId,
            new Error(`Forked Thread '${child.summary.threadId}' was not fully hydrated`),
          );
        }
        const markerState = appendCodexCanonicalForkedFromConversationItem(child.canonical, {
          id: randomUUID(),
          type: "forkedFromConversation",
          sourceConversationId: input.threadId,
          sourceConversationTitle: sourceTitle,
        });
        const observedAtMs = yield* Clock.currentTimeMillis;
        yield* projection.hydrate({
          threadId: child.summary.threadId,
          summary: child.summary,
          canonical: markerState,
          pagination: child.snapshot.turnPagination,
          observedAtMs,
        });
        if (childTitle) {
          yield* threadTitles.set({
            threadId: child.summary.threadId,
            name: childTitle,
            normalization: "manual",
            syncDormantConversationUpdates: false,
          });
        }
        const accepted = yield* projection.read(child.summary.threadId);
        if (!accepted.snapshot) {
          return yield* forkError(
            child.summary.threadId,
            new Error(`Forked Thread '${child.summary.threadId}' has no canonical projection`),
          );
        }
        const adoption = yield* rendererConversationCoordinator.adoptRendererOwner({
          conversationId: child.summary.threadId,
          ownerClientId: input.ownerClientId,
          conversation: accepted.snapshot,
        });
        if (adoption.ownerClientId !== input.ownerClientId) {
          return yield* forkError(
            child.summary.threadId,
            new Error(
              `Renderer client '${input.ownerClientId}' could not own fork '${child.summary.threadId}'`,
            ),
          );
        }
        yield* forkSidePanelTransfers
          .stageDirect({
            sourceConversationId: input.threadId,
            targetConversationId: child.summary.threadId,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Forked Thread could not inherit side-panel state").pipe(
                Effect.annotateLogs({
                  sourceThreadId: input.threadId,
                  childThreadId: child.summary.threadId,
                  cause: String(cause),
                }),
              ),
            ),
          );
        return {
          threadId: child.summary.threadId,
          composerIntent: { prompt: "", focusNonce: observedAtMs },
        };
      }),
    );
  });

  const execute = (
    ownerClientId: string,
    input: CodexOwnerAppServerRequestInput,
  ): Effect.Effect<unknown, CodexRendererOwnerCommandError> => {
    const method = input.request.method;
    const requestedThreadId = input.conversationId.trim();
    return Effect.try({
      try: () => validateIdentity(ownerClientId, input, rendererConversations),
      catch: (cause) =>
        new CodexRendererOwnerCommandError({ method, threadId: requestedThreadId, cause }),
    }).pipe(
      Effect.flatMap((threadId): Effect.Effect<unknown, object> => {
        const request = input.request;
        switch (request.method) {
          case "thread/rollback":
            return threadRollback.rollbackLatestForEdit({
              threadId,
              turnId: request.params.turnId,
              numTurns: request.params.numTurns,
            });
          case "thread/fork":
            return forkFromTurn({
              ownerClientId,
              threadId,
              turnId: request.params.turnId,
            });
          case "turn/start":
            return Effect.try({
              try: () => readPreparedPrompt(request.params.preparedPrompt),
              catch: (cause) => new CodexRendererOwnerCommandError({ method, threadId, cause }),
            }).pipe(
              Effect.flatMap((preparedPrompt) =>
                turnCommands.startRendererOwned(threadId, request.params.prompt, {
                  ...(request.params.opts ?? {}),
                  clientUserMessageId: request.params.clientUserMessageId,
                  preparedPrompt,
                }),
              ),
            );
          case "turn/resume-interrupted":
            if (!request.params.clientUserMessageId.trim()) {
              return Effect.fail(
                new CodexRendererOwnerCommandError({
                  method,
                  threadId,
                  cause: new Error("Owner turn/resume-interrupted requires a clientUserMessageId"),
                }),
              );
            }
            return turnCommands.startRendererOwned(threadId, "", {
              ...(request.params.opts ?? {}),
              clientUserMessageId: request.params.clientUserMessageId,
              preparedPrompt: createEmptyCodexPreparedPrompt(),
            });
          case "thread/session-first-turn/start":
            return freshThreadLaunch.start({
              threadId,
              launchId: request.params.launchId,
              ownerClientId,
            });
          case "turn/steer":
            return Effect.try({
              try: () => readSteerParams(threadId, request.params),
              catch: (cause) => new CodexRendererOwnerCommandError({ method, threadId, cause }),
            }).pipe(Effect.flatMap(turnCommands.steerRendererOwned));
          case "turn/interrupt":
            return conversations.interrupt(threadId, request.params.turnId);
          case "thread/settings/update":
            return threadSettings.update({
              threadId,
              patch: request.params.patch,
              syncDormantConversationUpdates: false,
            });
          case "thread/goal/set":
            return Effect.try({
              try: () => readGoalSetParams(threadId, request.params),
              catch: (cause) => new CodexRendererOwnerCommandError({ method, threadId, cause }),
            }).pipe(Effect.flatMap(threadGoals.set));
          case "thread/goal/clear":
            return threadGoals.clear(threadId);
          case "thread/memoryMode/set":
            return conversations.setMemoryMode(threadId, request.params.mode);
          case "thread/compact/start":
            return manualCompaction.start(threadId);
          case "thread/backgroundTerminals/list":
            return conversations.listBackgroundTerminalsPage(threadId, {
              cursor: request.params.cursor ?? null,
              limit:
                request.params.limit && request.params.limit > 0 ? request.params.limit : undefined,
            });
          case "thread/backgroundTerminals/terminate":
            if (!request.params.processId.trim()) {
              return Effect.fail(
                new CodexRendererOwnerCommandError({
                  method,
                  threadId,
                  cause: new Error(
                    "Owner thread/backgroundTerminals/terminate requires a processId",
                  ),
                }),
              );
            }
            return conversations
              .terminateBackgroundTerminal(threadId, request.params.processId)
              .pipe(Effect.map((terminated) => ({ terminated })));
        }
      }),
      Effect.mapError((cause) =>
        cause instanceof CodexRendererOwnerCommandError
          ? cause
          : new CodexRendererOwnerCommandError({
              method,
              threadId: requestedThreadId,
              cause,
            }),
      ),
      Effect.withSpan("CodexRendererOwnerCommands.execute", {
        attributes: { method, threadId: requestedThreadId },
      }),
    );
  };

  return CodexRendererOwnerCommands.of({ execute });
});
