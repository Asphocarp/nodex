import type {
  CodexCanonicalConversationState,
  CodexCanonicalServerRequest,
  CodexConversationSnapshot,
  CodexThreadStreamCheckpoint,
} from "../../shared/types";
import {
  buildCodexThreadStreamCheckpoint,
  type CodexThreadStreamReplica,
} from "../../shared/codex-owner-follower-replication";

export interface CodexConversationAggregateSnapshot {
  readonly generation: number;
  readonly canonicalState: CodexCanonicalConversationState | null;
  readonly preHydrationServerRequests: readonly CodexCanonicalServerRequest[];
  readonly acceptedReplica: CodexThreadStreamReplica | null;
  readonly version: number;
  readonly revision: number;
  readonly checkpoint: CodexThreadStreamCheckpoint | null;
}

interface MutableCodexConversationAggregate {
  readonly generation: number;
  canonicalState: CodexCanonicalConversationState | null;
  preHydrationServerRequests: readonly CodexCanonicalServerRequest[];
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
      acceptCanonicalState: (state) => {
        aggregate.canonicalState = state;
        aggregate.preHydrationServerRequests = [];
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
