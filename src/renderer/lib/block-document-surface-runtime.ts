import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import {
  type DocumentSyncRealtimeEvent,
  type OwnedDocumentDescriptor,
} from "../../shared/block-documents";
import {
  getRegisteredBlockDocumentSchemaAdapter,
  inspectRegisteredOwnedBlockDocument,
  type OwnedDocumentEnvelope,
} from "../../shared/block-documents/document-schema-adapters";
import {
  createDefaultDocumentLocalCheckpointStore,
  type DocumentLocalCheckpoint,
  type DocumentLocalCheckpointStateConstraints,
  type DocumentLocalCheckpointStore,
} from "./document-local-checkpoint";
import {
  NodexYProvider,
  type DocumentSyncAdapter,
  type NodexYProviderOptions,
  type NodexYProviderStatus,
} from "./nodex-y-provider";

const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;

export type BlockDocumentSurfacePhase =
  | "idle"
  | "connecting"
  | "ready"
  | "saving"
  | "relocating"
  | "frozen"
  | "offline"
  | "error"
  | "reset-required"
  | "closing"
  | "closed";

export interface BlockDocumentSurfaceStatus {
  readonly phase: BlockDocumentSurfacePhase;
  readonly ready: boolean;
  readonly reloadRequired: boolean;
  readonly writeFrozen: boolean;
  readonly descriptor: OwnedDocumentDescriptor;
  readonly provider: NodexYProviderStatus;
  readonly error?: Error;
}

export type BlockDocumentSurfaceRelocationPreparation = Extract<
  DocumentSyncRealtimeEvent,
  { readonly kind: "relocation-lease-prepare" }
>;

export type BlockDocumentSurfaceRelocationPreparer = (
  event: BlockDocumentSurfaceRelocationPreparation,
) => void | Promise<void>;

export type BlockDocumentSurfacePersistPreparer = () => void | Promise<void>;

/** Surface-scoped write fence. Event metadata preserves future move seams. */
export interface BlockDocumentSurfaceWriteFence {
  readonly getWriteFrozen: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly registerRelocationPreparer: (
    preparer: BlockDocumentSurfaceRelocationPreparer,
  ) => () => void;
}

export interface BlockDocumentSurfaceCloseResult {
  readonly timedOut: boolean;
  readonly flush: "completed" | "failed" | "skipped" | "timed-out";
  readonly checkpoint: "completed" | "failed" | "isolated" | "timed-out";
}

export interface BlockDocumentSurfacePersistResult {
  readonly timedOut: boolean;
  readonly flush: "completed" | "failed" | "timed-out";
  readonly checkpoint: "completed" | "failed" | "timed-out";
}

export interface BlockDocumentSurfaceReloadContext {
  readonly descriptor: OwnedDocumentDescriptor;
  readonly reason: "fatal" | "reset-required";
  readonly error: Error;
}

export interface BlockDocumentSurfaceProvider {
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly clientSessionId: string;
  getStatus: () => NodexYProviderStatus;
  subscribeStatus: (listener: () => void) => () => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  flush: () => Promise<void>;
  checkpoint: () => Promise<void>;
  destroy: () => void;
}

export type BlockDocumentSurfaceProviderFactory = (
  options: NodexYProviderOptions,
) => BlockDocumentSurfaceProvider;

export type BlockDocumentSurfaceDocumentFactory = (
  descriptor: OwnedDocumentDescriptor,
) => Y.Doc;

export type BlockDocumentSurfaceOpenDocument = (
  document: Y.Doc,
  descriptor: OwnedDocumentDescriptor,
) => OwnedDocumentEnvelope;

export type BlockDocumentSurfaceCloseTimeoutScheduler = (
  callback: () => void,
  timeoutMs: number,
) => () => void;

export interface BlockDocumentSurfaceRuntimeOptions {
  readonly descriptor: OwnedDocumentDescriptor;
  readonly adapter: DocumentSyncAdapter;
  readonly createDocument?: BlockDocumentSurfaceDocumentFactory;
  readonly createProvider?: BlockDocumentSurfaceProviderFactory;
  readonly openDocument?: BlockDocumentSurfaceOpenDocument;
  readonly localCheckpointStore?: DocumentLocalCheckpointStore | null;
  readonly closeTimeoutMs?: number;
  readonly scheduleCloseTimeout?: BlockDocumentSurfaceCloseTimeoutScheduler;
  readonly reload?: (
    context: BlockDocumentSurfaceReloadContext,
  ) => void | Promise<void>;
}

interface ReadyWaiter {
  readonly resolve: (document: OwnedDocumentEnvelope) => void;
  readonly reject: (error: Error) => void;
}

interface SurfaceTerminalState {
  readonly reason: "fatal" | "reset-required";
  readonly error: Error;
}

interface CloseTaskState {
  completed: boolean;
  failed: boolean;
}

const requirePositiveTimeout = (value: number | undefined): number => {
  if (value === undefined) return DEFAULT_CLOSE_TIMEOUT_MS;
  if (Number.isFinite(value) && value > 0) return value;
  throw new TypeError("closeTimeoutMs must be positive");
};

const validateDescriptor = (
  descriptor: OwnedDocumentDescriptor,
): OwnedDocumentDescriptor => {
  if (!descriptor.documentId || descriptor.documentId !== descriptor.documentId.trim()) {
    throw new TypeError("Block Document descriptor has an invalid documentId");
  }
  if (!descriptor.storeEpoch || descriptor.storeEpoch !== descriptor.storeEpoch.trim()) {
    throw new TypeError("Block Document descriptor has an invalid storeEpoch");
  }
  if (!Number.isSafeInteger(descriptor.generation) || descriptor.generation < 1) {
    throw new TypeError("Block Document descriptor has an invalid generation");
  }
  if (descriptor.readiness !== "ready") {
    throw new TypeError("Block Document surface requires a ready Document");
  }
  if (descriptor.sync.kind !== "yjs") {
    throw new TypeError("Block Document surface requires the Yjs sync engine");
  }
  if (descriptor.ownerLifecycle !== "active") {
    throw new TypeError("Block Document surface requires an active owner");
  }
  const adapter = getRegisteredBlockDocumentSchemaAdapter({
    ownerType: descriptor.ownerType,
    schemaKey: descriptor.schemaKey,
    schemaVersion: descriptor.schemaVersion,
  });
  if (adapter.syncEngine !== "yjs") {
    throw new TypeError("Block Document schema is not registered for Yjs");
  }
  return descriptor;
};

const createEmptyDocument: BlockDocumentSurfaceDocumentFactory = (
  descriptor,
): Y.Doc => new Y.Doc({ guid: descriptor.documentId });

const createProvider: BlockDocumentSurfaceProviderFactory = (
  options,
): BlockDocumentSurfaceProvider => new NodexYProvider(options);

const openValidatedOwnedDocument: BlockDocumentSurfaceOpenDocument = (
  document,
  descriptor,
): OwnedDocumentEnvelope =>
  inspectRegisteredOwnedBlockDocument(document, {
    ownerType: descriptor.ownerType,
    schemaKey: descriptor.schemaKey,
    schemaVersion: descriptor.schemaVersion,
  }).envelope;

const defaultCloseTimeoutScheduler: BlockDocumentSurfaceCloseTimeoutScheduler = (
  callback,
  timeoutMs,
): (() => void) => {
  const timeout = globalThis.setTimeout(callback, timeoutMs);
  return () => globalThis.clearTimeout(timeout);
};

const providerError = (status: NodexYProviderStatus): Error =>
  new Error(status.error?.message ?? `Document provider entered ${status.phase}`);

const observeCloseTask = (
  task: Promise<void>,
  state: CloseTaskState,
): Promise<void> => task.then(
  () => {
    state.completed = true;
  },
  () => {
    state.failed = true;
  },
);

/**
 * Serializes cache operations and can permanently isolate a surface boundary.
 * Once isolated, pending writes finish before one final clear and all future
 * provider writes become no-ops. This prevents a fatal provider.destroy() from
 * recreating the checkpoint that caused the reload boundary.
 */
class IsolatedDocumentCheckpointStore implements DocumentLocalCheckpointStore {
  private active = true;
  private tail: Promise<void> = Promise.resolve();
  private isolationPromise: Promise<void> | null = null;

  constructor(
    private readonly delegate: DocumentLocalCheckpointStore | null,
    private readonly documentId: string,
  ) {}

  read = (
    boundary: Parameters<DocumentLocalCheckpointStore["read"]>[0],
    constraints?: DocumentLocalCheckpointStateConstraints,
  ): Promise<DocumentLocalCheckpoint | null> =>
    this.enqueue(async () => {
      if (!this.active || !this.delegate) return null;
      return await this.delegate.read(boundary, constraints);
    });

  write = (
    checkpoint: DocumentLocalCheckpoint,
    constraints?: DocumentLocalCheckpointStateConstraints,
  ): Promise<void> =>
    this.enqueue(async () => {
      if (!this.active || !this.delegate) return;
      await this.delegate.write(checkpoint, constraints);
    });

  clearDocument = (documentId: string): Promise<void> =>
    this.enqueue(async () => {
      if (!this.delegate) return;
      await this.delegate.clearDocument(documentId);
    });

  isolate = (): Promise<void> => {
    if (this.isolationPromise) return this.isolationPromise;
    this.active = false;
    this.isolationPromise = this.enqueue(async () => {
      if (!this.delegate) return;
      await this.delegate.clearDocument(this.documentId);
    });
    return this.isolationPromise;
  };

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class BlockDocumentSurfaceRuntime {
  readonly descriptor: OwnedDocumentDescriptor;
  readonly document: Y.Doc;
  readonly provider: BlockDocumentSurfaceProvider;

  private readonly openDocument: BlockDocumentSurfaceOpenDocument;
  private readonly checkpointStore: IsolatedDocumentCheckpointStore;
  private readonly closeTimeoutMs: number;
  private readonly scheduleCloseTimeout: BlockDocumentSurfaceCloseTimeoutScheduler;
  private readonly reloadHandler?: BlockDocumentSurfaceRuntimeOptions["reload"];
  private readonly listeners = new Set<() => void>();
  private readonly relocationPreparers =
    new Set<BlockDocumentSurfaceRelocationPreparer>();
  private readonly persistPreparers =
    new Set<BlockDocumentSurfacePersistPreparer>();
  private readonly readyWaiters = new Set<ReadyWaiter>();
  private readonly unsubscribeProviderStatus: () => void;

  private readyDocument: OwnedDocumentEnvelope | null = null;
  private terminal: SurfaceTerminalState | null = null;
  private isolationPromise: Promise<void> | null = null;
  private connectPromise: Promise<void> | null = null;
  private persistPromise: Promise<BlockDocumentSurfacePersistResult> | null = null;
  private closePromise: Promise<BlockDocumentSurfaceCloseResult> | null = null;
  private reloadPromise: Promise<void> | null = null;
  private closing = false;
  private closed = false;
  private status: BlockDocumentSurfaceStatus;

  constructor(options: BlockDocumentSurfaceRuntimeOptions) {
    this.descriptor = validateDescriptor(options.descriptor);
    this.openDocument = options.openDocument ?? openValidatedOwnedDocument;
    this.closeTimeoutMs = requirePositiveTimeout(options.closeTimeoutMs);
    this.scheduleCloseTimeout = options.scheduleCloseTimeout
      ?? defaultCloseTimeoutScheduler;
    this.reloadHandler = options.reload;

    const document = (options.createDocument ?? createEmptyDocument)(
      this.descriptor,
    );
    if (document.guid !== this.descriptor.documentId) {
      document.destroy();
      throw new TypeError("Block Document factory returned a mismatched guid");
    }
    this.document = document;

    const checkpointDelegate = options.localCheckpointStore === undefined
      ? createDefaultDocumentLocalCheckpointStore()
      : options.localCheckpointStore;
    this.checkpointStore = new IsolatedDocumentCheckpointStore(
      checkpointDelegate,
      this.descriptor.documentId,
    );
    this.provider = (options.createProvider ?? createProvider)({
      documentId: this.descriptor.documentId,
      document: this.document,
      adapter: options.adapter,
      expectedStoreEpoch: this.descriptor.storeEpoch,
      expectedGeneration: this.descriptor.generation,
      autoConnect: false,
      prepareSurfaceForRelocation: this.prepareSurfaceForRelocation,
      localCheckpointStore: checkpointDelegate ? this.checkpointStore : null,
      documentSchema: {
        ownerType: this.descriptor.ownerType,
        schemaKey: this.descriptor.schemaKey,
        schemaVersion: this.descriptor.schemaVersion,
      },
    });
    if (this.provider.document !== this.document) {
      this.provider.destroy();
      this.document.destroy();
      throw new TypeError("Block Document provider does not own the surface Y.Doc");
    }

    this.status = this.buildStatus(this.provider.getStatus());
    this.unsubscribeProviderStatus = this.provider.subscribeStatus(
      this.handleProviderStatus,
    );
    this.handleProviderStatus();
  }

  get clientSessionId(): string {
    return this.provider.clientSessionId;
  }

  get awareness(): Awareness {
    return this.provider.awareness;
  }

  getStatus = (): BlockDocumentSurfaceStatus => this.status;

  getWriteFrozen = (): boolean => this.status.writeFrozen;

  getReadyDocument = (): OwnedDocumentEnvelope | null => this.readyDocument;

  subscribe = (listener: () => void): (() => void) => {
    if (this.closed || this.closing) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  registerRelocationPreparer = (
    preparer: BlockDocumentSurfaceRelocationPreparer,
  ): (() => void) => {
    if (this.closed || this.closing) return () => undefined;
    this.relocationPreparers.add(preparer);
    return () => this.relocationPreparers.delete(preparer);
  };

  registerPersistPreparer = (
    preparer: BlockDocumentSurfacePersistPreparer,
  ): (() => void) => {
    if (this.closed || this.closing) return () => undefined;
    this.persistPreparers.add(preparer);
    return () => this.persistPreparers.delete(preparer);
  };

  connect = (): Promise<void> => {
    if (this.closed || this.closing) {
      return Promise.reject(new Error("Block Document surface is closed"));
    }
    if (this.terminal) {
      return Promise.reject(this.terminal.error);
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.provider.connect()
      .then(() => {
        this.handleProviderStatus();
      })
      .finally(() => {
        this.connectPromise = null;
      });
    return this.connectPromise;
  };

  whenReady = (): Promise<OwnedDocumentEnvelope> => {
    if (this.readyDocument) return Promise.resolve(this.readyDocument);
    if (this.terminal) return Promise.reject(this.terminal.error);
    if (this.closed || this.closing) {
      return Promise.reject(new Error("Block Document surface closed before ready"));
    }
    return new Promise<OwnedDocumentEnvelope>((resolve, reject) => {
      this.readyWaiters.add({ resolve, reject });
    });
  };

  flush = (): Promise<void> => {
    if (this.terminal) return Promise.reject(this.terminal.error);
    if (this.closed || this.closing) {
      return Promise.reject(new Error("Block Document surface is closed"));
    }
    return this.provider.flush();
  };

  checkpoint = (): Promise<void> => {
    if (this.terminal) return Promise.reject(this.terminal.error);
    if (this.closed || this.closing) {
      return Promise.reject(new Error("Block Document surface is closed"));
    }
    return this.provider.checkpoint();
  };

  /**
   * Gives pending updates a bounded chance to reach SQLite while always
   * checkpointing the current local state. Unlike close(), this retains the
   * live provider so hidden Card tabs can keep converging in the background.
   */
  persist = (): Promise<BlockDocumentSurfacePersistResult> => {
    if (this.terminal) return Promise.reject(this.terminal.error);
    if (this.closed || this.closing) {
      return Promise.reject(new Error("Block Document surface is closed"));
    }
    if (this.persistPromise) return this.persistPromise;

    const promise = this.persistOwnedDocument().finally(() => {
      if (this.persistPromise === promise) this.persistPromise = null;
    });
    this.persistPromise = promise;
    return promise;
  };

  /** Keep durable content sync alive while removing presence for a retained tab. */
  clearLocalAwareness = (): void => {
    if (this.closed || this.closing) return;
    this.provider.awareness.setLocalState(null);
  };

  reload = (): Promise<void> => {
    if (!this.terminal) {
      return Promise.reject(new Error("Block Document surface does not require reload"));
    }
    if (this.reloadPromise) return this.reloadPromise;

    const terminal = this.terminal;
    this.reloadPromise = (async () => {
      await this.isolateCheckpoints();
      await this.close();
      await this.reloadHandler?.({
        descriptor: this.descriptor,
        reason: terminal.reason,
        error: terminal.error,
      });
    })();
    return this.reloadPromise;
  };

  close = (): Promise<BlockDocumentSurfaceCloseResult> => {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.refreshStatus();
    this.rejectReadyWaiters(
      this.terminal?.error ?? new Error("Block Document surface closed before ready"),
    );
    this.closePromise = this.closeOwnedResources();
    return this.closePromise;
  };

  private readonly handleProviderStatus = (): void => {
    if (this.closed || this.closing || this.terminal) return;
    const providerStatus = this.provider.getStatus();
    if (providerStatus.phase === "reset-required") {
      this.enterTerminal("reset-required", providerError(providerStatus));
      return;
    }
    if (providerStatus.phase === "error") {
      this.enterTerminal("fatal", providerError(providerStatus));
      return;
    }
    if (providerStatus.phase === "destroyed") {
      this.enterTerminal(
        "fatal",
        new Error("Block Document provider was destroyed unexpectedly"),
      );
      return;
    }
    if (providerStatus.phase === "synced" && !this.readyDocument) {
      try {
        this.readyDocument = this.openDocument(this.document, this.descriptor);
        this.resolveReadyWaiters(this.readyDocument);
      } catch (error) {
        this.enterTerminal(
          "fatal",
          error instanceof Error ? error : new Error(String(error)),
        );
        return;
      }
    }
    this.refreshStatus();
  };

  private enterTerminal(
    reason: SurfaceTerminalState["reason"],
    error: Error,
  ): void {
    if (this.terminal || this.closed || this.closing) return;
    this.terminal = { reason, error };
    this.readyDocument = null;
    this.provider.disconnect();
    void this.isolateCheckpoints();
    this.rejectReadyWaiters(error);
    this.refreshStatus();
  }

  private isolateCheckpoints(): Promise<void> {
    if (!this.isolationPromise) {
      this.isolationPromise = this.checkpointStore.isolate();
    }
    return this.isolationPromise;
  }

  private async closeOwnedResources(): Promise<BlockDocumentSurfaceCloseResult> {
    const terminal = this.terminal;
    const checkpointState: CloseTaskState = { completed: false, failed: false };
    const terminalTimedOut = terminal
      ? await this.waitForCloseTasks(
          observeCloseTask(this.isolateCheckpoints(), checkpointState),
        )
      : false;
    const persisted = terminal
      ? null
      : await (this.persistPromise ?? this.persistOwnedDocument());

    this.unsubscribeProviderStatus();
    try {
      this.provider.destroy();
    } catch {
      // Ownership cleanup continues; the Y.Doc must never outlive close.
    } finally {
      this.document.destroy();
      this.closed = true;
      this.closing = false;
      this.refreshStatus();
      this.relocationPreparers.clear();
      this.persistPreparers.clear();
      this.listeners.clear();
    }

    return {
      timedOut: persisted?.timedOut ?? terminalTimedOut,
      flush: terminal
        ? "skipped"
        : persisted?.flush ?? "failed",
      checkpoint: terminal
        ? terminalTimedOut && !checkpointState.completed && !checkpointState.failed
          ? "timed-out"
          : checkpointState.failed
            ? "failed"
            : "isolated"
        : persisted?.checkpoint ?? "failed",
    };
  }

  private async persistOwnedDocument(): Promise<BlockDocumentSurfacePersistResult> {
    const flushState: CloseTaskState = { completed: false, failed: false };
    const checkpointState: CloseTaskState = { completed: false, failed: false };
    const prepare = Promise.all(
      [...this.persistPreparers].map((preparer) =>
        Promise.resolve().then(() => preparer()),
      ),
    );
    const tasks = [
      observeCloseTask(
        prepare.then(() => this.provider.flush()),
        flushState,
      ),
      observeCloseTask(
        prepare.then(() => this.provider.checkpoint()),
        checkpointState,
      ),
    ];
    const timedOut = await this.waitForCloseTasks(Promise.all(tasks));
    return {
      timedOut,
      flush: timedOut && !flushState.completed && !flushState.failed
        ? "timed-out"
        : flushState.failed
          ? "failed"
          : "completed",
      checkpoint: timedOut && !checkpointState.completed && !checkpointState.failed
        ? "timed-out"
        : checkpointState.failed
          ? "failed"
          : "completed",
    };
  }

  private waitForCloseTasks(tasks: Promise<unknown>): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const cancelTimeout = this.scheduleCloseTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(true);
      }, this.closeTimeoutMs);
      void tasks.then(
        () => {
          if (settled) return;
          settled = true;
          cancelTimeout();
          resolve(false);
        },
        () => {
          if (settled) return;
          settled = true;
          cancelTimeout();
          resolve(false);
        },
      );
    });
  }

  private resolveReadyWaiters(document: OwnedDocumentEnvelope): void {
    for (const waiter of this.readyWaiters) waiter.resolve(document);
    this.readyWaiters.clear();
  }

  private rejectReadyWaiters(error: Error): void {
    for (const waiter of this.readyWaiters) waiter.reject(error);
    this.readyWaiters.clear();
  }

  private buildStatus(
    provider: NodexYProviderStatus,
  ): BlockDocumentSurfaceStatus {
    let phase: BlockDocumentSurfacePhase;
    const writeFrozen =
      provider.phase === "relocating" || provider.phase === "frozen";
    if (this.closed) {
      phase = "closed";
    } else if (this.closing) {
      phase = "closing";
    } else if (this.terminal?.reason === "reset-required") {
      phase = "reset-required";
    } else if (this.terminal) {
      phase = "error";
    } else if (provider.phase === "frozen") {
      phase = "frozen";
    } else if (provider.phase === "relocating") {
      phase = "relocating";
    } else if (provider.phase === "synced" && this.readyDocument) {
      phase = "ready";
    } else if (provider.phase === "saving") {
      phase = "saving";
    } else if (provider.phase === "offline") {
      phase = "offline";
    } else if (provider.phase === "connecting") {
      phase = "connecting";
    } else {
      phase = "idle";
    }
    return {
      phase,
      ready:
        this.readyDocument !== null
        && !this.terminal
        && !this.closed
        && !this.closing,
      reloadRequired: this.terminal !== null,
      writeFrozen,
      descriptor: this.descriptor,
      provider,
      error: this.terminal?.error,
    };
  }

  private refreshStatus(): void {
    this.status = this.buildStatus(this.provider.getStatus());
    for (const listener of this.listeners) listener();
  }

  private readonly prepareSurfaceForRelocation = async (
    event: BlockDocumentSurfaceRelocationPreparation,
  ): Promise<void> => {
    const preparers = [...this.relocationPreparers];
    await Promise.all(
      preparers.map((prepare) => Promise.resolve().then(() => prepare(event))),
    );
  };
}
