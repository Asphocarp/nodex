import type { CoreProjectionEffect } from "../../shared/projection-stream";
import type {
  CoreAuthorizedDeliveryPacket,
  CoreAuthorizedModuleEffect,
  CoreStreamCheckpoint,
} from "./types";

export type LocalCommitIngress = "apply" | "tailer" | "replay" | "resolve";
export type LocalCommitLaneKind =
  | "document"
  | "projection"
  | "revocation"
  | "notification";
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
    effect: CoreAuthorizedModuleEffect,
    ingress: LocalCommitIngress,
  ) => void | Promise<void>;
  readonly onRevocation: (
    packet: CoreAuthorizedDeliveryPacket,
    revocation: CoreAuthorizedDeliveryPacket["revocations"][number],
    ingress: LocalCommitIngress,
  ) => void | Promise<void>;
  readonly onError?: (failure: LocalCommitDeliveryError) => void;
  readonly expectedLibraryId: string;
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

interface RememberedResource {
  readonly fingerprint: string;
  readonly completion: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  status: "in_flight" | "completed";
}

interface AdmittedClaim extends ResourceClaim {
  readonly resource: RememberedResource;
}

interface DocumentDelivery {
  readonly documentId: string;
  readonly claims: readonly AdmittedClaim[];
}

interface RememberedCommit {
  readonly manifestHash: string;
  readonly resources: Map<string, RememberedResource>;
}

interface AdmissionResult {
  readonly admission: LocalCommitAdmission;
  readonly completions: readonly Promise<void>[];
}

interface DeliveryLane {
  tail: Promise<void>;
  pending: number;
}

const validateAuthorizationScope = (
  scope: CoreAuthorizedDeliveryPacket["authorization_scope"],
): void => {
  if (!scope.library_id || scope.library_id.trim() !== scope.library_id) {
    throw new Error("Delivery authorization Library is invalid");
  }
  if (
    (scope.kind === "project" || scope.kind === "document")
    && scope.project_id !== null
    && scope.project_id !== undefined
    && (!scope.project_id || scope.project_id.trim() !== scope.project_id)
  ) {
    throw new Error("Delivery authorization Project is invalid");
  }
  if (
    scope.kind === "document"
    && (!scope.document_id || scope.document_id.trim() !== scope.document_id)
  ) {
    throw new Error("Delivery authorization Document is invalid");
  }
};

const authorizationScopeKey = (
  scope: CoreAuthorizedDeliveryPacket["authorization_scope"],
): string => {
  if (scope.kind === "library") {
    return JSON.stringify(["library", scope.library_id]);
  }
  if (scope.kind === "project") {
    return JSON.stringify(["project", scope.library_id, scope.project_id]);
  }
  return JSON.stringify([
    "document",
    scope.library_id,
    scope.project_id ?? null,
    scope.document_id,
  ]);
};

const scopedClaimKey = (
  scope: CoreAuthorizedDeliveryPacket["authorization_scope"],
  claim: string,
): string => `${authorizationScopeKey(scope)}:${claim}`;

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
  validateAuthorizationScope(packet.authorization_scope);
  for (const revocation of packet.revocations) {
    validateAuthorizationScope(revocation.authorization_scope);
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
  const packetClaimKey = (claim: string): string =>
    scopedClaimKey(packet.authorization_scope, claim);
  for (const effect of packet.effects) {
    const semantic = effect.semantic;
    claims.push({
      key: packetClaimKey(`notification:semantic:${semantic.effect_order}`),
      fingerprint: `${semantic.module}:${semantic.effect_kind}:${semantic.payload_hash}`,
    });
    if (effect.payload.module === "owned_document") {
      claims.push({
        key: packetClaimKey(
          `document-control:semantic:${semantic.effect_order}:${effect.payload.event.document_id}`,
        ),
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
      key: packetClaimKey(`document:${coordinate}`),
      fingerprint: `${reference.update_id}:${reference.update_hash}:${reference.update_byte_length}`,
    });
    if (effect.inline_update) {
      claims.push({
        key: packetClaimKey(`document-inline:${coordinate}`),
        fingerprint: `${reference.update_hash}:${reference.update_byte_length}`,
      });
    }
  }
  for (const effect of packet.projection_effects) {
    claims.push({
      key: packetClaimKey(
        `projection:${effect.scope.canonical_key}:${effect.result_revision}`,
      ),
      fingerprint: effect.effect_hash,
    });
  }
  for (const revocation of packet.revocations) {
    claims.push({
      key: scopedClaimKey(
        revocation.authorization_scope,
        `revocation:${revocation.resource_kind}:${revocation.resource_id}`,
      ),
      fingerprint: revocation.reason,
    });
  }
  return claims;
};

const rememberedResource = (fingerprint: string): RememberedResource => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // Apply-response admission is deliberately fire-and-forget. Attach a
  // rejection observer immediately; durable ingress can still await the
  // original Promise and turn terminal lane failure into stream replay.
  void completion.catch(() => undefined);
  return {
    fingerprint,
    completion,
    resolve,
    reject,
    status: "in_flight",
  };
};

const documentDeliveries = (
  packet: CoreAuthorizedDeliveryPacket,
  admittedByKey: ReadonlyMap<string, AdmittedClaim>,
): readonly DocumentDelivery[] => {
  const claimsByDocument = new Map<string, AdmittedClaim[]>();
  const packetClaimKey = (claim: string): string =>
    scopedClaimKey(packet.authorization_scope, claim);
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
    add(reference.document_id, packetClaimKey(`document:${coordinate}`));
    add(reference.document_id, packetClaimKey(`document-inline:${coordinate}`));
  }
  for (const effect of packet.effects) {
    if (effect.payload.module !== "owned_document") continue;
    const documentId = effect.payload.event.document_id;
    add(
      documentId,
      packetClaimKey(
        `document-control:semantic:${effect.semantic.effect_order}:${documentId}`,
      ),
    );
  }
  return [...claimsByDocument]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([documentId, claims]) => ({ documentId, claims }));
};

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
    revocation: new Map(),
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
    return this.#admit(packet, ingress).admission;
  }

  /**
   * Durable ingress uses the same synchronous admission path, then waits for
   * every resource claim represented by the packet. If apply already owns an
   * in-flight claim, the tailer attaches to that exact completion instead of
   * treating the packet as a finished duplicate. A terminal lane failure
   * therefore rejects stream delivery before its checkpoint can advance.
   */
  async admitAndWait(
    packet: CoreAuthorizedDeliveryPacket,
    ingress: Exclude<LocalCommitIngress, "apply">,
  ): Promise<LocalCommitAdmission> {
    const admitted = this.#admit(packet, ingress);
    await Promise.all(admitted.completions);
    return admitted.admission;
  }

  #admit(
    packet: CoreAuthorizedDeliveryPacket,
    ingress: LocalCommitIngress,
  ): AdmissionResult {
    const identity = identityOf(packet);
    if (identity.storeEpoch !== this.#input.expectedStoreEpoch) {
      throw new Error(`Commit belongs to another Store epoch: ${identity.key}`);
    }
    if (packet.authorization_scope.library_id !== this.#input.expectedLibraryId) {
      throw new Error("Commit delivery belongs to another Library");
    }
    if (packet.revocations.some(
      (revocation) =>
        revocation.authorization_scope.library_id !== this.#input.expectedLibraryId,
    )) {
      throw new Error("Commit revocation belongs to another Library");
    }
    const claims = resourceClaims(packet);
    const remembered = this.#remembered.get(identity.key);
    if (remembered && remembered.manifestHash !== identity.manifestHash) {
      throw new Error(`Commit manifest identity collision for ${identity.key}`);
    }
    const state = remembered ?? {
      manifestHash: identity.manifestHash,
      resources: new Map<string, RememberedResource>(),
    };
    const admittedByKey = new Map<string, AdmittedClaim>();
    const completions = new Set<Promise<void>>();
    for (const claim of claims) {
      const known = state.resources.get(claim.key);
      if (known !== undefined && known.fingerprint !== claim.fingerprint) {
        throw new Error(`Commit resource identity collision for ${identity.key}:${claim.key}`);
      }
      if (known !== undefined) {
        completions.add(known.completion);
        continue;
      }
      const resource = rememberedResource(claim.fingerprint);
      const admitted = { ...claim, resource };
      state.resources.set(claim.key, resource);
      admittedByKey.set(claim.key, admitted);
      completions.add(resource.completion);
    }
    if (!remembered) this.#remembered.set(identity.key, state);
    this.#touch(identity.key, state);
    if (admittedByKey.size === 0) {
      return {
        admission: { kind: "duplicate", key: identity.key },
        completions: [...completions],
      };
    }

    for (const revocation of packet.revocations) {
      const scopeKey = authorizationScopeKey(revocation.authorization_scope);
      const key = scopedClaimKey(
        revocation.authorization_scope,
        `revocation:${revocation.resource_kind}:${revocation.resource_id}`,
      );
      const claim = admittedByKey.get(key);
      if (!claim) continue;
      this.#schedule(
        "revocation",
        `${scopeKey}:${revocation.resource_kind}:${revocation.resource_id}`,
        packet,
        [claim],
        () => this.#input.onRevocation(packet, revocation, ingress),
      );
    }
    for (const delivery of documentDeliveries(packet, admittedByKey)) {
      this.#schedule(
        "document",
        delivery.documentId,
        packet,
        delivery.claims,
        () => this.#input.onDocument(packet, delivery.documentId, ingress),
      );
    }
    for (const effect of packet.projection_effects) {
      const key = scopedClaimKey(
        packet.authorization_scope,
        `projection:${effect.scope.canonical_key}:${effect.result_revision}`,
      );
      const claim = admittedByKey.get(key);
      if (!claim) continue;
      this.#schedule(
        "projection",
        effect.scope.canonical_key,
        packet,
        [claim],
        () => this.#input.onProjection(packet, effect, ingress),
      );
    }
    for (const effect of packet.effects) {
      const key = scopedClaimKey(
        packet.authorization_scope,
        `notification:semantic:${effect.semantic.effect_order}`,
      );
      const claim = admittedByKey.get(key);
      if (!claim) continue;
      this.#schedule(
        "notification",
        identity.key,
        packet,
        [claim],
        () => this.#input.onNotification(packet, effect, ingress),
      );
    }
    return {
      admission: {
        kind: remembered ? "enriched" : "accepted",
        key: identity.key,
      },
      completions: [...completions],
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
        revocation: this.#lanes.revocation.size,
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
    claims: readonly AdmittedClaim[],
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
          this.#completeClaims(claims);
          return;
        } catch (error) {
          lastError = error;
        }
      }
      const failure = lastError ?? new Error("LocalCommit delivery failed");
      this.#failClaims(packet, claims, failure);
      try {
        this.#input.onError?.({ lane: kind, laneKey, packet, error: failure });
      } catch {
        // Delivery failure remains represented by the rejected resource claim.
      }
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

  #completeClaims(claims: readonly AdmittedClaim[]): void {
    for (const claim of claims) {
      if (claim.resource.status === "completed") continue;
      claim.resource.status = "completed";
      claim.resource.resolve();
    }
    this.#trimRemembered();
  }

  #failClaims(
    packet: CoreAuthorizedDeliveryPacket,
    claims: readonly AdmittedClaim[],
    error: unknown,
  ): void {
    const identity = identityOf(packet);
    const remembered = this.#remembered.get(identity.key);
    if (!remembered) return;
    for (const claim of claims) {
      if (remembered.resources.get(claim.key) !== claim.resource) continue;
      remembered.resources.delete(claim.key);
      claim.resource.reject(error);
    }
    if (remembered.resources.size === 0) this.#remembered.delete(identity.key);
    this.#trimRemembered();
  }

  #touch(key: string, value: RememberedCommit): void {
    this.#remembered.delete(key);
    this.#remembered.set(key, value);
    this.#trimRemembered();
  }

  #trimRemembered(): void {
    while (this.#remembered.size > this.#maxRememberedCommits) {
      const removable = [...this.#remembered].find(([, commit]) =>
        [...commit.resources.values()].every((resource) => resource.status === "completed")
      );
      if (!removable) return;
      this.#remembered.delete(removable[0]);
    }
  }
}
