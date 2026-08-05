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
import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
  BlockTransferReceipt,
} from "../../shared/block-transfer";
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
import type {
  CanvasSceneCompactionCommandResult,
  CanvasSceneCompactionReadCommandResult,
  CanvasSceneCompactionReadRequest,
  CanvasSceneCompactionRequest,
} from "../../shared/block-documents/canvas-scene-maintenance";
import {
  toLibraryOwnedDocumentDescriptor,
  type LibraryOwnedDocumentDescriptor,
  type OwnedDocumentDescriptor,
  type DocumentCommitRef,
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
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
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

const DOCUMENT_SYNC_EVENT_CHANNEL = "document-sync:event";

export type DesktopDocumentSyncScope =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "library" };

const toProjectAccessDocumentDescriptor = (
  projectId: string,
  descriptor: OwnedDocumentDescriptor,
): OwnedDocumentDescriptor => ({
  ...descriptor,
  projectId,
});

type NativeNodexAgentMutationResult =
  | ExecuteNodexAgentCreatePagesResult
  | ExecuteNodexAgentDuplicatePageResult
  | ExecuteNodexAgentMovePagesResult;

type SuccessfulNativeNodexAgentMutation = Extract<
  NativeNodexAgentMutationResult,
  { readonly ok: true }
>;

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
  publishDocumentCommits(input: {
    readonly scope: DesktopDocumentSyncScope;
    readonly storeEpoch: string;
    readonly commits: readonly DocumentCommitRef[];
    readonly clientSessionId: string;
    readonly resyncOnly?: boolean;
  }): void;
  publishLibraryDocumentCommits(input: {
    readonly storeEpoch: string;
    readonly commits: readonly DocumentCommitRef[];
    readonly clientSessionId: string;
  }): void;
  executeNodexAgentMutation<
    Result extends NativeNodexAgentMutationResult,
  >(options: NativeNodexAgentMutationExecution<Result>): Promise<Result>;
}

export interface DesktopDocumentSyncBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly canvasPresenceHub?: CanvasPresenceHub;
}

interface NativeSubscription {
  readonly engine: "yjs" | "canvas_scene";
  readonly bindingKey: string;
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

const scopesMatch = (
  left: DesktopDocumentSyncScope,
  right: DesktopDocumentSyncScope,
): boolean => left.kind === right.kind
  && (left.kind === "library"
    || (right.kind === "project" && left.projectId === right.projectId));

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
): boolean => request.version === 1
  && request.projectId.length > 0
  && request.documentId.length > 0
  && request.clientSessionId.length > 0;

export function createDesktopDocumentSyncBridge(
  input: DesktopDocumentSyncBridgeInput,
): DesktopDocumentSyncPort {
  const adapters = new Map<string, CoreDocumentSyncAdapter>();
  const canvasSceneAdapters = new Map<string, CoreCanvasSceneAdapter>();
  const blockTransferAdapters = new Map<string, CoreBlockTransferAdapter>();
  const subscriptions = new Map<string, NativeSubscription>();
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
    projectId: string,
  ): CoreCanvasSceneAdapter => {
    let adapter = canvasSceneAdapters.get(projectId);
    if (adapter) return adapter;
    adapter = createCoreCanvasSceneAdapter(runtime.clientForProject(projectId));
    canvasSceneAdapters.set(projectId, adapter);
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
    if (bindings.get(subscription.bindingKey) === key) {
      bindings.delete(subscription.bindingKey);
    }
    subscription.close();
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
    subscription.storeEpoch = boundary.storeEpoch;
    subscription.generation = boundary.generation;
    subscription.headSeq = Math.max(subscription.headSeq ?? 0, boundary.headSeq);
    if (
      subscription.engine === "canvas_scene"
      && previousGeneration !== boundary.generation
    ) {
      canvasPresenceHub.adoptBoundary(key, boundary.generation);
    }
  };

  const addNativeSubscription = (
    key: string,
    subscription: NativeSubscription,
  ): DocumentSyncCommandResult<{ readonly subscribed: true }> => {
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
    const adapter = adapterFor(runtime, {
      kind: "project",
      projectId: request.projectId,
    });
    const committed = await adapter.applyDocumentMutation(request);
    if (!committed.ok) {
      return committed;
    }
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
      const adapter = canvasSceneAdapterFor(runtime, request.projectId);
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
      return committed;
    }, request.mutationId);

  const fanoutDocumentCommits = (
    matchesSubscription: (subscription: NativeSubscription) => boolean,
    storeEpoch: string,
    commits: readonly DocumentCommitRef[],
    resyncOnly: boolean,
    clientSessionId: string,
  ): void => {
    for (const commit of commits) {
      const targets = new Map<number, DocumentSyncClientTarget>();
      for (const [key, subscription] of subscriptions) {
        if (
          subscription.engine !== "yjs"
          || !matchesSubscription(subscription)
          || subscription.documentId !== commit.documentId
        ) {
          continue;
        }
        adoptSubscriptionBoundary(key, {
          storeEpoch,
          generation: commit.generation,
          headSeq: commit.headSeq,
        });
        targets.set(subscription.targetId, subscription.target);
      }
      const event = resyncOnly || commit.update === null
        ? {
            kind: "resync-required" as const,
            documentId: commit.documentId,
            storeEpoch,
            generation: commit.generation,
            headSeq: commit.headSeq,
            reason: commit.update === null
              ? "history-compacted" as const
              : "event-gap" as const,
          }
        : {
            kind: "document-update" as const,
            documentId: commit.documentId,
            storeEpoch,
            generation: commit.generation,
            headSeq: commit.headSeq,
            updateId: commit.updateId,
            clientSessionId,
            update: commit.update.slice(),
          };
      for (const target of targets.values()) {
        safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
      }
    }
  };

  const fanoutScopedDocumentCommits = (
    scope: DesktopDocumentSyncScope,
    storeEpoch: string,
    commits: readonly DocumentCommitRef[],
    resyncOnly: boolean,
    clientSessionId: string,
  ): void => fanoutDocumentCommits(
    (subscription) => scopesMatch(subscription.scope, scope),
    storeEpoch,
    commits,
    resyncOnly,
    clientSessionId,
  );

  const fanoutBlockTransfer = (
    projectId: string,
    receipt: BlockTransferReceipt,
    resyncOnly: boolean,
  ): void => fanoutScopedDocumentCommits(
    { kind: "project", projectId },
    receipt.storeEpoch,
    receipt.documentCommits,
    resyncOnly,
    "rust:block-transfer",
  );

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
    if (result.ok) {
      fanoutBlockTransfer(intent.projectId, result.value, false);
    }
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

    const success = result as Result & SuccessfulNativeNodexAgentMutation;
    fanoutScopedDocumentCommits(
      { kind: "project", projectId: options.projectId },
      options.storeEpoch,
      success.value.documentCommits,
      false,
      "rust:nodex-agent",
    );
    return result;
  };

  return {
    getOwnedDocumentDescriptor: async (projectId, ownerBlockId) => {
      const runtime = await input.authority;
      const descriptor = await adapterFor(runtime, { kind: "project", projectId })
        .readDescriptor({
          ownerBlockId,
          clientSessionId: "electron:owned-document:descriptor",
        });
      return toProjectAccessDocumentDescriptor(projectId, descriptor);
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
          value: toProjectAccessDocumentDescriptor(
            projectId,
            prepared.value,
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
          value: toLibraryOwnedDocumentDescriptor(prepared.value),
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
          lifecycle = adapter.subscribeWithLifecycle(request, (event) => {
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
          pending.attachClose(lifecycle.close);
          await lifecycle.ready;
        } catch (error) {
          lifecycle?.close();
          if (bindings.get(ownerKey) === key) bindings.delete(ownerKey);
          return transportUnavailable(error);
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
        });
        if (!subscribed.ok) return subscribed;
        void lifecycle.done.catch(() => undefined).finally(() => {
          if (subscriptions.get(key)?.close === lifecycle.close) {
            closeSubscription(key);
          }
        });
        if (target.isDestroyed()) {
          closeSubscription(key);
          return documentSyncUnauthorized();
        }
        return subscribed;
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
      const result = await adapter.sync(request);
      if (result.ok) adoptSubscriptionBoundary(
        subscriptionKey(target, scope, request),
        result.value,
      );
      return result;
    }),
    applyUpdate: async (scope, target, request) => await withRuntime(async (runtime) => {
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
        const adapter = canvasSceneAdapterFor(runtime, request.projectId);
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
            lifecycle = adapter.subscribeWithLifecycle(request, (event) => {
              adoptSubscriptionBoundary(key, {
                storeEpoch: event.storeEpoch,
                generation: event.generation,
                headSeq: event.headSeq,
              });
              safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
            });
            pending.attachClose(lifecycle.close);
            await lifecycle.ready;
          } catch (error) {
            lifecycle?.close();
            if (bindings.get(ownerKey) === key) bindings.delete(ownerKey);
            return canvasSceneTransportUnavailable(error);
          }
          subscriptions.set(key, {
            engine: "canvas_scene",
            bindingKey: ownerKey,
            scope: { kind: "project", projectId: request.projectId },
            documentId: request.documentId,
            clientSessionId: request.clientSessionId,
            target,
            targetId: target.id,
            close: lifecycle.close,
          });
          canvasPresenceHub.register({
            key,
            projectId: request.projectId,
            documentId: request.documentId,
            clientSessionId: request.clientSessionId,
            targetId: target.id,
            send: (event) => {
              safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
            },
          });
          void lifecycle.done.catch(() => undefined).finally(() => {
            if (subscriptions.get(key)?.close === lifecycle.close) {
              closeSubscription(key);
            }
          });
          if (target.isDestroyed()) {
            closeSubscription(key);
            return canvasSceneUnauthorized();
          }
          return { ok: true, value: { subscribed: true } };
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
        projectId: parsed.projectId,
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
        return await canvasSceneAdapterFor(runtime, request.projectId)
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
    publishDocumentCommits: ({
      scope,
      storeEpoch,
      commits,
      clientSessionId,
      resyncOnly = false,
    }) => {
      fanoutScopedDocumentCommits(
        scope,
        storeEpoch,
        commits,
        resyncOnly,
        clientSessionId,
      );
    },
    publishLibraryDocumentCommits: ({
      storeEpoch,
      commits,
      clientSessionId,
    }) => {
      fanoutDocumentCommits(
        () => true,
        storeEpoch,
        commits,
        false,
        clientSessionId,
      );
    },
    executeNodexAgentMutation,
    restoreVersion: async (request) => await applyDocumentMutation(request),
  };
}
