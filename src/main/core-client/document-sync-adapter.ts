import { createHash } from "node:crypto";

import {
  encodeAdditionalDocumentCommandSemanticHashInput,
  parseAdditionalDocumentCommandRequest,
  parseAdditionalDocumentCommandResult,
  type AdditionalDocumentCommandErrorCode,
  type AdditionalDocumentCommandRequest,
  type AdditionalDocumentCommandResult,
  type AdditionalDocumentHeadRevision,
  type AdditionalDocumentSpacePlacement,
} from "../../shared/additional-document-commands";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import type {
  CreateDocumentVersionCheckpoint,
  CreatedDocumentVersionSummary,
  DocumentVersionDetail,
  DocumentVersionSummary,
  GetDocumentVersion,
  ListDocumentVersions,
  PrepareDocumentVersionRestore,
} from "../../shared/block-documents/document-history";
import {
  DocumentHistoryContractError,
  documentHistoryFailure,
  parseDocumentVersionDetail,
  parseDocumentVersionSummary,
  type DocumentHistoryCommandResult,
} from "../../shared/block-documents/document-history-transport";
import {
  DocumentOperationContractError,
  parseDocumentOperationResult,
  parseDocumentVersionRestore,
  type DocumentOperationCommandResult,
} from "../../shared/block-documents/document-operations";
import { documentMutationFailure } from "../../shared/block-documents/document-operation-transport";
import type {
  OwnedDocumentDescriptor,
} from "../../shared/block-documents/contracts";
import { decodeOwnedDocumentDescriptorHttp } from "../../shared/block-documents/http-contract";
import { documentBytesToBase64 } from "../../shared/block-documents/http-wire";
import type {
  DocumentAwarenessPublishRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncAdapter,
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
} from "../../shared/block-documents/document-sync";
import { CoreModuleResponseError } from "./core-client";
import type {
  CoreClientPort,
  CoreEventEnvelope,
  CoreEventSubscription,
  OwnedDocumentIntent,
} from "./types";

type CoreDocumentOwnerCommand = Extract<
  OwnedDocumentIntent,
  { readonly kind: "apply_owner_command" }
>["command"];

interface ActiveSubscription {
  readonly ready: Promise<void>;
  close(): void;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeCoreOwnedDocumentDescriptor = (
  value: unknown,
): OwnedDocumentDescriptor => {
  if (!isRecord(value) || !isRecord(value.sync)) {
    throw new Error("Core Owned Document descriptor is invalid");
  }
  if (value.sync.kind !== "yjs") {
    return decodeOwnedDocumentDescriptorHttp(JSON.stringify(value));
  }
  const stateVector = value.sync.stateVector;
  if (
    !Array.isArray(stateVector)
    || stateVector.some((byte) =>
      !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error("Core Owned Document state vector is invalid");
  }
  return decodeOwnedDocumentDescriptorHttp(JSON.stringify({
    ...value,
    sync: {
      kind: "yjs",
      stateVector: documentBytesToBase64(Uint8Array.from(stateVector)),
    },
  }));
};

export interface CoreDocumentSyncAdapter extends DocumentSyncAdapter {
  readDescriptor(input: {
    readonly ownerBlockId: string;
    readonly clientSessionId: string;
  }): Promise<OwnedDocumentDescriptor>;
  prepareOwner(input: {
    readonly ownerBlockId: string;
    readonly operationId: string;
    readonly clientSessionId: string;
  }): Promise<DocumentSyncCommandResult<OwnedDocumentDescriptor>>;
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
    writeFencePrepared?: boolean,
  ): Promise<DocumentOperationCommandResult>;
}

const executionHead = (
  request: AdditionalDocumentCommandRequest,
  revision: { readonly documentId: string; readonly generation: number },
): AdditionalDocumentHeadRevision => {
  if (request.coordination.kind === "receipt_replay") {
    return { ...revision, headSeq: 0 };
  }
  if (request.coordination.kind !== "hub_lease") {
    throw new TypeError(
      `Additional Document command is missing an execution head for ${revision.documentId}`,
    );
  }
  const head = request.coordination.documents.find(
    (candidate) => candidate.documentId === revision.documentId,
  );
  if (head?.generation === revision.generation) return head;
  throw new TypeError(
    `Additional Document command crossed the generation of ${revision.documentId}`,
  );
};

const coreHead = (
  request: AdditionalDocumentCommandRequest,
  revision: { readonly documentId: string; readonly generation: number },
) => {
  const head = executionHead(request, revision);
  return {
    document_id: head.documentId,
    generation: head.generation,
    head_seq: head.headSeq,
  };
};

const coreSpaceAnchor = (placement: AdditionalDocumentSpacePlacement) => {
  const before = placement.before;
  return before
    ? {
        block_id: before.blockId,
        expected_location_revision: before.expectedLocationRevision,
      }
    : undefined;
};

const coreOwnerCommand = (
  request: AdditionalDocumentCommandRequest,
): CoreDocumentOwnerCommand => {
  const operation = request.operation;
  switch (operation.kind) {
    case "create_synced_source":
      return {
        kind: operation.kind,
        source_block_id: operation.sourceBlockId,
        document_id: operation.documentId,
        initial_blocks: operation.initialBlocks,
        before: coreSpaceAnchor(operation.placement),
      };
    case "promote_synced_source":
      return {
        kind: operation.kind,
        host: coreHead(request, operation.host),
        root_block_id: operation.rootBlockId,
        reference_block_id: operation.referenceBlockId,
        source_block_id: operation.sourceBlockId,
        source_document_id: operation.sourceDocumentId,
      };
    case "demote_synced_source":
      return {
        kind: operation.kind,
        host: coreHead(request, operation.host),
        source: coreHead(request, operation.source),
        reference_block_id: operation.referenceBlockId,
        source_block_id: operation.sourceBlockId,
      };
    case "create_template":
      return {
        kind: operation.kind,
        source_block_id: operation.sourceBlockId,
        document_id: operation.documentId,
        display_name: operation.displayName,
        initial_blocks: operation.initialBlocks,
        before: coreSpaceAnchor(operation.placement),
      };
    case "instantiate_template":
      return {
        kind: operation.kind,
        source_block_id: operation.sourceBlockId,
        source: coreHead(request, operation.source),
        target: coreHead(request, operation.target),
        parent_block_id: operation.parentBlockId,
        before_block_id: operation.beforeBlockId,
      };
    case "delete_owned_source": {
      const ownerHead = coreHead(request, operation.owner);
      return {
        kind: operation.kind,
        owner_kind: operation.ownerKind,
        owner: {
          owner_block_id: operation.owner.ownerBlockId,
          document_id: operation.owner.documentId,
          generation: operation.owner.generation,
          head_seq: ownerHead.head_seq,
          metadata_revision: operation.owner.metadataRevision,
          location_revision: operation.owner.locationRevision,
        },
      };
    }
    case "create_canvas_owner":
      return {
        kind: operation.kind,
        block_id: operation.blockId,
        document_id: operation.documentId,
        display_name: operation.displayName,
        before: coreSpaceAnchor(operation.placement),
      };
    case "delete_canvas_owner": {
      const ownerHead = coreHead(request, operation.owner);
      return {
        kind: operation.kind,
        owner: {
          owner_block_id: operation.owner.ownerBlockId,
          document_id: operation.owner.documentId,
          generation: operation.owner.generation,
          head_seq: ownerHead.head_seq,
          metadata_revision: operation.owner.metadataRevision,
          location_revision: operation.owner.locationRevision,
        },
      };
    }
  }
};

const additionalDocumentErrorCode = (
  error: unknown,
): { readonly code: AdditionalDocumentCommandErrorCode; readonly retryable: boolean } => {
  if (!(error instanceof CoreModuleResponseError)) {
    return { code: "unknown", retryable: true };
  }
  const message = error.message.toLowerCase();
  switch (error.coreError.code) {
    case "invalid_input":
      return { code: "invalid_request", retryable: false };
    case "unauthorized":
      return { code: "project_not_found", retryable: false };
    case "not_found":
      if (message.includes("bound project")) {
        return { code: "project_not_found", retryable: false };
      }
      if (message.includes("reference") || message.includes("instance")) {
        return { code: "reference_not_found", retryable: false };
      }
      return { code: "source_not_found", retryable: false };
    case "stale_store_epoch":
      return { code: "store_epoch_mismatch", retryable: false };
    case "revision_conflict":
      if (message.includes("still referenced")) {
        return { code: "source_referenced", retryable: false };
      }
      if (message.includes("sole instance")) {
        return { code: "source_shared", retryable: false };
      }
      return { code: "block_revision_conflict", retryable: false };
    case "generation_conflict":
      return { code: "document_generation_mismatch", retryable: false };
    case "head_conflict":
      return { code: "document_head_conflict", retryable: false };
    case "idempotency_key_reused":
      return { code: "operation_id_collision", retryable: false };
    case "invalid_document_schema":
    case "schema_unsupported":
    case "store_corrupt":
      return { code: "document_state_corrupt", retryable: false };
    case "maintenance_in_progress":
      return { code: "unknown", retryable: true };
    case "core_unavailable":
      if (
        message.includes("identity already exists")
        || message.includes("cannot be reused")
        || message.includes("cannot be deleted")
      ) {
        return { code: "identity_conflict", retryable: false };
      }
      return { code: "unknown", retryable: true };
    default:
      return { code: "unknown", retryable: error.coreError.retryable };
  }
};

const additionalDocumentFailure = (
  request: AdditionalDocumentCommandRequest,
  error: unknown,
): AdditionalDocumentCommandResult => {
  const mapped = additionalDocumentErrorCode(error);
  return parseAdditionalDocumentCommandResult({
    ok: false,
    error: {
      ...mapped,
      message: error instanceof Error ? error.message : String(error),
      operationId: request.operationId,
      operationKind: request.operation.kind,
    },
  });
};

const historyFailure = <Value>(
  error: unknown,
  expected: {
    readonly generation?: number;
    readonly headSeq?: number;
  } = {},
): DocumentHistoryCommandResult<Value> => {
  if (error instanceof DocumentHistoryContractError) {
    return {
      ok: false,
      error: documentHistoryFailure("document_history_corrupt", error.message),
    };
  }
  if (!(error instanceof CoreModuleResponseError)) {
    return {
      ok: false,
      error: documentHistoryFailure(
        "unknown",
        error instanceof Error ? error.message : String(error),
        { retryable: true },
      ),
    };
  }
  const recovery = error.coreError.recovery;
  switch (error.coreError.code) {
    case "invalid_input":
      return {
        ok: false,
        error: documentHistoryFailure(
          "invalid_document_history_request",
          error.message,
        ),
      };
    case "unauthorized":
      return {
        ok: false,
        error: documentHistoryFailure("project_scope_mismatch", error.message),
      };
    case "not_found":
      return {
        ok: false,
        error: documentHistoryFailure(
          error.message.toLowerCase().includes("version") ||
              error.message.toLowerCase().includes("cursor")
            ? "document_version_not_found"
            : "document_not_found",
          error.message,
        ),
      };
    case "stale_store_epoch":
      return {
        ok: false,
        error: documentHistoryFailure("store_epoch_mismatch", error.message),
      };
    case "generation_conflict":
      return {
        ok: false,
        error: documentHistoryFailure(
          "document_generation_conflict",
          error.message,
          {
            expectedGeneration: expected.generation,
            ...(recovery.kind === "current_document_head"
              ? { actualGeneration: recovery.generation }
              : {}),
          },
        ),
      };
    case "head_conflict":
      return {
        ok: false,
        error: documentHistoryFailure("document_head_conflict", error.message, {
          expectedHeadSeq: expected.headSeq,
          ...(recovery.kind === "current_document_head"
            ? { actualHeadSeq: recovery.head_seq }
            : {}),
        }),
      };
    case "invalid_document_schema":
    case "schema_unsupported":
      return {
        ok: false,
        error: documentHistoryFailure(
          "document_version_schema_mismatch",
          error.message,
        ),
      };
    case "store_corrupt":
      return {
        ok: false,
        error: documentHistoryFailure("document_history_corrupt", error.message),
      };
    default:
      return {
        ok: false,
        error: documentHistoryFailure("unknown", error.message, {
          retryable: error.coreError.retryable,
        }),
      };
  }
};

const documentRestoreFailure = (
  request: PrepareDocumentVersionRestore,
  error: unknown,
): DocumentOperationCommandResult => {
  if (error instanceof DocumentOperationContractError) {
    return {
      ok: false,
      error: documentMutationFailure(
        "document_state_corrupt",
        error.message,
        { mutationId: request.mutationId },
      ),
    };
  }
  if (!(error instanceof CoreModuleResponseError)) {
    return {
      ok: false,
      error: documentMutationFailure(
        "unknown",
        error instanceof Error ? error.message : String(error),
        { mutationId: request.mutationId, retryable: true },
      ),
    };
  }
  const recovery = error.coreError.recovery;
  const failure = (
    code: Parameters<typeof documentMutationFailure>[0],
    options: Parameters<typeof documentMutationFailure>[2] = {},
  ): DocumentOperationCommandResult => ({
    ok: false,
    error: documentMutationFailure(code, error.message, {
      mutationId: request.mutationId,
      ...options,
    }),
  });
  switch (error.coreError.code) {
    case "invalid_input":
      return failure("invalid_document_operation_request");
    case "unauthorized":
      return failure("project_scope_mismatch");
    case "not_found":
      return failure(
        error.message.toLowerCase().includes("version")
          ? "document_version_not_found"
          : "document_not_found",
      );
    case "stale_store_epoch":
      return failure("store_epoch_mismatch");
    case "generation_conflict":
      if (recovery.kind !== "current_document_head") {
        return failure("unknown", { retryable: error.coreError.retryable });
      }
      return failure("document_generation_conflict", {
        expectedGeneration: request.generation,
        actualGeneration: recovery.generation,
      });
    case "head_conflict":
      if (recovery.kind !== "current_document_head") {
        return failure("unknown", { retryable: error.coreError.retryable });
      }
      return failure("document_head_conflict", {
        expectedHeadSeq: request.expectedHeadSeq,
        actualHeadSeq: recovery.head_seq,
      });
    case "idempotency_key_reused":
      return failure("mutation_id_collision");
    case "revision_conflict":
      if (error.message.toLowerCase().includes("write fence")) {
        return failure("write_fence_required", { retryable: true });
      }
      return failure("unknown", { retryable: error.coreError.retryable });
    case "invalid_document_schema":
    case "schema_unsupported":
      return failure("invalid_operation");
    case "store_corrupt":
      return failure("document_state_corrupt");
    default:
      return failure("unknown", { retryable: error.coreError.retryable });
  }
};

const assertHistoryScope = (
  summary: DocumentVersionSummary,
  request: { readonly projectId: string; readonly documentId: string },
): DocumentVersionSummary => {
  if (
    summary.projectId === request.projectId &&
    summary.documentId === request.documentId
  ) {
    return summary;
  }
  throw new DocumentHistoryContractError(
    "Core Document version escaped its Project or Document boundary",
  );
};

const subscriptionKey = (
  request: Pick<DocumentSyncSubscribeRequest, "clientSessionId" | "documentId">,
): string => JSON.stringify([request.clientSessionId, request.documentId]);

export const createCoreDocumentSyncAdapter = (
  client: CoreClientPort,
): CoreDocumentSyncAdapter => {
  const subscriptions = new Map<string, ActiveSubscription>();
  const lastSequences = new Map<string, number>();

  const requireSubscription = (
    request: Pick<DocumentSyncSubscribeRequest, "clientSessionId" | "documentId">,
  ): Promise<void> => {
    const subscription = subscriptions.get(subscriptionKey(request));
    if (subscription) return subscription.ready;
    return Promise.reject(
      new Error("Owned Document sync requires an active event subscription"),
    );
  };

  const sync = async (
    request: DocumentSyncRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> => {
    try {
      await requireSubscription(request);
      return success(await client.documentSync(request));
    } catch (error) {
      return failure(error);
    }
  };

  const applyUpdate = async (
    request: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>> => {
    try {
      await requireSubscription(request);
      return success(await client.documentApplyUpdate(request));
    } catch (error) {
      return failure(error);
    }
  };

  const readDescriptor = async (input: {
    readonly ownerBlockId: string;
    readonly clientSessionId: string;
  }): Promise<OwnedDocumentDescriptor> => {
    const snapshot = await client.documentRead(input.clientSessionId, {
      kind: "descriptor",
      owner_block_id: input.ownerBlockId,
    });
    if (snapshot.value.kind !== "descriptor") {
      throw new Error("Core returned a non-descriptor Document read value");
    }
    const descriptor = decodeCoreOwnedDocumentDescriptor(
      snapshot.value.descriptor,
    );
    if (descriptor.ownerBlockId !== input.ownerBlockId) {
      throw new Error("Core Owned Document descriptor escaped its owner boundary");
    }
    return descriptor;
  };

  const subscribe = (
    request: DocumentSyncSubscribeRequest,
    listener: (event: DocumentSyncRealtimeEvent) => void,
  ): (() => void) => {
    const key = subscriptionKey(request);
    subscriptions.get(key)?.close();
    let active = true;
    let opened: CoreEventSubscription | undefined;
    const ready = client
      .openDocumentEventStream(
        {
          documentId: request.documentId,
          clientSessionId: request.clientSessionId,
          after: lastSequences.get(key) ?? 0,
        },
        (envelope) => {
          const event = documentEvent(request, envelope);
          if (!event) return;
          const previous = lastSequences.get(key) ?? 0;
          if (envelope.event.sequence <= previous) return;
          lastSequences.set(key, envelope.event.sequence);
          listener(event);
        },
        (resync) => {
          lastSequences.set(key, resync.event_head);
          listener({
            kind: "resync-required",
            documentId: resync.document_id,
            storeEpoch: resync.store_epoch,
            generation: resync.generation,
            headSeq: resync.head_seq,
            reason: "history-compacted",
          });
        },
        (event) => listener(event),
      )
      .then((subscription) => {
        opened = subscription;
        if (!active) {
          subscription.close();
          return;
        }
        listener({
          kind: "connection",
          documentId: request.documentId,
          state: "connected",
        });
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
        listener({
          kind: "connection",
          documentId: request.documentId,
          state: "disconnected",
        });
      },
    };
    subscriptions.set(key, subscription);
    void ready.catch(() => subscription.close());
    return subscription.close;
  };

  return {
    readDescriptor,
    prepareOwner: async (input) => {
      try {
        const committed = await client.documentApply({
          operationId: input.operationId,
          clientSessionId: input.clientSessionId,
          intent: {
            kind: "prepare_owner",
            owner_block_id: input.ownerBlockId,
          },
        });
        const descriptor = await readDescriptor(input);
        if (
          committed.receipt.operation_id !== input.operationId
          || committed.receipt.document_id !== descriptor.documentId
          || committed.value.document_id !== descriptor.documentId
          || committed.value.generation !== descriptor.generation
          || committed.value.head_seq > descriptor.headSeq
          || committed.store_epoch !== descriptor.storeEpoch
        ) {
          throw new Error("Core Owned Document preparation escaped its owner boundary");
        }
        return success(descriptor);
      } catch (error) {
        return failure(error);
      }
    },
    applyAdditionalDocumentCommand: async (rawRequest) => {
      let request: AdditionalDocumentCommandRequest;
      try {
        request = parseAdditionalDocumentCommandRequest(rawRequest);
      } catch (error) {
        return additionalDocumentFailure(rawRequest, error);
      }
      try {
        const committed = await client.documentApply({
          operationId: request.operationId,
          clientSessionId: request.clientSessionId,
          intent: {
            kind: "apply_owner_command",
            command: coreOwnerCommand(request),
          },
        });
        const effect = committed.value.owner_effect;
        const committedAt = committed.value.committed_at;
        if (
          committed.store_epoch !== request.storeEpoch
          || committed.receipt.operation_id !== request.operationId
          || !effect
          || !committedAt
        ) {
          throw new Error(
            "Core Additional Document receipt escaped its operation or Store boundary",
          );
        }
        const semanticHash = createHash("sha256")
          .update(encodeAdditionalDocumentCommandSemanticHashInput(request))
          .digest("hex");
        return parseAdditionalDocumentCommandResult({
          ok: true,
          value: {
            version: 1,
            operationId: request.operationId,
            projectId: request.projectId,
            storeEpoch: committed.store_epoch,
            operationKind: request.operation.kind,
            semanticHash,
            duplicate: committed.receipt.duplicate,
            effect: {
              createdBlockIds: effect.created_block_ids,
              preservedBlockIds: effect.preserved_block_ids,
              deletedBlockIds: effect.deleted_block_ids,
              documentHeads: effect.document_heads.map((head) => ({
                documentId: head.document_id,
                generation: head.generation,
                headSeq: head.head_seq,
              })),
            },
            changeLogSeq: committed.event_sequence,
            committedAt,
          },
        });
      } catch (error) {
        return additionalDocumentFailure(request, error);
      }
    },
    createCheckpoint: async (request) => {
      const operationId = `electron:document-checkpoint:${createHash("sha256")
        .update(stableStringifyBlockPropertyJson(request))
        .digest("hex")}`;
      try {
        const committed = await client.documentApply({
          operationId,
          clientSessionId: "electron:document-history",
          intent: {
            kind: "create_checkpoint",
            document_id: request.documentId,
            generation: request.expectedGeneration,
            expected_head_seq: request.expectedHeadSeq,
            cause: request.cause,
            label: request.label,
            actor: request.actor,
            revision_kind: request.revisionKind,
            source_mutation_id: request.sourceMutationId,
            source_change_seq: request.sourceChangeSeq,
          },
        });
        const effect = committed.value.checkpoint_effect;
        if (
          committed.store_epoch !== request.storeEpoch ||
          committed.receipt.operation_id !== operationId ||
          committed.receipt.document_id !== request.documentId ||
          committed.receipt.generation !== request.expectedGeneration ||
          committed.receipt.head_seq !== request.expectedHeadSeq ||
          !effect
        ) {
          throw new DocumentHistoryContractError(
            "Core checkpoint receipt escaped its request boundary",
          );
        }
        return {
          ok: true,
          value: {
            checkpoint: assertHistoryScope(
              parseDocumentVersionSummary(effect.checkpoint),
              request,
            ),
            duplicate: committed.receipt.duplicate || effect.duplicate,
          },
        };
      } catch (error) {
        return historyFailure(error, {
          generation: request.expectedGeneration,
          headSeq: request.expectedHeadSeq,
        });
      }
    },
    listVersions: async (request) => {
      try {
        const snapshot = await client.documentRead(
          "electron:document-history",
          {
            kind: "list_versions",
            document_id: request.documentId,
            before: request.before
              ? {
                  base_head_seq: request.before.baseHeadSeq,
                  created_at: request.before.createdAt,
                  version_id: request.before.versionId,
                }
              : undefined,
            limit: request.limit,
          },
        );
        if (snapshot.value.kind !== "versions") {
          throw new DocumentHistoryContractError(
            "Core returned a non-list Document history snapshot",
          );
        }
        const items = snapshot.value.items.map((item) =>
          assertHistoryScope(parseDocumentVersionSummary(item), request)
        );
        const next = snapshot.value.next;
        const last = items.at(-1);
        if (
          next &&
          (!last ||
            next.base_head_seq !== last.baseHeadSeq ||
            next.created_at !== last.createdAt ||
            next.version_id !== last.versionId)
        ) {
          throw new DocumentHistoryContractError(
            "Core Document history cursor escaped its last returned version",
          );
        }
        return {
          ok: true,
          value: items,
        };
      } catch (error) {
        return historyFailure(error);
      }
    },
    getVersion: async (request) => {
      try {
        const snapshot = await client.documentRead(
          "electron:document-history",
          {
            kind: "get_version",
            document_id: request.documentId,
            version_id: request.versionId,
          },
        );
        if (snapshot.value.kind !== "version") {
          throw new DocumentHistoryContractError(
            "Core returned a non-detail Document history snapshot",
          );
        }
        const detail = parseDocumentVersionDetail(snapshot.value.value);
        assertHistoryScope(detail.summary, request);
        if (detail.summary.versionId !== request.versionId) {
          throw new DocumentHistoryContractError(
            "Core Document version detail escaped its version boundary",
          );
        }
        return { ok: true, value: detail };
      } catch (error) {
        return historyFailure(error);
      }
    },
    restoreVersion: async (rawRequest, writeFencePrepared = false) => {
      let request: PrepareDocumentVersionRestore;
      try {
        request = parseDocumentVersionRestore(rawRequest);
      } catch (error) {
        return {
          ok: false,
          error: documentMutationFailure(
            "invalid_document_operation_request",
            error instanceof Error ? error.message : String(error),
            { mutationId: rawRequest.mutationId },
          ),
        };
      }
      try {
        const committed = await client.documentApply({
          operationId: request.mutationId,
          clientSessionId:
            request.clientSessionId ?? "electron:document-history",
          intent: {
            kind: "restore_version",
            document_id: request.documentId,
            version_id: request.versionId,
            generation: request.generation,
            expected_head_seq: request.expectedHeadSeq,
            actor: request.actor,
            write_fence_prepared: writeFencePrepared,
          },
        });
        if (
          committed.store_epoch !== request.storeEpoch
          || committed.receipt.operation_id !== request.mutationId
          || committed.receipt.document_id !== request.documentId
          || committed.receipt.generation !== request.generation
          || committed.value.document_id !== request.documentId
          || committed.value.generation !== request.generation
          || committed.value.head_seq !== committed.receipt.head_seq
        ) {
          throw new DocumentOperationContractError(
            "Core Document restore receipt escaped its request boundary",
          );
        }
        if (committed.value.outcome === "no_change") {
          if (committed.value.head_seq !== request.expectedHeadSeq) {
            throw new DocumentOperationContractError(
              "Core no-change restore advanced the Document head",
            );
          }
          return {
            ok: false,
            error: documentMutationFailure(
              "no_change",
              `Document is already equal to version ${request.versionId}`,
              { mutationId: request.mutationId },
            ),
          };
        }
        const effect = committed.value.mutation_effect;
        const committedAt = committed.value.committed_at;
        if (
          !effect
          || !committedAt
          || effect.base_head_seq !== request.expectedHeadSeq
          || committed.value.head_seq !== request.expectedHeadSeq + 1
          || effect.coordination !== "write_fence"
        ) {
          throw new DocumentOperationContractError(
            "Core Document restore effect escaped its write-fenced head boundary",
          );
        }
        const touched = new Set(effect.touched_block_ids);
        if (
          [
            ...effect.created_block_ids,
            ...effect.deleted_block_ids,
            ...effect.updated_block_ids,
            ...effect.moved_block_ids,
          ].some((blockId) => !touched.has(blockId))
        ) {
          throw new DocumentOperationContractError(
            "Core Document restore effect omitted a semantic change from touched Blocks",
          );
        }
        const result = parseDocumentOperationResult({
          version: 1,
          mutationKind: "document_version_restore",
          mutationId: request.mutationId,
          projectId: request.projectId,
          storeEpoch: committed.store_epoch,
          documentId: committed.value.document_id,
          generation: committed.value.generation,
          baseHeadSeq: effect.base_head_seq,
          headSeq: committed.value.head_seq,
          touchedBlockIds: effect.touched_block_ids,
          createdBlockIds: effect.created_block_ids,
          deletedBlockIds: effect.deleted_block_ids,
          updatedBlockIds: effect.updated_block_ids,
          movedBlockIds: effect.moved_block_ids,
          writeFenceBlockIds: effect.write_fence_block_ids,
          titleChanged: effect.title_changed,
          coordination: effect.coordination,
          changeLogSeq: committed.event_sequence,
          committedAt,
          duplicate: committed.receipt.duplicate,
        });
        if (
          result.projectId !== request.projectId
          || result.documentId !== request.documentId
          || result.mutationId !== request.mutationId
        ) {
          throw new DocumentOperationContractError(
            "Core Document restore result escaped its public identity boundary",
          );
        }
        return { ok: true, value: result };
      } catch (error) {
        return documentRestoreFailure(request, error);
      }
    },
    sync,
    applyUpdate,
    subscribe,
    publishAwareness: async (request: DocumentAwarenessPublishRequest) => {
      try {
        await requireSubscription(request);
        return success(await client.documentPublishAwareness(request));
      } catch (error) {
        return failure(error);
      }
    },
    respondToRelocationLease: async () =>
      failure(new Error("Core relocation leases remain internal to the Module")),
  };
};

const documentEvent = (
  request: DocumentSyncSubscribeRequest,
  envelope: CoreEventEnvelope,
): DocumentSyncRealtimeEvent | null => {
  const payload = envelope.event.payload;
  if (payload.module !== "owned_document") return null;
  const event = payload.event;
  if (event.document_id !== request.documentId) return null;
  if (event.kind === "document_updated") {
    return {
      kind: "document-update",
      documentId: event.document_id,
      storeEpoch: envelope.event.store_epoch,
      generation: event.generation,
      headSeq: event.head_seq,
      updateId: envelope.event.operation_id ?? `event:${envelope.event.sequence}`,
      clientSessionId: "core",
      update: Uint8Array.from(event.update),
    };
  }
  if (event.kind === "document_invalidated") {
    return {
      kind: "resync-required",
      documentId: event.document_id,
      storeEpoch: envelope.event.store_epoch,
      generation: 1,
      headSeq: 0,
      reason: "event-gap",
    };
  }
  return null;
};

const success = <Value>(value: Value): DocumentSyncCommandResult<Value> => ({
  ok: true,
  value,
});

const failure = <Value>(error: unknown): DocumentSyncCommandResult<Value> => ({
  ok: false,
  error: commandError(error),
});

const commandError = (error: unknown): DocumentSyncCommandError => {
  if (error instanceof CoreModuleResponseError) {
    const code = error.coreError.code;
    return {
      code: mapCoreErrorCode(code),
      message: error.message,
      retryable: error.coreError.retryable,
      resetRequired:
        code === "stale_store_epoch" || code === "generation_conflict",
    };
  }
  return {
    code: "transport_unavailable",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    resetRequired: false,
  };
};

const mapCoreErrorCode = (
  code: CoreModuleResponseError["coreError"]["code"],
): DocumentSyncCommandError["code"] => {
  switch (code) {
    case "unauthorized":
      return "unauthorized";
    case "not_found":
      return "document_not_found";
    case "stale_store_epoch":
      return "store_epoch_mismatch";
    case "generation_conflict":
      return "document_generation_mismatch";
    case "head_conflict":
      return "future_base_head";
    case "document_update_missing_dependencies":
      return "document_update_missing_dependencies";
    case "idempotency_key_reused":
      return "update_id_collision";
    case "invalid_document_schema":
    case "schema_unsupported":
      return "unsupported_document_schema";
    case "store_corrupt":
      return "document_state_corrupt";
    case "invalid_input":
      return "invalid_document_update";
    default:
      return "unknown";
  }
};
