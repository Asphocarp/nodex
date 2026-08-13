import { createHash } from "node:crypto";

import {
  revocationsFromVisibilityDelta,
} from "../../shared/local-commit-delivery";
import type { ResourceRevocation } from "../../shared/resource-revocation-stream";

import type {
  AdditionalDocumentCommandRequest,
  AdditionalDocumentCommandResult,
} from "../../shared/additional-document-commands";
import type {
  CreateDocumentVersionCheckpoint,
  CreatedDocumentVersionSummary,
  DocumentVersionDetail,
  DocumentVersionSummary,
  GetDocumentVersion,
  ListDocumentVersions,
  PrepareDocumentVersionRestore,
} from "../../shared/block-documents/document-history";
import type {
  DocumentHistoryCommandResult,
} from "../../shared/block-documents/document-history-transport";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../../shared/block-documents/document-operations";
import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
} from "../../shared/block-transfer";
import { documentMutationFailure } from "../../shared/block-documents/document-operation-transport";
import type {
  CanvasSceneMutationCommandResult,
  CanvasSceneMutationError,
  CanvasSceneMutationRequest,
  CanvasSceneRealtimeEvent,
  CanvasSceneSubscribeRequest,
  CanvasSceneSubscriptionCommandResult,
  CanvasSceneSyncCommandResult,
  CanvasSceneSyncRequest,
} from "../../shared/block-documents/canvas-scene-sync";
import type {
  CanvasSceneCompactionCommandResult,
  CanvasSceneCompactionReadCommandResult,
  CanvasSceneCompactionReadRequest,
  CanvasSceneCompactionRequest,
} from "../../shared/block-documents/canvas-scene-maintenance";
import {
  requireLibraryOwnedDocumentDescriptor,
  requireProjectOwnedDocumentDescriptor,
  type LibraryOwnedDocumentDescriptor,
  type ProjectOwnedDocumentDescriptor,
} from "../../shared/block-documents/contracts";
import type {
  ExecuteNodexAgentCreatePagesResult,
  ExecuteNodexAgentDuplicatePageResult,
  ExecuteNodexAgentMovePagesResult,
} from "../../shared/nodex-agent-tools";
import type {
  DocumentAwarenessPublishAck,
  DocumentAwarenessPublishRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandResult,
  DocumentSyncRequest,
  DocumentSyncRealtimeEvent,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
  DocumentSyncSubscriptionAck,
  DocumentSyncUnsubscribeAck,
} from "../../shared/block-documents/document-sync";
import {
  documentSyncUnauthorized,
  type DocumentSyncClientTarget,
} from "../document-sync-transport";
import {
  createCanvasPresenceHub,
  type CanvasPresenceHub,
} from "../canvas-presence-hub";
import { safeSendToWebContents } from "../ipc-safe-send";
import {
  canonicalizeCanvasPresencePublishRequest,
  type CanvasPresenceCommandErrorCode,
  type CanvasPresenceCommandResult,
  type CanvasPresencePublishRequest,
} from "../../shared/block-documents/document-presence";
import { decodeCanvasSceneSseEvent } from "../../shared/block-documents/canvas-scene-http-contract";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import {
  contentAccessContextKey,
  type ContentAccessContext,
} from "../../shared/content-access-context";
import {
  createCoreCanvasSceneAdapter,
  type CoreCanvasSceneAdapter,
} from "./core-canvas-scene-adapter";
import {
  createCoreBlockTransferAdapter,
  type CoreBlockTransferAdapter,
} from "./block-transfer-adapter";
import { createCoreDocumentSyncAdapter } from "./document-sync-adapter";
import type { CoreDocumentSyncAdapter } from "./document-sync-adapter";
import {
  resolveAuthorizedDocumentEffect,
  resolveInlineAuthorizedDocumentEffect,
} from "./document-effect-delivery";
import type { CoreAuthorizedDeliveryPacket } from "./types";

const DOCUMENT_SYNC_EVENT_CHANNEL = "document-sync:event";

export type DesktopDocumentSyncScope = ContentAccessContext;

type NativeNodexAgentMutationResult =
  | ExecuteNodexAgentCreatePagesResult
  | ExecuteNodexAgentDuplicatePageResult
  | ExecuteNodexAgentMovePagesResult;

export interface NativeNodexAgentMutationExecution<
  Result extends NativeNodexAgentMutationResult,
> {
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly execute: () => Promise<Result>;
  readonly failure: (
    message: string,
    recovery?: "get_block_again" | "none",
  ) => Result;
  readonly operationLabel: string;
  readonly conflictMessage: string;
}

export interface DesktopDocumentSyncPort {
  /** Publishes exact Document effects to already-authorized active sessions. */
  publishDocumentEffects(
    packet: CoreAuthorizedDeliveryPacket,
    documentId?: string,
  ): void;
  /** Closes only sessions addressed by one Core-authored revocation. */
  publishResourceRevocation(
    packet: CoreAuthorizedDeliveryPacket,
    revocation: ResourceRevocation,
  ): void;
  getOwnedDocumentDescriptor(
    projectId: string,
    ownerBlockId: string,
  ): Promise<ProjectOwnedDocumentDescriptor>;
  prepareOwnedBlockDocument(
    projectId: string,
    ownerBlockId: string,
  ): Promise<DocumentSyncCommandResult<ProjectOwnedDocumentDescriptor>>;
  prepareLibraryOwnedBlockDocument(
    ownerBlockId: string,
  ): Promise<DocumentSyncCommandResult<LibraryOwnedDocumentDescriptor>>;
  subscribe(
    scope: DesktopDocumentSyncScope,
    target: DocumentSyncClientTarget,
    request: DocumentSyncSubscribeRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncSubscriptionAck>>;
  unsubscribe(
    scope: DesktopDocumentSyncScope,
    target: DocumentSyncClientTarget,
    request: DocumentSyncSubscribeRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncUnsubscribeAck>>;
  sync(
    scope: DesktopDocumentSyncScope,
    target: DocumentSyncClientTarget,
    request: DocumentSyncRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>>;
  applyUpdate(
    scope: DesktopDocumentSyncScope,
    target: DocumentSyncClientTarget,
    request: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>>;
  publishAwareness(
    scope: DesktopDocumentSyncScope,
    target: DocumentSyncClientTarget,
    request: DocumentAwarenessPublishRequest,
  ): Promise<DocumentSyncCommandResult<DocumentAwarenessPublishAck>>;
  subscribeCanvasScene(
    target: DocumentSyncClientTarget,
    request: CanvasSceneSubscribeRequest,
  ): Promise<CanvasSceneSubscriptionCommandResult>;
  unsubscribeCanvasScene(
    target: DocumentSyncClientTarget,
    request: CanvasSceneSubscribeRequest,
  ): Promise<CanvasSceneSubscriptionCommandResult>;
  syncCanvasScene(
    target: DocumentSyncClientTarget,
    request: CanvasSceneSyncRequest,
  ): Promise<CanvasSceneSyncCommandResult>;
  applyCanvasSceneMutation(
    target: DocumentSyncClientTarget,
    request: CanvasSceneMutationRequest,
  ): Promise<CanvasSceneMutationCommandResult>;
  publishCanvasPresence(
    target: DocumentSyncClientTarget,
    request: CanvasPresencePublishRequest,
  ): Promise<CanvasPresenceCommandResult>;
  readCanvasSceneCompaction(
    target: DocumentSyncClientTarget,
    request: CanvasSceneCompactionReadRequest,
  ): Promise<CanvasSceneCompactionReadCommandResult>;
  compactCanvasScene(
    target: DocumentSyncClientTarget,
    request: CanvasSceneCompactionRequest,
  ): Promise<CanvasSceneCompactionCommandResult>;
  applyAdditionalDocumentCommand(
    request: AdditionalDocumentCommandRequest,
  ): Promise<AdditionalDocumentCommandResult>;
  createCheckpoint(
    request: CreateDocumentVersionCheckpoint,
  ): Promise<DocumentHistoryCommandResult<CreatedDocumentVersionSummary>>;
  listVersions(
    request: ListDocumentVersions,
  ): Promise<DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>>;
  getVersion(
    request: GetDocumentVersion,
  ): Promise<DocumentHistoryCommandResult<DocumentVersionDetail>>;
  restoreVersion(
    request: PrepareDocumentVersionRestore,
  ): Promise<DocumentOperationCommandResult>;
  applyDocumentMutation(
    request: DocumentMutationRequest,
  ): Promise<DocumentOperationCommandResult>;
  transferBlocks(
    intent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult>;
  executeNodexAgentMutation<
    Result extends NativeNodexAgentMutationResult,
  >(options: NativeNodexAgentMutationExecution<Result>): Promise<Result>;
}

export interface DesktopDocumentSyncBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly canvasPresenceHub?: CanvasPresenceHub;
}

type OrderedDocumentRealtimeEvent = Extract<
  DocumentSyncRealtimeEvent,
  { readonly kind: "document-update" | "resync-required" }
>;

type PendingNativeRealtimeEvent =
  | {
      readonly engine: "yjs";
      readonly event: OrderedDocumentRealtimeEvent;
    }
  | {
      readonly engine: "canvas_scene";
      readonly event: CanvasSceneRealtimeEvent;
    };

const MAX_PENDING_REALTIME_EVENTS = 256;

interface NativeSubscription {
  readonly engine: "yjs" | "canvas_scene";
  readonly bindingKey: string;
  readonly scope: DesktopDocumentSyncScope;
  readonly libraryId?: string;
  readonly documentId: string;
  readonly clientSessionId: string;
  readonly target: DocumentSyncClientTarget;
  readonly targetId: number;
  readonly close: () => void;
  readonly pendingRealtimeEvents: Map<string, PendingNativeRealtimeEvent>;
  storeEpoch?: string;
  generation?: number;
  headSeq?: number;
}

interface PendingNativeSubscription {
  readonly targetId: number;
  readonly settled: Promise<void>;
  attachClose(close: () => void): void;
  cancel(): void;
  settle(): void;
}

type NativeSubscriptionReservation =
  | { readonly kind: "existing" }
  | { readonly kind: "conflict" }
  | { readonly kind: "target_destroyed" }
  | {
      readonly kind: "reserved";
      readonly pending: PendingNativeSubscription;
    };

const scopeKey = (scope: DesktopDocumentSyncScope): string =>
  contentAccessContextKey(scope);

const authorizationScopeMatchesDocumentScope = (
  authorization: CoreAuthorizedDeliveryPacket["authorization_scope"],
  scope: DesktopDocumentSyncScope,
): boolean => {
  if (authorization.kind === "library") return scope.kind === "library";
  const projectId = authorization.project_id ?? null;
  if (projectId === null) return scope.kind === "library";
  return scope.kind === "project" && scope.projectId === projectId;
};

const packetRevokesDocumentScope = (
  packet: CoreAuthorizedDeliveryPacket,
  documentId: string,
  scope: DesktopDocumentSyncScope,
): boolean => packet.visibility_deltas
  .flatMap(revocationsFromVisibilityDelta)
  .some((revocation) =>
  revocation.resource_kind === "document"
  && revocation.resource_id === documentId
  && authorizationScopeMatchesDocumentScope(
    revocation.authorization_scope,
    scope,
  )
);

const subscriptionKey = (
  target: DocumentSyncClientTarget,
  scope: DesktopDocumentSyncScope,
  request: DocumentSyncSubscribeRequest,
): string => JSON.stringify([
  "yjs",
  target.id,
  scopeKey(scope),
  request.clientSessionId,
  request.documentId,
]);

const canvasSceneSubscriptionKey = (
  target: DocumentSyncClientTarget,
  request: CanvasSceneSubscribeRequest,
): string => JSON.stringify([
  "canvas_scene",
  target.id,
  contentAccessContextKey(request.accessContext),
  request.clientSessionId,
  request.documentId,
]);

const bindingKey = (
  request: Pick<DocumentSyncSubscribeRequest, "clientSessionId">,
): string => request.clientSessionId;

const ownerCommandIdentity = (
  scope: DesktopDocumentSyncScope,
  ownerBlockId: string,
  storeEpoch: string,
  connectionBinding: string,
): { readonly clientSessionId: string; readonly operationId: string } => {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([
      scopeKey(scope),
      ownerBlockId,
      storeEpoch,
      connectionBinding,
    ]))
    .digest("hex");
  return {
    clientSessionId: "electron:owned-document:prepare",
    operationId: `electron:prepare-owner:${fingerprint}`,
  };
};

const transportUnavailable = <Value>(
  error: unknown,
): DocumentSyncCommandResult<Value> => ({
  ok: false,
  error: {
    code: "transport_unavailable",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    resetRequired: false,
  },
});

type CanvasCommandResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: CanvasSceneMutationError };

type CanvasCommandFailure = Extract<CanvasCommandResult<never>, { readonly ok: false }>;

const canvasSceneFailure = (
  code: CanvasSceneMutationError["code"],
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly mutationId?: string;
  } = {},
): CanvasCommandFailure => ({
  ok: false,
  error: {
    code,
    message,
    retryable: options.retryable ?? false,
    resetRequired: false,
    ...(options.mutationId ? { mutationId: options.mutationId } : {}),
  },
});

const canvasSceneUnauthorized = (
  mutationId?: string,
): CanvasCommandFailure => canvasSceneFailure(
  "access_scope_mismatch",
  "An exact Canvas scene subscription is required",
  { mutationId },
);

const canvasSceneTransportUnavailable = (
  error: unknown,
  mutationId?: string,
): CanvasCommandFailure => canvasSceneFailure(
  "unknown",
  error instanceof Error ? error.message : String(error),
  { retryable: true, mutationId },
);

const canvasPresenceFailure = (
  code: CanvasPresenceCommandErrorCode,
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly resetRequired?: boolean;
  } = {},
): CanvasPresenceCommandResult => ({
  ok: false,
  error: {
    code,
    message,
    retryable: options.retryable ?? false,
    resetRequired: options.resetRequired ?? false,
  },
});

const hasCanvasSceneIdentity = (
  request: CanvasSceneSubscribeRequest,
): boolean => {
  if (
    request?.version !== 1
    || typeof request.documentId !== "string"
    || request.documentId.length === 0
    || request.documentId.length > 512
    || request.documentId.trim() !== request.documentId
    || typeof request.clientSessionId !== "string"
    || request.clientSessionId.length === 0
    || request.clientSessionId.length > 512
    || request.clientSessionId.trim() !== request.clientSessionId
  ) {
    return false;
  }
  try {
    contentAccessContextKey(request.accessContext);
    return true;
  } catch {
    return false;
  }
};

export function createDesktopDocumentSyncBridge(
  input: DesktopDocumentSyncBridgeInput,
): DesktopDocumentSyncPort {
  const adapters = new Map<string, CoreDocumentSyncAdapter>();
  const canvasSceneAdapters = new Map<string, CoreCanvasSceneAdapter>();
  const blockTransferAdapters = new Map<string, CoreBlockTransferAdapter>();
  const subscriptions = new Map<string, NativeSubscription>();
  const deliveredCommitKeys = new Map<string, Set<string>>();
  const bindings = new Map<string, string>();
  const pendingSubscriptions = new Map<string, PendingNativeSubscription>();
  const boundTargets = new Set<number>();
  const canvasPresenceHub =
    input.canvasPresenceHub ?? createCanvasPresenceHub();

  const adapterFor = (
    runtime: Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>,
    scope: DesktopDocumentSyncScope,
  ): CoreDocumentSyncAdapter => {
    const key = scopeKey(scope);
    let adapter = adapters.get(key);
    if (adapter) return adapter;
    adapter = createCoreDocumentSyncAdapter(
      scope.kind === "project"
        ? runtime.clientForProject(scope.projectId)
        : runtime.rootClient,
    );
    adapters.set(key, adapter);
    return adapter;
  };

  const canvasSceneAdapterFor = (
    runtime: Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>,
    accessContext: ContentAccessContext,
  ): CoreCanvasSceneAdapter => {
    const key = contentAccessContextKey(accessContext);
    let adapter = canvasSceneAdapters.get(key);
    if (adapter) return adapter;
    adapter = createCoreCanvasSceneAdapter(
      accessContext.kind === "project"
        ? runtime.clientForProject(accessContext.projectId)
        : runtime.rootClient,
      {
        libraryId: runtime.identity.libraryId,
        accessContext,
      },
    );
    canvasSceneAdapters.set(key, adapter);
    return adapter;
  };

  const blockTransferAdapterFor = (
    runtime: Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>,
    projectId: string,
  ): CoreBlockTransferAdapter => {
    let adapter = blockTransferAdapters.get(projectId);
    if (adapter) return adapter;
    adapter = createCoreBlockTransferAdapter({
      client: runtime.clientForProject(projectId),
      libraryId: runtime.identity.libraryId,
      projectId,
      storeEpoch: runtime.identity.storeEpoch,
    });
    blockTransferAdapters.set(projectId, adapter);
    return adapter;
  };

  const closeSubscription = (key: string): void => {
    const subscription = subscriptions.get(key);
    if (!subscription) return;
    if (subscription.engine === "canvas_scene") {
      canvasPresenceHub.unregister(key);
    }
    subscriptions.delete(key);
    deliveredCommitKeys.delete(key);
    subscription.pendingRealtimeEvents.clear();
    if (bindings.get(subscription.bindingKey) === key) {
      bindings.delete(subscription.bindingKey);
    }
    subscription.close();
  };

  const rememberDeliveredCommit = (key: string, identity: string): void => {
    const delivered = deliveredCommitKeys.get(key) ?? new Set<string>();
    delivered.add(identity);
    deliveredCommitKeys.set(key, delivered);
    while (delivered.size > 2048) {
      const oldest = delivered.values().next().value;
      if (oldest === undefined) break;
      delivered.delete(oldest);
    }
  };

  const sendDocumentRealtimeEvent = (
    key: string,
    target: DocumentSyncClientTarget,
    event: OrderedDocumentRealtimeEvent,
  ): boolean => {
    const identity = event.commitSeq === undefined
      ? null
      : `${event.storeEpoch}:${event.commitSeq}:${event.effectSequence ?? 0}`;
    if (identity && deliveredCommitKeys.get(key)?.has(identity)) return true;
    const sent = safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
    if (!sent) {
      closeSubscription(key);
      return false;
    }
    if (identity) rememberDeliveredCommit(key, identity);
    return true;
  };

  const sendCanvasRealtimeEvent = (
    key: string,
    target: DocumentSyncClientTarget,
    event: CanvasSceneRealtimeEvent,
  ): boolean => {
    const identity = event.type === "canvas_scene_committed"
      ? `${event.storeEpoch}:${event.documentId}:${event.mutationId}`
      : `${event.storeEpoch}:${event.documentId}:${event.type}:${event.headSeq}`;
    if (deliveredCommitKeys.get(key)?.has(identity)) return true;
    const sent = safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
    if (!sent) closeSubscription(key);
    if (sent) rememberDeliveredCommit(key, identity);
    return sent;
  };

  const documentRealtimeIdentity = (
    event: OrderedDocumentRealtimeEvent,
  ): string => event.commitSeq === undefined
    ? `${event.storeEpoch}:${event.generation}:${event.headSeq}:${event.kind}`
    : `${event.storeEpoch}:${event.commitSeq}:${event.effectSequence ?? 0}`;

  const canvasRealtimeIdentity = (
    event: CanvasSceneRealtimeEvent,
  ): string => event.type === "canvas_scene_committed"
    ? `${event.storeEpoch}:${event.documentId}:${event.mutationId}`
    : `${event.storeEpoch}:${event.documentId}:${event.type}:${event.generation}:${event.headSeq}`;

  const queuePendingRealtimeEvent = (
    subscription: NativeSubscription,
    pending: PendingNativeRealtimeEvent,
  ): boolean => {
    const identity = pending.engine === "yjs"
      ? documentRealtimeIdentity(pending.event)
      : canvasRealtimeIdentity(pending.event);
    if (subscription.pendingRealtimeEvents.has(identity)) return true;
    if (subscription.pendingRealtimeEvents.size >= MAX_PENDING_REALTIME_EVENTS) {
      subscription.pendingRealtimeEvents.clear();
      return false;
    }
    subscription.pendingRealtimeEvents.set(identity, pending);
    return true;
  };

  const beginPendingSubscription = (
    ownerKey: string,
    targetId: number,
  ): PendingNativeSubscription => {
    let resolve: () => void = () => undefined;
    let close: () => void = () => undefined;
    let cancelled = false;
    const settled = new Promise<void>((done) => {
      resolve = done;
    });
    const pending: PendingNativeSubscription = {
      targetId,
      settled,
      attachClose: (attachedClose) => {
        close = attachedClose;
        if (cancelled) close();
      },
      cancel: () => {
        cancelled = true;
        close();
      },
      settle: () => {
        if (pendingSubscriptions.get(ownerKey) === pending) {
          pendingSubscriptions.delete(ownerKey);
        }
        resolve();
      },
    };
    pendingSubscriptions.set(ownerKey, pending);
    return pending;
  };

  const reserveNativeSubscription = async (
    ownerKey: string,
    key: string,
    target: DocumentSyncClientTarget,
  ): Promise<NativeSubscriptionReservation> => {
    while (true) {
      const predecessor = pendingSubscriptions.get(ownerKey);
      if (predecessor) {
        await predecessor.settled;
        continue;
      }
      if (target.isDestroyed()) return { kind: "target_destroyed" };
      if (subscriptions.has(key)) return { kind: "existing" };
      if (bindings.has(ownerKey)) return { kind: "conflict" };
      bindings.set(ownerKey, key);
      return {
        kind: "reserved",
        pending: beginPendingSubscription(ownerKey, target.id),
      };
    }
  };

  const adoptSubscriptionBoundary = (
    key: string,
    boundary: {
      readonly storeEpoch: string;
      readonly generation: number;
      readonly headSeq: number;
    },
  ): void => {
    const subscription = subscriptions.get(key);
    if (!subscription) return;
    const previousGeneration = subscription.generation;
    const generationChanged = previousGeneration !== undefined
      && previousGeneration !== boundary.generation;
    const epochChanged = subscription.storeEpoch !== undefined
      && subscription.storeEpoch !== boundary.storeEpoch;
    if (generationChanged || epochChanged) {
      subscription.pendingRealtimeEvents.clear();
    }
    subscription.storeEpoch = boundary.storeEpoch;
    subscription.generation = boundary.generation;
    subscription.headSeq = previousGeneration === boundary.generation
      ? Math.max(subscription.headSeq ?? 0, boundary.headSeq)
      : boundary.headSeq;
    if (
      subscription.engine === "canvas_scene"
      && previousGeneration !== boundary.generation
    ) {
      canvasPresenceHub.adoptBoundary(key, boundary.generation);
    }
  };

  const suspendSubscriptionBoundary = (key: string): void => {
    const subscription = subscriptions.get(key);
    if (!subscription) return;
    subscription.pendingRealtimeEvents.clear();
    subscription.storeEpoch = undefined;
    subscription.generation = undefined;
    subscription.headSeq = undefined;
  };

  type RealtimeDeliveryOptions = {
    readonly drain?: boolean;
    readonly revokeAfter?: boolean;
  };

  const drainDocumentRealtimeEvents = (
    key: string,
    target: DocumentSyncClientTarget,
  ): void => {
    while (true) {
      const subscription = subscriptions.get(key);
      if (
        !subscription
        || subscription.target !== target
        || subscription.engine !== "yjs"
        || subscription.generation === undefined
        || subscription.headSeq === undefined
      ) {
        return;
      }
      for (const [identity, pending] of subscription.pendingRealtimeEvents) {
        if (
          pending.engine === "yjs"
          && pending.event.kind === "document-update"
          && pending.event.storeEpoch === subscription.storeEpoch
          && (
            pending.event.generation < subscription.generation
            || (
              pending.event.generation === subscription.generation
              && pending.event.headSeq <= subscription.headSeq
            )
          )
        ) {
          subscription.pendingRealtimeEvents.delete(identity);
        }
      }
      const nextHeadSeq = subscription.headSeq + 1;
      const next = [...subscription.pendingRealtimeEvents.entries()]
        .find(([, pending]) =>
          pending.engine === "yjs"
          && pending.event.kind === "document-update"
          && pending.event.generation === subscription.generation
          && pending.event.headSeq === nextHeadSeq,
        );
      if (!next) return;
      subscription.pendingRealtimeEvents.delete(next[0]);
      const pending = next[1];
      if (pending.engine !== "yjs") return;
      if (!deliverDocumentRealtimeEvent(key, target, pending.event, {
        drain: false,
      })) {
        return;
      }
    }
  };

  const drainCanvasRealtimeEvents = (
    key: string,
    target: DocumentSyncClientTarget,
  ): void => {
    while (true) {
      const subscription = subscriptions.get(key);
      if (
        !subscription
        || subscription.target !== target
        || subscription.engine !== "canvas_scene"
        || subscription.generation === undefined
        || subscription.headSeq === undefined
      ) {
        return;
      }
      for (const [identity, pending] of subscription.pendingRealtimeEvents) {
        if (
          pending.engine === "canvas_scene"
          && pending.event.storeEpoch === subscription.storeEpoch
          && (
            pending.event.generation < subscription.generation
            || (
              pending.event.generation === subscription.generation
              && pending.event.headSeq <= subscription.headSeq
            )
          )
        ) {
          subscription.pendingRealtimeEvents.delete(identity);
        }
      }
      const nextHeadSeq = subscription.headSeq + 1;
      const next = [...subscription.pendingRealtimeEvents.entries()]
        .find(([, pending]) =>
          pending.engine === "canvas_scene"
          && pending.event.type === "canvas_scene_committed"
          && pending.event.generation === subscription.generation
          && pending.event.headSeq === nextHeadSeq,
        );
      if (!next) return;
      subscription.pendingRealtimeEvents.delete(next[0]);
      const pending = next[1];
      if (pending.engine !== "canvas_scene") return;
      if (!deliverCanvasRealtimeEvent(key, target, pending.event, {
        drain: false,
      })) {
        return;
      }
    }
  };

  function deliverDocumentRealtimeEvent(
    key: string,
    target: DocumentSyncClientTarget,
    event: OrderedDocumentRealtimeEvent,
    options: RealtimeDeliveryOptions = {},
  ): boolean {
    const subscription = subscriptions.get(key);
    if (
      !subscription
      || subscription.target !== target
      || subscription.engine !== "yjs"
    ) {
      return sendDocumentRealtimeEvent(key, target, event);
    }
    const storeEpochChanged = subscription.storeEpoch !== undefined
      && subscription.storeEpoch !== event.storeEpoch;
    const identity = documentRealtimeIdentity(event);
    if (deliveredCommitKeys.get(key)?.has(identity)) return true;

    if (event.kind === "resync-required") {
      if (
        !storeEpochChanged
        && subscription.generation !== undefined
        && event.generation < subscription.generation
      ) {
        return true;
      }
      subscription.pendingRealtimeEvents.clear();
      const delivered = sendDocumentRealtimeEvent(key, target, event);
      if (!delivered) return false;
      suspendSubscriptionBoundary(key);
      if (options.revokeAfter && subscriptions.has(key)) closeSubscription(key);
      return true;
    }

    if (storeEpochChanged) {
      closeSubscription(key);
      return false;
    }

    if (subscription.generation === undefined) {
      if (queuePendingRealtimeEvent(subscription, { engine: "yjs", event })) {
        return true;
      }
      closeSubscription(key);
      return false;
    }
    if (event.generation < subscription.generation) return true;
    if (event.generation > subscription.generation) {
      subscription.pendingRealtimeEvents.clear();
      const delivered = sendDocumentRealtimeEvent(key, target, {
        kind: "resync-required",
        documentId: event.documentId,
        storeEpoch: event.storeEpoch,
        generation: event.generation,
        headSeq: event.headSeq,
        ...(event.commitSeq === undefined ? {} : { commitSeq: event.commitSeq }),
        ...(event.effectSequence === undefined
          ? {}
          : { effectSequence: event.effectSequence }),
        reason: "event-gap",
      });
      if (!delivered) return false;
      adoptSubscriptionBoundary(key, event);
      return true;
    }
    if (event.headSeq <= (subscription.headSeq ?? 0)) return true;
    if (event.headSeq > (subscription.headSeq ?? 0) + 1) {
      if (queuePendingRealtimeEvent(subscription, { engine: "yjs", event })) {
        return true;
      }
      const delivered = sendDocumentRealtimeEvent(key, target, {
        kind: "resync-required",
        documentId: event.documentId,
        storeEpoch: event.storeEpoch,
        generation: subscription.generation,
        headSeq: subscription.headSeq ?? 0,
        ...(event.commitSeq === undefined ? {} : { commitSeq: event.commitSeq }),
        ...(event.effectSequence === undefined
          ? {}
          : { effectSequence: event.effectSequence }),
        reason: "event-gap",
      });
      if (!delivered) return false;
      subscription.pendingRealtimeEvents.clear();
      return true;
    }
    const delivered = sendDocumentRealtimeEvent(key, target, event);
    if (!delivered) return false;
    adoptSubscriptionBoundary(key, event);
    if (options.drain !== false) drainDocumentRealtimeEvents(key, target);
    return true;
  }

  function deliverCanvasRealtimeEvent(
    key: string,
    target: DocumentSyncClientTarget,
    event: CanvasSceneRealtimeEvent,
    options: RealtimeDeliveryOptions = {},
  ): boolean {
    const subscription = subscriptions.get(key);
    if (
      !subscription
      || subscription.target !== target
      || subscription.engine !== "canvas_scene"
    ) {
      return sendCanvasRealtimeEvent(key, target, event);
    }
    const storeEpochChanged = subscription.storeEpoch !== undefined
      && subscription.storeEpoch !== event.storeEpoch;
    const identity = canvasRealtimeIdentity(event);
    if (deliveredCommitKeys.get(key)?.has(identity)) return true;
    if (event.type === "canvas_scene_resync_required") {
      if (
        !storeEpochChanged
        && subscription.generation !== undefined
        && event.generation < subscription.generation
      ) {
        return true;
      }
      subscription.pendingRealtimeEvents.clear();
      const delivered = sendCanvasRealtimeEvent(key, target, event);
      if (!delivered) return false;
      suspendSubscriptionBoundary(key);
      return true;
    }
    if (storeEpochChanged) {
      closeSubscription(key);
      return false;
    }
    if (subscription.generation === undefined) {
      if (queuePendingRealtimeEvent(subscription, {
        engine: "canvas_scene",
        event,
      })) {
        return true;
      }
      closeSubscription(key);
      return false;
    }
    if (event.generation < subscription.generation) return true;
    if (event.generation > subscription.generation) {
      subscription.pendingRealtimeEvents.clear();
      const delivered = sendCanvasRealtimeEvent(key, target, {
        type: "canvas_scene_resync_required",
        version: 1,
        libraryId: event.libraryId,
        accessContext: event.accessContext,
        documentId: event.documentId,
        storeEpoch: event.storeEpoch,
        generation: event.generation,
        headSeq: event.headSeq,
      });
      if (!delivered) return false;
      adoptSubscriptionBoundary(key, event);
      return true;
    }
    if (event.headSeq <= (subscription.headSeq ?? 0)) return true;
    if (event.headSeq > (subscription.headSeq ?? 0) + 1) {
      if (queuePendingRealtimeEvent(subscription, { engine: "canvas_scene", event })) {
        return true;
      }
      const delivered = sendCanvasRealtimeEvent(key, target, {
        type: "canvas_scene_resync_required",
        version: 1,
        libraryId: event.libraryId,
        accessContext: event.accessContext,
        documentId: event.documentId,
        storeEpoch: event.storeEpoch,
        generation: subscription.generation,
        headSeq: subscription.headSeq ?? 0,
      });
      if (!delivered) return false;
      subscription.pendingRealtimeEvents.clear();
      return true;
    }
    const delivered = sendCanvasRealtimeEvent(key, target, event);
    if (!delivered) return false;
    adoptSubscriptionBoundary(key, event);
    if (options.drain !== false) drainCanvasRealtimeEvents(key, target);
    return true;
  }

  const addNativeSubscription = (
    key: string,
    subscription: NativeSubscription,
  ): { readonly ok: true; readonly value: { readonly subscribed: true } } => {
    subscriptions.set(key, subscription);
    return { ok: true, value: { subscribed: true } };
  };

  const bindTargetLifecycle = (target: DocumentSyncClientTarget): void => {
    if (boundTargets.has(target.id)) return;
    boundTargets.add(target.id);
    target.once("destroyed", () => {
      boundTargets.delete(target.id);
      for (const pending of pendingSubscriptions.values()) {
        if (pending.targetId === target.id) pending.cancel();
      }
      for (const [key, subscription] of subscriptions) {
        if (subscription.targetId === target.id) closeSubscription(key);
      }
    });
  };

  const hasNativeSubscription = (
    target: DocumentSyncClientTarget,
    scope: DesktopDocumentSyncScope,
    request: DocumentSyncSubscribeRequest,
  ): boolean => {
    const subscription = subscriptions.get(subscriptionKey(target, scope, request));
    return subscription?.target === target;
  };

  const hasNativeCanvasSceneSubscription = (
    target: DocumentSyncClientTarget,
    request: CanvasSceneSubscribeRequest,
  ): boolean => {
    if (!hasCanvasSceneIdentity(request)) return false;
    const subscription = subscriptions.get(canvasSceneSubscriptionKey(
      target,
      request,
    ));
    return subscription?.target === target;
  };

  const withRuntime = async <Value>(
    run: (
      runtime: DesktopDataAuthorityRuntime,
    ) => Promise<DocumentSyncCommandResult<Value>> | DocumentSyncCommandResult<Value>,
  ): Promise<DocumentSyncCommandResult<Value>> => {
    try {
      return await run(await input.authority);
    } catch (error) {
      return transportUnavailable(error);
    }
  };

  const withCanvasSceneRuntime = async <Success extends { readonly ok: true }>(
    run: (
      runtime: DesktopDataAuthorityRuntime,
    ) => Promise<Success | CanvasCommandFailure> | Success | CanvasCommandFailure,
    mutationId?: string,
  ): Promise<Success | CanvasCommandFailure> => {
    try {
      return await run(await input.authority);
    } catch (error) {
      return canvasSceneTransportUnavailable(error, mutationId);
    }
  };

  const applyDocumentMutation = async (
    request: DocumentMutationRequest,
  ): Promise<DocumentOperationCommandResult> => {
    let runtime: DesktopDataAuthorityRuntime;
    try {
      runtime = await input.authority;
    } catch (error) {
      return {
        ok: false,
        error: documentMutationFailure(
          "unknown",
          error instanceof Error ? error.message : String(error),
          { mutationId: request.mutationId, retryable: true },
        ),
      };
    }
    const adapter = adapterFor(runtime, {
      kind: "project",
      projectId: request.projectId,
    });
    const committed = await adapter.applyDocumentMutation(request);
    if (!committed.ok) {
      return committed;
    }
    return committed;
  };

  const compactCanvasScene = async (
    target: DocumentSyncClientTarget,
    request: CanvasSceneCompactionRequest,
  ): Promise<CanvasSceneCompactionCommandResult> =>
    await withCanvasSceneRuntime(async (runtime) => {
      if (
        !hasCanvasSceneIdentity(request)
        || !hasNativeCanvasSceneSubscription(target, request)
        || request.trigger !== "automatic_idle"
      ) {
        return canvasSceneUnauthorized(request.mutationId);
      }
      const adapter = canvasSceneAdapterFor(runtime, request.accessContext);
      const eligibility = await adapter.readCompaction(request);
      if (!eligibility.ok) return eligibility;
      if (!eligibility.value.eligible) {
        return canvasSceneFailure(
          "future_base_head",
          "Canvas maintenance is below its internal threshold",
          { mutationId: request.mutationId, retryable: true },
        );
      }
      const committed = await adapter.compact(request, eligibility.value);
      if (!committed.ok) {
        return committed;
      }
      return committed;
    }, request.mutationId);

  const publishDocumentEffects = (
    packet: CoreAuthorizedDeliveryPacket,
    onlyDocumentId?: string,
  ): void => {
    const identity = packet.manifest.identity;
    const effects = packet.atoms;
    const invalidatedDocuments = new Set(
      effects
        .filter((effect) =>
          effect.payload.module === "owned_document"
          && effect.payload.event.kind === "document_invalidated"
        )
        .map((effect) =>
          effect.payload.module === "owned_document"
            ? effect.payload.event.document_id
            : null
        )
        .filter((documentId): documentId is string => documentId !== null),
    );
    const resyncRequiredDocuments = new Set(
      effects
        .filter((effect) =>
          effect.payload.module === "owned_document"
          && effect.payload.event.kind === "document_resync_required"
        )
        .map((effect) =>
          effect.payload.module === "owned_document"
            ? effect.payload.event.document_id
            : null
        )
        .filter((documentId): documentId is string => documentId !== null),
    );
    packet.document_effects.forEach((effect) => {
      const reference = effect.reference;
      if (onlyDocumentId && reference.document_id !== onlyDocumentId) return;
      if (
        invalidatedDocuments.has(reference.document_id)
        || resyncRequiredDocuments.has(reference.document_id)
      ) return;
      const scopes = new Map<string, {
        readonly scope: DesktopDocumentSyncScope;
        readonly recipients: Map<string, NativeSubscription>;
      }>();
      // Each active subscription was authorized by Core for this exact
      // Document. A root-stream packet may cover several subscription scopes,
      // so its packet scope is not the audience for each Document ref. Access
      // loss is carried separately by the scoped revocation lane below.
      for (const [key, subscription] of subscriptions) {
        if (
          subscription.engine === "yjs"
          && subscription.documentId === reference.document_id
          && !packetRevokesDocumentScope(
            packet,
            reference.document_id,
            subscription.scope,
          )
        ) {
          const keyForScope = scopeKey(subscription.scope);
          const group = scopes.get(keyForScope) ?? {
            scope: subscription.scope,
            recipients: new Map(),
          };
          group.recipients.set(key, subscription);
          scopes.set(keyForScope, group);
        }
      }
      for (const [, { scope, recipients }] of scopes) {
        const deliverResolvedEvent = (event: OrderedDocumentRealtimeEvent): void => {
          for (const [key, subscription] of recipients) {
            if (subscriptions.get(key) !== subscription) continue;
            if (
              subscription.storeEpoch
              && subscription.storeEpoch !== identity.store_epoch
            ) {
              closeSubscription(key);
              continue;
            }
            deliverDocumentRealtimeEvent(key, subscription.target, event, {
              revokeAfter: event.kind === "resync-required"
                && event.reason === "access-revoked",
            });
          }
        };
        const inline = resolveInlineAuthorizedDocumentEffect(effect, identity);
        if (inline) {
          deliverResolvedEvent(inline);
          continue;
        }
        void resolveAuthorizedDocumentEffect(
          effect,
          identity,
          async (request) => {
            try {
              const runtime = await input.authority;
              return await adapterFor(runtime, scope).fetchUpdateResource(request);
            } catch (error) {
              return transportUnavailable(error);
            }
          },
        ).catch(() => ({
          kind: "resync-required" as const,
          documentId: reference.document_id,
          storeEpoch: identity.store_epoch,
          generation: reference.generation,
          headSeq: reference.base_head_seq,
          commitSeq: identity.commit_seq,
          effectSequence: reference.effect_order,
          reason: "resource-integrity-failure" as const,
        })).then(deliverResolvedEvent);
      }
    });
    effects.forEach((effect) => {
      if (effect.payload.module !== "owned_document") return;
      const event = effect.payload.event;
      if (onlyDocumentId && event.document_id !== onlyDocumentId) return;
      for (const [key, subscription] of [...subscriptions]) {
        if (subscription.documentId !== event.document_id) continue;
        if (packetRevokesDocumentScope(packet, event.document_id, subscription.scope)) {
          continue;
        }
        if (subscription.storeEpoch && subscription.storeEpoch !== identity.store_epoch) {
          closeSubscription(key);
          continue;
        }
        if (subscription.engine === "yjs") {
          if (
            event.kind === "document_invalidated"
            || event.kind === "document_resync_required"
          ) {
            const compacted = event.kind === "document_resync_required";
            const delivered = deliverDocumentRealtimeEvent(key, subscription.target, {
              kind: "resync-required",
              documentId: event.document_id,
              storeEpoch: identity.store_epoch,
              generation: compacted ? event.generation : subscription.generation ?? 1,
              headSeq: compacted ? event.head_seq : subscription.headSeq ?? 0,
              commitSeq: identity.commit_seq,
              effectSequence: effect.descriptor.atom_order,
              reason: compacted
                ? "history-compacted"
                : event.reason === "access_changed"
                  ? "access-revoked"
                  : "identity-boundary-changed",
            }, compacted ? {} : { revokeAfter: true });
            void delivered;
          }
          continue;
        }
        if (subscription.engine !== "canvas_scene") {
          continue;
        }
        if (!subscription.libraryId) continue;
        if (event.kind === "canvas_generation_changed") {
          const delivered = deliverCanvasRealtimeEvent(key, subscription.target, {
            type: "canvas_scene_resync_required",
            version: 1,
            libraryId: subscription.libraryId,
            accessContext: subscription.scope,
            documentId: event.document_id,
            storeEpoch: identity.store_epoch,
            generation: event.generation,
            headSeq: event.head_seq,
          });
          void delivered;
          continue;
        }
        if (
          event.kind !== "canvas_updated"
          || typeof event.mutation !== "object"
          || event.mutation === null
          || !packet.manifest.operation_id
        ) {
          continue;
        }
        let realtimeEvent: CanvasSceneRealtimeEvent;
        try {
          realtimeEvent = decodeCanvasSceneSseEvent(JSON.stringify({
            type: "canvas_scene_committed",
            version: 1,
            libraryId: subscription.libraryId,
            accessContext: subscription.scope,
            documentId: event.document_id,
            storeEpoch: identity.store_epoch,
            generation: event.generation,
            mutationId: packet.manifest.operation_id,
            baseHeadSeq: event.base_head_seq,
            headSeq: event.head_seq,
            sceneHash: event.scene_hash,
            ...(event.mutation as Readonly<Record<string, unknown>>),
          }));
        } catch {
          continue;
        }
        const delivered = deliverCanvasRealtimeEvent(
          key,
          subscription.target,
          realtimeEvent,
        );
        void delivered;
      }
    });
  };

  const publishResourceRevocation = (
    packet: CoreAuthorizedDeliveryPacket,
  revocation: ResourceRevocation,
  ): void => {
    if (revocation.resource_kind !== "document") return;
    if (revocation.authorization_scope.kind !== "document") return;
    const identity = packet.manifest.identity;
    for (const [key, subscription] of [...subscriptions]) {
      if (subscription.documentId !== revocation.resource_id) continue;
      if (!authorizationScopeMatchesDocumentScope(
        revocation.authorization_scope,
        subscription.scope,
      )) continue;
      if (subscription.engine !== "yjs") {
        closeSubscription(key);
        continue;
      }
      const delivered = deliverDocumentRealtimeEvent(key, subscription.target, {
        kind: "resync-required",
        documentId: revocation.resource_id,
        storeEpoch: identity.store_epoch,
        generation: subscription.generation ?? 1,
        headSeq: subscription.headSeq ?? 0,
        commitSeq: identity.commit_seq,
        effectSequence: packet.atoms.length,
        reason: "access-revoked",
      }, { revokeAfter: true });
      void delivered;
    }
  };

  const transferBlocks = async (
    intent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult> => {
    let runtime: DesktopDataAuthorityRuntime;
    try {
      runtime = await input.authority;
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "unknown",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
          reloadRequired: false,
          operationId: intent.operationId,
        },
      };
    }
    const adapter = blockTransferAdapterFor(runtime, intent.projectId);
    const result = await adapter.commit(intent);
    return result;
  };

  const executeNodexAgentMutation = async <
    Result extends NativeNodexAgentMutationResult,
  >(
    options: NativeNodexAgentMutationExecution<Result>,
  ): Promise<Result> => {
    let result: Result;
    try {
      result = await options.execute();
    } catch {
      return options.failure(`${options.operationLabel} commit failed`);
    }
    if (!result.ok) return result;

    return result;
  };

  return {
    publishDocumentEffects,
    publishResourceRevocation,
    getOwnedDocumentDescriptor: async (projectId, ownerBlockId) => {
      const runtime = await input.authority;
      const descriptor = await adapterFor(runtime, { kind: "project", projectId })
        .readDescriptor({
          ownerBlockId,
          clientSessionId: "electron:owned-document:descriptor",
        });
      return requireProjectOwnedDocumentDescriptor(descriptor, projectId);
    },
    prepareOwnedBlockDocument: async (projectId, ownerBlockId) =>
      await withRuntime(async (runtime) => {
        const scope = { kind: "project", projectId } as const;
        const prepared = await adapterFor(runtime, scope).prepareOwner({
          ownerBlockId,
          ...ownerCommandIdentity(
            scope,
            ownerBlockId,
            runtime.identity.storeEpoch,
            runtime.rootClient.handshake.connection_binding,
          ),
        });
        if (!prepared.ok) return prepared;
        return {
          ok: true,
          value: requireProjectOwnedDocumentDescriptor(
            prepared.value,
            projectId,
          ),
        };
      }),
    prepareLibraryOwnedBlockDocument: async (ownerBlockId) =>
      await withRuntime(async (runtime) => {
        const scope = { kind: "library" } as const;
        const prepared = await adapterFor(runtime, scope).prepareOwner({
          ownerBlockId,
          ...ownerCommandIdentity(
            scope,
            ownerBlockId,
            runtime.identity.storeEpoch,
            runtime.rootClient.handshake.connection_binding,
          ),
        });
        if (!prepared.ok) return prepared;
        return {
          ok: true,
          value: requireLibraryOwnedDocumentDescriptor(prepared.value),
        };
      }),
    subscribe: async (scope, target, request) => await withRuntime(async (runtime) => {
      if (target.isDestroyed()) return documentSyncUnauthorized();
      const adapter = adapterFor(runtime, scope);
      const key = subscriptionKey(target, scope, request);
      const ownerKey = bindingKey(request);
      bindTargetLifecycle(target);
      const reservation = await reserveNativeSubscription(
        ownerKey,
        key,
        target,
      );
      if (reservation.kind === "existing") {
        return { ok: true, value: { subscribed: true } };
      }
      if (reservation.kind === "target_destroyed") {
        return documentSyncUnauthorized();
      }
      if (reservation.kind === "conflict") return documentSyncUnauthorized();
      const { pending } = reservation;
      try {
        let lifecycle: ReturnType<
          CoreDocumentSyncAdapter["subscribeWithLifecycle"]
        > | null = null;
        try {
          let admitted = false;
          let openingOverflowed = false;
          const openingEvents: DocumentSyncRealtimeEvent[] = [];
          const deliver = (event: DocumentSyncRealtimeEvent): void => {
            if (event.kind === "connection") {
              if (event.state === "disconnected") suspendSubscriptionBoundary(key);
              if (!safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event])) {
                closeSubscription(key);
              }
              return;
            }
            if (event.kind !== "document-update" && event.kind !== "resync-required") {
              if (!safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event])) {
                closeSubscription(key);
              }
              return;
            }
            deliverDocumentRealtimeEvent(key, target, event, {
              revokeAfter: event.kind === "resync-required"
                && event.reason === "access-revoked",
            });
          };
          lifecycle = adapter.subscribeWithLifecycle(request, (event) => {
            if (!admitted) {
              if (openingEvents.length >= MAX_PENDING_REALTIME_EVENTS) {
                openingOverflowed = true;
                lifecycle?.close();
                return;
              }
              openingEvents.push(event);
              return;
            }
            deliver(event);
          });
          pending.attachClose(lifecycle.close);
          const barrier = await lifecycle.ready;
          if (
            openingOverflowed
            || barrier.engine !== "yjs"
            || barrier.document_id !== request.documentId
            || barrier.store_epoch !== runtime.identity.storeEpoch
          ) {
            throw new Error("Core Document live barrier does not match the Yjs session");
          }
          if (target.isDestroyed()) {
            lifecycle.close();
            if (bindings.get(ownerKey) === key) bindings.delete(ownerKey);
            return documentSyncUnauthorized();
          }
          const subscribed = addNativeSubscription(key, {
            engine: "yjs",
            bindingKey: ownerKey,
            scope,
            documentId: request.documentId,
            clientSessionId: request.clientSessionId,
            target,
            targetId: target.id,
            close: lifecycle.close,
            pendingRealtimeEvents: new Map(),
          });
          admitted = true;
          openingEvents.forEach(deliver);
          void lifecycle.done.catch(() => undefined).finally(() => {
            if (subscriptions.get(key)?.close === lifecycle?.close) {
              closeSubscription(key);
            }
          });
          return subscribed;
        } catch (error) {
          lifecycle?.close();
          closeSubscription(key);
          if (bindings.get(ownerKey) === key) bindings.delete(ownerKey);
          return transportUnavailable(error);
        }
      } finally {
        pending.settle();
      }
    }),
    unsubscribe: async (scope, target, request) => await withRuntime(() => {
      const key = subscriptionKey(target, scope, request);
      if (subscriptions.get(key)?.target === target) closeSubscription(key);
      return { ok: true, value: { unsubscribed: true } };
    }),
    sync: async (scope, target, request) => await withRuntime(async (runtime) => {
      const adapter = adapterFor(runtime, scope);
      if (!hasNativeSubscription(target, scope, request)) {
        return documentSyncUnauthorized();
      }
      const key = subscriptionKey(target, scope, request);
      suspendSubscriptionBoundary(key);
      const result = await adapter.sync(request);
      if (result.ok) {
        adoptSubscriptionBoundary(key, result.value);
        drainDocumentRealtimeEvents(key, target);
      }
      return result;
    }),
    applyUpdate: async (scope, target, request) => await withRuntime(async (runtime) => {
      const adapter = adapterFor(runtime, scope);
      if (!hasNativeSubscription(target, scope, request)) {
        return documentSyncUnauthorized();
      }
      const result = await adapter.applyUpdate(request);
      return result;
    }),
    publishAwareness: async (scope, target, request) => await withRuntime(async (runtime) => {
      const adapter = adapterFor(runtime, scope);
      if (!hasNativeSubscription(target, scope, request)) {
        return documentSyncUnauthorized();
      }
      return await adapter.publishAwareness(request);
    }),
    subscribeCanvasScene: async (target, request) =>
      await withCanvasSceneRuntime(async (runtime) => {
        if (target.isDestroyed() || !hasCanvasSceneIdentity(request)) {
          return canvasSceneUnauthorized();
        }
        const adapter = canvasSceneAdapterFor(runtime, request.accessContext);
        const key = canvasSceneSubscriptionKey(target, request);
        const ownerKey = bindingKey(request);
        bindTargetLifecycle(target);
        const reservation = await reserveNativeSubscription(
          ownerKey,
          key,
          target,
        );
        if (reservation.kind === "existing") {
          return { ok: true, value: { subscribed: true } };
        }
        if (reservation.kind === "target_destroyed") {
          return canvasSceneUnauthorized();
        }
        if (reservation.kind === "conflict") return canvasSceneUnauthorized();
        const { pending } = reservation;
        try {
          let lifecycle: ReturnType<
            CoreCanvasSceneAdapter["subscribeWithLifecycle"]
          > | null = null;
          try {
            let admitted = false;
            let openingOverflowed = false;
            const openingEvents: CanvasSceneRealtimeEvent[] = [];
            const deliver = (event: CanvasSceneRealtimeEvent): void => {
              deliverCanvasRealtimeEvent(key, target, event);
            };
            lifecycle = adapter.subscribeWithLifecycle(request, (event) => {
              if (!admitted) {
                if (openingEvents.length >= MAX_PENDING_REALTIME_EVENTS) {
                  openingOverflowed = true;
                  lifecycle?.close();
                  return;
                }
                openingEvents.push(event);
                return;
              }
              deliver(event);
            });
            pending.attachClose(lifecycle.close);
            const barrier = await lifecycle.ready;
            if (
              openingOverflowed
              || barrier.engine !== "canvas_scene"
              || barrier.document_id !== request.documentId
              || barrier.store_epoch !== runtime.identity.storeEpoch
            ) {
              throw new Error("Core Document live barrier does not match the Canvas session");
            }
            if (target.isDestroyed()) {
              lifecycle.close();
              if (bindings.get(ownerKey) === key) bindings.delete(ownerKey);
              return canvasSceneUnauthorized();
            }
            const subscribed = addNativeSubscription(key, {
              engine: "canvas_scene",
              bindingKey: ownerKey,
              scope: request.accessContext,
              libraryId: runtime.identity.libraryId,
              documentId: request.documentId,
              clientSessionId: request.clientSessionId,
              target,
              targetId: target.id,
              close: lifecycle.close,
              pendingRealtimeEvents: new Map(),
            });
            admitted = true;
            openingEvents.forEach(deliver);
            canvasPresenceHub.register({
              key,
              libraryId: runtime.identity.libraryId,
              accessContext: request.accessContext,
              documentId: request.documentId,
              clientSessionId: request.clientSessionId,
              targetId: target.id,
              send: (event) => {
                if (!safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event])) {
                  closeSubscription(key);
                }
              },
            });
            void lifecycle.done.catch(() => undefined).finally(() => {
              if (subscriptions.get(key)?.close === lifecycle?.close) {
                closeSubscription(key);
              }
            });
            return subscribed;
          } catch (error) {
            lifecycle?.close();
            closeSubscription(key);
            if (bindings.get(ownerKey) === key) bindings.delete(ownerKey);
            return canvasSceneTransportUnavailable(error);
          }
        } finally {
          pending.settle();
        }
      }),
    unsubscribeCanvasScene: async (target, request) =>
      await withCanvasSceneRuntime(() => {
        if (!hasCanvasSceneIdentity(request)) return canvasSceneUnauthorized();
        const key = canvasSceneSubscriptionKey(target, request);
        if (subscriptions.get(key)?.target === target) closeSubscription(key);
        return { ok: true, value: { unsubscribed: true } };
      }),
    syncCanvasScene: async (target, request) =>
      await withCanvasSceneRuntime(async (runtime) => {
        if (!hasNativeCanvasSceneSubscription(target, request)) {
          return canvasSceneUnauthorized();
        }
        const key = canvasSceneSubscriptionKey(target, request);
        suspendSubscriptionBoundary(key);
        const result = await canvasSceneAdapterFor(runtime, request.accessContext)
          .sync(request);
        if (result.ok) {
          adoptSubscriptionBoundary(key, result.value);
          drainCanvasRealtimeEvents(key, target);
        }
        return result;
      }),
    applyCanvasSceneMutation: async (target, request) =>
      await withCanvasSceneRuntime(async (runtime) => {
        if (!hasNativeCanvasSceneSubscription(target, request)) {
          return canvasSceneUnauthorized(request.mutationId);
        }
        const result = await canvasSceneAdapterFor(runtime, request.accessContext)
          .applyMutation(request);
        return result;
      }, request.mutationId),
    publishCanvasPresence: async (target, request) => {
      let parsed: CanvasPresencePublishRequest;
      try {
        parsed = canonicalizeCanvasPresencePublishRequest(request);
      } catch (error) {
        return canvasPresenceFailure(
          "invalid_presence",
          error instanceof Error ? error.message : String(error),
        );
      }
      const subscriptionRequest: CanvasSceneSubscribeRequest = {
        version: 1,
        accessContext: parsed.accessContext,
        documentId: parsed.publication.documentId,
        clientSessionId: parsed.clientSessionId,
      };
      const key = canvasSceneSubscriptionKey(target, subscriptionRequest);
      if (
        !hasNativeCanvasSceneSubscription(target, subscriptionRequest)
        || subscriptions.get(key)?.generation === undefined
      ) {
        return canvasPresenceFailure(
          "unauthorized",
          "An exact active Canvas subscription is required for presence",
        );
      }
      try {
        return {
          ok: true,
          value: canvasPresenceHub.publish(key, parsed.publication),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("generation boundary")) {
          return canvasPresenceFailure("generation_mismatch", message, {
            resetRequired: true,
          });
        }
        if (error instanceof TypeError) {
          return canvasPresenceFailure("invalid_presence", message);
        }
        return canvasPresenceFailure("unauthorized", message);
      }
    },
    readCanvasSceneCompaction: async (target, request) =>
      await withCanvasSceneRuntime(async (runtime) => {
        if (!hasNativeCanvasSceneSubscription(target, request)) {
          return canvasSceneUnauthorized();
        }
        return await canvasSceneAdapterFor(runtime, request.accessContext)
          .readCompaction(request);
      }),
    compactCanvasScene,
    applyAdditionalDocumentCommand: async (request) => {
      const runtime = await input.authority;
      return await adapterFor(runtime, {
        kind: "project",
        projectId: request.projectId,
      }).applyAdditionalDocumentCommand(request);
    },
    createCheckpoint: async (request) => {
      const runtime = await input.authority;
      return await adapterFor(runtime, {
        kind: "project",
        projectId: request.projectId,
      }).createCheckpoint(request);
    },
    listVersions: async (request) => {
      const runtime = await input.authority;
      return await adapterFor(runtime, {
        kind: "project",
        projectId: request.projectId,
      }).listVersions(request);
    },
    getVersion: async (request) => {
      const runtime = await input.authority;
      return await adapterFor(runtime, {
        kind: "project",
        projectId: request.projectId,
      }).getVersion(request);
    },
    applyDocumentMutation,
    transferBlocks,
    executeNodexAgentMutation,
    restoreVersion: async (request) => await applyDocumentMutation(request),
  };
}
