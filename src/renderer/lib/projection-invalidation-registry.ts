import type {
  ProjectionCursor,
  ProjectionImpact,
  ProjectionScope,
  ProjectionStreamMessage,
} from "../../shared/projection-stream";
import {
  projectionCursorCovers,
  projectionScopeKey,
} from "../../shared/projection-stream";

export interface ProjectionDependencies {
  readonly pageIds?: readonly string[];
  readonly databaseIds?: readonly string[];
  readonly dataSourceIds?: readonly string[];
  readonly viewIds?: readonly string[];
  readonly documentIds?: readonly string[];
  readonly aggregate?: boolean;
}

export interface ProjectionRegistration {
  readonly scope: ProjectionScope;
  readonly consumerKey: string;
  getDependencies(): ProjectionDependencies;
  getCursor(): ProjectionCursor | null;
  invalidate(cause: ProjectionStreamMessage): void | Promise<void>;
}

type Subscribe = (
  scope: ProjectionScope,
  listener: (message: ProjectionStreamMessage) => void,
) => () => void;

interface ConsumerState {
  readonly registrations: Map<symbol, ProjectionRegistration>;
  running: boolean;
  pending: ProjectionStreamMessage | null;
  required: ProjectionStreamMessage | null;
}

interface ScopeState {
  readonly scope: ProjectionScope;
  readonly consumers: Map<string, ConsumerState>;
  unsubscribe: (() => void) | null;
  latestMessage: ProjectionStreamMessage | null;
}

export class ProjectionInvalidationRegistry {
  readonly #subscribe: Subscribe;
  readonly #scopes = new Map<string, ScopeState>();

  constructor(subscribe: Subscribe) {
    this.#subscribe = subscribe;
  }

  register(registration: ProjectionRegistration): () => void {
    const scopeKey = projectionScopeKey(registration.scope);
    const scope = this.#scopes.get(scopeKey) ?? {
      scope: registration.scope,
      consumers: new Map<string, ConsumerState>(),
      unsubscribe: null,
      latestMessage: null,
    };
    this.#scopes.set(scopeKey, scope);
    const existingConsumer = scope.consumers.get(registration.consumerKey);
    const consumer = existingConsumer ?? {
      registrations: new Map<symbol, ProjectionRegistration>(),
      running: false,
      pending: null,
      required: null,
    };
    scope.consumers.set(registration.consumerKey, consumer);
    const token = Symbol(registration.consumerKey);
    consumer.registrations.set(token, registration);

    if (!scope.unsubscribe) {
      scope.unsubscribe = this.#subscribe(scope.scope, (message) => {
        this.#handle(scope, message);
      });
    }
    if (!existingConsumer && scope.latestMessage) {
      const latest = scope.latestMessage;
      this.#schedule(consumer, latest.kind === "resync" ? latest : {
        version: 1,
        kind: "checkpoint",
        scope: scope.scope,
        cursor: latest.cursor,
      });
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      consumer.registrations.delete(token);
      if (consumer.registrations.size === 0) {
        scope.consumers.delete(registration.consumerKey);
      }
      if (scope.consumers.size > 0) return;
      scope.unsubscribe?.();
      scope.unsubscribe = null;
      this.#scopes.delete(scopeKey);
    };
  }

  dispose(): void {
    for (const scope of this.#scopes.values()) scope.unsubscribe?.();
    this.#scopes.clear();
  }

  #handle(scope: ScopeState, message: ProjectionStreamMessage): void {
    if (projectionScopeKey(message.scope) !== projectionScopeKey(scope.scope)) return;
    scope.latestMessage = laterCause(scope.latestMessage, message);
    for (const consumer of scope.consumers.values()) {
      const registration = consumer.registrations.values().next().value as
        | ProjectionRegistration
        | undefined;
      if (!registration) continue;
      if (!this.#shouldInvalidate(registration, message)) continue;
      this.#schedule(consumer, message);
    }
  }

  #shouldInvalidate(
    registration: ProjectionRegistration,
    message: ProjectionStreamMessage,
  ): boolean {
    if (message.kind === "resync") return true;
    const cursor = registration.getCursor();
    if (cursor && cursor.storeEpoch !== message.cursor.storeEpoch) return true;
    if (projectionCursorCovers(cursor, message.cursor)) return false;
    if (message.kind === "checkpoint") return true;
    return impactMatches(registration.getDependencies(), message.impact);
  }

  #schedule(consumer: ConsumerState, message: ProjectionStreamMessage): void {
    if (consumer.required) {
      consumer.pending = laterCause(consumer.pending, consumer.required);
      consumer.required = null;
    }
    consumer.pending = laterCause(consumer.pending, message);
    if (consumer.running) return;
    consumer.running = true;
    void this.#drain(consumer).finally(() => {
      consumer.running = false;
      if (consumer.pending) this.#schedule(consumer, consumer.pending);
    });
  }

  async #drain(consumer: ConsumerState): Promise<void> {
    let trailingBudget = 1;
    let failureRetryBudget = 1;
    while (consumer.pending) {
      const cause = consumer.pending;
      consumer.pending = null;
      const registration = consumer.registrations.values().next().value as
        | ProjectionRegistration
        | undefined;
      if (!registration) return;
      if (
        cause.kind !== "resync"
        && projectionCursorCovers(registration.getCursor(), cause.cursor)
      ) {
        continue;
      }
      try {
        await registration.invalidate(cause);
      } catch {
        if (failureRetryBudget > 0) {
          failureRetryBudget -= 1;
          consumer.pending = laterCause(consumer.pending, cause);
          continue;
        }
        consumer.required = laterCause(consumer.required, cause);
        return;
      }

      const pending = readPending(consumer);
      if (pending) {
        if (
          pending.kind !== "resync"
          && projectionCursorCovers(registration.getCursor(), pending.cursor)
        ) {
          consumer.pending = null;
        }
        continue;
      }
      if (
        cause.kind === "resync"
        || projectionCursorCovers(registration.getCursor(), cause.cursor)
        || trailingBudget === 0
      ) {
        return;
      }
      trailingBudget -= 1;
      consumer.pending = cause;
    }
  }
}

const intersects = (
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean => {
  if (!left?.length || right.length === 0) return false;
  const values = new Set(left);
  return right.some((value) => values.has(value));
};

export const impactMatches = (
  dependencies: ProjectionDependencies,
  impact: ProjectionImpact,
): boolean => {
  if (impact.kind === "none") return false;
  if (impact.kind === "all" || dependencies.aggregate === true) return true;
  return intersects(dependencies.pageIds, impact.page_ids)
    || intersects(dependencies.databaseIds, impact.database_ids)
    || intersects(dependencies.dataSourceIds, impact.data_source_ids)
    || intersects(dependencies.viewIds, impact.view_ids)
    || intersects(
      dependencies.documentIds,
      impact.document_heads.map((head) => head.document_id),
    );
};

const readPending = (consumer: ConsumerState): ProjectionStreamMessage | null =>
  consumer.pending;

const laterCause = (
  current: ProjectionStreamMessage | null,
  incoming: ProjectionStreamMessage,
): ProjectionStreamMessage => {
  if (!current) return incoming;
  if (current.cursor.storeEpoch !== incoming.cursor.storeEpoch) return incoming;
  if (incoming.cursor.changeLogSeq > current.cursor.changeLogSeq) return incoming;
  if (incoming.cursor.changeLogSeq < current.cursor.changeLogSeq) return current;
  if (current.kind === "resync" || incoming.kind === "resync") {
    return incoming.kind === "resync" ? incoming : current;
  }
  if (current.kind === "checkpoint" || incoming.kind === "checkpoint") {
    return incoming.kind === "checkpoint" ? incoming : current;
  }
  return incoming;
};
