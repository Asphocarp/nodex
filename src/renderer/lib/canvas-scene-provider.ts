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
  type CanvasSceneSyncRequest,
  type CanvasSceneSyncResponse,
  type PortableCanvasScene,
} from "../../shared/block-documents";
import type { CanvasSceneOutbox } from "./canvas-scene-outbox";

export type CanvasSceneSyncCommandResult =
  | { readonly ok: true; readonly value: CanvasSceneSyncResponse }
  | { readonly ok: false; readonly error: CanvasSceneMutationError };

export interface CanvasSceneSyncAdapter {
  subscribe: (
    request: Pick<CanvasSceneSyncRequest, "projectId" | "documentId" | "clientSessionId">,
    listener: (event: CanvasSceneRealtimeEvent) => void,
  ) => () => void;
  sync: (request: CanvasSceneSyncRequest) => Promise<CanvasSceneSyncCommandResult>;
  applyMutation: (
    request: CanvasSceneMutationRequest,
  ) => Promise<CanvasSceneMutationCommandResult>;
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
  readonly inFlightMutationId?: string;
  readonly error?: CanvasSceneMutationError;
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
  private readonly createMutationId: () => string;

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
  private status: CanvasSceneProviderStatus;

  constructor(options: CanvasSceneProviderOptions) {
    this.options = options;
    this.coalesceDelayMs = options.coalesceDelayMs ?? 150;
    this.schedule = options.schedule ?? defaultScheduler;
    this.scheduleRetry = options.scheduleRetry ?? defaultScheduler;
    this.createMutationId = options.createMutationId ?? createFallbackMutationId;
    this.status = this.buildStatus();
  }

  getStatus = (): CanvasSceneProviderStatus => this.status;

  getScene = (): PortableCanvasScene | null => this.scene;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
      return this.syncPromise;
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
    this.storeEpoch = response.storeEpoch;
    this.generation = response.generation;
    this.headSeq = response.headSeq;
    this.scene = parsePortableCanvasScene(response.scene);
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
    await this.options.outbox.remove(
      current.request.documentId,
      current.request.mutationId,
    );
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

  private handleCommandError(error: CanvasSceneMutationError): void {
    if (error.resetRequired) {
      void this.options.outbox.clear(this.options.documentId);
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
    else if (this.error || !this.connected) phase = this.unsubscribeRealtime ? "offline" : "idle";
    else if (!this.scene || this.syncPromise) phase = "connecting";
    else if (!this.isIdle()) phase = "saving";
    else phase = "ready";
    return {
      phase,
      connected: this.connected,
      headSeq: this.headSeq,
      pendingMutationCount:
        (this.pending ? 1 : 0) + (this.inFlight ? 1 : 0) + this.recovered.length,
      ...(this.inFlight
        ? { inFlightMutationId: this.inFlight.request.mutationId }
        : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  private refreshStatus(): void {
    this.status = this.buildStatus();
    this.listeners.forEach((listener) => listener());
  }
}
