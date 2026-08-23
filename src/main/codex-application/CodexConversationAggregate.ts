import type {
  CodexCanonicalConversationState,
  CodexCanonicalServerRequest,
  CodexConversationTurnPagination,
  CodexConversationResumeState,
  CodexConversationSnapshot,
  CodexThreadStreamCheckpoint,
} from "../../shared/types";
import type {
  CodexServerRequestLifecycleResult,
  CodexServerRequestRawLifecycleResult,
  CodexServerRequestRawState,
} from "../../shared/codex-conversation-state/codex-server-request-lifecycle";
import { completeCodexCanonicalPlanImplementationState } from "../../shared/codex-conversation-state/codex-server-request-lifecycle";
import {
  reduceCodexConversationFrameTextDeltas,
  type CodexFrameTextDeltaOutcome,
} from "../../shared/codex-conversation-state/codex-frame-text-delta";
import {
  buildCodexFrameTextDeltaKey,
  type CodexFrameTextDeltaUpdate,
} from "../../shared/codex-conversation-state/codex-frame-text-delta-queue";
import {
  reduceCodexConversationCommandOutput,
  type CodexCommandExecutionMutationDisposition,
} from "../../shared/codex-conversation-state/codex-command-execution-stream";
import {
  appendCodexCommandOutputTail,
  buildCodexCommandOutputKey,
  type CodexCommandOutputUpdate,
} from "../../shared/codex-conversation-state/codex-command-output-queue";
import {
  buildCodexThreadStreamCheckpoint,
  type CodexThreadStreamReplica,
} from "../../shared/codex-owner-follower-replication";
import {
  projectCodexConversationRawServerRequestLifecycle,
  projectCodexConversationPlanImplementationCompleted,
  projectCodexConversationServerRequestLifecycle,
} from "./CodexConversationServerRequestProjection";
import { projectCodexConversationSnapshot } from "./CodexConversationSnapshotProjection";
import type {
  CodexBufferedConversationEvent,
  CodexBufferedConversationRequestCompletion,
} from "./CodexConversationBufferedEvent";
import type {
  CodexServerNotification,
  CodexServerRequest,
} from "../codex-runtime/CodexApplicationProtocol";

export type CodexConversationStreamRole = "follower" | "owner" | null;

export type CodexConversationServerRequestLifecycleCommit =
  | {
      readonly kind: "canonical";
      readonly before: CodexCanonicalConversationState;
      readonly lifecycle: CodexServerRequestLifecycleResult;
    }
  | {
      readonly kind: "raw";
      readonly lifecycle: CodexServerRequestRawLifecycleResult;
    };

export interface CodexConversationServerRequestState {
  readonly canonicalState: CodexCanonicalConversationState | null;
  readonly rawState: CodexServerRequestRawState;
  readonly streamRole: CodexConversationStreamRole;
}

export interface CodexConversationServerRequestCommitResult {
  readonly hasUnreadTurn: boolean;
  readonly stateChanged: boolean;
  readonly unreadChanged: boolean;
}

export interface CodexConversationAggregateSnapshot {
  readonly generation: number;
  readonly canonicalState: CodexCanonicalConversationState | null;
  readonly preHydrationServerRequests: readonly CodexCanonicalServerRequest[];
  readonly preHydrationHasUnreadTurn: boolean;
  readonly streamRole: CodexConversationStreamRole;
  readonly acceptedReplica: CodexThreadStreamReplica | null;
  readonly version: number;
  readonly revision: number;
  readonly checkpoint: CodexThreadStreamCheckpoint | null;
  readonly snapshot: CodexConversationSnapshot | null;
  readonly resumeState: CodexConversationResumeState;
  readonly turnPagination: CodexConversationTurnPagination;
  readonly isStreaming: boolean;
}

export interface CodexConversationHistoryFence {
  readonly generation: number;
  readonly olderCursor: string;
  readonly oldestLoadedTurnId: string | null;
}

interface MutableCodexConversationAggregate {
  readonly generation: number;
  canonicalState: CodexCanonicalConversationState | null;
  preHydrationServerRequests: readonly CodexCanonicalServerRequest[];
  preHydrationHasUnreadTurn: boolean;
  streamRole: CodexConversationStreamRole;
  acceptedReplica: CodexThreadStreamReplica | null;
  version: number;
  revision: number;
  checkpoint: CodexThreadStreamCheckpoint | null;
  snapshot: CodexConversationSnapshot | null;
  resumeState: CodexConversationResumeState;
  turnPagination: CodexConversationTurnPagination;
  isStreaming: boolean;
  historyGeneration: number;
  bufferedFrameText: Map<string, CodexFrameTextDeltaUpdate>;
  bufferedCommandOutput: Map<string, CodexCommandOutputUpdate>;
  resumeEventBuffer: CodexBufferedConversationEvent[] | null;
  threadStartEventBuffer: CodexBufferedConversationEvent[] | null;
  threadStartDeferred: boolean;
  threadStartReady: boolean;
}

export interface CodexConversationAggregate {
  readonly threadId: string;
  readonly generation: number;
  readonly read: () => CodexConversationAggregateSnapshot;
  readonly readCanonicalState: () => CodexCanonicalConversationState | null;
  readonly readServerRequests: () => readonly CodexCanonicalServerRequest[];
  readonly readServerRequestState: () => CodexConversationServerRequestState;
  readonly readHasUnreadTurn: () => boolean;
  readonly readSnapshot: () => CodexConversationSnapshot | null;
  /** Installs the canonical application snapshot without implying renderer ownership. */
  readonly installSnapshot: (snapshot: CodexConversationSnapshot) => void;
  /** Seeds durable Workspace state before canonical app-server hydration. */
  readonly seedHasUnreadTurn: (hasUnreadTurn: boolean) => void;
  /** Applies the canonical read-state transition to every loaded conversation projection. */
  readonly setHasUnreadTurn: (hasUnreadTurn: boolean, projectReplica: boolean) => boolean;
  readonly readResumeState: () => CodexConversationResumeState;
  readonly setResumeState: (state: CodexConversationResumeState) => void;
  readonly isStreaming: () => boolean;
  readonly setStreaming: (isStreaming: boolean) => void;
  readonly readTurnPagination: () => CodexConversationTurnPagination;
  /** Replaces pagination when a canonical hydration installs a new history window. */
  readonly initializeHistory: (
    pagination: CodexConversationTurnPagination,
    loadedTurnCount: number,
  ) => void;
  /** Opens one cursor-fenced physical history load. */
  readonly beginHistoryLoad: (loadedTurnCount: number) => CodexConversationHistoryFence | null;
  readonly isHistoryLoadCurrent: (fence: CodexConversationHistoryFence) => boolean;
  readonly commitHistoryLoad: (
    fence: CodexConversationHistoryFence,
    pagination: CodexConversationTurnPagination,
    loadedTurnCount: number,
  ) => boolean;
  readonly commitHistoryProjection: (input: {
    readonly fence: CodexConversationHistoryFence;
    readonly state: CodexCanonicalConversationState;
    readonly pagination: CodexConversationTurnPagination;
    readonly loadedTurnCount: number;
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => boolean;
  readonly failHistoryLoad: (fence: CodexConversationHistoryFence) => boolean;
  readonly bufferFrameTextDelta: (update: CodexFrameTextDeltaUpdate) => void;
  readonly bufferCommandOutputDelta: (update: CodexCommandOutputUpdate, maxChars: number) => void;
  readonly takeBufferedFrameTextDeltas: () => readonly CodexFrameTextDeltaUpdate[];
  readonly takeBufferedCommandOutputDeltas: () => readonly CodexCommandOutputUpdate[];
  readonly hasBufferedFrameTextDeltas: () => boolean;
  readonly hasBufferedCommandOutputDeltas: () => boolean;
  readonly clearBufferedDeltas: () => void;
  readonly beginResumeEventBuffer: () => boolean;
  readonly hasResumeEventBuffer: () => boolean;
  readonly offerBufferedNotification: (input: {
    readonly notification: CodexServerNotification;
    readonly bypassResume: boolean;
    readonly startsThread: boolean;
    readonly deferThreadStart: boolean;
  }) => boolean;
  readonly offerBufferedRequest: (input: {
    readonly request: CodexServerRequest;
    readonly completion: CodexBufferedConversationRequestCompletion;
  }) => boolean;
  readonly takeResumeEventBuffer: () => readonly CodexBufferedConversationEvent[] | null;
  readonly takeThreadStartEventBuffer: () => readonly CodexBufferedConversationEvent[] | null;
  readonly markThreadStartReady: () => void;
  readonly resetThreadStartReady: () => void;
  readonly hasDeferredThreadStart: () => boolean;
  readonly discardResumeEventBuffer: () => readonly CodexBufferedConversationEvent[];
  readonly clearBufferedEvents: () => readonly CodexBufferedConversationEvent[];
  readonly commitFrameTextDeltas: (input: {
    readonly updates: readonly CodexFrameTextDeltaUpdate[];
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => readonly CodexFrameTextDeltaOutcome[];
  readonly commitCommandOutputDeltas: (input: {
    readonly updates: readonly CodexCommandOutputUpdate[];
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => readonly CodexCommandExecutionMutationDisposition[];
  readonly commitServerRequestLifecycle: (
    input: CodexConversationServerRequestLifecycleCommit & {
      readonly observedAtMs: number;
      readonly projectReplica: boolean;
    },
  ) => CodexConversationServerRequestCommitResult;
  readonly completePlanImplementation: (turnId: string, projectReplica: boolean) => boolean;
  readonly readStreamRole: () => CodexConversationStreamRole;
  readonly setStreamRole: (role: CodexConversationStreamRole) => void;
  readonly acceptCanonicalState: (
    state: CodexCanonicalConversationState,
  ) => CodexCanonicalConversationState;
  readonly replaceServerRequests: (requests: readonly CodexCanonicalServerRequest[]) => void;
  readonly incrementVersion: () => number;
  readonly acceptReplica: (input: {
    readonly conversation: CodexConversationSnapshot;
    readonly revision: number;
    readonly ownerEpoch: number;
  }) => CodexThreadStreamReplica;
  readonly advanceReplica: (input: {
    readonly conversation: CodexConversationSnapshot;
    readonly ownerEpoch: number;
  }) => {
    readonly baseRevision: number;
    readonly replica: CodexThreadStreamReplica;
  };
  readonly clearReplica: () => void;
  /** Clears semantic state while retaining the current live runtime generation. */
  readonly reset: () => void;
}

export interface CodexConversationAggregateRegistry {
  /** Pure query: an unknown or released Thread never creates a new generation. */
  readonly current: (threadId: string) => CodexConversationAggregate | null;
  /** Binds a semantic aggregate generation to a caller or keyed runtime Scope. */
  readonly acquire: (threadId: string) => CodexConversationAggregate;
  /** Releases only the generation owned by the closing keyed runtime. */
  readonly releaseGeneration: (threadId: string, generation: number) => void;
  /** Releases every generation at the process Scope boundary. */
  readonly releaseAll: () => void;
}

const initialAggregate = (generation: number): MutableCodexConversationAggregate => ({
  generation,
  canonicalState: null,
  preHydrationServerRequests: [],
  preHydrationHasUnreadTurn: false,
  streamRole: null,
  acceptedReplica: null,
  version: 0,
  revision: 0,
  checkpoint: null,
  snapshot: null,
  resumeState: "resumed",
  turnPagination: {
    olderCursor: null,
    backwardsCursor: null,
    oldestLoadedTurnId: null,
    isLoadingOlder: false,
    hasLoadedOldest: true,
    loadedTurnCount: 0,
    itemsView: "full",
  },
  isStreaming: false,
  historyGeneration: 0,
  bufferedFrameText: new Map(),
  bufferedCommandOutput: new Map(),
  resumeEventBuffer: null,
  threadStartEventBuffer: null,
  threadStartDeferred: false,
  threadStartReady: false,
});

const snapshot = (
  aggregate: MutableCodexConversationAggregate,
): CodexConversationAggregateSnapshot => ({
  generation: aggregate.generation,
  canonicalState: aggregate.canonicalState,
  preHydrationServerRequests: [...aggregate.preHydrationServerRequests],
  preHydrationHasUnreadTurn: aggregate.preHydrationHasUnreadTurn,
  streamRole: aggregate.streamRole,
  acceptedReplica:
    aggregate.acceptedReplica === null
      ? null
      : {
          checkpoint: aggregate.acceptedReplica.checkpoint,
          conversation: aggregate.acceptedReplica.conversation,
        },
  version: aggregate.version,
  revision: aggregate.revision,
  checkpoint: aggregate.checkpoint,
  snapshot: aggregate.snapshot,
  resumeState: aggregate.resumeState,
  turnPagination: { ...aggregate.turnPagination },
  isStreaming: aggregate.isStreaming,
});

/**
 * Creates the single per-Thread canonical authority used by ConversationRuntimeMap.
 * Its interface exposes semantic state transitions rather than mutable records or generic reducers.
 */
export function makeCodexConversationAggregateRegistry(): CodexConversationAggregateRegistry {
  const aggregates = new Map<string, MutableCodexConversationAggregate>();
  const capabilities = new Map<string, CodexConversationAggregate>();
  let nextGeneration = 1;

  const ensureState = (threadId: string): MutableCodexConversationAggregate => {
    const existing = aggregates.get(threadId);
    if (existing) return existing;
    const created = initialAggregate(nextGeneration++);
    aggregates.set(threadId, created);
    return created;
  };

  const resetAggregate = (aggregate: MutableCodexConversationAggregate): void => {
    aggregate.canonicalState = null;
    aggregate.preHydrationServerRequests = [];
    aggregate.preHydrationHasUnreadTurn = false;
    aggregate.streamRole = null;
    aggregate.acceptedReplica = null;
    aggregate.version = 0;
    aggregate.revision = 0;
    aggregate.checkpoint = null;
    aggregate.snapshot = null;
    aggregate.resumeState = "resumed";
    aggregate.turnPagination = initialAggregate(aggregate.generation).turnPagination;
    aggregate.isStreaming = false;
    aggregate.historyGeneration = 0;
    aggregate.bufferedFrameText.clear();
    aggregate.bufferedCommandOutput.clear();
    aggregate.resumeEventBuffer = null;
    aggregate.threadStartEventBuffer = null;
    aggregate.threadStartDeferred = false;
    aggregate.threadStartReady = false;
  };

  const makeCapability = (
    threadId: string,
    aggregate: MutableCodexConversationAggregate,
  ): CodexConversationAggregate => {
    const acceptReplica = (input: {
      readonly conversation: CodexConversationSnapshot;
      readonly revision: number;
      readonly ownerEpoch: number;
    }): CodexThreadStreamReplica => {
      const checkpoint = buildCodexThreadStreamCheckpoint({
        ownerEpoch: input.ownerEpoch,
        revision: input.revision,
        conversation: input.conversation,
      });
      const replica = { checkpoint, conversation: input.conversation };
      aggregate.acceptedReplica = replica;
      aggregate.snapshot = input.conversation;
      aggregate.revision = input.revision;
      aggregate.checkpoint = checkpoint;
      return replica;
    };

    return {
      threadId,
      generation: aggregate.generation,
      read: () => snapshot(aggregate),
      readCanonicalState: () => aggregate.canonicalState,
      readServerRequests: () =>
        aggregate.canonicalState?.requests ?? aggregate.preHydrationServerRequests,
      readHasUnreadTurn: () =>
        aggregate.canonicalState?.sidecar.hasUnreadTurn ?? aggregate.preHydrationHasUnreadTurn,
      readSnapshot: () => aggregate.snapshot,
      installSnapshot: (conversation) => {
        aggregate.snapshot = conversation;
      },
      seedHasUnreadTurn: (hasUnreadTurn) => {
        if (aggregate.canonicalState) return;
        aggregate.preHydrationHasUnreadTurn = hasUnreadTurn;
        if (aggregate.snapshot) {
          aggregate.snapshot = { ...aggregate.snapshot, hasUnreadTurn };
        }
      },
      setHasUnreadTurn: (hasUnreadTurn, projectReplica) => {
        const previous =
          aggregate.canonicalState?.sidecar.hasUnreadTurn ?? aggregate.preHydrationHasUnreadTurn;
        const replicaChanged =
          aggregate.acceptedReplica !== null &&
          aggregate.acceptedReplica.conversation.hasUnreadTurn !== hasUnreadTurn;
        if (previous !== hasUnreadTurn) {
          if (aggregate.canonicalState) {
            aggregate.canonicalState = {
              ...aggregate.canonicalState,
              sidecar: {
                ...aggregate.canonicalState.sidecar,
                hasUnreadTurn,
              },
            };
          } else {
            aggregate.preHydrationHasUnreadTurn = hasUnreadTurn;
          }
          if (aggregate.snapshot) {
            aggregate.snapshot = {
              ...aggregate.snapshot,
              hasUnreadTurn,
              ...(hasUnreadTurn ? {} : { unreadMessageCount: 0 }),
            };
          }
        }
        if (projectReplica && replicaChanged && aggregate.acceptedReplica) {
          const conversation = {
            ...aggregate.acceptedReplica.conversation,
            hasUnreadTurn,
            ...(hasUnreadTurn ? {} : { unreadMessageCount: 0 }),
          };
          acceptReplica({
            conversation,
            ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
            revision: aggregate.revision + 1,
          });
        }
        return previous !== hasUnreadTurn || (projectReplica && replicaChanged);
      },
      readResumeState: () => aggregate.resumeState,
      setResumeState: (state) => {
        const replicaChanged =
          aggregate.acceptedReplica !== null &&
          aggregate.acceptedReplica.conversation.resumeState !== state;
        if (aggregate.resumeState === state && !replicaChanged) return;
        aggregate.resumeState = state;
        if (aggregate.snapshot) {
          aggregate.snapshot = { ...aggregate.snapshot, resumeState: state };
        }
        if (!replicaChanged || !aggregate.acceptedReplica) return;
        acceptReplica({
          conversation: { ...aggregate.acceptedReplica.conversation, resumeState: state },
          ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
          revision: aggregate.revision + 1,
        });
      },
      isStreaming: () => aggregate.isStreaming,
      setStreaming: (isStreaming) => {
        aggregate.isStreaming = isStreaming;
      },
      readTurnPagination: () => ({ ...aggregate.turnPagination }),
      initializeHistory: (pagination, loadedTurnCount) => {
        aggregate.historyGeneration += 1;
        aggregate.turnPagination = { ...pagination, loadedTurnCount };
        if (aggregate.snapshot) {
          aggregate.snapshot = {
            ...aggregate.snapshot,
            turnPagination: { ...aggregate.turnPagination },
          };
        }
      },
      beginHistoryLoad: (loadedTurnCount) => {
        const pagination = aggregate.turnPagination;
        if (
          pagination.isLoadingOlder ||
          pagination.hasLoadedOldest ||
          pagination.olderCursor === null
        ) {
          return null;
        }
        aggregate.historyGeneration += 1;
        const fence = {
          generation: aggregate.historyGeneration,
          olderCursor: pagination.olderCursor,
          oldestLoadedTurnId: pagination.oldestLoadedTurnId,
        };
        aggregate.turnPagination = {
          ...pagination,
          isLoadingOlder: true,
          hasLoadedOldest: false,
          loadedTurnCount,
        };
        if (aggregate.snapshot) {
          aggregate.snapshot = {
            ...aggregate.snapshot,
            turnPagination: { ...aggregate.turnPagination },
          };
        }
        return fence;
      },
      isHistoryLoadCurrent: (fence) =>
        aggregate.historyGeneration === fence.generation &&
        aggregate.turnPagination.isLoadingOlder &&
        aggregate.turnPagination.olderCursor === fence.olderCursor,
      commitHistoryLoad: (fence, pagination, loadedTurnCount) => {
        if (
          !aggregate.turnPagination.isLoadingOlder ||
          aggregate.historyGeneration !== fence.generation ||
          aggregate.turnPagination.olderCursor !== fence.olderCursor
        ) {
          return false;
        }
        aggregate.turnPagination = { ...pagination, loadedTurnCount, isLoadingOlder: false };
        if (aggregate.snapshot) {
          aggregate.snapshot = {
            ...aggregate.snapshot,
            turnPagination: { ...aggregate.turnPagination },
          };
        }
        return true;
      },
      commitHistoryProjection: ({
        fence,
        state,
        pagination,
        loadedTurnCount,
        observedAtMs,
        projectReplica,
      }) => {
        if (
          !aggregate.turnPagination.isLoadingOlder ||
          aggregate.historyGeneration !== fence.generation ||
          aggregate.turnPagination.olderCursor !== fence.olderCursor
        ) {
          return false;
        }
        const before = aggregate.canonicalState;
        if (!before) return false;
        aggregate.canonicalState = state;
        if (aggregate.snapshot) {
          aggregate.snapshot = projectCodexConversationSnapshot({
            conversation: aggregate.snapshot,
            before,
            after: state,
            observedAtMs,
          });
        }
        aggregate.turnPagination = { ...pagination, loadedTurnCount, isLoadingOlder: false };
        if (aggregate.snapshot) {
          aggregate.snapshot = {
            ...aggregate.snapshot,
            turnPagination: { ...aggregate.turnPagination },
          };
        }
        if (projectReplica && aggregate.acceptedReplica) {
          acceptReplica({
            conversation: {
              ...projectCodexConversationSnapshot({
                conversation: aggregate.acceptedReplica.conversation,
                before,
                after: state,
                observedAtMs,
              }),
              turnPagination: { ...aggregate.turnPagination },
            },
            ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
            revision: aggregate.revision + 1,
          });
        }
        return true;
      },
      failHistoryLoad: (fence) => {
        if (
          !aggregate.turnPagination.isLoadingOlder ||
          aggregate.historyGeneration !== fence.generation ||
          aggregate.turnPagination.olderCursor !== fence.olderCursor
        ) {
          return false;
        }
        aggregate.turnPagination = {
          ...aggregate.turnPagination,
          olderCursor: fence.olderCursor,
          oldestLoadedTurnId: fence.oldestLoadedTurnId,
          isLoadingOlder: false,
          hasLoadedOldest: false,
        };
        if (aggregate.snapshot) {
          aggregate.snapshot = {
            ...aggregate.snapshot,
            turnPagination: { ...aggregate.turnPagination },
          };
        }
        return true;
      },
      bufferFrameTextDelta: (update) => {
        const key = buildCodexFrameTextDeltaKey(update);
        const existing = aggregate.bufferedFrameText.get(key);
        aggregate.bufferedFrameText.set(key, {
          ...update,
          delta: `${existing?.delta ?? ""}${update.delta}`,
        });
      },
      bufferCommandOutputDelta: (update, maxChars) => {
        const key = buildCodexCommandOutputKey(update);
        const existing = aggregate.bufferedCommandOutput.get(key);
        const { next } = appendCodexCommandOutputTail({
          current: existing?.delta ?? "",
          delta: update.delta,
          maxChars,
        });
        aggregate.bufferedCommandOutput.set(key, { ...update, delta: next });
      },
      takeBufferedFrameTextDeltas: () => {
        const updates = [...aggregate.bufferedFrameText.values()];
        aggregate.bufferedFrameText.clear();
        return updates;
      },
      takeBufferedCommandOutputDeltas: () => {
        const updates = [...aggregate.bufferedCommandOutput.values()];
        aggregate.bufferedCommandOutput.clear();
        return updates;
      },
      hasBufferedFrameTextDeltas: () => aggregate.bufferedFrameText.size > 0,
      hasBufferedCommandOutputDeltas: () => aggregate.bufferedCommandOutput.size > 0,
      clearBufferedDeltas: () => {
        aggregate.bufferedFrameText.clear();
        aggregate.bufferedCommandOutput.clear();
      },
      beginResumeEventBuffer: () => {
        if (aggregate.resumeEventBuffer !== null) return false;
        aggregate.resumeEventBuffer = [];
        return true;
      },
      hasResumeEventBuffer: () => aggregate.resumeEventBuffer !== null,
      offerBufferedNotification: ({
        notification,
        bypassResume,
        startsThread,
        deferThreadStart,
      }) => {
        if (!bypassResume && aggregate.resumeEventBuffer !== null) {
          aggregate.resumeEventBuffer.push({ type: "notification", notification });
          return true;
        }
        if (aggregate.threadStartEventBuffer !== null) {
          aggregate.threadStartEventBuffer.push({ type: "notification", notification });
          return true;
        }
        if (!startsThread || !deferThreadStart || aggregate.threadStartReady) return false;
        aggregate.threadStartDeferred = true;
        aggregate.threadStartEventBuffer = [{ type: "notification", notification }];
        return true;
      },
      offerBufferedRequest: ({ request, completion }) => {
        const buffer = aggregate.resumeEventBuffer ?? aggregate.threadStartEventBuffer;
        if (!buffer) return false;
        buffer.push({ type: "request", request, ...completion });
        return true;
      },
      takeResumeEventBuffer: () => {
        const buffered = aggregate.resumeEventBuffer;
        aggregate.resumeEventBuffer = null;
        return buffered;
      },
      takeThreadStartEventBuffer: () => {
        if (!aggregate.threadStartDeferred) return null;
        const buffered = aggregate.threadStartEventBuffer;
        aggregate.threadStartEventBuffer = null;
        aggregate.threadStartDeferred = false;
        return buffered;
      },
      markThreadStartReady: () => {
        aggregate.threadStartReady = true;
      },
      resetThreadStartReady: () => {
        aggregate.threadStartReady = false;
      },
      hasDeferredThreadStart: () => aggregate.threadStartDeferred,
      discardResumeEventBuffer: () => {
        const buffered = aggregate.resumeEventBuffer ?? [];
        aggregate.resumeEventBuffer = null;
        return buffered;
      },
      clearBufferedEvents: () => {
        const buffered = [
          ...(aggregate.resumeEventBuffer ?? []),
          ...(aggregate.threadStartEventBuffer ?? []),
        ];
        aggregate.resumeEventBuffer = null;
        aggregate.threadStartEventBuffer = null;
        aggregate.threadStartDeferred = false;
        aggregate.threadStartReady = false;
        return buffered;
      },
      commitFrameTextDeltas: ({ updates, observedAtMs, projectReplica }) => {
        const before = aggregate.canonicalState;
        if (!before || updates.length === 0) return [];
        const result = reduceCodexConversationFrameTextDeltas(before, updates, {
          now: () => observedAtMs,
        });
        aggregate.canonicalState = result.state;
        if (aggregate.snapshot && result.state !== before) {
          aggregate.snapshot = projectCodexConversationSnapshot({
            conversation: aggregate.snapshot,
            before,
            after: result.state,
            observedAtMs,
          });
        }
        if (projectReplica && aggregate.acceptedReplica && result.state !== before) {
          acceptReplica({
            conversation: projectCodexConversationSnapshot({
              conversation: aggregate.acceptedReplica.conversation,
              before,
              after: result.state,
              observedAtMs,
            }),
            ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
            revision: aggregate.revision + 1,
          });
        }
        return result.outcomes;
      },
      commitCommandOutputDeltas: ({ updates, observedAtMs, projectReplica }) => {
        const before = aggregate.canonicalState;
        if (!before || updates.length === 0) return [];
        let state = before;
        const dispositions: CodexCommandExecutionMutationDisposition[] = [];
        for (const update of updates) {
          const result = reduceCodexConversationCommandOutput(state, update);
          state = result.state;
          dispositions.push(result.disposition);
        }
        aggregate.canonicalState = state;
        if (aggregate.snapshot && state !== before) {
          aggregate.snapshot = projectCodexConversationSnapshot({
            conversation: aggregate.snapshot,
            before,
            after: state,
            observedAtMs,
          });
        }
        if (projectReplica && aggregate.acceptedReplica && state !== before) {
          acceptReplica({
            conversation: projectCodexConversationSnapshot({
              conversation: aggregate.acceptedReplica.conversation,
              before,
              after: state,
              observedAtMs,
            }),
            ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
            revision: aggregate.revision + 1,
          });
        }
        return dispositions;
      },
      readServerRequestState: () => {
        const canonicalState = aggregate.canonicalState;
        return {
          canonicalState,
          rawState: canonicalState
            ? {
                threadId,
                turns: canonicalState.turns.map((turn) => ({
                  turnId: turn.protocol.id,
                  status: turn.protocol.status,
                  hasError: turn.protocol.error !== null,
                  items: turn.items,
                  hookRuns: turn.sidecar.hookRuns,
                  turnStartedAtMs: turn.sidecar.turnStartedAtMs,
                })),
                requests: canonicalState.requests,
                hasUnreadTurn: canonicalState.sidecar.hasUnreadTurn,
              }
            : {
                threadId,
                turns: [],
                requests: aggregate.preHydrationServerRequests,
                hasUnreadTurn: aggregate.preHydrationHasUnreadTurn,
              },
          streamRole: aggregate.streamRole,
        };
      },
      commitServerRequestLifecycle: (input) => {
        const previousHasUnreadTurn =
          aggregate.canonicalState?.sidecar.hasUnreadTurn ?? aggregate.preHydrationHasUnreadTurn;
        if (!input.lifecycle.stateChanged) {
          return {
            stateChanged: false,
            unreadChanged: false,
            hasUnreadTurn: previousHasUnreadTurn,
          };
        }
        if (input.kind === "canonical") {
          aggregate.canonicalState = input.lifecycle.state;
          aggregate.preHydrationServerRequests = [];
          aggregate.preHydrationHasUnreadTurn = false;
          if (input.projectReplica && aggregate.acceptedReplica) {
            const conversation = projectCodexConversationServerRequestLifecycle({
              before: input.before,
              conversation: aggregate.acceptedReplica.conversation,
              lifecycle: input.lifecycle,
              observedAtMs: input.observedAtMs,
            });
            acceptReplica({
              conversation,
              ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
              revision: aggregate.revision + 1,
            });
          }
        } else {
          aggregate.preHydrationServerRequests = [...input.lifecycle.state.requests];
          aggregate.preHydrationHasUnreadTurn = input.lifecycle.state.hasUnreadTurn;
          if (input.projectReplica && aggregate.acceptedReplica) {
            const conversation = projectCodexConversationRawServerRequestLifecycle({
              conversation: aggregate.acceptedReplica.conversation,
              lifecycle: input.lifecycle,
            });
            acceptReplica({
              conversation,
              ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
              revision: aggregate.revision + 1,
            });
          }
        }
        const hasUnreadTurn =
          aggregate.canonicalState?.sidecar.hasUnreadTurn ?? aggregate.preHydrationHasUnreadTurn;
        return {
          stateChanged: true,
          unreadChanged: hasUnreadTurn !== previousHasUnreadTurn,
          hasUnreadTurn,
        };
      },
      completePlanImplementation: (turnId, projectReplica) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        const state = completeCodexCanonicalPlanImplementationState(before, turnId);
        if (state === before) return false;
        aggregate.canonicalState = state;
        if (projectReplica && aggregate.acceptedReplica) {
          const conversation = projectCodexConversationPlanImplementationCompleted({
            conversation: aggregate.acceptedReplica.conversation,
            state,
            turnId,
          });
          acceptReplica({
            conversation,
            ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
            revision: aggregate.revision + 1,
          });
        }
        return true;
      },
      readStreamRole: () => aggregate.streamRole,
      setStreamRole: (role) => {
        aggregate.streamRole = role;
      },
      acceptCanonicalState: (state) => {
        const before = aggregate.canonicalState;
        aggregate.canonicalState = state;
        aggregate.preHydrationServerRequests = [];
        aggregate.preHydrationHasUnreadTurn = false;
        if (aggregate.snapshot && before !== state) {
          aggregate.snapshot = projectCodexConversationSnapshot({
            conversation: aggregate.snapshot,
            before,
            after: state,
            observedAtMs: Date.now(),
          });
        }
        return state;
      },
      replaceServerRequests: (requests) => {
        if (!aggregate.canonicalState) {
          aggregate.preHydrationServerRequests = [...requests];
          return;
        }
        aggregate.canonicalState = {
          ...aggregate.canonicalState,
          requests: [...requests],
        };
        aggregate.preHydrationServerRequests = [];
      },
      incrementVersion: () => {
        aggregate.version += 1;
        return aggregate.version;
      },
      acceptReplica,
      advanceReplica: (input) => {
        const baseRevision = aggregate.revision;
        return {
          baseRevision,
          replica: acceptReplica({ ...input, revision: baseRevision + 1 }),
        };
      },
      clearReplica: () => {
        aggregate.acceptedReplica = null;
        aggregate.revision = 0;
        aggregate.checkpoint = null;
      },
      reset: () => resetAggregate(aggregate),
    };
  };

  const acquire = (threadId: string): CodexConversationAggregate => {
    const existing = capabilities.get(threadId);
    if (existing) return existing;
    const capability = makeCapability(threadId, ensureState(threadId));
    capabilities.set(threadId, capability);
    return capability;
  };

  return {
    current: (threadId) => capabilities.get(threadId) ?? null,
    acquire,
    releaseGeneration: (threadId, generation) => {
      const aggregate = aggregates.get(threadId);
      if (aggregate?.generation !== generation) return;
      aggregates.delete(threadId);
      capabilities.delete(threadId);
    },
    releaseAll: () => {
      aggregates.clear();
      capabilities.clear();
    },
  };
}
