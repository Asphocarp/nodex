import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness.js";
import {
  MAX_DOCUMENT_AWARENESS_UPDATE_BYTES,
  type DocumentAwarenessPublishAck,
  type DocumentAwarenessPublishRequest,
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
import { safeSendToWebContents } from "./ipc-safe-send";

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
}

interface DocumentSubscription {
  readonly key: string;
  readonly documentId: string;
  readonly clientSessionId: string;
  readonly target: DocumentSyncClientTarget;
  readonly awarenessDocument: Y.Doc;
  readonly awareness: Awareness;
  storeEpoch?: string;
  generation?: number;
}

const commandError = (
  code: DocumentSyncCommandError["code"],
  message: string,
  options: { readonly retryable?: boolean; readonly resetRequired?: boolean } = {},
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

const subscriptionKey = (
  targetId: number,
  request: DocumentSyncSubscribeRequest,
): string =>
  JSON.stringify([targetId, request.clientSessionId, request.documentId]);

const createSubscriptionAwareness = (): {
  readonly document: Y.Doc;
  readonly awareness: Awareness;
} => {
  const document = new Y.Doc();
  const awareness = new Awareness(document);
  awareness.setLocalState(null);
  return { document, awareness };
};

const inspectLiveAwarenessClientIds = (update: Uint8Array): readonly number[] => {
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

export class DocumentSyncHub {
  private readonly backend: DocumentSyncDurableBackend;
  private readonly subscriptions = new Map<string, DocumentSubscription>();
  private readonly subscriptionKeysByDocument = new Map<string, Set<string>>();
  private readonly boundTargetIds = new Set<number>();
  private readonly sessionOwnerTargetIds = new Map<string, number>();
  private readonly awarenessClientOwnersByDocument = new Map<
    string,
    Map<number, string>
  >();

  constructor(backend: DocumentSyncDurableBackend) {
    this.backend = backend;
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
        commandError("invalid_document_update", "Document subscription identity is required"),
      );
    }
    if (!this.bindSessionOwner(target, request.clientSessionId)) {
      return documentSyncUnauthorized();
    }

    this.bindTargetLifecycle(target);
    const key = subscriptionKey(target.id, request);
    if (!this.subscriptions.has(key)) {
      const awarenessState = createSubscriptionAwareness();
      this.subscriptions.set(key, {
        key,
        documentId: request.documentId,
        clientSessionId: request.clientSessionId,
        target,
        awarenessDocument: awarenessState.document,
        awareness: awarenessState.awareness,
      });
      const documentKeys = this.subscriptionKeysByDocument.get(request.documentId)
        ?? new Set<string>();
      documentKeys.add(key);
      this.subscriptionKeysByDocument.set(request.documentId, documentKeys);
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
        commandError("invalid_document_update", "Document subscription identity is required"),
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
      return invalidResponse("The durable backend returned a different document");
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
      return invalidResponse("The durable document ACK does not match its command");
    }

    this.adoptSubscriptionBoundary(subscription, ack.storeEpoch, ack.generation);
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
        commandError("invalid_awareness_update", "Awareness update exceeds the size limit"),
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
        commandError("invalid_awareness_update", "Awareness update is malformed"),
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
      changes.added.forEach((clientId) => owners.set(clientId, subscription.key));
      changes.updated.forEach((clientId) => owners.set(clientId, subscription.key));
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
        commandError("invalid_awareness_update", "Awareness update is malformed"),
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

  handleTargetDestroyed = (targetId: number): void => {
    const subscriptions = [...this.subscriptions.values()].filter(
      (subscription) => subscription.target.id === targetId,
    );
    subscriptions.forEach((subscription) => this.removeSubscription(subscription));
    this.boundTargetIds.delete(targetId);
  };

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
    const subscription = this.subscriptions.get(subscriptionKey(target.id, request));
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
    const owners = this.awarenessClientOwnersByDocument.get(subscription.documentId);
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
