import * as Y from "yjs";
import { createHash } from "node:crypto";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
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
  CANVAS_SCENE_SYNC_VERSION,
  type CanvasSceneMutationCommandResult,
  type CanvasSceneMutationError,
  type CanvasSceneMutationRequest,
  type CanvasSceneRealtimeEvent,
  type CanvasSceneSubscribeRequest,
  type CanvasSceneSubscriptionCommandResult,
  type CanvasSceneSyncCommandResult,
  type CanvasSceneSyncRequest,
} from "../shared/block-documents/canvas-scene-sync";
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
import {
  AdditionalDocumentExecutionProofError,
  compileAdditionalDocumentCommandExecution,
  encodeAdditionalDocumentCommandSemanticHashInput,
  parseAdditionalDocumentCommandRequest,
  parseAdditionalDocumentCommandResult,
  type AdditionalDocumentCommandErrorCode,
  type AdditionalDocumentCommandRequest,
  type AdditionalDocumentCommandReceipt,
  type AdditionalDocumentCommandResult,
  type AdditionalDocumentHeadRevision,
} from "../shared/additional-document-commands";
import {
  blockTransferIntentFromRequest,
  canonicalizeBlockTransferLogicalIntent,
  parseBlockTransferIntent,
  type BlockTransferCommandError,
  type BlockTransferCommandResult,
  type BlockTransferDocumentHead,
  type BlockTransferIntent,
  type BlockTransferPreparation,
  type BlockTransferReceipt,
  type BlockTransferRequest,
} from "../shared/block-transfer";
import type {
  ExecuteNodexAgentCreatePagesResult,
  ExecuteNodexAgentDuplicatePageResult,
  ExecuteNodexAgentMovePagesResult,
  NodexAgentCreatePagesCommand,
  NodexAgentDuplicatePageCommand,
  NodexAgentMovePagesCommand,
  NodexAgentLeaseDocument,
} from "../shared/nodex-agent-tools";
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
  syncCanvasScene?(
    request: CanvasSceneSyncRequest,
  ): Promise<CanvasSceneSyncCommandResult>;
  applyCanvasSceneMutation?(
    request: CanvasSceneMutationRequest,
  ): Promise<CanvasSceneMutationCommandResult>;
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
  applyAdditionalDocumentCommand?(
    request: AdditionalDocumentCommandRequest,
  ): Promise<AdditionalDocumentCommandResult>;
  lookupCommittedBlockTransfer?(
    intent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult<BlockTransferReceipt | null>>;
  prepareBlockTransfer?(
    intent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult<BlockTransferPreparation>>;
  applyBlockTransfer?(
    request: BlockTransferRequest,
  ): Promise<BlockTransferCommandResult>;
  executeNodexAgentCreatePages?(
    command: NodexAgentCreatePagesCommand,
  ): Promise<ExecuteNodexAgentCreatePagesResult>;
  executeNodexAgentDuplicatePage?(
    command: NodexAgentDuplicatePageCommand,
  ): Promise<ExecuteNodexAgentDuplicatePageResult>;
  executeNodexAgentMovePages?(
    command: NodexAgentMovePagesCommand,
  ): Promise<ExecuteNodexAgentMovePagesResult>;
}

export interface DocumentSyncHubOptions {
  readonly relocationLease?: Omit<
    DocumentRelocationLeaseCoordinatorOptions,
    "publishEvent"
  >;
}

interface DocumentSubscription {
  readonly key: string;
  readonly engine: "yjs" | "canvas_scene";
  readonly projectId?: string;
  readonly documentId: string;
  readonly clientSessionId: string;
  readonly participantSessionKey: string;
  readonly target: DocumentSyncClientTarget;
  readonly awarenessDocument?: Y.Doc;
  readonly awareness?: Awareness;
  storeEpoch?: string;
  generation?: number;
  headSeq?: number;
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

const additionalDocumentFailure = (
  request: AdditionalDocumentCommandRequest,
  code: AdditionalDocumentCommandErrorCode,
  message: string,
  retryable: boolean,
): AdditionalDocumentCommandResult =>
  parseAdditionalDocumentCommandResult({
    ok: false,
    error: {
      code,
      message: message.length <= 4_096 ? message : `${message.slice(0, 4_095)}…`,
      retryable,
      operationId: request.operationId,
      operationKind: request.operation.kind,
    },
  });

const unknownAdditionalDocumentBackendFailure = (
  request: AdditionalDocumentCommandRequest,
): AdditionalDocumentCommandResult =>
  additionalDocumentFailure(
    request,
    "unknown",
    "The durable additional Document writer is unavailable",
    true,
  );

const additionalDocumentResultMatchesRequest = (
  request: AdditionalDocumentCommandRequest,
  result: AdditionalDocumentCommandResult,
): boolean => {
  if (!result.ok) {
    return (
      result.error.operationId === request.operationId &&
      result.error.operationKind === request.operation.kind
    );
  }
  const expectedSemanticHash = createHash("sha256")
    .update(encodeAdditionalDocumentCommandSemanticHashInput(request))
    .digest("hex");
  return (
    result.value.operationId === request.operationId &&
    result.value.projectId === request.projectId &&
    result.value.storeEpoch === request.storeEpoch &&
    result.value.operationKind === request.operation.kind &&
    result.value.semanticHash === expectedSemanticHash
  );
};

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
  engine: "yjs" | "canvas_scene" = "yjs",
  projectId?: string,
): string =>
  JSON.stringify([
    targetId,
    engine,
    projectId ?? null,
    request.clientSessionId,
    request.documentId,
  ]);

const canvasSceneSubscriptionKey = (
  targetId: number,
  request: Pick<
    CanvasSceneSubscribeRequest,
    "projectId" | "documentId" | "clientSessionId"
  >,
): string =>
  subscriptionKey(targetId, request, "canvas_scene", request.projectId);

const hasCanvasSceneIdentity = (
  request: CanvasSceneSubscribeRequest | CanvasSceneSyncRequest | CanvasSceneMutationRequest,
): boolean =>
  request.version === CANVAS_SCENE_SYNC_VERSION &&
  request.projectId.trim().length > 0 &&
  request.documentId.trim().length > 0 &&
  request.clientSessionId.trim().length > 0;

const canvasSceneFailure = (
  code: CanvasSceneMutationError["code"],
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly resetRequired?: boolean;
    readonly mutationId?: string;
  } = {},
): { readonly ok: false; readonly error: CanvasSceneMutationError } => ({
  ok: false,
  error: {
    code,
    message,
    retryable: options.retryable ?? false,
    resetRequired: options.resetRequired ?? false,
    ...(options.mutationId ? { mutationId: options.mutationId } : {}),
  },
});

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

const blockTransferFailure = <Value>(
  intent: Pick<BlockTransferIntent, "operationId"> | null,
  code: BlockTransferCommandError["code"],
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly reloadRequired?: boolean;
  } = {},
): BlockTransferCommandResult<Value> => ({
  ok: false,
  error: {
    code,
    message,
    retryable: options.retryable ?? false,
    reloadRequired: options.reloadRequired ?? false,
    ...(intent ? { operationId: intent.operationId } : {}),
  },
});

const blockTransferPreparationMatchesIntent = (
  intent: BlockTransferIntent,
  preparation: BlockTransferPreparation,
): boolean => {
  try {
    return (
      canonicalizeBlockTransferLogicalIntent(intent) ===
      canonicalizeBlockTransferLogicalIntent(
        blockTransferIntentFromRequest(preparation.request),
      )
    );
  } catch {
    return false;
  }
};

const sameBlockTransferDocumentClosure = (
  left: readonly BlockTransferDocumentHead[],
  right: readonly BlockTransferDocumentHead[],
): boolean =>
  left.length === right.length &&
  left.every(
    (head, index) => head.documentId === right[index]?.documentId,
  );

const nodexAgentCreatePagesFailure = (
  message: string,
  recovery: "get_block_again" | "none" = "none",
): ExecuteNodexAgentCreatePagesResult => ({
  ok: false,
  error: {
    code: recovery === "get_block_again" ? "conflict" : "internal_error",
    message,
    retryable: false,
    recovery,
  },
});

const nodexAgentDuplicatePageFailure = (
  message: string,
  recovery: "get_block_again" | "none" = "none",
): ExecuteNodexAgentDuplicatePageResult => ({
  ok: false,
  error: {
    code: recovery === "get_block_again" ? "conflict" : "internal_error",
    message,
    retryable: false,
    recovery,
  },
});

const nodexAgentMovePagesFailure = (
  message: string,
  recovery: "get_block_again" | "none" = "none",
): ExecuteNodexAgentMovePagesResult => ({
  ok: false,
  error: {
    code: recovery === "get_block_again" ? "conflict" : "internal_error",
    message,
    retryable: false,
    recovery,
  },
});

type NodexAgentLeasedMutationResult =
  | ExecuteNodexAgentCreatePagesResult
  | ExecuteNodexAgentDuplicatePageResult
  | ExecuteNodexAgentMovePagesResult;

type SuccessfulNodexAgentLeasedMutation = Extract<
  NodexAgentLeasedMutationResult,
  { readonly ok: true }
>;

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
  private blockTransferLeaseSequence = 0;
  private documentMutationLeaseSequence = 0;
  private additionalDocumentLeaseSequence = 0;

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
        engine: "yjs",
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

  subscribeCanvasScene = (
    target: DocumentSyncClientTarget,
    request: CanvasSceneSubscribeRequest,
  ): CanvasSceneSubscriptionCommandResult => {
    if (
      target.isDestroyed() ||
      !hasCanvasSceneIdentity(request) ||
      !this.bindSessionOwner(target, request.clientSessionId)
    ) {
      return canvasSceneFailure(
        "invalid_canvas_scene_mutation",
        "Canvas scene subscription identity is invalid or unauthorized",
      );
    }
    this.bindTargetLifecycle(target);
    const key = canvasSceneSubscriptionKey(target.id, request);
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
        return canvasSceneFailure(
          "unknown",
          leaseSubscription.error.message,
          { retryable: leaseSubscription.error.code === "document_busy" },
        );
      }
      this.subscriptions.set(key, {
        key,
        engine: "canvas_scene",
        projectId: request.projectId,
        documentId: request.documentId,
        clientSessionId: request.clientSessionId,
        participantSessionKey: participantKey,
        target,
      });
      const documentKeys =
        this.subscriptionKeysByDocument.get(request.documentId) ??
        new Set<string>();
      documentKeys.add(key);
      this.subscriptionKeysByDocument.set(
        request.documentId,
        documentKeys,
      );
      const participantKeys =
        this.subscriptionKeysByParticipantSession.get(participantKey) ??
        new Set<string>();
      participantKeys.add(key);
      this.subscriptionKeysByParticipantSession.set(
        participantKey,
        participantKeys,
      );
    }
    return { ok: true, value: { subscribed: true } };
  };

  unsubscribeCanvasScene = (
    target: DocumentSyncClientTarget,
    request: CanvasSceneSubscribeRequest,
  ): CanvasSceneSubscriptionCommandResult => {
    if (!hasCanvasSceneIdentity(request)) {
      return canvasSceneFailure(
        "invalid_canvas_scene_mutation",
        "Canvas scene subscription identity is invalid",
      );
    }
    const key = canvasSceneSubscriptionKey(target.id, request);
    const subscription = this.subscriptions.get(key);
    if (subscription?.target === target) {
      this.removeSubscription(subscription);
    }
    return { ok: true, value: { unsubscribed: true } };
  };

  syncCanvasScene = async (
    target: DocumentSyncClientTarget,
    request: CanvasSceneSyncRequest,
  ): Promise<CanvasSceneSyncCommandResult> => {
    if (!this.requireCanvasSceneSubscription(target, request)) {
      return canvasSceneFailure(
        "project_scope_mismatch",
        "An exact Canvas scene subscription is required",
      );
    }
    if (!this.backend.syncCanvasScene) {
      return canvasSceneFailure(
        "unknown",
        "Canvas scene sync is unavailable",
        { retryable: true },
      );
    }
    try {
      const result = await this.backend.syncCanvasScene(request);
      if (!result.ok) return result;
      if (
        result.value.projectId !== request.projectId ||
        result.value.documentId !== request.documentId
      ) {
        return canvasSceneFailure(
          "unknown",
          "Canvas scene sync escaped its subscription scope",
        );
      }
      const subscription = this.requireCanvasSceneSubscription(target, request);
      if (subscription) {
        subscription.storeEpoch = result.value.storeEpoch;
        subscription.generation = result.value.generation;
        subscription.headSeq = result.value.headSeq;
      }
      return result;
    } catch (error) {
      return canvasSceneFailure(
        "unknown",
        error instanceof Error
          ? error.message
          : "The durable Canvas scene writer is unavailable",
        { retryable: true },
      );
    }
  };

  applyCanvasSceneMutation = async (
    target: DocumentSyncClientTarget,
    request: CanvasSceneMutationRequest,
  ): Promise<CanvasSceneMutationCommandResult> => {
    if (!this.requireCanvasSceneSubscription(target, request)) {
      return canvasSceneFailure(
        "project_scope_mismatch",
        "An exact Canvas scene subscription is required",
        { mutationId: request.mutationId },
      );
    }
    if (!this.backend.applyCanvasSceneMutation) {
      return canvasSceneFailure(
        "unknown",
        "Canvas scene mutation is unavailable",
        { retryable: true, mutationId: request.mutationId },
      );
    }
    let result: CanvasSceneMutationCommandResult;
    try {
      result = await this.backend.applyCanvasSceneMutation(request);
    } catch (error) {
      return canvasSceneFailure(
        "unknown",
        error instanceof Error
          ? error.message
          : "The durable Canvas scene writer is unavailable",
        { retryable: true, mutationId: request.mutationId },
      );
    }
    if (!result.ok) return result;
    if (
      result.value.projectId !== request.projectId ||
      result.value.documentId !== request.documentId ||
      result.value.mutationId !== request.mutationId
    ) {
      return canvasSceneFailure(
        "unknown",
        "Canvas scene mutation ACK escaped its request scope",
        { mutationId: request.mutationId },
      );
    }
    const subscription = this.requireCanvasSceneSubscription(target, request);
    if (subscription) {
      subscription.storeEpoch = result.value.storeEpoch;
      subscription.generation = result.value.generation;
      subscription.headSeq = result.value.headSeq;
    }
    if (!result.value.duplicate && result.value.outcome === "committed") {
      if (result.event) {
        this.fanoutCanvasScene(request.documentId, result.event);
      } else {
        this.fanoutCanvasScene(request.documentId, {
          type: "canvas_scene_resync_required",
          version: CANVAS_SCENE_SYNC_VERSION,
          projectId: result.value.projectId,
          documentId: result.value.documentId,
          storeEpoch: result.value.storeEpoch,
          generation: result.value.generation,
          headSeq: result.value.headSeq,
        });
      }
    }
    return result;
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

  applyAdditionalDocumentCommand = async (
    rawRequest: AdditionalDocumentCommandRequest,
  ): Promise<AdditionalDocumentCommandResult> => {
    let request: AdditionalDocumentCommandRequest;
    try {
      request = parseAdditionalDocumentCommandRequest(rawRequest);
    } catch (error) {
      const fallback: AdditionalDocumentCommandRequest = {
        version: 1,
        operationId: "invalid",
        projectId: "invalid",
        storeEpoch: "invalid",
        clientSessionId: "invalid",
        actor: {},
        coordination: { kind: "fifo_only" },
        operation: {
          kind: "create_synced_source",
          sourceBlockId: "invalid",
          documentId: "invalid",
          initialBlocks: [],
          placement: { kind: "space" },
        },
      };
      return additionalDocumentFailure(
        fallback,
        "invalid_request",
        error instanceof Error ? error.message : String(error),
        false,
      );
    }
    const apply = this.backend.applyAdditionalDocumentCommand;
    if (!apply) return unknownAdditionalDocumentBackendFailure(request);

    if (request.coordination.kind !== "hub_lease") {
      let result: AdditionalDocumentCommandResult;
      try {
        result = await apply(request);
      } catch {
        return unknownAdditionalDocumentBackendFailure(request);
      }
      if (!additionalDocumentResultMatchesRequest(request, result)) {
        return unknownAdditionalDocumentBackendFailure(request);
      }
      if (result.ok) this.fanoutAdditionalDocumentResync(result.value);
      return result;
    }

    const leaseId = this.createAdditionalDocumentLeaseId();
    this.setAdditionalDocumentLeaseBoundary(
      leaseId,
      request.storeEpoch,
      request.coordination.documents,
    );

    let prepared;
    try {
      prepared = await this.relocationLeaseCoordinator.prepare({
        leaseId,
        documents: request.coordination.documents.map((head) => ({
          documentId: head.documentId,
          generation: head.generation,
          expectedHeadSeq: head.headSeq,
        })),
      });
    } catch {
      this.cancelRelocationLease(leaseId);
      return additionalDocumentFailure(
        request,
        "coordination_failed",
        "Additional Document write lease preparation failed",
        true,
      );
    }
    if (!prepared.ok) {
      this.relocationLeaseBoundaries.delete(leaseId);
      return additionalDocumentFailure(
        request,
        "coordination_failed",
        prepared.error.message,
        prepared.error.code !== "invalid_request" &&
          prepared.error.code !== "lease_id_collision",
      );
    }

    let coordinatedRequest: ReturnType<
      typeof compileAdditionalDocumentCommandExecution
    >;
    try {
      coordinatedRequest = compileAdditionalDocumentCommandExecution(request, {
        leaseId,
        documents: prepared.value.resolvedHeads,
      });
    } catch (error) {
      this.cancelRelocationLease(leaseId);
      return additionalDocumentFailure(
        request,
        error instanceof AdditionalDocumentExecutionProofError &&
          error.code === "document_generation_mismatch"
          ? "document_generation_mismatch"
          : "document_head_conflict",
        error instanceof Error
          ? error.message
          : "The flushed Document execution proof is invalid",
        false,
      );
    }

    let result: AdditionalDocumentCommandResult;
    try {
      result = await apply(coordinatedRequest);
    } catch {
      this.cancelRelocationLease(leaseId);
      return unknownAdditionalDocumentBackendFailure(request);
    }
    if (!additionalDocumentResultMatchesRequest(request, result)) {
      this.cancelRelocationLease(leaseId);
      return unknownAdditionalDocumentBackendFailure(request);
    }
    if (!result.ok) {
      this.cancelRelocationLease(leaseId);
      return result;
    }

    this.setAdditionalDocumentResultBoundary(
      leaseId,
      request.storeEpoch,
      coordinatedRequest.coordination.documents,
      result.value.effect.documentHeads,
    );
    try {
      this.fanoutAdditionalDocumentResync(result.value);
    } catch {
      // The receipt is durable; release and state-vector resync repair fanout.
    }
    const released = this.relocationLeaseCoordinator.release(leaseId);
    if (!released.ok) {
      this.publishAdditionalDocumentReleaseFallback(
        leaseId,
        request.storeEpoch,
        coordinatedRequest.coordination.documents,
        result.value.effect.documentHeads,
      );
      this.fanoutAdditionalDocumentResync(result.value);
    }
    this.relocationLeaseBoundaries.delete(leaseId);
    return result;
  };

  transferBlocks = async (
    rawIntent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult> => {
    let intent: BlockTransferIntent;
    try {
      intent = parseBlockTransferIntent(rawIntent);
    } catch (error) {
      return blockTransferFailure(
        null,
        "invalid_transfer_request",
        error instanceof Error ? error.message : String(error),
      );
    }
    const lookup = this.backend.lookupCommittedBlockTransfer;
    const prepare = this.backend.prepareBlockTransfer;
    const apply = this.backend.applyBlockTransfer;
    if (!lookup || !prepare || !apply) {
      return blockTransferFailure(
        intent,
        "unknown",
        "The durable Block transfer writer is unavailable",
        { retryable: true },
      );
    }

    let committed;
    try {
      committed = await lookup(intent);
    } catch {
      return blockTransferFailure(
        intent,
        "unknown",
        "Block transfer receipt lookup failed",
        { retryable: true },
      );
    }
    if (!committed.ok) return committed;
    if (committed.value) {
      this.fanoutBlockTransferResync(committed.value);
      return { ok: true, value: committed.value };
    }

    let initial;
    try {
      initial = await prepare(intent);
    } catch {
      return blockTransferFailure(
        intent,
        "unknown",
        "Block transfer preparation failed",
        { retryable: true },
      );
    }
    if (!initial.ok) return initial;
    if (!blockTransferPreparationMatchesIntent(intent, initial.value)) {
      return blockTransferFailure(
        intent,
        "invalid_transfer_request",
        "The durable writer prepared a different Block transfer intent",
      );
    }

    if (initial.value.leaseDocuments.length === 0) {
      let directResult: BlockTransferCommandResult;
      try {
        directResult = await apply(initial.value.request);
      } catch {
        return blockTransferFailure(
          intent,
          "unknown",
          "Block transfer commit failed",
          { retryable: true },
        );
      }
      if (!directResult.ok) return directResult;
      this.fanoutBlockTransferResult(directResult.value);
      return directResult;
    }

    const leaseId = this.createBlockTransferLeaseId();
    this.setBlockTransferLeaseBoundary(
      leaseId,
      intent.storeEpoch,
      initial.value.leaseDocuments,
    );
    let preparedLease;
    try {
      preparedLease = await this.relocationLeaseCoordinator.prepare({
        leaseId,
        documents: initial.value.leaseDocuments,
      });
    } catch {
      this.cancelRelocationLease(leaseId);
      return blockTransferFailure(
        intent,
        "transfer_lease_timeout",
        "Block transfer write lease preparation failed",
        { retryable: true },
      );
    }
    if (!preparedLease.ok) {
      this.relocationLeaseBoundaries.delete(leaseId);
      return blockTransferFailure(
        intent,
        preparedLease.error.code === "invalid_request" ||
          preparedLease.error.code === "lease_id_collision"
          ? "invalid_transfer_request"
          : "transfer_lease_timeout",
        preparedLease.error.message,
        {
          retryable:
            preparedLease.error.code !== "invalid_request" &&
            preparedLease.error.code !== "lease_id_collision",
        },
      );
    }

    let flushed;
    try {
      flushed = await prepare(intent);
    } catch {
      this.cancelRelocationLease(leaseId);
      return blockTransferFailure(
        intent,
        "unknown",
        "Block transfer flush verification failed",
        { retryable: true },
      );
    }
    if (!flushed.ok) {
      this.cancelRelocationLease(leaseId);
      return flushed;
    }
    if (!blockTransferPreparationMatchesIntent(intent, flushed.value)) {
      this.cancelRelocationLease(leaseId);
      return blockTransferFailure(
        intent,
        "invalid_transfer_request",
        "The flushed preparation changed Block transfer intent",
      );
    }
    const resolvedHeads = new Map(
      preparedLease.value.resolvedHeads.map((head) => [head.documentId, head]),
    );
    const observedEveryHead = flushed.value.leaseDocuments.every((document) => {
      const resolved = resolvedHeads.get(document.documentId);
      return (
        resolved !== undefined &&
        resolved.generation === document.generation &&
        document.expectedHeadSeq >= resolved.headSeq
      );
    });
    if (
      !sameBlockTransferDocumentClosure(
        initial.value.leaseDocuments,
        flushed.value.leaseDocuments,
      ) ||
      resolvedHeads.size !== flushed.value.leaseDocuments.length ||
      !observedEveryHead
    ) {
      this.cancelRelocationLease(leaseId);
      return blockTransferFailure(
        intent,
        "source_head_mismatch",
        "The writer did not observe every leased Document head in the final Block transfer closure",
        { retryable: true, reloadRequired: true },
      );
    }
    this.setBlockTransferLeaseBoundary(
      leaseId,
      intent.storeEpoch,
      flushed.value.leaseDocuments,
    );

    let result: BlockTransferCommandResult;
    try {
      result = await apply(flushed.value.request);
    } catch {
      this.cancelRelocationLease(leaseId);
      return blockTransferFailure(
        intent,
        "unknown",
        "Block transfer commit failed",
        { retryable: true },
      );
    }
    if (!result.ok) {
      this.cancelRelocationLease(leaseId);
      return result;
    }

    this.setBlockTransferResultBoundary(
      leaseId,
      intent.storeEpoch,
      flushed.value.leaseDocuments,
      result.value,
    );
    try {
      this.fanoutBlockTransferResult(result.value);
    } catch {
      this.fanoutBlockTransferResync(result.value);
    }
    const released = this.relocationLeaseCoordinator.release(leaseId);
    if (!released.ok) {
      this.publishBlockTransferReleaseFallback(
        leaseId,
        intent.storeEpoch,
        flushed.value.leaseDocuments,
        result.value,
      );
      this.fanoutBlockTransferResync(result.value);
    }
    this.relocationLeaseBoundaries.delete(leaseId);
    return result;
  };

  private executeNodexAgentLeasedMutation = async <
    Result extends NodexAgentLeasedMutationResult,
  >(options: {
    readonly storeEpoch: string;
    readonly leaseDocuments: readonly NodexAgentLeaseDocument[];
    readonly execute: () => Promise<Result>;
    readonly failure: (
      message: string,
      recovery?: "get_block_again" | "none",
    ) => Result;
    readonly operationLabel: string;
    readonly conflictMessage: string;
  }): Promise<Result> => {
    const { leaseDocuments } = options;
    if (leaseDocuments.length === 0) {
      try {
        return await options.execute();
      } catch {
        return options.failure(`${options.operationLabel} commit failed`);
      }
    }

    const leaseId = this.createBlockTransferLeaseId();
    this.setBlockTransferLeaseBoundary(
      leaseId,
      options.storeEpoch,
      leaseDocuments,
    );
    let prepared;
    try {
      prepared = await this.relocationLeaseCoordinator.prepare({
        leaseId,
        documents: leaseDocuments,
      });
    } catch {
      this.cancelRelocationLease(leaseId);
      return options.failure(`${options.operationLabel} write lease preparation failed`);
    }
    if (!prepared.ok) {
      this.relocationLeaseBoundaries.delete(leaseId);
      return options.failure(prepared.error.message);
    }
    const resolved = new Map(
      prepared.value.resolvedHeads.map((head) => [head.documentId, head]),
    );
    const exact = leaseDocuments.every((head) => {
      const current = resolved.get(head.documentId);
      return current?.generation === head.generation
        && current.headSeq === head.expectedHeadSeq;
    });
    if (!exact || resolved.size !== leaseDocuments.length) {
      this.cancelRelocationLease(leaseId);
      return options.failure(
        options.conflictMessage,
        "get_block_again",
      );
    }

    let result: Result;
    try {
      result = await options.execute();
    } catch {
      this.cancelRelocationLease(leaseId);
      return options.failure(`${options.operationLabel} commit failed`);
    }
    if (!result.ok) {
      this.cancelRelocationLease(leaseId);
      return result;
    }
    const success = result as Result & SuccessfulNodexAgentLeasedMutation;
    for (const commit of success.value.documentCommits) {
      this.fanoutRelocationCommit(options.storeEpoch, commit);
    }
    this.setBlockTransferLeaseBoundary(
      leaseId,
      options.storeEpoch,
      leaseDocuments.map((head) => {
        const commit = success.value.documentCommits.find(
          (candidate) => candidate.documentId === head.documentId,
        );
        return commit
          ? {
              documentId: commit.documentId,
              generation: commit.generation,
              expectedHeadSeq: commit.headSeq,
            }
          : head;
      }),
    );
    const released = this.relocationLeaseCoordinator.release(leaseId);
    if (!released.ok) {
      for (const commit of success.value.documentCommits) {
        this.fanout(commit.documentId, {
          kind: "resync-required",
          documentId: commit.documentId,
          storeEpoch: options.storeEpoch,
          generation: commit.generation,
          headSeq: commit.headSeq,
          reason: "event-gap",
        });
      }
    }
    this.relocationLeaseBoundaries.delete(leaseId);
    return result;
  };

  executeNodexAgentCreatePages = async (
    command: NodexAgentCreatePagesCommand,
    leaseDocuments: readonly NodexAgentLeaseDocument[],
  ): Promise<ExecuteNodexAgentCreatePagesResult> => {
    const execute = this.backend.executeNodexAgentCreatePages;
    if (!execute) {
      return nodexAgentCreatePagesFailure(
        "The durable Agent Page batch writer is unavailable",
      );
    }
    const expectedLeaseDocuments = command.destination.kind === "document"
      ? [{
          documentId: command.destination.documentId,
          generation: command.destination.generation,
          expectedHeadSeq: command.destination.expectedHeadSeq,
        }]
      : [];
    const exactLeaseInput = expectedLeaseDocuments.length === leaseDocuments.length
      && expectedLeaseDocuments.every((expected, index) => {
        const received = leaseDocuments[index];
        return received?.documentId === expected.documentId
          && received.generation === expected.generation
          && received.expectedHeadSeq === expected.expectedHeadSeq;
      });
    if (!exactLeaseInput) {
      return nodexAgentCreatePagesFailure(
        "Agent Page batch lease closure does not match its prepared destination",
      );
    }
    return await this.executeNodexAgentLeasedMutation({
      storeEpoch: command.storeEpoch,
      leaseDocuments,
      execute: async () => await execute(command),
      failure: nodexAgentCreatePagesFailure,
      operationLabel: "Agent Page batch create",
      conflictMessage: "Destination Document changed while preparing Page creation",
    });
  };

  executeNodexAgentDuplicatePage = async (
    command: NodexAgentDuplicatePageCommand,
  ): Promise<ExecuteNodexAgentDuplicatePageResult> => {
    const execute = this.backend.executeNodexAgentDuplicatePage;
    if (!execute) {
      return nodexAgentDuplicatePageFailure(
        "The durable Agent Page duplicate writer is unavailable",
      );
    }
    return await this.executeNodexAgentLeasedMutation({
      storeEpoch: command.storeEpoch,
      leaseDocuments: command.leaseDocuments,
      execute: async () => await execute(command),
      failure: nodexAgentDuplicatePageFailure,
      operationLabel: "Agent Page duplicate",
      conflictMessage: "A duplicated Page Document changed while preparing the copy",
    });
  };

  executeNodexAgentMovePages = async (
    command: NodexAgentMovePagesCommand,
  ): Promise<ExecuteNodexAgentMovePagesResult> => {
    const execute = this.backend.executeNodexAgentMovePages;
    if (!execute) {
      return nodexAgentMovePagesFailure(
        "The durable Agent Page move writer is unavailable",
      );
    }
    return await this.executeNodexAgentLeasedMutation({
      storeEpoch: command.storeEpoch,
      leaseDocuments: command.leaseDocuments,
      execute: async () => await execute(command),
      failure: nodexAgentMovePagesFailure,
      operationLabel: "Agent Page move",
      conflictMessage: "A moved Page Document changed while preparing relocation",
    });
  };

  publishAwareness = (
    target: DocumentSyncClientTarget,
    request: DocumentAwarenessPublishRequest,
  ): DocumentSyncCommandResult<DocumentAwarenessPublishAck> => {
    const subscription = this.requireSubscription(target, request);
    if (!subscription?.awareness) {
      return documentSyncUnauthorized();
    }
    const awareness = subscription.awareness;
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

    awareness.on("update", captureChanges);
    try {
      applyAwarenessUpdate(
        awareness,
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
      awareness.off("update", captureChanges);
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
    const subscription = this.requireAnySubscription(target, request);
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

  /**
   * Invalidates every live transport identity after a whole-store restore.
   * The notification is sent before subscriptions are removed so mounted
   * surfaces can clear disposable state and recreate themselves. Once this
   * returns, an old target can no longer sync or apply through the Hub.
   */
  resetForStoreReplacement(storeEpoch: string): void {
    for (const leaseId of [...this.relocationLeaseBoundaries.keys()]) {
      this.cancelRelocationLease(leaseId);
    }

    const subscriptions = [...this.subscriptions.values()];
    for (const subscription of subscriptions) {
      if (subscription.engine === "canvas_scene") {
        if (subscription.generation !== undefined && subscription.headSeq !== undefined) {
          safeSendToWebContents(subscription.target, DOCUMENT_SYNC_EVENT_CHANNEL, [{
            type: "canvas_scene_resync_required",
            version: CANVAS_SCENE_SYNC_VERSION,
            projectId: subscription.projectId ?? "",
            documentId: subscription.documentId,
            storeEpoch,
            generation: subscription.generation,
            headSeq: subscription.headSeq,
          } satisfies CanvasSceneRealtimeEvent]);
        }
        continue;
      }
      safeSendToWebContents(subscription.target, DOCUMENT_SYNC_EVENT_CHANNEL, [
        {
          kind: "store-reset",
          documentId: subscription.documentId,
          storeEpoch,
        } satisfies DocumentSyncRealtimeEvent,
      ]);
    }
    subscriptions.forEach((subscription) => {
      if (this.subscriptions.has(subscription.key)) {
        this.removeSubscription(subscription);
      }
    });
  }

  /**
   * Invalidates only Documents physically removed with a Project. The delete
   * itself is serialized by the durable writer; this post-commit reset drops
   * the old Hub authorization so a mounted surface cannot keep submitting
   * updates for an identity that no longer exists.
   */
  resetForDeletedDocuments(
    documentIds: readonly string[],
    storeEpoch: string,
  ): void {
    const deletedDocumentIds = new Set(documentIds);
    if (deletedDocumentIds.size === 0) return;

    for (const [leaseId, lease] of this.relocationLeaseBoundaries) {
      const touchesDeletedDocument = [...lease.documents.keys()].some(
        (documentId) => deletedDocumentIds.has(documentId),
      );
      if (touchesDeletedDocument) this.cancelRelocationLease(leaseId);
    }

    const subscriptions = [...this.subscriptions.values()].filter(
      (subscription) => deletedDocumentIds.has(subscription.documentId),
    );
    for (const subscription of subscriptions) {
      if (subscription.engine === "canvas_scene") {
        if (subscription.generation !== undefined && subscription.headSeq !== undefined) {
          safeSendToWebContents(subscription.target, DOCUMENT_SYNC_EVENT_CHANNEL, [{
            type: "canvas_scene_resync_required",
            version: CANVAS_SCENE_SYNC_VERSION,
            projectId: subscription.projectId ?? "",
            documentId: subscription.documentId,
            storeEpoch,
            generation: subscription.generation,
            headSeq: subscription.headSeq,
          } satisfies CanvasSceneRealtimeEvent]);
        }
        continue;
      }
      safeSendToWebContents(subscription.target, DOCUMENT_SYNC_EVENT_CHANNEL, [
        {
          kind: "store-reset",
          documentId: subscription.documentId,
          storeEpoch,
        } satisfies DocumentSyncRealtimeEvent,
      ]);
    }
    subscriptions.forEach((subscription) => {
      if (this.subscriptions.has(subscription.key)) {
        this.removeSubscription(subscription);
      }
    });
  }

  private createRelocationLeaseId(): string {
    this.relocationLeaseSequence += 1;
    return `document-relocation-lease:${this.relocationLeaseSequence.toString(36)}`;
  }

  private createBlockTransferLeaseId(): string {
    this.blockTransferLeaseSequence += 1;
    return `block-transfer-lease:${this.blockTransferLeaseSequence.toString(36)}`;
  }

  private createDocumentMutationLeaseId(): string {
    this.documentMutationLeaseSequence += 1;
    return `document-mutation-lease:${this.documentMutationLeaseSequence.toString(36)}`;
  }

  private createAdditionalDocumentLeaseId(): string {
    this.additionalDocumentLeaseSequence += 1;
    return `additional-document-lease:${this.additionalDocumentLeaseSequence.toString(36)}`;
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

  private setBlockTransferLeaseBoundary(
    leaseId: string,
    storeEpoch: string,
    heads: readonly BlockTransferDocumentHead[],
  ): void {
    this.relocationLeaseBoundaries.set(leaseId, {
      leaseId,
      documents: new Map(
        heads.map((head) => [
          head.documentId,
          {
            documentId: head.documentId,
            storeEpoch,
            generation: head.generation,
            headSeq: head.expectedHeadSeq,
          },
        ]),
      ),
    });
  }

  private setBlockTransferResultBoundary(
    leaseId: string,
    storeEpoch: string,
    leasedHeads: readonly BlockTransferDocumentHead[],
    receipt: BlockTransferReceipt,
  ): void {
    const committedById = new Map(
      receipt.documentCommits.map((commit) => [commit.documentId, commit]),
    );
    this.setBlockTransferLeaseBoundary(
      leaseId,
      storeEpoch,
      leasedHeads.map((leased) => {
        const committed = committedById.get(leased.documentId);
        return committed
          ? {
              documentId: committed.documentId,
              generation: committed.generation,
              expectedHeadSeq: committed.headSeq,
            }
          : leased;
      }),
    );
  }

  private setAdditionalDocumentLeaseBoundary(
    leaseId: string,
    storeEpoch: string,
    heads: readonly AdditionalDocumentHeadRevision[],
  ): void {
    this.relocationLeaseBoundaries.set(leaseId, {
      leaseId,
      documents: new Map(
        heads.map((head) => [
          head.documentId,
          {
            documentId: head.documentId,
            storeEpoch,
            generation: head.generation,
            headSeq: head.headSeq,
          },
        ]),
      ),
    });
  }

  private setAdditionalDocumentResultBoundary(
    leaseId: string,
    storeEpoch: string,
    leasedHeads: readonly AdditionalDocumentHeadRevision[],
    committedHeads: readonly AdditionalDocumentHeadRevision[],
  ): void {
    const committedById = new Map(
      committedHeads.map((head) => [head.documentId, head]),
    );
    this.setAdditionalDocumentLeaseBoundary(
      leaseId,
      storeEpoch,
      leasedHeads.map((leased) => committedById.get(leased.documentId) ?? leased),
    );
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

  private fanoutBlockTransferResult(receipt: BlockTransferReceipt): void {
    for (const commit of receipt.documentCommits) {
      this.fanoutRelocationCommit(receipt.storeEpoch, commit);
    }
  }

  private fanoutBlockTransferResync(receipt: BlockTransferReceipt): void {
    for (const commit of receipt.documentCommits) {
      this.fanout(commit.documentId, {
        kind: "resync-required",
        documentId: commit.documentId,
        storeEpoch: receipt.storeEpoch,
        generation: commit.generation,
        headSeq: commit.headSeq,
        reason: "event-gap",
      });
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
    this.fanoutCanvasScene(result.documentId, {
      type: "canvas_scene_resync_required",
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: result.projectId,
      documentId: result.documentId,
      storeEpoch: result.storeEpoch,
      generation: result.generation,
      headSeq: result.headSeq,
    });
  }

  private fanoutAdditionalDocumentResync(
    receipt: AdditionalDocumentCommandReceipt,
  ): void {
    for (const head of receipt.effect.documentHeads) {
      this.fanout(head.documentId, {
        kind: "resync-required",
        documentId: head.documentId,
        storeEpoch: receipt.storeEpoch,
        generation: head.generation,
        headSeq: head.headSeq,
        reason: "event-gap",
      });
    }
  }

  private publishAdditionalDocumentReleaseFallback(
    leaseId: string,
    storeEpoch: string,
    leasedHeads: readonly AdditionalDocumentHeadRevision[],
    committedHeads: readonly AdditionalDocumentHeadRevision[],
  ): void {
    const committedById = new Map(
      committedHeads.map((head) => [head.documentId, head]),
    );
    for (const leased of leasedHeads) {
      const head = committedById.get(leased.documentId) ?? leased;
      const keys = this.subscriptionKeysByDocument.get(head.documentId);
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
              documentId: head.documentId,
              clientSessionId: subscription.clientSessionId,
              storeEpoch,
              generation: head.generation,
              headSeq: head.headSeq,
            } satisfies DocumentSyncRealtimeEvent,
          ],
        );
      }
    }
  }

  private publishBlockTransferReleaseFallback(
    leaseId: string,
    storeEpoch: string,
    leasedHeads: readonly BlockTransferDocumentHead[],
    receipt: BlockTransferReceipt,
  ): void {
    const committedById = new Map(
      receipt.documentCommits.map((commit) => [commit.documentId, commit]),
    );
    for (const leased of leasedHeads) {
      const committed = committedById.get(leased.documentId);
      const head = committed
        ? {
            documentId: committed.documentId,
            generation: committed.generation,
            headSeq: committed.headSeq,
          }
        : {
            documentId: leased.documentId,
            generation: leased.generation,
            headSeq: leased.expectedHeadSeq,
          };
      const keys = this.subscriptionKeysByDocument.get(head.documentId);
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
              documentId: head.documentId,
              clientSessionId: subscription.clientSessionId,
              storeEpoch,
              generation: head.generation,
              headSeq: head.headSeq,
            } satisfies DocumentSyncRealtimeEvent,
          ],
        );
      }
    }
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

  private requireAnySubscription(
    target: DocumentSyncClientTarget,
    request: DocumentSyncSubscribeRequest,
  ): DocumentSubscription | null {
    if (target.isDestroyed() || !hasIdentity(request)) return null;
    return [...this.subscriptions.values()].find(
      (subscription) =>
        subscription.target === target &&
        subscription.documentId === request.documentId &&
        subscription.clientSessionId === request.clientSessionId,
    ) ?? null;
  }

  private requireCanvasSceneSubscription(
    target: DocumentSyncClientTarget,
    request: CanvasSceneSyncRequest | CanvasSceneMutationRequest,
  ): DocumentSubscription | null {
    if (target.isDestroyed() || !hasCanvasSceneIdentity(request)) return null;
    const subscription = this.subscriptions.get(
      canvasSceneSubscriptionKey(target.id, request),
    );
    return subscription?.target === target &&
        subscription.engine === "canvas_scene" &&
        subscription.projectId === request.projectId
      ? subscription
      : null;
  }

  private fanoutCanvasScene(
    documentId: string,
    event: CanvasSceneRealtimeEvent,
  ): void {
    const keys = this.subscriptionKeysByDocument.get(documentId);
    if (!keys) return;
    const targets = new Map<number, DocumentSyncClientTarget>();
    keys.forEach((key) => {
      const subscription = this.subscriptions.get(key);
      if (subscription?.engine === "canvas_scene") {
        targets.set(subscription.target.id, subscription.target);
      }
    });
    targets.forEach((target) => {
      safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
    });
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
    if (!subscription.awareness) return;
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
    subscription.awareness?.destroy();
    subscription.awarenessDocument?.destroy();
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
      if (subscription?.engine === "yjs") {
        targets.set(subscription.target.id, subscription.target);
      }
    });
    targets.forEach((target) => {
      safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
    });
  }
}
