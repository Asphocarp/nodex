import type {
  ResourceRevocationMessage,
  ResourceRevocationResetMessage,
} from "../../shared/resource-revocation-stream";
import type { ProjectionCursor, ProjectionScope } from "../../shared/projection-stream";
import { projectionScopeKey } from "../../shared/projection-stream";
import {
  revocationMessageFromDelivery,
  revocationScopeCanReceive,
} from "../../shared/local-commit-delivery";
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
    for (const state of this.#scopes.values()) {
      if (!revocationScopeCanReceive(state.scope, revocation)) continue;
      const message = revocationMessageFromDelivery(
        packet,
        revocation,
        state.scope,
      );
      for (const listener of [...state.listeners]) {
        try {
          listener(message);
        } catch (error) {
          this.#onListenerError?.(error, state.scope);
        }
      }
    }
  }

  reset(
    cursor: ProjectionCursor,
    reason: ResourceRevocationResetMessage["reason"],
  ): void {
    this.resetScopes(
      [...this.#scopes.values()].map((state) => state.scope),
      cursor,
      reason,
    );
  }

  resetScopes(
    scopes: readonly ProjectionScope[],
    cursor: ProjectionCursor,
    reason: ResourceRevocationResetMessage["reason"],
  ): void {
    const keys = new Set(scopes.map((scope) => {
      this.#assertScope(scope);
      return projectionScopeKey(scope);
    }));
    for (const [key, state] of this.#scopes) {
      if (!keys.has(key)) continue;
      const message: ResourceRevocationResetMessage = {
        version: 1,
        kind: "reset",
        scope: state.scope,
        stream: cursor,
        reason,
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
