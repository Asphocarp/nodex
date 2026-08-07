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
import type { CausalProjectionRuntime } from "./causal-projection-runtime";

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
  readonly causalRuntime?: CausalProjectionRuntime;
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
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  initialCheckpointObserved: boolean;
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
      retryTimer: null,
      retryAttempt: 0,
      initialCheckpointObserved: false,
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
      this.#handleConsumer(consumer, scope.latestMessage);
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      consumer.registrations.delete(token);
      if (consumer.registrations.size === 0) {
        this.#cancelRetry(consumer);
        scope.consumers.delete(registration.consumerKey);
      }
      if (scope.consumers.size > 0) return;
      scope.unsubscribe?.();
      scope.unsubscribe = null;
      this.#scopes.delete(scopeKey);
    };
  }

  dispose(): void {
    for (const scope of this.#scopes.values()) {
      for (const consumer of scope.consumers.values()) {
        this.#cancelRetry(consumer);
      }
      scope.unsubscribe?.();
    }
    this.#scopes.clear();
  }

  #handle(scope: ScopeState, message: ProjectionStreamMessage): void {
    if (projectionScopeKey(message.scope) !== projectionScopeKey(scope.scope)) return;
    scope.latestMessage = laterCause(scope.latestMessage, message);
    for (const consumer of scope.consumers.values()) {
      this.#handleConsumer(consumer, message);
    }
  }

  #handleConsumer(
    consumer: ConsumerState,
    message: ProjectionStreamMessage,
  ): void {
    const registrations = [...consumer.registrations.values()];
    if (registrations.length === 0) return;
    const runtimes = new Set(
      registrations
        .map((registration) => registration.causalRuntime)
        .filter((runtime): runtime is CausalProjectionRuntime => Boolean(runtime)),
    );
    for (const runtime of runtimes) {
      if (message.kind === "effect") runtime.accept(message.delivery);
      if (message.kind === "checkpoint") {
        runtime.observeInitialCheckpoint({
          storeEpoch: message.stream.storeEpoch,
          scannedThroughCommitSeq: message.stream.commitSeq,
        });
      }
      if (message.kind === "reset") {
        runtime.reset({
          storeEpoch: message.stream.storeEpoch,
          commitSeq: message.stream.commitSeq,
        });
      }
    }

    const registration = registrations[0];
    if (!registration) return;
    if (message.kind === "checkpoint") {
      if (consumer.initialCheckpointObserved) return;
      consumer.initialCheckpointObserved = true;
    }
    if (!this.#shouldInvalidate(registration, message)) return;
    this.#schedule(consumer, message);
  }

  #shouldInvalidate(
    registration: ProjectionRegistration,
    message: ProjectionStreamMessage,
  ): boolean {
    if (registration.causalRuntime) return false;
    if (message.kind === "reset") return true;
    const cursor = registration.getCursor();
    if (cursor && cursor.storeEpoch !== message.stream.storeEpoch) return true;
    if (projectionCursorCovers(cursor, message.stream)) return false;
    if (message.kind === "checkpoint") return true;
    return impactMatches(
      registration.getDependencies(),
      message.delivery.impact,
    );
  }

  #schedule(consumer: ConsumerState, message: ProjectionStreamMessage): void {
    this.#cancelRetry(consumer);
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
    let failureRetryBudget = 1;
    while (consumer.pending) {
      const cause = consumer.pending;
      consumer.pending = null;
      const registration = consumer.registrations.values().next().value as
        | ProjectionRegistration
        | undefined;
      if (!registration) return;
      if (
        cause.kind !== "reset"
        && projectionCursorCovers(registration.getCursor(), cause.stream)
      ) {
        continue;
      }
      try {
        await registration.invalidate(cause);
        consumer.retryAttempt = 0;
      } catch {
        if (failureRetryBudget > 0) {
          failureRetryBudget -= 1;
          consumer.pending = laterCause(consumer.pending, cause);
          continue;
        }
        consumer.required = laterCause(consumer.required, cause);
        this.#scheduleRetry(consumer);
        return;
      }
    }
  }

  #scheduleRetry(consumer: ConsumerState): void {
    if (consumer.retryTimer !== null || consumer.required === null) return;
    const delayMs = Math.min(
      5_000,
      100 * (2 ** Math.min(consumer.retryAttempt, 5)),
    );
    consumer.retryAttempt += 1;
    consumer.retryTimer = setTimeout(() => {
      consumer.retryTimer = null;
      const required = consumer.required;
      if (required === null || consumer.registrations.size === 0) return;
      consumer.required = null;
      this.#schedule(consumer, required);
    }, delayMs);
  }

  #cancelRetry(consumer: ConsumerState): void {
    if (consumer.retryTimer === null) return;
    clearTimeout(consumer.retryTimer);
    consumer.retryTimer = null;
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

const messagePriority = (message: ProjectionStreamMessage): number => {
  if (message.kind === "reset") return 3;
  if (message.kind === "effect") return 2;
  return 1;
};

const laterCause = (
  current: ProjectionStreamMessage | null,
  incoming: ProjectionStreamMessage,
): ProjectionStreamMessage => {
  if (!current) return incoming;
  if (current.stream.storeEpoch !== incoming.stream.storeEpoch) return incoming;
  if (incoming.stream.commitSeq > current.stream.commitSeq) return incoming;
  if (incoming.stream.commitSeq < current.stream.commitSeq) return current;
  return messagePriority(incoming) >= messagePriority(current)
    ? incoming
    : current;
};
