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
  DocumentSyncAdapter,
  LibraryDocumentAccessAck,
} from "../../shared/block-documents/document-sync";
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

const DOCUMENT_SYNC_EVENT_CHANNEL = "document-sync:event";

export type DesktopDocumentSyncScope =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "library" };

export interface DesktopDocumentSyncPort {
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
  };
}

interface NativeSubscription {
  readonly bindingKey: string;
  readonly target: DocumentSyncClientTarget;
  readonly targetId: number;
  readonly close: () => void;
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
  const adapters = new Map<string, DocumentSyncAdapter>();
  const canvasSceneAdapters = new Map<string, CoreCanvasSceneAdapter>();
  const subscriptions = new Map<string, NativeSubscription>();
  const bindings = new Map<string, string>();
  const boundTargets = new Set<number>();

  const adapterFor = (
    runtime: Extract<DesktopDataAuthorityRuntime, { backend: "rust" }>,
    scope: DesktopDocumentSyncScope,
  ): DocumentSyncAdapter => {
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
    subscriptions.delete(key);
    if (bindings.get(subscription.bindingKey) === key) {
      bindings.delete(subscription.bindingKey);
    }
    subscription.close();
  };

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

  return {
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
          safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
        });
      } catch (error) {
        bindings.delete(ownerKey);
        return transportUnavailable(error);
      }
      subscriptions.set(key, {
        bindingKey: ownerKey,
        target,
        targetId: target.id,
        close,
      });
      if (target.isDestroyed()) {
        closeSubscription(key);
        return documentSyncUnauthorized();
      }
      return { ok: true, value: { subscribed: true } };
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
      return await adapter.sync(request);
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
      return await adapter.applyUpdate(request);
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
      const adapter = adapterFor(runtime, scope);
      if (!hasNativeSubscription(target, scope, request)) {
        return documentSyncUnauthorized();
      }
      return await adapter.respondToRelocationLease(request);
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
            safeSendToWebContents(target, DOCUMENT_SYNC_EVENT_CHANNEL, [event]);
          });
        } catch (error) {
          bindings.delete(ownerKey);
          return canvasSceneTransportUnavailable(error);
        }
        subscriptions.set(key, {
          bindingKey: ownerKey,
          target,
          targetId: target.id,
          close,
        });
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
        return await canvasSceneAdapterFor(runtime, request.projectId).sync(request);
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
        return await canvasSceneAdapterFor(runtime, request.projectId)
          .applyMutation(request);
      }, request.mutationId),
  };
}
