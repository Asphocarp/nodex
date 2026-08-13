import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import type {
  BlockId,
  DocumentId,
  OwnedDocumentDescriptor,
} from "../../shared/block-documents/contracts";
import {
  PAGE_DOCUMENT_SCHEMA_KEY,
  PAGE_DOCUMENT_SCHEMA_VERSION,
  getYjsDocumentSchemaAdapter,
  type BlockDocumentSchemaAdapter,
} from "../../shared/block-documents";
import type {
  DocumentAwarenessPublishRequest,
  DocumentSyncAdapter,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
  DocumentSyncRealtimeEvent,
  DocumentSyncResponse,
} from "../../shared/block-documents/document-sync";
export type { DocumentSyncAdapter } from "../../shared/block-documents/document-sync";
import {
  createDefaultDocumentLocalCheckpointStore,
  hasDocumentUpdateContent,
  restoreDocumentLocalCheckpoint,
  type DocumentLocalCheckpoint,
  type DocumentLocalCheckpointStore,
} from "./document-local-checkpoint";
import { BoundedBurstScheduler } from "./bounded-burst-scheduler";

export type NodexYProviderPhase =
  | "idle"
  | "connecting"
  | "synced"
  | "saving"
  | "offline"
  | "error"
  | "reset-required"
  | "destroyed";

export type DocumentCheckpointPhase =
  | "idle"
  | "saving"
  | "ready"
  | "degraded"
  | "disabled";

export interface DocumentCheckpointStatus {
  readonly phase: DocumentCheckpointPhase;
  readonly failureCount: number;
  readonly lastFailureMessage?: string;
}

export interface NodexYProviderStatus {
  readonly phase: NodexYProviderPhase;
  readonly documentId: DocumentId;
  readonly clientSessionId: string;
  readonly connected: boolean;
  readonly storeEpoch?: string;
  readonly generation?: number;
  readonly headSeq: number;
  readonly pendingUpdateCount: number;
  readonly inFlightUpdateId?: string;
  readonly checkpoint: DocumentCheckpointStatus;
  readonly error?: DocumentSyncCommandError;
}

export type NodexYProviderRetryScheduler = (
  callback: () => void,
  attempt: number,
) => () => void;

export interface NodexYProviderOptions {
  readonly documentId: DocumentId;
  /** The surface owns this Y.Doc and must destroy it after the provider. */
  readonly document: Y.Doc;
  readonly adapter: DocumentSyncAdapter;
  readonly clientSessionId?: string;
  readonly expectedStoreEpoch?: string;
  readonly expectedGeneration?: number;
  readonly autoConnect?: boolean;
  readonly createUpdateId?: (
    clientSessionId: string,
    sequence: number,
  ) => string;
  /** touchedBlockIds are diagnostics until the writer derives them itself. */
  readonly resolveTouchedBlockIds?: (update: Uint8Array) => readonly BlockId[];
  readonly scheduleRetry?: NodexYProviderRetryScheduler;
  readonly now?: () => number;
  /** Disposable local recovery state. SQLite remains the durable authority. */
  readonly localCheckpointStore?: DocumentLocalCheckpointStore | null;
  /** Registered schema identity used to validate disposable local recovery state. */
  readonly documentSchema?: Pick<
    OwnedDocumentDescriptor,
    "ownerType" | "schemaKey" | "schemaVersion"
  >;
}

interface PendingDurableUpdate {
  readonly request: DocumentSyncApplyRequest;
  attempt: number;
}

interface FlushWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

type RetryKind = "sync" | "apply";

const REMOTE_DOCUMENT_ORIGIN = Object.freeze({
  source: "nodex-y-provider-remote-document",
});
const REMOTE_AWARENESS_ORIGIN = Object.freeze({
  source: "nodex-y-provider-remote-awareness",
});
const LOCAL_CHECKPOINT_ORIGIN = Object.freeze({
  source: "nodex-y-provider-local-checkpoint",
});
const DEFAULT_PAGE_DOCUMENT_SCHEMA = {
  ownerType: "page",
  schemaKey: PAGE_DOCUMENT_SCHEMA_KEY,
  schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
} as const;

// Editor integrations can emit several Yjs transactions for one visible
// gesture. Keep SQLite durability prompt, but do not promote each transaction
// into its own commit/projection cascade.
const DOCUMENT_UPDATE_BATCH_QUIET_MS = 120;
const DOCUMENT_UPDATE_BATCH_MAX_MS = 500;

// The disposable recovery cache stores merged local deltas, not repeated full
// Y.Doc snapshots. Keep its IndexedDB work outside the typing hot path while
// still bounding how long an offline edit exists only in renderer memory.
const DOCUMENT_CHECKPOINT_QUIET_MS = 500;
const DOCUMENT_CHECKPOINT_MAX_MS = 5_000;

let fallbackSessionSequence = 0;

const copyBytes = (value: Uint8Array): Uint8Array => value.slice();

export interface BoundedYjsUpdateBatch {
  readonly update: Uint8Array;
  readonly consumedUpdates: number;
}

/**
 * Takes the largest conservative prefix whose raw updates fit one transport
 * envelope, then verifies the merged encoding against the exact byte limit.
 */
export const mergeNextBoundedYjsUpdate = (
  updates: readonly Uint8Array[],
  maxUpdateBytes: number,
): BoundedYjsUpdateBatch => {
  if (!Number.isSafeInteger(maxUpdateBytes) || maxUpdateBytes < 1) {
    throw new TypeError("maxUpdateBytes must be a positive integer");
  }
  if (updates.length === 0) {
    throw new TypeError("at least one Yjs update is required");
  }
  if ((updates[0]?.byteLength ?? 0) > maxUpdateBytes) {
    throw new RangeError(`Yjs update exceeds ${maxUpdateBytes} bytes`);
  }

  let consumedUpdates = 0;
  let rawBytes = 0;
  for (const update of updates) {
    if (
      consumedUpdates > 0
      && rawBytes + update.byteLength > maxUpdateBytes
    ) break;
    rawBytes += update.byteLength;
    consumedUpdates += 1;
  }

  let update = copyBytes(Y.mergeUpdates(updates.slice(0, consumedUpdates)));
  while (update.byteLength > maxUpdateBytes && consumedUpdates > 1) {
    consumedUpdates -= 1;
    update = copyBytes(Y.mergeUpdates(updates.slice(0, consumedUpdates)));
  }
  if (update.byteLength > maxUpdateBytes) {
    throw new RangeError(`Merged Yjs update exceeds ${maxUpdateBytes} bytes`);
  }
  return { update, consumedUpdates };
};

const makeClientSessionId = (): string => {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return `document-client:${randomId}`;
  }

  fallbackSessionSequence += 1;
  return `document-client:${Date.now().toString(36)}:${fallbackSessionSequence.toString(36)}`;
};

const defaultUpdateId = (clientSessionId: string, sequence: number): string =>
  `${clientSessionId}:update:${sequence.toString(36)}`;

const defaultRetryScheduler: NodexYProviderRetryScheduler = (
  callback,
  attempt,
) => {
  const delayMs = Math.min(5_000, 100 * 2 ** Math.min(attempt - 1, 6));
  const timeout = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timeout);
};

const thrownTransportError = (error: unknown): DocumentSyncCommandError => ({
  code: "transport_unavailable",
  message: error instanceof Error ? error.message : String(error),
  retryable: true,
  resetRequired: false,
});

const invalidResponseError = (message: string): DocumentSyncCommandError => ({
  code: "invalid_response",
  message,
  retryable: false,
  resetRequired: false,
});

const resetBoundaryError = (message: string): DocumentSyncCommandError => ({
  code: "store_epoch_mismatch",
  message,
  retryable: false,
  resetRequired: true,
});

const generationBoundaryError = (
  message: string,
): DocumentSyncCommandError => ({
  code: "document_generation_mismatch",
  message,
  retryable: false,
  resetRequired: true,
});

const providerDestroyedError = (): Error =>
  new Error("The Nodex Yjs provider has been destroyed");

const isNonNegativeInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

export const isDocumentApplyAckHeadValid = (
  ack: Pick<
    DocumentSyncApplyAck,
    "status" | "committedSeq" | "headSeq" | "duplicate"
  >,
  request: Pick<DocumentSyncApplyRequest, "baseHeadSeq">,
): boolean =>
  isNonNegativeInteger(ack.committedSeq) &&
  isNonNegativeInteger(ack.headSeq) &&
  ack.committedSeq >= request.baseHeadSeq + (
    ack.status === "committed" && !ack.duplicate ? 1 : 0
  ) &&
  ack.committedSeq <= ack.headSeq;

const requireNonEmpty = (value: string, field: string): string => {
  if (value.trim().length > 0) {
    return value;
  }
  throw new Error(`${field} must not be empty`);
};

const sameError = (
  left: DocumentSyncCommandError | undefined,
  right: DocumentSyncCommandError | undefined,
): boolean =>
  left?.code === right?.code &&
  left?.message === right?.message &&
  left?.retryable === right?.retryable &&
  left?.resetRequired === right?.resetRequired &&
  left?.relocationId === right?.relocationId &&
  left?.recoveryArtifactId === right?.recoveryArtifactId;

export class NodexYProvider {
  readonly documentId: DocumentId;
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly clientSessionId: string;

  private readonly adapter: DocumentSyncAdapter;
  private readonly expectedStoreEpoch?: string;
  private readonly expectedGeneration?: number;
  private readonly createUpdateId: NonNullable<
    NodexYProviderOptions["createUpdateId"]
  >;
  private readonly resolveTouchedBlockIds: NonNullable<
    NodexYProviderOptions["resolveTouchedBlockIds"]
  >;
  private readonly scheduleRetry: NodexYProviderRetryScheduler;
  private readonly now: () => number;
  private readonly localCheckpointStore: DocumentLocalCheckpointStore | null;
  private readonly documentSchemaAdapter: BlockDocumentSchemaAdapter;
  private readonly durableBatchScheduler: BoundedBurstScheduler;
  private readonly checkpointScheduler: BoundedBurstScheduler;
  private readonly statusListeners = new Set<() => void>();
  private readonly flushWaiters = new Set<FlushWaiter>();

  private status: NodexYProviderStatus;
  private unsubscribeRealtime: (() => void) | null = null;
  private connected = false;
  private syncing = false;
  private syncAgain = false;
  private syncPromise: Promise<void> | null = null;
  private storeEpoch: string | undefined;
  private generation: number | undefined;
  private headSeq = 0;
  private queuedUpdates: Uint8Array[] = [];
  private batchScheduled = false;
  private inFlight: PendingDurableUpdate | null = null;
  private applyCallActive = false;
  private updateSequence = 0;
  private retryCancel: (() => void) | null = null;
  private retryKind: RetryKind | null = null;
  private syncRetryAttempt = 0;
  private bufferedDocumentEvents: Array<
    Extract<DocumentSyncRealtimeEvent, { kind: "document-update" }>
  > = [];
  private bufferedAwarenessEvents: Array<
    Extract<DocumentSyncRealtimeEvent, { kind: "awareness" }>
  > = [];
  private transientError: DocumentSyncCommandError | undefined;
  private terminalError: DocumentSyncCommandError | undefined;
  private resetRequired = false;
  private destroyed = false;
  private checkpointHydrated = false;
  private checkpointDisabled = false;
  private checkpointUpdates: Uint8Array[] = [];
  private checkpointRetryBlocked = false;
  private checkpointChain: Promise<void> = Promise.resolve();
  private checkpointPhase: DocumentCheckpointPhase;
  private checkpointFailureCount = 0;
  private checkpointLastFailureMessage: string | undefined;
  private localUpdateSequence = 0;

  private readonly handleDocumentUpdate = (
    update: Uint8Array,
    origin: unknown,
  ): void => {
    if (
      this.destroyed ||
      this.terminalError ||
      origin === REMOTE_DOCUMENT_ORIGIN ||
      origin === LOCAL_CHECKPOINT_ORIGIN
    ) {
      return;
    }

    this.localUpdateSequence += 1;
    const localUpdate = copyBytes(update);
    this.queuedUpdates.push(localUpdate);
    this.checkpointUpdates.push(localUpdate);
    this.checkpointRetryBlocked = false;
    this.scheduleBatch();
    this.queueLocalCheckpointBestEffort();
    this.refreshStatus();
  };

  private readonly handleAwarenessUpdate = (
    changes: {
      readonly added: readonly number[];
      readonly updated: readonly number[];
      readonly removed: readonly number[];
    },
    origin: unknown,
  ): void => {
    if (
      this.destroyed ||
      origin === REMOTE_AWARENESS_ORIGIN ||
      !this.connected ||
      !this.storeEpoch ||
      this.generation === undefined
    ) {
      return;
    }

    const clients = [...changes.added, ...changes.updated, ...changes.removed];
    if (clients.length === 0) {
      return;
    }

    const request: DocumentAwarenessPublishRequest = {
      documentId: this.documentId,
      clientSessionId: this.clientSessionId,
      storeEpoch: this.storeEpoch,
      generation: this.generation,
      update: copyBytes(encodeAwarenessUpdate(this.awareness, clients)),
    };
    this.publishAwarenessBestEffort(request);
  };

  constructor(options: NodexYProviderOptions) {
    this.documentId = requireNonEmpty(options.documentId, "documentId");
    this.document = options.document;
    this.adapter = options.adapter;
    this.clientSessionId = requireNonEmpty(
      options.clientSessionId ?? makeClientSessionId(),
      "clientSessionId",
    );
    this.expectedStoreEpoch = options.expectedStoreEpoch;
    this.expectedGeneration = options.expectedGeneration;
    this.createUpdateId = options.createUpdateId ?? defaultUpdateId;
    this.resolveTouchedBlockIds = options.resolveTouchedBlockIds ?? (() => []);
    this.scheduleRetry = options.scheduleRetry ?? defaultRetryScheduler;
    this.now = options.now ?? (() => Date.now());
    this.localCheckpointStore =
      options.localCheckpointStore === undefined
        ? createDefaultDocumentLocalCheckpointStore()
        : options.localCheckpointStore;
    this.checkpointPhase = this.localCheckpointStore ? "idle" : "disabled";
    this.documentSchemaAdapter = getYjsDocumentSchemaAdapter(
      options.documentSchema ?? DEFAULT_PAGE_DOCUMENT_SCHEMA,
    );
    this.durableBatchScheduler = new BoundedBurstScheduler({
      quietMs: DOCUMENT_UPDATE_BATCH_QUIET_MS,
      maxMs: DOCUMENT_UPDATE_BATCH_MAX_MS,
      onReady: () => {
        this.batchScheduled = false;
        this.pumpDurableQueue();
      },
    });
    this.checkpointScheduler = new BoundedBurstScheduler({
      quietMs: DOCUMENT_CHECKPOINT_QUIET_MS,
      maxMs: DOCUMENT_CHECKPOINT_MAX_MS,
      onReady: () => this.drainScheduledLocalCheckpoint(),
    });
    this.awareness = new Awareness(this.document);
    this.status = this.buildStatus();

    this.document.on("update", this.handleDocumentUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);

    if (options.autoConnect !== false) {
      void this.connect();
    }
  }

  getStatus = (): NodexYProviderStatus => this.status;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  connect = async (): Promise<void> => {
    if (this.destroyed || this.terminalError) {
      return;
    }

    this.connected = true;
    if (!this.unsubscribeRealtime) {
      let unsubscribe: (() => void) | undefined;
      try {
        unsubscribe = this.adapter.subscribe(
          {
            documentId: this.documentId,
            clientSessionId: this.clientSessionId,
          },
          this.handleRealtimeEvent,
        );
      } catch (error) {
        this.handleCommandError(thrownTransportError(error), "sync");
        return;
      }
      if (this.destroyed || this.terminalError) {
        try {
          unsubscribe();
        } catch {
          // A failed cleanup must not revive a terminal provider.
        }
        return;
      }
      this.unsubscribeRealtime = unsubscribe;
    }
    this.refreshStatus();
    if (!this.connected) {
      return;
    }

    this.cancelRetry();
    await this.requestSync();
  };

  disconnect = (): void => {
    if (this.destroyed) {
      return;
    }

    this.clearRealtimeSubscription();
    this.connected = false;
    this.cancelRetry();
    this.removeRemoteAwarenessStates();
    this.refreshStatus();
  };

  flush = (): Promise<void> => {
    if (this.destroyed) {
      return Promise.reject(providerDestroyedError());
    }
    if (this.terminalError) {
      return Promise.reject(new Error(this.terminalError.message));
    }

    this.batchScheduled = false;
    this.durableBatchScheduler.cancel();
    if (this.retryCancel || !this.connected) {
      this.cancelRetry();
      void this.connect();
    } else {
      this.pumpDurableQueue();
    }
    if (this.isDurablyIdle()) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this.flushWaiters.add({ resolve, reject });
    });
  };

  checkpoint = async (): Promise<void> => {
    if (this.destroyed) {
      throw providerDestroyedError();
    }
    this.checkpointRetryBlocked = false;
    this.checkpointScheduler.cancel();
    await this.queueLocalCheckpoint();
  };

  destroy = (): void => {
    if (this.destroyed) {
      return;
    }

    // Capture once before tearing down the surface-owned Y.Doc. Normal close
    // awaits checkpoint(); this is only the best-effort crash-recovery fallback.
    this.checkpointRetryBlocked = false;
    this.checkpointScheduler.cancel();
    void this.queueLocalCheckpoint().catch(() => undefined);
    if (this.awareness.getLocalState() !== null) {
      this.awareness.setLocalState(null);
    }
    this.destroyed = true;
    this.connected = false;
    this.cancelRetry();
    this.durableBatchScheduler.dispose();
    this.checkpointScheduler.dispose();
    this.clearRealtimeSubscription();
    this.document.off("update", this.handleDocumentUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.awareness.destroy();
    this.queuedUpdates = [];
    this.checkpointUpdates = [];
    this.inFlight = null;
    this.bufferedDocumentEvents = [];
    this.bufferedAwarenessEvents = [];
    this.rejectFlushWaiters(providerDestroyedError());
    this.refreshStatus();
    this.statusListeners.clear();
  };

  private readonly handleRealtimeEvent = (
    event: DocumentSyncRealtimeEvent,
  ): void => {
    if (this.destroyed || this.terminalError) {
      return;
    }
    if (event.documentId !== this.documentId) {
      this.enterFatal(
        invalidResponseError(
          `Document subscription for ${this.documentId} received ${event.documentId}`,
        ),
      );
      return;
    }

    if (event.kind === "connection") {
      this.handleConnectionEvent(event.state);
      return;
    }
    if (event.kind === "store-reset") {
      this.enterReset(
        resetBoundaryError(
          `The local store was restored as epoch ${event.storeEpoch}; Document ${this.documentId} must reload`,
        ),
      );
      return;
    }
    if (event.kind === "awareness") {
      this.handleRemoteAwareness(event);
      return;
    }
    if (event.kind === "resync-required") {
      if (
        event.reason === "resource-integrity-failure"
        || event.reason === "identity-boundary-changed"
        || event.reason === "access-revoked"
      ) {
        this.enterReset({
          code: event.reason === "access-revoked"
            ? "unauthorized"
            : "recovery_required",
          message: event.reason === "access-revoked"
            ? `Access to Document ${this.documentId} was revoked`
            : `Document ${this.documentId} crossed a local identity or integrity boundary`,
          retryable: false,
          resetRequired: true,
        });
        return;
      }
      if (!this.assertBoundary(event.storeEpoch, event.generation)) {
        return;
      }
      this.requestResync();
      return;
    }
    if (this.syncing || !this.storeEpoch || this.generation === undefined) {
      this.bufferedDocumentEvents.push(event);
      return;
    }

    this.applyRealtimeDocumentEvent(event);
  };

  private handleConnectionEvent(state: "connected" | "disconnected"): void {
    if (state === "disconnected") {
      this.connected = false;
      this.cancelRetry();
      this.removeRemoteAwarenessStates();
      this.refreshStatus();
      return;
    }

    const wasConnected = this.connected;
    this.connected = true;
    this.cancelRetry();
    this.refreshStatus();
    if (!wasConnected) {
      void this.requestSync();
    }
  }

  private handleRemoteAwareness(
    event: Extract<DocumentSyncRealtimeEvent, { kind: "awareness" }>,
  ): void {
    if (event.clientSessionId === this.clientSessionId) {
      return;
    }
    if (!this.storeEpoch || this.generation === undefined) {
      this.bufferedAwarenessEvents.push(event);
      return;
    }
    if (!this.assertBoundary(event.storeEpoch, event.generation)) {
      return;
    }

    try {
      applyAwarenessUpdate(
        this.awareness,
        copyBytes(event.update),
        REMOTE_AWARENESS_ORIGIN,
      );
    } catch (error) {
      this.enterFatal(
        invalidResponseError(
          `Invalid awareness update: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  private requestResync(): void {
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    void this.requestSync();
  }

  private requestSync(): Promise<void> {
    if (
      this.destroyed ||
      this.terminalError ||
      !this.connected ||
      this.retryCancel
    ) {
      return Promise.resolve();
    }
    if (this.syncPromise) {
      this.syncAgain = true;
      return this.syncPromise;
    }

    this.syncing = true;
    this.refreshStatus();
    const promise = this.performSync().finally(() => {
      if (this.syncPromise === promise) {
        this.syncPromise = null;
      }
      this.syncing = false;
      this.refreshStatus();
      const shouldSyncAgain = this.syncAgain;
      this.syncAgain = false;
      if (
        shouldSyncAgain &&
        !this.destroyed &&
        !this.terminalError &&
        this.connected
      ) {
        void this.requestSync();
        return;
      }
      this.resolveFlushWaitersIfIdle();
      this.pumpDurableQueue();
    });
    this.syncPromise = promise;
    return promise;
  }

  private async performSync(): Promise<void> {
    let result: DocumentSyncCommandResult<DocumentSyncResponse>;
    try {
      result = await this.adapter.sync({
        documentId: this.documentId,
        clientSessionId: this.clientSessionId,
        stateVector: copyBytes(Y.encodeStateVector(this.document)),
      });
    } catch (error) {
      this.handleCommandError(thrownTransportError(error), "sync");
      return;
    }
    if (this.destroyed || this.terminalError || !this.connected) {
      return;
    }
    if (!result.ok) {
      this.handleCommandError(result.error, "sync");
      return;
    }

    const response = result.value;
    if (!this.validateSyncResponse(response)) {
      return;
    }
    if (!this.adoptBoundary(response.storeEpoch, response.generation)) {
      return;
    }

    try {
      Y.applyUpdate(
        this.document,
        copyBytes(response.update),
        REMOTE_DOCUMENT_ORIGIN,
      );
    } catch (error) {
      this.enterFatal(
        invalidResponseError(
          `Invalid document sync update: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }

    this.headSeq = response.headSeq;
    this.transientError = undefined;
    this.syncRetryAttempt = 0;
    this.drainBufferedEvents();
    this.publishLocalAwareness();
    this.startLocalCheckpointHydration(response);
    // A surface normally becomes editable only after this boundary exists,
    // but preserve edits made during a slow first sync without polling an
    // unaddressable cache key beforehand.
    this.queueLocalCheckpointBestEffort();
    this.refreshStatus();
  }

  private validateSyncResponse(response: DocumentSyncResponse): boolean {
    if (response.documentId !== this.documentId) {
      this.enterFatal(
        invalidResponseError(
          `Sync for ${this.documentId} received ${response.documentId}`,
        ),
      );
      return false;
    }
    if (
      response.storeEpoch.trim().length === 0 ||
      !isNonNegativeInteger(response.headSeq) ||
      response.headSeq < this.headSeq ||
      !Number.isInteger(response.generation) ||
      response.generation < 1
    ) {
      this.enterFatal(
        invalidResponseError("Sync response has an invalid head"),
      );
      return false;
    }
    return true;
  }

  private adoptBoundary(storeEpoch: string, generation: number): boolean {
    const expectedEpoch = this.storeEpoch ?? this.expectedStoreEpoch;
    if (expectedEpoch !== undefined && expectedEpoch !== storeEpoch) {
      this.enterReset(
        resetBoundaryError(
          `Document ${this.documentId} moved from store epoch ${expectedEpoch} to ${storeEpoch}`,
        ),
      );
      return false;
    }

    const expectedGeneration = this.generation ?? this.expectedGeneration;
    if (expectedGeneration !== undefined && expectedGeneration !== generation) {
      this.enterReset(
        generationBoundaryError(
          `Document ${this.documentId} moved from generation ${expectedGeneration} to ${generation}`,
        ),
      );
      return false;
    }

    this.storeEpoch = storeEpoch;
    this.generation = generation;
    return true;
  }

  private assertBoundary(storeEpoch: string, generation: number): boolean {
    if (!this.storeEpoch || this.generation === undefined) {
      return false;
    }
    if (storeEpoch !== this.storeEpoch) {
      this.enterReset(
        resetBoundaryError(
          `Document ${this.documentId} received store epoch ${storeEpoch}; expected ${this.storeEpoch}`,
        ),
      );
      return false;
    }
    if (generation !== this.generation) {
      this.enterReset(
        generationBoundaryError(
          `Document ${this.documentId} received generation ${generation}; expected ${this.generation}`,
        ),
      );
      return false;
    }
    return true;
  }

  private drainBufferedEvents(): void {
    const documentEvents = this.bufferedDocumentEvents.sort(
      (left, right) => left.headSeq - right.headSeq,
    );
    this.bufferedDocumentEvents = [];
    for (const event of documentEvents) {
      if (this.terminalError) {
        return;
      }
      this.applyRealtimeDocumentEvent(event);
    }

    const awarenessEvents = this.bufferedAwarenessEvents;
    this.bufferedAwarenessEvents = [];
    awarenessEvents.forEach((event) => this.handleRemoteAwareness(event));
  }

  private applyRealtimeDocumentEvent(
    event: Extract<DocumentSyncRealtimeEvent, { kind: "document-update" }>,
  ): void {
    if (!this.assertBoundary(event.storeEpoch, event.generation)) {
      return;
    }
    if (!Number.isInteger(event.headSeq) || event.headSeq < 1) {
      this.enterFatal(
        invalidResponseError("Realtime document update has an invalid head"),
      );
      return;
    }
    if (event.headSeq <= this.headSeq) {
      return;
    }
    if (event.headSeq !== this.headSeq + 1) {
      this.requestResync();
      return;
    }

    try {
      Y.applyUpdate(
        this.document,
        copyBytes(event.update),
        REMOTE_DOCUMENT_ORIGIN,
      );
    } catch (error) {
      this.enterFatal(
        invalidResponseError(
          `Invalid realtime document update: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }
    this.headSeq = event.headSeq;
    this.transientError = undefined;
    this.refreshStatus();
  }

  private scheduleBatch(): void {
    this.batchScheduled = true;
    // Keep the timer running while another apply is in flight. If its ACK
    // arrives before this batch is quiet, pumpDurableQueue must keep waiting;
    // if the timer wins, the queued batch can leave immediately after the ACK.
    this.durableBatchScheduler.request();
  }

  private pumpDurableQueue(): void {
    if (
      this.destroyed ||
      this.terminalError ||
      !this.connected ||
      this.syncing ||
      this.retryCancel ||
      !this.storeEpoch ||
      this.generation === undefined
    ) {
      this.refreshStatus();
      return;
    }
    if (this.inFlight) {
      this.sendInFlight();
      return;
    }
    if (this.queuedUpdates.length === 0) {
      this.batchScheduled = false;
      this.durableBatchScheduler.cancel();
      this.resolveFlushWaitersIfIdle();
      this.refreshStatus();
      return;
    }
    if (this.batchScheduled) {
      this.refreshStatus();
      return;
    }

    this.durableBatchScheduler.cancel();
    let mergedUpdate: Uint8Array;
    let consumedUpdates: number;
    let touchedBlockIds: readonly BlockId[];
    let updateId: string;
    try {
      const batch = mergeNextBoundedYjsUpdate(
        this.queuedUpdates,
        this.documentSchemaAdapter.limits.maxUpdateBytes,
      );
      mergedUpdate = batch.update;
      consumedUpdates = batch.consumedUpdates;
      touchedBlockIds = [...new Set(this.resolveTouchedBlockIds(mergedUpdate))];
      updateId = this.createUpdateId(
        this.clientSessionId,
        this.updateSequence + 1,
      );
      if (updateId.trim().length === 0) {
        throw new Error("createUpdateId returned an empty id");
      }
    } catch (error) {
      this.enterFatal(
        invalidResponseError(
          `Could not prepare a local document update: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }
    this.queuedUpdates = this.queuedUpdates.slice(consumedUpdates);
    this.updateSequence += 1;
    this.inFlight = {
      request: {
        documentId: this.documentId,
        storeEpoch: this.storeEpoch,
        generation: this.generation,
        updateId,
        clientSessionId: this.clientSessionId,
        baseHeadSeq: this.headSeq,
        touchedBlockIds,
        update: mergedUpdate,
      },
      attempt: 0,
    };
    this.refreshStatus();
    this.sendInFlight();
  }

  private sendInFlight(): void {
    if (
      this.applyCallActive ||
      !this.inFlight ||
      this.syncing ||
      !this.connected ||
      this.retryCancel ||
      this.terminalError ||
      this.destroyed
    ) {
      return;
    }

    const pending = this.inFlight;
    pending.attempt += 1;
    this.applyCallActive = true;
    this.refreshStatus();
    void this.applyDurableUpdate(pending).finally(() => {
      this.applyCallActive = false;
      this.refreshStatus();
      this.resolveFlushWaitersIfIdle();
      if (!this.retryCancel) {
        this.pumpDurableQueue();
      }
    });
  }

  private async applyDurableUpdate(
    pending: PendingDurableUpdate,
  ): Promise<void> {
    if (this.inFlight !== pending || this.destroyed || this.terminalError) {
      return;
    }

    let result: DocumentSyncCommandResult<DocumentSyncApplyAck>;
    try {
      result = await this.adapter.applyUpdate(pending.request);
    } catch (error) {
      this.handleCommandError(thrownTransportError(error), "apply");
      return;
    }
    if (this.inFlight !== pending || this.destroyed || this.terminalError) {
      return;
    }
    if (!result.ok) {
      this.handleCommandError(result.error, "apply");
      return;
    }
    if (!this.validateApplyAck(result.value, pending.request)) {
      return;
    }

    const previousHeadSeq = this.headSeq;
    const ack = result.value;
    this.inFlight = null;
    this.transientError = undefined;
    if (
      ack.committedSeq === previousHeadSeq + 1 &&
      ack.headSeq === ack.committedSeq
    ) {
      this.headSeq = ack.headSeq;
    } else if (ack.headSeq > previousHeadSeq) {
      this.requestResync();
    }
    this.refreshStatus();
  }

  private validateApplyAck(
    ack: DocumentSyncApplyAck,
    request: DocumentSyncApplyRequest,
  ): boolean {
    if (
      ack.documentId !== request.documentId ||
      ack.updateId !== request.updateId
    ) {
      this.enterFatal(
        invalidResponseError("Document update ACK does not match its request"),
      );
      return false;
    }
    if (!this.assertBoundary(ack.storeEpoch, ack.generation)) {
      return false;
    }
    if (!isDocumentApplyAckHeadValid(ack, request)) {
      this.enterFatal(
        invalidResponseError("Document update ACK has an invalid head"),
      );
      return false;
    }
    return true;
  }

  private async hydrateLocalCheckpoint(
    response: DocumentSyncResponse,
  ): Promise<void> {
    if (
      this.checkpointHydrated ||
      this.checkpointDisabled ||
      !this.localCheckpointStore
    ) {
      return;
    }
    this.checkpointHydrated = true;

    try {
      const checkpoint = await this.localCheckpointStore.read({
        documentId: this.documentId,
        storeEpoch: response.storeEpoch,
        generation: response.generation,
      }, this.documentSchemaAdapter.limits);
      if (this.destroyed || this.terminalError) {
        return;
      }
      if (!this.connected) {
        this.checkpointHydrated = false;
        return;
      }
      if (
        this.storeEpoch !== response.storeEpoch
        || this.generation !== response.generation
      ) {
        this.checkpointHydrated = false;
        return;
      }
      if (!checkpoint) return;
      if (checkpoint.headSeq > response.headSeq) {
        await this.localCheckpointStore.clearDocument(this.documentId);
        return;
      }

      const missingOnServer = restoreDocumentLocalCheckpoint(
        this.document,
        response.stateVector,
        checkpoint,
        LOCAL_CHECKPOINT_ORIGIN,
        this.documentSchemaAdapter,
      );
      if (hasDocumentUpdateContent(missingOnServer)) {
        this.queuedUpdates.push(copyBytes(missingOnServer));
        this.scheduleBatch();
        this.refreshStatus();
      }
    } catch (error) {
      try {
        await this.localCheckpointStore.clearDocument(this.documentId);
      } catch {
        // A failed best-effort cleanup does not change durable authority.
      }
      throw error;
    }
  }

  private startLocalCheckpointHydration(
    response: DocumentSyncResponse,
  ): void {
    if (
      this.checkpointHydrated
      || this.checkpointDisabled
      || !this.localCheckpointStore
    ) {
      return;
    }

    this.checkpointPhase = "saving";
    this.refreshStatus();
    const hydration = this.checkpointChain
      .then(() => this.hydrateLocalCheckpoint(response))
      .then(() => {
        if (this.checkpointDisabled) return;
        this.checkpointPhase = "ready";
        this.checkpointLastFailureMessage = undefined;
        this.refreshStatus();
      })
      .catch((error: unknown) => {
        this.recordCheckpointFailure(error);
    });
    this.checkpointChain = hydration;
  }

  private queueLocalCheckpointBestEffort(): void {
    if (
      this.checkpointDisabled
      || !this.localCheckpointStore
      || !this.storeEpoch
      || this.generation === undefined
      || this.checkpointUpdates.length === 0
    ) return;
    this.checkpointScheduler.request();
  }

  private drainScheduledLocalCheckpoint(): void {
    if (
      this.checkpointUpdates.length === 0
      || this.destroyed
      || this.checkpointDisabled
    ) {
      return;
    }
    void this.queueLocalCheckpoint()
      .catch(() => undefined)
      .finally(() => {
        if (
          this.checkpointUpdates.length > 0
          && !this.checkpointRetryBlocked
          && !this.destroyed
        ) {
          this.checkpointScheduler.request();
        }
      });
  }

  private queueLocalCheckpoint(): Promise<void> {
    if (
      this.checkpointDisabled ||
      !this.localCheckpointStore ||
      !this.storeEpoch ||
      this.generation === undefined ||
      this.checkpointUpdates.length === 0
    ) {
      return this.checkpointChain;
    }

    const checkpointUpdates = this.checkpointUpdates;
    this.checkpointUpdates = [];
    const checkpoint: DocumentLocalCheckpoint = {
      documentId: this.documentId,
      storeEpoch: this.storeEpoch,
      generation: this.generation,
      headSeq: this.headSeq,
      state: copyBytes(Y.mergeUpdates(checkpointUpdates)),
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.checkpointPhase = "saving";
    this.refreshStatus();
    const write = this.checkpointChain
      .then(async () => {
        if (
          this.checkpointDisabled
          || !this.localCheckpointStore
          || !this.storeEpoch
          || this.generation === undefined
        ) {
          return;
        }
        await this.localCheckpointStore.write(
          checkpoint,
          this.documentSchemaAdapter.limits,
        );
      })
      .then(() => {
        if (this.checkpointDisabled) return;
        this.checkpointPhase = "ready";
        this.checkpointLastFailureMessage = undefined;
        this.refreshStatus();
      })
      .catch((error: unknown) => {
        if (!this.destroyed && !this.checkpointDisabled) {
          // Keep one compact retry payload. In particular, a persistent quota
          // failure must not retain one Uint8Array object per editor gesture.
          this.checkpointUpdates = [copyBytes(Y.mergeUpdates([
            ...checkpointUpdates,
            ...this.checkpointUpdates,
          ]))];
          this.checkpointRetryBlocked = true;
        }
        // A best-effort cache failure must not become a hot retry loop. A new
        // local update or an explicit lifecycle checkpoint opens one new try.
        if (!this.destroyed && !this.checkpointDisabled) {
          this.recordCheckpointFailure(error);
        }
        throw error;
      });
    this.checkpointChain = write.catch(() => undefined);
    return write;
  }

  private clearLocalCheckpoints(): void {
    if (this.checkpointDisabled) return;
    this.checkpointDisabled = true;
    this.checkpointUpdates = [];
    this.checkpointRetryBlocked = false;
    this.checkpointScheduler.cancel();
    this.checkpointPhase = "disabled";
    this.refreshStatus();
    if (!this.localCheckpointStore) return;
    this.checkpointChain = this.checkpointChain
      .then(() => this.localCheckpointStore?.clearDocument(this.documentId))
      .then(() => undefined)
      .catch(() => undefined);
  }

  private recordCheckpointFailure(error: unknown): void {
    this.checkpointFailureCount += 1;
    this.checkpointLastFailureMessage = error instanceof Error
      ? error.message
      : String(error);
    this.checkpointPhase = this.checkpointDisabled ? "disabled" : "degraded";
    this.refreshStatus();
  }

  private handleCommandError(
    error: DocumentSyncCommandError,
    kind: RetryKind,
  ): void {
    if (
      error.resetRequired ||
      error.code === "store_epoch_mismatch" ||
      error.code === "document_generation_mismatch" ||
      error.code === "block_relocated" ||
      error.code === "recovery_required"
    ) {
      this.enterReset({
        ...error,
        retryable: false,
        resetRequired: true,
      });
      return;
    }
    if (!error.retryable) {
      this.enterFatal(error);
      return;
    }

    this.transientError = error;
    if (error.code === "transport_unavailable") {
      this.connected = false;
      this.removeRemoteAwarenessStates();
    }
    this.scheduleCommandRetry(kind);
    this.refreshStatus();
  }

  private scheduleCommandRetry(kind: RetryKind): void {
    if (this.destroyed || this.terminalError || this.retryCancel) {
      return;
    }

    const attempt =
      kind === "apply"
        ? (this.inFlight?.attempt ?? 1)
        : (this.syncRetryAttempt += 1);
    this.retryKind = kind;
    this.retryCancel = this.scheduleRetry(() => {
      this.retryCancel = null;
      this.retryKind = null;
      if (this.destroyed || this.terminalError) {
        return;
      }
      this.connected = true;
      this.refreshStatus();
      if (!this.unsubscribeRealtime) {
        void this.connect();
        return;
      }
      void this.requestSync();
    }, attempt);
  }

  private cancelRetry(): void {
    this.retryCancel?.();
    this.retryCancel = null;
    this.retryKind = null;
  }

  private publishLocalAwareness(): void {
    if (
      this.awareness.getLocalState() === null ||
      !this.connected ||
      !this.storeEpoch ||
      this.generation === undefined
    ) {
      return;
    }

    const request: DocumentAwarenessPublishRequest = {
      documentId: this.documentId,
      clientSessionId: this.clientSessionId,
      storeEpoch: this.storeEpoch,
      generation: this.generation,
      update: copyBytes(
        encodeAwarenessUpdate(this.awareness, [this.document.clientID]),
      ),
    };
    this.publishAwarenessBestEffort(request);
  }

  private publishAwarenessBestEffort(
    request: DocumentAwarenessPublishRequest,
  ): void {
    try {
      void this.adapter.publishAwareness(request).catch(() => undefined);
    } catch {
      // Awareness is ephemeral and must never block durable document sync.
    }
  }

  private clearRealtimeSubscription(): void {
    const unsubscribe = this.unsubscribeRealtime;
    this.unsubscribeRealtime = null;
    if (!unsubscribe) {
      return;
    }
    try {
      unsubscribe();
    } catch {
      // The provider is already disconnected; cleanup is best effort.
    }
  }

  private removeRemoteAwarenessStates(): void {
    const remoteClients = [...this.awareness.getStates().keys()].filter(
      (clientId) => clientId !== this.document.clientID,
    );
    if (remoteClients.length === 0) {
      return;
    }
    removeAwarenessStates(
      this.awareness,
      remoteClients,
      REMOTE_AWARENESS_ORIGIN,
    );
  }

  private enterReset(error: DocumentSyncCommandError): void {
    if (this.destroyed || this.terminalError) {
      return;
    }

    if (this.awareness.getLocalState() !== null) {
      this.awareness.setLocalState(null);
    }
    this.resetRequired = true;
    this.terminalError = error;
    this.connected = false;
    this.clearLocalCheckpoints();
    this.cancelRetry();
    this.clearRealtimeSubscription();
    this.queuedUpdates = [];
    this.inFlight = null;
    this.bufferedDocumentEvents = [];
    this.bufferedAwarenessEvents = [];
    this.rejectFlushWaiters(new Error(error.message));
    this.removeRemoteAwarenessStates();
    this.refreshStatus();
  }

  private enterFatal(error: DocumentSyncCommandError): void {
    if (this.destroyed || this.terminalError) {
      return;
    }

    if (this.awareness.getLocalState() !== null) {
      this.awareness.setLocalState(null);
    }
    this.terminalError = error;
    this.connected = false;
    this.cancelRetry();
    this.clearRealtimeSubscription();
    this.bufferedDocumentEvents = [];
    this.bufferedAwarenessEvents = [];
    this.rejectFlushWaiters(new Error(error.message));
    this.removeRemoteAwarenessStates();
    this.refreshStatus();
  }

  private buildStatus(): NodexYProviderStatus {
    const pendingUpdateCount =
      this.queuedUpdates.length + (this.inFlight ? 1 : 0);
    let phase: NodexYProviderPhase;
    if (this.destroyed) {
      phase = "destroyed";
    } else if (this.resetRequired) {
      phase = "reset-required";
    } else if (this.terminalError) {
      phase = "error";
    } else if (!this.unsubscribeRealtime && !this.connected) {
      phase = "idle";
    } else if (!this.connected) {
      phase = "offline";
    } else if (
      this.syncing ||
      !this.storeEpoch ||
      this.generation === undefined
    ) {
      phase = "connecting";
    } else if (pendingUpdateCount > 0 || this.retryKind !== null) {
      phase = "saving";
    } else {
      phase = "synced";
    }

    return {
      phase,
      documentId: this.documentId,
      clientSessionId: this.clientSessionId,
      connected: this.connected,
      storeEpoch: this.storeEpoch,
      generation: this.generation,
      headSeq: this.headSeq,
      pendingUpdateCount,
      inFlightUpdateId: this.inFlight?.request.updateId,
      checkpoint: {
        phase: this.checkpointPhase,
        failureCount: this.checkpointFailureCount,
        ...(this.checkpointLastFailureMessage
          ? { lastFailureMessage: this.checkpointLastFailureMessage }
          : {}),
      },
      error: this.terminalError ?? this.transientError,
    };
  }

  private refreshStatus(): void {
    const next = this.buildStatus();
    const current = this.status;
    if (
      current.phase === next.phase &&
      current.connected === next.connected &&
      current.storeEpoch === next.storeEpoch &&
      current.generation === next.generation &&
      current.headSeq === next.headSeq &&
      current.pendingUpdateCount === next.pendingUpdateCount &&
      current.inFlightUpdateId === next.inFlightUpdateId &&
      current.checkpoint.phase === next.checkpoint.phase &&
      current.checkpoint.failureCount === next.checkpoint.failureCount &&
      current.checkpoint.lastFailureMessage === next.checkpoint.lastFailureMessage &&
      sameError(current.error, next.error)
    ) {
      return;
    }

    this.status = next;
    this.statusListeners.forEach((listener) => listener());
  }

  private isDurablyIdle(): boolean {
    return (
      this.connected &&
      Boolean(this.storeEpoch) &&
      this.generation !== undefined &&
      !this.syncing &&
      !this.syncPromise &&
      !this.syncAgain &&
      this.queuedUpdates.length === 0 &&
      !this.inFlight &&
      !this.applyCallActive &&
      !this.retryCancel &&
      this.retryKind === null
    );
  }

  private resolveFlushWaitersIfIdle(): void {
    if (!this.isDurablyIdle() || this.flushWaiters.size === 0) {
      return;
    }
    const waiters = [...this.flushWaiters];
    this.flushWaiters.clear();
    waiters.forEach((waiter) => waiter.resolve());
  }

  private rejectFlushWaiters(error: Error): void {
    const waiters = [...this.flushWaiters];
    this.flushWaiters.clear();
    waiters.forEach((waiter) => waiter.reject(error));
  }
}
