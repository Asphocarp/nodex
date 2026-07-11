import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness.js";
import {
  MAX_DOCUMENT_AWARENESS_UPDATE_BYTES,
  parseDocumentRelocationLeaseResponseRequest,
  type DocumentAwarenessPublishAck,
  type DocumentAwarenessPublishRequest,
  type DocumentRelocationLeaseResponseAck,
  type DocumentRelocationLeaseResponseRequest,
  type DocumentSyncApplyAck,
  type DocumentSyncApplyRequest,
  type DocumentSyncCommandError,
  type DocumentSyncCommandResult,
  type DocumentSyncRealtimeEvent,
  type DocumentSyncRequest,
  type DocumentSyncResponse,
  type DocumentSyncSubscribeRequest,
  type DocumentSyncSubscriptionAck,
  type DocumentSyncUnsubscribeAck,
} from "../shared/block-documents/document-sync";
import {
  documentMutationFailure,
  parseRelocationIntent,
  type DocumentMutationRequest,
  type DocumentOperationCommandResult,
  type DocumentOperationResult,
  type DocumentWriteFenceProof,
  type RelocateBlocks,
  type RelocationCommandError,
  type RelocationCommandResult,
  type RelocationIntent,
  type RelocationResult,
} from "../shared/block-documents";
import { safeSendToWebContents } from "./ipc-safe-send";
import {
  DocumentRelocationLeaseCoordinator,
  type DocumentRelocationLeaseCoordinatorOptions,
  type DocumentRelocationLeaseEvent,
  type DocumentRelocationLeaseFailure,
} from "./document-relocation-lease-coordinator";

const DOCUMENT_SYNC_EVENT_CHANNEL = "document-sync:event";

export interface DocumentSyncClientTarget {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once(event: "destroyed", listener: () => void): unknown;
}

/**
 * The eventual SQLite writer implements this seam. A successful apply result
 * means the update is already durable; the hub deliberately has no optimistic
 * or pre-commit fanout path.
 */
export interface DocumentSyncDurableBackend {
  sync(
    request: DocumentSyncRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>>;
  applyUpdate(
    request: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>>;
  applyDocumentMutation(
    request: DocumentMutationRequest,
    writeFence?: DocumentWriteFenceProof,
  ): Promise<DocumentOperationCommandResult>;
  lookupCommittedRelocation(
    intent: RelocationIntent,
  ): Promise<RelocationCommandResult<RelocationResult | null>>;
  prepareRelocationCommand(
    intent: RelocationIntent,
  ): Promise<RelocationCommandResult<RelocateBlocks>>;
  relocateBlocks(command: RelocateBlocks): Promise<RelocationCommandResult>;
}

export interface DocumentSyncHubOptions {
  readonly relocationLease?: Omit<
    DocumentRelocationLeaseCoordinatorOptions,
    "publishEvent"
  >;
}

interface DocumentSubscription {
  readonly key: string;
  readonly documentId: string;
  readonly clientSessionId: string;
  readonly participantSessionKey: string;
  readonly target: DocumentSyncClientTarget;
  readonly awarenessDocument: Y.Doc;
  readonly awareness: Awareness;
  storeEpoch?: string;
  generation?: number;
}

interface HubRelocationDocumentBoundary {
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
}

interface HubRelocationLeaseBoundary {
  readonly leaseId: string;
  readonly documents: Map<string, HubRelocationDocumentBoundary>;
}

const commandError = (
  code: DocumentSyncCommandError["code"],
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly resetRequired?: boolean;
  } = {},
): DocumentSyncCommandError => ({
  code,
  message,
  retryable: options.retryable ?? false,
  resetRequired: options.resetRequired ?? false,
});

const commandFailure = <T>(
  error: DocumentSyncCommandError,
): DocumentSyncCommandResult<T> => ({ ok: false, error });

const unknownBackendFailure = <T>(): DocumentSyncCommandResult<T> =>
  commandFailure(
    commandError(
      "transport_unavailable",
      "The durable document writer is unavailable",
      { retryable: true },
    ),
  );

const unknownDocumentMutationBackendFailure = (
  mutationId: string,
): DocumentOperationCommandResult => ({
  ok: false,
  error: documentMutationFailure(
    "unknown",
    "The durable Document mutation writer is unavailable",
    { mutationId, retryable: true },
  ),
});

const documentMutationResultMatchesRequest = (
  request: DocumentMutationRequest,
  result: DocumentOperationResult,
): boolean =>
  result.mutationId === request.mutationId &&
  result.projectId === request.projectId &&
  result.storeEpoch === request.storeEpoch &&
  result.documentId === request.documentId &&
  result.generation === request.generation &&
  result.baseHeadSeq === request.expectedHeadSeq &&
  result.mutationKind ===
    ("operations" in request
      ? "document_operation_batch"
      : "nfm" in request
        ? "replace_document_from_nfm"
        : "document_version_restore");

export const documentSyncUnavailable = <T>(): DocumentSyncCommandResult<T> =>
  commandFailure(
    commandError(
      "store_not_initialized",
      "The durable document sync backend is not initialized",
      { retryable: true },
    ),
  );

export const documentSyncUnauthorized = <T>(): DocumentSyncCommandResult<T> =>
  commandFailure(
    commandError(
      "unauthorized",
      "Document sync is restricted to the subscribed application window",
    ),
  );

const invalidResponse = <T>(message: string): DocumentSyncCommandResult<T> =>
  commandFailure(commandError("invalid_response", message));

const hasIdentity = (
  request: DocumentSyncSubscribeRequest | null | undefined,
): request is DocumentSyncSubscribeRequest =>
  typeof request?.documentId === "string" &&
  request.documentId.trim().length > 0 &&
  typeof request.clientSessionId === "string" &&
  request.clientSessionId.trim().length > 0;

const isNonNegativeInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

const subscriptionKey = (
  targetId: number,
  request: DocumentSyncSubscribeRequest,
): string =>
  JSON.stringify([targetId, request.clientSessionId, request.documentId]);

const participantSessionKey = (
  targetId: number,
  clientSessionId: string,
): string => JSON.stringify([targetId, clientSessionId]);

const createSubscriptionAwareness = (): {
  readonly document: Y.Doc;
  readonly awareness: Awareness;
} => {
  const document = new Y.Doc();
  const awareness = new Awareness(document);
  awareness.setLocalState(null);
  return { document, awareness };
};

const inspectLiveAwarenessClientIds = (
  update: Uint8Array,
): readonly number[] => {
  const probe = createSubscriptionAwareness();
  try {
    applyAwarenessUpdate(probe.awareness, update, "document-sync-probe");
    return [...probe.awareness.getStates().keys()];
  } finally {
    probe.awareness.destroy();
    probe.document.destroy();
  }
};

const copyApplyRequest = (
  request: DocumentSyncApplyRequest,
): DocumentSyncApplyRequest => ({
  ...request,
  touchedBlockIds: [...request.touchedBlockIds],
  update: request.update.slice(),
});

const relocationFailure = <T>(
  code: RelocationCommandError["code"],
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly reloadRequired?: boolean;
    readonly relocationId?: string;
  } = {},
): RelocationCommandResult<T> => ({
  ok: false,
  error: {
    code,
    message,
    retryable: options.retryable ?? false,
    reloadRequired: options.reloadRequired ?? false,
    ...(options.relocationId ? { relocationId: options.relocationId } : {}),
  },
});

const unknownRelocationBackendFailure = <T>(
  relocationId: string,
): RelocationCommandResult<T> =>
  relocationFailure("unknown", "The durable relocation writer is unavailable", {
    retryable: true,
    relocationId,
  });

const leasePreparationFailure = <T>(
  failure: DocumentRelocationLeaseFailure,
  relocationId: string,
): RelocationCommandResult<T> =>
  relocationFailure(
    failure.code === "invalid_request" || failure.code === "lease_id_collision"
      ? "invalid_relocation_request"
      : "relocation_lease_timeout",
    failure.message,
    {
      retryable:
        failure.code !== "invalid_request" &&
        failure.code !== "lease_id_collision",
      relocationId,
    },
  );

const copyRelocationIntent = (intent: RelocationIntent): RelocationIntent => ({
  ...intent,
  rootBlockIds: [...intent.rootBlockIds],
  target: { ...intent.target },
});

const preparedCommandMatchesIntent = (
  intent: RelocationIntent,
  command: RelocateBlocks,
): boolean => {
  if (
    command.relocationId !== intent.relocationId ||
    command.projectId !== intent.projectId ||
    command.storeEpoch !== intent.storeEpoch ||
    command.sourceDocumentId !== intent.sourceDocumentId ||
    command.sourceGeneration !== intent.sourceGeneration ||
    command.target.kind !== "document" ||
    command.target.documentId !== intent.target.documentId ||
    command.target.generation !== intent.target.generation ||
    command.target.parentBlockId !== intent.target.parentBlockId ||
    command.target.beforeBlockId !== intent.target.beforeBlockId ||
    command.rootBlockIds.length !== intent.rootBlockIds.length
  ) {
    return false;
  }
  return command.rootBlockIds.every((blockId) =>
    intent.rootBlockIds.includes(blockId),
  );
};

export class DocumentSyncHub {
  private readonly backend: DocumentSyncDurableBackend;
  private readonly relocationLeaseCoordinator: DocumentRelocationLeaseCoordinator;
  private readonly subscriptions = new Map<string, DocumentSubscription>();
  private readonly subscriptionKeysByDocument = new Map<string, Set<string>>();
  private readonly subscriptionKeysByParticipantSession = new Map<
    string,
    Set<string>
  >();
  private readonly boundTargetIds = new Set<number>();
  private readonly sessionOwnerTargetIds = new Map<string, number>();
  private readonly awarenessClientOwnersByDocument = new Map<
    string,
    Map<number, string>
  >();
  private readonly relocationLeaseBoundaries = new Map<
    string,
    HubRelocationLeaseBoundary
  >();
  private relocationLeaseSequence = 0;
  private documentMutationLeaseSequence = 0;

  constructor(
    backend: DocumentSyncDurableBackend,
    options: DocumentSyncHubOptions = {},
  ) {
    this.backend = backend;
    this.relocationLeaseCoordinator = new DocumentRelocationLeaseCoordinator({
      ...options.relocationLease,
      publishEvent: (event) => this.publishRelocationLeaseEvent(event),
    });
  }

  subscribe = (
    target: DocumentSyncClientTarget,
    request: DocumentSyncSubscribeRequest,
  ): DocumentSyncCommandResult<DocumentSyncSubscriptionAck> => {
    if (target.isDestroyed()) {
      return documentSyncUnauthorized();
    }
    if (!hasIdentity(request)) {
      return commandFailure(
        commandError(
          "invalid_document_update",
          "Document subscription identity is required",
        ),
      );
    }
    if (!this.bindSessionOwner(target, request.clientSessionId)) {
      return documentSyncUnauthorized();
    }

    this.bindTargetLifecycle(target);
    const key = subscriptionKey(target.id, request);
    if (!this.subscriptions.has(key)) {
      const participantKey = participantSessionKey(
        target.id,
        request.clientSessionId,
      );
      const leaseSubscription = this.relocationLeaseCoordinator.subscribe(
        participantKey,
        request.documentId,
      );
      if (!leaseSubscription.ok) {
        return commandFailure(
          commandError(
            leaseSubscription.error.code === "document_busy"
              ? "request_cancelled"
              : "invalid_response",
            leaseSubscription.error.message,
            {
              retryable: leaseSubscription.error.code === "document_busy",
            },
          ),
        );
      }
      const awarenessState = createSubscriptionAwareness();
      this.subscriptions.set(key, {
        key,
        documentId: request.documentId,
        clientSessionId: request.clientSessionId,
        participantSessionKey: participantKey,
        target,
        awarenessDocument: awarenessState.document,
        awareness: awarenessState.awareness,
      });
      const documentKeys =
        this.subscriptionKeysByDocument.get(request.documentId) ??
        new Set<string>();
      documentKeys.add(key);
      this.subscriptionKeysByDocument.set(request.documentId, documentKeys);
      const participantKeys =
        this.subscriptionKeysByParticipantSession.get(participantKey) ??
        new Set<string>();
      participantKeys.add(key);
      this.subscriptionKeysByParticipantSession.set(
        participantKey,
        participantKeys,
      );
    }

    safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [
      {
        kind: "connection",
        documentId: request.documentId,
        state: "connected",
      } satisfies DocumentSyncRealtimeEvent,
    ]);
    return { ok: true, value: { subscribed: true } };
  };

  unsubscribe = (
    target: DocumentSyncClientTarget,
    request: DocumentSyncSubscribeRequest,
  ): DocumentSyncCommandResult<DocumentSyncUnsubscribeAck> => {
    if (!hasIdentity(request)) {
      return commandFailure(
        commandError(
          "invalid_document_update",
          "Document subscription identity is required",
        ),
      );
    }
    const key = subscriptionKey(target.id, request);
    const subscription = this.subscriptions.get(key);
    if (!subscription) {
      return { ok: true, value: { unsubscribed: true } };
    }
    if (subscription.target !== target) {
      return documentSyncUnauthorized();
    }

    this.removeSubscription(subscription);
    return { ok: true, value: { unsubscribed: true } };
  };

  sync = async (
    target: DocumentSyncClientTarget,
    request: DocumentSyncRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> => {
    const subscription = this.requireSubscription(target, request);
    if (!subscription) {
      return documentSyncUnauthorized();
    }

    let result: DocumentSyncCommandResult<DocumentSyncResponse>;
    try {
      result = await this.backend.sync({
        ...request,
        stateVector: request.stateVector.slice(),
      });
    } catch {
      return unknownBackendFailure();
    }
    if (!result.ok) {
      return result;
    }
    if (result.value.documentId !== request.documentId) {
      return invalidResponse(
        "The durable backend returned a different document",
      );
    }

    this.adoptSubscriptionBoundary(
      subscription,
      result.value.storeEpoch,
      result.value.generation,
    );
    return {
      ok: true,
      value: {
        ...result.value,
        stateVector: result.value.stateVector.slice(),
        update: result.value.update.slice(),
      },
    };
  };

  applyUpdate = async (
    target: DocumentSyncClientTarget,
    request: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>> => {
    const subscription = this.requireSubscription(target, request);
    if (!subscription) {
      return documentSyncUnauthorized();
    }

    let result: DocumentSyncCommandResult<DocumentSyncApplyAck>;
    try {
      result = await this.backend.applyUpdate(copyApplyRequest(request));
    } catch {
      return unknownBackendFailure();
    }
    if (!result.ok) {
      return result;
    }

    const ack = result.value;
    if (
      ack.documentId !== request.documentId ||
      ack.updateId !== request.updateId ||
      ack.generation !== request.generation
    ) {
      return invalidResponse(
        "The durable document ACK does not match its command",
      );
    }

    this.adoptSubscriptionBoundary(
      subscription,
      ack.storeEpoch,
      ack.generation,
    );
    if (!ack.duplicate) {
      this.fanout(request.documentId, {
        kind: "document-update",
        documentId: request.documentId,
        storeEpoch: ack.storeEpoch,
        generation: ack.generation,
        headSeq: ack.committedSeq,
        updateId: request.updateId,
        clientSessionId: request.clientSessionId,
        update: request.update.slice(),
      });
    }

    return {
      ok: true,
      value: {
        ...ack,
        stateVector: ack.stateVector.slice(),
      },
    };
  };

  applyDocumentMutation = async (
    request: DocumentMutationRequest,
  ): Promise<DocumentOperationCommandResult> => {
    let initial: DocumentOperationCommandResult;
    try {
      initial = await this.backend.applyDocumentMutation(request);
    } catch {
      return unknownDocumentMutationBackendFailure(request.mutationId);
    }
    if (initial.ok) {
      if (!documentMutationResultMatchesRequest(request, initial.value)) {
        return unknownDocumentMutationBackendFailure(request.mutationId);
      }
      try {
        this.fanoutDocumentMutationResync(initial.value);
      } catch {
        // The mutation is already durable. Exact retry or state-vector sync
        // repairs any missed best-effort realtime notification.
      }
      return initial;
    }
    if (initial.error.code !== "write_fence_required") return initial;

    const leaseId = this.createDocumentMutationLeaseId();
    this.setSingleDocumentLeaseBoundary(leaseId, {
      documentId: request.documentId,
      storeEpoch: request.storeEpoch,
      generation: request.generation,
      headSeq: request.expectedHeadSeq,
    });

    let prepared;
    try {
      prepared = await this.relocationLeaseCoordinator.prepare({
        leaseId,
        documents: [
          {
            documentId: request.documentId,
            generation: request.generation,
            expectedHeadSeq: request.expectedHeadSeq,
          },
        ],
      });
    } catch {
      this.cancelRelocationLease(leaseId);
      return {
        ok: false,
        error: documentMutationFailure(
          "document_write_lease_timeout",
          "Document write lease preparation failed",
          { mutationId: request.mutationId, retryable: true },
        ),
      };
    }
    if (!prepared.ok) {
      this.relocationLeaseBoundaries.delete(leaseId);
      return {
        ok: false,
        error: documentMutationFailure(
          "document_write_lease_timeout",
          prepared.error.message,
          { mutationId: request.mutationId, retryable: true },
        ),
      };
    }

    const resolved = prepared.value.resolvedHeads.find(
      (head) => head.documentId === request.documentId,
    );
    if (!resolved) {
      this.cancelRelocationLease(leaseId);
      return unknownDocumentMutationBackendFailure(request.mutationId);
    }
    if (resolved.headSeq !== request.expectedHeadSeq) {
      this.cancelRelocationLease(leaseId);
      return {
        ok: false,
        error: documentMutationFailure(
          "document_head_conflict",
          `Document ${request.documentId} advanced while editors flushed for the write lease`,
          {
            mutationId: request.mutationId,
            retryable: false,
            expectedHeadSeq: request.expectedHeadSeq,
            actualHeadSeq: resolved.headSeq,
          },
        ),
      };
    }

    let committed: DocumentOperationCommandResult;
    try {
      committed = await this.backend.applyDocumentMutation(request, {
        leaseId,
        documentId: request.documentId,
        generation: request.generation,
        headSeq: request.expectedHeadSeq,
      });
    } catch {
      this.cancelRelocationLease(leaseId);
      return unknownDocumentMutationBackendFailure(request.mutationId);
    }
    if (!committed.ok) {
      this.cancelRelocationLease(leaseId);
      return committed;
    }
    if (!documentMutationResultMatchesRequest(request, committed.value)) {
      this.cancelRelocationLease(leaseId);
      return unknownDocumentMutationBackendFailure(request.mutationId);
    }

    this.setSingleDocumentLeaseBoundary(leaseId, {
      documentId: request.documentId,
      storeEpoch: committed.value.storeEpoch,
      generation: committed.value.generation,
      headSeq: committed.value.headSeq,
    });
    try {
      this.fanoutDocumentMutationResync(committed.value);
    } catch {
      // Release still has to run after a durable commit.
    }
    const released = this.relocationLeaseCoordinator.release(leaseId);
    if (!released.ok) {
      this.publishDocumentMutationReleaseFallback(leaseId, committed.value);
      this.fanoutDocumentMutationResync(committed.value);
    }
    this.relocationLeaseBoundaries.delete(leaseId);
    return committed;
  };

  publishAwareness = (
    target: DocumentSyncClientTarget,
    request: DocumentAwarenessPublishRequest,
  ): DocumentSyncCommandResult<DocumentAwarenessPublishAck> => {
    const subscription = this.requireSubscription(target, request);
    if (!subscription) {
      return documentSyncUnauthorized();
    }
    if (
      !(request.update instanceof Uint8Array) ||
      request.update.byteLength > MAX_DOCUMENT_AWARENESS_UPDATE_BYTES
    ) {
      return commandFailure(
        commandError(
          "invalid_awareness_update",
          "Awareness update exceeds the size limit",
        ),
      );
    }
    if (
      subscription.storeEpoch !== request.storeEpoch ||
      subscription.generation !== request.generation
    ) {
      return commandFailure(
        commandError(
          subscription.storeEpoch !== request.storeEpoch
            ? "store_epoch_mismatch"
            : "document_generation_mismatch",
          "Awareness belongs to a different document identity boundary",
          { resetRequired: true },
        ),
      );
    }

    let liveClientIds: readonly number[];
    try {
      liveClientIds = inspectLiveAwarenessClientIds(request.update);
    } catch {
      return commandFailure(
        commandError(
          "invalid_awareness_update",
          "Awareness update is malformed",
        ),
      );
    }

    const owners = this.awarenessOwners(request.documentId);
    if (
      liveClientIds.some((clientId) => {
        const owner = owners.get(clientId);
        return owner !== undefined && owner !== subscription.key;
      })
    ) {
      return documentSyncUnauthorized();
    }

    let changedClientIds: readonly number[] = [];
    const captureChanges = (changes: {
      readonly added: readonly number[];
      readonly updated: readonly number[];
      readonly removed: readonly number[];
    }): void => {
      changedClientIds = [
        ...changes.added,
        ...changes.updated,
        ...changes.removed,
      ];
      changes.added.forEach((clientId) =>
        owners.set(clientId, subscription.key),
      );
      changes.updated.forEach((clientId) =>
        owners.set(clientId, subscription.key),
      );
      changes.removed.forEach((clientId) => {
        if (owners.get(clientId) === subscription.key) {
          owners.delete(clientId);
        }
      });
    };

    subscription.awareness.on("update", captureChanges);
    try {
      applyAwarenessUpdate(
        subscription.awareness,
        request.update.slice(),
        subscription.key,
      );
    } catch {
      return commandFailure(
        commandError(
          "invalid_awareness_update",
          "Awareness update is malformed",
        ),
      );
    } finally {
      subscription.awareness.off("update", captureChanges);
    }

    if (changedClientIds.length > 0) {
      this.fanout(request.documentId, {
        kind: "awareness",
        documentId: request.documentId,
        storeEpoch: request.storeEpoch,
        generation: request.generation,
        clientSessionId: request.clientSessionId,
        update: request.update.slice(),
      });
    }
    return { ok: true, value: { accepted: true } };
  };

  relocate = async (
    target: DocumentSyncClientTarget,
    rawIntent: RelocationIntent,
    clientSessionId?: string,
  ): Promise<RelocationCommandResult> => {
    let intent: RelocationIntent;
    try {
      intent = parseRelocationIntent(rawIntent);
    } catch (error) {
      return relocationFailure(
        "invalid_relocation_request",
        error instanceof Error ? error.message : String(error),
      );
    }
    const sourceSubscription = [...this.subscriptions.values()].find(
      (subscription) =>
        subscription.target === target &&
        subscription.documentId === intent.sourceDocumentId &&
        (clientSessionId === undefined ||
          subscription.clientSessionId === clientSessionId),
    );
    if (!sourceSubscription || target.isDestroyed()) {
      return relocationFailure(
        "invalid_relocation_request",
        "Relocation requires a source Document subscription owned by the caller",
        { relocationId: intent.relocationId },
      );
    }

    let committedLookup: RelocationCommandResult<RelocationResult | null>;
    try {
      committedLookup = await this.backend.lookupCommittedRelocation(
        copyRelocationIntent(intent),
      );
    } catch {
      return unknownRelocationBackendFailure(intent.relocationId);
    }
    if (!committedLookup.ok) return committedLookup;
    if (committedLookup.value) {
      this.fanoutRelocationResync(committedLookup.value);
      return { ok: true, value: committedLookup.value };
    }

    let initialPreparation: RelocationCommandResult<RelocateBlocks>;
    try {
      initialPreparation = await this.backend.prepareRelocationCommand(
        copyRelocationIntent(intent),
      );
    } catch {
      return unknownRelocationBackendFailure(intent.relocationId);
    }
    if (!initialPreparation.ok) return initialPreparation;
    if (!preparedCommandMatchesIntent(intent, initialPreparation.value)) {
      return relocationFailure(
        "invalid_relocation_request",
        "The durable writer prepared a different relocation intent",
        { relocationId: intent.relocationId },
      );
    }
    const initialCommand = initialPreparation.value;
    if (initialCommand.target.kind !== "document") {
      return relocationFailure(
        "invalid_relocation_target",
        "DocumentSyncHub only coordinates Document relocation",
        { relocationId: intent.relocationId },
      );
    }
    const leaseId = this.createRelocationLeaseId();
    this.setRelocationLeaseBoundary(leaseId, initialCommand);

    let leasePreparation;
    try {
      leasePreparation = await this.relocationLeaseCoordinator.prepare({
        leaseId,
        documents: [
          {
            documentId: initialCommand.sourceDocumentId,
            generation: initialCommand.sourceGeneration,
            expectedHeadSeq: initialCommand.expectedSourceHeadSeq,
          },
          {
            documentId: initialCommand.target.documentId,
            generation: initialCommand.target.generation,
            expectedHeadSeq: initialCommand.target.expectedHeadSeq,
          },
        ],
      });
    } catch {
      this.cancelRelocationLease(leaseId);
      return relocationFailure(
        "relocation_lease_timeout",
        "Relocation lease preparation failed",
        { retryable: true, relocationId: intent.relocationId },
      );
    }
    if (!leasePreparation.ok) {
      this.relocationLeaseBoundaries.delete(leaseId);
      return leasePreparationFailure(
        leasePreparation.error,
        intent.relocationId,
      );
    }

    let flushedPreparation: RelocationCommandResult<RelocateBlocks>;
    try {
      flushedPreparation = await this.backend.prepareRelocationCommand(
        copyRelocationIntent(intent),
      );
    } catch {
      this.cancelRelocationLease(leaseId);
      return unknownRelocationBackendFailure(intent.relocationId);
    }
    if (!flushedPreparation.ok) {
      this.cancelRelocationLease(leaseId);
      return flushedPreparation;
    }
    if (!preparedCommandMatchesIntent(intent, flushedPreparation.value)) {
      this.cancelRelocationLease(leaseId);
      return relocationFailure(
        "invalid_relocation_request",
        "The flushed relocation preparation changed logical intent",
        { relocationId: intent.relocationId },
      );
    }
    const command = flushedPreparation.value;
    if (command.target.kind !== "document") {
      this.cancelRelocationLease(leaseId);
      return relocationFailure(
        "invalid_relocation_target",
        "The flushed relocation target is not a Document",
        { relocationId: intent.relocationId },
      );
    }
    const targetCommand = command.target;
    const resolvedSource = leasePreparation.value.resolvedHeads.find(
      (head) => head.documentId === command.sourceDocumentId,
    );
    const resolvedTarget = leasePreparation.value.resolvedHeads.find(
      (head) => head.documentId === targetCommand.documentId,
    );
    if (
      !resolvedSource ||
      !resolvedTarget ||
      command.expectedSourceHeadSeq < resolvedSource.headSeq ||
      targetCommand.expectedHeadSeq < resolvedTarget.headSeq
    ) {
      this.cancelRelocationLease(leaseId);
      return relocationFailure(
        "source_head_mismatch",
        "The writer did not observe every lease participant's durable head",
        { reloadRequired: true, relocationId: intent.relocationId },
      );
    }
    this.setRelocationLeaseBoundary(leaseId, command);

    let relocation: RelocationCommandResult;
    try {
      relocation = await this.backend.relocateBlocks(command);
    } catch {
      this.cancelRelocationLease(leaseId);
      return unknownRelocationBackendFailure(intent.relocationId);
    }
    if (!relocation.ok) {
      this.cancelRelocationLease(leaseId);
      return relocation;
    }

    const durableResult = relocation.value;
    this.setRelocationResultBoundary(leaseId, durableResult);
    try {
      this.fanoutRelocationResult(durableResult);
    } catch {
      this.fanoutRelocationResync(durableResult);
    }
    const released = this.relocationLeaseCoordinator.release(leaseId);
    if (!released.ok) {
      this.publishRelocationReleaseFallback(leaseId, durableResult);
      this.fanoutRelocationResync(durableResult);
    }
    this.relocationLeaseBoundaries.delete(leaseId);
    return { ok: true, value: durableResult };
  };

  respondToRelocationLease = (
    target: DocumentSyncClientTarget,
    rawRequest: DocumentRelocationLeaseResponseRequest,
  ): DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck> => {
    let request: DocumentRelocationLeaseResponseRequest;
    try {
      request = parseDocumentRelocationLeaseResponseRequest(rawRequest);
    } catch (error) {
      return commandFailure(
        commandError(
          "invalid_document_update",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    const subscription = this.requireSubscription(target, request);
    if (!subscription) return documentSyncUnauthorized();
    const lease = this.relocationLeaseBoundaries.get(request.leaseId);
    const boundary = lease?.documents.get(request.documentId);
    if (!lease || !boundary) {
      return commandFailure(
        commandError(
          "request_cancelled",
          "Relocation lease is no longer active",
        ),
      );
    }
    if (
      subscription.storeEpoch !== request.storeEpoch ||
      subscription.generation !== request.generation ||
      boundary.storeEpoch !== request.storeEpoch ||
      boundary.generation !== request.generation ||
      !isNonNegativeInteger(request.headSeq) ||
      (request.response === "ack" && request.headSeq < boundary.headSeq)
    ) {
      const code: DocumentSyncCommandError["code"] =
        subscription.storeEpoch !== request.storeEpoch ||
        boundary.storeEpoch !== request.storeEpoch
          ? "store_epoch_mismatch"
          : subscription.generation !== request.generation ||
              boundary.generation !== request.generation
            ? "document_generation_mismatch"
            : "invalid_response";
      return commandFailure(
        commandError(
          code,
          "Relocation lease response crossed its Document boundary",
          { resetRequired: true },
        ),
      );
    }

    const coordinatorResult =
      request.response === "ack"
        ? this.relocationLeaseCoordinator.acknowledge({
            leaseId: request.leaseId,
            participantSessionKey: subscription.participantSessionKey,
            documentId: request.documentId,
            generation: request.generation,
            headSeq: request.headSeq,
          })
        : this.relocationLeaseCoordinator.nack({
            leaseId: request.leaseId,
            participantSessionKey: subscription.participantSessionKey,
            documentId: request.documentId,
            message: request.message,
          });
    if (!coordinatorResult.ok) {
      if (coordinatorResult.error.code === "participant_not_expected") {
        return documentSyncUnauthorized();
      }
      return commandFailure(
        commandError(
          coordinatorResult.error.code === "document_generation_mismatch"
            ? "document_generation_mismatch"
            : "invalid_response",
          coordinatorResult.error.message,
          {
            resetRequired:
              coordinatorResult.error.code === "document_generation_mismatch",
          },
        ),
      );
    }
    return {
      ok: true,
      value: {
        accepted: true,
        leaseId: request.leaseId,
        documentId: request.documentId,
        status: request.response === "ack" ? "frozen" : "cancelled",
      },
    };
  };

  handleTargetDestroyed = (targetId: number): void => {
    const subscriptions = [...this.subscriptions.values()].filter(
      (subscription) => subscription.target.id === targetId,
    );
    subscriptions.forEach((subscription) =>
      this.removeSubscription(subscription),
    );
    this.boundTargetIds.delete(targetId);
  };

  private createRelocationLeaseId(): string {
    this.relocationLeaseSequence += 1;
    return `document-relocation-lease:${this.relocationLeaseSequence.toString(36)}`;
  }

  private createDocumentMutationLeaseId(): string {
    this.documentMutationLeaseSequence += 1;
    return `document-mutation-lease:${this.documentMutationLeaseSequence.toString(36)}`;
  }

  private setSingleDocumentLeaseBoundary(
    leaseId: string,
    boundary: HubRelocationDocumentBoundary,
  ): void {
    this.relocationLeaseBoundaries.set(leaseId, {
      leaseId,
      documents: new Map([[boundary.documentId, boundary]]),
    });
  }

  private setRelocationLeaseBoundary(
    leaseId: string,
    command: RelocateBlocks,
  ): void {
    if (command.target.kind !== "document") return;
    this.relocationLeaseBoundaries.set(leaseId, {
      leaseId,
      documents: new Map([
        [
          command.sourceDocumentId,
          {
            documentId: command.sourceDocumentId,
            storeEpoch: command.storeEpoch,
            generation: command.sourceGeneration,
            headSeq: command.expectedSourceHeadSeq,
          },
        ],
        [
          command.target.documentId,
          {
            documentId: command.target.documentId,
            storeEpoch: command.storeEpoch,
            generation: command.target.generation,
            headSeq: command.target.expectedHeadSeq,
          },
        ],
      ]),
    });
  }

  private setRelocationResultBoundary(
    leaseId: string,
    result: RelocationResult,
  ): void {
    const targetCommit = result.targetCommit;
    const documents = new Map<string, HubRelocationDocumentBoundary>([
      [
        result.sourceCommit.documentId,
        {
          documentId: result.sourceCommit.documentId,
          storeEpoch: result.storeEpoch,
          generation: result.sourceCommit.generation,
          headSeq: result.sourceCommit.headSeq,
        },
      ],
    ]);
    if (targetCommit) {
      documents.set(targetCommit.documentId, {
        documentId: targetCommit.documentId,
        storeEpoch: result.storeEpoch,
        generation: targetCommit.generation,
        headSeq: targetCommit.headSeq,
      });
    }
    this.relocationLeaseBoundaries.set(leaseId, {
      leaseId,
      documents,
    });
  }

  private publishRelocationLeaseEvent(
    event: DocumentRelocationLeaseEvent,
  ): void {
    const lease = this.relocationLeaseBoundaries.get(event.leaseId);
    if (!lease) return;
    const subscriptionKeys = this.subscriptionKeysByParticipantSession.get(
      event.participantSessionKey,
    );
    if (!subscriptionKeys) return;
    const documentIds =
      event.kind === "prepare"
        ? event.documents.map((document) => document.documentId)
        : event.documentIds;
    for (const documentId of documentIds) {
      const boundary = lease.documents.get(documentId);
      if (!boundary) continue;
      const subscription = [...subscriptionKeys]
        .map((key) => this.subscriptions.get(key))
        .find((candidate) => candidate?.documentId === documentId);
      if (!subscription) continue;
      const realtimeEvent: DocumentSyncRealtimeEvent =
        event.kind === "prepare"
          ? {
              kind: "relocation-lease-prepare",
              leaseId: event.leaseId,
              documentId,
              clientSessionId: subscription.clientSessionId,
              storeEpoch: boundary.storeEpoch,
              generation: boundary.generation,
              expectedHeadSeq: boundary.headSeq,
              deadlineAt: event.deadlineAt,
            }
          : event.kind === "release"
            ? {
                kind: "relocation-lease-release",
                leaseId: event.leaseId,
                documentId,
                clientSessionId: subscription.clientSessionId,
                storeEpoch: boundary.storeEpoch,
                generation: boundary.generation,
                headSeq: boundary.headSeq,
              }
            : {
                kind: "relocation-lease-cancel",
                leaseId: event.leaseId,
                documentId,
                clientSessionId: subscription.clientSessionId,
                storeEpoch: boundary.storeEpoch,
                generation: boundary.generation,
                headSeq: boundary.headSeq,
                reason: event.reason,
              };
      safeSendToWebContents(subscription.target, DOCUMENT_SYNC_EVENT_CHANNEL, [
        realtimeEvent,
      ]);
    }
  }

  private cancelRelocationLease(leaseId: string): void {
    this.relocationLeaseCoordinator.cancel(leaseId);
    this.relocationLeaseBoundaries.delete(leaseId);
  }

  private fanoutRelocationResult(result: RelocationResult): void {
    this.fanoutRelocationCommit(result.storeEpoch, result.sourceCommit);
    if (result.targetCommit) {
      this.fanoutRelocationCommit(result.storeEpoch, result.targetCommit);
    }
  }

  private fanoutRelocationCommit(
    storeEpoch: string,
    commit: RelocationResult["sourceCommit"],
  ): void {
    if (commit.update === null) {
      this.fanout(commit.documentId, {
        kind: "resync-required",
        documentId: commit.documentId,
        storeEpoch,
        generation: commit.generation,
        headSeq: commit.headSeq,
        reason: "history-compacted",
      });
      return;
    }
    this.fanout(commit.documentId, {
      kind: "document-update",
      documentId: commit.documentId,
      storeEpoch,
      generation: commit.generation,
      headSeq: commit.headSeq,
      updateId: commit.updateId,
      clientSessionId: "sqlite:block-relocation",
      update: commit.update.slice(),
    });
  }

  private fanoutRelocationResync(result: RelocationResult): void {
    const commits = [result.sourceCommit, result.targetCommit].filter(
      (commit): commit is RelocationResult["sourceCommit"] =>
        commit !== undefined,
    );
    for (const commit of commits) {
      this.fanout(commit.documentId, {
        kind: "resync-required",
        documentId: commit.documentId,
        storeEpoch: result.storeEpoch,
        generation: commit.generation,
        headSeq: commit.headSeq,
        reason: "event-gap",
      });
    }
  }

  private fanoutDocumentMutationResync(
    result: DocumentOperationResult,
  ): void {
    this.fanout(result.documentId, {
      kind: "resync-required",
      documentId: result.documentId,
      storeEpoch: result.storeEpoch,
      generation: result.generation,
      headSeq: result.headSeq,
      reason: "event-gap",
    });
  }

  private publishDocumentMutationReleaseFallback(
    leaseId: string,
    result: DocumentOperationResult,
  ): void {
    const keys = this.subscriptionKeysByDocument.get(result.documentId);
    if (!keys) return;
    for (const key of keys) {
      const subscription = this.subscriptions.get(key);
      if (!subscription) continue;
      safeSendToWebContents(subscription.target, DOCUMENT_SYNC_EVENT_CHANNEL, [
        {
          kind: "relocation-lease-release",
          leaseId,
          documentId: result.documentId,
          clientSessionId: subscription.clientSessionId,
          storeEpoch: result.storeEpoch,
          generation: result.generation,
          headSeq: result.headSeq,
        } satisfies DocumentSyncRealtimeEvent,
      ]);
    }
  }

  private publishRelocationReleaseFallback(
    leaseId: string,
    result: RelocationResult,
  ): void {
    const commits = [result.sourceCommit, result.targetCommit].filter(
      (commit): commit is RelocationResult["sourceCommit"] =>
        commit !== undefined,
    );
    for (const commit of commits) {
      const keys = this.subscriptionKeysByDocument.get(commit.documentId);
      if (!keys) continue;
      for (const key of keys) {
        const subscription = this.subscriptions.get(key);
        if (!subscription) continue;
        safeSendToWebContents(
          subscription.target,
          DOCUMENT_SYNC_EVENT_CHANNEL,
          [
            {
              kind: "relocation-lease-release",
              leaseId,
              documentId: commit.documentId,
              clientSessionId: subscription.clientSessionId,
              storeEpoch: result.storeEpoch,
              generation: commit.generation,
              headSeq: commit.headSeq,
            } satisfies DocumentSyncRealtimeEvent,
          ],
        );
      }
    }
  }

  private bindTargetLifecycle(target: DocumentSyncClientTarget): void {
    if (this.boundTargetIds.has(target.id)) {
      return;
    }
    this.boundTargetIds.add(target.id);
    target.once("destroyed", () => this.handleTargetDestroyed(target.id));
  }

  private bindSessionOwner(
    target: DocumentSyncClientTarget,
    clientSessionId: string,
  ): boolean {
    const existingOwner = this.sessionOwnerTargetIds.get(clientSessionId);
    if (existingOwner !== undefined && existingOwner !== target.id) {
      return false;
    }
    this.sessionOwnerTargetIds.set(clientSessionId, target.id);
    return true;
  }

  private requireSubscription(
    target: DocumentSyncClientTarget,
    request: DocumentSyncSubscribeRequest,
  ): DocumentSubscription | null {
    if (target.isDestroyed() || !hasIdentity(request)) {
      return null;
    }
    const subscription = this.subscriptions.get(
      subscriptionKey(target.id, request),
    );
    if (!subscription || subscription.target !== target) {
      return null;
    }
    return subscription;
  }

  private adoptSubscriptionBoundary(
    subscription: DocumentSubscription,
    storeEpoch: string,
    generation: number,
  ): void {
    const boundaryChanged =
      subscription.storeEpoch !== undefined &&
      (subscription.storeEpoch !== storeEpoch ||
        subscription.generation !== generation);
    if (boundaryChanged) {
      this.clearSubscriptionAwareness(subscription);
    }
    subscription.storeEpoch = storeEpoch;
    subscription.generation = generation;
  }

  private awarenessOwners(documentId: string): Map<number, string> {
    const existing = this.awarenessClientOwnersByDocument.get(documentId);
    if (existing) {
      return existing;
    }
    const owners = new Map<number, string>();
    this.awarenessClientOwnersByDocument.set(documentId, owners);
    return owners;
  }

  private clearSubscriptionAwareness(subscription: DocumentSubscription): void {
    const clientIds = [...subscription.awareness.getStates().keys()];
    if (clientIds.length === 0) {
      return;
    }

    removeAwarenessStates(subscription.awareness, clientIds, subscription.key);
    const owners = this.awarenessClientOwnersByDocument.get(
      subscription.documentId,
    );
    clientIds.forEach((clientId) => {
      if (owners?.get(clientId) === subscription.key) {
        owners.delete(clientId);
      }
    });
    if (subscription.storeEpoch && subscription.generation !== undefined) {
      this.fanout(subscription.documentId, {
        kind: "awareness",
        documentId: subscription.documentId,
        storeEpoch: subscription.storeEpoch,
        generation: subscription.generation,
        clientSessionId: subscription.clientSessionId,
        update: encodeAwarenessUpdate(subscription.awareness, clientIds),
      });
    }
  }

  private removeSubscription(subscription: DocumentSubscription): void {
    this.relocationLeaseCoordinator.unsubscribe(
      subscription.participantSessionKey,
      subscription.documentId,
    );
    this.clearSubscriptionAwareness(subscription);
    subscription.awareness.destroy();
    subscription.awarenessDocument.destroy();
    this.subscriptions.delete(subscription.key);

    const documentKeys = this.subscriptionKeysByDocument.get(
      subscription.documentId,
    );
    documentKeys?.delete(subscription.key);
    if (documentKeys?.size === 0) {
      this.subscriptionKeysByDocument.delete(subscription.documentId);
      this.awarenessClientOwnersByDocument.delete(subscription.documentId);
    }

    const participantKeys = this.subscriptionKeysByParticipantSession.get(
      subscription.participantSessionKey,
    );
    participantKeys?.delete(subscription.key);
    if (participantKeys?.size === 0) {
      this.subscriptionKeysByParticipantSession.delete(
        subscription.participantSessionKey,
      );
    }

    const ownsAnotherSubscription = [...this.subscriptions.values()].some(
      (candidate) =>
        candidate.clientSessionId === subscription.clientSessionId &&
        candidate.target.id === subscription.target.id,
    );
    if (!ownsAnotherSubscription) {
      this.sessionOwnerTargetIds.delete(subscription.clientSessionId);
    }
  }

  private fanout(documentId: string, event: DocumentSyncRealtimeEvent): void {
    const keys = this.subscriptionKeysByDocument.get(documentId);
    if (!keys) {
      return;
    }

    const targets = new Map<number, DocumentSyncClientTarget>();
    keys.forEach((key) => {
      const subscription = this.subscriptions.get(key);
      if (subscription) {
        targets.set(subscription.target.id, subscription.target);
      }
    });
    targets.forEach((target) => {
      safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
    });
  }
}
