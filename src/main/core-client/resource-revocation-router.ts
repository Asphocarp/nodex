import type {
  ResourceRevocationDelivery,
  ResourceRevocationMessage,
} from "../../shared/resource-revocation-stream";
import type { ProjectionScope } from "../../shared/projection-stream";
import { projectionScopeKey } from "../../shared/projection-stream";
import type { CoreAuthorizedDeliveryPacket } from "./types";

type Listener = (message: ResourceRevocationMessage) => void;

interface ScopeState {
  readonly scope: ProjectionScope;
  readonly listeners: Set<Listener>;
}

export interface ResourceRevocationRouterInput {
  readonly libraryId: string;
  readonly onListenerError?: (error: unknown, scope: ProjectionScope) => void;
}

const deliveryOf = (
  packet: CoreAuthorizedDeliveryPacket,
  revocation: CoreAuthorizedDeliveryPacket["revocations"][number],
): ResourceRevocationDelivery => ({
  storeEpoch: packet.manifest.identity.store_epoch,
  commitSeq: packet.manifest.identity.commit_seq,
  manifestHash: packet.manifest.identity.manifest_hash,
  operationId: packet.manifest.operation_id,
  committedAt: packet.manifest.committed_at,
  revocation,
});

const scopeCanReceive = (
  subscription: ProjectionScope,
  revocation: CoreAuthorizedDeliveryPacket["revocations"][number],
): boolean => {
  const authorization = revocation.authorization_scope;
  if (authorization.library_id !== subscription.libraryId) return false;
  if (authorization.kind === "library") return subscription.kind === "library";
  if (authorization.kind === "document") return false;
  return subscription.kind === "project"
    && subscription.projectId === authorization.project_id;
};

/** Routes immutable Core-authored revocations; it never re-evaluates authorization. */
export class ResourceRevocationRouter {
  readonly #libraryId: string;
  readonly #onListenerError: ResourceRevocationRouterInput["onListenerError"];
  readonly #scopes = new Map<string, ScopeState>();

  constructor(input: ResourceRevocationRouterInput) {
    this.#libraryId = input.libraryId;
    this.#onListenerError = input.onListenerError;
  }

  dispose(): void {
    this.#scopes.clear();
  }

  subscribe(scope: ProjectionScope, listener: Listener): () => void {
    this.#assertScope(scope);
    const key = projectionScopeKey(scope);
    const state = this.#scopes.get(key) ?? {
      scope,
      listeners: new Set<Listener>(),
    };
    this.#scopes.set(key, state);
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
      if (state.listeners.size === 0) this.#scopes.delete(key);
    };
  }

  publish(
    packet: CoreAuthorizedDeliveryPacket,
    revocation: CoreAuthorizedDeliveryPacket["revocations"][number],
  ): void {
    const delivery = deliveryOf(packet, revocation);
    for (const state of this.#scopes.values()) {
      if (!scopeCanReceive(state.scope, revocation)) continue;
      const message: ResourceRevocationMessage = {
        version: 1,
        kind: "revocation",
        scope: state.scope,
        stream: {
          storeEpoch: packet.manifest.identity.store_epoch,
          commitSeq: packet.manifest.identity.commit_seq,
        },
        delivery,
      };
      for (const listener of [...state.listeners]) {
        try {
          listener(message);
        } catch (error) {
          this.#onListenerError?.(error, state.scope);
        }
      }
    }
  }

  #assertScope(scope: ProjectionScope): void {
    if (!scope.libraryId || scope.libraryId.trim() !== scope.libraryId) {
      throw new Error("Revocation subscription Library identity is invalid");
    }
    if (scope.libraryId !== this.#libraryId) {
      throw new Error("Revocation subscription targets another Library");
    }
    if (
      scope.kind === "project"
      && (!scope.projectId || scope.projectId.trim() !== scope.projectId)
    ) {
      throw new Error("Revocation subscription Project identity is invalid");
    }
  }
}
