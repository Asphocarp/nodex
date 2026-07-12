import {
  CANVAS_SCENE_SYNC_VERSION,
  canonicalStringifyCanvasScene,
  canonicalizeCanvasSceneMutationRequest,
  chooseCanvasSceneElementWinner,
  materializePortableCanvasScene,
  parsePortableCanvasScene,
  type CanvasSceneAppStateIntent,
  type CanvasSceneAppStateIntents,
  type CanvasSceneCommittedEvent,
  type CanvasSceneElement,
  type CanvasSceneFile,
  type CanvasSceneMutationCommandResult,
  type CanvasSceneMutationError,
  type CanvasSceneMutationRequest,
  type CanvasSceneRealtimeEvent,
  type CanvasSceneSyncCommandResult,
  type CanvasSceneSyncRequest,
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
  ) => () => void;
  sync: (request: CanvasSceneSyncRequest) => Promise<CanvasSceneSyncCommandResult>;
  applyMutation: (
    request: CanvasSceneMutationRequest,
  ) => Promise<CanvasSceneMutationCommandResult>;
  respondToRelocationLease?: (
    request: DocumentRelocationLeaseResponseRequest,
  ) => Promise<DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>>;
}

export interface CanvasSceneObservation {
  readonly elementCandidates: readonly CanvasSceneElement[];
  readonly appStateIntents?: CanvasSceneAppStateIntents;
  readonly fileAdditions?: Readonly<Record<string, CanvasSceneFile>>;
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
  readonly createMutationId?: () => string;
  readonly coalesceDelayMs?: number;
  readonly schedule?: CanvasSceneProviderScheduler;
  readonly scheduleRetry?: CanvasSceneProviderScheduler;
  readonly now?: () => number;
  readonly scheduleLeaseDeadline?: CanvasSceneProviderScheduler;
}

interface ObservationWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

interface PendingObservation {
  readonly elementCandidates: readonly CanvasSceneElement[];
  readonly appStateIntents: CanvasSceneAppStateIntents;
  readonly fileAdditions: Readonly<Record<string, CanvasSceneFile>>;
  readonly waiters: readonly ObservationWaiter[];
}

interface InFlightMutation {
  readonly request: CanvasSceneMutationRequest;
  readonly waiters: readonly ObservationWaiter[];
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

const applyCommittedEvent = (
  current: PortableCanvasScene,
  event: CanvasSceneCommittedEvent,
): PortableCanvasScene => {
  const elements = new Map(
    current.elements.map((element) => [element.id as string, element]),
  );
  for (const update of event.elementUpdates) {
    const id = update.id as string;
    const existing = elements.get(id);
    elements.set(
      id,
      existing ? chooseCanvasSceneElementWinner(existing, update) : update,
    );
  }
  const files: Record<string, CanvasSceneFile> = {
    ...current.files,
    ...event.fileAdditions,
  };
  for (const fileId of event.removedFileIds) delete files[fileId];
  return materializePortableCanvasScene({
    elements: [...elements.values()],
    appState: event.appState,
    files,
  });
};

let fallbackMutationSequence = 0;
const createFallbackMutationId = (): string => {
  fallbackMutationSequence += 1;
  return `canvas-mutation:${Date.now().toString(36)}:${fallbackMutationSequence.toString(36)}`;
};

export class CanvasSceneProvider {
  private readonly options: CanvasSceneProviderOptions;
  private readonly listeners = new Set<() => void>();
  private readonly flushWaiters = new Set<ObservationWaiter>();
  private readonly coalesceDelayMs: number;
  private readonly schedule: CanvasSceneProviderScheduler;
  private readonly scheduleRetry: CanvasSceneProviderScheduler;
  private readonly scheduleLeaseDeadline: CanvasSceneProviderScheduler;
  private readonly createMutationId: () => string;
  private readonly now: () => number;
  private readonly writeLeasePreparers = new Set<CanvasSceneWriteLeasePreparer>();

  private unsubscribeRealtime: (() => void) | null = null;
  private cancelCoalesce: (() => void) | null = null;
  private cancelRetry: (() => void) | null = null;
  private connectPromise: Promise<void> | null = null;
  private syncPromise: Promise<void> | null = null;
  private syncAgain = false;
  private outboxHydrated = false;
  private scene: PortableCanvasScene | null = null;
  private storeEpoch: string | null = null;
  private generation: number | null = null;
  private headSeq = 0;
  private pending: PendingObservation | null = null;
  private recovered: CanvasSceneMutationRequest[] = [];
  private inFlight: InFlightMutation | null = null;
  private connected = false;
  private closing = false;
  private closed = false;
  private error: CanvasSceneMutationError | undefined;
  private activeLease: ActiveCanvasSceneLease | null = null;
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
    this.now = options.now ?? Date.now;
    this.status = this.buildStatus();
  }

  getStatus = (): CanvasSceneProviderStatus => this.status;

  getScene = (): PortableCanvasScene | null => this.scene;

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

  submit = (observation: CanvasSceneObservation): Promise<void> => {
    if (this.closed || this.closing) {
      return Promise.reject(new Error("Canvas scene provider is closed"));
    }
    if (this.error && !this.error.retryable) {
      return Promise.reject(new Error(this.error.message));
    }
    if (this.activeLease && !this.runningLeasePreparers) {
      return Promise.reject(new Error("Canvas scene is frozen by a Document write lease"));
    }
    return new Promise<void>((resolve, reject) => {
      try {
        this.pending = mergeObservations(this.pending, {
          elementCandidates: observation.elementCandidates,
          appStateIntents: observation.appStateIntents ?? {},
          fileAdditions: observation.fileAdditions ?? {},
          waiters: [{ resolve, reject }],
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.schedulePending();
      this.refreshStatus();
    });
  };

  flush = async (): Promise<void> => {
    if (this.closed) throw new Error("Canvas scene provider is closed");
    this.cancelCoalesce?.();
    this.cancelCoalesce = null;
    await this.connect();
    this.pump();
    if (this.isIdle()) return;
    await new Promise<void>((resolve, reject) => {
      this.flushWaiters.add({ resolve, reject });
    });
  };

  close = async (): Promise<void> => {
    if (this.closed) return;
    try {
      await this.flush();
    } finally {
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
      this.connected = false;
      this.closed = true;
      this.closing = false;
      this.refreshStatus();
      this.listeners.clear();
    }
  };

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
        (request) =>
          request.projectId !== this.options.projectId
          || request.storeEpoch !== this.storeEpoch
          || request.generation !== this.generation,
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
    let result: CanvasSceneSyncCommandResult;
    try {
      result = await this.options.adapter.sync({
        version: CANVAS_SCENE_SYNC_VERSION,
        projectId: this.options.projectId,
        documentId: this.options.documentId,
        clientSessionId: this.options.clientSessionId,
        ...(this.storeEpoch ? { knownStoreEpoch: this.storeEpoch } : {}),
        ...(this.generation === null ? {} : { knownGeneration: this.generation }),
        ...(this.scene ? { knownHeadSeq: this.headSeq } : {}),
      });
    } catch (error) {
      this.handleRetryableError(transportError(error));
      return;
    }
    if (!result.ok) {
      this.handleCommandError(result.error);
      return;
    }
    const response = result.value;
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
    if (response.headSeq < this.headSeq) return;
    this.storeEpoch = response.storeEpoch;
    this.generation = response.generation;
    this.headSeq = response.headSeq;
    this.scene = scene;
    this.error = undefined;
    this.connected = true;
    this.options.onScene(this.scene);
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
      || this.error
      || !this.connected
      || !this.scene
      || this.syncPromise
      || this.inFlight
      || this.activeLease?.status === "frozen"
    ) {
      this.refreshStatus();
      return;
    }
    const recovered = this.recovered.shift();
    if (recovered) {
      this.inFlight = { request: recovered, waiters: [] };
      this.refreshStatus();
      void this.sendInFlight();
      return;
    }
    if (!this.pending || this.cancelCoalesce) {
      this.resolveFlushWaitersIfIdle();
      this.refreshStatus();
      return;
    }
    const pending = this.pending;
    this.pending = null;
    let request: CanvasSceneMutationRequest;
    try {
      request = canonicalizeCanvasSceneMutationRequest({
        version: CANVAS_SCENE_SYNC_VERSION,
        mutationId: this.createMutationId(),
        projectId: this.options.projectId,
        documentId: this.options.documentId,
        storeEpoch: this.storeEpoch,
        generation: this.generation,
        baseHeadSeq: this.headSeq,
        clientSessionId: this.options.clientSessionId,
        elementCandidates: pending.elementCandidates,
        appStateIntents: pending.appStateIntents,
        fileAdditions: pending.fileAdditions,
      });
    } catch (error) {
      pending.waiters.forEach((waiter) => waiter.reject(
        error instanceof Error ? error : new Error(String(error)),
      ));
      this.pump();
      return;
    }
    this.inFlight = { request, waiters: pending.waiters };
    this.refreshStatus();
    void this.persistAndSendInFlight();
  }

  private async persistAndSendInFlight(): Promise<void> {
    const current = this.inFlight;
    if (!current) return;
    try {
      await this.options.outbox.put(current.request);
    } catch (error) {
      if (this.inFlight !== current) return;
      this.enterFatal(
        `Could not persist Canvas mutation before send: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (this.inFlight === current) await this.sendInFlight();
  }

  private async sendInFlight(): Promise<void> {
    const current = this.inFlight;
    if (!current || this.closed || this.error) return;
    let result: CanvasSceneMutationCommandResult;
    try {
      result = await this.options.adapter.applyMutation(current.request);
    } catch (error) {
      if (this.inFlight === current) this.handleRetryableError(transportError(error));
      return;
    }
    if (this.inFlight !== current) return;
    if (!result.ok) {
      this.handleCommandError(result.error);
      return;
    }
    if (result.value.mutationId !== current.request.mutationId) {
      this.enterFatal("Canvas mutation ACK does not match its request");
      return;
    }
    if (
      result.value.version !== CANVAS_SCENE_SYNC_VERSION
      || result.value.projectId !== current.request.projectId
      || result.value.documentId !== current.request.documentId
      || result.value.storeEpoch !== current.request.storeEpoch
      || result.value.generation !== current.request.generation
      || result.value.baseHeadSeq !== current.request.baseHeadSeq
      || !Number.isSafeInteger(result.value.headSeq)
      || result.value.headSeq < result.value.baseHeadSeq
      || (result.value.outcome !== "committed" && result.value.outcome !== "no_change")
      || typeof result.value.duplicate !== "boolean"
      || typeof result.value.sceneHash !== "string"
      || !/^[a-f0-9]{64}$/u.test(result.value.sceneHash)
    ) {
      this.enterFatal("Canvas mutation ACK crossed its durable request boundary");
      return;
    }
    try {
      await this.options.outbox.remove(
        current.request.documentId,
        current.request.mutationId,
      );
    } catch (error) {
      if (this.inFlight === current) {
        this.handleRetryableError(transportError(error));
      }
      return;
    }
    this.inFlight = null;
    if (result.value.headSeq > this.headSeq) await this.requestSync();
    current.waiters.forEach((waiter) => waiter.resolve());
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
      this.scene = applyCommittedEvent(this.scene, event);
      this.headSeq = event.headSeq;
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
    this.cancelRetry = this.scheduleRetry(() => {
      this.cancelRetry = null;
      this.error = undefined;
      void this.connect().then(() => {
        if (this.inFlight) void this.sendInFlight();
        else this.pump();
      });
    }, 150);
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
    this.pending?.waiters.forEach((waiter) => waiter.reject(error));
    this.inFlight?.waiters.forEach((waiter) => waiter.reject(error));
    this.flushWaiters.forEach((waiter) => waiter.reject(error));
    this.pending = null;
    this.inFlight = null;
    this.flushWaiters.clear();
  }

  private isIdle(): boolean {
    return !this.pending
      && !this.inFlight
      && this.recovered.length === 0
      && !this.cancelCoalesce;
  }

  private resolveFlushWaitersIfIdle(): void {
    if (!this.isIdle()) return;
    this.flushWaiters.forEach((waiter) => waiter.resolve());
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
        ? { inFlightMutationId: this.inFlight.request.mutationId }
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
