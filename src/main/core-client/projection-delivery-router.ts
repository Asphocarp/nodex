import type {
  CoreProjectionEffect,
  ProjectionCursor,
  ProjectionDelivery,
  ProjectionEffect,
  ProjectionPatch,
  ProjectionScope,
  ProjectionStreamMessage,
} from "../../shared/projection-stream";
import { projectionScopeKey } from "../../shared/projection-stream";
import { projectCoreDatabaseRowSummaries } from "./database-page-projection";
import type { CoreAuthorizedDeliveryPacket } from "./types";

type Listener = (message: ProjectionStreamMessage) => void;

interface ScopeState {
  readonly scope: ProjectionScope;
  readonly listeners: Set<Listener>;
}

export interface ProjectionDeliveryRouterInput {
  readonly libraryId: string;
  readonly initialCursor: ProjectionCursor;
  readonly onListenerError?: (error: unknown, scope: ProjectionScope) => void;
}

const projectIdOf = (
  effect: CoreProjectionEffect,
): string | null => {
  const scope = effect.scope.scope;
  return scope.kind === "library" ? null : scope.project_id;
};

const scopeCanReceive = (
  subscription: ProjectionScope,
  effect: CoreProjectionEffect,
): boolean => {
  if (subscription.kind === "library") return true;
  return projectIdOf(effect) === subscription.projectId;
};

const mapPatch = (
  patch: CoreProjectionEffect["patch"],
): ProjectionPatch | null => {
  if (!patch) return null;
  if (patch.kind === "page_changed") {
    return {
      kind: patch.kind,
      projectId: patch.project_id,
      pageId: patch.page_id,
    };
  }
  if (patch.kind === "database_row_remove") {
    return {
      kind: patch.kind,
      projectId: patch.project_id,
      databaseId: patch.database_id,
      dataSourceId: patch.data_source_id,
      viewId: patch.view_id,
      pageId: patch.page_id,
      totalRows: patch.total_rows,
      groupKey: patch.group_key ?? null,
      groupTotal: patch.group_total ?? null,
    };
  }
  const row = projectCoreDatabaseRowSummaries([patch.row])[0];
  if (!row) throw new Error("Projection row patch is empty");
  return {
    kind: patch.kind,
    projectId: patch.project_id,
    databaseId: patch.database_id,
    dataSourceId: patch.data_source_id,
    viewId: patch.view_id,
    row,
    sourceRow: patch.row,
    effectiveGroupKey: patch.row.effective_group_key ?? null,
    rankKey: patch.row.rank_key ?? null,
    totalRows: patch.total_rows,
    groupTotal: patch.group_total ?? null,
  };
};

const mapEffect = (effect: CoreProjectionEffect): ProjectionEffect => ({
  scope: effect.scope,
  baseRevision: effect.base_revision,
  resultRevision: effect.result_revision,
  coveredCommitSeq: effect.covered_commit_seq,
  patch: mapPatch(effect.patch),
  requiresReadAtLeast: effect.requires_read_at_least,
  effectHash: effect.effect_hash,
});

const deliveryOf = (
  packet: CoreAuthorizedDeliveryPacket,
  effect: CoreProjectionEffect,
): ProjectionDelivery => ({
  storeEpoch: packet.manifest.identity.store_epoch,
  commitSeq: packet.manifest.identity.commit_seq,
  manifestHash: packet.manifest.identity.manifest_hash,
  operationId: packet.manifest.operation_id,
  committedAt: packet.manifest.committed_at,
  impact: packet.projection_impact,
  effect: mapEffect(effect),
});

const packetCursor = (
  packet: CoreAuthorizedDeliveryPacket,
): ProjectionCursor => ({
  storeEpoch: packet.manifest.identity.store_epoch,
  commitSeq: packet.manifest.identity.commit_seq,
});

/**
 * Routes already-authorized projection effects without performing reads.
 * Scope ordering belongs to LocalCommitCoordinator; this Adapter only maps
 * Core wire values and isolates renderer listeners.
 */
export class ProjectionDeliveryRouter {
  readonly #libraryId: string;
  readonly #onListenerError: ProjectionDeliveryRouterInput["onListenerError"];
  readonly #scopes = new Map<string, ScopeState>();
  #cursor: ProjectionCursor;

  constructor(input: ProjectionDeliveryRouterInput) {
    this.#libraryId = input.libraryId;
    this.#cursor = input.initialCursor;
    this.#onListenerError = input.onListenerError;
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
    };
    this.#scopes.set(key, state);
    state.listeners.add(listener);
    this.#deliver(listener, {
      version: 2,
      kind: "checkpoint",
      scope,
      stream: this.#cursor,
    }, scope);
    return () => {
      state.listeners.delete(listener);
      if (state.listeners.size === 0) this.#scopes.delete(key);
    };
  }

  publish(
    packet: CoreAuthorizedDeliveryPacket,
    effect: CoreProjectionEffect,
  ): void {
    const delivery = deliveryOf(packet, effect);
    for (const state of this.#scopes.values()) {
      if (!scopeCanReceive(state.scope, effect)) continue;
      this.#publish(state, {
        version: 2,
        kind: "effect",
        scope: state.scope,
        stream: packetCursor(packet),
        delivery,
      });
    }
  }

  observeCheckpoint(cursor: ProjectionCursor): void {
    this.#observe(cursor);
    for (const state of this.#scopes.values()) {
      this.#publish(state, {
        version: 2,
        kind: "checkpoint",
        scope: state.scope,
        stream: this.#cursor,
      });
    }
  }

  reset(
    cursor: ProjectionCursor,
    reason: Extract<ProjectionStreamMessage, { kind: "reset" }>["reason"],
  ): void {
    this.#cursor = cursor;
    for (const state of this.#scopes.values()) {
      this.#publish(state, {
        version: 2,
        kind: "reset",
        scope: state.scope,
        stream: cursor,
        reason,
      });
    }
  }

  #observe(incoming: ProjectionCursor): void {
    if (incoming.storeEpoch !== this.#cursor.storeEpoch) {
      this.#cursor = incoming;
      return;
    }
    this.#cursor = {
      storeEpoch: incoming.storeEpoch,
      commitSeq: Math.max(this.#cursor.commitSeq, incoming.commitSeq),
    };
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

  #assertScope(scope: ProjectionScope): void {
    if (!scope.libraryId || scope.libraryId.trim() !== scope.libraryId) {
      throw new Error("Projection subscription Library identity is invalid");
    }
    if (scope.libraryId !== this.#libraryId) {
      throw new Error("Projection subscription targets another Library");
    }
    if (
      scope.kind === "project"
      && (!scope.projectId || scope.projectId.trim() !== scope.projectId)
    ) {
      throw new Error("Projection subscription Project identity is invalid");
    }
  }
}
