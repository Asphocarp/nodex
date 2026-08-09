import type {
  ProjectionCursor,
  ProjectionImpact,
  ProjectionScope,
  ProjectionStreamMessage,
} from "../../shared/projection-stream";
import type { ResourceRevocationMessage } from "../../shared/resource-revocation-stream";
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
  readonly canvasIds?: readonly string[];
  readonly aggregate?: boolean;
}

export type ProjectionRevocationMessage = Extract<
  ResourceRevocationMessage,
  { readonly kind: "revocation" }
>;
export type ProjectionInvalidationCause =
  | ProjectionStreamMessage
  | ResourceRevocationMessage;
export type ProjectionFenceCause =
  | Extract<ProjectionStreamMessage, {
      readonly kind: "checkpoint" | "reset";
    }>
  | Extract<ResourceRevocationMessage, { readonly kind: "reset" }>;

export interface ProjectionRegistration {
  readonly scope: ProjectionScope;
  readonly consumerKey: string;
  readonly causalRuntime?: CausalProjectionRuntime;
  /** A revocation-only consumer does not participate in projection repair. */
  readonly projectionEffects?: "match" | "ignore";
  getDependencies(): ProjectionDependencies;
  getCursor(): ProjectionCursor | null;
  /** Applies cache removal synchronously, before any queued repair I/O. */
  revoke?(cause: ProjectionRevocationMessage): void;
  /** Clears authority synchronously when a checkpoint/reset exposes a gap. */
  fence?(cause: ProjectionFenceCause): void;
  invalidate(cause: ProjectionInvalidationCause): void | Promise<void>;
}

type SubscribeProjection = (
  scope: ProjectionScope,
  listener: (message: ProjectionStreamMessage) => void,
) => () => void;

type SubscribeRevocations = (
  scope: ProjectionScope,
  listener: (message: ResourceRevocationMessage) => void,
) => () => void;

interface ConsumerState {
  readonly registrations: Map<symbol, ProjectionRegistration>;
  running: boolean;
  pending: ProjectionInvalidationCause | null;
  required: ProjectionInvalidationCause | null;
  initialCheckpointObserved: boolean;
}

interface ScopeState {
  readonly scope: ProjectionScope;
  readonly consumers: Map<string, ConsumerState>;
  unsubscribeProjection: (() => void) | null;
  unsubscribeRevocations: (() => void) | null;
  latestMessage: ProjectionInvalidationCause | null;
}

export class ProjectionInvalidationRegistry {
  readonly #subscribeProjection: SubscribeProjection;
  readonly #subscribeRevocations: SubscribeRevocations;
  readonly #scopes = new Map<string, ScopeState>();

  constructor(input: {
    readonly subscribeProjection: SubscribeProjection;
    readonly subscribeRevocations: SubscribeRevocations;
  }) {
    this.#subscribeProjection = input.subscribeProjection;
    this.#subscribeRevocations = input.subscribeRevocations;
  }

  register(registration: ProjectionRegistration): () => void {
    const scopeKey = projectionScopeKey(registration.scope);
    const scope = this.#scopes.get(scopeKey) ?? {
      scope: registration.scope,
      consumers: new Map<string, ConsumerState>(),
      unsubscribeProjection: null,
      unsubscribeRevocations: null,
      latestMessage: null,
    };
    this.#scopes.set(scopeKey, scope);
    const existingConsumer = scope.consumers.get(registration.consumerKey);
    const consumer = existingConsumer ?? {
      registrations: new Map<symbol, ProjectionRegistration>(),
      running: false,
      pending: null,
      required: null,
      initialCheckpointObserved: false,
    };
    scope.consumers.set(registration.consumerKey, consumer);
    const token = Symbol(registration.consumerKey);
    consumer.registrations.set(token, registration);

    if (!scope.unsubscribeRevocations) {
      scope.unsubscribeRevocations = this.#subscribeRevocations(
        scope.scope,
        (message) => {
          this.#handle(scope, message);
        },
      );
    }
    if (!scope.unsubscribeProjection) {
      scope.unsubscribeProjection = this.#subscribeProjection(scope.scope, (message) => {
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
        scope.consumers.delete(registration.consumerKey);
      }
      if (scope.consumers.size > 0) return;
      scope.unsubscribeProjection?.();
      scope.unsubscribeRevocations?.();
      scope.unsubscribeProjection = null;
      scope.unsubscribeRevocations = null;
      this.#scopes.delete(scopeKey);
    };
  }

  dispose(): void {
    for (const scope of this.#scopes.values()) {
      scope.unsubscribeProjection?.();
      scope.unsubscribeRevocations?.();
    }
    this.#scopes.clear();
  }

  #handle(scope: ScopeState, message: ProjectionInvalidationCause): void {
    if (projectionScopeKey(message.scope) !== projectionScopeKey(scope.scope)) return;
    scope.latestMessage = laterCause(scope.latestMessage, message);
    for (const consumer of scope.consumers.values()) {
      this.#handleConsumer(consumer, message);
    }
  }

  #handleConsumer(
    consumer: ConsumerState,
    message: ProjectionInvalidationCause,
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
    if (message.kind === "revocation") registration.revoke?.(message);
    if (message.kind === "checkpoint" || message.kind === "reset") {
      registration.fence?.(message);
    }
    this.#schedule(consumer, message);
  }

  #shouldInvalidate(
    registration: ProjectionRegistration,
    message: ProjectionInvalidationCause,
  ): boolean {
    if (message.kind === "revocation") {
      return revocationMatches(
        registration.getDependencies(),
        message.delivery.revocation,
      );
    }
    if (
      registration.projectionEffects === "ignore"
      && message.kind === "effect"
    ) return false;
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

  #schedule(consumer: ConsumerState, message: ProjectionInvalidationCause): void {
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
        && cause.kind !== "revocation"
        && projectionCursorCovers(registration.getCursor(), cause.stream)
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

export const revocationMatches = (
  dependencies: ProjectionDependencies,
  revocation: ProjectionRevocationMessage["delivery"]["revocation"],
): boolean => {
  if (dependencies.aggregate === true) return true;
  const ids = [revocation.resource_id];
  switch (revocation.resource_kind) {
    case "page":
      return intersects(dependencies.pageIds, ids);
    case "document":
      return intersects(dependencies.documentIds, ids);
    case "database":
      return intersects(dependencies.databaseIds, ids);
    case "data_source":
      return intersects(dependencies.dataSourceIds, ids);
    case "view":
      return intersects(dependencies.viewIds, ids);
    case "canvas":
      return intersects(dependencies.canvasIds, ids);
  }
};

const messagePriority = (message: ProjectionInvalidationCause): number => {
  if (message.kind === "reset") return 4;
  if (message.kind === "revocation") return 3;
  if (message.kind === "effect") return 2;
  return 1;
};

const laterCause = (
  current: ProjectionInvalidationCause | null,
  incoming: ProjectionInvalidationCause,
): ProjectionInvalidationCause => {
  if (!current) return incoming;
  if (current.stream.storeEpoch !== incoming.stream.storeEpoch) return incoming;
  if (incoming.stream.commitSeq > current.stream.commitSeq) return incoming;
  if (incoming.stream.commitSeq < current.stream.commitSeq) return current;
  return messagePriority(incoming) >= messagePriority(current)
    ? incoming
    : current;
};
