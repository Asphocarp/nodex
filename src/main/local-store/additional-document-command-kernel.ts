import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES,
  ADDITIONAL_DOCUMENT_COMMAND_VERSION,
  AdditionalDocumentCommandContractError,
  encodeAdditionalDocumentCommandSemanticHashInput,
  parseAdditionalDocumentCommandReceipt,
  parseAdditionalDocumentCommandRequest,
  parseAdditionalDocumentCommandResult,
  type AdditionalDocumentCommandErrorCode,
  type AdditionalDocumentCommandKind,
  type AdditionalDocumentCommandReceipt,
  type AdditionalDocumentCommandRequest,
  type AdditionalDocumentCommandResult,
  type AdditionalDocumentHeadRevision,
  type AdditionalDocumentMutationEffect,
} from "../../shared/additional-document-commands";
import {
  ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
} from "../../shared/block-documents";
import type { BlockTreeNode } from "../../shared/block-documents/block-document-codec";
import {
  AdditionalDocumentBearingBlockError,
  createExplicitDocumentBearingBlock,
  createReusableTemplateSource,
  instantiateReusableTemplate,
} from "./additional-document-bearing-blocks";
import {
  SyncedBlockGroupError,
  createSyncedBlockSource,
  demoteSyncedBlockSource,
  promoteBlockToSyncedSource,
  type SyncedBlockGroupWriteFence,
} from "./synced-block-groups";

export type AdditionalDocumentCommandFaultPoint = "after_domain_mutation";

export interface ApplyAdditionalDocumentCommandOptions {
  readonly faultInjector?: (
    point: AdditionalDocumentCommandFaultPoint,
  ) => void;
}

interface StoredCommandEvidenceRow {
  readonly project_id: string;
  readonly store_epoch: string;
  readonly mutation_kind: string;
  readonly outcome: "committed" | "rejected";
  readonly target_block_ids_json: string;
  readonly affected_document_ids_json: string;
  readonly document_heads_json: string;
  readonly change_log_seq: number | null;
  readonly recorded_at: string;
}

interface StoredChangeEvidenceRow {
  readonly project_id: string;
  readonly store_epoch: string;
  readonly kind: string;
  readonly operation_id: string | null;
  readonly block_ids_json: string;
  readonly document_ids_json: string;
  readonly committed_at: string;
}

interface DurableCommandEvidence {
  readonly targetBlockIds: readonly string[];
  readonly documentHeads: readonly AdditionalDocumentHeadRevision[];
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

const COMMAND_KINDS = new Set<AdditionalDocumentCommandKind>(
  Object.keys(
    ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES,
  ) as AdditionalDocumentCommandKind[],
);

const expectedDomainMutationKind = (
  kind: AdditionalDocumentCommandKind,
): string => {
  switch (kind) {
    case "create_synced_source":
      return "create_synced_block_source";
    case "promote_synced_source":
      return "promote_synced_block_source";
    case "demote_synced_source":
      return "demote_synced_block_source";
    case "create_template":
      return "create_reusable_template_source";
    case "instantiate_template":
      return "instantiate_reusable_template";
    case "create_large_document":
      return "create_explicit_document_bearing_block";
    case "delete_owned_source":
    case "create_canvas_owner":
    case "delete_canvas_owner":
      return kind;
  }
};

const rawOperationId = (value: unknown): string => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "invalid";
  }
  const operationId = (value as { readonly operationId?: unknown })
    .operationId;
  if (
    typeof operationId === "string" &&
    operationId.length > 0 &&
    operationId.length <= 512 &&
    operationId === operationId.trim()
  ) {
    return operationId;
  }
  return "invalid";
};

const rawOperationKind = (
  value: unknown,
): AdditionalDocumentCommandKind | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const operation = (value as { readonly operation?: unknown }).operation;
  if (
    typeof operation !== "object" ||
    operation === null ||
    Array.isArray(operation)
  ) {
    return null;
  }
  const kind = (operation as { readonly kind?: unknown }).kind;
  return typeof kind === "string" &&
    COMMAND_KINDS.has(kind as AdditionalDocumentCommandKind)
    ? (kind as AdditionalDocumentCommandKind)
    : null;
};

const boundedMessage = (message: string): string =>
  message.length <= 4_096 ? message : `${message.slice(0, 4_095)}…`;

const failure = (
  request: unknown,
  code: AdditionalDocumentCommandErrorCode,
  message: string,
  retryable: boolean,
  parsed?: AdditionalDocumentCommandRequest,
): AdditionalDocumentCommandResult =>
  parseAdditionalDocumentCommandResult({
    ok: false,
    error: {
      code,
      message: boundedMessage(message),
      retryable,
      operationId: parsed?.operationId ?? rawOperationId(request),
      operationKind: parsed?.operation.kind ?? rawOperationKind(request),
    },
  });

const hasStoredOperation = (
  database: Database.Database,
  operationId: string,
): boolean =>
  database
    .prepare("SELECT 1 AS present FROM block_mutations WHERE mutation_id = ?")
    .get(operationId) !== undefined;

const readIdentityArray = (
  serialized: string,
  label: string,
): readonly string[] => {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new AdditionalDocumentCommandContractError(
      `Stored ${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.length === 0 ||
        entry.length > 512 ||
        entry !== entry.trim(),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new AdditionalDocumentCommandContractError(
      `Stored ${label} is not a canonical identity array`,
    );
  }
  return [...value].sort();
};

const readDocumentHeads = (
  serialized: string,
): readonly AdditionalDocumentHeadRevision[] => {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new AdditionalDocumentCommandContractError(
      `Stored Document heads are invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AdditionalDocumentCommandContractError(
      "Stored Document heads are not an object",
    );
  }
  return Object.entries(value)
    .map(([documentId, head]) => {
      if (
        typeof head !== "object" ||
        head === null ||
        Array.isArray(head) ||
        Object.keys(head).sort().join(",") !== "generation,headSeq" ||
        !Number.isSafeInteger(
          (head as { readonly generation?: unknown }).generation,
        ) ||
        Number((head as { readonly generation: number }).generation) < 1 ||
        !Number.isSafeInteger((head as { readonly headSeq?: unknown }).headSeq) ||
        Number((head as { readonly headSeq: number }).headSeq) < 1
      ) {
        throw new AdditionalDocumentCommandContractError(
          `Stored Document head ${documentId} is invalid`,
        );
      }
      const record = head as {
        readonly generation: number;
        readonly headSeq: number;
      };
      return {
        documentId,
        generation: record.generation,
        headSeq: record.headSeq,
      };
    })
    .sort((left, right) => left.documentId.localeCompare(right.documentId));
};

const readDurableCommandEvidence = (
  database: Database.Database,
  request: AdditionalDocumentCommandRequest,
): DurableCommandEvidence => {
  const row = database
    .prepare(
      `
      SELECT project_id, store_epoch, mutation_kind, outcome,
        target_block_ids_json, affected_document_ids_json,
        document_heads_json, change_log_seq, recorded_at
      FROM block_mutations
      WHERE mutation_id = ?
    `,
    )
    .get(request.operationId) as StoredCommandEvidenceRow | undefined;
  if (
    !row ||
    row.project_id !== request.projectId ||
    row.store_epoch !== request.storeEpoch ||
    row.mutation_kind !== expectedDomainMutationKind(request.operation.kind) ||
    row.outcome !== "committed" ||
    row.change_log_seq === null ||
    !Number.isSafeInteger(row.change_log_seq) ||
    row.change_log_seq < 1
  ) {
    throw new AdditionalDocumentCommandContractError(
      `Operation ${request.operationId} has no matching committed receipt`,
    );
  }
  const targetBlockIds = readIdentityArray(
    row.target_block_ids_json,
    "target Block identities",
  );
  const affectedDocumentIds = readIdentityArray(
    row.affected_document_ids_json,
    "affected Document identities",
  );
  const documentHeads = readDocumentHeads(row.document_heads_json);
  if (
    JSON.stringify(affectedDocumentIds) !==
    JSON.stringify(documentHeads.map((head) => head.documentId).sort())
  ) {
    throw new AdditionalDocumentCommandContractError(
      `Operation ${request.operationId} Document evidence diverges from its heads`,
    );
  }
  const change = database
    .prepare(
      `
      SELECT project_id, store_epoch, kind, operation_id,
        block_ids_json, document_ids_json, committed_at
      FROM change_log
      WHERE seq = ?
    `,
    )
    .get(row.change_log_seq) as StoredChangeEvidenceRow | undefined;
  if (
    !change ||
    change.project_id !== row.project_id ||
    change.store_epoch !== row.store_epoch ||
    change.kind !== "block_mutation" ||
    change.operation_id !== request.operationId ||
    change.block_ids_json !== row.target_block_ids_json ||
    change.document_ids_json !== row.affected_document_ids_json ||
    change.committed_at !== row.recorded_at
  ) {
    throw new AdditionalDocumentCommandContractError(
      `Operation ${request.operationId} change evidence diverges from its receipt`,
    );
  }
  return {
    targetBlockIds,
    documentHeads,
    changeLogSeq: row.change_log_seq,
    committedAt: row.recorded_at,
  };
};

const flattenBlockIds = (
  blocks: readonly BlockTreeNode[],
): readonly string[] =>
  blocks.flatMap((block) => [block.id, ...flattenBlockIds(block.children)]);

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort();

const readDocumentOwnerIds = (
  database: Database.Database,
  documentIds: readonly string[],
): readonly string[] => {
  if (documentIds.length === 0) return [];
  const placeholders = documentIds.map(() => "?").join(", ");
  return (
    database
      .prepare(
        `SELECT block_id FROM block_documents WHERE document_id IN (${placeholders})`,
      )
      .all(...documentIds) as readonly { readonly block_id: string }[]
  ).map((row) => row.block_id);
};

const deriveMutationEffect = (
  database: Database.Database,
  request: AdditionalDocumentCommandRequest,
  evidence: DurableCommandEvidence,
): AdditionalDocumentMutationEffect => {
  const operation = request.operation;
  const ownerIds = new Set(
    readDocumentOwnerIds(
      database,
      evidence.documentHeads.map((head) => head.documentId),
    ),
  );
  if (operation.kind === "create_synced_source") {
    return {
      createdBlockIds: uniqueSorted([
        operation.sourceBlockId,
        ...flattenBlockIds(operation.initialBlocks),
      ]),
      preservedBlockIds: [],
      deletedBlockIds: [],
      documentHeads: evidence.documentHeads,
    };
  }
  if (operation.kind === "promote_synced_source") {
    const createdBlockIds = uniqueSorted([
      operation.sourceBlockId,
      operation.referenceBlockId,
    ]);
    const excluded = new Set([...createdBlockIds, ...ownerIds]);
    return {
      createdBlockIds,
      preservedBlockIds: evidence.targetBlockIds.filter(
        (blockId) => !excluded.has(blockId),
      ),
      deletedBlockIds: [],
      documentHeads: evidence.documentHeads,
    };
  }
  if (operation.kind === "demote_synced_source") {
    const deletedBlockIds = uniqueSorted([
      operation.sourceBlockId,
      operation.referenceBlockId,
    ]);
    const excluded = new Set([...deletedBlockIds, ...ownerIds]);
    return {
      createdBlockIds: [],
      preservedBlockIds: evidence.targetBlockIds.filter(
        (blockId) => !excluded.has(blockId),
      ),
      deletedBlockIds,
      documentHeads: evidence.documentHeads,
    };
  }
  if (operation.kind === "create_template") {
    return {
      createdBlockIds: uniqueSorted([
        operation.sourceBlockId,
        ...flattenBlockIds(operation.initialBlocks),
      ]),
      preservedBlockIds: [],
      deletedBlockIds: [],
      documentHeads: evidence.documentHeads,
    };
  }
  if (operation.kind === "instantiate_template") {
    return {
      createdBlockIds: evidence.targetBlockIds.filter(
        (blockId) =>
          blockId !== operation.sourceBlockId && !ownerIds.has(blockId),
      ),
      preservedBlockIds: [operation.sourceBlockId],
      deletedBlockIds: [],
      documentHeads: evidence.documentHeads,
    };
  }
  if (operation.kind === "create_large_document") {
    return {
      createdBlockIds: evidence.targetBlockIds,
      preservedBlockIds: [],
      deletedBlockIds: [],
      documentHeads: evidence.documentHeads,
    };
  }
  throw new AdditionalDocumentCommandContractError(
    `Capability gap ${operation.kind} cannot produce a mutation effect`,
  );
};

const toSyncedWriteFence = (
  request: AdditionalDocumentCommandRequest,
): SyncedBlockGroupWriteFence => {
  if (request.coordination.kind === "hub_lease") {
    return {
      leaseId: request.coordination.leaseId,
      documents: request.coordination.documents,
    };
  }
  return {
    leaseId: `receipt-replay:${request.operationId}`,
    documents:
      request.operation.kind === "promote_synced_source"
        ? [request.operation.host]
        : request.operation.kind === "demote_synced_source"
          ? [request.operation.host, request.operation.source]
          : [],
  };
};

const executeDomainMutation = (
  database: Database.Database,
  request: AdditionalDocumentCommandRequest,
): { readonly duplicate: boolean } => {
  const common = {
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    clientSessionId: request.clientSessionId,
    actor: request.actor,
  } as const;
  const operation = request.operation;
  if (operation.kind === "create_synced_source") {
    return createSyncedBlockSource(database, {
      ...common,
      sourceBlockId: operation.sourceBlockId,
      documentId: operation.documentId,
      blockTree: operation.initialBlocks,
      ...(operation.placement.before
        ? {
            beforeBlockId: operation.placement.before.blockId,
            expectedBeforeLocationRevision:
              operation.placement.before.expectedLocationRevision,
          }
        : {}),
    });
  }
  if (operation.kind === "promote_synced_source") {
    return promoteBlockToSyncedSource(database, {
      ...common,
      hostDocumentId: operation.host.documentId,
      expectedGeneration: operation.host.generation,
      expectedHeadSeq: operation.host.headSeq,
      rootBlockId: operation.rootBlockId,
      referenceBlockId: operation.referenceBlockId,
      sourceBlockId: operation.sourceBlockId,
      sourceDocumentId: operation.sourceDocumentId,
      writeFence: toSyncedWriteFence(request),
    });
  }
  if (operation.kind === "demote_synced_source") {
    return demoteSyncedBlockSource(database, {
      ...common,
      hostDocumentId: operation.host.documentId,
      expectedGeneration: operation.host.generation,
      expectedHeadSeq: operation.host.headSeq,
      sourceDocumentId: operation.source.documentId,
      expectedSourceGeneration: operation.source.generation,
      expectedSourceHeadSeq: operation.source.headSeq,
      referenceBlockId: operation.referenceBlockId,
      sourceBlockId: operation.sourceBlockId,
      writeFence: toSyncedWriteFence(request),
    });
  }
  if (operation.kind === "create_template") {
    return createReusableTemplateSource(database, {
      ...common,
      version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
      kind: "create_reusable_template_source",
      sourceBlockId: operation.sourceBlockId,
      documentId: operation.documentId,
      displayName: operation.displayName,
      blockTree: operation.initialBlocks,
      ...(operation.placement.before
        ? {
            beforeBlockId: operation.placement.before.blockId,
            expectedBeforeLocationRevision:
              operation.placement.before.expectedLocationRevision,
          }
        : {}),
    });
  }
  if (operation.kind === "instantiate_template") {
    return instantiateReusableTemplate(database, {
      ...common,
      version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
      kind: "instantiate_reusable_template",
      sourceBlockId: operation.sourceBlockId,
      sourceDocumentId: operation.source.documentId,
      expectedSourceGeneration: operation.source.generation,
      expectedSourceHeadSeq: operation.source.headSeq,
      targetDocumentId: operation.target.documentId,
      expectedTargetGeneration: operation.target.generation,
      expectedTargetHeadSeq: operation.target.headSeq,
      ...(operation.parentBlockId
        ? { parentBlockId: operation.parentBlockId }
        : {}),
      ...(operation.beforeBlockId
        ? { beforeBlockId: operation.beforeBlockId }
        : {}),
    });
  }
  if (operation.kind === "create_large_document") {
    const content =
      operation.content.kind === "large_document"
        ? { blockTree: operation.content.initialBlocks }
        : {
            language: operation.content.language,
            code: operation.content.code,
          };
    const location =
      operation.location.kind === "space"
        ? {
            kind: "space" as const,
            ...(operation.location.before
              ? {
                  beforeBlockId: operation.location.before.blockId,
                  expectedBeforeLocationRevision:
                    operation.location.before.expectedLocationRevision,
                }
              : {}),
          }
        : {
            kind: "document" as const,
            hostDocumentId: operation.location.host.documentId,
            expectedHostGeneration: operation.location.host.generation,
            expectedHostHeadSeq: operation.location.host.headSeq,
            ...(operation.location.parentBlockId
              ? { parentBlockId: operation.location.parentBlockId }
              : {}),
            ...(operation.location.beforeBlockId
              ? { beforeBlockId: operation.location.beforeBlockId }
              : {}),
          };
    return createExplicitDocumentBearingBlock(database, {
      ...common,
      version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
      kind: "create_explicit_document_bearing_block",
      blockKind: operation.content.kind,
      blockId: operation.blockId,
      documentId: operation.documentId,
      displayName: operation.displayName,
      ...content,
      location,
    });
  }
  throw new AdditionalDocumentCommandContractError(
    `Capability gap ${operation.kind} reached the command kernel`,
  );
};

const isDomainError = (
  error: unknown,
): error is SyncedBlockGroupError | AdditionalDocumentBearingBlockError =>
  error instanceof SyncedBlockGroupError ||
  error instanceof AdditionalDocumentBearingBlockError;

const mapDomainError = (
  request: AdditionalDocumentCommandRequest,
  error: SyncedBlockGroupError | AdditionalDocumentBearingBlockError,
  operationExisted: boolean,
): AdditionalDocumentCommandResult => {
  if (error.code === "invalid_request") {
    return failure(request, "invalid_request", error.message, false, request);
  }
  if (error.code === "project_not_found") {
    return failure(request, "project_not_found", error.message, false, request);
  }
  if (error.code === "store_epoch_mismatch") {
    return failure(
      request,
      "store_epoch_mismatch",
      error.message,
      false,
      request,
    );
  }
  if (error.code === "identity_conflict") {
    return failure(
      request,
      operationExisted ? "operation_id_collision" : "identity_conflict",
      error.message,
      false,
      request,
    );
  }
  if (error.code === "block_revision_conflict") {
    return failure(
      request,
      "block_revision_conflict",
      error.message,
      false,
      request,
    );
  }
  if (error.code === "source_not_found") {
    return failure(request, "source_not_found", error.message, false, request);
  }
  if (error.code === "source_referenced") {
    return failure(
      request,
      "source_referenced",
      error.message,
      false,
      request,
    );
  }
  if (error.code === "source_shared") {
    return failure(request, "source_shared", error.message, false, request);
  }
  if (error.code === "host_block_not_found") {
    return failure(
      request,
      request.operation.kind === "demote_synced_source"
        ? "reference_not_found"
        : "source_not_found",
      error.message,
      false,
      request,
    );
  }
  if (
    error.code === "document_head_conflict" ||
    error.code === "host_document_conflict"
  ) {
    return failure(
      request,
      "document_head_conflict",
      error.message,
      false,
      request,
    );
  }
  return failure(
    request,
    "document_state_corrupt",
    error.message,
    false,
    request,
  );
};

const semanticHash = (request: AdditionalDocumentCommandRequest): string =>
  createHash("sha256")
    .update(encodeAdditionalDocumentCommandSemanticHashInput(request))
    .digest("hex");

/**
 * The sole authoritative adapter from the public Block-first command to the
 * existing typed domain kernels. The outer transaction makes adapter-level
 * validation/faults part of the same atomic boundary as every nested Y.Doc,
 * registry, projection, history, and receipt write.
 */
export const applyAdditionalDocumentCommand = (
  database: Database.Database,
  rawRequest: unknown,
  options: ApplyAdditionalDocumentCommandOptions = {},
): AdditionalDocumentCommandResult => {
  let request: AdditionalDocumentCommandRequest;
  try {
    request = parseAdditionalDocumentCommandRequest(rawRequest);
  } catch (error) {
    return failure(
      rawRequest,
      "invalid_request",
      error instanceof Error ? error.message : String(error),
      false,
    );
  }

  const capability =
    ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES[request.operation.kind];
  if (capability.availability === "capability_gap") {
    return failure(
      request,
      "capability_gap",
      capability.gap ?? `${request.operation.kind} is not implemented`,
      false,
      request,
    );
  }

  const operationExisted = hasStoredOperation(database, request.operationId);
  if (
    request.coordination.kind === "receipt_replay" &&
    !operationExisted
  ) {
    return failure(
      request,
      "coordination_failed",
      `Operation ${request.operationId} has no durable receipt to replay`,
      true,
      request,
    );
  }

  let execution:
    | { readonly ok: true; readonly duplicate: boolean }
    | {
        readonly ok: false;
        readonly error:
          | SyncedBlockGroupError
          | AdditionalDocumentBearingBlockError;
      };
  try {
    execution = database
      .transaction(() => {
        try {
          const result = executeDomainMutation(database, request);
          options.faultInjector?.("after_domain_mutation");
          return { ok: true as const, duplicate: result.duplicate };
        } catch (error) {
          if (isDomainError(error)) {
            return { ok: false as const, error };
          }
          throw error;
        }
      })
      .immediate();
  } catch (error) {
    void error;
    return failure(
      request,
      "unknown",
      "The additional Document command could not be committed",
      true,
      request,
    );
  }
  if (!execution.ok) {
    return mapDomainError(request, execution.error, operationExisted);
  }

  let evidence: DurableCommandEvidence;
  try {
    evidence = readDurableCommandEvidence(database, request);
  } catch (error) {
    void error;
    return failure(
      request,
      "document_state_corrupt",
      "The additional Document command receipt evidence is invalid",
      false,
      request,
    );
  }

  try {
    const receipt: AdditionalDocumentCommandReceipt = {
      version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
      operationId: request.operationId,
      projectId: request.projectId,
      storeEpoch: request.storeEpoch,
      operationKind: request.operation.kind,
      semanticHash: semanticHash(request),
      duplicate: execution.duplicate || operationExisted,
      effect: deriveMutationEffect(database, request, evidence),
      changeLogSeq: evidence.changeLogSeq,
      committedAt: evidence.committedAt,
    };
    return {
      ok: true,
      value: parseAdditionalDocumentCommandReceipt(receipt),
    };
  } catch (error) {
    void error;
    return failure(
      request,
      "document_state_corrupt",
      "The additional Document command receipt effect is invalid",
      false,
      request,
    );
  }
};
