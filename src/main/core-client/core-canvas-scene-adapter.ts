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
import { CanvasSceneContractError } from "../../shared/block-documents/canvas-scene";
import { DocumentHttpWireError } from "../../shared/block-documents/http-wire";
import {
  parseCanvasSceneCompactionResult,
  parseCanvasSceneCompactionStats,
  type CanvasSceneCompactionCommandResult,
  type CanvasSceneCompactionReadCommandResult,
  type CanvasSceneCompactionReadRequest,
  type CanvasSceneCompactionRequest,
  type CanvasSceneCompactionStats,
} from "../../shared/block-documents/canvas-scene-maintenance";
import {
  decodeCanvasSceneSseEvent,
} from "../../shared/block-documents/canvas-scene-http-contract";
import { CoreModuleResponseError } from "./core-client";
import {
  isRetryableCoreEventStreamError,
  superviseCoreEventStream,
  type SupervisedCoreEventSubscription,
} from "./core-event-stream-supervisor";
import { executeWithDocumentSubscription } from "./core-document-subscription-lifecycle";
import type {
  CoreClientPort,
  CoreEventEnvelope,
  DocumentResyncRequired,
} from "./types";

type ActiveSubscription = SupervisedCoreEventSubscription;

interface CoreCanvasSceneAdapterOptions {
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly maxInitialOpenAttempts?: number;
}

type CanvasFailure = Extract<
  CanvasSceneMutationCommandResult,
  { readonly ok: false }
>;

class CanvasSceneAdapterContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasSceneAdapterContractError";
  }
}

export interface CoreCanvasSceneAdapter {
  subscribeWithLifecycle(
    request: CanvasSceneSubscribeRequest,
    listener: (event: CanvasSceneRealtimeEvent) => void,
  ): SupervisedCoreEventSubscription;
  subscribe(
    request: CanvasSceneSubscribeRequest,
    listener: (event: CanvasSceneRealtimeEvent) => void,
  ): () => void;
  sync(request: CanvasSceneSyncRequest): Promise<CanvasSceneSyncCommandResult>;
  applyMutation(
    request: CanvasSceneMutationRequest,
  ): Promise<CanvasSceneMutationCommandResult>;
  readCompaction(
    request: CanvasSceneCompactionReadRequest,
  ): Promise<CanvasSceneCompactionReadCommandResult>;
  compact(
    request: CanvasSceneCompactionRequest,
    stats: CanvasSceneCompactionStats,
    writeFencePrepared: boolean,
  ): Promise<CanvasSceneCompactionCommandResult>;
}

const subscriptionKey = (
  request: Pick<CanvasSceneSubscribeRequest, "clientSessionId" | "documentId">,
): string => JSON.stringify([request.clientSessionId, request.documentId]);

export const createCoreCanvasSceneAdapter = (
  client: CoreClientPort,
  options: CoreCanvasSceneAdapterOptions = {},
): CoreCanvasSceneAdapter => {
  const subscriptions = new Map<string, ActiveSubscription>();
  const lastSequences = new Map<string, number>();

  const subscriptionFor = (
    request: Pick<CanvasSceneSubscribeRequest, "clientSessionId" | "documentId">,
  ): ActiveSubscription => {
    const subscription = subscriptions.get(subscriptionKey(request));
    if (subscription) return subscription;
    throw new Error("Canvas scene sync requires an active event subscription");
  };

  const subscribeWithLifecycle = (
    request: CanvasSceneSubscribeRequest,
    listener: (event: CanvasSceneRealtimeEvent) => void,
  ): SupervisedCoreEventSubscription => {
    const key = subscriptionKey(request);
    const predecessor = subscriptions.get(key);
    predecessor?.close();
    const predecessorDone = predecessor?.done.catch(() => undefined)
      ?? Promise.resolve();
    const supervisor = superviseCoreEventStream<DocumentResyncRequired>({
      initialAfter: lastSequences.get(key) ?? 0,
      maxInitialOpenAttempts: options.maxInitialOpenAttempts ?? 3,
      shouldRetry: isRetryableCoreEventStreamError,
      retryDelayMs: options.retryDelayMs,
      maxRetryDelayMs: options.maxRetryDelayMs,
      open: async (after, onEvent, onResyncRequired, signal) => {
        await predecessorDone;
        if (signal.aborted) throw signal.reason;
        return await client.openDocumentEventStream(
          {
            documentId: request.documentId,
            clientSessionId: request.clientSessionId,
            after,
            signal,
          },
          onEvent,
          onResyncRequired,
          () => undefined,
        );
      },
      onEvent: (envelope) => {
        const event = canvasEvent(request, envelope);
        if (!event) return;
        const previous = lastSequences.get(key) ?? 0;
        if (envelope.event.sequence <= previous) return;
        listener(event);
        lastSequences.set(key, envelope.event.sequence);
      },
      onResyncRequired: (resync) => {
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
    });
    subscriptions.set(key, supervisor);
    void supervisor.done.catch(() => undefined).finally(() => {
      if (subscriptions.get(key) === supervisor) {
        subscriptions.delete(key);
      }
    });
    return supervisor;
  };

  return {
    subscribeWithLifecycle,
    subscribe: (request, listener) =>
      subscribeWithLifecycle(request, listener).close,
    sync: async (request) => {
      try {
        const key = subscriptionKey(request);
        const subscription = subscriptionFor(request);
        const response = await executeWithDocumentSubscription(
          subscription,
          () => subscriptions.get(key) === subscription,
          async () => await client.documentCanvasSync(request),
        );
        if (
          response.projectId !== request.projectId
          || response.documentId !== request.documentId
        ) {
          throw new CanvasSceneAdapterContractError(
            "Core Canvas sync escaped its Project or Document boundary",
          );
        }
        return { ok: true, value: response };
      } catch (error) {
        return canvasErrorResult(error);
      }
    },
    applyMutation: async (request) => {
      try {
        const canonical = canonicalizeCanvasSceneMutationRequest(request);
        const key = subscriptionKey(request);
        const subscription = subscriptionFor(request);
        const committed = await executeWithDocumentSubscription(
          subscription,
          () => subscriptions.get(key) === subscription,
          async () => await client.documentApply({
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
          }),
        );
        if (committed.value.canvas === undefined) {
          throw new CanvasSceneAdapterContractError(
            "Core Canvas mutation response has no Canvas result",
          );
        }
        const value = canonicalizeCanvasSceneMutationResult(
          committed.value.canvas,
        );
        if (
          value.projectId !== canonical.projectId
          || value.documentId !== canonical.documentId
          || value.mutationId !== canonical.mutationId
        ) {
          throw new CanvasSceneAdapterContractError(
            "Core Canvas mutation escaped its request boundary",
          );
        }
        return { ok: true, value };
      } catch (error) {
        return canvasErrorResult(error, request.mutationId);
      }
    },
    readCompaction: async (request) => {
      try {
        const key = subscriptionKey(request);
        const subscription = subscriptionFor(request);
        const snapshot = await executeWithDocumentSubscription(
          subscription,
          () => subscriptions.get(key) === subscription,
          async () => await client.documentRead(request.clientSessionId, {
            kind: "canvas_compaction_eligibility",
            document_id: request.documentId,
          }),
        );
        if (snapshot.value.kind !== "canvas_compaction_eligibility") {
          throw new CanvasSceneAdapterContractError(
            "Core returned the wrong Canvas maintenance read",
          );
        }
        const value = parseCanvasSceneCompactionStats(snapshot.value.stats);
        if (value.documentId !== request.documentId) {
          throw new CanvasSceneAdapterContractError(
            "Core Canvas maintenance read escaped its Document boundary",
          );
        }
        return { ok: true, value };
      } catch (error) {
        return canvasErrorResult(error);
      }
    },
    compact: async (request, stats, writeFencePrepared) => {
      try {
        const key = subscriptionKey(request);
        const subscription = subscriptionFor(request);
        const committed = await executeWithDocumentSubscription(
          subscription,
          () => subscriptions.get(key) === subscription,
          async () => await client.documentApply({
            operationId: request.mutationId,
            clientSessionId: request.clientSessionId,
            intent: {
              kind: "compact_canvas_tombstones",
              document_id: request.documentId,
              generation: stats.generation,
              expected_head_seq: stats.headSeq,
              actor: { kind: "canvas_tombstone_compaction" },
              write_fence_prepared: writeFencePrepared,
            },
          }),
        );
        if (committed.value.canvas === undefined) {
          throw new CanvasSceneAdapterContractError(
            "Core Canvas compaction response has no Canvas result",
          );
        }
        const value = parseCanvasSceneCompactionResult(committed.value.canvas);
        if (
          value.projectId !== request.projectId
          || value.documentId !== request.documentId
          || value.operationId !== request.mutationId
        ) {
          throw new CanvasSceneAdapterContractError(
            "Core Canvas compaction escaped its request boundary",
          );
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
  if (
    event.kind === "canvas_generation_changed"
    && event.document_id === request.documentId
  ) {
    return {
      type: "canvas_scene_resync_required",
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: request.projectId,
      documentId: event.document_id,
      storeEpoch: envelope.event.store_epoch,
      generation: event.generation,
      headSeq: event.head_seq,
    };
  }
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
  if (
    error instanceof DocumentHttpWireError
    || error instanceof CanvasSceneContractError
    || error instanceof CanvasSceneAdapterContractError
  ) {
    return {
      code: "canvas_scene_corrupt",
      message: error.message,
      retryable: false,
      resetRequired: false,
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
    case "revision_conflict":
      return "write_fence_required";
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
