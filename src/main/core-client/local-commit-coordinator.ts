import type { CoreProjectionEffect } from "../../shared/projection-stream";
import type {
  CoreAuthorizedDeliveryPacket,
  CoreStreamCheckpoint,
} from "./types";

export type LocalCommitIngress = "apply" | "tailer" | "replay" | "resolve";
export type LocalCommitLaneKind = "document" | "projection" | "notification";
export type LocalCommitStreamResetReason =
  | "event_gap"
  | "reconnect"
  | "store_epoch_changed";

export type LocalCommitAdmission =
  | { readonly kind: "accepted"; readonly key: string }
  | { readonly kind: "duplicate"; readonly key: string }
  | { readonly kind: "enriched"; readonly key: string };

export interface LocalCommitDeliveryError {
  readonly lane: LocalCommitLaneKind;
  readonly laneKey: string;
  readonly packet: CoreAuthorizedDeliveryPacket;
  readonly error: unknown;
}

export interface LocalCommitCoordinatorInput {
  readonly onDocument: (
    packet: CoreAuthorizedDeliveryPacket,
    documentId: string,
    ingress: LocalCommitIngress,
  ) => void | Promise<void>;
  readonly onProjection: (
    packet: CoreAuthorizedDeliveryPacket,
    effect: CoreProjectionEffect,
    ingress: LocalCommitIngress,
  ) => void | Promise<void>;
  readonly onNotification: (
    packet: CoreAuthorizedDeliveryPacket,
    ingress: LocalCommitIngress,
  ) => void | Promise<void>;
  readonly onError?: (failure: LocalCommitDeliveryError) => void;
  readonly expectedStoreEpoch: string;
  readonly maxRememberedCommits?: number;
  readonly maxDeliveryAttempts?: number;
}

export interface LocalCommitCoordinatorDiagnostics {
  readonly rememberedCommits: number;
  readonly activeLanes: Readonly<Record<LocalCommitLaneKind, number>>;
  readonly pendingDeliveries: number;
  readonly checkpoint: CoreStreamCheckpoint | null;
  readonly lastResetReason: LocalCommitStreamResetReason | null;
}

interface ResourceClaim {
  readonly key: string;
  readonly fingerprint: string;
}

interface DocumentDelivery {
  readonly documentId: string;
  readonly claims: readonly ResourceClaim[];
}

interface RememberedCommit {
  readonly manifestHash: string;
  readonly resources: Map<string, string>;
}

interface DeliveryLane {
  tail: Promise<void>;
  pending: number;
}

const identityOf = (packet: CoreAuthorizedDeliveryPacket) => {
  const identity = packet.manifest.identity;
  if (!Number.isSafeInteger(identity.commit_seq) || identity.commit_seq < 1) {
    throw new Error("Commit manifest sequence is invalid");
  }
  if (!identity.store_epoch || identity.store_epoch.trim() !== identity.store_epoch) {
    throw new Error("Commit manifest Store epoch is invalid");
  }
  if (!/^[a-f0-9]{64}$/u.test(identity.manifest_hash)) {
    throw new Error("Commit manifest hash is invalid");
  }
  if (!/^[a-f0-9]{64}$/u.test(packet.packet_hash)) {
    throw new Error("Authorized delivery packet hash is invalid");
  }
  if (
    !packet.manifest.operation_id
    || packet.manifest.operation_id.trim() !== packet.manifest.operation_id
    || !packet.manifest.committed_at
  ) {
    throw new Error("Authorized delivery packet manifest header is invalid");
  }
  validateCoverage(packet);
  return {
    key: `${identity.store_epoch}:${identity.commit_seq}`,
    storeEpoch: identity.store_epoch,
    manifestHash: identity.manifest_hash,
  };
};

const sameValues = <Value>(
  actual: readonly Value[],
  expected: readonly Value[],
): boolean => actual.length === expected.length
  && actual.every((value, index) => value === expected[index]);

const validateCoverage = (packet: CoreAuthorizedDeliveryPacket): void => {
  const semanticOrders = packet.effects.map(
    (effect) => effect.semantic.effect_order,
  );
  const documentOrders = packet.document_effects.map(
    (effect) => effect.reference.effect_order,
  );
  const inlineDocumentOrders = packet.document_effects
    .filter((effect) => Boolean(effect.inline_update))
    .map((effect) => effect.reference.effect_order);
  const projectionScopeKeys = packet.projection_effects.map(
    (effect) => effect.scope.canonical_key,
  );
  if (
    !sameValues(packet.coverage.semantic_effect_orders, semanticOrders)
    || !sameValues(packet.coverage.document_effect_orders, documentOrders)
    || !sameValues(
      packet.coverage.inline_document_effect_orders,
      inlineDocumentOrders,
    )
    || !sameValues(packet.coverage.projection_scope_keys, projectionScopeKeys)
  ) {
    throw new Error("Authorized delivery packet coverage is inconsistent");
  }
  for (const effect of packet.projection_effects) {
    if (
      !effect.scope.canonical_key
      || effect.scope.schema_version < 1
      || effect.base_revision < 0
      || effect.result_revision !== effect.base_revision + 1
      || effect.covered_commit_seq !== packet.manifest.identity.commit_seq
      || !/^[a-f0-9]{64}$/u.test(effect.effect_hash)
    ) {
      throw new Error("Authorized Projection effect is invalid");
    }
  }
};

const resourceClaims = (
  packet: CoreAuthorizedDeliveryPacket,
): readonly ResourceClaim[] => {
  const claims: ResourceClaim[] = [];
  for (const effect of packet.effects) {
    const semantic = effect.semantic;
    claims.push({
      key: `notification:semantic:${semantic.effect_order}`,
      fingerprint: `${semantic.module}:${semantic.effect_kind}:${semantic.payload_hash}`,
    });
    if (effect.payload.module === "owned_document") {
      claims.push({
        key: `document-control:semantic:${semantic.effect_order}:${effect.payload.event.document_id}`,
        fingerprint: `${semantic.effect_kind}:${semantic.payload_hash}`,
      });
    }
  }
  for (const effect of packet.document_effects) {
    const reference = effect.reference;
    const coordinate = [
      reference.document_id,
      reference.generation,
      reference.base_head_seq,
      reference.result_head_seq,
      reference.effect_order,
    ].join(":");
    claims.push({
      key: `document:${coordinate}`,
      fingerprint: `${reference.update_id}:${reference.update_hash}:${reference.update_byte_length}`,
    });
    if (effect.inline_update) {
      claims.push({
        key: `document-inline:${coordinate}`,
        fingerprint: `${reference.update_hash}:${reference.update_byte_length}`,
      });
    }
  }
  for (const effect of packet.projection_effects) {
    claims.push({
      key: `projection:${effect.scope.canonical_key}:${effect.result_revision}`,
      fingerprint: effect.effect_hash,
    });
  }
  for (const revocation of packet.revocations) {
    claims.push({
      key: `notification:revocation:${revocation.resource_kind}:${revocation.resource_id}`,
      fingerprint: revocation.reason,
    });
    if (revocation.resource_kind === "document") {
      claims.push({
        key: `document-control:revocation:${revocation.resource_id}`,
        fingerprint: revocation.reason,
      });
    }
  }
  return claims;
};

const documentDeliveries = (
  packet: CoreAuthorizedDeliveryPacket,
  admitted: readonly ResourceClaim[],
): readonly DocumentDelivery[] => {
  const admittedByKey = new Map(admitted.map((claim) => [claim.key, claim]));
  const claimsByDocument = new Map<string, ResourceClaim[]>();
  const add = (documentId: string, key: string): void => {
    const claim = admittedByKey.get(key);
    if (!claim) return;
    const claims = claimsByDocument.get(documentId) ?? [];
    claims.push(claim);
    claimsByDocument.set(documentId, claims);
  };
  for (const effect of packet.document_effects) {
    const reference = effect.reference;
    const coordinate = [
      reference.document_id,
      reference.generation,
      reference.base_head_seq,
      reference.result_head_seq,
      reference.effect_order,
    ].join(":");
    add(reference.document_id, `document:${coordinate}`);
    add(reference.document_id, `document-inline:${coordinate}`);
  }
  for (const effect of packet.effects) {
    if (effect.payload.module !== "owned_document") continue;
    const documentId = effect.payload.event.document_id;
    add(
      documentId,
      `document-control:semantic:${effect.semantic.effect_order}:${documentId}`,
    );
  }
  for (const revocation of packet.revocations) {
    if (revocation.resource_kind !== "document") continue;
    add(
      revocation.resource_id,
      `document-control:revocation:${revocation.resource_id}`,
    );
  }
  return [...claimsByDocument]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([documentId, claims]) => ({ documentId, claims }));
};

const hasNotificationDelivery = (claims: readonly ResourceClaim[]): boolean =>
  claims.some((claim) => claim.key.startsWith("notification:"));

/**
 * Synchronously admits one authorized packet, then fans its resource effects
 * into independently keyed causal lanes. Durable-stream progress is observed
 * separately and never gates the apply-response fast path.
 */
export class LocalCommitCoordinator {
  readonly #input: LocalCommitCoordinatorInput;
  readonly #maxRememberedCommits: number;
  readonly #maxDeliveryAttempts: number;
  readonly #remembered = new Map<string, RememberedCommit>();
  readonly #lanes: Record<LocalCommitLaneKind, Map<string, DeliveryLane>> = {
    document: new Map(),
    projection: new Map(),
    notification: new Map(),
  };
  #pendingDeliveries = 0;
  #checkpoint: CoreStreamCheckpoint | null = null;
  #lastResetReason: LocalCommitStreamResetReason | null = null;

  constructor(input: LocalCommitCoordinatorInput) {
    this.#input = input;
    this.#maxRememberedCommits = Math.max(
      1,
      Math.floor(input.maxRememberedCommits ?? 100_000),
    );
    this.#maxDeliveryAttempts = Math.max(
      1,
      Math.floor(input.maxDeliveryAttempts ?? 3),
    );
  }

  admit(
    packet: CoreAuthorizedDeliveryPacket,
    ingress: LocalCommitIngress,
  ): LocalCommitAdmission {
    const identity = identityOf(packet);
    if (identity.storeEpoch !== this.#input.expectedStoreEpoch) {
      throw new Error(`Commit belongs to another Store epoch: ${identity.key}`);
    }
    const claims = resourceClaims(packet);
    const remembered = this.#remembered.get(identity.key);
    if (remembered && remembered.manifestHash !== identity.manifestHash) {
      throw new Error(`Commit manifest identity collision for ${identity.key}`);
    }
    const state = remembered ?? {
      manifestHash: identity.manifestHash,
      resources: new Map<string, string>(),
    };
    const admitted: ResourceClaim[] = [];
    for (const claim of claims) {
      const known = state.resources.get(claim.key);
      if (known !== undefined && known !== claim.fingerprint) {
        throw new Error(`Commit resource identity collision for ${identity.key}:${claim.key}`);
      }
      if (known !== undefined) continue;
      state.resources.set(claim.key, claim.fingerprint);
      admitted.push(claim);
    }
    if (!remembered) this.#remembered.set(identity.key, state);
    this.#touch(identity.key, state);
    if (admitted.length === 0) return { kind: "duplicate", key: identity.key };

    for (const delivery of documentDeliveries(packet, admitted)) {
      this.#schedule(
        "document",
        delivery.documentId,
        packet,
        delivery.claims,
        () => this.#input.onDocument(packet, delivery.documentId, ingress),
      );
    }
    const admittedProjectionKeys = new Set(
      admitted
        .filter((claim) => claim.key.startsWith("projection:"))
        .map((claim) => claim.key),
    );
    for (const effect of packet.projection_effects) {
      const key = `projection:${effect.scope.canonical_key}:${effect.result_revision}`;
      if (!admittedProjectionKeys.has(key)) continue;
      this.#schedule(
        "projection",
        effect.scope.canonical_key,
        packet,
        admitted.filter((claim) => claim.key === key),
        () => this.#input.onProjection(packet, effect, ingress),
      );
    }
    if (hasNotificationDelivery(admitted)) {
      this.#schedule(
        "notification",
        identity.key,
        packet,
        admitted.filter((claim) => claim.key.startsWith("notification:")),
        () => this.#input.onNotification(packet, ingress),
      );
    }
    return {
      kind: remembered ? "enriched" : "accepted",
      key: identity.key,
    };
  }

  observeCheckpoint(checkpoint: CoreStreamCheckpoint): void {
    if (checkpoint.store_epoch !== this.#input.expectedStoreEpoch) {
      throw new Error("Stream checkpoint belongs to another Store epoch");
    }
    if (
      this.#checkpoint
      && checkpoint.generation === this.#checkpoint.generation
      && checkpoint.scanned_through_seq < this.#checkpoint.scanned_through_seq
    ) {
      throw new Error("Stream checkpoint moved backwards");
    }
    this.#checkpoint = checkpoint;
  }

  resetStream(reason: LocalCommitStreamResetReason): void {
    this.#lastResetReason = reason;
    this.#checkpoint = null;
  }

  diagnostics(): LocalCommitCoordinatorDiagnostics {
    return {
      rememberedCommits: this.#remembered.size,
      activeLanes: {
        document: this.#lanes.document.size,
        projection: this.#lanes.projection.size,
        notification: this.#lanes.notification.size,
      },
      pendingDeliveries: this.#pendingDeliveries,
      checkpoint: this.#checkpoint,
      lastResetReason: this.#lastResetReason,
    };
  }

  #schedule(
    kind: LocalCommitLaneKind,
    laneKey: string,
    packet: CoreAuthorizedDeliveryPacket,
    claims: readonly ResourceClaim[],
    work: () => void | Promise<void>,
  ): void {
    const lanes = this.#lanes[kind];
    const lane = lanes.get(laneKey) ?? { tail: Promise.resolve(), pending: 0 };
    lanes.set(laneKey, lane);
    lane.pending += 1;
    this.#pendingDeliveries += 1;
    const run = async (): Promise<void> => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < this.#maxDeliveryAttempts; attempt += 1) {
        try {
          await work();
          return;
        } catch (error) {
          lastError = error;
        }
      }
      this.#releaseClaims(packet, claims);
      this.#input.onError?.({ lane: kind, laneKey, packet, error: lastError });
    };
    const next = lane.tail.then(
      () => new Promise<void>((resolve) => queueMicrotask(() => void run().finally(resolve))),
      () => new Promise<void>((resolve) => queueMicrotask(() => void run().finally(resolve))),
    );
    const settled = next.finally(() => {
      lane.pending -= 1;
      this.#pendingDeliveries -= 1;
      if (lane.pending === 0 && lane.tail === settled) lanes.delete(laneKey);
    });
    lane.tail = settled;
  }

  #releaseClaims(
    packet: CoreAuthorizedDeliveryPacket,
    claims: readonly ResourceClaim[],
  ): void {
    const identity = identityOf(packet);
    const remembered = this.#remembered.get(identity.key);
    if (!remembered) return;
    for (const claim of claims) {
      if (remembered.resources.get(claim.key) === claim.fingerprint) {
        remembered.resources.delete(claim.key);
      }
    }
    if (remembered.resources.size === 0) this.#remembered.delete(identity.key);
  }

  #touch(key: string, value: RememberedCommit): void {
    this.#remembered.delete(key);
    this.#remembered.set(key, value);
    while (this.#remembered.size > this.#maxRememberedCommits) {
      const oldest = this.#remembered.keys().next().value;
      if (oldest === undefined) return;
      this.#remembered.delete(oldest);
    }
  }
}
