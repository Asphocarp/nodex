import { randomUUID } from "node:crypto";
import type { Turn } from "@nodex/codex-app-server-protocol/v2";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  CodexCanonicalConversationState,
  CodexCanonicalHydratedPermissionContext,
  CodexCanonicalLiveTurnParams,
  CodexConversationThreadSettings,
  CodexConversationSnapshot,
  CodexConversationTurnPagination,
  CodexThreadSummary,
  CodexThreadStatusType,
} from "../../shared/types";
import type { CodexCanonicalSteeringUserMessageItem } from "../../shared/codex-conversation-state/codex-conversation-state";
import type { CodexConversationAggregate } from "./CodexConversationAggregate";
import { CoreModuleResponseError } from "../core-client/core-client";
import { CoreModules } from "../core-runtime/CoreModules";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexRendererConversationRegistry } from "./CodexRendererConversationRegistry";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";
import { buildCodexCanonicalTurnSummary } from "./CodexConversationServerRequestProjection";
import { buildCoreWorkspaceThreadSummary } from "./CodexThreadCatalogProjection";
import { projectCodexThreadDirectorySnapshot } from "./CodexThreadDirectoryProjection";

export interface CodexConversationProjectionState {
  readonly canonical: CodexCanonicalConversationState;
  readonly snapshot: CodexConversationSnapshot | null;
}

export class CodexConversationProjectionError extends Schema.TaggedError<CodexConversationProjectionError>()(
  "CodexConversationProjectionError",
  {
    operation: Schema.String,
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface CodexConversationProjectionService {
  readonly read: (
    threadId: string,
  ) => Effect.Effect<CodexConversationProjectionState, CodexConversationProjectionError>;
  readonly hydrate: (input: {
    readonly threadId: string;
    readonly summary: CodexThreadSummary;
    readonly canonical: CodexCanonicalConversationState;
    readonly pagination: CodexConversationTurnPagination;
    readonly observedAtMs: number;
  }) => Effect.Effect<CodexConversationSnapshot, CodexConversationProjectionError>;
  readonly admitTurn: (input: {
    readonly threadId: string;
    readonly params: CodexCanonicalLiveTurnParams;
    readonly currentCollaborationModel?: string;
    readonly startedAtMs: number;
  }) => Effect.Effect<void, CodexConversationProjectionError>;
  readonly configureTurn: (input: {
    readonly threadId: string;
    readonly settings: CodexConversationThreadSettings;
    readonly permissions: CodexCanonicalHydratedPermissionContext;
  }) => Effect.Effect<void, CodexConversationProjectionError>;
  readonly relocateExecution: (input: {
    readonly threadId: string;
    readonly cwd: string;
    readonly managedWorktreePath: string | null;
    readonly permissions: CodexCanonicalHydratedPermissionContext;
  }) => Effect.Effect<void, CodexConversationProjectionError>;
  readonly acceptTurn: (input: {
    readonly threadId: string;
    readonly clientUserMessageId: string;
    readonly turn: Turn;
    readonly recovery?: {
      readonly params: CodexCanonicalLiveTurnParams;
      readonly currentCollaborationModel?: string;
      readonly startedAtMs: number;
    };
    readonly observedAtMs: number;
  }) => Effect.Effect<void, CodexConversationProjectionError>;
  readonly rejectTurn: (input: {
    readonly threadId: string;
    readonly clientUserMessageId: string;
    readonly failureItemId: `${string}-${string}-${string}-${string}-${string}`;
    readonly observedAtMs: number;
  }) => Effect.Effect<void>;
  readonly admitSteer: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly item: CodexCanonicalSteeringUserMessageItem;
    readonly observedAtMs: number;
  }) => Effect.Effect<void, CodexConversationProjectionError>;
  readonly rejectSteer: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly itemId: string;
    readonly observedAtMs: number;
  }) => Effect.Effect<void>;
  readonly resolveInterruptTurn: (
    threadId: string,
    requestedTurnId?: string,
  ) => Effect.Effect<string, CodexConversationProjectionError>;
  readonly interruptTurn: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly observedAtMs: number;
  }) => Effect.Effect<boolean>;
  readonly backgroundTerminalTurnIds: (threadId: string) => Effect.Effect<readonly string[] | null>;
  readonly backgroundTerminalsCleaned: (
    threadId: string,
    observedAtMs: number,
  ) => Effect.Effect<void>;
  readonly markThreadActive: (
    threadId: string,
  ) => Effect.Effect<void, CodexConversationProjectionError>;
  readonly reconcileThreadStatus: (
    threadId: string,
  ) => Effect.Effect<void, CodexConversationProjectionError>;
  readonly commitInterruptedTurn: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly observedAtMs: number;
  }) => Effect.Effect<void, CodexConversationProjectionError>;
}

export class CodexConversationProjection extends Context.Service<
  CodexConversationProjection,
  CodexConversationProjectionService
>()("nodex/main/codex-application/CodexConversationProjection") {}

/**
 * The canonical application projection for one Profile. Commands name semantic outcomes;
 * the Module keeps canonical mutation and dormant accepted-replica revisioning coherent. A live
 * renderer owner remains the sole authority for publishing and advancing its accepted replica.
 */
export const make: Effect.Effect<
  CodexConversationProjectionService,
  never,
  | ConversationRuntimeMap
  | CodexRendererConversationRegistry
  | CodexApplicationEventHub
  | CoreModules
> = Effect.gen(function* () {
  const conversations = yield* ConversationRuntimeMap;
  const rendererConversations = yield* CodexRendererConversationRegistry;
  const events = yield* CodexApplicationEventHub;
  const core = yield* CoreModules;

  const aggregate = (threadId: string) => conversations.currentConversation(threadId);
  const projectReplica = (threadId: string): boolean => !rendererConversations.hasOwner(threadId);
  const publish = (value: import("../../shared/types").CodexEvent): void =>
    events.publish({ kind: "codex", value });

  const updateDurableStatus = (
    threadId: string,
    statusType: CodexThreadStatusType,
    updatedAt: number,
  ): Effect.Effect<CodexThreadSummary | null, CodexConversationProjectionError> => {
    const current = aggregate(threadId)?.readSnapshot();
    if (current?.ephemeral) return Effect.succeed(null);
    return core.workspace
      .apply({
        operationId: `electron:thread-status:${threadId}:${randomUUID()}`,
        intent: {
          kind: "update_thread",
          thread_id: threadId,
          patch: {
            status: { status_type: statusType, active_flags: [] },
            updated_at: updatedAt,
          },
        },
      })
      .pipe(
        Effect.andThen(core.workspace.read({ kind: "thread", thread_id: threadId })),
        Effect.flatMap((snapshot) =>
          snapshot.value.kind === "thread"
            ? Effect.succeed(buildCoreWorkspaceThreadSummary(snapshot.value.thread))
            : Effect.fail(
                new CodexConversationProjectionError({
                  operation: "persist-thread-status",
                  threadId,
                  cause: new Error("Core returned the wrong Thread read variant"),
                }),
              ),
        ),
        Effect.catch((cause) =>
          cause.cause instanceof CoreModuleResponseError &&
          cause.cause.coreError.code === "not_found"
            ? Effect.succeed(null)
            : Effect.fail(
                cause instanceof CodexConversationProjectionError
                  ? cause
                  : new CodexConversationProjectionError({
                      operation: "persist-thread-status",
                      threadId,
                      cause,
                    }),
              ),
        ),
      );
  };

  const commitStatus = (
    threadId: string,
    statusType: CodexThreadStatusType,
    observedAtMs: number,
  ) =>
    Effect.gen(function* () {
      aggregate(threadId)?.setThreadStatus(statusType, projectReplica(threadId));
      const summary = yield* updateDurableStatus(threadId, statusType, observedAtMs);
      if (summary) publish({ type: "threadSummary", thread: summary });
      publish({ type: "threadStatus", threadId, statusType, statusActiveFlags: [] });
    });

  const canonicalStatus = (threadId: string): CodexThreadStatusType =>
    aggregate(threadId)
      ?.readCanonicalState()
      ?.turns.some((turn) => turn.protocol.status === "inProgress")
      ? "active"
      : "idle";

  const required = (operation: string, threadId: string) =>
    Effect.suspend(() => {
      const conversation = aggregate(threadId);
      return conversation
        ? Effect.succeed(conversation)
        : Effect.fail(
            new CodexConversationProjectionError({
              operation,
              threadId,
              cause: new Error(`Canonical conversation '${threadId}' is not loaded`),
            }),
          );
    });

  const requireChanged = (
    operation: string,
    threadId: string,
    change: (conversation: CodexConversationAggregate) => boolean,
  ) =>
    required(operation, threadId).pipe(
      Effect.flatMap((conversation) =>
        Effect.try({
          try: () => {
            if (!change(conversation)) {
              throw new Error(`Canonical ${operation} did not match '${threadId}'`);
            }
          },
          catch: (cause) => new CodexConversationProjectionError({ operation, threadId, cause }),
        }),
      ),
    );

  return CodexConversationProjection.of({
    read: (threadId) =>
      required("read", threadId).pipe(
        Effect.flatMap((conversation) => {
          const canonical = conversation.readCanonicalState();
          return canonical
            ? Effect.succeed({ canonical, snapshot: conversation.readSnapshot() })
            : Effect.fail(
                new CodexConversationProjectionError({
                  operation: "read",
                  threadId,
                  cause: new Error(`Canonical conversation '${threadId}' is not hydrated`),
                }),
              );
        }),
      ),
    hydrate: (input) =>
      Effect.try({
        try: () => {
          const conversation = conversations.conversation(input.threadId);
          const before = conversation.readCanonicalState();
          const accepted = conversation.read().acceptedReplica;
          conversation.acceptCanonicalState(input.canonical);
          conversation.setResumeState("resumed");
          conversation.initializeHistory(input.pagination, input.canonical.turns.length);
          const snapshot = projectCodexThreadDirectorySnapshot({
            summary: input.summary,
            current: conversation.readSnapshot(),
            before,
            after: input.canonical,
            pagination: conversation.readTurnPagination(),
            observedAtMs: input.observedAtMs,
          });
          conversation.installSnapshot(snapshot);
          if (projectReplica(input.threadId) && accepted) {
            return conversation.advanceReplica({
              conversation: snapshot,
              ownerEpoch: accepted.checkpoint.ownerEpoch,
            }).replica.conversation;
          }
          return snapshot;
        },
        catch: (cause) =>
          new CodexConversationProjectionError({
            operation: "hydrate",
            threadId: input.threadId,
            cause,
          }),
      }),
    admitTurn: (input) =>
      requireChanged("admit-turn", input.threadId, (conversation) =>
        conversation.admitOptimisticTurn({
          params: input.params,
          ...(input.currentCollaborationModel
            ? { currentCollaborationModel: input.currentCollaborationModel }
            : {}),
          startedAtMs: input.startedAtMs,
          projectReplica: projectReplica(input.threadId),
        }),
      ),
    configureTurn: (input) =>
      requireChanged("configure-turn", input.threadId, (conversation) =>
        conversation.applyTurnConfiguration({
          settings: input.settings,
          permissions: input.permissions,
          projectReplica: projectReplica(input.threadId),
        }),
      ),
    relocateExecution: (input) =>
      requireChanged("relocate-execution", input.threadId, (conversation) =>
        conversation.relocateExecution({
          cwd: input.cwd,
          managedWorktreePath: input.managedWorktreePath,
          permissions: input.permissions,
          projectReplica: projectReplica(input.threadId),
        }),
      ),
    acceptTurn: (input) =>
      requireChanged("accept-turn", input.threadId, (conversation) =>
        conversation.acceptOptimisticTurn({
          clientUserMessageId: input.clientUserMessageId,
          turn: input.turn,
          ...(input.recovery ? { recovery: input.recovery } : {}),
          observedAtMs: input.observedAtMs,
          projectReplica: projectReplica(input.threadId),
        }),
      ),
    rejectTurn: (input) =>
      Effect.sync(() => {
        const conversation = aggregate(input.threadId);
        if (!conversation) return;
        if (
          conversation.rejectOptimisticTurn({
            clientUserMessageId: input.clientUserMessageId,
            failureItemId: input.failureItemId,
            observedAtMs: input.observedAtMs,
            projectReplica: projectReplica(input.threadId),
          })
        )
          return;
      }),
    admitSteer: (input) =>
      requireChanged("admit-steer", input.threadId, (conversation) =>
        conversation.admitSteeringItem({
          turnId: input.turnId,
          item: input.item,
          observedAtMs: input.observedAtMs,
          projectReplica: projectReplica(input.threadId),
        }),
      ),
    rejectSteer: (input) =>
      Effect.sync(() => {
        const conversation = aggregate(input.threadId);
        if (!conversation) return;
        if (
          conversation.rejectSteeringItem({
            turnId: input.turnId,
            itemId: input.itemId,
            observedAtMs: input.observedAtMs,
            projectReplica: projectReplica(input.threadId),
          })
        )
          return;
      }),
    resolveInterruptTurn: (threadId, requestedTurnId) =>
      requestedTurnId?.trim()
        ? Effect.succeed(requestedTurnId.trim())
        : required("resolve-interrupt-turn", threadId).pipe(
            Effect.flatMap((conversation) => {
              const turnId = conversation.resolveInterruptTurnId(requestedTurnId);
              return turnId
                ? Effect.succeed(turnId)
                : Effect.fail(
                    new CodexConversationProjectionError({
                      operation: "resolve-interrupt-turn",
                      threadId,
                      cause: new Error("Could not determine which turn to interrupt"),
                    }),
                  );
            }),
          ),
    interruptTurn: (input) =>
      Effect.sync(() => {
        const changed =
          aggregate(input.threadId)?.interruptTurn({
            turnId: input.turnId,
            observedAtMs: input.observedAtMs,
            projectReplica: projectReplica(input.threadId),
          }) ?? false;
        return changed;
      }),
    backgroundTerminalTurnIds: (threadId) =>
      Effect.sync(() => aggregate(threadId)?.backgroundTerminalTurnIds() ?? null),
    backgroundTerminalsCleaned: (threadId, observedAtMs) =>
      Effect.sync(() => {
        aggregate(threadId)?.cleanBackgroundTerminals({
          observedAtMs,
          projectReplica: projectReplica(threadId),
        });
      }),
    markThreadActive: (threadId) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((observedAtMs) => commitStatus(threadId, "active", observedAtMs)),
      ),
    reconcileThreadStatus: (threadId) =>
      Effect.gen(function* () {
        const observedAtMs = yield* Clock.currentTimeMillis;
        const statusType = canonicalStatus(threadId);
        yield* commitStatus(threadId, statusType, observedAtMs);
      }),
    commitInterruptedTurn: (input) =>
      Effect.gen(function* () {
        aggregate(input.threadId)?.interruptTurn({
          turnId: input.turnId,
          observedAtMs: input.observedAtMs,
          projectReplica: projectReplica(input.threadId),
        });
        const canonical = aggregate(input.threadId)?.readCanonicalState() ?? null;
        const statusType = canonicalStatus(input.threadId);
        yield* commitStatus(input.threadId, statusType, input.observedAtMs);
        const turn = canonical?.turns.find((candidate) => candidate.protocol.id === input.turnId);
        if (turn) {
          publish({
            type: "turn",
            turn: buildCodexCanonicalTurnSummary(
              input.threadId,
              turn,
              turn.items.map((item) => item.id),
            ),
          });
        }
      }),
  });
});
