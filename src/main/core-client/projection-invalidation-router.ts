import type {
  ProjectionCursor,
  ProjectionImpact,
  ProjectionScope,
  ProjectionStreamMessage,
} from "../../shared/projection-stream";
import { projectionScopeKey } from "../../shared/projection-stream";
import type { CoreEventEnvelope } from "./types";

type Listener = (message: ProjectionStreamMessage) => void;

interface ScopeState {
  readonly scope: ProjectionScope;
  readonly listeners: Set<Listener>;
  tail: Promise<void>;
}

export interface ProjectionInvalidationRouterInput {
  readonly libraryId: string;
  readonly initialCursor: ProjectionCursor;
  readonly filterForProject: (
    projectId: string,
    impact: ProjectionImpact,
  ) => Promise<ProjectionImpact>;
  readonly onListenerError?: (error: unknown, scope: ProjectionScope) => void;
  readonly onAuthorizationError?: (error: unknown, scope: ProjectionScope) => void;
}

export class ProjectionInvalidationRouter {
  readonly #libraryId: string;
  readonly #filterForProject: ProjectionInvalidationRouterInput["filterForProject"];
  readonly #onListenerError: ProjectionInvalidationRouterInput["onListenerError"];
  readonly #onAuthorizationError: ProjectionInvalidationRouterInput["onAuthorizationError"];
  readonly #scopes = new Map<string, ScopeState>();
  readonly #accepted = new Map<string, string>();
  readonly #maxRememberedCommits = 100_000;
  #cursor: ProjectionCursor;

  constructor(input: ProjectionInvalidationRouterInput) {
    this.#libraryId = input.libraryId;
    this.#cursor = input.initialCursor;
    this.#filterForProject = input.filterForProject;
    this.#onListenerError = input.onListenerError;
    this.#onAuthorizationError = input.onAuthorizationError;
  }

  get cursor(): ProjectionCursor {
    return this.#cursor;
  }

  get libraryId(): string {
    return this.#libraryId;
  }

  dispose(): void {
    this.#scopes.clear();
    this.#accepted.clear();
  }

  subscribe(scope: ProjectionScope, listener: Listener): () => void {
    this.#assertScope(scope);
    const key = projectionScopeKey(scope);
    const state = this.#scopes.get(key) ?? {
      scope,
      listeners: new Set<Listener>(),
      tail: Promise.resolve(),
    };
    this.#scopes.set(key, state);
    state.listeners.add(listener);
    const checkpointCursor = this.#cursor;
    this.#enqueue(state, () => {
      if (!state.listeners.has(listener)) return;
      this.#deliver(listener, {
        version: 1,
        kind: "checkpoint",
        scope,
        cursor: checkpointCursor,
      }, scope);
    });

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      state.listeners.delete(listener);
      if (state.listeners.size === 0) this.#scopes.delete(key);
    };
  }

  async accept(envelope: CoreEventEnvelope): Promise<void> {
    const identity = `${envelope.event.store_epoch}:${envelope.event.commit_seq}`;
    const knownHash = this.#accepted.get(identity);
    if (knownHash !== undefined) {
      if (knownHash !== envelope.event.canonical_hash) {
        throw new Error(`Projection commit identity collision for ${identity}`);
      }
      return;
    }
    this.#accepted.set(identity, envelope.event.canonical_hash);
    const cursor = {
      storeEpoch: envelope.event.store_epoch,
      commitSeq: envelope.event.commit_seq,
    } satisfies ProjectionCursor;
    this.#admitCursor(cursor);
    const admittedCursor = this.#cursor;
    try {
      const impact = envelope.event.projection_impact;
      if (impact.kind === "none") {
        this.#remember(identity, envelope.event.canonical_hash);
        return;
      }

      const waits: Promise<void>[] = [];
      for (const state of this.#scopes.values()) {
        waits.push(this.#enqueue(state, async () => {
          if (state.scope.kind === "library") {
            this.#publishChanged(
              state,
              admittedCursor,
              impact,
              envelope.event.operation_id,
              envelope.event.committed_at,
            );
            return;
          }
          try {
            const filtered = await this.#filterForProject(
              state.scope.projectId,
              impact,
            );
            if (filtered.kind === "none") return;
            this.#publishChanged(
              state,
              admittedCursor,
              filtered,
              envelope.event.operation_id,
              envelope.event.committed_at,
            );
          } catch (error) {
            this.#onAuthorizationError?.(error, state.scope);
            this.#publishResync(
              state,
              admittedCursor,
              "authorization_filter_failed",
            );
          }
        }));
      }
      await Promise.all(waits);
    } catch (error) {
      this.#accepted.delete(identity);
      throw error;
    }
    this.#remember(identity, envelope.event.canonical_hash);
  }

  async resync(
    cursor: ProjectionCursor,
    reason: Extract<ProjectionStreamMessage, { kind: "resync" }>["reason"],
  ): Promise<void> {
    this.#admitCursor(cursor);
    const acceptedCursor = this.#cursor;
    const waits: Promise<void>[] = [];
    for (const state of this.#scopes.values()) {
      waits.push(this.#enqueue(state, () => {
        this.#publishResync(state, acceptedCursor, reason);
      }));
    }
    await Promise.all(waits);
  }

  async checkpointAll(): Promise<void> {
    const checkpointCursor = this.#cursor;
    const waits: Promise<void>[] = [];
    for (const state of this.#scopes.values()) {
      const publish = () => this.#publish(state, {
        version: 1,
        kind: "checkpoint",
        scope: state.scope,
        cursor: checkpointCursor,
      });
      waits.push(this.#enqueue(state, publish));
    }
    await Promise.all(waits);
  }

  #admitCursor(incoming: ProjectionCursor): void {
    if (incoming.storeEpoch === this.#cursor.storeEpoch) {
      this.#cursor = {
        storeEpoch: incoming.storeEpoch,
        commitSeq: Math.max(this.#cursor.commitSeq, incoming.commitSeq),
      };
      return;
    }
    this.#cursor = incoming;
  }

  #publishChanged(
    state: ScopeState,
    cursor: ProjectionCursor,
    impact: ProjectionImpact,
    operationId?: string | null,
    committedAt?: string,
  ): void {
    this.#publish(state, {
      version: 1,
      kind: "changed",
      scope: state.scope,
      cursor,
      impact,
      ...(operationId === undefined ? {} : { operationId }),
      ...(committedAt === undefined ? {} : { committedAt }),
    });
  }

  #publishResync(
    state: ScopeState,
    cursor: ProjectionCursor,
    reason: Extract<ProjectionStreamMessage, { kind: "resync" }>["reason"],
  ): void {
    this.#publish(state, {
      version: 1,
      kind: "resync",
      scope: state.scope,
      cursor,
      reason,
    });
  }

  #publish(state: ScopeState, message: ProjectionStreamMessage): void {
    for (const listener of [...state.listeners]) {
      this.#deliver(listener, message, state.scope);
    }
  }

  #deliver(
    listener: Listener,
    message: ProjectionStreamMessage,
    scope: ProjectionScope,
  ): void {
    try {
      listener(message);
    } catch (error) {
      this.#onListenerError?.(error, scope);
    }
  }

  #enqueue(state: ScopeState, work: () => void | Promise<void>): Promise<void> {
    const next = state.tail.then(work, work);
    state.tail = next.catch(() => undefined);
    return next;
  }

  #remember(identity: string, hash: string): void {
    this.#accepted.delete(identity);
    this.#accepted.set(identity, hash);
    while (this.#accepted.size > this.#maxRememberedCommits) {
      const oldest = this.#accepted.keys().next().value;
      if (oldest === undefined) return;
      this.#accepted.delete(oldest);
    }
  }

  #assertScope(scope: ProjectionScope): void {
    if (scope.kind !== "library" && scope.kind !== "project") {
      throw new Error("Projection scope kind is invalid");
    }
    if (!scope.libraryId || scope.libraryId.trim() !== scope.libraryId) {
      throw new Error("Projection scope Library identity is invalid");
    }
    if (scope.libraryId !== this.#libraryId) {
      throw new Error("Projection scope targets another Library");
    }
    if (
      scope.kind === "project"
      && (!scope.projectId || scope.projectId.trim() !== scope.projectId)
    ) {
      throw new Error("Projection scope Project identity is invalid");
    }
  }
}
