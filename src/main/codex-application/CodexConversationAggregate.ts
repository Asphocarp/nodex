import type {
  CodexCanonicalConversationState,
  CodexCanonicalServerRequest,
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
  buildCodexThreadStreamCheckpoint,
  type CodexThreadStreamReplica,
} from "../../shared/codex-owner-follower-replication";
import {
  projectCodexConversationRawServerRequestLifecycle,
  projectCodexConversationPlanImplementationCompleted,
  projectCodexConversationServerRequestLifecycle,
} from "./CodexConversationServerRequestProjection";

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
}

export interface CodexConversationAggregate {
  readonly threadId: string;
  readonly generation: number;
  readonly read: () => CodexConversationAggregateSnapshot;
  readonly readCanonicalState: () => CodexCanonicalConversationState | null;
  readonly readServerRequests: () => readonly CodexCanonicalServerRequest[];
  readonly readServerRequestState: () => CodexConversationServerRequestState;
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
        aggregate.canonicalState = state;
        aggregate.preHydrationServerRequests = [];
        aggregate.preHydrationHasUnreadTurn = false;
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
