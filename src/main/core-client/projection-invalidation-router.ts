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
    const cursor = {
      storeEpoch: envelope.event.store_epoch,
      changeLogSeq: envelope.event.sequence,
    } satisfies ProjectionCursor;
    this.#cursor = cursor;
    const impact = envelope.event.projection_impact;
    if (impact.kind === "none") return;

    const waits: Promise<void>[] = [];
    for (const state of this.#scopes.values()) {
      waits.push(this.#enqueue(state, async () => {
        if (state.scope.kind === "library") {
          this.#publishChanged(state, cursor, impact);
          return;
        }
        try {
          const filtered = await this.#filterForProject(
            state.scope.projectId,
            impact,
          );
          if (filtered.kind === "none") return;
          this.#publishChanged(state, cursor, filtered);
        } catch (error) {
          this.#onAuthorizationError?.(error, state.scope);
          this.#publishResync(
            state,
            cursor,
            "authorization_filter_failed",
          );
        }
      }));
    }
    await Promise.all(waits);
  }

  async resync(
    cursor: ProjectionCursor,
    reason: Extract<ProjectionStreamMessage, { kind: "resync" }>["reason"],
  ): Promise<void> {
    this.#cursor = cursor;
    const waits: Promise<void>[] = [];
    for (const state of this.#scopes.values()) {
      waits.push(this.#enqueue(state, () => {
        this.#publishResync(state, cursor, reason);
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

  #publishChanged(
    state: ScopeState,
    cursor: ProjectionCursor,
    impact: ProjectionImpact,
  ): void {
    this.#publish(state, {
      version: 1,
      kind: "changed",
      scope: state.scope,
      cursor,
      impact,
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
