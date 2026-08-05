export const CODEX_THREAD_STREAM_FOLLOWER_RECONNECT_GRACE_MS = 5_000;

export interface CodexThreadStreamSubscriptionStateOptions {
  now?: () => number;
  reconnectGraceMs?: number;
}

export interface CodexThreadStreamFollowingStatusRequest {
  type: "request-following-status";
  conversationId: string;
  ownerClientId: string;
}

export interface CodexThreadStreamFollowersChanged {
  type: "followers-changed";
  conversationId: string;
  ownerClientId: string;
  followerClientIds: readonly string[];
  targetClientIds: readonly string[];
  membershipEpoch: number;
}

export interface CodexThreadStreamTransportReset {
  type: "transport-reset";
  conversationIds: readonly string[];
  targetClientIds: readonly string[];
}

export type CodexThreadStreamSubscriptionAction =
  | CodexThreadStreamFollowingStatusRequest
  | CodexThreadStreamFollowersChanged
  | CodexThreadStreamTransportReset;

interface ConversationSubscriptionState {
  ownerClientId: string | null;
  ownerEpoch: number;
  followedClientIds: Set<string>;
  connectedClientIds: Set<string>;
  snapshotPendingClientIds: Set<string>;
  membershipEpoch: number;
  followerReconnectDeadlineMs: number | null;
  ownerDetachedAtMs: number | null;
}

export interface CodexThreadStreamFollowingResult {
  changed: boolean;
  shouldSendSnapshot: boolean;
  actions: readonly CodexThreadStreamSubscriptionAction[];
}

export interface CodexThreadStreamOwnerResult {
  changed: boolean;
  snapshotClientIds: readonly string[];
  actions: readonly CodexThreadStreamSubscriptionAction[];
}

export interface CodexThreadStreamClientDisposedResult {
  ownerConversationIds: readonly string[];
  followerConversationIds: readonly string[];
  actions: readonly CodexThreadStreamSubscriptionAction[];
}

function normalizeId(value: string): string {
  return value.trim();
}

function sortIds(ids: Iterable<string>): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export class CodexThreadStreamSubscriptionState {
  private readonly conversations = new Map<string, ConversationSubscriptionState>();
  private readonly connectedClientIds = new Set<string>();
  private readonly now: () => number;
  private readonly reconnectGraceMs: number;

  constructor(options: CodexThreadStreamSubscriptionStateOptions = {}) {
    this.now = options.now ?? Date.now;
    this.reconnectGraceMs = options.reconnectGraceMs
      ?? CODEX_THREAD_STREAM_FOLLOWER_RECONNECT_GRACE_MS;
  }

  setOwner(conversationId: string, ownerClientId: string): CodexThreadStreamOwnerResult {
    const normalizedConversationId = normalizeId(conversationId);
    const normalizedOwnerClientId = normalizeId(ownerClientId);
    if (!normalizedConversationId || !normalizedOwnerClientId) {
      return { changed: false, snapshotClientIds: [], actions: [] };
    }

    const state = this.getOrCreate(normalizedConversationId);
    const changed = state.ownerClientId !== normalizedOwnerClientId;
    state.ownerClientId = normalizedOwnerClientId;
    if (changed) state.ownerEpoch += 1;
    if (state.followedClientIds.delete(normalizedOwnerClientId)) {
      state.snapshotPendingClientIds.delete(normalizedOwnerClientId);
      state.membershipEpoch += 1;
    }
    if (changed) {
      for (const followerClientId of state.followedClientIds) {
        state.snapshotPendingClientIds.add(followerClientId);
      }
    }
    state.followerReconnectDeadlineMs = null;
    state.ownerDetachedAtMs = null;
    if (!changed) return { changed: false, snapshotClientIds: [], actions: [] };

    return {
      changed: true,
      snapshotClientIds: this.resolveSnapshotClientIds(state),
      actions: this.buildOwnerActions(normalizedConversationId, state),
    };
  }

  clearOwner(conversationId: string, ownerClientId?: string | null): void {
    const normalizedConversationId = normalizeId(conversationId);
    const state = this.conversations.get(normalizedConversationId);
    if (!state) return;
    if (ownerClientId && state.ownerClientId !== normalizeId(ownerClientId)) return;

    state.ownerClientId = null;
    state.ownerDetachedAtMs = this.now();
    for (const followerClientId of state.followedClientIds) {
      state.snapshotPendingClientIds.add(followerClientId);
    }
    this.removeIfEmpty(normalizedConversationId, state);
  }

  setFollowing(
    conversationId: string,
    clientId: string,
    following: boolean,
    options: { forceSnapshot?: boolean } = {},
  ): CodexThreadStreamFollowingResult {
    const normalizedConversationId = normalizeId(conversationId);
    const normalizedClientId = normalizeId(clientId);
    if (!normalizedConversationId || !normalizedClientId) {
      return { changed: false, shouldSendSnapshot: false, actions: [] };
    }

    const state = this.getOrCreate(normalizedConversationId);
    const wasFollowing = state.followedClientIds.has(normalizedClientId);
    if (following === wasFollowing) {
      return {
        changed: false,
        shouldSendSnapshot: following
          && (options.forceSnapshot === true || state.snapshotPendingClientIds.has(normalizedClientId))
          && state.ownerClientId !== normalizedClientId
          && state.connectedClientIds.has(normalizedClientId),
        actions: [],
      };
    }

    if (following) {
      state.followedClientIds.add(normalizedClientId);
      if (state.ownerClientId !== normalizedClientId) {
        state.snapshotPendingClientIds.add(normalizedClientId);
      }
      state.followerReconnectDeadlineMs = null;
    } else {
      state.followedClientIds.delete(normalizedClientId);
      state.snapshotPendingClientIds.delete(normalizedClientId);
      state.followerReconnectDeadlineMs = null;
    }
    state.membershipEpoch += 1;
    if (!following) this.removeIfEmpty(normalizedConversationId, state);

    return {
      changed: true,
      shouldSendSnapshot: following
        && state.ownerClientId !== normalizedClientId
        && state.connectedClientIds.has(normalizedClientId)
        && state.snapshotPendingClientIds.has(normalizedClientId),
      actions: this.buildFollowerActions(normalizedConversationId, state),
    };
  }

  markSnapshotDelivered(
    conversationId: string,
    clientId: string,
  ): readonly CodexThreadStreamSubscriptionAction[] {
    const normalizedConversationId = normalizeId(conversationId);
    const normalizedClientId = normalizeId(clientId);
    const state = this.conversations.get(normalizedConversationId);
    if (!state || !state.followedClientIds.has(normalizedClientId)) return [];
    if (state.ownerClientId === normalizedClientId) return [];
    if (!state.connectedClientIds.has(normalizedClientId)) return [];
    if (!state.snapshotPendingClientIds.delete(normalizedClientId)) return [];
    return this.buildFollowerActions(normalizedConversationId, state);
  }

  handleClientConnected(clientId: string): readonly CodexThreadStreamSubscriptionAction[] {
    const normalizedClientId = normalizeId(clientId);
    if (!normalizedClientId) return [];
    this.connectedClientIds.add(normalizedClientId);

    const actions: CodexThreadStreamSubscriptionAction[] = [];
    for (const [conversationId, state] of this.conversations) {
      state.connectedClientIds.add(normalizedClientId);
      if (!state.ownerClientId || state.ownerClientId === normalizedClientId) continue;
      actions.push({
        type: "request-following-status",
        conversationId,
        ownerClientId: state.ownerClientId,
      });
    }
    return actions;
  }

  handleClientDisposed(clientId: string): CodexThreadStreamClientDisposedResult {
    const normalizedClientId = normalizeId(clientId);
    if (!normalizedClientId) {
      return { ownerConversationIds: [], followerConversationIds: [], actions: [] };
    }
    this.connectedClientIds.delete(normalizedClientId);

    const ownerConversationIds: string[] = [];
    const followerConversationIds: string[] = [];
    const actions: CodexThreadStreamSubscriptionAction[] = [];
    for (const [conversationId, state] of this.conversations) {
      state.connectedClientIds.delete(normalizedClientId);
      const wasOwner = state.ownerClientId === normalizedClientId;
      const wasFollower = state.followedClientIds.delete(normalizedClientId);
      state.snapshotPendingClientIds.delete(normalizedClientId);
      if (wasOwner) {
        ownerConversationIds.push(conversationId);
        const targetClientIds = this.resolveFollowerClientIds(state);
        state.ownerClientId = null;
        state.ownerDetachedAtMs = this.now();
        if (targetClientIds.length > 0) {
          actions.push({
            type: "transport-reset",
            conversationIds: [conversationId],
            targetClientIds,
          });
        }
      }
      if (wasFollower) {
        followerConversationIds.push(conversationId);
        state.membershipEpoch += 1;
        state.followerReconnectDeadlineMs = this.now() + this.reconnectGraceMs;
        if (state.ownerClientId) {
          actions.push(...this.buildFollowerActions(conversationId, state));
        }
      }
      this.removeIfEmpty(conversationId, state);
    }

    return {
      ownerConversationIds: sortIds(ownerConversationIds),
      followerConversationIds: sortIds(followerConversationIds),
      actions,
    };
  }

  getOwnerClientId(conversationId: string): string | null {
    return this.conversations.get(normalizeId(conversationId))?.ownerClientId ?? null;
  }

  getFollowerClientIds(conversationId: string): readonly string[] | null {
    const state = this.conversations.get(normalizeId(conversationId));
    if (!state) return null;
    return this.resolveFollowerClientIds(state);
  }

  getSnapshotClientIds(conversationId: string): readonly string[] {
    const state = this.conversations.get(normalizeId(conversationId));
    if (!state) return [];
    return this.resolveSnapshotClientIds(state);
  }

  isClientConnected(clientId: string): boolean {
    const normalizedClientId = normalizeId(clientId);
    return normalizedClientId.length > 0 && this.connectedClientIds.has(normalizedClientId);
  }

  handleIpcConnectionReset(
    clientId: string,
  ): readonly CodexThreadStreamSubscriptionAction[] {
    const normalizedClientId = normalizeId(clientId);
    if (!normalizedClientId) return [];
    this.connectedClientIds.delete(normalizedClientId);

    const actions: CodexThreadStreamSubscriptionAction[] = [];
    for (const [conversationId, state] of this.conversations) {
      if (!state.connectedClientIds.delete(normalizedClientId)) continue;
      if (state.ownerClientId === normalizedClientId) {
        state.ownerClientId = null;
        state.ownerDetachedAtMs = this.now();
        for (const followerClientId of state.followedClientIds) {
          state.snapshotPendingClientIds.add(followerClientId);
        }
        actions.push({
          type: "transport-reset",
          conversationIds: [conversationId],
          targetClientIds: this.resolveFollowerClientIds(state),
        });
        continue;
      }
      if (!state.followedClientIds.has(normalizedClientId)) continue;
      state.snapshotPendingClientIds.add(normalizedClientId);
      state.followerReconnectDeadlineMs = this.now() + this.reconnectGraceMs;
      state.membershipEpoch += 1;
      actions.push(...this.buildFollowerActions(conversationId, state));
    }
    return actions;
  }

  getFollowedConversationIds(clientId: string): readonly string[] {
    const normalizedClientId = normalizeId(clientId);
    return sortIds(
      [...this.conversations.entries()]
        .filter(([, state]) => state.followedClientIds.has(normalizedClientId))
        .map(([conversationId]) => conversationId),
    );
  }

  clearConversation(conversationId: string): void {
    this.conversations.delete(normalizeId(conversationId));
  }

  getMembershipEpoch(conversationId: string): number | null {
    return this.conversations.get(normalizeId(conversationId))?.membershipEpoch ?? null;
  }

  getOwnerEpoch(conversationId: string): number | null {
    return this.conversations.get(normalizeId(conversationId))?.ownerEpoch ?? null;
  }

  hasFollowersOrPendingReconnect(conversationId: string): boolean {
    const state = this.conversations.get(normalizeId(conversationId));
    if (!state) return false;
    if (state.followedClientIds.size > 0) return true;
    const deadline = state.followerReconnectDeadlineMs;
    if (deadline !== null && deadline > this.now()) return true;
    return state.ownerDetachedAtMs !== null
      && state.ownerDetachedAtMs + this.reconnectGraceMs > this.now();
  }

  reset(): void {
    this.conversations.clear();
    this.connectedClientIds.clear();
  }

  private getOrCreate(conversationId: string): ConversationSubscriptionState {
    const existing = this.conversations.get(conversationId);
    if (existing) return existing;

    const state: ConversationSubscriptionState = {
      ownerClientId: null,
      ownerEpoch: 0,
      followedClientIds: new Set(),
      connectedClientIds: new Set(this.connectedClientIds),
      snapshotPendingClientIds: new Set(),
      membershipEpoch: 0,
      followerReconnectDeadlineMs: null,
      ownerDetachedAtMs: null,
    };
    this.conversations.set(conversationId, state);
    return state;
  }

  private resolveFollowerClientIds(state: ConversationSubscriptionState): string[] {
    return sortIds(
      [...state.followedClientIds].filter((clientId) =>
        clientId !== state.ownerClientId
        && state.connectedClientIds.has(clientId)
        && !state.snapshotPendingClientIds.has(clientId),
      ),
    );
  }

  private resolveSnapshotClientIds(state: ConversationSubscriptionState): string[] {
    return sortIds(
      [...state.snapshotPendingClientIds].filter((clientId) =>
        clientId !== state.ownerClientId
        && state.followedClientIds.has(clientId)
        && state.connectedClientIds.has(clientId),
      ),
    );
  }

  private buildOwnerActions(
    conversationId: string,
    state: ConversationSubscriptionState,
  ): CodexThreadStreamSubscriptionAction[] {
    const actions: CodexThreadStreamSubscriptionAction[] = state.followedClientIds.size > 0
      ? this.buildFollowerActions(conversationId, state)
      : [];
    if (this.resolveFollowerClientIds(state).length === 0 && state.ownerClientId) {
      actions.push({
        type: "request-following-status",
        conversationId,
        ownerClientId: state.ownerClientId,
      });
    }
    return actions;
  }

  private buildFollowerActions(
    conversationId: string,
    state: ConversationSubscriptionState,
  ): CodexThreadStreamFollowersChanged[] {
    if (!state.ownerClientId) return [];
    return [{
      type: "followers-changed",
      conversationId,
      ownerClientId: state.ownerClientId,
      followerClientIds: this.resolveFollowerClientIds(state),
      targetClientIds: state.ownerClientId ? [state.ownerClientId] : [],
      membershipEpoch: state.membershipEpoch,
    }];
  }

  private removeIfEmpty(conversationId: string, state: ConversationSubscriptionState): void {
    if (state.ownerClientId || state.followedClientIds.size > 0) return;
    if (this.hasFollowersOrPendingReconnect(conversationId)) return;
    this.conversations.delete(conversationId);
  }
}
