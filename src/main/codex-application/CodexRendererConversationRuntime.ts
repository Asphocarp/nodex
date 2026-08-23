import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type { RequestId } from "@nodex/codex-app-server-protocol";
import type {
  CodexThreadOwnerServerRequest,
  CodexThreadStreamCheckpoint,
} from "../../shared/types";
import { CodexRendererViewRegistry } from "../codex/codex-renderer-view-registry";
import {
  CODEX_THREAD_STREAM_FOLLOWER_RECONNECT_GRACE_MS,
  CodexThreadStreamSubscriptionState,
  type CodexThreadStreamFollowingResult,
  type CodexThreadStreamOwnerResult,
  type CodexThreadStreamSnapshotAckResult,
  type CodexThreadStreamSubscriptionAction,
} from "../codex/codex-thread-stream-subscription-state";

export interface CodexRendererConversationRuntimeOptions {
  readonly now?: () => number;
  readonly reconnectGraceMs?: number;
  readonly projection?: {
    readonly following: (input: {
      readonly conversationId: string;
      readonly clientId: string;
      readonly result: CodexThreadStreamFollowingResult;
    }) => void;
    readonly viewActive: (input: {
      readonly conversationId: string;
      readonly clientId: string;
      readonly result: CodexRendererConversationViewActiveResult;
    }) => void;
    readonly presented: (input: {
      readonly conversationId: string;
      readonly result: CodexRendererConversationPresentedResult;
    }) => void;
  };
}

export interface CodexRendererConversationOwnerResult extends CodexThreadStreamOwnerResult {
  readonly previousOwnerClientId: string | null;
}

export interface CodexRendererConversationClientDisposedResult {
  readonly actions: readonly CodexThreadStreamSubscriptionAction[];
  readonly followerConversationIds: readonly string[];
  readonly ownerConversationIds: readonly string[];
  readonly viewConversationIds: readonly string[];
}

export interface CodexRendererConversationViewActiveResult {
  readonly accepted: boolean;
  readonly following: CodexThreadStreamFollowingResult | null;
}

export interface CodexRendererConversationPresentedResult {
  readonly accepted: boolean;
  readonly presentedInForeground: boolean;
}

export interface CodexRendererConversationRuntimeService {
  readonly setOwner: (
    conversationId: string,
    clientId: string,
  ) => CodexRendererConversationOwnerResult | null;
  readonly getOwnerClientId: (conversationId: string) => string | null;
  readonly hasOwner: (conversationId: string) => boolean;
  readonly hasDetachedOwner: (conversationId: string) => boolean;
  readonly getOwnerEpoch: (conversationId: string) => number | null;
  readonly getFollowerClientIds: (conversationId: string) => readonly string[] | null;
  readonly getSnapshotClientIds: (conversationId: string) => readonly string[];
  readonly markSnapshotSent: (
    conversationId: string,
    clientId: string,
    checkpoint: CodexThreadStreamCheckpoint,
  ) => boolean;
  readonly setFollowing: (
    conversationId: string,
    clientId: string,
    following: boolean,
    options?: { readonly forceSnapshot?: boolean },
  ) => CodexThreadStreamFollowingResult | null;
  readonly acknowledgeSnapshotApplied: (input: {
    readonly conversationId: string;
    readonly clientId: string;
    readonly ownerClientId: string;
    readonly checkpoint: CodexThreadStreamCheckpoint;
    readonly currentCheckpoint: CodexThreadStreamCheckpoint;
  }) => CodexThreadStreamSnapshotAckResult | null;
  readonly requireSnapshot: (input: {
    readonly conversationId: string;
    readonly clientId: string;
    readonly ownerClientId: string;
    readonly observedOwnerEpoch?: number;
  }) => boolean;
  readonly invalidateSnapshotBarriers: (conversationId: string) => void;
  readonly hasFollowersOrPendingReconnect: (conversationId: string) => boolean;
  readonly handleClientConnected: (
    clientId: string,
  ) => readonly CodexThreadStreamSubscriptionAction[];
  readonly handleClientDeliveryFailure: (
    clientIds: readonly string[],
  ) => readonly CodexThreadStreamSubscriptionAction[];
  readonly handleClientDisposed: (
    clientId: string,
  ) => CodexRendererConversationClientDisposedResult;
  readonly isClientDisposed: (clientId: string) => boolean;
  readonly setViewActive: (
    conversationId: string,
    clientId: string,
    active: boolean,
  ) => CodexRendererConversationViewActiveResult;
  readonly setClientForegrounded: (clientId: string, foregrounded: boolean) => readonly string[];
  readonly setPresented: (
    conversationId: string,
    clientId: string,
    surfaceId: string,
    presented: boolean,
  ) => CodexRendererConversationPresentedResult;
  readonly isPresentedInForeground: (conversationId: string) => boolean;
  readonly hasForegroundClient: () => boolean;
  readonly hasActiveView: (conversationId: string) => boolean;
  readonly isClientPresenting: (conversationId: string, clientId: string) => boolean;
  readonly resolvePresentationClient: (conversationId: string) => string | null;
  readonly resolvePresentedSurfaceClient: (conversationId: string) => string | null;
  readonly hasRequestDelivery: (
    conversationId: string,
    request: CodexThreadOwnerServerRequest,
    clientId: string,
  ) => boolean;
  readonly recordRequestDelivery: (
    conversationId: string,
    request: CodexThreadOwnerServerRequest,
    clientId: string,
  ) => void;
  readonly clearRequestDelivery: (conversationId: string, requestId: RequestId) => void;
  readonly clearConversation: (conversationId: string) => string | null;
  readonly updateFollowing: (
    conversationId: string,
    clientId: string,
    following: boolean,
    options?: { readonly forceSnapshot?: boolean },
  ) => Effect.Effect<boolean>;
  readonly updateViewActive: (
    conversationId: string,
    clientId: string,
    active: boolean,
  ) => Effect.Effect<boolean>;
  readonly updatePresented: (
    conversationId: string,
    clientId: string,
    surfaceId: string,
    presented: boolean,
  ) => Effect.Effect<boolean>;
}

export class CodexRendererConversationRuntime extends Context.Service<
  CodexRendererConversationRuntime,
  CodexRendererConversationRuntimeService
>()("nodex/main/codex-application/CodexRendererConversationRuntime") {}

const normalizeId = (value: string): string => value.trim();

const normalizeNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const requestDeliveryPrefix = (requestId: RequestId): string =>
  `${typeof requestId}:${String(requestId)}|`;

const requestDeliveryKey = (request: CodexThreadOwnerServerRequest): string => {
  const params = request.params as unknown as Record<string, unknown>;
  const occurrenceId =
    normalizeNonEmptyString(params.callId) ??
    normalizeNonEmptyString(params.itemId) ??
    normalizeNonEmptyString(params.elicitationId) ??
    normalizeNonEmptyString(params.turnId) ??
    "thread";
  return `${requestDeliveryPrefix(request.id)}${request.method}|${occurrenceId}`;
};

/**
 * Deterministic renderer-generation state machine. Production obtains it only
 * through the scoped runtime; tests may construct it directly to exercise the
 * synchronous conversation reducer without creating a second Effect runtime.
 */
const makeRuntimeState = (
  options: CodexRendererConversationRuntimeOptions = {},
): {
  readonly close: () => void;
  readonly runtime: CodexRendererConversationRuntimeService;
} => {
  const subscriptions = new CodexThreadStreamSubscriptionState({
    now: options.now,
    reconnectGraceMs: options.reconnectGraceMs ?? CODEX_THREAD_STREAM_FOLLOWER_RECONNECT_GRACE_MS,
  });
  const views = new CodexRendererViewRegistry();
  const disposedClientIds = new Set<string>();
  const requestDeliveriesByConversationId = new Map<string, Map<string, string>>();
  let closed = false;

  const clearRequestDeliveries = (conversationId: string): void => {
    requestDeliveriesByConversationId.delete(normalizeId(conversationId));
  };

  const service: CodexRendererConversationRuntimeService = {
    setOwner: (conversationId, clientId) => {
      const normalizedConversationId = normalizeId(conversationId);
      const normalizedClientId = normalizeId(clientId);
      if (
        closed ||
        !normalizedConversationId ||
        !normalizedClientId ||
        disposedClientIds.has(normalizedClientId)
      ) {
        return null;
      }

      const previousOwnerClientId = subscriptions.getOwnerClientId(normalizedConversationId);
      const result = subscriptions.setOwner(normalizedConversationId, normalizedClientId);
      if (result.changed) clearRequestDeliveries(normalizedConversationId);
      return { ...result, previousOwnerClientId };
    },
    getOwnerClientId: (conversationId) => subscriptions.getOwnerClientId(conversationId),
    hasOwner: (conversationId) => subscriptions.getOwnerClientId(conversationId) !== null,
    hasDetachedOwner: (conversationId) => subscriptions.hasDetachedOwner(conversationId),
    getOwnerEpoch: (conversationId) => subscriptions.getOwnerEpoch(conversationId),
    getFollowerClientIds: (conversationId) => subscriptions.getFollowerClientIds(conversationId),
    getSnapshotClientIds: (conversationId) => subscriptions.getSnapshotClientIds(conversationId),
    markSnapshotSent: (conversationId, clientId, checkpoint) =>
      !closed && subscriptions.markSnapshotSent(conversationId, clientId, checkpoint),
    setFollowing: (conversationId, clientId, following, followingOptions = {}) => {
      const normalizedClientId = normalizeId(clientId);
      if (closed || !normalizedClientId || disposedClientIds.has(normalizedClientId)) return null;
      return subscriptions.setFollowing(
        conversationId,
        normalizedClientId,
        following,
        followingOptions,
      );
    },
    acknowledgeSnapshotApplied: (input) => {
      if (closed || disposedClientIds.has(normalizeId(input.clientId))) return null;
      return subscriptions.acknowledgeSnapshotApplied(input);
    },
    requireSnapshot: (input) => {
      const clientId = normalizeId(input.clientId);
      if (closed || !clientId || disposedClientIds.has(clientId)) return false;
      if (
        subscriptions.getOwnerClientId(input.conversationId) !== normalizeId(input.ownerClientId)
      ) {
        return false;
      }
      const currentOwnerEpoch = subscriptions.getOwnerEpoch(input.conversationId);
      if (
        typeof input.observedOwnerEpoch === "number" &&
        typeof currentOwnerEpoch === "number" &&
        input.observedOwnerEpoch > currentOwnerEpoch
      ) {
        return false;
      }
      return subscriptions.requireSnapshot(input.conversationId, clientId);
    },
    invalidateSnapshotBarriers: (conversationId) => {
      if (!closed) subscriptions.invalidateSnapshotBarriers(conversationId);
    },
    hasFollowersOrPendingReconnect: (conversationId) =>
      subscriptions.hasFollowersOrPendingReconnect(conversationId),
    handleClientConnected: (clientId) => {
      const normalizedClientId = normalizeId(clientId);
      if (closed || !normalizedClientId || disposedClientIds.has(normalizedClientId)) return [];
      return subscriptions.handleClientConnected(normalizedClientId);
    },
    handleClientDeliveryFailure: (clientIds) => {
      if (closed) return [];
      const actions: CodexThreadStreamSubscriptionAction[] = [];
      for (const clientId of new Set(clientIds.map(normalizeId).filter(Boolean))) {
        actions.push(...subscriptions.handleIpcConnectionReset(clientId));
      }
      return actions;
    },
    handleClientDisposed: (clientId) => {
      const normalizedClientId = normalizeId(clientId);
      if (closed || !normalizedClientId || disposedClientIds.has(normalizedClientId)) {
        return {
          actions: [],
          followerConversationIds: [],
          ownerConversationIds: [],
          viewConversationIds: [],
        };
      }
      disposedClientIds.add(normalizedClientId);
      const subscriptionResult = subscriptions.handleClientDisposed(normalizedClientId);
      const viewConversationIds = views.removeClient(normalizedClientId);
      for (const conversationId of subscriptionResult.ownerConversationIds) {
        clearRequestDeliveries(conversationId);
      }
      return { ...subscriptionResult, viewConversationIds };
    },
    isClientDisposed: (clientId) => closed || disposedClientIds.has(normalizeId(clientId)),
    setViewActive: (conversationId, clientId, active) => {
      const normalizedClientId = normalizeId(clientId);
      if (closed || !normalizedClientId || (active && disposedClientIds.has(normalizedClientId))) {
        return { accepted: false, following: null };
      }
      views.setActive(conversationId, normalizedClientId, active);
      return {
        accepted: true,
        following: service.setFollowing(conversationId, normalizedClientId, active),
      };
    },
    setClientForegrounded: (clientId, foregrounded) => {
      const normalizedClientId = normalizeId(clientId);
      if (
        closed ||
        !normalizedClientId ||
        (foregrounded && disposedClientIds.has(normalizedClientId))
      ) {
        return [];
      }
      return views.setClientForegrounded(normalizedClientId, foregrounded);
    },
    setPresented: (conversationId, clientId, surfaceId, presented) => {
      const normalizedClientId = normalizeId(clientId);
      if (
        closed ||
        !normalizedClientId ||
        (presented && disposedClientIds.has(normalizedClientId))
      ) {
        return { accepted: false, presentedInForeground: false };
      }
      views.setPresented(conversationId, normalizedClientId, surfaceId, presented);
      return {
        accepted: true,
        presentedInForeground: presented && views.isPresentedInForeground(conversationId),
      };
    },
    isPresentedInForeground: (conversationId) => views.isPresentedInForeground(conversationId),
    hasForegroundClient: () => views.hasForegroundClient(),
    hasActiveView: (conversationId) => views.hasActiveView(conversationId),
    isClientPresenting: (conversationId, clientId) =>
      views.isClientPresenting(conversationId, clientId),
    resolvePresentationClient: (conversationId) => views.resolvePresentationClient(conversationId),
    resolvePresentedSurfaceClient: (conversationId) =>
      views.resolvePresentedSurfaceClient(conversationId),
    hasRequestDelivery: (conversationId, request, clientId) =>
      !closed &&
      requestDeliveriesByConversationId
        .get(normalizeId(conversationId))
        ?.get(requestDeliveryKey(request)) === normalizeId(clientId),
    recordRequestDelivery: (conversationId, request, clientId) => {
      if (closed) return;
      const normalizedConversationId = normalizeId(conversationId);
      const normalizedClientId = normalizeId(clientId);
      if (!normalizedConversationId || !normalizedClientId) return;
      const deliveries =
        requestDeliveriesByConversationId.get(normalizedConversationId) ??
        new Map<string, string>();
      deliveries.set(requestDeliveryKey(request), normalizedClientId);
      requestDeliveriesByConversationId.set(normalizedConversationId, deliveries);
    },
    clearRequestDelivery: (conversationId, requestId) => {
      if (closed) return;
      const normalizedConversationId = normalizeId(conversationId);
      const deliveries = requestDeliveriesByConversationId.get(normalizedConversationId);
      if (!deliveries) return;
      const prefix = requestDeliveryPrefix(requestId);
      for (const key of deliveries.keys()) {
        if (key.startsWith(prefix)) deliveries.delete(key);
      }
      if (deliveries.size === 0) requestDeliveriesByConversationId.delete(normalizedConversationId);
    },
    clearConversation: (conversationId) => {
      if (closed) return null;
      const normalizedConversationId = normalizeId(conversationId);
      const ownerClientId = subscriptions.getOwnerClientId(normalizedConversationId);
      subscriptions.clearConversation(normalizedConversationId);
      views.clearConversation(normalizedConversationId);
      clearRequestDeliveries(normalizedConversationId);
      return ownerClientId;
    },
    updateFollowing: (conversationId, clientId, following, followingOptions) =>
      Effect.sync(() => {
        const result = service.setFollowing(conversationId, clientId, following, followingOptions);
        if (!result) return false;
        options.projection?.following({ conversationId, clientId, result });
        return true;
      }),
    updateViewActive: (conversationId, clientId, active) =>
      Effect.sync(() => {
        const result = service.setViewActive(conversationId, clientId, active);
        if (!result.accepted) return false;
        options.projection?.viewActive({ conversationId, clientId, result });
        return true;
      }),
    updatePresented: (conversationId, clientId, surfaceId, presented) =>
      Effect.sync(() => {
        const result = service.setPresented(conversationId, clientId, surfaceId, presented);
        if (!result.accepted) return false;
        options.projection?.presented({ conversationId, result });
        return true;
      }),
  };
  return {
    close: () => {
      if (closed) return;
      closed = true;
      subscriptions.reset();
      views.reset();
      disposedClientIds.clear();
      requestDeliveriesByConversationId.clear();
    },
    runtime: service,
  };
};

export const makeCodexRendererConversationState = (
  options: CodexRendererConversationRuntimeOptions = {},
): CodexRendererConversationRuntimeService => makeRuntimeState(options).runtime;

export const make = (
  options: CodexRendererConversationRuntimeOptions = {},
): Effect.Effect<CodexRendererConversationRuntimeService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const state = makeRuntimeState(options);
    yield* Effect.addFinalizer(() => Effect.sync(state.close));
    return CodexRendererConversationRuntime.of(state.runtime);
  });
