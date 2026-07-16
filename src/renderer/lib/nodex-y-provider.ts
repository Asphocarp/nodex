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
  DocumentAwarenessPublishAck,
  DocumentAwarenessPublishRequest,
  DocumentRelocationLeaseNackReason,
  DocumentRelocationLeaseResponseAck,
  DocumentRelocationLeaseResponseRequest,
  DocumentRelocationLeaseParticipantStatus,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
} from "../../shared/block-documents/document-sync";
import {
  captureDocumentLocalCheckpoint,
  createDefaultDocumentLocalCheckpointStore,
  hasDocumentUpdateContent,
  restoreDocumentLocalCheckpoint,
  type DocumentLocalCheckpointStore,
} from "./document-local-checkpoint";

export interface DocumentSyncAdapter {
  sync: (
    request: DocumentSyncRequest,
  ) => Promise<DocumentSyncCommandResult<DocumentSyncResponse>>;
  applyUpdate: (
    request: DocumentSyncApplyRequest,
  ) => Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>>;
  subscribe: (
    request: DocumentSyncSubscribeRequest,
    listener: (event: DocumentSyncRealtimeEvent) => void,
  ) => () => void;
  publishAwareness: (
    request: DocumentAwarenessPublishRequest,
  ) => Promise<DocumentSyncCommandResult<DocumentAwarenessPublishAck>>;
  respondToRelocationLease: (
    request: DocumentRelocationLeaseResponseRequest,
  ) => Promise<DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>>;
}

export type NodexYProviderPhase =
  | "idle"
  | "connecting"
  | "synced"
  | "saving"
  | "relocating"
  | "frozen"
  | "offline"
  | "error"
  | "reset-required"
  | "destroyed";

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
  readonly error?: DocumentSyncCommandError;
  readonly relocationLease?: {
    readonly leaseId: string;
    readonly status: Extract<
      DocumentRelocationLeaseParticipantStatus,
      "preparing" | "frozen"
    >;
    readonly deadlineAt: number;
  };
}

export type NodexYProviderRetryScheduler = (
  callback: () => void,
  attempt: number,
) => () => void;

export type NodexYProviderRelocationDeadlineScheduler = (
  callback: () => void,
  delayMs: number,
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
  /** Blur/commit IME and disable the writable surface before durable flush. */
  readonly prepareSurfaceForRelocation?: (
    event: Extract<
      DocumentSyncRealtimeEvent,
      { kind: "relocation-lease-prepare" }
    >,
  ) => Promise<void>;
  readonly now?: () => number;
  readonly scheduleRelocationDeadline?: NodexYProviderRelocationDeadlineScheduler;
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

interface RelocationIdleWaiter {
  readonly resolve: () => void;
}

interface ActiveProviderRelocationLease {
  readonly leaseId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly expectedHeadSeq: number;
  readonly deadlineAt: number;
  readonly sequence: number;
  status: "preparing" | "frozen";
  acknowledged: boolean;
  terminalHeadSeq: number | null;
  terminalSyncAfterSequence: number | null;
  cancelDeadline: (() => void) | null;
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
const DOCUMENT_WRITE_LEASE_TERMINAL_TIMEOUT_MS = 10_000;
const DEFAULT_PAGE_DOCUMENT_SCHEMA = {
  ownerType: "page",
  schemaKey: PAGE_DOCUMENT_SCHEMA_KEY,
  schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
} as const;

let fallbackSessionSequence = 0;

const copyBytes = (value: Uint8Array): Uint8Array => value.slice();

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

const defaultRelocationDeadlineScheduler: NodexYProviderRelocationDeadlineScheduler = (
  callback,
  delayMs,
) => {
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

const relocationBoundaryError = (
  message: string,
  relocationId: string,
): DocumentSyncCommandError => ({
  code: "invalid_response",
  message,
  retryable: false,
  resetRequired: true,
  relocationId,
});

const providerDestroyedError = (): Error =>
  new Error("The Nodex Yjs provider has been destroyed");

const isNonNegativeInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

export const isDocumentApplyAckHeadValid = (
  ack: Pick<DocumentSyncApplyAck, "committedSeq" | "headSeq" | "duplicate">,
  request: Pick<DocumentSyncApplyRequest, "baseHeadSeq">,
): boolean =>
  isNonNegativeInteger(ack.committedSeq) &&
  isNonNegativeInteger(ack.headSeq) &&
  ack.committedSeq >= request.baseHeadSeq + (ack.duplicate ? 0 : 1) &&
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
  private readonly prepareSurfaceForRelocation: NonNullable<
    NodexYProviderOptions["prepareSurfaceForRelocation"]
  >;
  private readonly now: () => number;
  private readonly scheduleRelocationDeadline: NodexYProviderRelocationDeadlineScheduler;
  private readonly localCheckpointStore: DocumentLocalCheckpointStore | null;
  private readonly documentSchemaAdapter: BlockDocumentSchemaAdapter;
  private readonly statusListeners = new Set<() => void>();
  private readonly flushWaiters = new Set<FlushWaiter>();
  private readonly relocationIdleWaiters = new Set<RelocationIdleWaiter>();

  private status: NodexYProviderStatus;
  private unsubscribeRealtime: (() => void) | null = null;
  private connected = false;
  private syncing = false;
  private syncAgain = false;
  private syncPromise: Promise<void> | null = null;
  private syncSequence = 0;
  private lastSuccessfulSyncSequence = 0;
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
  private checkpointChain: Promise<void> = Promise.resolve();
  private activeRelocationLease: ActiveProviderRelocationLease | null = null;
  private relocationSequence = 0;
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
    if (this.activeRelocationLease?.status === "frozen") {
      const lease = this.activeRelocationLease;
      this.nackRelocationLeaseBestEffort(
        lease,
        "local_update_after_freeze",
        `Document ${this.documentId} changed after relocation lease ${lease.leaseId} froze the surface`,
      );
      this.clearActiveRelocationLease();
      this.enterReset(
        relocationBoundaryError(
          `Document ${this.documentId} changed after relocation freeze; reload is required`,
          lease.leaseId,
        ),
      );
      return;
    }

    this.queuedUpdates.push(copyBytes(update));
    this.scheduleBatch();
    void this.queueLocalCheckpoint();
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
    this.prepareSurfaceForRelocation =
      options.prepareSurfaceForRelocation ?? (() => Promise.resolve());
    this.now = options.now ?? (() => Date.now());
    this.scheduleRelocationDeadline =
      options.scheduleRelocationDeadline ?? defaultRelocationDeadlineScheduler;
    this.localCheckpointStore =
      options.localCheckpointStore === undefined
        ? createDefaultDocumentLocalCheckpointStore()
        : options.localCheckpointStore;
    this.documentSchemaAdapter = getYjsDocumentSchemaAdapter(
      options.documentSchema ?? DEFAULT_PAGE_DOCUMENT_SCHEMA,
    );
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

    if (this.activeRelocationLease) {
      const lease = this.activeRelocationLease;
      this.nackRelocationLeaseBestEffort(
        lease,
        "provider_disconnected",
        `Document provider disconnected during relocation lease ${lease.leaseId}`,
      );
      this.clearActiveRelocationLease();
      this.enterReset(
        relocationBoundaryError(
          "Document provider disconnected during relocation; reload is required",
          lease.leaseId,
        ),
      );
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
    if (
      this.retryCancel ||
      (!this.connected && (this.queuedUpdates.length > 0 || this.inFlight))
    ) {
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
    await this.queueLocalCheckpoint();
  };

  /**
   * A mounted surface may disappear while its parent EditorView is changing.
   * Once this provider has entered a relocation lease it remains the durable
   * participant until that bounded protocol reaches release, cancel, or reset.
   */
  waitForRelocationIdle = (): Promise<void> => {
    if (!this.activeRelocationLease) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.relocationIdleWaiters.add({ resolve });
    });
  };

  destroy = (): void => {
    if (this.destroyed) {
      return;
    }

    if (this.activeRelocationLease) {
      this.nackRelocationLeaseBestEffort(
        this.activeRelocationLease,
        "provider_destroyed",
        `Document provider was destroyed during relocation lease ${this.activeRelocationLease.leaseId}`,
      );
      this.clearActiveRelocationLease();
    }

    void this.queueLocalCheckpoint();
    if (this.awareness.getLocalState() !== null) {
      this.awareness.setLocalState(null);
    }
    this.destroyed = true;
    this.connected = false;
    this.cancelRetry();
    this.clearRealtimeSubscription();
    this.document.off("update", this.handleDocumentUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.awareness.destroy();
    this.queuedUpdates = [];
    this.inFlight = null;
    this.bufferedDocumentEvents = [];
    this.bufferedAwarenessEvents = [];
    this.rejectFlushWaiters(providerDestroyedError());
    this.resolveRelocationIdleWaiters();
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
    if (event.kind === "relocation-lease-prepare") {
      this.handleRelocationLeasePrepare(event);
      return;
    }
    if (
      event.kind === "relocation-lease-release" ||
      event.kind === "relocation-lease-cancel"
    ) {
      this.handleRelocationLeaseTerminalEvent(event);
      return;
    }
    if (event.kind === "awareness") {
      this.handleRemoteAwareness(event);
      return;
    }
    if (event.kind === "resync-required") {
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
      if (this.activeRelocationLease) {
        this.failActiveRelocationLease(
          this.activeRelocationLease,
          "provider_disconnected",
          "Document transport disconnected during relocation preparation",
        );
        return;
      }
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

  private handleRelocationLeasePrepare(
    event: Extract<
      DocumentSyncRealtimeEvent,
      { kind: "relocation-lease-prepare" }
    >,
  ): void {
    const eventIsValid =
      event.leaseId.trim().length > 0 &&
      event.clientSessionId.trim().length > 0 &&
      event.storeEpoch.trim().length > 0 &&
      Number.isInteger(event.generation) &&
      event.generation >= 1 &&
      isNonNegativeInteger(event.expectedHeadSeq) &&
      Number.isFinite(event.deadlineAt);
    if (!eventIsValid) {
      this.enterReset(
        relocationBoundaryError(
          "Relocation lease prepare event is invalid",
          event.leaseId || "invalid-relocation-lease",
        ),
      );
      return;
    }
    if (event.clientSessionId !== this.clientSessionId) {
      this.enterReset(
        relocationBoundaryError(
          "Relocation lease was addressed to another Document session",
          event.leaseId,
        ),
      );
      return;
    }

    const incomingLease: ActiveProviderRelocationLease = {
      leaseId: event.leaseId,
      storeEpoch: event.storeEpoch,
      generation: event.generation,
      expectedHeadSeq: event.expectedHeadSeq,
      deadlineAt: event.deadlineAt,
      sequence: this.relocationSequence + 1,
      status: "preparing",
      acknowledged: false,
      terminalHeadSeq: null,
      terminalSyncAfterSequence: null,
      cancelDeadline: null,
    };
    const activeLease = this.activeRelocationLease;
    if (activeLease) {
      const exactDuplicate =
        activeLease.leaseId === incomingLease.leaseId &&
        activeLease.storeEpoch === incomingLease.storeEpoch &&
        activeLease.generation === incomingLease.generation &&
        activeLease.expectedHeadSeq === incomingLease.expectedHeadSeq &&
        activeLease.deadlineAt === incomingLease.deadlineAt;
      if (exactDuplicate) return;
      this.nackRelocationLeaseBestEffort(
        incomingLease,
        "foreign_lease_event",
        `Document ${this.documentId} received overlapping relocation lease ${event.leaseId}`,
      );
      this.enterReset(
        relocationBoundaryError(
          "Overlapping relocation lease events require a fresh Document sync",
          event.leaseId,
        ),
      );
      return;
    }
    if (
      !this.storeEpoch ||
      this.generation === undefined ||
      event.storeEpoch !== this.storeEpoch ||
      event.generation !== this.generation
    ) {
      this.nackRelocationLeaseBestEffort(
        incomingLease,
        "boundary_mismatch",
        "Relocation lease does not match the active Document boundary",
      );
      this.enterReset(
        relocationBoundaryError(
          "Relocation lease crossed the active Document boundary",
          event.leaseId,
        ),
      );
      return;
    }
    const delayMs = event.deadlineAt - this.now();
    if (delayMs <= 0) {
      this.nackRelocationLeaseBestEffort(
        incomingLease,
        "deadline_elapsed",
        "Relocation lease arrived after its preparation deadline",
      );
      this.enterReset(
        relocationBoundaryError(
          "Relocation lease preparation deadline already elapsed",
          event.leaseId,
        ),
      );
      return;
    }

    this.relocationSequence = incomingLease.sequence;
    incomingLease.cancelDeadline = this.scheduleRelocationDeadline(() => {
      if (
        this.activeRelocationLease?.sequence !== incomingLease.sequence ||
        this.activeRelocationLease.status === "frozen"
      ) {
        return;
      }
      this.failActiveRelocationLease(
        incomingLease,
        "deadline_elapsed",
        "Relocation lease preparation exceeded its deadline",
      );
    }, delayMs);
    this.activeRelocationLease = incomingLease;
    this.refreshStatus();
    void this.prepareRelocationLease(event, incomingLease);
  }

  private async prepareRelocationLease(
    event: Extract<
      DocumentSyncRealtimeEvent,
      { kind: "relocation-lease-prepare" }
    >,
    lease: ActiveProviderRelocationLease,
  ): Promise<void> {
    try {
      await this.prepareSurfaceForRelocation(event);
    } catch (error) {
      this.failActiveRelocationLease(
        lease,
        "surface_prepare_failed",
        `Could not freeze the Document surface: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (!this.isCurrentRelocationLease(lease)) return;

    try {
      await this.requestSync();
      await this.flush();
      await this.requestSync();
    } catch (error) {
      this.failActiveRelocationLease(
        lease,
        "durable_flush_failed",
        `Could not durably flush before relocation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (!this.isCurrentRelocationLease(lease)) return;
    if (
      this.now() >= lease.deadlineAt ||
      !this.isDurablyIdle() ||
      this.headSeq < lease.expectedHeadSeq
    ) {
      this.failActiveRelocationLease(
        lease,
        this.now() >= lease.deadlineAt
          ? "deadline_elapsed"
          : "durable_flush_failed",
        "Document did not reach the relocation lease durable head",
      );
      return;
    }

    const updateSequenceBeforeAck = this.localUpdateSequence;
    let response: DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>;
    try {
      response = await this.adapter.respondToRelocationLease({
        response: "ack",
        leaseId: lease.leaseId,
        documentId: this.documentId,
        clientSessionId: this.clientSessionId,
        storeEpoch: lease.storeEpoch,
        generation: lease.generation,
        headSeq: this.headSeq,
      });
    } catch (error) {
      this.failActiveRelocationLease(
        lease,
        "durable_flush_failed",
        `Could not ACK relocation lease: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (!this.isCurrentRelocationLease(lease)) return;
    if (!response.ok) {
      this.failActiveRelocationLease(
        lease,
        "durable_flush_failed",
        `Relocation lease ACK failed: ${response.error.message}`,
      );
      return;
    }
    const ack = response.value;
    if (
      ack.accepted !== true ||
      ack.leaseId !== lease.leaseId ||
      ack.documentId !== this.documentId ||
      ack.status !== "frozen"
    ) {
      this.failActiveRelocationLease(
        lease,
        "foreign_lease_event",
        "Relocation lease ACK response does not match its request",
      );
      return;
    }
    if (
      updateSequenceBeforeAck !== this.localUpdateSequence ||
      !this.isDurablyIdle()
    ) {
      this.failActiveRelocationLease(
        lease,
        "local_update_after_freeze",
        "Document changed while the relocation ACK was in flight",
      );
      return;
    }

    lease.acknowledged = true;
    lease.status = "frozen";
    lease.cancelDeadline?.();
    if (lease.terminalHeadSeq !== null) {
      this.completeRelocationLeaseTerminalIfReady(lease);
      if (this.isCurrentRelocationLease(lease)) this.refreshStatus();
      return;
    }
    lease.cancelDeadline = this.scheduleRelocationDeadline(() => {
      if (!this.isCurrentRelocationLease(lease) || lease.terminalHeadSeq !== null) {
        return;
      }
      this.clearActiveRelocationLease();
      this.enterReset(
        relocationBoundaryError(
          "Document write lease committed no terminal event before its watchdog expired",
          lease.leaseId,
        ),
      );
    }, DOCUMENT_WRITE_LEASE_TERMINAL_TIMEOUT_MS);
    this.refreshStatus();
  }

  private handleRelocationLeaseTerminalEvent(
    event: Extract<
      DocumentSyncRealtimeEvent,
      { kind: "relocation-lease-release" | "relocation-lease-cancel" }
    >,
  ): void {
    const lease = this.activeRelocationLease;
    if (
      !lease ||
      lease.leaseId !== event.leaseId ||
      event.clientSessionId !== this.clientSessionId ||
      lease.storeEpoch !== event.storeEpoch ||
      lease.generation !== event.generation ||
      !isNonNegativeInteger(event.headSeq) ||
      event.headSeq < lease.expectedHeadSeq
    ) {
      this.enterReset(
        relocationBoundaryError(
          "Foreign or late relocation lease terminal event requires reload",
          event.leaseId,
        ),
      );
      return;
    }
    lease.status = "frozen";
    lease.terminalHeadSeq = event.headSeq;
    lease.terminalSyncAfterSequence = this.syncSequence;
    lease.cancelDeadline?.();
    lease.cancelDeadline = this.scheduleRelocationDeadline(() => {
      if (!this.isCurrentRelocationLease(lease)) return;
      this.clearActiveRelocationLease();
      this.enterReset(
        relocationBoundaryError(
          "Document write lease could not synchronize its committed terminal head",
          lease.leaseId,
        ),
      );
    }, DOCUMENT_WRITE_LEASE_TERMINAL_TIMEOUT_MS);
    this.refreshStatus();
    this.requestResync();
  }

  private completeRelocationLeaseTerminalIfReady(
    lease: ActiveProviderRelocationLease,
  ): void {
    if (
      !this.isCurrentRelocationLease(lease) ||
      !lease.acknowledged ||
      lease.terminalHeadSeq === null ||
      lease.terminalSyncAfterSequence === null ||
      this.headSeq < lease.terminalHeadSeq ||
      this.lastSuccessfulSyncSequence <= lease.terminalSyncAfterSequence
    ) {
      return;
    }
    this.clearActiveRelocationLease();
    this.refreshStatus();
  }

  private isCurrentRelocationLease(
    lease: ActiveProviderRelocationLease,
  ): boolean {
    return (
      !this.destroyed &&
      !this.terminalError &&
      this.activeRelocationLease?.sequence === lease.sequence
    );
  }

  private failActiveRelocationLease(
    lease: ActiveProviderRelocationLease,
    reason: DocumentRelocationLeaseNackReason,
    message: string,
  ): void {
    if (!this.isCurrentRelocationLease(lease)) return;
    this.nackRelocationLeaseBestEffort(lease, reason, message);
    this.clearActiveRelocationLease();
    this.enterReset(relocationBoundaryError(message, lease.leaseId));
  }

  private nackRelocationLeaseBestEffort(
    lease: ActiveProviderRelocationLease,
    reason: DocumentRelocationLeaseNackReason,
    message: string,
  ): void {
    const request: DocumentRelocationLeaseResponseRequest = {
      response: "nack",
      leaseId: lease.leaseId,
      documentId: this.documentId,
      clientSessionId: this.clientSessionId,
      storeEpoch: lease.storeEpoch,
      generation: lease.generation,
      headSeq: this.headSeq,
      reason,
      message,
    };
    try {
      void this.adapter.respondToRelocationLease(request).catch(() => undefined);
    } catch {
      // The lease coordinator also observes transport disconnect and timeout.
    }
  }

  private clearActiveRelocationLease(): void {
    this.activeRelocationLease?.cancelDeadline?.();
    this.activeRelocationLease = null;
    this.resolveRelocationIdleWaiters();
  }

  private resolveRelocationIdleWaiters(): void {
    for (const waiter of this.relocationIdleWaiters) waiter.resolve();
    this.relocationIdleWaiters.clear();
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
    const syncSequence = this.syncSequence + 1;
    this.syncSequence = syncSequence;
    const promise = this.performSync(syncSequence).finally(() => {
      if (this.syncPromise === promise) {
        this.syncPromise = null;
      }
      this.syncing = false;
      const activeLease = this.activeRelocationLease;
      if (activeLease) {
        this.completeRelocationLeaseTerminalIfReady(activeLease);
      }
      this.refreshStatus();
      this.resolveFlushWaitersIfIdle();

      const shouldSyncAgain = this.syncAgain;
      this.syncAgain = false;
      if (
        shouldSyncAgain &&
        !this.destroyed &&
        !this.terminalError &&
        this.connected
      ) {
        queueMicrotask(() => void this.requestSync());
        return;
      }
      this.pumpDurableQueue();
    });
    this.syncPromise = promise;
    return promise;
  }

  private async performSync(syncSequence: number): Promise<void> {
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

    await this.hydrateLocalCheckpoint(response);
    if (this.destroyed || this.terminalError || !this.connected) {
      return;
    }

    this.headSeq = response.headSeq;
    this.lastSuccessfulSyncSequence = Math.max(
      this.lastSuccessfulSyncSequence,
      syncSequence,
    );
    this.transientError = undefined;
    this.syncRetryAttempt = 0;
    this.drainBufferedEvents();
    this.publishLocalAwareness();
    void this.queueLocalCheckpoint();
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
    void this.queueLocalCheckpoint();
    this.refreshStatus();
  }

  private scheduleBatch(): void {
    if (this.batchScheduled) {
      return;
    }
    this.batchScheduled = true;
    queueMicrotask(() => {
      if (this.destroyed || !this.batchScheduled) {
        return;
      }
      this.batchScheduled = false;
      this.pumpDurableQueue();
    });
  }

  private pumpDurableQueue(): void {
    if (
      this.destroyed ||
      this.terminalError ||
      !this.connected ||
      this.syncing ||
      this.retryCancel ||
      !this.storeEpoch ||
      this.generation === undefined ||
      this.activeRelocationLease?.status === "frozen"
    ) {
      this.refreshStatus();
      return;
    }
    if (this.inFlight) {
      this.sendInFlight();
      return;
    }
    if (this.queuedUpdates.length === 0) {
      this.resolveFlushWaitersIfIdle();
      this.refreshStatus();
      return;
    }

    const updates = this.queuedUpdates;
    let mergedUpdate: Uint8Array;
    let touchedBlockIds: readonly BlockId[];
    let updateId: string;
    try {
      mergedUpdate = copyBytes(Y.mergeUpdates(updates));
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
    this.queuedUpdates = [];
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
    await this.queueLocalCheckpoint();
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
    void this.queueLocalCheckpoint();
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
      this.queuedUpdates = hasDocumentUpdateContent(missingOnServer)
        ? [copyBytes(missingOnServer)]
        : [];
    } catch {
      // The cache is disposable. Corruption or quota failure must not block
      // the SQLite-backed state-vector handshake.
      try {
        await this.localCheckpointStore.clearDocument(this.documentId);
      } catch {
        // A failed best-effort cleanup does not change durable authority.
      }
    }
  }

  private queueLocalCheckpoint(): Promise<void> {
    if (
      this.checkpointDisabled ||
      !this.localCheckpointStore ||
      !this.storeEpoch ||
      this.generation === undefined
    ) {
      return this.checkpointChain;
    }

    let checkpoint;
    try {
      checkpoint = captureDocumentLocalCheckpoint(this.document, {
        documentId: this.documentId,
        storeEpoch: this.storeEpoch,
        generation: this.generation,
        headSeq: this.headSeq,
      }, this.documentSchemaAdapter);
    } catch {
      return this.checkpointChain;
    }

    this.checkpointChain = this.checkpointChain
      .then(() => this.localCheckpointStore?.write(
        checkpoint,
        this.documentSchemaAdapter.limits,
      ))
      .then(() => undefined)
      .catch(() => undefined);
    return this.checkpointChain;
  }

  private clearLocalCheckpoints(): void {
    if (this.checkpointDisabled) return;
    this.checkpointDisabled = true;
    if (!this.localCheckpointStore) return;
    this.checkpointChain = this.checkpointChain
      .then(() => this.localCheckpointStore?.clearDocument(this.documentId))
      .then(() => undefined)
      .catch(() => undefined);
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

    if (this.activeRelocationLease) {
      this.nackRelocationLeaseBestEffort(
        this.activeRelocationLease,
        "boundary_mismatch",
        error.message,
      );
      this.clearActiveRelocationLease();
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

    if (this.activeRelocationLease) {
      this.nackRelocationLeaseBestEffort(
        this.activeRelocationLease,
        "durable_flush_failed",
        error.message,
      );
      this.clearActiveRelocationLease();
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
    } else if (this.activeRelocationLease?.status === "frozen") {
      phase = "frozen";
    } else if (this.activeRelocationLease) {
      phase = "relocating";
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
      error: this.terminalError ?? this.transientError,
      relocationLease: this.activeRelocationLease
        ? {
            leaseId: this.activeRelocationLease.leaseId,
            status: this.activeRelocationLease.status,
            deadlineAt: this.activeRelocationLease.deadlineAt,
          }
        : undefined,
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
      current.relocationLease?.leaseId === next.relocationLease?.leaseId &&
      current.relocationLease?.status === next.relocationLease?.status &&
      current.relocationLease?.deadlineAt === next.relocationLease?.deadlineAt &&
      sameError(current.error, next.error)
    ) {
      return;
    }

    this.status = next;
    this.statusListeners.forEach((listener) => listener());
  }

  private isDurablyIdle(): boolean {
    return (
      this.queuedUpdates.length === 0 &&
      !this.inFlight &&
      !this.applyCallActive &&
      this.retryKind !== "apply"
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
