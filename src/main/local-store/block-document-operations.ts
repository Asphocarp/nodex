import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createUuidV7 } from "../../shared/uuid-v7";
import {
  canonicalizeDocumentOperationIntent,
  canonicalizeDocumentVersionRestoreIntent,
  canonicalizeReplaceDocumentFromNfmIntent,
  DOCUMENT_OPERATION_CONTRACT_VERSION,
  DocumentOperationContractError,
  parseDocumentOperationBatch,
  parseDocumentOperationCommandError,
  parseDocumentOperationResult,
  parseDocumentVersionRestore,
  parseReplaceDocumentFromNfm,
  type DocumentBlockOperation,
  type DocumentMutationKind,
  type DocumentMutationRequest,
  type DocumentOperationBatch,
  type DocumentOperationCommandError,
  type DocumentOperationCommandResult,
  type DocumentOperationResult,
  type DocumentWriteFenceProof,
  type ReplaceDocumentFromNfm,
} from "../../shared/block-documents/document-operations";
import type {
  DocumentVersionActor,
  PrepareDocumentVersionRestore,
  PreparedDocumentVersionRestore,
} from "../../shared/block-documents/document-history";
import {
  compileBlockTreeReplacementOperations,
  DocumentOperationEngineError,
  prepareDocumentOperationUpdate,
} from "../../shared/block-documents/document-operation-engine";
import { materializePageDocument } from "../../shared/block-documents/block-document-codec";
import { portableRichTextSemanticSource } from "../../shared/block-documents/portable-rich-text";
import {
  CANVAS_SCENE_SYNC_VERSION,
  type CanvasSceneAppStateIntent,
  type CanvasSceneOptionalJson,
} from "../../shared/block-documents/canvas-scene-sync";
import {
  getRegisteredBlockDocumentSchemaAdapter,
  inspectOwnedBlockDocument,
  toPersistedBlockDocumentMaterialization,
} from "../../shared/block-documents/document-schema-adapters";
import {
  LegacyNfmShadowTranslationError,
  replacePageDocumentBodyFromNfm,
} from "../../shared/block-documents/legacy-nfm-shadow-translator";
import {
  applyStrictBlockDocumentUpdate,
  BlockDocumentStoreError,
  getBlockDocumentProjectId,
  loadPrimaryBlockDocument,
  type StrictDocumentUpdateCommitContext,
} from "./block-document-store";
import {
  createDocumentVersionCheckpoint,
  DocumentVersionStoreError,
  prepareDocumentVersionRestore,
} from "./document-versions";
import { markDocumentRevisionSessionCheckpoint } from "./document-revision-session-store";
import {
  applyCanvasSceneMutation,
  syncCanvasScene,
} from "./canvas-scene-store";

const CHANGE_LOG_KIND = "block_mutation";
const EMPTY_ARRAY_JSON = "[]";
const EMPTY_OBJECT_JSON = "{}";

export type DocumentOperationFaultPoint =
  | "after_update_prepared"
  | "after_document_update"
  | "after_change_log"
  | "after_ledger"
  | "before_commit"
  | "after_commit";

export interface ApplyDocumentOperationOptions {
  readonly faultInjector?: (point: DocumentOperationFaultPoint) => void;
  /** Trusted coordinator evidence; never populate this from raw client input. */
  readonly writeFence?: DocumentWriteFenceProof;
  /** Trusted Agent authority check executed inside the mutation transaction. */
  readonly beforeMutationApply?: () => void;
  /** Trusted promotion seam; target must be staged in the same outer transaction. */
  readonly allowPendingSyncedReferenceTargetIds?: readonly string[];
  /**
   * Trusted typed-creation seam. Every listed ID must already be an active
   * document-bearing owner staged at this host Document by the same outer
   * SQLite transaction.
   */
  readonly allowStagedDocumentBearingBlockIds?: readonly string[];
  /** Trusted existing ordinary Blocks already reparented into this Document. */
  readonly allowStagedReparentedBlockIds?: readonly string[];
  /** Trusted reparenting seam: remove host shells without deleting their owners. */
  readonly preserveRemovedBlockIds?: readonly string[];
  /** Trusted outer ownership transaction; never expose through transport input. */
  readonly allowTransientEmptyBlockTree?: boolean;
  /** Trusted composite/migration boundary owns any resulting revision itself. */
  readonly skipAutomaticRevisionCapture?: boolean;
}

interface StoredMutationRow {
  readonly mutation_id: string;
  readonly project_id: string;
  readonly store_epoch: string;
  readonly mutation_kind: string;
  readonly actor_json: string;
  readonly client_session_id: string | null;
  readonly request_hash: string;
  readonly request_json: string;
  readonly target_block_ids_json: string;
  readonly affected_document_ids_json: string;
  readonly affected_database_block_ids_json: string;
  readonly field_intents_json: string;
  readonly expected_revisions_json: string;
  readonly outcome: string;
  readonly result_json: string;
  readonly committed_revisions_json: string;
  readonly document_heads_json: string;
  readonly change_log_seq: number | null;
  readonly recorded_at: string;
}

interface MutationRequestBase {
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, unknown>>;
  readonly documentId: string;
  readonly generation: number;
  readonly expectedHeadSeq: number;
}

interface MutationEvidence {
  readonly mutationKind: DocumentMutationKind;
  readonly canonicalRequest: string;
  readonly requestHash: string;
  readonly actorJson: string;
  readonly clientSessionId: string | null;
  readonly affectedDocumentIdsJson: string;
  readonly requestedTargetBlockIds: readonly string[];
  readonly requestedTargetBlockIdsJson: string;
  readonly fieldIntentsJson: string;
  readonly expectedRevisionsJson: string;
}

interface PreparedMutation {
  readonly update: Uint8Array;
  readonly createdBlockIds: readonly string[];
  readonly deletedBlockIds: readonly string[];
  readonly updatedBlockIds: readonly string[];
  readonly movedBlockIds: readonly string[];
  readonly writeFenceBlockIds: readonly string[];
  readonly titleChanged: boolean;
  readonly coordination: "merge_friendly" | "write_fence";
  readonly trustedMaxUpdateBytes?: number;
}

interface StoredChangeLogRow {
  readonly project_id: string;
  readonly store_epoch: string;
  readonly kind: string;
  readonly operation_id: string | null;
  readonly block_ids_json: string;
  readonly document_ids_json: string;
  readonly database_block_ids_json: string;
  readonly payload_json: string;
  readonly committed_at: string;
}

class DocumentMutationRejection extends Error {
  readonly error: DocumentOperationCommandError;

  constructor(error: DocumentOperationCommandError) {
    super(error.message);
    this.name = "DocumentMutationRejection";
    this.error = error;
  }
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort(compareStrings);

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

const serializeDocumentChangePayload = (
  evidence: MutationEvidence,
  change: Pick<
    PreparedMutation,
    | "createdBlockIds"
    | "deletedBlockIds"
    | "updatedBlockIds"
    | "movedBlockIds"
    | "writeFenceBlockIds"
    | "titleChanged"
    | "coordination"
  > & {
    readonly generation: number;
    readonly baseHeadSeq: number;
    readonly headSeq: number;
  },
): string =>
  stableStringify({
    mutationKind: evidence.mutationKind,
    requestHash: evidence.requestHash,
    generation: change.generation,
    baseHeadSeq: change.baseHeadSeq,
    headSeq: change.headSeq,
    createdBlockIds: change.createdBlockIds,
    deletedBlockIds: change.deletedBlockIds,
    updatedBlockIds: change.updatedBlockIds,
    movedBlockIds: change.movedBlockIds,
    writeFenceBlockIds: change.writeFenceBlockIds,
    titleChanged: change.titleChanged,
    coordination: change.coordination,
  });

const makeError = (
  code: DocumentOperationCommandError["code"],
  message: string,
  request?: Pick<MutationRequestBase, "mutationId">,
  details: Omit<
    Partial<DocumentOperationCommandError>,
    "code" | "message" | "retryable" | "mutationId"
  > = {},
): DocumentOperationCommandError => ({
  code,
  message,
  retryable: false,
  ...(request ? { mutationId: request.mutationId } : {}),
  ...details,
});

const reject = (
  code: DocumentOperationCommandError["code"],
  message: string,
  request: MutationRequestBase,
  details?: Omit<
    Partial<DocumentOperationCommandError>,
    "code" | "message" | "retryable" | "mutationId"
  >,
): never => {
  throw new DocumentMutationRejection(
    makeError(code, message, request, details),
  );
};

const readStoreEpoch = (database: Database.Database): string | null =>
  (
    database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string } | undefined
  )?.store_epoch ?? null;

const readStoredMutation = (
  database: Database.Database,
  mutationId: string,
): StoredMutationRow | null =>
  (database
    .prepare(
      `
      SELECT
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        client_session_id, request_hash, request_json, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json,
        field_intents_json, expected_revisions_json, outcome, result_json,
        committed_revisions_json, document_heads_json, change_log_seq,
        recorded_at
      FROM block_mutations
      WHERE mutation_id = ?
    `,
    )
    .get(mutationId) as StoredMutationRow | undefined) ?? null;

const collectBlockIds = (
  block: Extract<
    DocumentBlockOperation,
    { readonly kind: "insert_block" }
  >["block"],
): readonly string[] => [
  block.id,
  ...block.children.flatMap((child) => collectBlockIds(child)),
];

const requestedTargetBlockIds = (
  request: DocumentMutationRequest,
): readonly string[] => {
  if (!("operations" in request)) return [];
  return uniqueSorted(
    request.operations.flatMap((operation) => {
      switch (operation.kind) {
        case "set_title":
        case "set_rich_title":
          return [];
        case "insert_block":
          return collectBlockIds(operation.block);
        case "update_block":
        case "delete_block":
        case "move_block":
          return [operation.blockId];
      }
    }),
  );
};

const fieldIntents = (
  request: DocumentMutationRequest,
): readonly Readonly<{
  readonly path: string;
  readonly operation: string;
}>[] => {
  if ("versionId" in request) {
    return [{ path: "document", operation: "restore_version" }];
  }
  if (!("operations" in request)) {
    return [{ path: "document.body", operation: "replace_from_nfm" }];
  }
  return request.operations.map((operation) => {
    switch (operation.kind) {
      case "set_title":
      case "set_rich_title":
        return { path: "document.title", operation: "set" };
      case "insert_block":
        return {
          path: `document.blocks.${operation.block.id}`,
          operation: "insert",
        };
      case "update_block":
        return {
          path: `document.blocks.${operation.blockId}`,
          operation: "update",
        };
      case "delete_block":
        return {
          path: `document.blocks.${operation.blockId}`,
          operation: "delete",
        };
      case "move_block":
        return {
          path: `document.blocks.${operation.blockId}.location`,
          operation: "move",
        };
    }
  });
};

const makeEvidence = (
  request: DocumentMutationRequest,
  mutationKind: DocumentMutationKind,
  canonicalRequest: string,
): MutationEvidence => {
  const targets = requestedTargetBlockIds(request);
  return {
    mutationKind,
    canonicalRequest,
    requestHash: sha256(canonicalRequest),
    actorJson: stableStringify(request.actor),
    clientSessionId: request.clientSessionId ?? null,
    affectedDocumentIdsJson: JSON.stringify([request.documentId]),
    requestedTargetBlockIds: targets,
    requestedTargetBlockIdsJson: JSON.stringify(targets),
    fieldIntentsJson: stableStringify(fieldIntents(request)),
    expectedRevisionsJson: stableStringify({
      document: {
        documentId: request.documentId,
        generation: request.generation,
        headSeq: request.expectedHeadSeq,
      },
    }),
  };
};

const storedMutationMatchesRequest = (
  stored: StoredMutationRow,
  request: MutationRequestBase,
  evidence: MutationEvidence,
): boolean =>
  stored.project_id === request.projectId &&
  stored.store_epoch === request.storeEpoch &&
  stored.mutation_kind === evidence.mutationKind &&
  stored.request_hash === evidence.requestHash &&
  stored.request_json === evidence.canonicalRequest &&
  stored.affected_document_ids_json === evidence.affectedDocumentIdsJson &&
  stored.affected_database_block_ids_json === EMPTY_ARRAY_JSON &&
  stored.field_intents_json === evidence.fieldIntentsJson &&
  stored.expected_revisions_json === evidence.expectedRevisionsJson;

const parseStoredError = (
  value: string,
  request: MutationRequestBase,
): DocumentOperationCommandError => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Stored mutation ${request.mutationId} has invalid rejection JSON`,
    );
  }
  try {
    return parseDocumentOperationCommandError(parsed);
  } catch {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Stored mutation ${request.mutationId} has invalid rejection evidence`,
    );
  }
};

const loadStoredOutcome = (
  database: Database.Database,
  stored: StoredMutationRow,
  request: MutationRequestBase,
  evidence: MutationEvidence,
): DocumentOperationCommandResult => {
  if (!storedMutationMatchesRequest(stored, request, evidence)) {
    return {
      ok: false,
      error: makeError(
        "mutation_id_collision",
        `Mutation ID ${request.mutationId} is already bound to different semantics`,
        request,
      ),
    };
  }
  if (stored.outcome === "rejected") {
    if (
      stored.change_log_seq !== null ||
      stored.target_block_ids_json !== evidence.requestedTargetBlockIdsJson ||
      stored.committed_revisions_json !== EMPTY_OBJECT_JSON ||
      stored.document_heads_json !== EMPTY_OBJECT_JSON
    ) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Rejected mutation ${request.mutationId} has committed-state evidence`,
      );
    }
    const error = parseStoredError(stored.result_json, request);
    if (error.mutationId !== request.mutationId) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Rejected mutation ${request.mutationId} lost its request identity`,
      );
    }
    return { ok: false, error };
  }
  if (stored.outcome !== "committed" || stored.change_log_seq === null) {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Mutation ${request.mutationId} has an invalid durable outcome`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.result_json);
  } catch {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Mutation ${request.mutationId} has invalid result JSON`,
    );
  }
  let result: DocumentOperationResult;
  try {
    result = parseDocumentOperationResult(parsed);
  } catch {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Mutation ${request.mutationId} has invalid result evidence`,
    );
  }
  const documentHead = {
    generation: result.generation,
    headSeq: result.headSeq,
  };
  const expectedDocumentHeads = stableStringify({
    [request.documentId]: documentHead,
  });
  if (
    result.mutationId !== request.mutationId ||
    result.projectId !== request.projectId ||
    result.storeEpoch !== request.storeEpoch ||
    result.documentId !== request.documentId ||
    result.generation !== request.generation ||
    result.baseHeadSeq !== request.expectedHeadSeq ||
    result.mutationKind !== evidence.mutationKind ||
    result.changeLogSeq !== stored.change_log_seq ||
    result.committedAt !== stored.recorded_at ||
    result.duplicate ||
    stored.target_block_ids_json !== JSON.stringify(result.touchedBlockIds) ||
    stored.committed_revisions_json !== expectedDocumentHeads ||
    stored.document_heads_json !== expectedDocumentHeads
  ) {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Mutation ${request.mutationId} result diverges from its request evidence`,
    );
  }
  const changeLog = database
    .prepare(
      `
      SELECT
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      FROM change_log
      WHERE seq = ?
    `,
    )
    .get(stored.change_log_seq) as StoredChangeLogRow | undefined;
  if (
    !changeLog ||
    changeLog.project_id !== request.projectId ||
    changeLog.store_epoch !== request.storeEpoch ||
    changeLog.kind !== CHANGE_LOG_KIND ||
    changeLog.operation_id !== request.mutationId ||
    changeLog.block_ids_json !== JSON.stringify(result.touchedBlockIds) ||
    changeLog.document_ids_json !== evidence.affectedDocumentIdsJson ||
    changeLog.database_block_ids_json !== EMPTY_ARRAY_JSON ||
    changeLog.payload_json !==
      serializeDocumentChangePayload(evidence, result) ||
    changeLog.committed_at !== result.committedAt
  ) {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Mutation ${request.mutationId} change cursor diverges from its receipt`,
    );
  }
  return { ok: true, value: { ...result, duplicate: true } };
};

const persistLedger = (
  database: Database.Database,
  input: {
    readonly request: MutationRequestBase;
    readonly evidence: MutationEvidence;
    readonly targetBlockIdsJson: string;
    readonly outcome: "committed" | "rejected";
    readonly resultJson: string;
    readonly committedRevisionsJson: string;
    readonly documentHeadsJson: string;
    readonly changeLogSeq: number | null;
    readonly recordedAt: string;
  },
): void => {
  database
    .prepare(
      `
      INSERT INTO block_mutations (
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        client_session_id, request_hash, request_json, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json,
        field_intents_json, expected_revisions_json, outcome, result_json,
        committed_revisions_json, document_heads_json, change_log_seq,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      input.request.mutationId,
      input.request.projectId,
      input.request.storeEpoch,
      input.evidence.mutationKind,
      input.evidence.actorJson,
      input.evidence.clientSessionId,
      input.evidence.requestHash,
      input.evidence.canonicalRequest,
      input.targetBlockIdsJson,
      input.evidence.affectedDocumentIdsJson,
      input.evidence.fieldIntentsJson,
      input.evidence.expectedRevisionsJson,
      input.outcome,
      input.resultJson,
      input.committedRevisionsJson,
      input.documentHeadsJson,
      input.changeLogSeq,
      input.recordedAt,
    );
};

const persistRejectedOutcome = (
  database: Database.Database,
  request: MutationRequestBase,
  evidence: MutationEvidence,
  error: DocumentOperationCommandError,
): DocumentOperationCommandResult => {
  const now = new Date().toISOString();
  persistLedger(database, {
    request,
    evidence,
    targetBlockIdsJson: evidence.requestedTargetBlockIdsJson,
    outcome: "rejected",
    resultJson: stableStringify(error),
    committedRevisionsJson: EMPTY_OBJECT_JSON,
    documentHeadsJson: EMPTY_OBJECT_JSON,
    changeLogSeq: null,
    recordedAt: now,
  });
  return { ok: false, error };
};

const rejectAndPersist = (
  database: Database.Database,
  request: MutationRequestBase,
  evidence: MutationEvidence,
  error: DocumentOperationCommandError,
): DocumentOperationCommandResult =>
  database
    .transaction(() => {
      const existing = readStoredMutation(database, request.mutationId);
      if (existing) {
        return loadStoredOutcome(database, existing, request, evidence);
      }
      return persistRejectedOutcome(database, request, evidence, error);
    })
    .immediate();

const mapEngineError = (
  error: DocumentOperationEngineError,
  request: MutationRequestBase,
): DocumentOperationCommandError =>
  makeError(error.code, error.message, request, {
    ...(error.operationIndex === undefined
      ? {}
      : { operationIndex: error.operationIndex }),
    ...(error.blockId === undefined ? {} : { blockId: error.blockId }),
  });

const mapStoreError = (
  error: BlockDocumentStoreError,
  request: MutationRequestBase,
): DocumentOperationCommandError => {
  switch (error.code) {
    case "store_epoch_mismatch":
      return makeError("store_epoch_mismatch", error.message, request);
    case "document_not_found":
      return makeError("document_not_found", error.message, request);
    case "document_not_ready":
    case "document_authority_mismatch":
      return makeError("document_not_ready", error.message, request);
    case "document_generation_mismatch":
      return makeError("document_generation_conflict", error.message, request);
    case "document_state_corrupt":
      return makeError("document_state_corrupt", error.message, request);
    default:
      return makeError("invalid_operation", error.message, request);
  }
};

const mapVersionStoreError = (
  error: DocumentVersionStoreError,
  request: MutationRequestBase,
): DocumentOperationCommandError => {
  switch (error.code) {
    case "store_epoch_mismatch":
      return makeError("store_epoch_mismatch", error.message, request);
    case "document_not_found":
      return makeError("document_not_found", error.message, request);
    case "document_version_not_found":
      return makeError("document_version_not_found", error.message, request);
    case "document_not_ready":
      return makeError("document_not_ready", error.message, request);
    case "project_scope_mismatch":
      return makeError("project_scope_mismatch", error.message, request);
    case "document_generation_conflict":
      return makeError("document_generation_conflict", error.message, request, {
        ...(error.expectedGeneration === undefined
          ? {}
          : { expectedGeneration: error.expectedGeneration }),
        ...(error.actualGeneration === undefined
          ? {}
          : { actualGeneration: error.actualGeneration }),
      });
    case "document_head_conflict":
      return makeError("document_head_conflict", error.message, request, {
        ...(error.expectedHeadSeq === undefined
          ? {}
          : { expectedHeadSeq: error.expectedHeadSeq }),
        ...(error.actualHeadSeq === undefined
          ? {}
          : { actualHeadSeq: error.actualHeadSeq }),
      });
    case "document_version_schema_mismatch":
      return makeError("invalid_operation", error.message, request);
    case "invalid_document_version_request":
      return makeError("invalid_document_operation_request", error.message, request);
    case "document_version_collision":
    case "document_version_corrupt":
      return makeError("document_state_corrupt", error.message, request);
  }
};

type PageMaterialization = ReturnType<typeof materializePageDocument>;
type MaterializedBlock = PageMaterialization["blockTree"][number];

interface SemanticBlockCoordinate {
  readonly block: MaterializedBlock;
  readonly parentBlockId: string | null;
  readonly siblingIndex: number;
}

const flattenSemanticCoordinates = (
  blocks: readonly MaterializedBlock[],
  parentBlockId: string | null = null,
): readonly SemanticBlockCoordinate[] =>
  blocks.flatMap((block, siblingIndex) => [
    { block, parentBlockId, siblingIndex },
    ...flattenSemanticCoordinates(block.children, block.id),
  ]);

const deriveSemanticChangeSet = (
  before: PageMaterialization,
  after: PageMaterialization,
  writeFenceBlockIds: readonly string[],
  forceWriteFence: boolean,
  titleWriteFenceBlockId?: string,
  titleWriteFenceRequired = false,
): Omit<PreparedMutation, "update"> => {
  const beforeCoordinates = flattenSemanticCoordinates(before.blockTree);
  const afterCoordinates = flattenSemanticCoordinates(after.blockTree);
  const beforeById = new Map(
    beforeCoordinates.map((coordinate) => [coordinate.block.id, coordinate]),
  );
  const afterById = new Map(
    afterCoordinates.map((coordinate) => [coordinate.block.id, coordinate]),
  );
  const beforeIds = beforeCoordinates.map((coordinate) => coordinate.block.id);
  const afterIds = afterCoordinates.map((coordinate) => coordinate.block.id);
  const beforeIdSet = new Set(beforeIds);
  const afterIdSet = new Set(afterIds);
  const titleChanged =
    portableRichTextSemanticSource(before.richTitle) !==
    portableRichTextSemanticSource(after.richTitle);
  const durableWriteFenceBlockIds = uniqueSorted([
    ...writeFenceBlockIds.filter((blockId) => beforeIdSet.has(blockId)),
    ...(titleWriteFenceRequired && titleWriteFenceBlockId
      ? [titleWriteFenceBlockId]
      : []),
  ]);
  const createdBlockIds = afterIds.filter(
    (blockId) => !beforeIdSet.has(blockId),
  );
  const deletedBlockIds = beforeIds.filter(
    (blockId) => !afterIdSet.has(blockId),
  );
  const updatedBlockIds = beforeIds.filter((blockId) => {
    const previous = beforeById.get(blockId);
    const next = afterById.get(blockId);
    if (!previous || !next) return false;
    return (
      previous.block.type !== next.block.type ||
      stableStringify(previous.block.props) !==
        stableStringify(next.block.props) ||
      stableStringify(previous.block.content) !==
        stableStringify(next.block.content)
    );
  });

  const commonIds = new Set(
    beforeIds.filter((blockId) => afterIdSet.has(blockId)),
  );
  const commonSiblingOrder = (
    coordinates: readonly SemanticBlockCoordinate[],
    parentBlockId: string | null,
  ): readonly string[] =>
    coordinates
      .filter(
        (coordinate) =>
          coordinate.parentBlockId === parentBlockId &&
          commonIds.has(coordinate.block.id),
      )
      .sort((left, right) => left.siblingIndex - right.siblingIndex)
      .map((coordinate) => coordinate.block.id);
  const parentIds = new Set<string | null>([
    null,
    ...beforeCoordinates.map((coordinate) => coordinate.parentBlockId),
    ...afterCoordinates.map((coordinate) => coordinate.parentBlockId),
  ]);
  const reorderedIds = new Set<string>();
  for (const parentBlockId of parentIds) {
    const previous = commonSiblingOrder(beforeCoordinates, parentBlockId);
    const next = commonSiblingOrder(afterCoordinates, parentBlockId);
    if (previous.join("\u0000") === next.join("\u0000")) continue;
    previous.forEach((blockId, index) => {
      if (next[index] !== blockId) reorderedIds.add(blockId);
    });
    next.forEach((blockId, index) => {
      if (previous[index] !== blockId) reorderedIds.add(blockId);
    });
  }
  const movedBlockIds = beforeIds.filter((blockId) => {
    const previous = beforeById.get(blockId);
    const next = afterById.get(blockId);
    if (!previous || !next) return false;
    return (
      previous.parentBlockId !== next.parentBlockId || reorderedIds.has(blockId)
    );
  });
  const destructive = forceWriteFence || durableWriteFenceBlockIds.length > 0;
  return {
    createdBlockIds,
    deletedBlockIds,
    updatedBlockIds,
    movedBlockIds,
    writeFenceBlockIds: durableWriteFenceBlockIds,
    titleChanged,
    coordination: destructive ? "write_fence" : "merge_friendly",
  };
};

const assertCreatedIdsNeverExisted = (
  database: Database.Database,
  request: MutationRequestBase,
  createdBlockIds: readonly string[],
): void => {
  if (createdBlockIds.length === 0) return;
  const read = database.prepare(
    "SELECT project_id, lifecycle FROM blocks WHERE id = ?",
  );
  for (const blockId of createdBlockIds) {
    const existing = read.get(blockId) as
      { readonly project_id: string; readonly lifecycle: string } | undefined;
    if (!existing) continue;
    reject(
      "duplicate_block_id",
      `Block identity ${blockId} already exists or is tombstoned in Project ${existing.project_id}`,
      request,
      { blockId },
    );
  }
};

const assertCreatedIdsAreNewOrStagedOwners = (
  database: Database.Database,
  request: MutationRequestBase,
  createdBlockIds: readonly string[],
  allowedStagedOwnerIds: readonly string[] = [],
  allowedReparentedBlockIds: readonly string[] = [],
): void => {
  const stagedOwners = new Set(allowedStagedOwnerIds);
  const reparented = new Set(allowedReparentedBlockIds);
  const overlap = [...stagedOwners].find((blockId) => reparented.has(blockId));
  if (overlap) {
    reject(
      "invalid_operation",
      `Trusted staged identity ${overlap} cannot be both an owner and an ordinary reparented Block`,
      request,
      { blockId: overlap },
    );
  }
  const allowed = new Set([...stagedOwners, ...reparented]);
  const created = new Set(createdBlockIds);
  if ([...allowed].some((blockId) => !created.has(blockId))) {
    reject(
      "invalid_operation",
      "Trusted staged-owner evidence contains a Block not created by this batch",
      request,
    );
  }
  assertCreatedIdsNeverExisted(
    database,
    request,
    createdBlockIds.filter((blockId) => !allowed.has(blockId)),
  );
  if (allowed.size === 0) return;
  const readOwner = database.prepare(`
    SELECT owner.project_id, owner.type, owner.lifecycle, owner.location_kind,
      owner.containing_document_id, document.readiness, document.authority,
      document.schema_key, document.schema_version,
      owner_project.library_id AS owner_library_id,
      operation_project.library_id AS operation_library_id
    FROM blocks owner
    INNER JOIN block_documents ownership
      ON ownership.block_id = owner.id
      AND ownership.project_id = owner.project_id
    INNER JOIN documents document
      ON document.id = ownership.document_id
      AND document.project_id = ownership.project_id
    INNER JOIN projects owner_project ON owner_project.id = owner.project_id
    INNER JOIN projects operation_project ON operation_project.id = ?
    WHERE owner.id = ?
  `);
  for (const blockId of stagedOwners) {
    const row = readOwner.get(request.projectId, blockId) as
      | {
          readonly project_id: string;
          readonly type: string;
          readonly lifecycle: string;
          readonly location_kind: string;
          readonly containing_document_id: string | null;
          readonly readiness: string;
          readonly authority: string;
          readonly schema_key: string;
          readonly schema_version: number;
          readonly owner_library_id: string;
          readonly operation_library_id: string;
        }
      | undefined;
    if (
      row !== undefined &&
      row.owner_library_id === row.operation_library_id &&
      row.lifecycle === "active" &&
      row.location_kind === "document" &&
      row.containing_document_id === request.documentId &&
      row.readiness === "ready" &&
      row.authority === "ydoc_primary"
    ) {
      try {
        getRegisteredBlockDocumentSchemaAdapter({
          ownerType: row.type,
          schemaKey: row.schema_key,
          schemaVersion: row.schema_version,
        });
        continue;
      } catch {
        // Fall through to the typed operation error below.
      }
    }
    reject(
      "invalid_operation",
      `Block ${blockId} is not a ready staged document-bearing owner in ${request.documentId}`,
      request,
      { blockId },
    );
  }
  const readReparented = database.prepare(`
    SELECT project_id, lifecycle, location_kind, containing_document_id
    FROM blocks WHERE id = ?
  `);
  for (const blockId of reparented) {
    const row = readReparented.get(blockId) as
      | {
          readonly project_id: string;
          readonly lifecycle: string;
          readonly location_kind: string;
          readonly containing_document_id: string | null;
        }
      | undefined;
    if (
      row?.project_id === request.projectId &&
      row.lifecycle === "active" &&
      row.location_kind === "document" &&
      row.containing_document_id === request.documentId
    ) {
      continue;
    }
    reject(
      "invalid_operation",
      `Block ${blockId} is not staged as an active ordinary Block in ${request.documentId}`,
      request,
      { blockId },
    );
  }
};

const flattenTargetBlockTypes = (
  blocks: readonly MaterializedBlock[],
): ReadonlyMap<string, string> =>
  new Map(
    blocks.flatMap((block): readonly (readonly [string, string])[] => [
      [block.id, block.type] as const,
      ...flattenTargetBlockTypes(block.children),
    ]),
  );

const assertRestoreIdsAreRetainedTombstones = (
  database: Database.Database,
  request: MutationRequestBase,
  createdBlockIds: readonly string[],
  targetBlocks: readonly MaterializedBlock[],
): void => {
  if (createdBlockIds.length === 0) return;
  const targetTypes = flattenTargetBlockTypes(targetBlocks);
  const read = database.prepare(`
    SELECT project_id, type, lifecycle, location_kind, containing_document_id
    FROM blocks
    WHERE id = ?
  `);
  for (const blockId of createdBlockIds) {
    const stored = read.get(blockId) as
      | {
          readonly project_id: string;
          readonly type: string;
          readonly lifecycle: string;
          readonly location_kind: string;
          readonly containing_document_id: string | null;
        }
      | undefined;
    const targetType = targetTypes.get(blockId);
    if (
      stored?.project_id === request.projectId &&
      stored.type === targetType &&
      stored.lifecycle === "deleted" &&
      stored.location_kind === "document" &&
      stored.containing_document_id === request.documentId
    ) {
      continue;
    }
    reject(
      "duplicate_block_id",
      `History restore may only reactivate a retained tombstone from the same Document: ${blockId}`,
      request,
      { blockId },
    );
  }
};

const prepareOperationBatch = (
  request: DocumentOperationBatch,
  document: Parameters<typeof materializePageDocument>[0],
  ownerBlockId: string,
  schema: {
    readonly ownerType: string;
    readonly schemaKey: string;
    readonly schemaVersion: number;
  },
  forceWriteFence = false,
  allowTransientEmptyResult = false,
): PreparedMutation => {
  const before = toPersistedBlockDocumentMaterialization(
    inspectOwnedBlockDocument(document, schema).materialization,
  );
  const prepared = prepareDocumentOperationUpdate({
    document,
    operations: request.operations,
    schema,
    transactionOrigin: `document-mutation:${request.mutationId}`,
    allowTransientEmptyResult,
  });
  return {
    update: prepared.update,
    ...deriveSemanticChangeSet(
      before,
      prepared.materialization,
      prepared.writeFenceBlockIds,
      forceWriteFence,
      ownerBlockId,
      prepared.titleWriteFenceRequired,
    ),
  };
};

const prepareNfmReplacement = (
  request: ReplaceDocumentFromNfm,
  document: Parameters<typeof materializePageDocument>[0],
): PreparedMutation => {
  const before = materializePageDocument(document);
  const replacement = replacePageDocumentBodyFromNfm({
    document,
    nfm: request.nfm,
    allocateBlockId: createUuidV7,
  });
  const titleChanged = request.richTitle !== undefined
    && portableRichTextSemanticSource(request.richTitle)
      !== portableRichTextSemanticSource(before.richTitle);
  if (!replacement.changed && !titleChanged) {
    reject(
      "no_change",
      "NFM replacement is already equal to the current Document body",
      request,
    );
  }
  const operations = [
    ...(replacement.changed
      ? compileBlockTreeReplacementOperations(
        before.blockTree,
        replacement.materialization.blockTree,
      )
      : []),
    ...(titleChanged
      ? [{ kind: "set_rich_title" as const, richTitle: request.richTitle as NonNullable<typeof request.richTitle> }]
      : []),
  ];
  const prepared = prepareDocumentOperationUpdate({
    document,
    operations,
    transactionOrigin: `replace-document-from-nfm:${request.mutationId}`,
  });
  if (
    portableRichTextSemanticSource(prepared.materialization.richTitle) !==
      portableRichTextSemanticSource(request.richTitle ?? before.richTitle) ||
    prepared.materialization.nfm !== replacement.materialization.nfm ||
    stableStringify(prepared.materialization.blockTree) !==
      stableStringify(replacement.materialization.blockTree)
  ) {
    reject(
      "invalid_operation",
      "NFM replacement operations did not reproduce the validated target BlockTree",
      request,
    );
  }
  return {
    update: prepared.update,
    ...deriveSemanticChangeSet(
      before,
      prepared.materialization,
      prepared.writeFenceBlockIds,
      true,
    ),
  };
};

const persistChangeLog = (
  database: Database.Database,
  request: MutationRequestBase,
  evidence: MutationEvidence,
  context: StrictDocumentUpdateCommitContext,
  prepared: PreparedMutation,
  semanticTouchedBlockIds: readonly string[],
): number => {
  const result = database
    .prepare(
      `
      INSERT INTO change_log (
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?)
    `,
    )
    .run(
      request.projectId,
      request.storeEpoch,
      CHANGE_LOG_KIND,
      request.mutationId,
      JSON.stringify(semanticTouchedBlockIds),
      evidence.affectedDocumentIdsJson,
      serializeDocumentChangePayload(evidence, {
        generation: context.generation,
        baseHeadSeq: context.baseHeadSeq,
        headSeq: context.headSeq,
        createdBlockIds: prepared.createdBlockIds,
        deletedBlockIds: prepared.deletedBlockIds,
        updatedBlockIds: prepared.updatedBlockIds,
        movedBlockIds: prepared.movedBlockIds,
        writeFenceBlockIds: prepared.writeFenceBlockIds,
        titleChanged: prepared.titleChanged,
        coordination: prepared.coordination,
      }),
      context.committedAt,
    );
  const seq = Number(result.lastInsertRowid);
  if (Number.isSafeInteger(seq) && seq >= 1) return seq;
  throw new BlockDocumentStoreError(
    "document_state_corrupt",
    "SQLite returned an invalid Document mutation change sequence",
  );
};

const persistCommittedMutation = (
  database: Database.Database,
  request: MutationRequestBase,
  evidence: MutationEvidence,
  context: StrictDocumentUpdateCommitContext,
  prepared: PreparedMutation,
  inject: (point: DocumentOperationFaultPoint) => void,
  semanticTouchedBlockIds: readonly string[],
): DocumentOperationResult => {
  inject("after_document_update");
  const changeLogSeq = persistChangeLog(
    database,
    request,
    evidence,
    context,
    prepared,
    semanticTouchedBlockIds,
  );
  inject("after_change_log");
  const result: DocumentOperationResult = {
    version: DOCUMENT_OPERATION_CONTRACT_VERSION,
    mutationKind: evidence.mutationKind,
    mutationId: request.mutationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    documentId: request.documentId,
    generation: context.generation,
    baseHeadSeq: context.baseHeadSeq,
    headSeq: context.headSeq,
    touchedBlockIds: semanticTouchedBlockIds,
    createdBlockIds: prepared.createdBlockIds,
    deletedBlockIds: prepared.deletedBlockIds,
    updatedBlockIds: prepared.updatedBlockIds,
    movedBlockIds: prepared.movedBlockIds,
    writeFenceBlockIds: prepared.writeFenceBlockIds,
    titleChanged: prepared.titleChanged,
    coordination: prepared.coordination,
    changeLogSeq,
    committedAt: context.committedAt,
    duplicate: false,
  };
  const documentHead = {
    generation: context.generation,
    headSeq: context.headSeq,
  };
  persistLedger(database, {
    request,
    evidence,
    targetBlockIdsJson: JSON.stringify(result.touchedBlockIds),
    outcome: "committed",
    resultJson: stableStringify(result),
    committedRevisionsJson: stableStringify({
      [request.documentId]: documentHead,
    }),
    documentHeadsJson: stableStringify({
      [request.documentId]: documentHead,
    }),
    changeLogSeq,
    recordedAt: context.committedAt,
  });
  inject("after_ledger");
  inject("before_commit");
  return result;
};

const applyPreparedMutation = (
  database: Database.Database,
  request: MutationRequestBase,
  evidence: MutationEvidence,
  prepared: PreparedMutation,
  options: ApplyDocumentOperationOptions,
  beforeApply?: () => void,
): DocumentOperationCommandResult => {
  const inject = (point: DocumentOperationFaultPoint): void => {
    options.faultInjector?.(point);
  };
  if (prepared.coordination === "write_fence") {
    const fence = options.writeFence;
    const validFence =
      fence !== undefined &&
      fence.leaseId.length > 0 &&
      fence.leaseId.length <= 512 &&
      fence.leaseId === fence.leaseId.trim() &&
      fence.documentId === request.documentId &&
      fence.generation === request.generation &&
      fence.headSeq === request.expectedHeadSeq;
    if (!validFence) {
      return {
        ok: false,
        error: {
          ...makeError(
            "write_fence_required",
            "Identity-destructive Document mutations require a trusted current-head write fence",
            request,
            {
              expectedGeneration: request.generation,
              expectedHeadSeq: request.expectedHeadSeq,
            },
          ),
          retryable: true,
        },
      };
    }
  }
  const updateId = `document-mutation:${evidence.requestHash}`;
  const clientSessionId =
    request.clientSessionId ?? `document-mutation:${evidence.requestHash}`;
  try {
    beforeApply?.();
    const ack = applyStrictBlockDocumentUpdate(
      database,
      {
        documentId: request.documentId,
        storeEpoch: request.storeEpoch,
        generation: request.generation,
        updateId,
        clientSessionId,
        baseHeadSeq: request.expectedHeadSeq,
        touchedBlockIds: [],
        update: prepared.update,
      },
      {
        readCommittedSeq: (transactionDatabase) => {
          const stored = readStoredMutation(
            transactionDatabase,
            request.mutationId,
          );
          if (!stored) return null;
          const outcome = loadStoredOutcome(
            transactionDatabase,
            stored,
            request,
            evidence,
          );
          if (!outcome.ok) throw new DocumentMutationRejection(outcome.error);
          return outcome.value.headSeq;
        },
        assertCurrentHead: (currentHeadSeq) => {
          if (currentHeadSeq === request.expectedHeadSeq) return;
          reject(
            "document_head_conflict",
            `Document ${request.documentId} is at head ${currentHeadSeq}; expected ${request.expectedHeadSeq}`,
            request,
            {
              expectedHeadSeq: request.expectedHeadSeq,
              actualHeadSeq: currentHeadSeq,
            },
          );
        },
        persistCommit: (transactionDatabase, context) => {
          const semanticTouchedBlockIds = uniqueSorted([
            ...(prepared.titleChanged ? [context.ownerBlockId] : []),
            ...prepared.createdBlockIds,
            ...prepared.deletedBlockIds,
            ...prepared.updatedBlockIds,
            ...prepared.movedBlockIds,
          ]);
          persistCommittedMutation(
            transactionDatabase,
            request,
            evidence,
            context,
            prepared,
            inject,
            semanticTouchedBlockIds,
          );
        },
        allowPendingSyncedReferenceTargetIds:
          options.allowPendingSyncedReferenceTargetIds,
        allowStagedDocumentBearingBlockIds:
          options.allowStagedDocumentBearingBlockIds,
        allowStagedReparentedBlockIds:
          options.allowStagedReparentedBlockIds,
        preserveRemovedBlockIds: options.preserveRemovedBlockIds,
        allowTransientEmptyBlockTree: options.allowTransientEmptyBlockTree,
        ...(prepared.trustedMaxUpdateBytes === undefined
          ? {}
          : { maxTrustedUpdateBytes: prepared.trustedMaxUpdateBytes }),
      },
    );
    const stored = readStoredMutation(database, request.mutationId);
    if (!stored) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Mutation ${request.mutationId} committed without ledger evidence`,
      );
    }
    const storedOutcome = loadStoredOutcome(
      database,
      stored,
      request,
      evidence,
    );
    if (!storedOutcome.ok) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Mutation ${request.mutationId} committed with a rejected ledger outcome`,
      );
    }
    const revisionCaptureDeferredToOuterCommand =
      options.skipAutomaticRevisionCapture === true ||
      (options.allowPendingSyncedReferenceTargetIds?.length ?? 0) > 0 ||
      (options.allowStagedDocumentBearingBlockIds?.length ?? 0) > 0 ||
      (options.allowStagedReparentedBlockIds?.length ?? 0) > 0;
    if (!ack.duplicate && !revisionCaptureDeferredToOuterCommand) {
      if (stored.change_log_seq === null) {
        throw new BlockDocumentStoreError(
          "document_state_corrupt",
          `Mutation ${request.mutationId} committed without a change sequence`,
        );
      }
      const isRestore = evidence.mutationKind === "document_version_restore";
      const revision = createDocumentVersionCheckpoint(database, {
        version: DOCUMENT_OPERATION_CONTRACT_VERSION,
        projectId: request.projectId,
        storeEpoch: request.storeEpoch,
        documentId: request.documentId,
        expectedGeneration: request.generation,
        expectedHeadSeq: storedOutcome.value.headSeq,
        cause: isRestore ? "after_restore" : evidence.mutationKind,
        ...(isRestore && "versionId" in request
          ? { label: `Restored ${request.versionId}` }
          : {}),
        revisionKind: isRestore ? "restore" : "operation",
        sourceMutationId: request.mutationId,
        sourceChangeSeq: stored.change_log_seq,
        actor: JSON.parse(evidence.actorJson) as DocumentVersionActor,
      });
      markDocumentRevisionSessionCheckpoint(database, {
        documentId: request.documentId,
        generation: request.generation,
        checkpointHeadSeq: revision.checkpoint.baseHeadSeq,
        createdAt: revision.checkpoint.createdAt,
        finalize: true,
      });
    }
    return {
      ok: true,
      value: { ...storedOutcome.value, duplicate: ack.duplicate },
    };
  } catch (error) {
    if (error instanceof DocumentMutationRejection) {
      return rejectAndPersist(database, request, evidence, error.error);
    }
    if (error instanceof BlockDocumentStoreError) {
      const mapped = mapStoreError(error, request);
      if (mapped.code === "document_state_corrupt") throw error;
      return rejectAndPersist(database, request, evidence, mapped);
    }
    throw error;
  }
};

const applyMutationInTransaction = (
  database: Database.Database,
  request: DocumentMutationRequest,
  evidence: MutationEvidence,
  options: ApplyDocumentOperationOptions,
): DocumentOperationCommandResult => {
  const currentEpoch = readStoreEpoch(database);
  if (currentEpoch !== request.storeEpoch) {
    return {
      ok: false,
      error: makeError(
        "store_epoch_mismatch",
        `Mutation belongs to store epoch ${request.storeEpoch}; current epoch is ${currentEpoch ?? "missing"}`,
        request,
      ),
    };
  }
  const existing = readStoredMutation(database, request.mutationId);
  if (existing) return loadStoredOutcome(database, existing, request, evidence);
  options.beforeMutationApply?.();

  let projectId: string;
  try {
    projectId = getBlockDocumentProjectId(database, request.documentId);
  } catch (error) {
    if (!(error instanceof BlockDocumentStoreError)) throw error;
    return rejectAndPersist(
      database,
      request,
      evidence,
      mapStoreError(error, request),
    );
  }
  if (projectId !== request.projectId) {
    return rejectAndPersist(
      database,
      request,
      evidence,
      makeError(
        "project_scope_mismatch",
        `Document ${request.documentId} belongs to Project ${projectId}`,
        request,
      ),
    );
  }

  let loaded;
  try {
    loaded = loadPrimaryBlockDocument(database, request.documentId, {
      allowAbsentActiveBlockIds:
        [
          ...(options.allowStagedDocumentBearingBlockIds ?? []),
          ...(options.allowStagedReparentedBlockIds ?? []),
        ],
    });
  } catch (error) {
    if (!(error instanceof BlockDocumentStoreError)) throw error;
    return rejectAndPersist(
      database,
      request,
      evidence,
      mapStoreError(error, request),
    );
  }
  try {
    if (loaded.storeEpoch !== request.storeEpoch) {
      return {
        ok: false,
        error: makeError(
          "store_epoch_mismatch",
          `Mutation belongs to store epoch ${request.storeEpoch}; current epoch is ${loaded.storeEpoch}`,
          request,
        ),
      };
    }
    if (loaded.head.generation !== request.generation) {
      return rejectAndPersist(
        database,
        request,
        evidence,
        makeError(
          "document_generation_conflict",
          `Document ${request.documentId} generation is ${loaded.head.generation}; expected ${request.generation}`,
          request,
          {
            expectedGeneration: request.generation,
            actualGeneration: loaded.head.generation,
          },
        ),
      );
    }
    if (loaded.head.headSeq !== request.expectedHeadSeq) {
      return rejectAndPersist(
        database,
        request,
        evidence,
        makeError(
          "document_head_conflict",
          `Document ${request.documentId} is at head ${loaded.head.headSeq}; expected ${request.expectedHeadSeq}`,
          request,
          {
            expectedHeadSeq: request.expectedHeadSeq,
            actualHeadSeq: loaded.head.headSeq,
          },
        ),
      );
    }

    const schema = {
      ownerType: loaded.ownerType,
      schemaKey: loaded.head.schemaKey,
      schemaVersion: loaded.head.schemaVersion,
    };
    const adapter = getRegisteredBlockDocumentSchemaAdapter(schema);

    let prepared: PreparedMutation;
    let beforeApply: (() => void) | undefined;
    try {
      if (evidence.mutationKind === "document_operation_batch") {
        if (adapter.contentModel !== "block_tree") {
          return rejectAndPersist(
            database,
            request,
            evidence,
            makeError(
              "invalid_operation",
              `Document schema ${adapter.schemaKey}@${adapter.schemaVersion} does not support block operation batches`,
              request,
            ),
          );
        }
        prepared = prepareOperationBatch(
          request as DocumentOperationBatch,
          loaded.document,
          loaded.head.ownerBlockId,
          schema,
          false,
          options.allowTransientEmptyBlockTree,
        );
        assertCreatedIdsAreNewOrStagedOwners(
          database,
          request,
          prepared.createdBlockIds,
          options.allowStagedDocumentBearingBlockIds,
          options.allowStagedReparentedBlockIds,
        );
      } else if (evidence.mutationKind === "replace_document_from_nfm") {
        if (!adapter.capabilities.nfmReplace) {
          return rejectAndPersist(
            database,
            request,
            evidence,
            makeError(
              "invalid_operation",
              `Document schema ${adapter.schemaKey}@${adapter.schemaVersion} does not support whole-NFM replacement`,
              request,
            ),
          );
        }
        prepared = prepareNfmReplacement(
          request as ReplaceDocumentFromNfm,
          loaded.document,
        );
        assertCreatedIdsNeverExisted(database, request, prepared.createdBlockIds);
      } else {
        const restoreRequest = request as PrepareDocumentVersionRestore;
        const restore = prepareDocumentVersionRestore(database, restoreRequest);
        if (restore.kind !== "operation_plan") {
          return reject(
            "no_change",
            `Document is already equal to version ${restore.sourceVersion.versionId}`,
            request,
          );
        }
        if (restore.plan.contentModel === "scene_graph") {
          throw new BlockDocumentStoreError(
            "document_state_corrupt",
            "Scene-graph restore entered the Yjs Document operation engine",
          );
        } else {
          prepared = prepareOperationBatch(
            {
              ...restoreRequest,
              operations: restore.plan.operations,
            },
            loaded.document,
            loaded.head.ownerBlockId,
            schema,
            true,
          );
          assertRestoreIdsAreRetainedTombstones(
            database,
            request,
            prepared.createdBlockIds,
            restore.plan.targetBlockTree,
          );
        }
        beforeApply = () => {
          createDocumentVersionCheckpoint(database, {
            version: DOCUMENT_OPERATION_CONTRACT_VERSION,
            projectId: restoreRequest.projectId,
            storeEpoch: restoreRequest.storeEpoch,
            documentId: restoreRequest.documentId,
            expectedGeneration: restoreRequest.generation,
            expectedHeadSeq: restoreRequest.expectedHeadSeq,
            cause: "before_restore",
            label: `Before restore ${restoreRequest.versionId}`,
            revisionKind: "restore",
            sourceMutationId: restoreRequest.mutationId,
            actor: {
              ...restoreRequest.actor,
              restoreMutationId: restoreRequest.mutationId,
              sourceVersionId: restoreRequest.versionId,
            },
          });
        };
      }
    } catch (error) {
      if (error instanceof DocumentMutationRejection) {
        return rejectAndPersist(database, request, evidence, error.error);
      }
      if (error instanceof DocumentOperationEngineError) {
        return rejectAndPersist(
          database,
          request,
          evidence,
          mapEngineError(error, request),
        );
      }
      if (error instanceof LegacyNfmShadowTranslationError) {
        return rejectAndPersist(
          database,
          request,
          evidence,
          makeError("invalid_block", error.message, request),
        );
      }
      if (error instanceof DocumentVersionStoreError) {
        return rejectAndPersist(
          database,
          request,
          evidence,
          mapVersionStoreError(error, request),
        );
      }
      throw error;
    }
    options.faultInjector?.("after_update_prepared");
    return applyPreparedMutation(
      database,
      request,
      evidence,
      prepared,
      options,
      beforeApply,
    );
  } finally {
    loaded.document.destroy();
  }
};

const applyMutation = (
  database: Database.Database,
  request: DocumentMutationRequest,
  evidence: MutationEvidence,
  options: ApplyDocumentOperationOptions,
): DocumentOperationCommandResult => {
  const apply = database.transaction(() =>
    applyMutationInTransaction(database, request, evidence, options),
  );
  const result = apply.immediate();
  options.faultInjector?.("after_commit");
  return result;
};

const canvasOptionalJson = (
  value: import("../../shared/block-documents/canvas-scene").CanvasSceneJsonValue | undefined,
): CanvasSceneOptionalJson =>
  value === undefined ? { kind: "absent" } : { kind: "value", value };

const applyCanvasVersionRestore = (
  database: Database.Database,
  request: PrepareDocumentVersionRestore,
  evidence: MutationEvidence,
  options: ApplyDocumentOperationOptions,
): DocumentOperationCommandResult => {
  const apply = database.transaction((): DocumentOperationCommandResult => {
    const existing = readStoredMutation(database, request.mutationId);
    if (existing) return loadStoredOutcome(database, existing, request, evidence);

    const fence = options.writeFence;
    if (
      !fence ||
      fence.leaseId.length === 0 ||
      fence.leaseId.length > 512 ||
      fence.leaseId !== fence.leaseId.trim() ||
      fence.documentId !== request.documentId ||
      fence.generation !== request.generation ||
      fence.headSeq !== request.expectedHeadSeq
    ) {
      return {
        ok: false,
        error: {
          ...makeError(
            "write_fence_required",
            "Canvas history restore requires a trusted current-head write fence",
            request,
            {
              expectedGeneration: request.generation,
              expectedHeadSeq: request.expectedHeadSeq,
            },
          ),
          retryable: true,
        },
      };
    }

    let prepared: PreparedDocumentVersionRestore;
    try {
      prepared = prepareDocumentVersionRestore(database, request);
    } catch (error) {
      if (error instanceof DocumentVersionStoreError) {
        return { ok: false, error: mapVersionStoreError(error, request) };
      }
      throw error;
    }
    if (prepared.kind === "already_current") {
      return {
        ok: false,
        error: makeError(
          "no_change",
          `Document is already equal to version ${prepared.sourceVersion.versionId}`,
          request,
        ),
      };
    }
    if (prepared.plan.contentModel !== "scene_graph") {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        "Canvas restore preparation returned a block-tree plan",
      );
    }
    const current = syncCanvasScene(database, {
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: request.projectId,
      documentId: request.documentId,
      clientSessionId: request.clientSessionId ?? "document-history:restore",
      knownStoreEpoch: request.storeEpoch,
      knownGeneration: request.generation,
      knownHeadSeq: request.expectedHeadSeq,
    });
    if (!current.ok) {
      return {
        ok: false,
        error: makeError("document_state_corrupt", current.error.message, request),
      };
    }

    createDocumentVersionCheckpoint(database, {
      version: DOCUMENT_OPERATION_CONTRACT_VERSION,
      projectId: request.projectId,
      storeEpoch: request.storeEpoch,
      documentId: request.documentId,
      expectedGeneration: request.generation,
      expectedHeadSeq: request.expectedHeadSeq,
      cause: "before_restore",
      label: `Before restore ${request.versionId}`,
      revisionKind: "restore",
      sourceMutationId: request.mutationId,
      actor: {
        ...request.actor,
        restoreMutationId: request.mutationId,
        sourceVersionId: request.versionId,
      },
    });

    const appStateIntents: Record<string, CanvasSceneAppStateIntent> = {};
    for (const key of new Set([
      ...Object.keys(current.value.scene.appState),
      ...Object.keys(prepared.plan.forwardRestore.appState),
    ])) {
      appStateIntents[key] = {
        expected: canvasOptionalJson(current.value.scene.appState[key]),
        value: canvasOptionalJson(prepared.plan.forwardRestore.appState[key]),
      };
    }
    const restored = applyCanvasSceneMutation(database, {
      version: CANVAS_SCENE_SYNC_VERSION,
      mutationId: request.mutationId,
      projectId: request.projectId,
      documentId: request.documentId,
      storeEpoch: request.storeEpoch,
      generation: request.generation,
      baseHeadSeq: request.expectedHeadSeq,
      clientSessionId: request.clientSessionId ?? "document-history:restore",
      elementCandidates: prepared.plan.forwardRestore.elementCandidates,
      appStateIntents,
      fileAdditions: prepared.plan.forwardRestore.files,
    });
    if (!restored.ok) {
      return {
        ok: false,
        error: makeError(
          restored.error.code === "document_generation_mismatch"
            ? "document_generation_conflict"
            : restored.error.code === "document_not_found"
              ? "document_not_found"
              : "document_state_corrupt",
          restored.error.message,
          request,
        ),
      };
    }
    if (restored.value.outcome !== "committed") {
      return {
        ok: false,
        error: makeError("no_change", "Canvas restore produced no scene change", request),
      };
    }

    const owner = database.prepare(
      "SELECT block_id FROM block_documents WHERE document_id = ?",
    ).get(request.documentId) as { readonly block_id: string } | undefined;
    if (!owner) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Canvas Document ${request.documentId} has no owner Block`,
      );
    }
    const semanticTouchedBlockIds = [owner.block_id];
    const preparedMutation: PreparedMutation = {
      update: new Uint8Array(),
      createdBlockIds: [],
      deletedBlockIds: [],
      updatedBlockIds: semanticTouchedBlockIds,
      movedBlockIds: [],
      writeFenceBlockIds: semanticTouchedBlockIds,
      titleChanged: false,
      coordination: "write_fence",
    };
    const result = persistCommittedMutation(
      database,
      request,
      evidence,
      {
        projectId: request.projectId,
        ownerBlockId: owner.block_id,
        documentId: request.documentId,
        storeEpoch: request.storeEpoch,
        generation: request.generation,
        baseHeadSeq: request.expectedHeadSeq,
        headSeq: restored.value.headSeq,
        updateId: `canvas-history-restore:${request.mutationId}`,
        derivedTouchedBlockIds: semanticTouchedBlockIds,
        committedAt: restored.value.committedAt,
      },
      preparedMutation,
      () => undefined,
      semanticTouchedBlockIds,
    );
    createDocumentVersionCheckpoint(database, {
      version: DOCUMENT_OPERATION_CONTRACT_VERSION,
      projectId: request.projectId,
      storeEpoch: request.storeEpoch,
      documentId: request.documentId,
      expectedGeneration: request.generation,
      expectedHeadSeq: restored.value.headSeq,
      cause: "after_restore",
      label: `Restored ${request.versionId}`,
      revisionKind: "restore",
      sourceMutationId: request.mutationId,
      sourceChangeSeq: result.changeLogSeq,
      actor: request.actor,
    });
    return { ok: true, value: result };
  });
  const result = apply.immediate();
  options.faultInjector?.("after_commit");
  return result;
};

/** Apply an ordered stable-ID body/title batch through one strict Y.Doc CAS. */
export const applyDocumentOperationBatch = (
  database: Database.Database,
  rawRequest: DocumentOperationBatch,
  options: ApplyDocumentOperationOptions = {},
): DocumentOperationCommandResult => {
  const request = parseDocumentOperationBatch(rawRequest);
  const canonicalRequest = canonicalizeDocumentOperationIntent(request);
  const evidence = makeEvidence(
    request,
    "document_operation_batch",
    canonicalRequest,
  );
  return applyMutation(database, request, evidence, options);
};

/** Explicit whole-body import seam; normal Agent edits must use block ops. */
export const replaceDocumentFromNfm = (
  database: Database.Database,
  rawRequest: ReplaceDocumentFromNfm,
  options: ApplyDocumentOperationOptions = {},
): DocumentOperationCommandResult => {
  const request = parseReplaceDocumentFromNfm(rawRequest);
  const canonicalRequest = canonicalizeReplaceDocumentFromNfmIntent(request);
  const evidence = makeEvidence(
    request,
    "replace_document_from_nfm",
    canonicalRequest,
  );
  return applyMutation(database, request, evidence, options);
};

/**
 * Trusted recovery seam for a host receipt that already binds this mutation ID
 * to the same dynamic call. It returns no request body and never executes work.
 */
export const readCommittedDocumentOperationResult = (
  database: Database.Database,
  mutationId: string,
): DocumentOperationResult | null => {
  const stored = readStoredMutation(database, mutationId);
  if (!stored || stored.outcome !== "committed") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.result_json);
  } catch {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Mutation ${mutationId} has invalid result JSON`,
    );
  }
  const result = parseDocumentOperationResult(parsed);
  if (result.mutationId !== mutationId || result.projectId !== stored.project_id) {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Mutation ${mutationId} result identity is inconsistent`,
    );
  }
  return { ...result, duplicate: true };
};

/** Restore an immutable checkpoint as one forward update through the writer. */
export const restoreDocumentVersion = (
  database: Database.Database,
  rawRequest: PrepareDocumentVersionRestore,
  options: ApplyDocumentOperationOptions = {},
): DocumentOperationCommandResult => {
  const request = parseDocumentVersionRestore(rawRequest);
  const canonicalRequest = canonicalizeDocumentVersionRestoreIntent(request);
  const evidence = makeEvidence(
    request,
    "document_version_restore",
    canonicalRequest,
  );
  const engine = database.prepare(
    "SELECT sync_engine FROM documents WHERE id = ?",
  ).get(request.documentId) as { readonly sync_engine: string } | undefined;
  if (engine?.sync_engine === "canvas_scene") {
    return applyCanvasVersionRestore(database, request, evidence, options);
  }
  return applyMutation(database, request, evidence, options);
};

export { DocumentOperationContractError };
