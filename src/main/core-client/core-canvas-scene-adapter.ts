import {
  CANVAS_SCENE_SYNC_VERSION,
  canonicalizeCanvasSceneMutationRequest,
  canonicalizeCanvasSceneMutationResult,
  type CanvasSceneMutationCommandResult,
  type CanvasSceneMutationError,
  type CanvasSceneMutationRequest,
  type CanvasSceneRealtimeEvent,
  type CanvasSceneSubscribeRequest,
  type CanvasSceneSyncCommandResult,
  type CanvasSceneSyncRequest,
} from "../../shared/block-documents/canvas-scene-sync";
import {
  decodeCanvasSceneSseEvent,
  decodeCanvasSceneSyncResultHttp,
} from "../../shared/block-documents/canvas-scene-http-contract";
import { decodeOwnedDocumentDescriptorHttp } from "../../shared/block-documents/http-contract";
import { CoreModuleResponseError } from "./core-client";
import type {
  CoreClientPort,
  CoreEventEnvelope,
  CoreEventSubscription,
} from "./types";

interface ActiveSubscription {
  readonly ready: Promise<void>;
  close(): void;
}

type CanvasFailure = Extract<
  CanvasSceneMutationCommandResult,
  { readonly ok: false }
>;

export interface CoreCanvasSceneAdapter {
  subscribe(
    request: CanvasSceneSubscribeRequest,
    listener: (event: CanvasSceneRealtimeEvent) => void,
  ): () => void;
  sync(request: CanvasSceneSyncRequest): Promise<CanvasSceneSyncCommandResult>;
  applyMutation(
    request: CanvasSceneMutationRequest,
  ): Promise<CanvasSceneMutationCommandResult>;
}

const subscriptionKey = (
  request: Pick<CanvasSceneSubscribeRequest, "clientSessionId" | "documentId">,
): string => JSON.stringify([request.clientSessionId, request.documentId]);

export const createCoreCanvasSceneAdapter = (
  client: CoreClientPort,
): CoreCanvasSceneAdapter => {
  const subscriptions = new Map<string, ActiveSubscription>();
  const lastSequences = new Map<string, number>();

  const requireSubscription = (
    request: Pick<CanvasSceneSubscribeRequest, "clientSessionId" | "documentId">,
  ): Promise<void> => {
    const subscription = subscriptions.get(subscriptionKey(request));
    if (subscription) return subscription.ready;
    return Promise.reject(
      new Error("Canvas scene sync requires an active event subscription"),
    );
  };

  return {
    subscribe: (request, listener) => {
      const key = subscriptionKey(request);
      subscriptions.get(key)?.close();
      let active = true;
      let opened: CoreEventSubscription | undefined;
      const ready = client.openDocumentEventStream(
        {
          documentId: request.documentId,
          clientSessionId: request.clientSessionId,
          after: lastSequences.get(key) ?? 0,
        },
        (envelope) => {
          const event = canvasEvent(request, envelope);
          if (!event) return;
          const previous = lastSequences.get(key) ?? 0;
          if (envelope.event.sequence <= previous) return;
          lastSequences.set(key, envelope.event.sequence);
          listener(event);
        },
        (resync) => {
          lastSequences.set(key, resync.event_head);
          listener({
            type: "canvas_scene_resync_required",
            version: CANVAS_SCENE_SYNC_VERSION,
            projectId: request.projectId,
            documentId: resync.document_id,
            storeEpoch: resync.store_epoch,
            generation: resync.generation,
            headSeq: resync.head_seq,
          });
        },
        () => undefined,
      ).then((subscription) => {
        opened = subscription;
        if (!active) subscription.close();
      });
      const subscription: ActiveSubscription = {
        ready,
        close: () => {
          if (!active) return;
          active = false;
          opened?.close();
          if (subscriptions.get(key) === subscription) {
            subscriptions.delete(key);
          }
        },
      };
      subscriptions.set(key, subscription);
      void ready.catch(() => subscription.close());
      return subscription.close;
    },
    sync: async (request) => {
      try {
        await requireSubscription(request);
        const snapshot = await client.documentRead(request.clientSessionId, {
          kind: "sync_canvas",
          document_id: request.documentId,
        });
        if (snapshot.value.kind !== "canvas_sync") {
          throw new Error("Core returned a non-Canvas Document sync value");
        }
        const descriptor = decodeOwnedDocumentDescriptorHttp(
          JSON.stringify(snapshot.value.descriptor),
        );
        if (
          descriptor.projectId !== request.projectId
          || descriptor.documentId !== request.documentId
          || descriptor.sync.kind !== "canvas_scene"
        ) {
          throw new Error("Core Canvas sync escaped its Project or Document boundary");
        }
        if (
          request.knownStoreEpoch !== undefined
          && request.knownStoreEpoch !== snapshot.store_epoch
        ) {
          return canvasFailure("store_epoch_mismatch", {
            message: "Canvas scene sync belongs to another store epoch",
            resetRequired: true,
          });
        }
        return decodeCanvasSceneSyncResultHttp(JSON.stringify({
          ok: true,
          value: {
            version: CANVAS_SCENE_SYNC_VERSION,
            projectId: request.projectId,
            documentId: request.documentId,
            storeEpoch: snapshot.store_epoch,
            generation: descriptor.generation,
            headSeq: descriptor.headSeq,
            sceneHash: snapshot.value.scene_hash,
            scene: JSON.parse(
              new TextDecoder().decode(Uint8Array.from(snapshot.value.scene_json)),
            ) as unknown,
          },
        }));
      } catch (error) {
        return canvasErrorResult(error);
      }
    },
    applyMutation: async (request) => {
      try {
        await requireSubscription(request);
        const canonical = canonicalizeCanvasSceneMutationRequest(request);
        const committed = await client.documentApply({
          operationId: canonical.mutationId,
          clientSessionId: canonical.clientSessionId,
          intent: {
            kind: "apply_canvas_mutation",
            document_id: canonical.documentId,
            generation: canonical.generation,
            expected_head_seq: canonical.baseHeadSeq,
            mutation: {
              elementCandidates: canonical.elementCandidates,
              appStateIntents: canonical.appStateIntents,
              fileAdditions: canonical.fileAdditions,
            },
          },
        });
        if (committed.value.canvas === undefined) {
          throw new Error("Core Canvas mutation response has no Canvas result");
        }
        const value = canonicalizeCanvasSceneMutationResult(
          committed.value.canvas,
        );
        if (
          value.projectId !== canonical.projectId
          || value.documentId !== canonical.documentId
          || value.mutationId !== canonical.mutationId
        ) {
          throw new Error("Core Canvas mutation escaped its request boundary");
        }
        return { ok: true, value };
      } catch (error) {
        return canvasErrorResult(error, request.mutationId);
      }
    },
  };
};

const canvasEvent = (
  request: CanvasSceneSubscribeRequest,
  envelope: CoreEventEnvelope,
): CanvasSceneRealtimeEvent | null => {
  const payload = envelope.event.payload;
  if (payload.module !== "owned_document") return null;
  const event = payload.event;
  if (event.kind !== "canvas_updated" || event.document_id !== request.documentId) {
    return null;
  }
  if (!envelope.event.operation_id) return null;
  if (typeof event.mutation !== "object" || event.mutation === null) return null;
  try {
    return decodeCanvasSceneSseEvent(JSON.stringify({
      type: "canvas_scene_committed",
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: request.projectId,
      documentId: event.document_id,
      storeEpoch: envelope.event.store_epoch,
      generation: event.generation,
      mutationId: envelope.event.operation_id,
      baseHeadSeq: event.base_head_seq,
      headSeq: event.head_seq,
      sceneHash: event.scene_hash,
      ...event.mutation,
    }));
  } catch {
    return null;
  }
};

const canvasErrorResult = (
  error: unknown,
  mutationId?: string,
): CanvasFailure => ({
  ok: false,
  error: canvasCommandError(error, mutationId),
});

const canvasFailure = (
  code: CanvasSceneMutationError["code"],
  input: {
    readonly message: string;
    readonly resetRequired?: boolean;
    readonly retryable?: boolean;
    readonly mutationId?: string;
  },
): CanvasFailure => ({
  ok: false,
  error: {
    code,
    message: input.message,
    retryable: input.retryable ?? false,
    resetRequired: input.resetRequired ?? false,
    ...(input.mutationId ? { mutationId: input.mutationId } : {}),
  },
});

const canvasCommandError = (
  error: unknown,
  mutationId?: string,
): CanvasSceneMutationError => {
  if (error instanceof CoreModuleResponseError) {
    const code = error.coreError.code;
    return {
      code: mapCoreErrorCode(code),
      message: error.message,
      retryable: error.coreError.retryable,
      resetRequired:
        code === "stale_store_epoch" || code === "generation_conflict",
      ...(mutationId ? { mutationId } : {}),
    };
  }
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    resetRequired: false,
    ...(mutationId ? { mutationId } : {}),
  };
};

const mapCoreErrorCode = (
  code: CoreModuleResponseError["coreError"]["code"],
): CanvasSceneMutationError["code"] => {
  switch (code) {
    case "unauthorized":
      return "project_scope_mismatch";
    case "not_found":
      return "document_not_found";
    case "stale_store_epoch":
      return "store_epoch_mismatch";
    case "generation_conflict":
      return "document_generation_mismatch";
    case "head_conflict":
      return "future_base_head";
    case "idempotency_key_reused":
      return "mutation_id_collision";
    case "invalid_document_schema":
    case "schema_unsupported":
      return "document_engine_mismatch";
    case "store_corrupt":
      return "canvas_scene_corrupt";
    case "invalid_input":
      return "invalid_canvas_scene_mutation";
    default:
      return "unknown";
  }
};
