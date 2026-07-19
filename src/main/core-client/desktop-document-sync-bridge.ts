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
  target.id,
  scopeKey(scope),
  request.clientSessionId,
  request.documentId,
]);

const bindingKey = (
  request: DocumentSyncSubscribeRequest,
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

export function createDesktopDocumentSyncBridge(
  input: DesktopDocumentSyncBridgeInput,
): DesktopDocumentSyncPort {
  const adapters = new Map<string, DocumentSyncAdapter>();
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
  ): boolean => subscriptions.has(subscriptionKey(target, scope, request));

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
      subscriptions.set(key, { bindingKey: ownerKey, targetId: target.id, close });
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
      closeSubscription(subscriptionKey(target, scope, request));
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
  };
}
