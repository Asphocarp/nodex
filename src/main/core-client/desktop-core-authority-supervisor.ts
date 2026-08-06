import type { components } from "@nodex/core-protocol";

import type {
  ConnectOrStartCoreInput,
  CoreLaunchResult,
} from "./core-launcher";
import { connectOrStartCore } from "./core-launcher";
import type {
  AutomationApplyInput,
  AutomationCommittedValue,
  AutomationRead,
  AutomationReadSnapshot,
  BlockRecordApplyInput,
  BlockRecordCommittedValue,
  BlockRecordRead,
  BlockRecordReadAuthorization,
  BlockRecordReadSnapshot,
  CoreClientPort,
  CoreEventEnvelope,
  CoreEventReplayRequired,
  CoreEventSubscription,
  CoreHandshakeResponse,
  DatabaseApplyInput,
  DatabaseCommittedValue,
  DatabaseRead,
  DatabaseReadSnapshot,
  DocumentResyncRequired,
  LibraryApplyInput,
  LibraryCommittedValue,
  LibraryRead,
  LibraryReadSnapshot,
  OwnedDocumentApplyInput,
  OwnedDocumentCommittedValue,
  OwnedDocumentRead,
  OwnedDocumentReadSnapshot,
  ProjectWorkspaceApplyInput,
  ProjectWorkspaceCommittedValue,
  ProjectWorkspaceRead,
  ProjectWorkspaceReadSnapshot,
  StoreAdministrationApplyInput,
  StoreAdministrationCommittedValue,
  StoreAdministrationRead,
  StoreAdministrationReadSnapshot,
} from "./types";
import {
  CoreHttpError,
  isDefinitiveCoreGenerationLoss,
} from "./uds-http";
import type { ProjectionImpact } from "../../shared/projection-stream";
import type {
  DocumentAwarenessPublishAck,
  DocumentAwarenessPublishRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
} from "../../shared/block-documents/document-sync";
import type {
  CanvasSceneSyncRequest,
  CanvasSceneSyncResponse,
} from "../../shared/block-documents/canvas-scene-sync";

type HealthResponse = components["schemas"]["HealthResponse"];
type ShutdownResponse = components["schemas"]["ShutdownResponse"];

const FAILURE_WINDOW_MS = 60_000;
const MAX_FAILURES_PER_WINDOW = 3;

export interface DesktopCoreClient extends CoreClientPort {
  readonly handshake: CoreHandshakeResponse;
  shutdown(): Promise<ShutdownResponse>;
}

export interface CoreGenerationClient extends CoreClientPort {
  readonly handshake: CoreHandshakeResponse;
  forProject(projectId: string): CoreGenerationClient;
  health(): Promise<HealthResponse>;
  shutdown(): Promise<ShutdownResponse>;
}

export interface CoreGenerationLaunch
  extends Omit<CoreLaunchResult, "client"> {
  readonly client: CoreGenerationClient;
}

export interface CoreAuthorityIdentity {
  readonly libraryId: string;
  readonly profileId: string;
  readonly storeEpoch: string;
}

export type CoreAuthorityState =
  | {
    readonly generation: CoreHandshakeResponse["generation"];
    readonly kind: "ready";
  }
  | {
    readonly attempt: number;
    readonly kind: "recovering";
    readonly previousGeneration: CoreHandshakeResponse["generation"];
  }
  | {
    readonly circuitOpen: boolean;
    readonly error: unknown;
    readonly kind: "unavailable";
  }
  | { readonly kind: "stopped" };

export class CoreAuthorityUnavailableError extends Error {
  constructor(
    message: string,
    readonly authorityState: Extract<CoreAuthorityState, { kind: "unavailable" | "stopped" }>,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "CoreAuthorityUnavailableError";
  }
}

interface CoreGenerationSession {
  readonly clients: Map<string, CoreGenerationClient>;
  readonly launch: CoreGenerationLaunch;
  readonly rootClient: CoreGenerationClient;
}

export interface DesktopCoreAuthoritySupervisorDependencies {
  readonly launch?: (
    input: ConnectOrStartCoreInput,
  ) => Promise<CoreGenerationLaunch>;
  readonly now?: () => number;
}

export interface CreateDesktopCoreAuthoritySupervisorInput {
  readonly initialLaunch: CoreGenerationLaunch;
  readonly launchInput: ConnectOrStartCoreInput;
  readonly dependencies?: DesktopCoreAuthoritySupervisorDependencies;
}

const createSession = (launch: CoreGenerationLaunch): CoreGenerationSession => ({
  clients: new Map<string, CoreGenerationClient>(),
  launch,
  rootClient: launch.client,
});

const shouldRecoverAuthority = (error: unknown): boolean =>
  isDefinitiveCoreGenerationLoss(error)
  || (error instanceof CoreHttpError && error.status === 503);

export class DesktopCoreAuthoritySupervisor {
  readonly identity: CoreAuthorityIdentity;
  readonly initialLaunch: CoreGenerationLaunch;
  readonly rootClient: DesktopCoreClient;

  readonly #launch: (
    input: ConnectOrStartCoreInput,
  ) => Promise<CoreGenerationLaunch>;
  readonly #launchInput: ConnectOrStartCoreInput;
  readonly #now: () => number;
  readonly #projectClients = new Map<string, DesktopCoreClient>();
  readonly #listeners = new Set<(state: CoreAuthorityState) => void>();
  #lostSessions = new WeakSet<CoreGenerationSession>();
  #failureTimestamps: number[] = [];
  #lifecycleEpoch = 0;
  #recoveryAttempt = 0;
  #recovery: Promise<CoreGenerationSession> | null = null;
  #session: CoreGenerationSession;
  #state: CoreAuthorityState;
  #stopped = false;

  constructor(input: CreateDesktopCoreAuthoritySupervisorInput) {
    this.initialLaunch = input.initialLaunch;
    this.#session = createSession(input.initialLaunch);
    this.#launchInput = input.launchInput;
    this.#launch = input.dependencies?.launch ?? connectOrStartCore;
    this.#now = input.dependencies?.now ?? Date.now;
    this.identity = {
      libraryId: input.initialLaunch.client.handshake.library_id,
      profileId: input.initialLaunch.client.handshake.generation.profile_id,
      storeEpoch: input.initialLaunch.client.handshake.store_epoch,
    };
    this.#state = {
      generation: input.initialLaunch.client.handshake.generation,
      kind: "ready",
    };
    this.rootClient = new SupervisedCoreClient(this, null);
  }

  get state(): CoreAuthorityState {
    return this.#state;
  }

  clientForProject(projectId: string): DesktopCoreClient {
    const normalized = projectId.trim();
    if (!normalized || normalized !== projectId || normalized.length > 512) {
      throw new Error("Core Project binding is invalid");
    }
    const existing = this.#projectClients.get(normalized);
    if (existing) return existing;
    const client = new SupervisedCoreClient(this, normalized);
    this.#projectClients.set(normalized, client);
    return client;
  }

  subscribe(listener: (state: CoreAuthorityState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async retryNow(): Promise<void> {
    if (this.#stopped) throw this.#unavailableError();
    this.#failureTimestamps = [];
    this.#lostSessions = new WeakSet<CoreGenerationSession>();
    await this.#recover(this.#session, new Error("Core recovery was requested"), true);
  }

  close(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#lifecycleEpoch += 1;
    this.#publish({ kind: "stopped" });
  }

  currentHandshake(): CoreHandshakeResponse {
    return this.#session.rootClient.handshake;
  }

  shutdownCurrentGeneration(): Promise<ShutdownResponse> {
    return this.#session.rootClient.shutdown();
  }

  async execute<Result>(
    projectId: string | null,
    operation: (client: CoreGenerationClient) => Promise<Result>,
    replayAfterRecovery = true,
  ): Promise<Result> {
    if (this.#stopped) throw this.#unavailableError();
    const failedSession = this.#session;
    try {
      return await operation(this.#clientForSession(failedSession, projectId));
    } catch (error) {
      if (!shouldRecoverAuthority(error)) throw error;
      const recoveredSession = await this.#recover(failedSession, error);
      if (!replayAfterRecovery) throw error;
      this.#assertRunning(error);
      const replaySession = this.#session === recoveredSession
        ? recoveredSession
        : this.#session;
      return await operation(this.#clientForSession(replaySession, projectId));
    }
  }

  #clientForSession(
    session: CoreGenerationSession,
    projectId: string | null,
  ): CoreGenerationClient {
    if (projectId === null) return session.rootClient;
    const existing = session.clients.get(projectId);
    if (existing) return existing;
    const client = session.rootClient.forProject(projectId);
    session.clients.set(projectId, client);
    return client;
  }

  async #recover(
    failedSession: CoreGenerationSession,
    error: unknown,
    force = false,
  ): Promise<CoreGenerationSession> {
    if (this.#stopped) throw this.#unavailableError(error);
    if (this.#recovery) return await this.#recovery;
    if (!force && this.#session !== failedSession) return this.#session;

    this.#recordSessionLoss(failedSession, error);
    if (this.#circuitOpen()) {
      const unavailable = {
        circuitOpen: true,
        error,
        kind: "unavailable",
      } as const;
      this.#publish(unavailable);
      throw new CoreAuthorityUnavailableError(
        "Native Core recovery paused after repeated failures",
        unavailable,
        error,
      );
    }

    this.#recoveryAttempt += 1;
    this.#publish({
      attempt: this.#recoveryAttempt,
      kind: "recovering",
      previousGeneration: failedSession.rootClient.handshake.generation,
    });
    const recoveryEpoch = this.#lifecycleEpoch;
    const recovery = Promise.resolve()
      .then(() => this.#launch(this.#launchInput))
      .then(async (launch) => {
        this.#assertRecoveryCurrent(recoveryEpoch);
        const health = await launch.client.health();
        this.#assertRecoveryCurrent(recoveryEpoch);
        this.#assertHealthyCandidate(launch.client, health);
        const session = createSession(launch);
        this.#session = session;
        this.#publish({
          generation: launch.client.handshake.generation,
          kind: "ready",
        });
        return session;
      })
      .catch((recoveryError: unknown) => {
        if (!this.#recoveryIsCurrent(recoveryEpoch)) {
          throw this.#unavailableError(recoveryError);
        }
        this.#recordFailure();
        const unavailable = {
          circuitOpen: this.#circuitOpen(),
          error: recoveryError,
          kind: "unavailable",
        } as const;
        this.#publish(unavailable);
        throw new CoreAuthorityUnavailableError(
          "Native Core could not be rebound",
          unavailable,
          recoveryError,
        );
      })
      .finally(() => {
        if (this.#recovery === recovery) this.#recovery = null;
      });
    this.#recovery = recovery;
    return await recovery;
  }

  #assertHealthyCandidate(
    client: CoreGenerationClient,
    health: HealthResponse,
  ): void {
    if (health.status !== "ready") {
      throw new Error(`Native Rust Core reported unexpected status ${health.status}`);
    }
    const handshake = client.handshake;
    if (handshake.generation.profile_id !== this.identity.profileId) {
      throw new Error("Recovered Core belongs to another Profile");
    }
    if (handshake.library_id !== this.identity.libraryId) {
      throw new Error("Recovered Core belongs to another Library");
    }
    if (handshake.store_epoch !== this.identity.storeEpoch) {
      throw new Error("Recovered Core belongs to another Store epoch");
    }
  }

  #recordSessionLoss(session: CoreGenerationSession, error: unknown): void {
    if (this.#lostSessions.has(session)) return;
    this.#lostSessions.add(session);
    this.#recordFailure();
    if (this.#circuitOpen()) {
      this.#publish({ circuitOpen: true, error, kind: "unavailable" });
    }
  }

  #recordFailure(): void {
    const cutoff = this.#now() - FAILURE_WINDOW_MS;
    this.#failureTimestamps = this.#failureTimestamps.filter(
      (timestamp) => timestamp >= cutoff,
    );
    this.#failureTimestamps.push(this.#now());
  }

  #circuitOpen(): boolean {
    const cutoff = this.#now() - FAILURE_WINDOW_MS;
    this.#failureTimestamps = this.#failureTimestamps.filter(
      (timestamp) => timestamp >= cutoff,
    );
    return this.#failureTimestamps.length >= MAX_FAILURES_PER_WINDOW;
  }

  #publish(state: CoreAuthorityState): void {
    if (this.#stopped && state.kind !== "stopped") return;
    this.#state = state;
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        // Authority observation must never interfere with recovery.
      }
    }
  }

  #assertRunning(cause?: unknown): void {
    if (!this.#stopped) return;
    throw this.#unavailableError(cause);
  }

  #recoveryIsCurrent(epoch: number): boolean {
    return !this.#stopped && this.#lifecycleEpoch === epoch;
  }

  #assertRecoveryCurrent(epoch: number): void {
    if (this.#recoveryIsCurrent(epoch)) return;
    throw this.#unavailableError();
  }

  #unavailableError(cause?: unknown): CoreAuthorityUnavailableError {
    const state = this.#state.kind === "unavailable" || this.#state.kind === "stopped"
      ? this.#state
      : ({ circuitOpen: false, error: cause, kind: "unavailable" } as const);
    return new CoreAuthorityUnavailableError(
      this.#stopped ? "Native Core authority is stopped" : "Native Core authority is unavailable",
      state,
      cause,
    );
  }
}

class SupervisedCoreClient implements DesktopCoreClient {
  constructor(
    private readonly supervisor: DesktopCoreAuthoritySupervisor,
    private readonly projectId: string | null,
  ) {}

  get handshake(): CoreHandshakeResponse {
    return this.supervisor.currentHandshake();
  }

  blockRecordRead(
    read: BlockRecordRead,
    agentAuthorization?: BlockRecordReadAuthorization,
  ): Promise<BlockRecordReadSnapshot> {
    return this.#execute((client) => client.blockRecordRead(read, agentAuthorization));
  }

  blockRecordApply(input: BlockRecordApplyInput): Promise<BlockRecordCommittedValue> {
    return this.#execute((client) => client.blockRecordApply(input));
  }

  openLocalCommitStream(
    after: number,
    onCommit: (commit: BlockRecordCommittedValue) => void,
    signal?: AbortSignal,
  ): Promise<CoreEventSubscription> {
    return this.#execute((client) => client.openLocalCommitStream(after, onCommit, signal));
  }

  libraryRead(read: LibraryRead): Promise<LibraryReadSnapshot> {
    return this.#execute((client) => client.libraryRead(read));
  }

  libraryApply(input: LibraryApplyInput): Promise<LibraryCommittedValue> {
    return this.#execute((client) => client.libraryApply(input));
  }

  filterProjectionImpactForProject(
    projectId: string,
    impact: ProjectionImpact,
  ): Promise<ProjectionImpact> {
    return this.#execute((client) =>
      client.filterProjectionImpactForProject(projectId, impact)
    );
  }

  databaseRead(read: DatabaseRead): Promise<DatabaseReadSnapshot> {
    return this.#execute((client) => client.databaseRead(read));
  }

  databaseApply(input: DatabaseApplyInput): Promise<DatabaseCommittedValue> {
    return this.#execute((client) => client.databaseApply(input));
  }

  workspaceRead(read: ProjectWorkspaceRead): Promise<ProjectWorkspaceReadSnapshot> {
    return this.#execute((client) => client.workspaceRead(read));
  }

  workspaceApply(
    input: ProjectWorkspaceApplyInput,
  ): Promise<ProjectWorkspaceCommittedValue> {
    return this.#execute((client) => client.workspaceApply(input));
  }

  automationRead(read: AutomationRead): Promise<AutomationReadSnapshot> {
    return this.#execute((client) => client.automationRead(read));
  }

  automationApply(input: AutomationApplyInput): Promise<AutomationCommittedValue> {
    return this.#execute((client) => client.automationApply(input));
  }

  administrationRead(
    read: StoreAdministrationRead,
  ): Promise<StoreAdministrationReadSnapshot> {
    return this.#execute((client) => client.administrationRead(read));
  }

  administrationApply(
    input: StoreAdministrationApplyInput,
  ): Promise<StoreAdministrationCommittedValue> {
    return this.#execute((client) => client.administrationApply(input));
  }

  documentRead(
    clientSessionId: string,
    read: OwnedDocumentRead,
  ): Promise<OwnedDocumentReadSnapshot> {
    return this.#execute((client) => client.documentRead(clientSessionId, read));
  }

  documentApply(input: OwnedDocumentApplyInput): Promise<OwnedDocumentCommittedValue> {
    return this.#execute((client) => client.documentApply(input));
  }

  documentSync(input: DocumentSyncRequest): Promise<DocumentSyncResponse> {
    return this.#execute((client) => client.documentSync(input));
  }

  documentCanvasSync(input: CanvasSceneSyncRequest): Promise<CanvasSceneSyncResponse> {
    return this.#execute((client) => client.documentCanvasSync(input));
  }

  documentApplyUpdate(input: DocumentSyncApplyRequest): Promise<DocumentSyncApplyAck> {
    return this.#execute((client) => client.documentApplyUpdate(input));
  }

  documentPublishAwareness(
    input: DocumentAwarenessPublishRequest,
  ): Promise<DocumentAwarenessPublishAck> {
    return this.supervisor.execute(
      this.projectId,
      (client) => client.documentPublishAwareness(input),
      false,
    );
  }

  openDocumentEventStream(
    input: {
      readonly documentId: string;
      readonly clientSessionId: string;
      readonly after: number;
      readonly signal?: AbortSignal;
    },
    onEvent: (event: CoreEventEnvelope) => void,
    onResyncRequired: (event: DocumentResyncRequired) => void,
    onRealtimeEvent: (event: DocumentSyncRealtimeEvent) => void,
  ): Promise<CoreEventSubscription> {
    return this.#execute((client) => client.openDocumentEventStream(
      input,
      onEvent,
      onResyncRequired,
      onRealtimeEvent,
    ));
  }

  openEventStream(
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
    onResyncRequired?: (event: CoreEventReplayRequired) => void,
    signal?: AbortSignal,
  ): Promise<CoreEventSubscription> {
    return this.#execute((client) => client.openEventStream(
      after,
      onEvent,
      onResyncRequired,
      signal,
    ));
  }

  shutdown(): Promise<ShutdownResponse> {
    return this.supervisor.shutdownCurrentGeneration();
  }

  #execute<Result>(
    operation: (client: CoreGenerationClient) => Promise<Result>,
  ): Promise<Result> {
    return this.supervisor.execute(this.projectId, operation);
  }
}
