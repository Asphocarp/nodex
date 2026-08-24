import type {
  CodexCanonicalWorktreeInitItem,
  CodexCanonicalLiveTurnParams,
  CodexCanonicalHydratedPermissionContext,
  CodexCanonicalConversationState,
  CodexConversationThreadSettings,
  CodexThreadStatusType,
  CodexCanonicalServerRequest,
  CodexConversationTurnPagination,
  CodexConversationResumeState,
  CodexConversationSnapshot,
  CodexQueuedFollowUp,
  CodexThreadStreamCheckpoint,
} from "../../../shared/types";
import * as Data from "effect/Data";
import {
  appendCodexCanonicalWorktreeInitItem,
  appendCodexCanonicalInProgressSyntheticItem,
  removeCodexCanonicalLocalSyntheticItem,
  type CodexCanonicalContextCompactionItem,
  type CodexCanonicalSteeringUserMessageItem,
} from "../../../shared/codex-conversation-state/codex-conversation-state";
import type { ThreadGoal, Turn } from "@nodex/codex-app-server-protocol/v2";
import {
  CODEX_PENDING_MANUAL_CONTEXT_COMPACTION_ITEM_ID,
  reduceCodexConversationEventWithEffects,
  type CodexConversationReducerContext,
  type CodexConversationReducerEffect,
} from "../../../shared/codex-conversation-state/codex-conversation-reducer";
import {
  appendCodexCanonicalOptimisticTurn,
  bindCodexCanonicalOptimisticTurn,
  failCodexCanonicalOptimisticTurn,
} from "../../../shared/codex-conversation-state/codex-optimistic-turn";
import {
  removeCodexCanonicalSteeringItem,
  upsertCodexCanonicalSteeringItem,
} from "../../../shared/codex-conversation-state/codex-steering-state";
import {
  listCodexBackgroundTerminalTurnIds,
  reduceCodexBackgroundTerminalCleanup,
} from "../../../shared/codex-conversation-state/codex-background-terminal-cleanup";
import type {
  CodexServerRequestLifecycleResult,
  CodexServerRequestRawLifecycleResult,
  CodexServerRequestRawState,
} from "../../../shared/codex-conversation-state/codex-server-request-lifecycle";
import { completeCodexCanonicalPlanImplementationState } from "../../../shared/codex-conversation-state/codex-server-request-lifecycle";
import {
  reduceCodexConversationFrameTextDeltas,
  type CodexFrameTextDeltaOutcome,
} from "../../../shared/codex-conversation-state/codex-frame-text-delta";
import {
  buildCodexFrameTextDeltaKey,
  type CodexFrameTextDeltaUpdate,
} from "../../../shared/codex-conversation-state/codex-frame-text-delta-queue";
import {
  reduceCodexConversationCommandOutput,
  reduceCodexConversationTerminalCommands,
  type CodexCommandExecutionMutationDisposition,
  type CodexTerminalCommandUpdate,
} from "../../../shared/codex-conversation-state/codex-command-execution-stream";
import {
  appendCodexCommandOutputTail,
  buildCodexCommandOutputKey,
  type CodexCommandOutputUpdate,
} from "../../../shared/codex-conversation-state/codex-command-output-queue";
import {
  buildCodexThreadStreamCheckpoint,
  type CodexThreadStreamReplica,
} from "../../../shared/codex-owner-follower-replication";
import {
  reduceCodexConversationThreadGoalResumeConfirmationDismissed,
  reduceCodexConversationThreadGoalUpdated,
  reduceCodexConversationThreadName,
} from "../../../shared/codex-conversation-state/codex-thread-metadata";
import { appendCodexCanonicalThreadGoalTranscriptTurn } from "../../../shared/codex-conversation-state/codex-thread-goal-transcript";
import {
  projectCodexConversationRawServerRequestLifecycle,
  projectCodexConversationPlanImplementationCompleted,
  projectCodexConversationServerRequestLifecycle,
} from "../CodexConversationServerRequestProjection";
import { projectCodexConversationSnapshot } from "../CodexConversationSnapshotProjection";
import type { CodexServerNotification } from "../../codex-runtime/CodexApplicationProtocol";
import type { CodexApplicationProtocolOccurrence } from "../../codex-runtime/CodexApplicationRequestInbox";

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

export interface CodexConversationProtocolEventCommitResult {
  readonly effects: readonly CodexConversationReducerEffect[];
  readonly stateChanged: boolean;
}

export interface ConversationEntitySnapshot {
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

interface MutableConversationEntityState {
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
  resumeEventBuffer: CodexApplicationProtocolOccurrence[] | null;
  resumeEventBufferBytes: number;
  threadStartEventBuffer: CodexApplicationProtocolOccurrence[] | null;
  threadStartEventBufferBytes: number;
  threadStartDeferred: boolean;
  queuedFollowUps: readonly CodexQueuedFollowUp[];
  queuedFollowUpGeneration: number;
}

export interface CodexQueuedFollowUpClaim {
  readonly generation: number;
  readonly followUp: CodexQueuedFollowUp;
}

export type CodexProtocolOccurrenceAdmission = "buffered" | "unbuffered" | "overflow";

export class CodexConversationIngressOverflow extends Data.TaggedError(
  "CodexConversationIngressOverflow",
)<{
  readonly threadId: string;
  readonly maximumBytes: number;
  readonly maximumOccurrences: number;
}> {}

export const conversationIngressOverflow = (threadId: string) =>
  new CodexConversationIngressOverflow({
    threadId,
    maximumBytes: MAX_BUFFERED_PROTOCOL_BYTES,
    maximumOccurrences: MAX_BUFFERED_PROTOCOL_OCCURRENCES,
  });

export interface ConversationEntityState {
  readonly threadId: string;
  readonly generation: number;
  readonly read: () => ConversationEntitySnapshot;
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
  readonly offerProtocolOccurrence: (input: {
    readonly occurrence: CodexApplicationProtocolOccurrence;
    readonly bypassResume: boolean;
    readonly startsThread: boolean;
    readonly deferThreadStart: boolean;
  }) => CodexProtocolOccurrenceAdmission;
  readonly takeResumeEventBuffer: () => readonly CodexApplicationProtocolOccurrence[] | null;
  readonly takeThreadStartEventBuffer: () => readonly CodexApplicationProtocolOccurrence[] | null;
  readonly discardResumeEventBuffer: () => readonly CodexApplicationProtocolOccurrence[];
  readonly clearBufferedEvents: () => readonly CodexApplicationProtocolOccurrence[];
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
  readonly commitTerminalCommands: (input: {
    readonly update: CodexTerminalCommandUpdate;
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => CodexCommandExecutionMutationDisposition;
  readonly commitServerRequestLifecycle: (
    input: CodexConversationServerRequestLifecycleCommit & {
      readonly observedAtMs: number;
      readonly projectReplica: boolean;
    },
  ) => CodexConversationServerRequestCommitResult;
  /** Applies one transport-ordered notification to canonical state and accepted projections. */
  readonly commitProtocolNotification: (input: {
    readonly notification: CodexServerNotification;
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
    readonly createId: () => `${string}-${string}-${string}-${string}-${string}`;
    readonly reducerContext?: Pick<
      CodexConversationReducerContext,
      "consumeContextCompactionSource" | "resolveCollabReceiverThread"
    >;
  }) => CodexConversationProtocolEventCommitResult;
  readonly completePlanImplementation: (turnId: string, projectReplica: boolean) => boolean;
  /** Revision-fences and projects the goal observed after one completed Thread resume. */
  readonly commitPostResumeGoalHydration: (input: {
    readonly expectedRevision: number;
    readonly goal: ThreadGoal | null;
  }) => boolean;
  /** Admits one optimistic Main-owned turn into canonical state and every accepted projection. */
  readonly admitOptimisticTurn: (input: {
    readonly params: CodexCanonicalLiveTurnParams;
    readonly worktreeInit?: CodexCanonicalWorktreeInitItem;
    readonly currentCollaborationModel?: string;
    readonly startedAtMs: number;
    readonly projectReplica: boolean;
  }) => boolean;
  /** Binds an accepted app-server Turn to its exact optimistic client message. */
  readonly acceptOptimisticTurn: (input: {
    readonly clientUserMessageId: string;
    readonly turn: Turn;
    readonly recovery?: {
      readonly params: CodexCanonicalLiveTurnParams;
      readonly currentCollaborationModel?: string;
      readonly startedAtMs: number;
    };
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => boolean;
  /** Converts an unaccepted optimistic Turn into its canonical failed outcome. */
  readonly rejectOptimisticTurn: (input: {
    readonly clientUserMessageId: string;
    readonly failureItemId: `${string}-${string}-${string}-${string}-${string}`;
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => boolean;
  /** Admits a steering user message only when its exact target Turn exists. */
  readonly admitSteeringItem: (input: {
    readonly turnId: string;
    readonly item: CodexCanonicalSteeringUserMessageItem;
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => boolean;
  /** Removes one unaccepted steering message by its exact target and correlation id. */
  readonly rejectSteeringItem: (input: {
    readonly turnId: string;
    readonly itemId: string;
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => boolean;
  /** Returns the requested Turn when known, otherwise the latest in-progress Turn. */
  readonly resolveInterruptTurnId: (requestedTurnId?: string) => string | null;
  /** Commits the accepted local interrupt outcome for one exact in-progress Turn. */
  readonly interruptTurn: (input: {
    readonly turnId: string;
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => boolean;
  /** Derives the Turns which still own running background terminal rows. */
  readonly backgroundTerminalTurnIds: () => readonly string[] | null;
  /** Marks every running background terminal row interrupted across canonical projections. */
  readonly cleanBackgroundTerminals: (input: {
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => boolean;
  readonly applyTurnConfiguration: (input: {
    readonly settings: CodexConversationThreadSettings;
    readonly permissions: CodexCanonicalHydratedPermissionContext;
    readonly projectReplica: boolean;
  }) => boolean;
  readonly renameThread: (input: {
    readonly name: string;
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => boolean;
  readonly acceptThreadGoal: (input: {
    readonly goal: ThreadGoal;
    readonly appendTranscriptItem: boolean;
    readonly dismissResumeConfirmation: boolean;
    readonly projectReplica: boolean;
  }) => boolean;
  readonly admitManualCompaction: (input: {
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => string | null;
  readonly rollbackManualCompaction: (input: {
    readonly observedAtMs: number;
    readonly projectReplica: boolean;
  }) => boolean;
  readonly relocateExecution: (input: {
    readonly cwd: string;
    readonly managedWorktreePath: string | null;
    readonly projectId: string | null;
    readonly projectlessOutputDirectory: string | null;
    readonly projectlessWorkspaceBrowserRoot: string | null;
    readonly permissions: CodexCanonicalHydratedPermissionContext;
    readonly projectReplica: boolean;
  }) => boolean;
  readonly setThreadStatus: (statusType: CodexThreadStatusType, projectReplica: boolean) => boolean;
  readonly listQueuedFollowUps: () => readonly CodexQueuedFollowUp[];
  readonly appendQueuedFollowUp: (
    followUp: CodexQueuedFollowUp,
    projectReplica: boolean,
  ) => boolean;
  readonly removeQueuedFollowUp: (followUpId: string, projectReplica: boolean) => boolean;
  readonly reorderQueuedFollowUps: (
    orderedFollowUpIds: readonly string[],
    projectReplica: boolean,
  ) => boolean;
  readonly clearPausedQueuedFollowUps: (projectReplica: boolean) => boolean;
  readonly claimQueuedFollowUp: (
    followUpId: string | null,
    projectReplica: boolean,
  ) => CodexQueuedFollowUpClaim | null;
  readonly restoreQueuedFollowUp: (
    claim: CodexQueuedFollowUpClaim,
    reason: string,
    projectReplica: boolean,
  ) => boolean;
  readonly resetQueuedFollowUps: (projectReplica: boolean) => void;
  readonly clearQueuedFollowUps: () => void;
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

export interface ConversationEntityStateRegistry {
  /** Pure query: an unknown or released Thread never creates a new generation. */
  readonly current: (threadId: string) => ConversationEntityState | null;
  /** Binds a semantic aggregate generation to a caller or keyed runtime Scope. */
  readonly acquire: (threadId: string) => ConversationEntityState;
  /** Releases only the generation owned by the closing keyed runtime. */
  readonly releaseGeneration: (threadId: string, generation: number) => void;
  /** Releases every generation at the process Scope boundary. */
  readonly releaseAll: () => void;
  /** Marks every loaded generation non-live after the app-server connection is lost. */
  readonly markAllNeedsResume: () => void;
}

const pendingManualCompaction: CodexCanonicalContextCompactionItem = {
  type: "contextCompaction",
  id: CODEX_PENDING_MANUAL_CONTEXT_COMPACTION_ITEM_ID,
  completed: false,
  source: "manual",
};

const MAX_BUFFERED_PROTOCOL_OCCURRENCES = 1_024;
const MAX_BUFFERED_PROTOCOL_BYTES = 16 * 1024 * 1024;

const protocolOccurrenceBytes = (occurrence: CodexApplicationProtocolOccurrence): number => {
  try {
    return Buffer.byteLength(JSON.stringify(occurrence), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const initialAggregate = (generation: number): MutableConversationEntityState => ({
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
  resumeEventBufferBytes: 0,
  threadStartEventBuffer: null,
  threadStartEventBufferBytes: 0,
  threadStartDeferred: false,
  queuedFollowUps: [],
  queuedFollowUpGeneration: 0,
});

const snapshot = (
  aggregate: MutableConversationEntityState,
): ConversationEntitySnapshot => ({
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
 * Creates the private per-Thread canonical state owned by ConversationEntityMap.
 * Its interface exposes semantic state transitions rather than mutable records or generic reducers.
 */
export function makeConversationEntityStateRegistry(): ConversationEntityStateRegistry {
  const aggregates = new Map<string, MutableConversationEntityState>();
  const capabilities = new Map<string, ConversationEntityState>();
  let nextGeneration = 1;

  const ensureState = (threadId: string): MutableConversationEntityState => {
    const existing = aggregates.get(threadId);
    if (existing) return existing;
    const created = initialAggregate(nextGeneration++);
    aggregates.set(threadId, created);
    return created;
  };

  const resetAggregate = (aggregate: MutableConversationEntityState): void => {
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
    aggregate.resumeEventBufferBytes = 0;
    aggregate.threadStartEventBuffer = null;
    aggregate.threadStartEventBufferBytes = 0;
    aggregate.threadStartDeferred = false;
    aggregate.queuedFollowUps = [];
    aggregate.queuedFollowUpGeneration += 1;
  };

  const makeCapability = (
    threadId: string,
    aggregate: MutableConversationEntityState,
  ): ConversationEntityState => {
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
      aggregate.queuedFollowUps = [...input.conversation.queuedFollowUps];
      aggregate.revision = input.revision;
      aggregate.checkpoint = checkpoint;
      return replica;
    };

    const projectCanonicalState = (
      state: CodexCanonicalConversationState,
      observedAtMs: number,
      projectReplica: boolean,
    ): boolean => {
      const before = aggregate.canonicalState;
      if (!before || state === before) return false;
      aggregate.canonicalState = state;
      if (aggregate.snapshot) {
        aggregate.snapshot = projectCodexConversationSnapshot({
          conversation: aggregate.snapshot,
          before,
          after: state,
          observedAtMs,
        });
      }
      if (projectReplica && aggregate.acceptedReplica) {
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
      return true;
    };

    const projectQueuedFollowUps = (
      entries: readonly CodexQueuedFollowUp[],
      projectReplica: boolean,
    ): boolean => {
      const previous = aggregate.queuedFollowUps;
      if (
        previous.length === entries.length &&
        previous.every((entry, index) => entry === entries[index])
      ) {
        return false;
      }
      aggregate.queuedFollowUps = [...entries];
      if (aggregate.snapshot) {
        aggregate.snapshot = { ...aggregate.snapshot, queuedFollowUps: [...entries] };
      }
      if (projectReplica && aggregate.acceptedReplica) {
        acceptReplica({
          conversation: {
            ...aggregate.acceptedReplica.conversation,
            queuedFollowUps: [...entries],
          },
          ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
          revision: aggregate.revision + 1,
        });
      }
      return true;
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
        if (aggregate.queuedFollowUpGeneration === 0 && aggregate.queuedFollowUps.length === 0) {
          aggregate.queuedFollowUps = [...conversation.queuedFollowUps];
        }
        aggregate.snapshot = {
          ...conversation,
          queuedFollowUps: [...aggregate.queuedFollowUps],
        };
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
        aggregate.resumeEventBufferBytes = 0;
        return true;
      },
      hasResumeEventBuffer: () => aggregate.resumeEventBuffer !== null,
      offerProtocolOccurrence: ({ occurrence, bypassResume, startsThread, deferThreadStart }) => {
        const bytes = protocolOccurrenceBytes(occurrence);
        if (!bypassResume && aggregate.resumeEventBuffer !== null) {
          if (
            aggregate.resumeEventBuffer.length >= MAX_BUFFERED_PROTOCOL_OCCURRENCES ||
            aggregate.resumeEventBufferBytes + bytes > MAX_BUFFERED_PROTOCOL_BYTES
          ) {
            return "overflow";
          }
          aggregate.resumeEventBuffer.push(occurrence);
          aggregate.resumeEventBufferBytes += bytes;
          return "buffered";
        }
        if (aggregate.threadStartEventBuffer !== null) {
          if (
            aggregate.threadStartEventBuffer.length >= MAX_BUFFERED_PROTOCOL_OCCURRENCES ||
            aggregate.threadStartEventBufferBytes + bytes > MAX_BUFFERED_PROTOCOL_BYTES
          ) {
            return "overflow";
          }
          aggregate.threadStartEventBuffer.push(occurrence);
          aggregate.threadStartEventBufferBytes += bytes;
          return "buffered";
        }
        if (!startsThread || !deferThreadStart) return "unbuffered";
        if (bytes > MAX_BUFFERED_PROTOCOL_BYTES) return "overflow";
        aggregate.threadStartDeferred = true;
        aggregate.threadStartEventBuffer = [occurrence];
        aggregate.threadStartEventBufferBytes = bytes;
        return "buffered";
      },
      takeResumeEventBuffer: () => {
        const buffered = aggregate.resumeEventBuffer;
        aggregate.resumeEventBuffer = null;
        aggregate.resumeEventBufferBytes = 0;
        return buffered;
      },
      takeThreadStartEventBuffer: () => {
        if (!aggregate.threadStartDeferred) return null;
        const buffered = aggregate.threadStartEventBuffer;
        aggregate.threadStartEventBuffer = null;
        aggregate.threadStartEventBufferBytes = 0;
        aggregate.threadStartDeferred = false;
        return buffered;
      },
      discardResumeEventBuffer: () => {
        const buffered = aggregate.resumeEventBuffer ?? [];
        aggregate.resumeEventBuffer = null;
        aggregate.resumeEventBufferBytes = 0;
        return buffered;
      },
      clearBufferedEvents: () => {
        const buffered = [
          ...(aggregate.resumeEventBuffer ?? []),
          ...(aggregate.threadStartEventBuffer ?? []),
        ];
        aggregate.resumeEventBuffer = null;
        aggregate.resumeEventBufferBytes = 0;
        aggregate.threadStartEventBuffer = null;
        aggregate.threadStartEventBufferBytes = 0;
        aggregate.threadStartDeferred = false;
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
      commitTerminalCommands: ({ update, observedAtMs, projectReplica }) => {
        const before = aggregate.canonicalState;
        if (!before) return "noTurns";
        const result = reduceCodexConversationTerminalCommands(before, update);
        if (!result.stateChanged) return result.disposition;
        aggregate.canonicalState = result.state;
        if (aggregate.snapshot) {
          aggregate.snapshot = projectCodexConversationSnapshot({
            conversation: aggregate.snapshot,
            before,
            after: result.state,
            observedAtMs,
          });
        }
        if (projectReplica && aggregate.acceptedReplica) {
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
        return result.disposition;
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
      commitProtocolNotification: ({
        notification,
        observedAtMs,
        projectReplica,
        createId,
        reducerContext,
      }) => {
        const before = aggregate.canonicalState;
        if (!before) return { effects: [], stateChanged: false };
        const reduced = reduceCodexConversationEventWithEffects(
          before,
          { type: "notification", notification },
          { now: () => observedAtMs, createId, ...reducerContext },
        );
        return {
          effects: reduced.effects,
          stateChanged: projectCanonicalState(reduced.state, observedAtMs, projectReplica),
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
      commitPostResumeGoalHydration: ({ expectedRevision, goal }) => {
        if (aggregate.revision !== expectedRevision) return false;

        const project = (conversation: CodexConversationSnapshot): CodexConversationSnapshot => ({
          ...conversation,
          threadGoal: goal,
          completedThreadGoal: goal?.status === "complete" ? goal : null,
          threadGoalResumeConfirmation: null,
        });
        if (aggregate.canonicalState) {
          aggregate.canonicalState = {
            ...aggregate.canonicalState,
            sidecar: {
              ...aggregate.canonicalState.sidecar,
              threadGoal: goal,
              completedThreadGoal: goal?.status === "complete" ? goal : null,
              threadGoalResumeConfirmation: null,
            },
          };
        }
        if (aggregate.snapshot) {
          aggregate.snapshot = {
            ...project(aggregate.snapshot),
            canonicalState: aggregate.canonicalState,
          };
        }
        if (aggregate.acceptedReplica) {
          acceptReplica({
            conversation: {
              ...project(aggregate.acceptedReplica.conversation),
              canonicalState: aggregate.canonicalState,
            },
            ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
            revision: aggregate.revision,
          });
        }
        return true;
      },
      admitOptimisticTurn: ({
        params,
        worktreeInit,
        currentCollaborationModel,
        startedAtMs,
        projectReplica,
      }) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        const optimistic = appendCodexCanonicalOptimisticTurn(before, {
          params,
          ...(currentCollaborationModel ? { currentCollaborationModel } : {}),
          startedAtMs,
        });
        const after = worktreeInit
          ? appendCodexCanonicalWorktreeInitItem(optimistic, worktreeInit)
          : optimistic;
        const changed = projectCanonicalState(after, startedAtMs, projectReplica);
        if (changed) aggregate.isStreaming = true;
        return changed;
      },
      acceptOptimisticTurn: ({
        clientUserMessageId,
        turn,
        recovery,
        observedAtMs,
        projectReplica,
      }) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        if (before.turns.some((candidate) => candidate.protocol.id === turn.id)) return true;
        const hasOptimisticTurn = before.turns.some(
          (candidate) => candidate.sidecar.params.clientUserMessageId === clientUserMessageId,
        );
        const admitted =
          !hasOptimisticTurn && recovery
            ? appendCodexCanonicalOptimisticTurn(before, {
                params: recovery.params,
                ...(recovery.currentCollaborationModel
                  ? { currentCollaborationModel: recovery.currentCollaborationModel }
                  : {}),
                startedAtMs: recovery.startedAtMs,
              })
            : before;
        const accepted = bindCodexCanonicalOptimisticTurn(admitted, clientUserMessageId, turn);
        if (!accepted.turns.some((candidate) => candidate.protocol.id === turn.id)) return false;
        projectCanonicalState(accepted, observedAtMs, projectReplica);
        return true;
      },
      rejectOptimisticTurn: ({
        clientUserMessageId,
        failureItemId,
        observedAtMs,
        projectReplica,
      }) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        return projectCanonicalState(
          failCodexCanonicalOptimisticTurn(before, clientUserMessageId, failureItemId),
          observedAtMs,
          projectReplica,
        );
      },
      admitSteeringItem: ({ turnId, item, observedAtMs, projectReplica }) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        return projectCanonicalState(
          upsertCodexCanonicalSteeringItem(before, turnId, item),
          observedAtMs,
          projectReplica,
        );
      },
      rejectSteeringItem: ({ turnId, itemId, observedAtMs, projectReplica }) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        return projectCanonicalState(
          removeCodexCanonicalSteeringItem(before, turnId, itemId),
          observedAtMs,
          projectReplica,
        );
      },
      resolveInterruptTurnId: (requestedTurnId) => {
        const turns = aggregate.canonicalState?.turns ?? [];
        if (requestedTurnId && turns.some((turn) => turn.protocol.id === requestedTurnId)) {
          return requestedTurnId;
        }
        return (
          turns.findLast(
            (turn) => turn.protocol.status === "inProgress" && turn.protocol.id !== null,
          )?.protocol.id ?? null
        );
      },
      interruptTurn: ({ turnId, observedAtMs, projectReplica }) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        const turnIndex = before.turns.findIndex((turn) => turn.protocol.id === turnId);
        const turn = before.turns[turnIndex];
        if (!turn || turn.protocol.status !== "inProgress") return false;
        const interruptedCommandExecutionItemIds = [
          ...new Set([
            ...(turn.sidecar.interruptedCommandExecutionItemIds ?? []),
            ...turn.items.flatMap((item) =>
              item.type === "commandExecution" && item.status === "inProgress" ? [item.id] : [],
            ),
          ]),
        ];
        const turns = [...before.turns];
        turns[turnIndex] = {
          ...turn,
          protocol: { ...turn.protocol, status: "interrupted" },
          sidecar: { ...turn.sidecar, interruptedCommandExecutionItemIds },
        };
        return projectCanonicalState({ ...before, turns }, observedAtMs, projectReplica);
      },
      backgroundTerminalTurnIds: () => {
        const conversation = aggregate.canonicalState;
        if (!conversation) return null;
        return listCodexBackgroundTerminalTurnIds(conversation);
      },
      cleanBackgroundTerminals: ({ observedAtMs, projectReplica }) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        return projectCanonicalState(
          reduceCodexBackgroundTerminalCleanup(before),
          observedAtMs,
          projectReplica,
        );
      },
      applyTurnConfiguration: ({ settings, permissions, projectReplica }) => {
        const before = aggregate.canonicalState;
        const hydration = before?.sidecar.hydrationContext;
        if (!before || !hydration) return false;
        const canonical = {
          ...before,
          sidecar: {
            ...before.sidecar,
            hydrationContext: {
              ...hydration,
              latestModel: settings.model ?? hydration.latestModel,
              latestReasoningEffort: settings.reasoningEffort,
              latestThreadSettings: {
                ...(hydration.latestThreadSettings ?? {}),
                model: settings.model ?? hydration.latestModel,
                serviceTier: settings.serviceTier ?? null,
                effort: settings.reasoningEffort,
                summary: settings.summary ?? null,
                personality: settings.personality,
                collaborationMode: settings.collaborationMode,
              },
              currentPermissions: permissions,
            },
          },
        };
        aggregate.canonicalState = canonical;
        const project = (conversation: CodexConversationSnapshot): CodexConversationSnapshot => ({
          ...conversation,
          latestCollaborationMode: settings.collaborationMode ?? undefined,
          latestThreadSettings: settings,
          approvalPolicy: permissions.approvalPolicy,
          approvalsReviewer: permissions.approvalsReviewer,
          sandbox: permissions.sandboxPolicy,
          canonicalState: canonical,
        });
        if (aggregate.snapshot) aggregate.snapshot = project(aggregate.snapshot);
        if (projectReplica && aggregate.acceptedReplica) {
          acceptReplica({
            conversation: project(aggregate.acceptedReplica.conversation),
            ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
            revision: aggregate.revision + 1,
          });
        }
        return true;
      },
      renameThread: ({ name, observedAtMs, projectReplica }) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        return projectCanonicalState(
          reduceCodexConversationThreadName(before, threadId, name),
          observedAtMs,
          projectReplica,
        );
      },
      acceptThreadGoal: ({
        goal,
        appendTranscriptItem,
        dismissResumeConfirmation,
        projectReplica,
      }) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        const updated = reduceCodexConversationThreadGoalUpdated(before, threadId, goal).state;
        const dismissed = dismissResumeConfirmation
          ? reduceCodexConversationThreadGoalResumeConfirmationDismissed(updated, threadId)
          : updated;
        const after = appendTranscriptItem
          ? appendCodexCanonicalThreadGoalTranscriptTurn(dismissed, goal)
          : dismissed;
        return projectCanonicalState(after, goal.updatedAt * 1_000, projectReplica);
      },
      admitManualCompaction: ({ observedAtMs, projectReplica }) => {
        const before = aggregate.canonicalState;
        if (!before) return null;
        const after = appendCodexCanonicalInProgressSyntheticItem(
          before,
          pendingManualCompaction,
          observedAtMs,
        );
        projectCanonicalState(after, observedAtMs, projectReplica);
        const turnIndex = after.turns.findLastIndex((turn) =>
          turn.items.some((item) => item.id === pendingManualCompaction.id),
        );
        return after.turns[turnIndex]?.protocol.id ?? null;
      },
      rollbackManualCompaction: ({ observedAtMs, projectReplica }) => {
        const before = aggregate.canonicalState;
        if (!before) return false;
        return projectCanonicalState(
          removeCodexCanonicalLocalSyntheticItem(before, pendingManualCompaction.id),
          observedAtMs,
          projectReplica,
        );
      },
      relocateExecution: ({
        cwd,
        managedWorktreePath,
        projectId,
        projectlessOutputDirectory,
        projectlessWorkspaceBrowserRoot,
        permissions,
        projectReplica,
      }) => {
        const before = aggregate.canonicalState;
        const hydration = before?.sidecar.hydrationContext;
        if (!before || !hydration) return false;
        const canonical = {
          ...before,
          sidecar: {
            ...before.sidecar,
            hydrationContext: {
              ...hydration,
              cwd,
              latestThreadSettings: {
                ...(hydration.latestThreadSettings ?? {}),
                cwd,
              },
              currentPermissions: permissions,
            },
          },
        };
        aggregate.canonicalState = canonical;
        const project = (conversation: CodexConversationSnapshot): CodexConversationSnapshot => ({
          ...conversation,
          projectId,
          cwd,
          managedWorktreePath,
          projectlessOutputDirectory,
          projectlessWorkspaceBrowserRoot,
          approvalPolicy: permissions.approvalPolicy,
          approvalsReviewer: permissions.approvalsReviewer,
          sandbox: permissions.sandboxPolicy,
          canonicalState: canonical,
        });
        if (aggregate.snapshot) aggregate.snapshot = project(aggregate.snapshot);
        if (projectReplica && aggregate.acceptedReplica) {
          acceptReplica({
            conversation: project(aggregate.acceptedReplica.conversation),
            ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
            revision: aggregate.revision + 1,
          });
        }
        return true;
      },
      setThreadStatus: (statusType, projectReplica) => {
        const beforeStatus = aggregate.canonicalState?.protocol.status.type ?? null;
        if (aggregate.canonicalState && beforeStatus !== statusType) {
          aggregate.canonicalState = {
            ...aggregate.canonicalState,
            protocol: {
              ...aggregate.canonicalState.protocol,
              status: { type: statusType, activeFlags: [] },
            },
          };
        }
        const snapshotChanged = aggregate.snapshot?.statusType !== statusType;
        if (aggregate.snapshot && snapshotChanged) {
          aggregate.snapshot = {
            ...aggregate.snapshot,
            statusType,
            statusActiveFlags: [],
            canonicalState: aggregate.canonicalState,
          };
        }
        const replicaChanged = aggregate.acceptedReplica?.conversation.statusType !== statusType;
        if (projectReplica && aggregate.acceptedReplica && replicaChanged) {
          acceptReplica({
            conversation: {
              ...aggregate.acceptedReplica.conversation,
              statusType,
              statusActiveFlags: [],
              canonicalState: aggregate.canonicalState,
            },
            ownerEpoch: aggregate.acceptedReplica.checkpoint.ownerEpoch,
            revision: aggregate.revision + 1,
          });
        }
        return beforeStatus !== statusType || snapshotChanged || (projectReplica && replicaChanged);
      },
      listQueuedFollowUps: () => [...aggregate.queuedFollowUps],
      appendQueuedFollowUp: (followUp, projectReplica) =>
        projectQueuedFollowUps(
          [
            ...aggregate.queuedFollowUps.filter(
              (entry) => entry.followUpId !== followUp.followUpId,
            ),
            followUp,
          ],
          projectReplica,
        ),
      removeQueuedFollowUp: (followUpId, projectReplica) =>
        projectQueuedFollowUps(
          aggregate.queuedFollowUps.filter((entry) => entry.followUpId !== followUpId),
          projectReplica,
        ),
      reorderQueuedFollowUps: (orderedFollowUpIds, projectReplica) => {
        if (aggregate.queuedFollowUps.length <= 1) return false;
        const byId = new Map(
          aggregate.queuedFollowUps.map((entry) => [entry.followUpId, entry] as const),
        );
        const seen = new Set<string>();
        const ordered: CodexQueuedFollowUp[] = [];
        for (const rawId of orderedFollowUpIds) {
          const followUpId = rawId.trim();
          const entry = byId.get(followUpId);
          if (!entry || seen.has(followUpId)) continue;
          seen.add(followUpId);
          ordered.push(entry);
        }
        return projectQueuedFollowUps(
          [...ordered, ...aggregate.queuedFollowUps.filter((entry) => !seen.has(entry.followUpId))],
          projectReplica,
        );
      },
      clearPausedQueuedFollowUps: (projectReplica) =>
        projectQueuedFollowUps(
          aggregate.queuedFollowUps.map((entry) =>
            entry.pausedReason ? { ...entry, pausedReason: null } : entry,
          ),
          projectReplica,
        ),
      claimQueuedFollowUp: (followUpId, projectReplica) => {
        const index = followUpId
          ? aggregate.queuedFollowUps.findIndex((entry) => entry.followUpId === followUpId)
          : 0;
        const followUp = aggregate.queuedFollowUps[index];
        if (!followUp) return null;
        projectQueuedFollowUps(
          aggregate.queuedFollowUps.filter((_, entryIndex) => entryIndex !== index),
          projectReplica,
        );
        return { generation: aggregate.queuedFollowUpGeneration, followUp };
      },
      restoreQueuedFollowUp: (claim, reason, projectReplica) => {
        if (claim.generation !== aggregate.queuedFollowUpGeneration) return false;
        return projectQueuedFollowUps(
          [
            { ...claim.followUp, pausedReason: reason },
            ...aggregate.queuedFollowUps.filter(
              (entry) => entry.followUpId !== claim.followUp.followUpId,
            ),
          ],
          projectReplica,
        );
      },
      resetQueuedFollowUps: (projectReplica) => {
        projectQueuedFollowUps([], projectReplica);
      },
      clearQueuedFollowUps: () => {
        aggregate.queuedFollowUpGeneration += 1;
        aggregate.queuedFollowUps = [];
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

  const acquire = (threadId: string): ConversationEntityState => {
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
    markAllNeedsResume: () => {
      for (const conversation of capabilities.values()) {
        conversation.setResumeState("needs_resume");
        conversation.setStreamRole(null);
        conversation.setStreaming(false);
      }
    },
  };
}
