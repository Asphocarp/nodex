import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  type BlockDocumentAssetReference,
  type BlockDocumentReference,
  type BlockTreeNode,
  type CardDocumentMaterialization,
} from "../../shared/block-documents/block-document-codec";
import type { PortableRichText } from "../../shared/block-documents/portable-rich-text";
import { createUuidV7 } from "../../shared/card-id";
import {
  AgentDocumentEditCompilerError,
  compileAgentDocumentEdit,
  EditDocumentOutputSchema,
  type CompleteNodexAgentDocumentEditRequest,
  type CompleteNodexAgentDocumentEditResult,
  type EditDocumentOutput,
  type JsonValue,
  type PrepareNodexAgentDocumentEditRequest,
  type PrepareNodexAgentDocumentEditResult,
} from "../../shared/nodex-agent-tools";
import type {
  DocumentMutationRequest,
} from "../../shared/block-documents/document-operations";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { readCommittedDocumentOperationResult } from "../local-store/block-document-operations";
import {
  decodeNodexAgentToken,
  NodexAgentTokenError,
} from "../local-store/nodex-agent-token-codec";
import {
  mintRevision,
  NODEX_AGENT_RESPONSE_MAX_BYTES,
  NodexAgentReadError,
  nodexAgentFingerprint,
  parseJsonValue,
  readFailure,
  requireProject,
} from "./read-support";

import {
  nodexAgentCallIdentity,
  readNodexAgentCallReceipt,
  requireMatchingNodexAgentCallReceipt,
  type NodexAgentCallReceiptRow,
} from "./call-receipts";

interface DocumentMaterializationRow {
  readonly owner_block_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly materialization_generation: number | null;
  readonly projected_seq: number | null;
  readonly materialization_schema_version: number | null;
  readonly title: string | null;
  readonly title_rich_json: string | null;
  readonly nfm: string | null;
  readonly plain_text: string | null;
  readonly preview: string | null;
  readonly block_tree_json: string | null;
  readonly references_json: string | null;
  readonly asset_refs_json: string | null;
}

function parseStringArray(value: string, label: string): string[] {
  const parsed = parseJsonValue(value, label);
  if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
    return [...parsed];
  }
  throw new NodexAgentReadError(
    "internal_error",
    `${label} is invalid`,
    false,
    "none",
    { domainCode: "corrupt_agent_receipt" },
  );
}

function readCurrentDocument(
  database: Database.Database,
  projectId: string,
  documentId: string,
): DocumentMaterializationRow {
  const row = database.prepare(
    `
    SELECT
      ownership.block_id AS owner_block_id,
      document.generation, document.head_seq, document.schema_key,
      document.schema_version, document.readiness,
      materialization.generation AS materialization_generation,
      materialization.projected_seq,
      materialization.schema_version AS materialization_schema_version,
      materialization.title, materialization.title_rich_json,
      materialization.nfm, materialization.plain_text,
      materialization.preview, materialization.block_tree_json,
      materialization.references_json, materialization.asset_refs_json
    FROM documents document
    INNER JOIN block_documents ownership
      ON ownership.document_id = document.id
     AND ownership.project_id = document.project_id
    LEFT JOIN document_materializations materialization
      ON materialization.document_id = document.id
    WHERE document.id = ? AND document.project_id = ?
    LIMIT 1
  `).get(documentId, projectId) as DocumentMaterializationRow | undefined;
  if (!row) {
    throw new NodexAgentReadError(
      "not_found",
      `Document ${documentId} was not found in the bound Project`,
      false,
      "none",
      { resourceId: documentId, domainCode: "document_not_found" },
    );
  }
  if (row.schema_key !== "nodex.card") {
    throw new NodexAgentReadError(
      "unsupported_resource",
      `Document ${documentId} is not a Card document`,
      false,
      "none",
      { resourceId: documentId, domainCode: row.schema_key },
    );
  }
  if (
    row.readiness !== "ready"
    || row.materialization_generation !== row.generation
    || row.projected_seq !== row.head_seq
    || row.materialization_schema_version !== row.schema_version
    || row.title === null
    || row.title_rich_json === null
    || row.nfm === null
    || row.plain_text === null
    || row.preview === null
    || row.block_tree_json === null
    || row.references_json === null
    || row.asset_refs_json === null
  ) {
    throw new NodexAgentReadError(
      "projection_not_ready",
      `Document ${documentId} does not have an exact current materialization`,
      true,
      "get_block_again",
      { resourceId: documentId, domainCode: row.readiness },
    );
  }
  return row;
}

function toMaterialization(row: DocumentMaterializationRow): CardDocumentMaterialization {
  return {
    schemaVersion: row.schema_version,
    title: row.title as string,
    richTitle: parseJsonValue(
      row.title_rich_json as string,
      "Document rich title",
    ) as unknown as PortableRichText,
    nfm: row.nfm as string,
    plainText: row.plain_text as string,
    preview: row.preview as string,
    blockTree: parseJsonValue(
      row.block_tree_json as string,
      "Document Block tree",
    ) as unknown as readonly BlockTreeNode[],
    references: parseJsonValue(
      row.references_json as string,
      "Document references",
    ) as unknown as readonly BlockDocumentReference[],
    assetRefs: parseJsonValue(
      row.asset_refs_json as string,
      "Document asset references",
    ) as unknown as readonly BlockDocumentAssetReference[],
  };
}

function tokenCoordinate(value: JsonValue | undefined, key: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new NodexAgentReadError(
    "conflict",
    `Document revision is missing ${key}`,
    false,
    "get_block_again",
  );
}

function mutationRequest(input: {
  readonly request: PrepareNodexAgentDocumentEditRequest;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly compiled: ReturnType<typeof compileAgentDocumentEdit>;
}): DocumentMutationRequest {
  const envelope = {
    version: 1 as const,
    mutationId: input.mutationId,
    projectId: input.request.projectId,
    storeEpoch: input.storeEpoch,
    clientSessionId: `nodex-agent:${input.request.threadId}`.slice(0, 512),
    actor: {
      kind: "nodex_agent",
      threadId: input.request.threadId,
      callId: input.request.callId,
    },
    documentId: input.request.input.documentId,
    generation: input.generation,
    expectedHeadSeq: input.headSeq,
  };
  if (input.compiled.mutation.kind === "operations") {
    return { ...envelope, operations: input.compiled.mutation.operations };
  }
  return {
    ...envelope,
    nfm: input.compiled.mutation.nfm,
    ...(input.compiled.mutation.richTitle
      ? { richTitle: input.compiled.mutation.richTitle }
      : {}),
  };
}

function compactReplayOutput(output: EditDocumentOutput): EditDocumentOutput {
  return EditDocumentOutputSchema.parse({
    ...output,
    data: {
      ...output.data,
      body: { contentOmitted: true },
      receipt: { duplicate: false },
    },
  });
}

function replayOutput(receipt: NodexAgentCallReceiptRow): EditDocumentOutput {
  const metadata = parseJsonValue(
    receipt.result_metadata_json,
    `Agent call ${receipt.call_identity} result metadata`,
  );
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new NodexAgentReadError(
      "internal_error",
      "Agent call result metadata is invalid",
      false,
      "none",
    );
  }
  const output = EditDocumentOutputSchema.parse(metadata.output);
  return EditDocumentOutputSchema.parse({
    ...output,
    data: { ...output.data, receipt: { duplicate: true } },
  });
}

function finishDocumentEdit(
  database: Database.Database,
  request: CompleteNodexAgentDocumentEditRequest,
): EditDocumentOutput {
  const identity = nodexAgentCallIdentity({ ...request, tool: "edit_document" });
  const receipt = readNodexAgentCallReceipt(database, identity);
  if (!receipt || receipt.project_id !== request.projectId || receipt.tool !== "edit_document") {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "No matching prepared Agent document edit exists",
      false,
      "none",
    );
  }
  if (receipt.status === "committed") return replayOutput(receipt);
  if (
    request.result.mutationId !== receipt.mutation_id
    || request.result.projectId !== request.projectId
  ) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "Document mutation result does not match the prepared Agent call",
      false,
      "none",
    );
  }
  const canonicalResult = readCommittedDocumentOperationResult(
    database,
    receipt.mutation_id,
  );
  if (!canonicalResult) {
    throw new NodexAgentReadError(
      "internal_error",
      "The prepared Agent call has no committed canonical mutation result",
      true,
      "none",
    );
  }
  const canonicalFingerprint = nodexAgentFingerprint({
    ...canonicalResult,
    duplicate: false,
  });
  const suppliedFingerprint = nodexAgentFingerprint({
    ...request.result,
    duplicate: false,
  });
  if (canonicalFingerprint !== suppliedFingerprint) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "Document mutation result does not match its canonical receipt",
      false,
      "none",
    );
  }
  const preparedMetadata = parseJsonValue(
    receipt.result_metadata_json,
    `Agent call ${identity} preparation metadata`,
  );
  const localBlockIds = typeof preparedMetadata === "object"
    && preparedMetadata !== null
    && !Array.isArray(preparedMetadata)
    && typeof preparedMetadata.localBlockIds === "object"
    && preparedMetadata.localBlockIds !== null
    && !Array.isArray(preparedMetadata.localBlockIds)
    ? preparedMetadata.localBlockIds
    : {};
  const current = readCurrentDocument(database, request.projectId, request.result.documentId);
  const exactResultHead = current.generation === request.result.generation
    && current.head_seq === request.result.headSeq;
  const body = exactResultHead && current.nfm !== null
    ? {
      format: "nfm" as const,
      content: current.nfm,
      contentHash: createHash("sha256").update(current.nfm).digest("hex"),
    }
    : { contentOmitted: true as const };
  const rawOutput = {
    schemaVersion: 1,
    data: {
      documentId: request.result.documentId,
      revision: mintRevision(database, {
        kind: "document",
        projectId: request.projectId,
        subject: [request.result.documentId],
        state: {
          generation: request.result.generation,
          headSeq: request.result.headSeq,
          schemaKey: current.schema_key,
          schemaVersion: current.schema_version,
        },
      }),
      effects: {
        createdBlockIds: request.result.createdBlockIds,
        localBlockIds,
        copiedBlockIds: {},
        updatedBlockIds: request.result.updatedBlockIds,
        movedBlockIds: request.result.movedBlockIds,
        deletedBlockIds: request.result.deletedBlockIds,
      },
      body,
      receipt: { duplicate: request.result.duplicate },
    },
  };
  const output = EditDocumentOutputSchema.parse(
    Buffer.byteLength(JSON.stringify(rawOutput), "utf8") <= NODEX_AGENT_RESPONSE_MAX_BYTES
      ? rawOutput
      : {
        ...rawOutput,
        data: { ...rawOutput.data, body: { contentOmitted: true } },
      },
  );
  const compact = compactReplayOutput(output);
  database.prepare(
    `
    UPDATE nodex_agent_call_receipts
    SET status = 'committed', result_metadata_json = ?, updated_at = ?
    WHERE call_identity = ? AND status = 'prepared'
  `).run(JSON.stringify({ output: compact }), new Date().toISOString(), identity);
  return output;
}

function prepareDocumentEdit(
  database: Database.Database,
  request: PrepareNodexAgentDocumentEditRequest,
): PrepareNodexAgentDocumentEditResult {
  requireProject(database, request.projectId);
  const identity = nodexAgentCallIdentity({ ...request, tool: "edit_document" });
  const requestHash = nodexAgentFingerprint({
    tool: "edit_document",
    projectId: request.projectId,
    input: request.input,
  });
  const existing = readNodexAgentCallReceipt(database, identity);
  if (existing) {
    requireMatchingNodexAgentCallReceipt(
      existing,
      { ...request, tool: "edit_document" },
      requestHash,
    );
    if (existing.status === "committed") {
      return { ok: true, value: { kind: "completed", output: replayOutput(existing) } };
    }
    const committed = readCommittedDocumentOperationResult(
      database,
      existing.mutation_id,
    );
    if (committed) {
      const output = finishDocumentEdit(database, { ...request, result: committed });
      return { ok: true, value: { kind: "completed", output } };
    }
  }

  let token;
  try {
    token = decodeNodexAgentToken(database, request.input.ifRevision, {
      kind: "document",
      projectId: request.projectId,
      subject: [request.input.documentId],
    });
  } catch (error) {
    if (error instanceof NodexAgentTokenError) {
      throw new NodexAgentReadError(
        error.code === "invalid_token" ? "invalid_arguments" : "conflict",
        error.message,
        false,
        "get_block_again",
        { resourceId: request.input.documentId, domainCode: error.code },
      );
    }
    throw error;
  }
  const generation = tokenCoordinate(token.state.generation, "generation");
  const headSeq = tokenCoordinate(token.state.headSeq, "headSeq");
  const current = readCurrentDocument(database, request.projectId, request.input.documentId);
  if (current.generation !== generation || current.head_seq !== headSeq) {
    throw new NodexAgentReadError(
      "conflict",
      `Document ${request.input.documentId} changed after it was read`,
      false,
      "get_block_again",
      { resourceId: request.input.documentId, domainCode: "document_revision_conflict" },
    );
  }
  const allocations = existing
    ? parseStringArray(existing.allocations_json, "Agent allocation receipt")
    : [];
  let allocationIndex = 0;
  const allocateBlockId = (): string => {
    const allocated = allocations[allocationIndex] ?? createUuidV7();
    if (allocationIndex === allocations.length) allocations.push(allocated);
    allocationIndex += 1;
    return allocated;
  };
  let compiled;
  try {
    compiled = compileAgentDocumentEdit({
      documentId: request.input.documentId,
      current: toMaterialization(current),
      edit: request.input,
      allocateBlockId,
    });
  } catch (error) {
    if (error instanceof AgentDocumentEditCompilerError) {
      throw new NodexAgentReadError(
        error.code,
        error.message,
        false,
        error.code === "nfm_patch_mismatch" || error.code === "nfm_patch_overlap"
          ? "get_block_again"
          : "none",
        { resourceId: request.input.documentId, domainCode: error.code },
      );
    }
    throw error;
  }
  const mutationId = existing?.mutation_id ?? `nodex-edit:${identity}`;
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch || storeEpoch !== token.storeEpoch) {
    throw new NodexAgentReadError(
      "conflict",
      "The Nodex store changed after this Document was read",
      false,
      "get_block_again",
    );
  }
  const mutation = mutationRequest({
    request,
    mutationId,
    storeEpoch,
    generation,
    headSeq,
    compiled,
  });
  const now = new Date().toISOString();
  const preparationMetadata = JSON.stringify({
    localBlockIds: compiled.effects.localBlockIds,
  });
  if (existing) {
    database.prepare(
      `
      UPDATE nodex_agent_call_receipts
      SET allocations_json = ?, result_metadata_json = ?, updated_at = ?
      WHERE call_identity = ? AND status = 'prepared'
    `).run(JSON.stringify(allocations), preparationMetadata, now, identity);
  } else {
    database.prepare(
      `
      INSERT INTO nodex_agent_call_receipts (
        call_identity, thread_id, call_id, project_id, tool, request_hash,
        mutation_id, allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'edit_document', ?, ?, ?, ?, 'prepared', ?, ?)
    `).run(
      identity,
      request.threadId,
      request.callId,
      request.projectId,
      requestHash,
      mutationId,
      JSON.stringify(allocations),
      preparationMetadata,
      now,
      now,
    );
  }
  return {
    ok: true,
    value: {
      kind: "prepared",
      mutation,
      effects: compiled.effects,
      targetNfm: compiled.materialization.nfm,
    },
  };
}

export function prepareNodexAgentDocumentEdit(
  database: Database.Database,
  request: PrepareNodexAgentDocumentEditRequest,
): PrepareNodexAgentDocumentEditResult {
  try {
    return database.transaction(() => prepareDocumentEdit(database, request)).immediate();
  } catch (error) {
    return readFailure(error);
  }
}

export function completeNodexAgentDocumentEdit(
  database: Database.Database,
  request: CompleteNodexAgentDocumentEditRequest,
): CompleteNodexAgentDocumentEditResult {
  try {
    return database.transaction(() => ({
      ok: true as const,
      output: finishDocumentEdit(database, request),
    })).immediate();
  } catch (error) {
    return readFailure(error);
  }
}
