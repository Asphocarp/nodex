import { createHash } from "node:crypto";

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
import { documentMutationFailure } from "../../shared/block-documents/document-operation-transport";
import type {
  CanvasSceneMutationCommandResult,
  CanvasSceneMutationError,
  CanvasSceneMutationRequest,
  CanvasSceneSubscribeRequest,
  CanvasSceneSubscriptionCommandResult,
  CanvasSceneSyncCommandResult,
  CanvasSceneSyncRequest,
} from "../../shared/block-documents/canvas-scene-sync";
import {
  toLibraryOwnedDocumentDescriptor,
  type LibraryOwnedDocumentDescriptor,
  type OwnedDocumentDescriptor,
} from "../../shared/block-documents/contracts";
import type {
  DocumentAccessAck,
  DocumentAccessKind,
  DocumentAwarenessPublishAck,
  DocumentAwarenessPublishRequest,
  DocumentRelocationLeaseResponseAck,
  DocumentRelocationLeaseResponseRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
  DocumentSyncSubscriptionAck,
  DocumentSyncUnsubscribeAck,
  LibraryDocumentAccessAck,
} from "../../shared/block-documents/document-sync";
import { parseDocumentRelocationLeaseResponseRequest } from "../../shared/block-documents/document-sync";
import {
  DocumentRelocationLeaseCoordinator,
  type DocumentRelocationLeaseEvent,
} from "../document-relocation-lease-coordinator";
import { documentSyncUnauthorized } from "../document-sync-hub";
import type {
  DocumentSyncClientTarget,
  DocumentSyncHub,
} from "../document-sync-hub";
import { safeSendToWebContents } from "../ipc-safe-send";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import {
  createCoreCanvasSceneAdapter,
  type CoreCanvasSceneAdapter,
} from "./core-canvas-scene-adapter";
import { createCoreDocumentSyncAdapter } from "./document-sync-adapter";
import type { CoreDocumentSyncAdapter } from "./document-sync-adapter";

const DOCUMENT_SYNC_EVENT_CHANNEL = "document-sync:event";

export type DesktopDocumentSyncScope =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "library" };

export interface DesktopDocumentSyncPort {
  getOwnedDocumentDescriptor(
    projectId: string,
    ownerBlockId: string,
  ): Promise<OwnedDocumentDescriptor>;
  prepareOwnedBlockDocument(
    projectId: string,
    ownerBlockId: string,
  ): Promise<DocumentSyncCommandResult<OwnedDocumentDescriptor>>;
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
  respondToRelocationLease(
    scope: DesktopDocumentSyncScope,
    target: DocumentSyncClientTarget,
    request: DocumentRelocationLeaseResponseRequest,
  ): Promise<DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>>;
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
}

export interface DesktopDocumentSyncBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly typescript: {
    readonly hub: Pick<
      DocumentSyncHub,
      | "subscribe"
      | "unsubscribe"
      | "sync"
      | "applyUpdate"
      | "publishAwareness"
      | "respondToRelocationLease"
      | "subscribeCanvasScene"
      | "unsubscribeCanvasScene"
      | "syncCanvasScene"
      | "applyCanvasSceneMutation"
      | "applyAdditionalDocumentCommand"
    >;
    authorizeProject(input: {
      readonly projectId: string;
      readonly documentId: string;
      readonly access: DocumentAccessKind;
    }): Promise<DocumentSyncCommandResult<DocumentAccessAck>>;
    authorizeLibrary(input: {
      readonly documentId: string;
      readonly access: DocumentAccessKind;
    }): Promise<DocumentSyncCommandResult<LibraryDocumentAccessAck>>;
    getOwnedDocumentDescriptor(
      projectId: string,
      ownerBlockId: string,
    ): Promise<OwnedDocumentDescriptor>;
    prepareOwnedBlockDocument(
      projectId: string,
      ownerBlockId: string,
    ): Promise<DocumentSyncCommandResult<OwnedDocumentDescriptor>>;
    prepareLibraryOwnedBlockDocument(
      ownerBlockId: string,
    ): Promise<DocumentSyncCommandResult<LibraryOwnedDocumentDescriptor>>;
    createCheckpoint(
      request: CreateDocumentVersionCheckpoint,
    ): Promise<DocumentHistoryCommandResult<CreatedDocumentVersionSummary>>;
    listVersions(
      request: ListDocumentVersions,
    ): Promise<DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>>;
    getVersion(
      request: GetDocumentVersion,
    ): Promise<DocumentHistoryCommandResult<DocumentVersionDetail>>;
    applyDocumentMutation(
      request: DocumentMutationRequest,
    ): Promise<DocumentOperationCommandResult>;
  };
}

interface NativeSubscription {
  readonly bindingKey: string;
  readonly participantSessionKey: string;
  readonly scope: DesktopDocumentSyncScope;
  readonly documentId: string;
  readonly clientSessionId: string;
  readonly target: DocumentSyncClientTarget;
  readonly targetId: number;
  readonly close: () => void;
  storeEpoch?: string;
  generation?: number;
  headSeq?: number;
}

interface NativeDocumentMutationLeaseBoundary {
  readonly leaseId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  headSeq: number;
}

const scopeKey = (scope: DesktopDocumentSyncScope): string =>
  scope.kind === "project" ? `project:${scope.projectId}` : "library";

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
  `project:${request.projectId}`,
  request.clientSessionId,
  request.documentId,
]);

const bindingKey = (
  request: Pick<DocumentSyncSubscribeRequest, "clientSessionId">,
): string => request.clientSessionId;

const participantSessionKey = (key: string): string =>
  `native:${createHash("sha256").update(key).digest("hex")}`;

const scopesMatch = (
  left: DesktopDocumentSyncScope,
  right: DesktopDocumentSyncScope,
): boolean => left.kind === right.kind
  && (left.kind === "library"
    || (right.kind === "project" && left.projectId === right.projectId));

const nativeDocumentSyncFailure = <Value>(
  code: DocumentSyncCommandError["code"],
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly resetRequired?: boolean;
  } = {},
): DocumentSyncCommandResult<Value> => ({
  ok: false,
  error: {
    code,
    message,
    retryable: options.retryable ?? false,
    resetRequired: options.resetRequired ?? false,
  },
});

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

const canvasSceneFailure = <Value>(
  code: CanvasSceneMutationError["code"],
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly mutationId?: string;
  } = {},
): CanvasCommandResult<Value> => ({
  ok: false,
  error: {
    code,
    message,
    retryable: options.retryable ?? false,
    resetRequired: false,
    ...(options.mutationId ? { mutationId: options.mutationId } : {}),
  },
});

const canvasSceneUnauthorized = <Value>(
  mutationId?: string,
): CanvasCommandResult<Value> => canvasSceneFailure(
  "project_scope_mismatch",
  "An exact Canvas scene subscription is required",
  { mutationId },
);

const canvasSceneTransportUnavailable = <Value>(
  error: unknown,
  mutationId?: string,
): CanvasCommandResult<Value> => canvasSceneFailure(
  "unknown",
  error instanceof Error ? error.message : String(error),
  { retryable: true, mutationId },
);

const hasCanvasSceneIdentity = (
  request: CanvasSceneSubscribeRequest,
): boolean => request.version === 1
  && request.projectId.length > 0
  && request.documentId.length > 0
  && request.clientSessionId.length > 0;

export function createDesktopDocumentSyncBridge(
  input: DesktopDocumentSyncBridgeInput,
): DesktopDocumentSyncPort {
  const adapters = new Map<string, CoreDocumentSyncAdapter>();
  const canvasSceneAdapters = new Map<string, CoreCanvasSceneAdapter>();
  const subscriptions = new Map<string, NativeSubscription>();
  const bindings = new Map<string, string>();
  const boundTargets = new Set<number>();
  const documentMutationLeaseBoundaries = new Map<
    string,
    NativeDocumentMutationLeaseBoundary
  >();
  let documentMutationLeaseSequence = 0;

  const publishDocumentMutationLeaseEvent = (
    event: DocumentRelocationLeaseEvent,
  ): void => {
    const boundary = documentMutationLeaseBoundaries.get(event.leaseId);
    if (!boundary) return;
    const subscription = [...subscriptions.values()].find(
      (candidate) =>
        candidate.participantSessionKey === event.participantSessionKey
        && candidate.documentId === boundary.documentId,
    );
    if (!subscription) return;
    const realtimeEvent = event.kind === "prepare"
      ? {
          kind: "relocation-lease-prepare" as const,
          leaseId: event.leaseId,
          documentId: boundary.documentId,
          clientSessionId: subscription.clientSessionId,
          storeEpoch: boundary.storeEpoch,
          generation: boundary.generation,
          expectedHeadSeq: boundary.headSeq,
          deadlineAt: event.deadlineAt,
        }
      : event.kind === "release"
        ? {
            kind: "relocation-lease-release" as const,
            leaseId: event.leaseId,
            documentId: boundary.documentId,
            clientSessionId: subscription.clientSessionId,
            storeEpoch: boundary.storeEpoch,
            generation: boundary.generation,
            headSeq: boundary.headSeq,
          }
        : {
            kind: "relocation-lease-cancel" as const,
            leaseId: event.leaseId,
            documentId: boundary.documentId,
            clientSessionId: subscription.clientSessionId,
            storeEpoch: boundary.storeEpoch,
            generation: boundary.generation,
            headSeq: boundary.headSeq,
            reason: event.reason,
          };
    safeSendToWebContents(subscription.target, DOCUMENT_SYNC_EVENT_CHANNEL, [
      realtimeEvent,
    ]);
  };
  const relocationLeaseCoordinator = new DocumentRelocationLeaseCoordinator({
    publishEvent: publishDocumentMutationLeaseEvent,
  });

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
    projectId: string,
  ): CoreCanvasSceneAdapter => {
    let adapter = canvasSceneAdapters.get(projectId);
    if (adapter) return adapter;
    adapter = createCoreCanvasSceneAdapter(runtime.clientForProject(projectId));
    canvasSceneAdapters.set(projectId, adapter);
    return adapter;
  };

  const closeSubscription = (key: string): void => {
    const subscription = subscriptions.get(key);
    if (!subscription) return;
    relocationLeaseCoordinator.unsubscribe(
      subscription.participantSessionKey,
      subscription.documentId,
    );
    subscriptions.delete(key);
    if (bindings.get(subscription.bindingKey) === key) {
      bindings.delete(subscription.bindingKey);
    }
    subscription.close();
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
    subscription.storeEpoch = boundary.storeEpoch;
    subscription.generation = boundary.generation;
    subscription.headSeq = Math.max(subscription.headSeq ?? 0, boundary.headSeq);
  };

  const addNativeSubscription = (
    key: string,
    subscription: NativeSubscription,
  ): DocumentSyncCommandResult<{ readonly subscribed: true }> => {
    subscriptions.set(key, subscription);
    const registered = relocationLeaseCoordinator.subscribe(
      subscription.participantSessionKey,
      subscription.documentId,
    );
    if (registered.ok) {
      return { ok: true, value: { subscribed: true } };
    }
    subscriptions.delete(key);
    if (bindings.get(subscription.bindingKey) === key) {
      bindings.delete(subscription.bindingKey);
    }
    subscription.close();
    return nativeDocumentSyncFailure(
      "request_cancelled",
      registered.error.message,
      { retryable: true },
    );
  };

  const nativeLeaseSubscription = (
    target: DocumentSyncClientTarget,
    scope: DesktopDocumentSyncScope,
    request: DocumentRelocationLeaseResponseRequest,
  ): NativeSubscription | undefined => [...subscriptions.values()].find(
    (subscription) =>
      subscription.target === target
      && scopesMatch(subscription.scope, scope)
      && subscription.documentId === request.documentId
      && subscription.clientSessionId === request.clientSessionId,
  );

  const bindTargetLifecycle = (target: DocumentSyncClientTarget): void => {
    if (boundTargets.has(target.id)) return;
    boundTargets.add(target.id);
    target.once("destroyed", () => {
      boundTargets.delete(target.id);
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
    const subscription = subscriptions.get(canvasSceneSubscriptionKey(
      target,
      request,
    ));
    return subscription?.target === target;
  };

  const authorizeTypeScript = async (
    scope: DesktopDocumentSyncScope,
    documentId: string,
    access: DocumentAccessKind,
  ): Promise<DocumentSyncCommandError | null> => {
    const authorization = scope.kind === "project"
      ? await input.typescript.authorizeProject({
          projectId: scope.projectId,
          documentId,
          access,
        })
      : await input.typescript.authorizeLibrary({ documentId, access });
    return authorization.ok ? null : authorization.error;
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

  const withCanvasSceneRuntime = async <Value>(
    run: (
      runtime: DesktopDataAuthorityRuntime,
    ) => Promise<CanvasCommandResult<Value>> | CanvasCommandResult<Value>,
    mutationId?: string,
  ): Promise<CanvasCommandResult<Value>> => {
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
    if (runtime.backend === "typescript") {
      return await input.typescript.applyDocumentMutation(request);
    }
    const adapter = adapterFor(runtime, {
      kind: "project",
      projectId: request.projectId,
    });
    const replayOrFence = await adapter.applyDocumentMutation(request, false);
    if (
      replayOrFence.ok
      || replayOrFence.error.code !== "write_fence_required"
    ) {
      return replayOrFence;
    }

    documentMutationLeaseSequence += 1;
    const leaseId = `native-document-mutation:${documentMutationLeaseSequence.toString(36)}:${createHash("sha256")
      .update(request.mutationId)
      .digest("hex")
      .slice(0, 16)}`;
    const boundary: NativeDocumentMutationLeaseBoundary = {
      leaseId,
      projectId: request.projectId,
      documentId: request.documentId,
      storeEpoch: request.storeEpoch,
      generation: request.generation,
      headSeq: request.expectedHeadSeq,
    };
    documentMutationLeaseBoundaries.set(leaseId, boundary);
    let prepared;
    try {
      prepared = await relocationLeaseCoordinator.prepare({
        leaseId,
        documents: [{
          documentId: request.documentId,
          generation: request.generation,
          expectedHeadSeq: request.expectedHeadSeq,
        }],
      });
    } catch (error) {
      relocationLeaseCoordinator.cancel(leaseId);
      documentMutationLeaseBoundaries.delete(leaseId);
      return {
        ok: false,
        error: documentMutationFailure(
          "document_write_lease_timeout",
          error instanceof Error ? error.message : String(error),
          { mutationId: request.mutationId, retryable: true },
        ),
      };
    }
    if (!prepared.ok) {
      documentMutationLeaseBoundaries.delete(leaseId);
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
      relocationLeaseCoordinator.cancel(leaseId);
      documentMutationLeaseBoundaries.delete(leaseId);
      return {
        ok: false,
        error: documentMutationFailure(
          "unknown",
          "Document mutation lease omitted its resolved head",
          { mutationId: request.mutationId, retryable: true },
        ),
      };
    }
    if (resolved.headSeq !== request.expectedHeadSeq) {
      relocationLeaseCoordinator.cancel(leaseId);
      documentMutationLeaseBoundaries.delete(leaseId);
      return {
        ok: false,
        error: documentMutationFailure(
          "document_head_conflict",
          `Document ${request.documentId} advanced while editors flushed for the mutation`,
          {
            mutationId: request.mutationId,
            expectedHeadSeq: request.expectedHeadSeq,
            actualHeadSeq: resolved.headSeq,
          },
        ),
      };
    }

    const committed = await adapter.applyDocumentMutation(request, true);
    if (!committed.ok) {
      relocationLeaseCoordinator.cancel(leaseId);
      documentMutationLeaseBoundaries.delete(leaseId);
      return committed;
    }
    boundary.headSeq = committed.value.headSeq;
    for (const [key, subscription] of subscriptions) {
      if (
        subscription.scope.kind !== "project"
        || subscription.scope.projectId !== request.projectId
        || subscription.documentId !== request.documentId
      ) {
        continue;
      }
      adoptSubscriptionBoundary(key, {
        storeEpoch: committed.value.storeEpoch,
        generation: committed.value.generation,
        headSeq: committed.value.headSeq,
      });
    }
    const released = relocationLeaseCoordinator.release(leaseId);
    if (!released.ok) {
      for (const subscription of subscriptions.values()) {
        if (
          subscription.scope.kind !== "project"
          || subscription.scope.projectId !== request.projectId
          || subscription.documentId !== request.documentId
        ) {
          continue;
        }
        safeSendToWebContents(
          subscription.target,
          DOCUMENT_SYNC_EVENT_CHANNEL,
          [{
            kind: "relocation-lease-release",
            leaseId,
            documentId: request.documentId,
            clientSessionId: subscription.clientSessionId,
            storeEpoch: committed.value.storeEpoch,
            generation: committed.value.generation,
            headSeq: committed.value.headSeq,
          }],
        );
      }
    }
    documentMutationLeaseBoundaries.delete(leaseId);
    return committed;
  };

  return {
    getOwnedDocumentDescriptor: async (projectId, ownerBlockId) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.getOwnedDocumentDescriptor(
          projectId,
          ownerBlockId,
        );
      }
      const descriptor = await adapterFor(runtime, { kind: "project", projectId })
        .readDescriptor({
          ownerBlockId,
          clientSessionId: "electron:owned-document:descriptor",
        });
      if (descriptor.projectId === projectId) return descriptor;
      throw new Error("Core Owned Document descriptor escaped its Project boundary");
    },
    prepareOwnedBlockDocument: async (projectId, ownerBlockId) =>
      await withRuntime(async (runtime) => {
        if (runtime.backend === "typescript") {
          return await input.typescript.prepareOwnedBlockDocument(
            projectId,
            ownerBlockId,
          );
        }
        const scope = { kind: "project", projectId } as const;
        const prepared = await adapterFor(runtime, scope).prepareOwner({
          ownerBlockId,
          ...ownerCommandIdentity(
            scope,
            ownerBlockId,
            runtime.rootClient.handshake.store_epoch,
            runtime.rootClient.handshake.connection_binding,
          ),
        });
        if (!prepared.ok || prepared.value.projectId === projectId) return prepared;
        return documentSyncUnauthorized();
      }),
    prepareLibraryOwnedBlockDocument: async (ownerBlockId) =>
      await withRuntime(async (runtime) => {
        if (runtime.backend === "typescript") {
          return await input.typescript.prepareLibraryOwnedBlockDocument(
            ownerBlockId,
          );
        }
        const scope = { kind: "library" } as const;
        const prepared = await adapterFor(runtime, scope).prepareOwner({
          ownerBlockId,
          ...ownerCommandIdentity(
            scope,
            ownerBlockId,
            runtime.rootClient.handshake.store_epoch,
            runtime.rootClient.handshake.connection_binding,
          ),
        });
        if (!prepared.ok) return prepared;
        return {
          ok: true,
          value: toLibraryOwnedDocumentDescriptor(prepared.value),
        };
      }),
    subscribe: async (scope, target, request) => await withRuntime(async (runtime) => {
      if (runtime.backend === "typescript") {
        const blocked = await authorizeTypeScript(
          scope,
          request.documentId,
          "read",
        );
        if (blocked) return { ok: false, error: blocked };
        return input.typescript.hub.subscribe(target, request);
      }
      if (target.isDestroyed()) return documentSyncUnauthorized();
      const adapter = adapterFor(runtime, scope);
      const key = subscriptionKey(target, scope, request);
      if (subscriptions.has(key)) {
        return { ok: true, value: { subscribed: true } };
      }
      const ownerKey = bindingKey(request);
      if (bindings.has(ownerKey)) return documentSyncUnauthorized();
      bindTargetLifecycle(target);
      if (target.isDestroyed()) return documentSyncUnauthorized();
      bindings.set(ownerKey, key);
      let close: () => void;
      try {
        close = adapter.subscribe(request, (event) => {
          if (
            event.kind === "document-update"
            || event.kind === "resync-required"
          ) {
            adoptSubscriptionBoundary(key, {
              storeEpoch: event.storeEpoch,
              generation: event.generation,
              headSeq: event.headSeq,
            });
          }
          safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
        });
      } catch (error) {
        bindings.delete(ownerKey);
        return transportUnavailable(error);
      }
      const subscribed = addNativeSubscription(key, {
        bindingKey: ownerKey,
        participantSessionKey: participantSessionKey(key),
        scope,
        documentId: request.documentId,
        clientSessionId: request.clientSessionId,
        target,
        targetId: target.id,
        close,
      });
      if (!subscribed.ok) return subscribed;
      if (target.isDestroyed()) {
        closeSubscription(key);
        return documentSyncUnauthorized();
      }
      return subscribed;
    }),
    unsubscribe: async (scope, target, request) => await withRuntime((runtime) => {
      if (runtime.backend === "typescript") {
        return input.typescript.hub.unsubscribe(target, request);
      }
      const key = subscriptionKey(target, scope, request);
      if (subscriptions.get(key)?.target === target) closeSubscription(key);
      return { ok: true, value: { unsubscribed: true } };
    }),
    sync: async (scope, target, request) => await withRuntime(async (runtime) => {
      if (runtime.backend === "typescript") {
        const blocked = await authorizeTypeScript(
          scope,
          request.documentId,
          "read",
        );
        if (blocked) return { ok: false, error: blocked };
        return await input.typescript.hub.sync(target, request);
      }
      const adapter = adapterFor(runtime, scope);
      if (!hasNativeSubscription(target, scope, request)) {
        return documentSyncUnauthorized();
      }
      const result = await adapter.sync(request);
      if (result.ok) adoptSubscriptionBoundary(
        subscriptionKey(target, scope, request),
        result.value,
      );
      return result;
    }),
    applyUpdate: async (scope, target, request) => await withRuntime(async (runtime) => {
      if (runtime.backend === "typescript") {
        const blocked = await authorizeTypeScript(
          scope,
          request.documentId,
          "write",
        );
        if (blocked) return { ok: false, error: blocked };
        return await input.typescript.hub.applyUpdate(target, request);
      }
      const adapter = adapterFor(runtime, scope);
      if (!hasNativeSubscription(target, scope, request)) {
        return documentSyncUnauthorized();
      }
      const result = await adapter.applyUpdate(request);
      if (result.ok) {
        adoptSubscriptionBoundary(subscriptionKey(target, scope, request), {
          storeEpoch: result.value.storeEpoch,
          generation: result.value.generation,
          headSeq: result.value.headSeq,
        });
      }
      return result;
    }),
    publishAwareness: async (scope, target, request) => await withRuntime(async (runtime) => {
      if (runtime.backend === "typescript") {
        const blocked = await authorizeTypeScript(
          scope,
          request.documentId,
          "read",
        );
        if (blocked) return { ok: false, error: blocked };
        return await input.typescript.hub.publishAwareness(target, request);
      }
      const adapter = adapterFor(runtime, scope);
      if (!hasNativeSubscription(target, scope, request)) {
        return documentSyncUnauthorized();
      }
      return await adapter.publishAwareness(request);
    }),
    respondToRelocationLease: async (scope, target, request) => await withRuntime(async (runtime) => {
      if (runtime.backend === "typescript") {
        const blocked = await authorizeTypeScript(
          scope,
          request.documentId,
          "read",
        );
        if (blocked) return { ok: false, error: blocked };
        return await input.typescript.hub.respondToRelocationLease(
          target,
          request,
        );
      }
      let parsed: DocumentRelocationLeaseResponseRequest;
      try {
        parsed = parseDocumentRelocationLeaseResponseRequest(request);
      } catch (error) {
        return nativeDocumentSyncFailure(
          "invalid_document_update",
          error instanceof Error ? error.message : String(error),
        );
      }
      const subscription = nativeLeaseSubscription(target, scope, parsed);
      if (!subscription) return documentSyncUnauthorized();
      const boundary = documentMutationLeaseBoundaries.get(parsed.leaseId);
      if (
        !boundary
        || scope.kind !== "project"
        || boundary.projectId !== scope.projectId
        || boundary.documentId !== parsed.documentId
      ) {
        return nativeDocumentSyncFailure(
          "request_cancelled",
          "Document restore write lease is no longer active",
        );
      }
      if (
        boundary.storeEpoch !== parsed.storeEpoch
        || boundary.generation !== parsed.generation
        || (subscription.storeEpoch !== undefined
          && subscription.storeEpoch !== parsed.storeEpoch)
        || (subscription.generation !== undefined
          && subscription.generation !== parsed.generation)
        || (parsed.response === "ack" && parsed.headSeq < boundary.headSeq)
        || (subscription.headSeq !== undefined
          && parsed.headSeq < subscription.headSeq)
      ) {
        return nativeDocumentSyncFailure(
          boundary.storeEpoch !== parsed.storeEpoch
            || (subscription.storeEpoch !== undefined
              && subscription.storeEpoch !== parsed.storeEpoch)
            ? "store_epoch_mismatch"
            : boundary.generation !== parsed.generation
                || (subscription.generation !== undefined
                  && subscription.generation !== parsed.generation)
              ? "document_generation_mismatch"
              : "invalid_response",
          "Document restore write-lease response crossed its subscription boundary",
          { resetRequired: true },
        );
      }
      const coordinatorResult = parsed.response === "ack"
        ? relocationLeaseCoordinator.acknowledge({
            leaseId: parsed.leaseId,
            participantSessionKey: subscription.participantSessionKey,
            documentId: parsed.documentId,
            generation: parsed.generation,
            headSeq: parsed.headSeq,
          })
        : relocationLeaseCoordinator.nack({
            leaseId: parsed.leaseId,
            participantSessionKey: subscription.participantSessionKey,
            documentId: parsed.documentId,
            message: parsed.message,
          });
      if (!coordinatorResult.ok) {
        if (coordinatorResult.error.code === "participant_not_expected") {
          return documentSyncUnauthorized();
        }
        return nativeDocumentSyncFailure(
          coordinatorResult.error.code === "document_generation_mismatch"
            ? "document_generation_mismatch"
            : "invalid_response",
          coordinatorResult.error.message,
          {
            resetRequired:
              coordinatorResult.error.code === "document_generation_mismatch",
          },
        );
      }
      if (parsed.response === "ack") {
        subscription.storeEpoch = parsed.storeEpoch;
        subscription.generation = parsed.generation;
        subscription.headSeq = parsed.headSeq;
      }
      return {
        ok: true,
        value: {
          accepted: true,
          leaseId: parsed.leaseId,
          documentId: parsed.documentId,
          status: parsed.response === "ack" ? "frozen" : "cancelled",
        },
      };
    }),
    subscribeCanvasScene: async (target, request) =>
      await withCanvasSceneRuntime(async (runtime) => {
        if (runtime.backend === "typescript") {
          return input.typescript.hub.subscribeCanvasScene(target, request);
        }
        if (target.isDestroyed() || !hasCanvasSceneIdentity(request)) {
          return canvasSceneUnauthorized();
        }
        const key = canvasSceneSubscriptionKey(target, request);
        const existing = subscriptions.get(key);
        if (existing?.target === target) {
          return { ok: true, value: { subscribed: true } };
        }
        const ownerKey = bindingKey(request);
        if (bindings.has(ownerKey)) return canvasSceneUnauthorized();
        bindTargetLifecycle(target);
        if (target.isDestroyed()) return canvasSceneUnauthorized();
        const adapter = canvasSceneAdapterFor(runtime, request.projectId);
        bindings.set(ownerKey, key);
        let close: () => void;
        try {
          close = adapter.subscribe(request, (event) => {
            adoptSubscriptionBoundary(key, {
              storeEpoch: event.storeEpoch,
              generation: event.generation,
              headSeq: event.headSeq,
            });
            safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
          });
        } catch (error) {
          bindings.delete(ownerKey);
          return canvasSceneTransportUnavailable(error);
        }
        subscriptions.set(key, {
          bindingKey: ownerKey,
          participantSessionKey: participantSessionKey(key),
          scope: { kind: "project", projectId: request.projectId },
          documentId: request.documentId,
          clientSessionId: request.clientSessionId,
          target,
          targetId: target.id,
          close,
        });
        const registered = relocationLeaseCoordinator.subscribe(
          participantSessionKey(key),
          request.documentId,
        );
        if (!registered.ok) {
          const subscription = subscriptions.get(key);
          subscriptions.delete(key);
          bindings.delete(ownerKey);
          subscription?.close();
          return canvasSceneFailure(
            "unknown",
            registered.error.message,
            { retryable: true },
          );
        }
        if (target.isDestroyed()) {
          closeSubscription(key);
          return canvasSceneUnauthorized();
        }
        return { ok: true, value: { subscribed: true } };
      }),
    unsubscribeCanvasScene: async (target, request) =>
      await withCanvasSceneRuntime((runtime) => {
        if (runtime.backend === "typescript") {
          return input.typescript.hub.unsubscribeCanvasScene(target, request);
        }
        if (!hasCanvasSceneIdentity(request)) return canvasSceneUnauthorized();
        const key = canvasSceneSubscriptionKey(target, request);
        if (subscriptions.get(key)?.target === target) closeSubscription(key);
        return { ok: true, value: { unsubscribed: true } };
      }),
    syncCanvasScene: async (target, request) =>
      await withCanvasSceneRuntime(async (runtime) => {
        if (runtime.backend === "typescript") {
          return await input.typescript.hub.syncCanvasScene(target, request);
        }
        if (!hasNativeCanvasSceneSubscription(target, request)) {
          return canvasSceneUnauthorized();
        }
        const result = await canvasSceneAdapterFor(runtime, request.projectId)
          .sync(request);
        if (result.ok) {
          adoptSubscriptionBoundary(
            canvasSceneSubscriptionKey(target, request),
            result.value,
          );
        }
        return result;
      }),
    applyCanvasSceneMutation: async (target, request) =>
      await withCanvasSceneRuntime(async (runtime) => {
        if (runtime.backend === "typescript") {
          return await input.typescript.hub.applyCanvasSceneMutation(
            target,
            request,
          );
        }
        if (!hasNativeCanvasSceneSubscription(target, request)) {
          return canvasSceneUnauthorized(request.mutationId);
        }
        const result = await canvasSceneAdapterFor(runtime, request.projectId)
          .applyMutation(request);
        if (result.ok) {
          adoptSubscriptionBoundary(
            canvasSceneSubscriptionKey(target, request),
            result.value,
          );
        }
        return result;
      }, request.mutationId),
    applyAdditionalDocumentCommand: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.hub.applyAdditionalDocumentCommand(request);
      }
      return await adapterFor(runtime, {
        kind: "project",
        projectId: request.projectId,
      }).applyAdditionalDocumentCommand(request);
    },
    createCheckpoint: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.createCheckpoint(request);
      }
      return await adapterFor(runtime, {
        kind: "project",
        projectId: request.projectId,
      }).createCheckpoint(request);
    },
    listVersions: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.listVersions(request);
      }
      return await adapterFor(runtime, {
        kind: "project",
        projectId: request.projectId,
      }).listVersions(request);
    },
    getVersion: async (request) => {
      const runtime = await input.authority;
      if (runtime.backend === "typescript") {
        return await input.typescript.getVersion(request);
      }
      return await adapterFor(runtime, {
        kind: "project",
        projectId: request.projectId,
      }).getVersion(request);
    },
    applyDocumentMutation,
    restoreVersion: async (request) => await applyDocumentMutation(request),
  };
}
