import {
  CANVAS_SCENE_SYNC_VERSION,
  canonicalStringifyCanvasScene,
  canonicalizeCanvasPresencePublication,
  canonicalizeCanvasSceneMutationIntent,
  canonicalizeCanvasSceneMutationRequest,
  chooseCanvasSceneElementWinner,
  materializePortableCanvasScene,
  parsePortableCanvasScene,
  type CanvasSceneAppStateIntent,
  type CanvasSceneAppStateIntents,
  type CanvasSceneCommittedDelta,
  type CanvasSceneElement,
  type CanvasSceneFile,
  type CanvasSceneMutationCommandResult,
  type CanvasSceneMutationError,
  type CanvasSceneMutationIntent,
  type CanvasSceneMutationRequest,
  type CanvasSceneRealtimeEvent,
  type CanvasSceneSyncCommandResult,
  type CanvasSceneSyncRequest,
  type CanvasPresenceCommandResult,
  type CanvasPresenceRealtimeEvent,
  type CanvasPresenceValue,
  type PortableCanvasScene,
} from "../../shared/block-documents";
import type { CanvasSceneOutbox } from "./canvas-scene-outbox";
import type {
  DocumentRelocationLeaseNackReason,
  DocumentRelocationLeaseResponseAck,
  DocumentRelocationLeaseResponseRequest,
  DocumentSyncCommandResult,
  DocumentSyncRealtimeEvent,
} from "../../shared/block-documents/document-sync";

export type CanvasSceneRelocationLeaseEvent = Extract<
  DocumentSyncRealtimeEvent,
  {
    readonly kind:
      | "relocation-lease-prepare"
      | "relocation-lease-release"
      | "relocation-lease-cancel";
  }
>;

export interface CanvasSceneSyncAdapter {
  subscribe: (
    request: Pick<CanvasSceneSyncRequest, "projectId" | "documentId" | "clientSessionId">,
    listener: (event: CanvasSceneRealtimeEvent) => void,
    leaseListener?: (event: CanvasSceneRelocationLeaseEvent) => void,
    presenceListener?: (event: CanvasPresenceRealtimeEvent) => void,
  ) => () => void;
  sync: (request: CanvasSceneSyncRequest) => Promise<CanvasSceneSyncCommandResult>;
  applyMutation: (
    request: CanvasSceneMutationRequest,
  ) => Promise<CanvasSceneMutationCommandResult>;
  respondToRelocationLease?: (
    request: DocumentRelocationLeaseResponseRequest,
  ) => Promise<DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>>;
  publishPresence?: (
    request: import("../../shared/block-documents").CanvasPresencePublishRequest,
  ) => Promise<CanvasPresenceCommandResult>;
}

export interface CanvasSceneObservation {
  readonly elementCandidates: readonly CanvasSceneElement[];
  readonly appStateIntents?: CanvasSceneAppStateIntents;
  readonly fileAdditions?: Readonly<Record<string, CanvasSceneFile>>;
}

export interface CanvasSceneSubmission {
  readonly durable: Promise<void>;
  readonly committed: Promise<void>;
}

export type CanvasSceneProviderPhase =
  | "idle"
  | "connecting"
  | "ready"
  | "saving"
  | "relocating"
  | "frozen"
  | "offline"
  | "reset-required"
  | "error"
  | "closing"
  | "closed";

export interface CanvasSceneProviderStatus {
  readonly phase: CanvasSceneProviderPhase;
  readonly connected: boolean;
  readonly headSeq: number;
  readonly pendingMutationCount: number;
  readonly writeFrozen: boolean;
  readonly inFlightMutationId?: string;
  readonly error?: CanvasSceneMutationError;
  readonly relocationLease?: {
    readonly leaseId: string;
    readonly status: "preparing" | "frozen";
    readonly deadlineAt: number;
  };
}

export type CanvasSceneProviderScheduler = (
  callback: () => void,
  delayMs: number,
) => () => void;

export interface CanvasSceneProviderOptions {
  readonly projectId: string;
  readonly documentId: string;
  readonly clientSessionId: string;
  readonly expectedStoreEpoch?: string;
  readonly expectedGeneration?: number;
  readonly adapter: CanvasSceneSyncAdapter;
  readonly outbox: CanvasSceneOutbox;
  readonly onScene: (scene: PortableCanvasScene) => void;
  readonly onPresence?: (event: CanvasPresenceRealtimeEvent) => void;
  readonly createMutationId?: () => string;
  readonly createSyncRequestId?: () => string;
  readonly coalesceDelayMs?: number;
  readonly schedule?: CanvasSceneProviderScheduler;
  readonly scheduleRetry?: CanvasSceneProviderScheduler;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly scheduleLeaseDeadline?: CanvasSceneProviderScheduler;
}

interface ObservationWaiter {
  durableSettled: boolean;
  committedSettled: boolean;
  readonly resolveDurable: () => void;
  readonly rejectDurable: (error: Error) => void;
  readonly resolveCommitted: () => void;
  readonly rejectCommitted: (error: Error) => void;
}

interface PendingObservation {
  readonly elementCandidates: readonly CanvasSceneElement[];
  readonly appStateIntents: CanvasSceneAppStateIntents;
  readonly fileAdditions: Readonly<Record<string, CanvasSceneFile>>;
  readonly waiters: readonly ObservationWaiter[];
}

interface InFlightMutation {
  readonly intent: CanvasSceneMutationIntent;
  readonly waiters: readonly ObservationWaiter[];
  durable: boolean;
}

interface ActiveCanvasSceneLease {
  readonly leaseId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly expectedHeadSeq: number;
  readonly deadlineAt: number;
  readonly sequence: number;
  status: "preparing" | "frozen";
  acknowledged: boolean;
  terminal: Extract<
    CanvasSceneRelocationLeaseEvent,
    { readonly kind: "relocation-lease-release" | "relocation-lease-cancel" }
  > | null;
  cancelDeadline: (() => void) | null;
}

export type CanvasSceneWriteLeasePreparer = () => void | Promise<void>;

const LEASE_TERMINAL_TIMEOUT_MS = 10_000;

const defaultScheduler: CanvasSceneProviderScheduler = (callback, delayMs) => {
  const timeout = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timeout);
};

const resolvedSubmission = (): CanvasSceneSubmission => ({
  durable: Promise.resolve(),
  committed: Promise.resolve(),
});

const rejectedSubmission = (error: Error): CanvasSceneSubmission => {
  const durable = Promise.reject(error);
  const committed = Promise.reject(error);
  void durable.catch(() => undefined);
  void committed.catch(() => undefined);
  return { durable, committed };
};

const createObservationWaiter = (): {
  readonly waiter: ObservationWaiter;
  readonly submission: CanvasSceneSubmission;
} => {
  let resolveDurable = (): void => undefined;
  let rejectDurable: (error: Error) => void = () => undefined;
  let resolveCommitted = (): void => undefined;
  let rejectCommitted: (error: Error) => void = () => undefined;
  const durable = new Promise<void>((resolve, reject) => {
    resolveDurable = resolve;
    rejectDurable = reject;
  });
  const committed = new Promise<void>((resolve, reject) => {
    resolveCommitted = resolve;
    rejectCommitted = reject;
  });
  void durable.catch(() => undefined);
  void committed.catch(() => undefined);
  return {
    waiter: {
      durableSettled: false,
      committedSettled: false,
      resolveDurable,
      rejectDurable,
      resolveCommitted,
      rejectCommitted,
    },
    submission: { durable, committed },
  };
};

const resolveDurable = (waiter: ObservationWaiter): void => {
  if (waiter.durableSettled) return;
  waiter.durableSettled = true;
  waiter.resolveDurable();
};

const rejectDurable = (waiter: ObservationWaiter, error: Error): void => {
  if (waiter.durableSettled) return;
  waiter.durableSettled = true;
  waiter.rejectDurable(error);
};

const resolveCommitted = (waiter: ObservationWaiter): void => {
  if (waiter.committedSettled) return;
  resolveDurable(waiter);
  waiter.committedSettled = true;
  waiter.resolveCommitted();
};

const rejectCommitted = (waiter: ObservationWaiter, error: Error): void => {
  if (waiter.committedSettled) return;
  waiter.committedSettled = true;
  waiter.rejectCommitted(error);
};

const transportError = (error: unknown): CanvasSceneMutationError => ({
  code: "unknown",
  message: error instanceof Error ? error.message : String(error),
  retryable: true,
  resetRequired: false,
});

const invalidResponseError = (message: string): CanvasSceneMutationError => ({
  code: "unknown",
  message,
  retryable: false,
  resetRequired: false,
});

const sameValue = (left: unknown, right: unknown): boolean =>
  canonicalStringifyCanvasScene(left) === canonicalStringifyCanvasScene(right);

const mergeIntent = (
  previous: CanvasSceneAppStateIntent | undefined,
  next: CanvasSceneAppStateIntent,
): CanvasSceneAppStateIntent =>
  previous && sameValue(previous.value, next.expected)
    ? { expected: previous.expected, value: next.value }
    : next;

const mergeObservations = (
  previous: PendingObservation | null,
  next: PendingObservation,
): PendingObservation => {
  if (!previous) return next;
  const elements = new Map<string, CanvasSceneElement>();
  for (const element of previous.elementCandidates) {
    elements.set(element.id as string, element);
  }
  for (const element of next.elementCandidates) {
    const id = element.id as string;
    const current = elements.get(id);
    elements.set(
      id,
      current ? chooseCanvasSceneElementWinner(current, element) : element,
    );
  }
  const appStateIntents: Record<string, CanvasSceneAppStateIntent> = {
    ...previous.appStateIntents,
  };
  for (const [key, intent] of Object.entries(next.appStateIntents)) {
    appStateIntents[key] = mergeIntent(appStateIntents[key], intent);
  }
  const fileAdditions: Record<string, CanvasSceneFile> = {
    ...previous.fileAdditions,
  };
  for (const [fileId, file] of Object.entries(next.fileAdditions)) {
    const current = fileAdditions[fileId];
    if (current && !sameValue(current, file)) {
      throw new TypeError(`Canvas file ${fileId} cannot be redefined`);
    }
    fileAdditions[fileId] = file;
  }
  return {
    elementCandidates: [...elements.values()],
    appStateIntents,
    fileAdditions,
    waiters: [...previous.waiters, ...next.waiters],
  };
};

const applyCommittedDelta = (
  current: PortableCanvasScene,
  delta: CanvasSceneCommittedDelta,
): PortableCanvasScene => {
  const elements = new Map(
    current.elements.map((element) => [element.id as string, element]),
  );
  for (const update of delta.elementUpdates) {
    const id = update.id as string;
    const existing = elements.get(id);
    elements.set(
      id,
      existing ? chooseCanvasSceneElementWinner(existing, update) : update,
    );
  }
  const files: Record<string, CanvasSceneFile> = {
    ...current.files,
    ...delta.fileAdditions,
  };
  for (const fileId of delta.removedFileIds) delete files[fileId];
  return materializePortableCanvasScene({
    elements: [...elements.values()],
    appState: delta.appState,
    files,
  });
};

let fallbackMutationSequence = 0;
const createFallbackMutationId = (): string => {
  fallbackMutationSequence += 1;
  return `canvas-mutation:${Date.now().toString(36)}:${fallbackMutationSequence.toString(36)}`;
};

let fallbackSyncSequence = 0;
const createFallbackSyncRequestId = (): string => {
  fallbackSyncSequence += 1;
  return `canvas-sync:${Date.now().toString(36)}:${fallbackSyncSequence.toString(36)}`;
};

export class CanvasSceneProvider {
  private readonly options: CanvasSceneProviderOptions;
  private readonly listeners = new Set<() => void>();
  private readonly flushWaiters = new Set<ObservationWaiter>();
  private readonly durableFlushWaiters = new Set<ObservationWaiter>();
  private readonly leaseIdleWaiters = new Set<ObservationWaiter>();
  private readonly coalesceDelayMs: number;
  private readonly schedule: CanvasSceneProviderScheduler;
  private readonly scheduleRetry: CanvasSceneProviderScheduler;
  private readonly scheduleLeaseDeadline: CanvasSceneProviderScheduler;
  private readonly createMutationId: () => string;
  private readonly createSyncRequestId: () => string;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly writeLeasePreparers = new Set<CanvasSceneWriteLeasePreparer>();

  private unsubscribeRealtime: (() => void) | null = null;
  private cancelCoalesce: (() => void) | null = null;
  private cancelRetry: (() => void) | null = null;
  private connectPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private syncPromise: Promise<void> | null = null;
  private queuedPersistencePromise: Promise<void> | null = null;
  private syncAgain = false;
  private activeSyncRequestId: string | null = null;
  private outboxHydrated = false;
  private scene: PortableCanvasScene | null = null;
  private sceneHash: string | null = null;
  private storeEpoch: string | null = null;
  private generation: number | null = null;
  private headSeq = 0;
  private pending: PendingObservation | null = null;
  private recovered: CanvasSceneMutationIntent[] = [];
  private readonly recoveredWaiters = new Map<
    string,
    readonly ObservationWaiter[]
  >();
  private inFlight: InFlightMutation | null = null;
  private connected = false;
  private closing = false;
  private closed = false;
  private error: CanvasSceneMutationError | undefined;
  private activeLease: ActiveCanvasSceneLease | null = null;
  private pendingPresenceEvents: CanvasPresenceRealtimeEvent[] = [];
  private retryAttempt = 0;
  private leaseSequence = 0;
  private runningLeasePreparers = false;
  private status: CanvasSceneProviderStatus;

  constructor(options: CanvasSceneProviderOptions) {
    this.options = options;
    this.coalesceDelayMs = options.coalesceDelayMs ?? 150;
    this.schedule = options.schedule ?? defaultScheduler;
    this.scheduleRetry = options.scheduleRetry ?? defaultScheduler;
    this.scheduleLeaseDeadline = options.scheduleLeaseDeadline ?? defaultScheduler;
    this.createMutationId = options.createMutationId ?? createFallbackMutationId;
    this.createSyncRequestId =
      options.createSyncRequestId ?? createFallbackSyncRequestId;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.status = this.buildStatus();
  }

  getStatus = (): CanvasSceneProviderStatus => this.status;

  getScene = (): PortableCanvasScene | null => this.scene;

  publishPresence = async (
    clock: number,
    state: CanvasPresenceValue | null,
  ): Promise<CanvasPresenceCommandResult> =>
    this.publishPresenceFor(this.options.clientSessionId, clock, state);

  publishPresenceFor = async (
    clientSessionId: string,
    clock: number,
    state: CanvasPresenceValue | null,
  ): Promise<CanvasPresenceCommandResult> => {
    if (
      this.closed
      || this.closing
      || this.generation === null
      || !this.options.adapter.publishPresence
    ) {
      return {
        ok: false,
        error: {
          code: "transport_unavailable",
          message: "Canvas presence is unavailable before scene synchronization",
          retryable: true,
          resetRequired: false,
        },
      };
    }
    try {
      return await this.options.adapter.publishPresence({
        projectId: this.options.projectId,
        clientSessionId,
        publication: canonicalizeCanvasPresencePublication({
          version: 1,
          engine: "canvas_scene",
          documentId: this.options.documentId,
          generation: this.generation,
          clock,
          state,
        }),
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof TypeError
            ? "invalid_presence"
            : "transport_unavailable",
          message: error instanceof Error ? error.message : String(error),
          retryable: !(error instanceof TypeError),
          resetRequired: false,
        },
      };
    }
  };

  subscribeStatus = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  registerWriteLeasePreparer = (
    preparer: CanvasSceneWriteLeasePreparer,
  ): (() => void) => {
    if (this.closed || this.closing) return () => undefined;
    this.writeLeasePreparers.add(preparer);
    return () => this.writeLeasePreparers.delete(preparer);
  };

  connect = (): Promise<void> => {
    if (this.closed || this.closing) {
      return Promise.reject(new Error("Canvas scene provider is closed"));
    }
    if (this.error && !this.error.retryable) {
      return Promise.reject(new Error(this.error.message));
    }
    if (this.connectPromise) return this.connectPromise;
    const promise = this.connectInternal().finally(() => {
      if (this.connectPromise === promise) this.connectPromise = null;
    });
    this.connectPromise = promise;
    return promise;
  };

  enqueue = (observation: CanvasSceneObservation): CanvasSceneSubmission => {
    if (this.closed || this.closing) {
      return rejectedSubmission(new Error("Canvas scene provider is closed"));
    }
    if (this.error && !this.error.retryable) {
      return rejectedSubmission(new Error(this.error.message));
    }
    if (this.activeLease && !this.runningLeasePreparers) {
      return rejectedSubmission(
        new Error("Canvas scene is frozen by a Document write lease"),
      );
    }
    const appStateIntents = observation.appStateIntents ?? {};
    const fileAdditions = observation.fileAdditions ?? {};
    if (
      observation.elementCandidates.length === 0
      && Object.keys(appStateIntents).length === 0
      && Object.keys(fileAdditions).length === 0
    ) {
      return resolvedSubmission();
    }

    const { waiter, submission } = createObservationWaiter();
    try {
      this.pending = mergeObservations(this.pending, {
        elementCandidates: observation.elementCandidates,
        appStateIntents,
        fileAdditions,
        waiters: [waiter],
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      rejectDurable(waiter, failure);
      rejectCommitted(waiter, failure);
      return submission;
    }
    this.schedulePending();
    this.refreshStatus();
    return submission;
  };

  submit = (observation: CanvasSceneObservation): Promise<void> => {
    const submission = this.enqueue(observation);
    void submission.durable.catch(() => undefined);
    return submission.committed;
  };

  persistDurable = async (): Promise<void> => {
    if (this.closed) throw new Error("Canvas scene provider is closed");
    this.cancelCoalesce?.();
    this.cancelCoalesce = null;
    if (!this.scene) await this.connect();
    this.pump();
    if (this.isLocallyDurable()) return;
    const { waiter, submission } = createObservationWaiter();
    this.durableFlushWaiters.add(waiter);
    void submission.committed.catch(() => undefined);
    await submission.durable;
  };

  flushCommitted = async (): Promise<void> => {
    if (this.closed) throw new Error("Canvas scene provider is closed");
    await this.persistDurable();
    if (!this.connected || this.error?.retryable) await this.connect();
    this.pump();
    if (this.isIdle()) return;
    const { waiter, submission } = createObservationWaiter();
    resolveDurable(waiter);
    this.flushWaiters.add(waiter);
    await submission.committed;
  };

  flush = (): Promise<void> => this.flushCommitted();

  waitForRelocationIdle = async (): Promise<void> => {
    if (!this.activeLease) return;
    const { waiter, submission } = createObservationWaiter();
    this.leaseIdleWaiters.add(waiter);
    void submission.durable.catch(() => undefined);
    await submission.committed;
  };

  close = (
    options: { readonly requireCommitted?: boolean } = {},
  ): Promise<void> => {
    if (this.closed) return Promise.resolve();
    if (this.closePromise) return this.closePromise;
    const requireCommitted = options.requireCommitted ?? true;
    const promise = this.closeInternal(requireCommitted).finally(() => {
      if (this.closePromise === promise) this.closePromise = null;
    });
    this.closePromise = promise;
    return promise;
  };

  retireOwner = (): Promise<void> => {
    if (this.closePromise) {
      return this.closePromise
        .catch(() => undefined)
        .then(() => this.options.outbox.clear(this.options.documentId));
    }
    if (this.closed) {
      return this.options.outbox.clear(this.options.documentId);
    }
    const promise = this.retireOwnerInternal().finally(() => {
      if (this.closePromise === promise) this.closePromise = null;
    });
    this.closePromise = promise;
    return promise;
  };

  private async closeInternal(requireCommitted: boolean): Promise<void> {
    try {
      if (requireCommitted) await this.flushCommitted();
      else await this.persistDurable();
    } finally {
      if (!requireCommitted) {
        const failure = new Error(
          "Canvas scene provider closed after local durability; commit continues from the outbox",
        );
        this.inFlight?.waiters.forEach((waiter) =>
          rejectCommitted(waiter, failure)
        );
        this.pending?.waiters.forEach((waiter) =>
          rejectCommitted(waiter, failure)
        );
      }
      this.finalizeClosed();
    }
  }

  private async retireOwnerInternal(): Promise<void> {
    this.closing = true;
    this.refreshStatus();
    const failure = new Error("Canvas owner was deleted");
    this.rejectAll(failure);
    try {
      await this.options.outbox.clear(this.options.documentId);
    } finally {
      this.finalizeClosed();
    }
  }

  private finalizeClosed(): void {
    this.closing = true;
    this.refreshStatus();
    this.cancelCoalesce?.();
    this.cancelRetry?.();
    if (this.activeLease) {
      this.nackLeaseBestEffort(
        this.activeLease,
        "provider_destroyed",
        "Canvas scene provider closed during a Document write lease",
      );
      this.clearActiveLease();
    }
    this.unsubscribeRealtime?.();
    this.cancelCoalesce = null;
    this.cancelRetry = null;
    this.unsubscribeRealtime = null;
    this.pendingPresenceEvents = [];
    this.activeSyncRequestId = null;
    this.connected = false;
    this.closed = true;
    this.closing = false;
    this.refreshStatus();
    this.listeners.clear();
  }

  private async connectInternal(): Promise<void> {
    if (!this.unsubscribeRealtime) {
      this.unsubscribeRealtime = this.options.adapter.subscribe(
        {
          projectId: this.options.projectId,
          documentId: this.options.documentId,
          clientSessionId: this.options.clientSessionId,
        },
        this.handleRealtimeEvent,
        this.handleLeaseEvent,
        this.handlePresenceEvent,
      );
    }
    this.connected = true;
    this.error = undefined;
    this.refreshStatus();
    await this.requestSync();
    if (!this.scene || this.error) return;
    if (this.outboxHydrated) {
      this.pump();
      return;
    }
    const recovered = await this.options.outbox.list(this.options.documentId);
    if (
      recovered.some(
        (intent) =>
          intent.projectId !== this.options.projectId
          || intent.storeEpoch !== this.storeEpoch
          || intent.generation !== this.generation,
      )
    ) {
      await this.options.outbox.clear(this.options.documentId);
      this.enterReset("Canvas outbox crossed a store epoch or generation boundary");
      return;
    }
    this.outboxHydrated = true;
    this.recovered = [...recovered];
    this.pump();
  }

  private requestSync(): Promise<void> {
    if (this.syncPromise) {
      this.syncAgain = true;
      const active = this.syncPromise;
      return active.then(() => this.syncPromise ?? Promise.resolve());
    }
    const promise = this.performSync().finally(() => {
      if (this.syncPromise === promise) this.syncPromise = null;
      const again = this.syncAgain;
      this.syncAgain = false;
      if (again && !this.closed && !this.error) {
        void this.requestSync();
      } else {
        this.pump();
      }
    });
    this.syncPromise = promise;
    return promise;
  }

  private async performSync(): Promise<void> {
    const syncRequestId = this.createSyncRequestId();
    this.activeSyncRequestId = syncRequestId;
    let result: CanvasSceneSyncCommandResult;
    try {
      result = await this.options.adapter.sync({
        version: CANVAS_SCENE_SYNC_VERSION,
        syncRequestId,
        projectId: this.options.projectId,
        documentId: this.options.documentId,
        clientSessionId: this.options.clientSessionId,
        ...(this.storeEpoch ? { knownStoreEpoch: this.storeEpoch } : {}),
        ...(this.generation === null ? {} : { knownGeneration: this.generation }),
        ...(this.scene ? { knownHeadSeq: this.headSeq } : {}),
        ...(this.sceneHash ? { knownSceneHash: this.sceneHash } : {}),
      });
    } catch (error) {
      if (this.activeSyncRequestId !== syncRequestId || this.closed) return;
      this.handleRetryableError(transportError(error));
      return;
    }
    if (this.activeSyncRequestId !== syncRequestId || this.closed) return;
    if (!result.ok) {
      this.handleCommandError(result.error);
      return;
    }
    const response = result.value;
    if (response.syncRequestId !== syncRequestId) {
      this.enterFatal("Canvas sync response does not match its active request");
      return;
    }
    if (
      response.projectId !== this.options.projectId
      || response.documentId !== this.options.documentId
    ) {
      this.enterFatal("Canvas sync response crossed its Project or Document boundary");
      return;
    }
    const expectedEpoch = this.storeEpoch ?? this.options.expectedStoreEpoch;
    const expectedGeneration = this.generation ?? this.options.expectedGeneration;
    if (
      (expectedEpoch !== undefined && expectedEpoch !== response.storeEpoch)
      || (expectedGeneration !== undefined && expectedGeneration !== response.generation)
    ) {
      await this.options.outbox.clear(this.options.documentId);
      this.enterReset("Canvas sync response crossed its store epoch or generation boundary");
      return;
    }
    if (
      response.version !== CANVAS_SCENE_SYNC_VERSION
      || (response.kind !== "up_to_date" && response.kind !== "snapshot")
      || typeof response.storeEpoch !== "string"
      || response.storeEpoch.length === 0
      || !Number.isSafeInteger(response.generation)
      || response.generation < 1
      || !Number.isSafeInteger(response.headSeq)
      || response.headSeq < 0
      || typeof response.sceneHash !== "string"
      || !/^[a-f0-9]{64}$/u.test(response.sceneHash)
    ) {
      this.enterFatal("Canvas sync response has invalid durable coordinates");
      return;
    }
    if (response.headSeq < this.headSeq) return;
    if (response.kind === "up_to_date") {
      if (!this.scene || !this.sceneHash) {
        this.enterFatal("Canvas sync reported up-to-date without a local scene");
        return;
      }
      if (
        response.headSeq !== this.headSeq
        || response.sceneHash !== this.sceneHash
      ) {
        this.enterFatal("Canvas up-to-date response disagrees with the local scene");
        return;
      }
      this.storeEpoch = response.storeEpoch;
      this.generation = response.generation;
      this.flushPendingPresenceEvents();
      this.error = undefined;
      this.connected = true;
      if (!this.inFlight) this.retryAttempt = 0;
      this.refreshStatus();
      return;
    }
    let scene: PortableCanvasScene;
    try {
      scene = parsePortableCanvasScene(response.scene);
    } catch (error) {
      this.enterFatal(
        `Canvas sync response contains an invalid scene: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    this.storeEpoch = response.storeEpoch;
    this.generation = response.generation;
    this.headSeq = response.headSeq;
    this.sceneHash = response.sceneHash;
    this.scene = scene;
    this.error = undefined;
    this.connected = true;
    if (!this.inFlight) this.retryAttempt = 0;
    this.options.onScene(this.scene);
    this.flushPendingPresenceEvents();
    this.refreshStatus();
  }

  private schedulePending(): void {
    if (this.cancelCoalesce) return;
    this.cancelCoalesce = this.schedule(() => {
      this.cancelCoalesce = null;
      this.pump();
    }, this.coalesceDelayMs);
  }

  private pump(): void {
    if (
      this.closed
      || !this.scene
      || this.syncPromise
      || this.queuedPersistencePromise
      || (this.error !== undefined && !this.error.retryable)
      || this.inFlight
      || this.activeLease?.status === "frozen"
    ) {
      if (
        this.inFlight?.durable
        && this.pending
        && !this.cancelCoalesce
        && !this.queuedPersistencePromise
      ) {
        this.startQueuedPersistence();
      }
      if (this.inFlight?.durable) this.resolveDurableFlushWaitersIfReady();
      this.refreshStatus();
      return;
    }
    const recovered = this.recovered.shift();
    if (recovered) {
      const waiters = this.recoveredWaiters.get(recovered.mutationId) ?? [];
      this.recoveredWaiters.delete(recovered.mutationId);
      this.inFlight = { intent: recovered, waiters, durable: true };
      this.refreshStatus();
      this.resolveDurableFlushWaitersIfReady();
      if (this.connected && !this.error) void this.sendInFlight();
      return;
    }
    if (!this.pending || this.cancelCoalesce) {
      this.resolveFlushWaitersIfIdle();
      this.resolveDurableFlushWaitersIfReady();
      this.refreshStatus();
      return;
    }
    const pending = this.pending;
    this.pending = null;
    let intent: CanvasSceneMutationIntent;
    try {
      intent = this.createIntent(pending);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      pending.waiters.forEach((waiter) => {
        rejectDurable(waiter, failure);
        rejectCommitted(waiter, failure);
      });
      this.pump();
      return;
    }
    this.inFlight = { intent, waiters: pending.waiters, durable: false };
    this.refreshStatus();
    void this.persistAndSendInFlight();
  }

  private createIntent(
    pending: PendingObservation,
  ): CanvasSceneMutationIntent {
    return canonicalizeCanvasSceneMutationIntent({
      version: CANVAS_SCENE_SYNC_VERSION,
      mutationId: this.createMutationId(),
      projectId: this.options.projectId,
      documentId: this.options.documentId,
      storeEpoch: this.storeEpoch,
      generation: this.generation,
      baseHeadSeq: this.headSeq,
      elementCandidates: pending.elementCandidates,
      appStateIntents: pending.appStateIntents,
      fileAdditions: pending.fileAdditions,
    });
  }

  private startQueuedPersistence(): void {
    if (this.queuedPersistencePromise) return;
    const promise = this.persistPendingBehindInFlight().finally(() => {
      if (this.queuedPersistencePromise !== promise) return;
      this.queuedPersistencePromise = null;
      this.resolveDurableFlushWaitersIfReady();
      this.pump();
    });
    this.queuedPersistencePromise = promise;
  }

  private async persistPendingBehindInFlight(): Promise<void> {
    while (this.pending && this.inFlight?.durable) {
      const pending = this.pending;
      this.pending = null;
      let intent: CanvasSceneMutationIntent;
      try {
        intent = this.createIntent(pending);
        await this.options.outbox.put(intent);
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        pending.waiters.forEach((waiter) => {
          rejectDurable(waiter, failure);
          rejectCommitted(waiter, failure);
        });
        this.enterFatal(`Could not persist queued Canvas mutation: ${failure.message}`);
        return;
      }
      pending.waiters.forEach(resolveDurable);
      this.recovered.push(intent);
      this.recoveredWaiters.set(intent.mutationId, pending.waiters);
      this.refreshStatus();
    }
  }

  private async persistAndSendInFlight(): Promise<void> {
    const current = this.inFlight;
    if (!current) return;
    try {
      await this.options.outbox.put(current.intent);
    } catch (error) {
      if (this.inFlight !== current) return;
      this.enterFatal(
        `Could not persist Canvas mutation before send: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (this.inFlight !== current) return;
    current.durable = true;
    current.waiters.forEach(resolveDurable);
    this.resolveDurableFlushWaitersIfReady();
    this.refreshStatus();
    if (this.connected && !this.error) await this.sendInFlight();
  }

  private async sendInFlight(): Promise<void> {
    const current = this.inFlight;
    if (!current || this.closed || this.error) return;
    const request = canonicalizeCanvasSceneMutationRequest({
      ...current.intent,
      clientSessionId: this.options.clientSessionId,
    });
    let result: CanvasSceneMutationCommandResult;
    try {
      result = await this.options.adapter.applyMutation(request);
    } catch (error) {
      if (this.inFlight === current) this.handleRetryableError(transportError(error));
      return;
    }
    if (this.inFlight !== current) return;
    if (!result.ok) {
      if (
        result.error.code === "invalid_canvas_scene_mutation"
        && !result.error.retryable
        && !result.error.resetRequired
      ) {
        await this.quarantineInFlight(current, result.error);
        return;
      }
      this.handleCommandError(result.error);
      return;
    }
    if (result.value.mutationId !== current.intent.mutationId) {
      this.enterFatal("Canvas mutation ACK does not match its request");
      return;
    }
    if (
      result.value.version !== CANVAS_SCENE_SYNC_VERSION
      || result.value.projectId !== current.intent.projectId
      || result.value.documentId !== current.intent.documentId
      || result.value.storeEpoch !== current.intent.storeEpoch
      || result.value.generation !== current.intent.generation
      || result.value.baseHeadSeq !== current.intent.baseHeadSeq
      || !Number.isSafeInteger(result.value.headSeq)
      || result.value.headSeq < result.value.baseHeadSeq
      || (result.value.outcome !== "committed" && result.value.outcome !== "no_change")
      || (result.value.outcome === "committed" && !result.value.committedDelta)
      || (result.value.outcome === "no_change" && result.value.committedDelta)
      || typeof result.value.duplicate !== "boolean"
      || typeof result.value.sceneHash !== "string"
      || !/^[a-f0-9]{64}$/u.test(result.value.sceneHash)
    ) {
      this.enterFatal("Canvas mutation ACK crossed its durable request boundary");
      return;
    }
    try {
      await this.options.outbox.remove(
        current.intent.documentId,
        current.intent.mutationId,
      );
    } catch (error) {
      if (this.inFlight === current) {
        this.handleRetryableError(transportError(error));
      }
      return;
    }
    this.inFlight = null;
    this.retryAttempt = 0;
    if (
      result.value.headSeq === this.headSeq + 1
      && result.value.committedDelta
      && this.scene
    ) {
      try {
        this.scene = applyCommittedDelta(
          this.scene,
          result.value.committedDelta,
        );
        this.headSeq = result.value.headSeq;
        this.sceneHash = result.value.sceneHash;
        this.options.onScene(this.scene);
        this.refreshStatus();
      } catch (error) {
        this.enterFatal(
          `Canvas mutation ACK delta is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
    } else if (result.value.headSeq > this.headSeq) {
      await this.requestSync();
    }
    current.waiters.forEach(resolveCommitted);
    this.pump();
  }

  private async quarantineInFlight(
    current: InFlightMutation,
    error: CanvasSceneMutationError,
  ): Promise<void> {
    try {
      await this.options.outbox.quarantine(
        current.intent,
        error,
        this.now(),
      );
    } catch (quarantineError) {
      if (this.inFlight !== current) return;
      this.enterFatal(
        `Could not quarantine rejected Canvas mutation: ${
          quarantineError instanceof Error
            ? quarantineError.message
            : String(quarantineError)
        }`,
      );
      return;
    }
    if (this.inFlight !== current) return;
    this.inFlight = null;
    const failure = new Error(error.message);
    current.waiters.forEach((waiter) => rejectCommitted(waiter, failure));
    this.refreshStatus();
    await this.requestSync();
    this.pump();
  }

  private readonly handleRealtimeEvent = (
    event: CanvasSceneRealtimeEvent,
  ): void => {
    if (this.closed || this.error) return;
    if (
      event.projectId !== this.options.projectId
      || event.documentId !== this.options.documentId
    ) {
      this.enterFatal("Canvas realtime event crossed its Project or Document boundary");
      return;
    }
    if (
      (this.storeEpoch && event.storeEpoch !== this.storeEpoch)
      || (this.generation !== null && event.generation !== this.generation)
    ) {
      void this.options.outbox.clear(this.options.documentId);
      this.enterReset("Canvas realtime event crossed its store epoch or generation boundary");
      return;
    }
    if (event.type === "canvas_scene_resync_required") {
      void this.requestSync();
      return;
    }
    if (!this.scene || event.headSeq !== this.headSeq + 1) {
      if (event.headSeq > this.headSeq) void this.requestSync();
      return;
    }
    try {
      this.scene = applyCommittedDelta(this.scene, event);
      this.headSeq = event.headSeq;
      this.sceneHash = event.sceneHash;
      this.options.onScene(this.scene);
      this.refreshStatus();
    } catch (error) {
      this.enterFatal(
        `Canvas realtime event is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  private readonly handlePresenceEvent = (
    event: CanvasPresenceRealtimeEvent,
  ): void => {
    if (this.closed || this.closing || !this.options.onPresence) return;
    const documentId = event.type === "canvas_presence_snapshot"
      ? event.documentId
      : event.presence.documentId;
    const generation = event.type === "canvas_presence_snapshot"
      ? event.generation
      : event.presence.generation;
    if (
      event.projectId !== this.options.projectId
      || documentId !== this.options.documentId
    ) {
      return;
    }
    if (this.generation === null) {
      this.pendingPresenceEvents = [
        ...this.pendingPresenceEvents.slice(-127),
        event,
      ];
      return;
    }
    if (generation !== this.generation) return;
    this.options.onPresence(event);
  };

  private flushPendingPresenceEvents(): void {
    if (this.generation === null || !this.options.onPresence) return;
    const events = this.pendingPresenceEvents;
    this.pendingPresenceEvents = [];
    for (const event of events) this.handlePresenceEvent(event);
  }

  private readonly handleLeaseEvent = (
    event: CanvasSceneRelocationLeaseEvent,
  ): void => {
    if (this.closed || this.error) return;
    if (event.kind === "relocation-lease-prepare") {
      this.handleLeasePrepare(event);
      return;
    }
    this.handleLeaseTerminal(event);
  };

  private handleLeasePrepare(
    event: Extract<
      CanvasSceneRelocationLeaseEvent,
      { readonly kind: "relocation-lease-prepare" }
    >,
  ): void {
    const valid =
      event.documentId === this.options.documentId
      && event.clientSessionId === this.options.clientSessionId
      && event.storeEpoch.length > 0
      && Number.isSafeInteger(event.generation)
      && event.generation >= 1
      && Number.isSafeInteger(event.expectedHeadSeq)
      && event.expectedHeadSeq >= 0
      && Number.isFinite(event.deadlineAt);
    if (!valid) {
      this.enterReset("Canvas received an invalid or foreign Document write lease");
      return;
    }
    const incoming: ActiveCanvasSceneLease = {
      leaseId: event.leaseId,
      storeEpoch: event.storeEpoch,
      generation: event.generation,
      expectedHeadSeq: event.expectedHeadSeq,
      deadlineAt: event.deadlineAt,
      sequence: this.leaseSequence + 1,
      status: "preparing",
      acknowledged: false,
      terminal: null,
      cancelDeadline: null,
    };
    if (this.activeLease) {
      const duplicate =
        this.activeLease.leaseId === incoming.leaseId
        && this.activeLease.storeEpoch === incoming.storeEpoch
        && this.activeLease.generation === incoming.generation
        && this.activeLease.expectedHeadSeq === incoming.expectedHeadSeq
        && this.activeLease.deadlineAt === incoming.deadlineAt;
      if (duplicate) return;
      this.nackLeaseBestEffort(
        incoming,
        "foreign_lease_event",
        "Canvas received overlapping Document write leases",
      );
      this.enterReset("Canvas received overlapping Document write leases");
      return;
    }
    if (
      !this.storeEpoch
      || this.generation === null
      || event.storeEpoch !== this.storeEpoch
      || event.generation !== this.generation
      || event.deadlineAt <= this.now()
    ) {
      this.nackLeaseBestEffort(
        incoming,
        event.deadlineAt <= this.now() ? "deadline_elapsed" : "boundary_mismatch",
        "Canvas write lease crossed its active authority boundary",
      );
      this.enterReset("Canvas write lease crossed its active authority boundary");
      return;
    }
    this.leaseSequence = incoming.sequence;
    incoming.cancelDeadline = this.scheduleLeaseDeadline(() => {
      if (!this.isCurrentLease(incoming) || incoming.status === "frozen") return;
      this.failActiveLease(
        incoming,
        "deadline_elapsed",
        "Canvas write lease preparation exceeded its deadline",
      );
    }, event.deadlineAt - this.now());
    this.activeLease = incoming;
    this.refreshStatus();
    void this.prepareLease(incoming);
  }

  private async prepareLease(lease: ActiveCanvasSceneLease): Promise<void> {
    try {
      this.runningLeasePreparers = true;
      await Promise.all(
        [...this.writeLeasePreparers].map((prepare) =>
          Promise.resolve().then(() => prepare()),
        ),
      );
    } catch (error) {
      this.failActiveLease(
        lease,
        "surface_prepare_failed",
        `Canvas surface could not prepare for its write lease: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    } finally {
      this.runningLeasePreparers = false;
    }
    if (!this.isCurrentLease(lease)) return;
    try {
      await this.flush();
      await this.requestSync();
    } catch (error) {
      this.failActiveLease(
        lease,
        "durable_flush_failed",
        `Canvas could not durably flush for its write lease: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (!this.isCurrentLease(lease)) return;
    if (
      this.now() >= lease.deadlineAt
      || !this.isIdle()
      || this.headSeq < lease.expectedHeadSeq
      || !this.options.adapter.respondToRelocationLease
    ) {
      this.failActiveLease(
        lease,
        this.now() >= lease.deadlineAt ? "deadline_elapsed" : "durable_flush_failed",
        "Canvas did not reach the lease durable head before ACK",
      );
      return;
    }
    let response: DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>;
    try {
      response = await this.options.adapter.respondToRelocationLease({
        response: "ack",
        leaseId: lease.leaseId,
        documentId: this.options.documentId,
        clientSessionId: this.options.clientSessionId,
        storeEpoch: lease.storeEpoch,
        generation: lease.generation,
        headSeq: this.headSeq,
      });
    } catch (error) {
      this.failActiveLease(
        lease,
        "durable_flush_failed",
        `Canvas write lease ACK failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (!this.isCurrentLease(lease)) return;
    if (
      !response.ok
      || response.value.accepted !== true
      || response.value.leaseId !== lease.leaseId
      || response.value.documentId !== this.options.documentId
      || response.value.status !== "frozen"
    ) {
      this.failActiveLease(
        lease,
        "foreign_lease_event",
        response.ok ? "Canvas write lease ACK was invalid" : response.error.message,
      );
      return;
    }
    if (!this.isIdle() || this.now() >= lease.deadlineAt) {
      this.failActiveLease(
        lease,
        "local_update_after_freeze",
        "Canvas changed while its write lease ACK was in flight",
      );
      return;
    }
    lease.acknowledged = true;
    lease.status = "frozen";
    lease.cancelDeadline?.();
    lease.cancelDeadline = null;
    this.refreshStatus();
    if (lease.terminal) {
      void this.completeLeaseTerminal(lease);
      return;
    }
    lease.cancelDeadline = this.scheduleLeaseDeadline(() => {
      if (!this.isCurrentLease(lease) || lease.terminal) return;
      this.clearActiveLease();
      this.enterReset("Canvas write lease received no terminal event");
    }, LEASE_TERMINAL_TIMEOUT_MS);
  }

  private handleLeaseTerminal(
    event: Extract<
      CanvasSceneRelocationLeaseEvent,
      { readonly kind: "relocation-lease-release" | "relocation-lease-cancel" }
    >,
  ): void {
    const lease = this.activeLease;
    if (
      !lease
      || event.leaseId !== lease.leaseId
      || event.documentId !== this.options.documentId
      || event.clientSessionId !== this.options.clientSessionId
      || event.storeEpoch !== lease.storeEpoch
      || event.generation !== lease.generation
      || !Number.isSafeInteger(event.headSeq)
      || event.headSeq < lease.expectedHeadSeq
    ) {
      this.enterReset("Canvas received a foreign or invalid write lease terminal event");
      return;
    }
    lease.terminal = event;
    if (lease.acknowledged) {
      lease.status = "frozen";
      lease.cancelDeadline?.();
      lease.cancelDeadline = null;
    }
    this.refreshStatus();
    if (lease.acknowledged) void this.completeLeaseTerminal(lease);
  }

  private async completeLeaseTerminal(
    lease: ActiveCanvasSceneLease,
  ): Promise<void> {
    if (!this.isCurrentLease(lease) || !lease.terminal) return;
    try {
      await this.requestSync();
    } catch (error) {
      this.clearActiveLease();
      this.enterReset(
        `Canvas could not synchronize its write lease terminal head: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (
      !this.isCurrentLease(lease)
      || !lease.terminal
      || this.error
      || this.headSeq < lease.terminal.headSeq
    ) {
      this.clearActiveLease();
      this.enterReset("Canvas did not reach its write lease terminal head");
      return;
    }
    this.clearActiveLease();
    this.refreshStatus();
    this.pump();
  }

  private isCurrentLease(lease: ActiveCanvasSceneLease): boolean {
    return !this.closed && this.activeLease?.sequence === lease.sequence;
  }

  private failActiveLease(
    lease: ActiveCanvasSceneLease,
    reason: DocumentRelocationLeaseNackReason,
    message: string,
  ): void {
    if (!this.isCurrentLease(lease)) return;
    this.nackLeaseBestEffort(lease, reason, message);
    this.clearActiveLease();
    this.enterReset(message);
  }

  private nackLeaseBestEffort(
    lease: ActiveCanvasSceneLease,
    reason: DocumentRelocationLeaseNackReason,
    message: string,
  ): void {
    const respond = this.options.adapter.respondToRelocationLease;
    if (!respond) return;
    try {
      void respond({
        response: "nack",
        leaseId: lease.leaseId,
        documentId: this.options.documentId,
        clientSessionId: this.options.clientSessionId,
        storeEpoch: lease.storeEpoch,
        generation: lease.generation,
        headSeq: this.headSeq,
        reason,
        message,
      }).catch(() => undefined);
    } catch {
      // Lease coordinator also observes disconnect and deadline expiry.
    }
  }

  private clearActiveLease(): void {
    this.activeLease?.cancelDeadline?.();
    this.activeLease = null;
    this.leaseIdleWaiters.forEach(resolveCommitted);
    this.leaseIdleWaiters.clear();
  }

  private handleCommandError(error: CanvasSceneMutationError): void {
    if (error.resetRequired) {
      void this.options.outbox.clear(this.options.documentId);
      this.clearActiveLease();
      this.error = error;
      this.connected = false;
      this.rejectAll(new Error(error.message));
      this.refreshStatus();
      return;
    }
    if (error.retryable) {
      this.handleRetryableError(error);
      return;
    }
    this.error = error;
    this.connected = false;
    this.rejectAll(new Error(error.message));
    this.refreshStatus();
  }

  private handleRetryableError(error: CanvasSceneMutationError): void {
    if (this.activeLease) {
      this.failActiveLease(
        this.activeLease,
        "durable_flush_failed",
        `Canvas transport failed during its write lease: ${error.message}`,
      );
      return;
    }
    this.error = error;
    this.connected = false;
    this.cancelRetry?.();
    const baseDelayMs = Math.min(
      5_000,
      150 * Math.pow(2, this.retryAttempt),
    );
    const delayMs = Math.round(baseDelayMs * (0.8 + this.random() * 0.4));
    this.retryAttempt = Math.min(this.retryAttempt + 1, 6);
    this.cancelRetry = this.scheduleRetry(() => {
      this.cancelRetry = null;
      this.error = undefined;
      void this.connect().then(() => {
        if (this.inFlight) void this.sendInFlight();
        else this.pump();
      });
    }, delayMs);
    this.refreshStatus();
  }

  private enterReset(message: string): void {
    this.clearActiveLease();
    this.error = {
      code: "document_generation_mismatch",
      message,
      retryable: false,
      resetRequired: true,
    };
    this.connected = false;
    this.rejectAll(new Error(message));
    this.refreshStatus();
  }

  private enterFatal(message: string): void {
    this.clearActiveLease();
    this.error = invalidResponseError(message);
    this.connected = false;
    this.rejectAll(new Error(message));
    this.refreshStatus();
  }

  private rejectAll(error: Error): void {
    this.pending?.waiters.forEach((waiter) => {
      rejectDurable(waiter, error);
      rejectCommitted(waiter, error);
    });
    this.inFlight?.waiters.forEach((waiter) => {
      rejectDurable(waiter, error);
      rejectCommitted(waiter, error);
    });
    this.recoveredWaiters.forEach((waiters) => {
      waiters.forEach((waiter) => {
        rejectDurable(waiter, error);
        rejectCommitted(waiter, error);
      });
    });
    this.flushWaiters.forEach((waiter) => rejectCommitted(waiter, error));
    this.durableFlushWaiters.forEach((waiter) => rejectDurable(waiter, error));
    this.leaseIdleWaiters.forEach((waiter) => rejectCommitted(waiter, error));
    this.pending = null;
    this.inFlight = null;
    this.recoveredWaiters.clear();
    this.flushWaiters.clear();
    this.durableFlushWaiters.clear();
    this.leaseIdleWaiters.clear();
  }

  private isIdle(): boolean {
    return !this.pending
      && !this.inFlight
      && this.recovered.length === 0
      && !this.cancelCoalesce
      && !this.queuedPersistencePromise;
  }

  private isLocallyDurable(): boolean {
    return !this.pending
      && !this.cancelCoalesce
      && !this.queuedPersistencePromise
      && (!this.inFlight || this.inFlight.durable);
  }

  private resolveDurableFlushWaitersIfReady(): void {
    if (!this.isLocallyDurable()) return;
    this.durableFlushWaiters.forEach(resolveDurable);
    this.durableFlushWaiters.clear();
  }

  private resolveFlushWaitersIfIdle(): void {
    if (!this.isIdle()) return;
    this.flushWaiters.forEach(resolveCommitted);
    this.flushWaiters.clear();
  }

  private buildStatus(): CanvasSceneProviderStatus {
    let phase: CanvasSceneProviderPhase;
    if (this.closed) phase = "closed";
    else if (this.closing) phase = "closing";
    else if (this.error?.resetRequired) phase = "reset-required";
    else if (this.error && !this.error.retryable) phase = "error";
    else if (this.activeLease?.status === "frozen") phase = "frozen";
    else if (this.activeLease) phase = "relocating";
    else if (this.error || !this.connected) phase = this.unsubscribeRealtime ? "offline" : "idle";
    else if (!this.scene || this.syncPromise) phase = "connecting";
    else if (!this.isIdle()) phase = "saving";
    else phase = "ready";
    return {
      phase,
      connected: this.connected,
      headSeq: this.headSeq,
      writeFrozen: this.activeLease !== null,
      pendingMutationCount:
        (this.pending ? 1 : 0) + (this.inFlight ? 1 : 0) + this.recovered.length,
      ...(this.inFlight
        ? { inFlightMutationId: this.inFlight.intent.mutationId }
        : {}),
      ...(this.error ? { error: this.error } : {}),
      ...(this.activeLease
        ? {
            relocationLease: {
              leaseId: this.activeLease.leaseId,
              status: this.activeLease.status,
              deadlineAt: this.activeLease.deadlineAt,
            },
          }
        : {}),
    };
  }

  private refreshStatus(): void {
    this.status = this.buildStatus();
    this.listeners.forEach((listener) => listener());
  }
}
