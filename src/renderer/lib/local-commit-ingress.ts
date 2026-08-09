import type { DocumentSyncRealtimeEvent } from "../../shared/block-documents/document-sync";
import {
  projectionMessageFromDelivery,
  projectionScopeCanReceive,
  revocationMessageFromDelivery,
  revocationScopeCanReceive,
  type AuthorizedDeliveryPacket,
  type LocalCommitApply,
} from "../../shared/local-commit-delivery";
import {
  projectionScopeKey,
  type ProjectionScope,
  type ProjectionStreamMessage,
} from "../../shared/projection-stream";
import type { ResourceRevocationMessage } from "../../shared/resource-revocation-stream";

type ProjectionListener = (message: ProjectionStreamMessage) => void;
type RevocationListener = (message: ResourceRevocationMessage) => void;
type DocumentListener = (event: DocumentSyncRealtimeEvent) => void;
type Atom = AuthorizedDeliveryPacket["atoms"][number];
type AtomListener = (
  packet: AuthorizedDeliveryPacket,
  atom: Atom,
) => void;

export type RendererLocalCommitAdmission =
  | { readonly kind: "no_op" }
  | { readonly kind: "accepted"; readonly commitKey: string }
  | { readonly kind: "duplicate"; readonly commitKey: string }
  | { readonly kind: "enriched"; readonly commitKey: string };

export class LocalCommitIngressCapacityError extends Error {
  constructor() {
    super("Renderer local commit ingress is at capacity");
    this.name = "LocalCommitIngressCapacityError";
  }
}

interface RememberedClaim {
  readonly fingerprint: string;
}

interface RememberedCommit {
  readonly manifestHash: string;
  readonly claims: Map<string, RememberedClaim>;
}

interface PreparedDocumentEvent {
  readonly key: string;
  readonly fingerprint: string;
  readonly event: DocumentSyncRealtimeEvent;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const DEFAULT_MAX_REMEMBERED_COMMITS = 100_000;
const DEFAULT_MAX_IN_FLIGHT_ADMISSIONS = 256;

const validateProjectionMessage = (message: ProjectionStreamMessage): void => {
  if (
    message.version !== 2
    || !message.scope.libraryId
    || message.scope.libraryId !== message.scope.libraryId.trim()
    || (
      message.scope.kind === "project"
      && (
        !message.scope.projectId
        || message.scope.projectId !== message.scope.projectId.trim()
      )
    )
    || !message.stream.storeEpoch
    || !Number.isSafeInteger(message.stream.commitSeq)
    || message.stream.commitSeq < 0
  ) throw new TypeError("Projection delivery coordinate is invalid");
  if (message.kind !== "effect") return;
  const effectScope = message.delivery.effect.scope.scope;
  if (
    message.delivery.storeEpoch !== message.stream.storeEpoch
    || message.delivery.commitSeq !== message.stream.commitSeq
    || !HASH_PATTERN.test(message.delivery.manifestHash)
    || message.delivery.effect.resultRevision
      !== message.delivery.effect.baseRevision + 1
    || message.delivery.effect.coveredCommitSeq !== message.delivery.commitSeq
    || !HASH_PATTERN.test(message.delivery.effect.effectHash)
    || (
      message.scope.kind === "project"
      && (
        effectScope.kind === "library"
        || effectScope.project_id !== message.scope.projectId
      )
    )
  ) throw new TypeError("Projection delivery effect is invalid");
};

const validateRevocationMessage = (message: ResourceRevocationMessage): void => {
  if (message.kind === "reset") {
    if (
      message.version !== 1
      || !message.stream.storeEpoch
      || !Number.isSafeInteger(message.stream.commitSeq)
      || message.stream.commitSeq < 0
      || (
        message.reason !== "event_gap"
        && message.reason !== "reconnect"
        && message.reason !== "store_epoch_changed"
        && message.reason !== "recipient_delivery_failed"
      )
    ) throw new TypeError("Resource revocation reset is invalid");
    return;
  }
  const revocation = message.delivery.revocation;
  if (
    message.version !== 1
    || message.stream.storeEpoch !== message.delivery.storeEpoch
    || message.stream.commitSeq !== message.delivery.commitSeq
    || !message.delivery.storeEpoch
    || !Number.isSafeInteger(message.delivery.commitSeq)
    || message.delivery.commitSeq < 1
    || !HASH_PATTERN.test(message.delivery.manifestHash)
    || !revocation.resource_id
    || !revocation.reason
    || !revocationScopeCanReceive(message.scope, revocation)
  ) throw new TypeError("Resource revocation delivery is invalid");
};

const sameValues = <Value>(
  actual: readonly Value[],
  expected: readonly Value[],
): boolean => actual.length === expected.length
  && actual.every((value, index) => value === expected[index]);

const bytesToHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const copy = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return bytesToHex(digest);
};

const validatePacket = (packet: AuthorizedDeliveryPacket): void => {
  const identity = packet.manifest.identity;
  if (
    packet.packet_version !== 3
    || !identity.store_epoch
    || identity.store_epoch !== identity.store_epoch.trim()
    || !Number.isSafeInteger(identity.commit_seq)
    || identity.commit_seq < 1
    || !HASH_PATTERN.test(identity.manifest_hash)
    || !HASH_PATTERN.test(packet.packet_hash)
  ) {
    throw new TypeError("Authorized local commit packet identity is invalid");
  }
  if (
    !packet.authorization_scope.library_id
    || packet.authorization_scope.library_id
      !== packet.authorization_scope.library_id.trim()
  ) {
    throw new TypeError("Authorized local commit packet scope is invalid");
  }
  const atomIds = packet.atoms.map((atom) => atom.descriptor.atom_id);
  const documentOrders = packet.document_effects.map(
    (effect) => effect.reference.effect_order,
  );
  const inlineDocumentOrders = packet.document_effects
    .filter((effect) => effect.inline_update !== null && effect.inline_update !== undefined)
    .map((effect) => effect.reference.effect_order);
  const projectionScopeKeys = packet.projection_effects.map(
    (effect) => effect.scope.canonical_key,
  );
  if (
    !sameValues(packet.coverage.atom_ids, atomIds)
    || !sameValues(packet.coverage.document_effect_orders, documentOrders)
    || !sameValues(
      packet.coverage.inline_document_effect_orders,
      inlineDocumentOrders,
    )
    || !sameValues(packet.coverage.projection_scope_keys, projectionScopeKeys)
  ) {
    throw new TypeError("Authorized local commit packet coverage is invalid");
  }
};

const projectionScopeFromEffect = (
  packet: AuthorizedDeliveryPacket,
  effect: AuthorizedDeliveryPacket["projection_effects"][number],
): ProjectionScope => effect.scope.scope.kind === "library"
  ? {
      kind: "library",
      libraryId: effect.scope.scope.library_id,
    }
  : {
      kind: "project",
      libraryId: packet.authorization_scope.library_id,
      projectId: effect.scope.scope.project_id,
    };

const authorizationScopeKey = (
  scope: AuthorizedDeliveryPacket["authorization_scope"],
): string => scope.kind === "library"
  ? JSON.stringify(["library", scope.library_id])
  : scope.kind === "project"
    ? JSON.stringify(["project", scope.library_id, scope.project_id])
    : JSON.stringify([
        "document",
        scope.library_id,
        scope.project_id ?? null,
        scope.document_id,
      ]);

const documentClaim = (
  _packet: AuthorizedDeliveryPacket,
  effect: AuthorizedDeliveryPacket["document_effects"][number],
): { readonly key: string; readonly fingerprint: string } => {
  const reference = effect.reference;
  return {
    key: `document:${[
      reference.document_id,
      reference.generation,
      reference.base_head_seq,
      reference.result_head_seq,
      reference.effect_order,
    ].join(":")}`,
    fingerprint: `${reference.update_id}:${reference.update_hash}:${reference.update_byte_length}`,
  };
};

const projectionIntegrityClaim = (
  scopeKey: string,
  resultRevision: number,
  effectHash: string,
): { readonly key: string; readonly fingerprint: string } => ({
  key: `projection:${scopeKey}:${resultRevision}`,
  fingerprint: effectHash,
});

const projectionDeliveryClaim = (
  scope: ProjectionScope,
  scopeKey: string,
  resultRevision: number,
  effectHash: string,
): { readonly key: string; readonly fingerprint: string } => ({
  key: `${projectionScopeKey(scope)}:projection:${scopeKey}:${resultRevision}`,
  fingerprint: effectHash,
});

const revocationClaim = (
  revocation: AuthorizedDeliveryPacket["revocations"][number],
): { readonly key: string; readonly fingerprint: string } => ({
  key: `${authorizationScopeKey(revocation.authorization_scope)}:revocation:${revocation.resource_kind}:${revocation.resource_id}`,
  fingerprint: revocation.reason,
});

const atomClaim = (
  packet: AuthorizedDeliveryPacket,
  atom: Atom,
): { readonly key: string; readonly fingerprint: string } => ({
  key: `${authorizationScopeKey(packet.authorization_scope)}:atom:${atom.descriptor.atom_id}`,
  fingerprint: `${atom.descriptor.kind}:${atom.descriptor.payload_hash}`,
});

const documentResyncEvent = (
  packet: AuthorizedDeliveryPacket,
  effect: AuthorizedDeliveryPacket["document_effects"][number],
  reason: Extract<
    DocumentSyncRealtimeEvent,
    { readonly kind: "resync-required" }
  >["reason"],
): DocumentSyncRealtimeEvent => ({
  kind: "resync-required",
  documentId: effect.reference.document_id,
  storeEpoch: packet.manifest.identity.store_epoch,
  generation: effect.reference.generation,
  headSeq: effect.reference.base_head_seq,
  commitSeq: packet.manifest.identity.commit_seq,
  effectSequence: effect.reference.effect_order,
  reason,
});

const prepareDocumentEvent = async (
  packet: AuthorizedDeliveryPacket,
  effect: AuthorizedDeliveryPacket["document_effects"][number],
): Promise<PreparedDocumentEvent> => {
  const claim = documentClaim(packet, effect);
  const inline = effect.inline_update;
  if (inline === null || inline === undefined) {
    return {
      key: claim.key,
      fingerprint: claim.fingerprint,
      event: documentResyncEvent(packet, effect, "event-gap"),
    };
  }
  const update = Uint8Array.from(inline);
  if (
    update.byteLength !== effect.reference.update_byte_length
    || await sha256Hex(update) !== effect.reference.update_hash
  ) {
    return {
      key: claim.key,
      fingerprint: claim.fingerprint,
      event: documentResyncEvent(packet, effect, "resource-integrity-failure"),
    };
  }
  return {
    key: claim.key,
    fingerprint: claim.fingerprint,
    event: {
      kind: "document-update",
      documentId: effect.reference.document_id,
      storeEpoch: packet.manifest.identity.store_epoch,
      generation: effect.reference.generation,
      headSeq: effect.reference.result_head_seq,
      commitSeq: packet.manifest.identity.commit_seq,
      effectSequence: effect.reference.effect_order,
      updateId: effect.reference.update_id,
      clientSessionId: "core:apply-response",
      update,
    },
  };
};

/**
 * Process-wide causal admission for apply responses and renderer fanout.
 * Admission completes before a mutation Promise resolves; React rendering is
 * deliberately downstream and never part of the commit ACK.
 */
export class RendererLocalCommitIngress {
  readonly #maxRememberedCommits: number;
  readonly #maxInFlightAdmissions: number;
  readonly #remembered = new Map<string, RememberedCommit>();
  readonly #projectionListeners = new Map<string, Set<ProjectionListener>>();
  readonly #revocationListeners = new Map<string, Set<RevocationListener>>();
  readonly #documentListeners = new Map<string, Set<DocumentListener>>();
  readonly #atomListeners = new Set<AtomListener>();
  readonly #onListenerError: ((error: unknown) => void) | undefined;
  #inFlightAdmissions = 0;

  constructor(input: {
    readonly maxRememberedCommits?: number;
    readonly maxInFlightAdmissions?: number;
    readonly onListenerError?: (error: unknown) => void;
  } = {}) {
    this.#maxRememberedCommits = Math.max(
      1,
      Math.floor(input.maxRememberedCommits ?? DEFAULT_MAX_REMEMBERED_COMMITS),
    );
    this.#maxInFlightAdmissions = Math.max(
      1,
      Math.floor(
        input.maxInFlightAdmissions ?? DEFAULT_MAX_IN_FLIGHT_ADMISSIONS,
      ),
    );
    this.#onListenerError = input.onListenerError;
  }

  async admitApply(apply: LocalCommitApply): Promise<RendererLocalCommitAdmission> {
    if (apply.status === "no_op" || !apply.delivery) return { kind: "no_op" };
    if (
      apply.delivery.manifest.identity.store_epoch !== apply.commit.store_epoch
      || apply.delivery.manifest.identity.commit_seq !== apply.commit.commit_seq
      || apply.delivery.manifest.identity.manifest_hash !== apply.commit.manifest_hash
    ) {
      throw new TypeError("Apply response delivery diverges from its commit identity");
    }
    return await this.admitPacket(apply.delivery);
  }

  async admitPacket(
    packet: AuthorizedDeliveryPacket,
  ): Promise<RendererLocalCommitAdmission> {
    validatePacket(packet);
    if (this.#inFlightAdmissions >= this.#maxInFlightAdmissions) {
      throw new LocalCommitIngressCapacityError();
    }
    this.#inFlightAdmissions += 1;
    try {
      return await this.#admitPacket(packet);
    } finally {
      this.#inFlightAdmissions -= 1;
    }
  }

  admitProjectionMessage(message: ProjectionStreamMessage): void {
    validateProjectionMessage(message);
    if (message.kind !== "effect") {
      this.#publishProjection(message.scope, message);
      return;
    }
    if (!this.#rememberExternalProjection(message)) return;
    this.#publishProjection(message.scope, message);
  }

  admitRevocationMessage(message: ResourceRevocationMessage): void {
    validateRevocationMessage(message);
    if (message.kind === "reset") {
      this.#publishRevocation(message.scope, message);
      return;
    }
    const revocation = message.delivery.revocation;
    const claim = revocationClaim(revocation);
    if (!this.#rememberExternalClaim(message.delivery, claim)) return;
    this.#publishRevocation(message.scope, message);
  }

  subscribeProjection(
    scope: ProjectionScope,
    listener: ProjectionListener,
  ): () => void {
    return this.#subscribe(this.#projectionListeners, projectionScopeKey(scope), listener);
  }

  subscribeRevocation(
    scope: ProjectionScope,
    listener: RevocationListener,
  ): () => void {
    return this.#subscribe(this.#revocationListeners, projectionScopeKey(scope), listener);
  }

  subscribeDocument(documentId: string, listener: DocumentListener): () => void {
    if (!documentId || documentId !== documentId.trim()) {
      throw new TypeError("Document subscription identity is invalid");
    }
    return this.#subscribe(this.#documentListeners, documentId, listener);
  }

  subscribeAtoms(listener: AtomListener): () => void {
    this.#atomListeners.add(listener);
    return () => this.#atomListeners.delete(listener);
  }

  diagnostics(): {
    readonly rememberedCommits: number;
    readonly inFlightAdmissions: number;
  } {
    return {
      rememberedCommits: this.#remembered.size,
      inFlightAdmissions: this.#inFlightAdmissions,
    };
  }

  async #admitPacket(
    packet: AuthorizedDeliveryPacket,
  ): Promise<RendererLocalCommitAdmission> {
    const identity = packet.manifest.identity;
    const commitKey = `${identity.store_epoch}:${identity.commit_seq}`;
    const preparedDocuments = await Promise.all(
      packet.document_effects.map((effect) => prepareDocumentEvent(packet, effect)),
    );
    const remembered = this.#remembered.get(commitKey);
    if (remembered && remembered.manifestHash !== identity.manifest_hash) {
      throw new Error(`Local commit identity collision for ${commitKey}`);
    }
    const state: RememberedCommit = {
      manifestHash: identity.manifest_hash,
      claims: new Map(remembered?.claims ?? []),
    };

    // Validate every claim against an isolated draft before publishing any
    // callback. A divergent claim must reject the packet atomically instead
    // of exposing a valid prefix and poisoning later replay.
    const novelRevocations = packet.revocations.filter((revocation) =>
      this.#rememberClaim(state, revocationClaim(revocation))
    );
    const novelDocuments = preparedDocuments.filter((prepared) =>
      this.#rememberClaim(state, prepared)
    );
    const novelProjections = packet.projection_effects.filter((effect) => {
      this.#rememberClaim(state, projectionIntegrityClaim(
        effect.scope.canonical_key,
        effect.result_revision,
        effect.effect_hash,
      ));
      return this.#rememberClaim(
        state,
        projectionDeliveryClaim(
          projectionScopeFromEffect(packet, effect),
          effect.scope.canonical_key,
          effect.result_revision,
          effect.effect_hash,
        ),
      );
    });
    const novelAtoms = packet.atoms.filter((atom) =>
      this.#rememberClaim(state, atomClaim(packet, atom))
    );
    const admitted = novelRevocations.length
      + novelDocuments.length
      + novelProjections.length
      + novelAtoms.length;

    this.#remembered.set(commitKey, state);
    this.#touch(commitKey, state);

    // Authorization loss is admitted before any post-state content in the
    // same packet, so stale surfaces cannot observe a later content callback.
    for (const revocation of novelRevocations) {
      const scope = revocation.authorization_scope.kind === "library"
        ? {
            kind: "library" as const,
            libraryId: revocation.authorization_scope.library_id,
          }
        : revocation.authorization_scope.kind === "project"
          ? {
              kind: "project" as const,
              libraryId: revocation.authorization_scope.library_id,
              projectId: revocation.authorization_scope.project_id,
            }
          : null;
      if (!scope || !revocationScopeCanReceive(scope, revocation)) continue;
      this.#publishRevocation(
        scope,
        revocationMessageFromDelivery(packet, revocation, scope),
      );
    }
    for (const prepared of novelDocuments) {
      this.#publishDocument(prepared.event.documentId, prepared.event);
    }
    for (const effect of novelProjections) {
      const scope = projectionScopeFromEffect(packet, effect);
      if (!projectionScopeCanReceive(scope, effect)) continue;
      this.#publishProjection(
        scope,
        projectionMessageFromDelivery(packet, effect, scope),
      );
    }
    for (const atom of novelAtoms) {
      for (const listener of [...this.#atomListeners]) {
        this.#deliver(() => listener(packet, atom));
      }
    }
    if (admitted === 0) return { kind: "duplicate", commitKey };
    return {
      kind: remembered ? "enriched" : "accepted",
      commitKey,
    };
  }

  #rememberClaim(
    state: RememberedCommit,
    claim: { readonly key: string; readonly fingerprint: string },
  ): boolean {
    const known = state.claims.get(claim.key);
    if (!known) {
      state.claims.set(claim.key, { fingerprint: claim.fingerprint });
      return true;
    }
    if (known.fingerprint === claim.fingerprint) return false;
    throw new Error(`Local commit resource identity collision for ${claim.key}`);
  }

  #rememberExternalClaim(
    delivery: {
      readonly storeEpoch: string;
      readonly commitSeq: number;
      readonly manifestHash: string;
    },
    claim: { readonly key: string; readonly fingerprint: string },
  ): boolean {
    const commitKey = `${delivery.storeEpoch}:${delivery.commitSeq}`;
    const state = this.#remembered.get(commitKey) ?? {
      manifestHash: delivery.manifestHash,
      claims: new Map<string, RememberedClaim>(),
    };
    if (state.manifestHash !== delivery.manifestHash) {
      throw new Error(`Local commit identity collision for ${commitKey}`);
    }
    const admitted = this.#rememberClaim(state, claim);
    this.#remembered.set(commitKey, state);
    this.#touch(commitKey, state);
    return admitted;
  }

  #rememberExternalProjection(
    message: Extract<ProjectionStreamMessage, { readonly kind: "effect" }>,
  ): boolean {
    const delivery = message.delivery;
    const commitKey = `${delivery.storeEpoch}:${delivery.commitSeq}`;
    const state = this.#remembered.get(commitKey) ?? {
      manifestHash: delivery.manifestHash,
      claims: new Map<string, RememberedClaim>(),
    };
    if (state.manifestHash !== delivery.manifestHash) {
      throw new Error(`Local commit identity collision for ${commitKey}`);
    }
    const effect = message.delivery.effect;
    this.#rememberClaim(state, projectionIntegrityClaim(
      effect.scope.canonical_key,
      effect.resultRevision,
      effect.effectHash,
    ));
    const admitted = this.#rememberClaim(
      state,
      projectionDeliveryClaim(
        message.scope,
        effect.scope.canonical_key,
        effect.resultRevision,
        effect.effectHash,
      ),
    );
    this.#remembered.set(commitKey, state);
    this.#touch(commitKey, state);
    return admitted;
  }

  #touch(key: string, state: RememberedCommit): void {
    this.#remembered.delete(key);
    this.#remembered.set(key, state);
    while (this.#remembered.size > this.#maxRememberedCommits) {
      const oldest = this.#remembered.keys().next().value;
      if (oldest === undefined) break;
      this.#remembered.delete(oldest);
    }
  }

  #publishProjection(scope: ProjectionScope, message: ProjectionStreamMessage): void {
    for (const listener of this.#projectionListeners.get(projectionScopeKey(scope)) ?? []) {
      this.#deliver(() => listener(message));
    }
  }

  #publishRevocation(scope: ProjectionScope, message: ResourceRevocationMessage): void {
    for (const listener of this.#revocationListeners.get(projectionScopeKey(scope)) ?? []) {
      this.#deliver(() => listener(message));
    }
  }

  #publishDocument(documentId: string, event: DocumentSyncRealtimeEvent): void {
    for (const listener of this.#documentListeners.get(documentId) ?? []) {
      this.#deliver(() => listener(event));
    }
  }

  #deliver(delivery: () => void): void {
    try {
      delivery();
    } catch (error) {
      this.#onListenerError?.(error);
    }
  }

  #subscribe<Listener>(
    registry: Map<string, Set<Listener>>,
    key: string,
    listener: Listener,
  ): () => void {
    const listeners = registry.get(key) ?? new Set<Listener>();
    listeners.add(listener);
    registry.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) registry.delete(key);
    };
  }
}

export const rendererLocalCommitIngress = new RendererLocalCommitIngress();

export const admitLocalCommitApply = async (
  apply: LocalCommitApply,
): Promise<RendererLocalCommitAdmission> =>
  await rendererLocalCommitIngress.admitApply(apply);
