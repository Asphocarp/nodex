import type Database from "better-sqlite3";
import type {
  BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import type { PortableRichText } from "../../shared/block-documents/portable-rich-text";
import {
  assessBlockSemanticContentForCard,
  BlockSemanticContentError,
} from "../../shared/block-documents/block-semantic-content";
import { prepareBlockTransfer } from "../local-store/block-transfers";
import { applyBlockTransfer } from "../local-store/block-transfers";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { mintNodexAgentEtag } from "../local-store/nodex-agent-etag";
import { applyDatabaseMutation } from "../local-store/database-kernel";
import {
  DATABASE_MUTATION_CONTRACT_VERSION,
  databaseGroupValueFromKey,
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  parseGeneralDatabaseViewConfig,
  type DatabaseJsonValue,
  type DatabaseMutationRequest,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import {
  DuplicateCardV3OutputSchema,
  MoveCardsV3OutputSchema,
  BlockLocationSchema,
  TransferBlocksInputSchema,
  TransferBlocksOutputSchema,
  type CreateInput,
  type ExecuteNodexAgentTransferResult,
  type ExecuteNodexAgentDuplicateCardResult,
  type ExecuteNodexAgentMoveCardsResult,
  type NodexAgentDuplicateCardCommand,
  type NodexAgentMoveCardsCommand,
  type NodexAgentTransferCommand,
  type NodexAgentTransferAuthorizationEvidence,
  type PrepareNodexAgentTransferRequest,
  type PrepareNodexAgentTransferResult,
  type PrepareNodexAgentDuplicateCardRequest,
  type PrepareNodexAgentDuplicateCardResult,
  type PrepareNodexAgentMoveCardsRequest,
  type PrepareNodexAgentMoveCardsResult,
  type PreparedNodexAgentCreateDestination,
  type TransferBlocksInput,
  type TransferBlocksOutput,
} from "../../shared/nodex-agent-tools";
import type {
  BlockTransferIntentSource,
  BlockTransferIntentTarget,
  BlockTransferReceipt,
  BlockTransferRequest,
} from "../../shared/block-transfer";
import { BLOCK_TRANSFER_CONTRACT_VERSION } from "../../shared/block-transfer";
import {
  nodexAgentCallIdentity,
  readNodexAgentCallReceipt,
  requireMatchingNodexAgentCallReceipt,
  type NodexAgentCallReceiptRow,
} from "./call-receipts";
import { prepareNodexAgentDestination } from "./create-service";
import {
  NodexAgentReadError,
  nodexAgentFingerprint,
  parseJsonValue,
  readFailure,
  requireProject,
} from "./read-support";
import { requireCardDocumentId, toCardLocation } from "./card-adapter";
import { documentBodyEtagState, titleEtagState } from "./semantic-guards";
import { publicV3Failure } from "./v3-errors";

interface BlockLocationRow {
  readonly id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
  readonly location_revision: number;
  readonly parent_block_id: string | null;
}

function flattenBlocks(blocks: readonly BlockTreeNode[]): readonly BlockTreeNode[] {
  return blocks.flatMap((block) => [block, ...flattenBlocks(block.children)]);
}

function readBlock(
  database: Database.Database,
  projectId: string,
  blockId: string,
): BlockLocationRow {
  const row = database.prepare(
    `
    SELECT block.id, block.type, block.lifecycle, block.location_kind,
      block.containing_document_id, block.containing_database_id,
      block.location_revision, block_index.parent_block_id
    FROM blocks block
    LEFT JOIN document_block_index block_index
      ON block_index.block_id = block.id
     AND block_index.document_id = block.containing_document_id
    WHERE block.id = ? AND block.project_id = ?
  `).get(blockId, projectId) as BlockLocationRow | undefined;
  if (!row || row.lifecycle !== "active") {
    throw new NodexAgentReadError(
      "not_found",
      `Active Block ${blockId} was not found in the bound Project`,
      false,
      "none",
      { resourceId: blockId, domainCode: "block_not_active" },
    );
  }
  return row;
}

function sourceKey(block: BlockLocationRow): string {
  if (block.location_kind === "space") return "space";
  if (block.location_kind === "document" && block.containing_document_id) {
    return `document:${block.containing_document_id}`;
  }
  if (block.location_kind === "database" && block.containing_database_id) {
    return `database:${block.containing_database_id}`;
  }
  throw new NodexAgentReadError(
    "internal_error",
    `Block ${block.id} has inconsistent location authority`,
    false,
    "none",
  );
}

function sourceIntent(block: BlockLocationRow): BlockTransferIntentSource {
  if (block.location_kind === "space") return { kind: "space" };
  if (block.location_kind === "document" && block.containing_document_id) {
    return { kind: "document", documentId: block.containing_document_id };
  }
  if (block.location_kind === "database" && block.containing_database_id) {
    return { kind: "database", databaseBlockId: block.containing_database_id };
  }
  throw new Error(`Block ${block.id} location is inconsistent`);
}

function sourceMatches(
  block: BlockLocationRow,
  expected: Extract<TransferBlocksInput, { readonly mode: "move" }>["from"],
): boolean {
  if (expected.kind !== block.location_kind) return false;
  if (expected.kind === "space") return true;
  if (expected.kind === "database") {
    return block.containing_database_id === expected.databaseBlockId;
  }
  return block.containing_document_id === expected.documentId
    && (expected.parentBlockId === undefined
      || block.parent_block_id === expected.parentBlockId);
}

function findDocumentBlock(
  blocks: readonly BlockTreeNode[],
  blockId: string,
): BlockTreeNode | null {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const nested = findDocumentBlock(block.children, blockId);
    if (nested) return nested;
  }
  return null;
}

function transferAuthorizationEvidence(
  database: Database.Database,
  input: {
    readonly blocks: readonly BlockLocationRow[];
    readonly transfer: BlockTransferRequest;
    readonly documentIds: readonly string[];
  },
): NodexAgentTransferAuthorizationEvidence {
  const coercesDocumentRoots = input.transfer.source.kind === "document"
    && input.transfer.target.kind !== "document";
  const sourceTree = coercesDocumentRoots && input.transfer.source.kind === "document"
    ? (() => {
        const row = database.prepare(
          `
          SELECT materialization.block_tree_json
          FROM document_materializations materialization
          WHERE materialization.document_id = ?
            AND materialization.generation = ?
            AND materialization.projected_seq = ?
        `,
        ).get(
          input.transfer.source.documentId,
          input.transfer.source.generation,
          input.transfer.source.expectedHeadSeq,
        ) as { readonly block_tree_json: string } | undefined;
        if (!row) {
          throw new NodexAgentReadError(
            "projection_not_ready",
            `Document ${input.transfer.source.documentId} has no exact transfer projection`,
            true,
            "get_block_again",
            {
              resourceId: input.transfer.source.documentId,
              domainCode: "transfer_source_projection_not_ready",
            },
          );
        }
        const parsed = parseJsonValue(
          row.block_tree_json,
          `Document ${input.transfer.source.documentId} transfer Block tree`,
        );
        if (Array.isArray(parsed)) return parsed as unknown as readonly BlockTreeNode[];
        throw new NodexAgentReadError(
          "internal_error",
          `Document ${input.transfer.source.documentId} transfer Block tree is invalid`,
          false,
          "none",
        );
      })()
    : [];

  return {
    roots: Object.fromEntries(input.blocks.map((block) => {
      if (!coercesDocumentRoots || block.type === "card") {
        return [block.id, { type: block.type, transformation: "preserved" as const }];
      }
      const source = findDocumentBlock(sourceTree, block.id);
      if (!source) {
        throw new NodexAgentReadError(
          "projection_not_ready",
          `Block ${block.id} is missing from its transfer source projection`,
          true,
          "get_block_again",
          { resourceId: block.id, domainCode: "transfer_source_block_missing" },
        );
      }
      try {
        const assessment = assessBlockSemanticContentForCard(source);
        if (assessment.kind === "wrap") {
          return [block.id, {
            type: source.type,
            transformation: "wrap" as const,
            wrapperReason: assessment.reason,
          }];
        }
        return [block.id, {
          type: source.type,
          transformation: assessment.kind === "promote" ? "promote" as const : "preserved" as const,
        }];
      } catch (error) {
        if (!(error instanceof BlockSemanticContentError)) throw error;
        throw new NodexAgentReadError(
          "unsupported_resource",
          error.message,
          false,
          "get_block_again",
          { resourceId: block.id, domainCode: error.code },
        );
      }
    })),
    documentIds: [...new Set(input.documentIds)].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function fallbackDatabaseView(
  database: Database.Database,
  projectId: string,
  databaseBlockId: string,
): { readonly viewId: string; readonly groupKey: null } {
  const row = database.prepare(
    `
    SELECT id
    FROM database_views
    WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
    ORDER BY is_primary DESC, rank_key, id
    LIMIT 1
  `).get(databaseBlockId, projectId) as { readonly id: string } | undefined;
  if (!row) {
    throw new NodexAgentReadError(
      "unsupported_resource",
      `Database ${databaseBlockId} has no active View for transfer staging`,
      false,
      "query_database_again",
      { resourceId: databaseBlockId, domainCode: "database_view_required" },
    );
  }
  return { viewId: row.id, groupKey: null };
}

function transferTarget(
  database: Database.Database,
  projectId: string,
  destination: PreparedNodexAgentCreateDestination,
): BlockTransferIntentTarget {
  if (destination.kind === "space") {
    return {
      kind: "space",
      ...(destination.beforeBlockId ? { beforeBlockId: destination.beforeBlockId } : {}),
    };
  }
  if (destination.kind === "document") {
    return {
      kind: "document",
      documentId: destination.documentId,
      ...(destination.parentBlockId ? { parentBlockId: destination.parentBlockId } : {}),
      ...(destination.beforeBlockId ? { beforeBlockId: destination.beforeBlockId } : {}),
    };
  }
  const view = destination.view ?? fallbackDatabaseView(
    database,
    projectId,
    destination.databaseBlockId,
  );
  return {
    kind: "database",
    databaseBlockId: destination.databaseBlockId,
    viewId: view.viewId,
    groupKey: view.groupKey,
    ...(destination.view?.beforeCardBlockId
      ? { beforeCardBlockId: destination.view.beforeCardBlockId }
      : {}),
  };
}

function replayOutput(receipt: NodexAgentCallReceiptRow): TransferBlocksOutput {
  const metadata = parseJsonValue(
    receipt.result_metadata_json,
    `Agent call ${receipt.call_identity} result metadata`,
  );
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new NodexAgentReadError(
      "internal_error",
      "Agent transfer result metadata is invalid",
      false,
      "none",
    );
  }
  return TransferBlocksOutputSchema.parse(metadata.output);
}

function prepareTransfer(
  database: Database.Database,
  request: PrepareNodexAgentTransferRequest,
): PrepareNodexAgentTransferResult {
  requireProject(database, request.projectId);
  const key = { ...request, tool: "transfer_blocks" };
  const identity = nodexAgentCallIdentity(key);
  const requestHash = nodexAgentFingerprint({
    tool: "transfer_blocks",
    projectId: request.projectId,
    input: request.input,
  });
  const existing = readNodexAgentCallReceipt(database, identity);
  if (existing) {
    requireMatchingNodexAgentCallReceipt(existing, key, requestHash);
    if (existing.status === "committed") {
      return { ok: true, value: { kind: "completed", output: replayOutput(existing) } };
    }
  }
  if (new Set(request.input.blockIds).size !== request.input.blockIds.length) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "A transfer root may appear only once",
      false,
      "none",
    );
  }
  const blocks = request.input.blockIds.map((blockId) =>
    readBlock(database, request.projectId, blockId));
  const sources = new Set(blocks.map(sourceKey));
  if (sources.size !== 1) {
    throw new NodexAgentReadError(
      "mixed_transfer_sources",
      "Every transferred root must share one source container",
      false,
      "get_block_again",
    );
  }
  if (request.input.mode === "move") {
    const expectedSource = request.input.from;
    if (blocks.some((block) => !sourceMatches(block, expectedSource))) {
      throw new NodexAgentReadError(
        "conflict",
        "One or more Blocks no longer belong to the declared source",
        false,
        "get_block_again",
        { domainCode: "transfer_source_mismatch" },
      );
    }
  }
  const destination = prepareNodexAgentDestination(
    database,
    request.projectId,
    request.input.destination as CreateInput["destination"],
  );
  const source = sourceIntent(blocks[0] as BlockLocationRow);
  if (
    request.input.mode === "move"
    && source.kind === "document"
    && destination.kind === "document"
    && source.documentId === destination.documentId
  ) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "Move within one Document belongs to edit_document; copy may use transfer_blocks",
      false,
      "none",
    );
  }
  if (
    request.input.mode === "move"
    && source.kind === "database"
    && destination.kind === "database"
    && source.databaseBlockId === destination.databaseBlockId
  ) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "Move within one Database belongs to edit_database; copy may use transfer_blocks",
      false,
      "none",
    );
  }
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Nodex store has no epoch");
  const mutationId = existing?.mutation_id ?? `nodex-transfer:${identity}`;
  const preparation = prepareBlockTransfer(database, {
    version: BLOCK_TRANSFER_CONTRACT_VERSION,
    operationId: mutationId,
    projectId: request.projectId,
    storeEpoch,
    clientSessionId: `nodex-agent:${request.threadId}`,
    actor: { kind: "nodex_agent", threadId: request.threadId, callId: request.callId },
    mode: request.input.mode,
    rootBlockIds: request.input.blockIds,
    source,
    target: transferTarget(database, request.projectId, destination),
  });
  if (!preparation.ok) {
    throw new NodexAgentReadError(
      preparation.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
      preparation.error.message,
      preparation.error.retryable,
      preparation.error.reloadRequired ? "get_block_again" : "none",
      { domainCode: preparation.error.code },
    );
  }
  const now = new Date().toISOString();
  if (!existing) {
    database.prepare(
      `
      INSERT INTO nodex_agent_call_receipts (
        call_identity, thread_id, call_id, project_id, tool, request_hash,
        mutation_id, allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'transfer_blocks', ?, ?, '[]', '{}', 'prepared', ?, ?)
    `).run(
      identity,
      request.threadId,
      request.callId,
      request.projectId,
      requestHash,
      mutationId,
      now,
      now,
    );
  }
  return {
    ok: true,
    value: {
      kind: "prepared",
      command: {
        threadId: request.threadId,
        callId: request.callId,
        projectId: request.projectId,
        requestHash,
        mutationId,
        storeEpoch,
        input: request.input,
        transfer: preparation.value.request,
        destination,
        leaseDocuments: preparation.value.leaseDocuments,
      },
      leaseDocuments: preparation.value.leaseDocuments,
      authorization: transferAuthorizationEvidence(database, {
        blocks,
        transfer: preparation.value.request,
        documentIds: preparation.value.leaseDocuments.map((lease) => lease.documentId),
      }),
    },
  };
}

function activeMembership(
  database: Database.Database,
  cardId: string,
  databaseBlockId: string,
) {
  const row = database.prepare(
    `
    SELECT id, revision
    FROM database_memberships
    WHERE card_block_id = ? AND database_block_id = ? AND removed_at IS NULL
  `).get(cardId, databaseBlockId) as
    | { readonly id: string; readonly revision: number }
    | undefined;
  if (!row) throw new Error(`Transferred Card ${cardId} has no target membership`);
  return row;
}

function currentValueRevision(
  database: Database.Database,
  membershipId: string,
  propertyId: string,
): number {
  const row = database.prepare(
    "SELECT revision FROM database_property_values WHERE membership_id = ? AND property_id = ?",
  ).get(membershipId, propertyId) as { readonly revision: number } | undefined;
  return row?.revision ?? 0;
}

function applyDestinationValues(
  database: Database.Database,
  command: NodexAgentTransferCommand,
  receipt: BlockTransferReceipt,
) {
  if (command.destination.kind !== "database") return [];
  const inputDestination = command.input.destination;
  if (inputDestination.kind !== "database") return [];
  const results = receipt.resultRootBlockIds;
  const databaseReceipts = [];
  for (const cardId of results) {
    let membership = activeMembership(
      database,
      cardId,
      command.destination.databaseBlockId,
    );
    if (!command.destination.view) {
      const detach = applyDatabaseMutation(database, {
        version: DATABASE_MUTATION_CONTRACT_VERSION,
        operationId: `${command.mutationId}:detach:${cardId}`,
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
        operations: [{
          kind: "transfer_membership",
          cardBlockId: cardId,
          expectedMembership: {
            membershipId: membership.id,
            revision: membership.revision,
          },
          target: null,
        }],
      });
      if (!detach.ok) throw new Error(detach.error.message);
      databaseReceipts.push(detach.value);
      const readd = applyDatabaseMutation(database, {
        version: DATABASE_MUTATION_CONTRACT_VERSION,
        operationId: `${command.mutationId}:membership:${cardId}`,
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
        operations: [{
          kind: "transfer_membership",
          cardBlockId: cardId,
          expectedMembership: null,
          target: {
            databaseBlockId: command.destination.databaseBlockId,
            membershipId: `membership:${command.mutationId}:${cardId}`,
          },
        }],
      });
      if (!readd.ok) throw new Error(readd.error.message);
      databaseReceipts.push(readd.value);
      membership = activeMembership(
        database,
        cardId,
        command.destination.databaseBlockId,
      );
    }
    if (!inputDestination.values?.length) continue;
    const values = applyDatabaseMutation(database, {
      version: DATABASE_MUTATION_CONTRACT_VERSION,
      operationId: `${command.mutationId}:values:${cardId}`,
      projectId: command.projectId,
      storeEpoch: command.storeEpoch,
      actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
      operations: [{
        kind: "set_values",
        databaseBlockId: command.destination.databaseBlockId,
        entries: inputDestination.values.map((draft) => ({
          cardBlockId: cardId,
          propertyId: draft.propertyId,
          expectedValueRevision: currentValueRevision(
            database,
            membership.id,
            draft.propertyId,
          ),
          value: draft.value as DatabaseJsonValue,
        })),
      }],
    });
    if (!values.ok) throw new Error(values.error.message);
    databaseReceipts.push(values.value);
  }
  return databaseReceipts;
}

function resultLocation(
  database: Database.Database,
  projectId: string,
  blockId: string,
) {
  const row = readBlock(database, projectId, blockId);
  const location = row.location_kind === "space"
    ? { kind: "space" as const }
    : row.location_kind === "document" && row.containing_document_id
      ? { kind: "document" as const, documentId: row.containing_document_id }
      : row.location_kind === "database" && row.containing_database_id
        ? { kind: "database" as const, databaseBlockId: row.containing_database_id }
        : null;
  if (!location) throw new Error(`Result Block ${blockId} has invalid location`);
  return BlockLocationSchema.parse(location);
}

function transferOutput(
  database: Database.Database,
  command: NodexAgentTransferCommand,
  receipt: BlockTransferReceipt,
): TransferBlocksOutput {
  const evidenceBySource = new Map(
    receipt.transformationEvidence.map((evidence) => [evidence.sourceBlockId, evidence]),
  );
  const results = command.input.blockIds.map((blockId) => {
    const evidence = evidenceBySource.get(blockId);
    const resultBlockId = evidence?.resultCardId
      ?? receipt.copiedBlockIds[blockId]
      ?? blockId;
    return {
      sourceBlockId: blockId,
      resultBlockId,
      location: resultLocation(database, command.projectId, resultBlockId),
      transformation: evidence?.kind === "wrap"
        ? "wrapped" as const
        : evidence?.kind === "promote"
          ? "promoted" as const
          : "preserved" as const,
    };
  });
  return TransferBlocksOutputSchema.parse({
    data: {
      mode: command.input.mode,
      results,
      ...(command.input.return?.blockMap === true
        ? { copiedBlockIds: receipt.copiedBlockIds }
        : {}),
    },
  });
}

function executeTransfer(
  database: Database.Database,
  command: NodexAgentTransferCommand,
): ExecuteNodexAgentTransferResult {
  const identity = nodexAgentCallIdentity({ ...command, tool: "transfer_blocks" });
  const callReceipt = readNodexAgentCallReceipt(database, identity);
  if (!callReceipt) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "No matching prepared Agent transfer call exists",
      false,
      "none",
    );
  }
  requireMatchingNodexAgentCallReceipt(
    callReceipt,
    { ...command, tool: "transfer_blocks" },
    command.requestHash,
  );
  if (callReceipt.status === "committed") {
    return {
      ok: true,
      value: {
        output: replayOutput(callReceipt),
        duplicate: true,
        documentCommits: [],
        affectedDatabaseBlockIds: [],
        changeLogSeq: 0,
      },
    };
  }
  if (readBlockStoreEpoch(database) !== command.storeEpoch) {
    throw new NodexAgentReadError(
      "conflict",
      "The Nodex store changed after Block transfer was prepared",
      false,
      "get_block_again",
    );
  }
  const transferred = applyBlockTransfer(database, command.transfer);
  if (!transferred.ok) {
    throw new NodexAgentReadError(
      transferred.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
      transferred.error.message,
      transferred.error.retryable,
      transferred.error.reloadRequired ? "get_block_again" : "none",
      { domainCode: transferred.error.code },
    );
  }
  const databaseReceipts = applyDestinationValues(database, command, transferred.value);
  const output = transferOutput(database, command, transferred.value);
  database.prepare(
    `
    UPDATE nodex_agent_call_receipts
    SET status = 'committed', result_metadata_json = ?, updated_at = ?
    WHERE call_identity = ? AND status = 'prepared'
  `).run(JSON.stringify({ output }), new Date().toISOString(), identity);
  return {
    ok: true,
    value: {
      output,
      duplicate: false,
      documentCommits: transferred.value.documentCommits,
      affectedDatabaseBlockIds: [...new Set([
        ...transferred.value.affectedDatabaseBlockIds,
        ...databaseReceipts.flatMap((receipt) => receipt.affectedDatabaseBlockIds),
      ])].sort((left, right) => left.localeCompare(right)),
      changeLogSeq: Math.max(
        transferred.value.changeLogSeq,
        ...databaseReceipts.map((receipt) => receipt.changeLogSeq),
      ),
    },
  };
}

function replayDuplicateOutput(receipt: NodexAgentCallReceiptRow) {
  const metadata = parseJsonValue(
    receipt.result_metadata_json,
    `Agent call ${receipt.call_identity} result metadata`,
  );
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new NodexAgentReadError(
      "internal_error",
      "Agent duplicate result metadata is invalid",
      false,
      "none",
    );
  }
  return DuplicateCardV3OutputSchema.parse(metadata.output);
}

function normalizedDuplicateInput(
  database: Database.Database,
  request: PrepareNodexAgentDuplicateCardRequest,
): TransferBlocksInput {
  const destination = request.input.destination.kind === "space"
    ? request.input.destination
    : request.input.destination.kind === "card"
      ? {
          kind: "document" as const,
          documentId: requireCardDocumentId(
            database,
            request.projectId,
            request.input.destination.cardId,
          ),
          at: request.input.destination.at ?? { kind: "end" as const },
        }
      : request.input.destination;
  return TransferBlocksInputSchema.parse({
    mode: "copy",
    blockIds: [request.input.cardId],
    destination,
    ...(request.input.return?.includes("block_map")
      ? { return: { blockMap: true } }
      : {}),
  });
}

function prepareDuplicateCard(
  database: Database.Database,
  request: PrepareNodexAgentDuplicateCardRequest,
): PrepareNodexAgentDuplicateCardResult {
  requireProject(database, request.projectId);
  const key = { ...request, tool: "duplicate_card" };
  const identity = nodexAgentCallIdentity(key);
  const requestHash = nodexAgentFingerprint({
    tool: "duplicate_card",
    projectId: request.projectId,
    input: request.input,
  });
  const existing = readNodexAgentCallReceipt(database, identity);
  if (existing) {
    requireMatchingNodexAgentCallReceipt(existing, key, requestHash);
    if (existing.status === "committed") {
      return {
        ok: true,
        value: { kind: "completed", output: replayDuplicateOutput(existing) },
      };
    }
  }

  const sourceBlock = readBlock(database, request.projectId, request.input.cardId);
  if (sourceBlock.type !== "card") {
    throw new NodexAgentReadError(
      "unsupported_resource",
      `Block ${request.input.cardId} is not a Card`,
      false,
      "none",
      { resourceId: request.input.cardId, domainCode: "card_root_required" },
    );
  }
  requireCardDocumentId(database, request.projectId, request.input.cardId);
  const normalizedInput = normalizedDuplicateInput(database, request);
  const destination = prepareNodexAgentDestination(
    database,
    request.projectId,
    normalizedInput.destination as CreateInput["destination"],
  );
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Nodex store has no epoch");
  const mutationId = existing?.mutation_id ?? `nodex-duplicate-card:${identity}`;
  const preparation = prepareBlockTransfer(database, {
    version: BLOCK_TRANSFER_CONTRACT_VERSION,
    operationId: mutationId,
    projectId: request.projectId,
    storeEpoch,
    clientSessionId: `nodex-agent:${request.threadId}`,
    actor: { kind: "nodex_agent", threadId: request.threadId, callId: request.callId },
    mode: "copy",
    rootBlockIds: [request.input.cardId],
    source: sourceIntent(sourceBlock),
    target: transferTarget(database, request.projectId, destination),
  });
  if (!preparation.ok) {
    throw new NodexAgentReadError(
      preparation.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
      preparation.error.message,
      preparation.error.retryable,
      preparation.error.reloadRequired ? "get_block_again" : "none",
      { domainCode: preparation.error.code },
    );
  }
  const authorization = transferAuthorizationEvidence(database, {
    blocks: [sourceBlock],
    transfer: preparation.value.request,
    documentIds: preparation.value.leaseDocuments.map((lease) => lease.documentId),
  });
  if (authorization.roots[request.input.cardId]?.transformation !== "preserved") {
    throw new NodexAgentReadError(
      "unsupported_resource",
      "duplicate_card accepts only a complete Card root",
      false,
      "none",
      { resourceId: request.input.cardId, domainCode: "card_root_required" },
    );
  }
  const now = new Date().toISOString();
  if (!existing) {
    database.prepare(
      `
      INSERT INTO nodex_agent_call_receipts (
        call_identity, thread_id, call_id, project_id, tool, request_hash,
        mutation_id, allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'duplicate_card', ?, ?, '[]', '{}', 'prepared', ?, ?)
    `).run(
      identity,
      request.threadId,
      request.callId,
      request.projectId,
      requestHash,
      mutationId,
      now,
      now,
    );
  }
  return {
    ok: true,
    value: {
      kind: "prepared",
      command: {
        threadId: request.threadId,
        callId: request.callId,
        projectId: request.projectId,
        requestHash,
        mutationId,
        storeEpoch,
        input: request.input,
        normalizedInput,
        transfer: preparation.value.request,
        destination,
        leaseDocuments: preparation.value.leaseDocuments,
      },
      authorization,
    },
  };
}

function duplicateCardOutput(
  database: Database.Database,
  command: NodexAgentDuplicateCardCommand,
  receipt: BlockTransferReceipt,
) {
  const cardId = receipt.copiedBlockIds[command.input.cardId]
    ?? receipt.resultRootBlockIds[0];
  if (!cardId || cardId === command.input.cardId) {
    throw new NodexAgentReadError(
      "internal_error",
      "Card duplication did not produce a fresh Card identity",
      false,
      "none",
    );
  }
  const documentId = requireCardDocumentId(database, command.projectId, cardId);
  const materialization = database.prepare(
    `
    SELECT title_rich_json, nfm, block_tree_json
    FROM document_materializations
    WHERE document_id = ?
  `).get(documentId) as {
    readonly title_rich_json: string;
    readonly nfm: string;
    readonly block_tree_json: string;
  } | undefined;
  if (!materialization) {
    throw new NodexAgentReadError(
      "internal_error",
      "Duplicated Card materialization is unavailable",
      true,
      "retry_same",
    );
  }
  const blocks = parseJsonValue(
    materialization.block_tree_json,
    `Document ${documentId} Block tree`,
  );
  if (!Array.isArray(blocks)) throw new Error("Duplicated Card Block tree is invalid");
  const richTitle = parseJsonValue(
    materialization.title_rich_json,
    `Document ${documentId} rich title`,
  ) as unknown as PortableRichText;
  return DuplicateCardV3OutputSchema.parse({
    data: {
      sourceCardId: command.input.cardId,
      cardId,
      location: toCardLocation(
        database,
        command.projectId,
        resultLocation(database, command.projectId, cardId),
      ),
      bodyBlocksCreated: flattenBlocks(blocks as unknown as readonly BlockTreeNode[]).length,
      ...(command.input.return?.includes("block_map")
        ? { blockMap: receipt.copiedBlockIds }
        : {}),
      ...(command.input.return?.includes("etags")
        ? {
            etags: {
              title: mintNodexAgentEtag(database, titleEtagState({
                projectId: command.projectId,
                documentId,
                richTitle,
              })),
              body: mintNodexAgentEtag(database, documentBodyEtagState({
                projectId: command.projectId,
                documentId,
                nfm: materialization.nfm,
              })),
            },
          }
        : {}),
    },
  });
}

function executeDuplicateCard(
  database: Database.Database,
  command: NodexAgentDuplicateCardCommand,
): ExecuteNodexAgentDuplicateCardResult {
  const key = { ...command, tool: "duplicate_card" };
  const identity = nodexAgentCallIdentity(key);
  const callReceipt = readNodexAgentCallReceipt(database, identity);
  if (!callReceipt) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "No matching prepared Agent duplicate call exists",
      false,
      "none",
    );
  }
  requireMatchingNodexAgentCallReceipt(callReceipt, key, command.requestHash);
  if (callReceipt.status === "committed") {
    return {
      ok: true,
      value: {
        output: replayDuplicateOutput(callReceipt),
        duplicate: true,
        documentCommits: [],
        affectedDatabaseBlockIds: [],
        changeLogSeq: 0,
      },
    };
  }
  if (readBlockStoreEpoch(database) !== command.storeEpoch) {
    throw new NodexAgentReadError(
      "conflict",
      "The Nodex store changed after Card duplication was prepared",
      false,
      "get_block_again",
    );
  }
  const transferred = applyBlockTransfer(database, command.transfer);
  if (!transferred.ok) {
    throw new NodexAgentReadError(
      transferred.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
      transferred.error.message,
      transferred.error.retryable,
      transferred.error.reloadRequired ? "get_block_again" : "none",
      { domainCode: transferred.error.code },
    );
  }
  const normalizedCommand: NodexAgentTransferCommand = {
    ...command,
    input: command.normalizedInput,
  };
  const databaseReceipts = applyDestinationValues(
    database,
    normalizedCommand,
    transferred.value,
  );
  const output = duplicateCardOutput(database, command, transferred.value);
  database.prepare(
    `
    UPDATE nodex_agent_call_receipts
    SET status = 'committed', result_metadata_json = ?, updated_at = ?
    WHERE call_identity = ? AND status = 'prepared'
  `).run(JSON.stringify({ output }), new Date().toISOString(), identity);
  return {
    ok: true,
    value: {
      output,
      duplicate: false,
      documentCommits: transferred.value.documentCommits,
      affectedDatabaseBlockIds: [...new Set([
        ...transferred.value.affectedDatabaseBlockIds,
        ...databaseReceipts.flatMap((receipt) => receipt.affectedDatabaseBlockIds),
      ])].sort((left, right) => left.localeCompare(right)),
      changeLogSeq: Math.max(
        transferred.value.changeLogSeq,
        ...databaseReceipts.map((receipt) => receipt.changeLogSeq),
      ),
    },
  };
}

export function prepareNodexAgentDuplicateCard(
  database: Database.Database,
  request: PrepareNodexAgentDuplicateCardRequest,
): PrepareNodexAgentDuplicateCardResult {
  try {
    return database.transaction(() => prepareDuplicateCard(database, request)).immediate();
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
}

export function executeNodexAgentDuplicateCard(
  database: Database.Database,
  command: NodexAgentDuplicateCardCommand,
): ExecuteNodexAgentDuplicateCardResult {
  try {
    return database.transaction(() => executeDuplicateCard(database, command)).immediate();
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
}

function replayMoveCardsOutput(receipt: NodexAgentCallReceiptRow) {
  const metadata = parseJsonValue(
    receipt.result_metadata_json,
    `Agent call ${receipt.call_identity} result metadata`,
  );
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new NodexAgentReadError(
      "internal_error",
      "Agent Card move result metadata is invalid",
      false,
      "none",
    );
  }
  return MoveCardsV3OutputSchema.parse(metadata.output);
}

function normalizedMoveInput(
  database: Database.Database,
  request: PrepareNodexAgentMoveCardsRequest,
  cardId: string,
  source: BlockLocationRow,
): TransferBlocksInput {
  const destination = request.input.destination.kind === "space"
    ? request.input.destination
    : request.input.destination.kind === "card"
      ? {
          kind: "document" as const,
          documentId: requireCardDocumentId(
            database,
            request.projectId,
            request.input.destination.cardId,
          ),
          at: request.input.destination.at ?? { kind: "end" as const },
        }
      : request.input.destination;
  return TransferBlocksInputSchema.parse({
    mode: "move",
    blockIds: [cardId],
    from: resultLocation(database, request.projectId, source.id),
    destination,
  });
}

function uniqueLeaseDocuments(
  leases: readonly { readonly documentId: string; readonly generation: number; readonly expectedHeadSeq: number }[],
) {
  const byDocument = new Map<string, (typeof leases)[number]>();
  for (const lease of leases) {
    const existing = byDocument.get(lease.documentId);
    if (existing && (
      existing.generation !== lease.generation
      || existing.expectedHeadSeq !== lease.expectedHeadSeq
    )) {
      throw new NodexAgentReadError(
        "conflict",
        `Document ${lease.documentId} changed while preparing Card moves`,
        false,
        "get_block_again",
      );
    }
    byDocument.set(lease.documentId, lease);
  }
  return [...byDocument.values()].sort((left, right) =>
    left.documentId.localeCompare(right.documentId)
  );
}

function assertExternalMoveAnchors(request: PrepareNodexAgentMoveCardsRequest): void {
  const selected = new Set<string>(request.input.cardIds);
  if (request.input.destination.kind === "card"
    && selected.has(request.input.destination.cardId)) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "A moved Card cannot be its own destination Card",
      false,
      "none",
    );
  }
  const anchor = request.input.destination.kind === "database"
    ? request.input.destination.view?.at
    : request.input.destination.at;
  if (anchor && (anchor.kind === "before" || anchor.kind === "after")
    && selected.has(anchor.blockId)) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "A Card move anchor must be outside the moved Card set",
      false,
      "none",
      { resourceId: anchor.blockId, domainCode: "move_anchor_selected" },
    );
  }
}

function prepareMoveCards(
  database: Database.Database,
  request: PrepareNodexAgentMoveCardsRequest,
): PrepareNodexAgentMoveCardsResult {
  requireProject(database, request.projectId);
  const key = { ...request, tool: "move_cards" };
  const identity = nodexAgentCallIdentity(key);
  const requestHash = nodexAgentFingerprint({
    tool: "move_cards",
    projectId: request.projectId,
    input: request.input,
  });
  const existing = readNodexAgentCallReceipt(database, identity);
  if (existing) {
    requireMatchingNodexAgentCallReceipt(existing, key, requestHash);
    if (existing.status === "committed") {
      return {
        ok: true,
        value: { kind: "completed", output: replayMoveCardsOutput(existing) },
      };
    }
  }
  assertExternalMoveAnchors(request);
  const blocks = request.input.cardIds.map((cardId) => {
    const block = readBlock(database, request.projectId, cardId);
    if (block.type === "card") return block;
    throw new NodexAgentReadError(
      "unsupported_resource",
      `Block ${cardId} is not a Card`,
      false,
      "none",
      { resourceId: cardId, domainCode: "card_root_required" },
    );
  });
  blocks.forEach((block) => requireCardDocumentId(database, request.projectId, block.id));
  const inputDestination = request.input.destination;
  const hasSameDatabaseCard = inputDestination.kind === "database"
    && blocks.some((block) =>
      block.location_kind === "database"
      && block.containing_database_id === inputDestination.databaseBlockId
    );
  if (hasSameDatabaseCard && inputDestination.kind === "database") {
    if (!inputDestination.view) {
      throw new NodexAgentReadError(
        "invalid_arguments",
        "Moving within one Database requires a destination View placement",
        false,
        "none",
      );
    }
    if (inputDestination.values?.length) {
      throw new NodexAgentReadError(
        "invalid_arguments",
        "Moving within one Database cannot change independent property values",
        false,
        "none",
      );
    }
  }
  const normalizedInputs = blocks.map((block) =>
    normalizedMoveInput(database, request, block.id, block)
  );
  const destination = prepareNodexAgentDestination(
    database,
    request.projectId,
    normalizedInputs[0]?.destination as CreateInput["destination"],
  );
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Nodex store has no epoch");
  const mutationId = existing?.mutation_id ?? `nodex-move-cards:${identity}`;
  const transfers = [];
  const leases = [];
  for (const [index, block] of blocks.entries()) {
    const normalizedInput = normalizedInputs[index] as TransferBlocksInput;
    const sameDatabase = block.location_kind === "database"
      && destination.kind === "database"
      && block.containing_database_id === destination.databaseBlockId;
    if (sameDatabase) continue;
    const preparation = prepareBlockTransfer(database, {
      version: BLOCK_TRANSFER_CONTRACT_VERSION,
      operationId: `${mutationId}:card:${index}`,
      projectId: request.projectId,
      storeEpoch,
      clientSessionId: `nodex-agent:${request.threadId}`,
      actor: { kind: "nodex_agent", threadId: request.threadId, callId: request.callId },
      mode: "move",
      rootBlockIds: [block.id],
      source: sourceIntent(block),
      target: transferTarget(database, request.projectId, destination),
    });
    if (!preparation.ok) {
      throw new NodexAgentReadError(
        preparation.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
        preparation.error.message,
        preparation.error.retryable,
        preparation.error.reloadRequired ? "get_block_again" : "none",
        { domainCode: preparation.error.code },
      );
    }
    transfers.push({ cardId: block.id, normalizedInput, transfer: preparation.value.request });
    leases.push(...preparation.value.leaseDocuments);
  }
  if (hasSameDatabaseCard) {
    if (request.input.destination.kind !== "database" || !request.input.destination.view) {
      throw new NodexAgentReadError(
        "invalid_arguments",
        "Moving within one Database requires a destination View placement",
        false,
        "none",
      );
    }
  }
  const leaseDocuments = uniqueLeaseDocuments(leases);
  const authorization: NodexAgentTransferAuthorizationEvidence = {
    roots: Object.fromEntries(blocks.map((block) => [
      block.id,
      { type: "card", transformation: "preserved" as const },
    ])),
    documentIds: leaseDocuments.map((lease) => lease.documentId),
  };
  const now = new Date().toISOString();
  if (!existing) {
    database.prepare(
      `
      INSERT INTO nodex_agent_call_receipts (
        call_identity, thread_id, call_id, project_id, tool, request_hash,
        mutation_id, allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'move_cards', ?, ?, '[]', '{}', 'prepared', ?, ?)
    `).run(
      identity,
      request.threadId,
      request.callId,
      request.projectId,
      requestHash,
      mutationId,
      now,
      now,
    );
  }
  return {
    ok: true,
    value: {
      kind: "prepared",
      command: {
        threadId: request.threadId,
        callId: request.callId,
        projectId: request.projectId,
        requestHash,
        mutationId,
        storeEpoch,
        input: request.input,
        destination,
        transfers,
        leaseDocuments,
      },
      authorization,
    },
  };
}

function rebaseTransferRequest(
  request: BlockTransferRequest,
  heads: ReadonlyMap<string, { readonly generation: number; readonly headSeq: number }>,
): BlockTransferRequest {
  const source = request.source.kind === "document" && heads.has(request.source.documentId)
    ? {
        ...request.source,
        generation: heads.get(request.source.documentId)?.generation as number,
        expectedHeadSeq: heads.get(request.source.documentId)?.headSeq as number,
      }
    : request.source;
  const target = request.target.kind === "document" && heads.has(request.target.documentId)
    ? {
        ...request.target,
        generation: heads.get(request.target.documentId)?.generation as number,
        expectedHeadSeq: heads.get(request.target.documentId)?.headSeq as number,
      }
    : request.target;
  return { ...request, source, target };
}

function compileFinalViewPlacement(
  database: Database.Database,
  command: NodexAgentMoveCardsCommand,
): DatabaseMutationRequest | null {
  if (command.destination.kind !== "database" || !command.destination.view) return null;
  const destination = command.destination;
  const view = database.prepare(
    `
    SELECT revision, config_json
    FROM database_views
    WHERE id = ? AND database_block_id = ? AND project_id = ? AND lifecycle = 'active'
  `).get(
    command.destination.view.viewId,
    command.destination.databaseBlockId,
    command.projectId,
  ) as { readonly revision: number; readonly config_json: string } | undefined;
  if (!view || view.revision !== command.destination.view.viewRevision) {
    throw new NodexAgentReadError(
      "conflict",
      `View ${command.destination.view.viewId} changed before Card movement`,
      false,
      "query_database_again",
    );
  }
  const config = parseGeneralDatabaseViewConfig(JSON.parse(view.config_json) as unknown);
  const groupPropertyId = config.group?.propertyId ?? null;
  const groupKey = command.destination.view.groupKey;
  if (!groupPropertyId && groupKey !== null) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Ungrouped View ${command.destination.view.viewId} requires a null groupKey`,
      false,
      "query_database_again",
    );
  }
  const placements = command.input.cardIds.map((cardId) => {
    const row = database.prepare(
      `
      SELECT membership.id AS membership_id,
        COALESCE(position.revision, 0) AS position_revision,
        COALESCE(group_value.revision, 0) AS group_value_revision
      FROM database_memberships membership
      LEFT JOIN database_view_positions position
        ON position.view_id = ? AND position.block_id = membership.card_block_id
       AND position.project_id = membership.project_id
      LEFT JOIN database_property_values group_value
        ON group_value.membership_id = membership.id AND group_value.property_id = ?
      WHERE membership.card_block_id = ? AND membership.database_block_id = ?
        AND membership.project_id = ? AND membership.removed_at IS NULL
    `).get(
      destination.view?.viewId,
      groupPropertyId,
      cardId,
      destination.databaseBlockId,
      command.projectId,
    ) as {
      readonly membership_id: string;
      readonly position_revision: number;
      readonly group_value_revision: number;
    } | undefined;
    if (row) return { cardId, ...row };
    throw new NodexAgentReadError(
      "conflict",
      `Card ${cardId} has no active destination Database membership`,
      false,
      "query_database_again",
    );
  });
  const operations = groupPropertyId
    ? (() => {
        const property = database.prepare(
          `
          SELECT value_type, config_json
          FROM database_properties
          WHERE id = ? AND database_block_id = ? AND project_id = ? AND lifecycle = 'active'
        `).get(
          groupPropertyId,
          command.destination.databaseBlockId,
          command.projectId,
        ) as {
          readonly value_type: DatabasePropertyValueType;
          readonly config_json: string;
        } | undefined;
        if (!property) {
          throw new NodexAgentReadError(
            "projection_not_ready",
            `View ${command.destination.view?.viewId} grouping property is unavailable`,
            true,
            "query_database_again",
          );
        }
        const value = normalizeDatabasePropertyValue(
          {
            valueType: property.value_type,
            config: parseDatabasePropertyConfig(
              property.value_type,
              JSON.parse(property.config_json) as unknown,
            ),
          },
          databaseGroupValueFromKey(property.value_type, groupKey),
        );
        return [{
          kind: "set_values" as const,
          databaseBlockId: command.destination.databaseBlockId,
          entries: placements.map((placement) => ({
            cardBlockId: placement.cardId,
            propertyId: groupPropertyId,
            expectedValueRevision: placement.group_value_revision,
            value,
          })),
        }];
      })()
    : [];
  return {
    version: DATABASE_MUTATION_CONTRACT_VERSION,
    operationId: `${command.mutationId}:final-view-placement`,
    projectId: command.projectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: `nodex-agent:${command.threadId}`,
    actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
    operations: [
      ...operations,
      {
        kind: "position_cards",
        viewId: command.destination.view.viewId,
        cards: placements.map((placement) => ({
          cardBlockId: placement.cardId,
          expectedPositionRevision: placement.position_revision,
        })),
        groupKey,
        ...(command.destination.view.beforeCardBlockId
          ? { beforeCardBlockId: command.destination.view.beforeCardBlockId }
          : {}),
      },
    ],
  };
}

function executeMoveCards(
  database: Database.Database,
  command: NodexAgentMoveCardsCommand,
): ExecuteNodexAgentMoveCardsResult {
  const key = { ...command, tool: "move_cards" };
  const identity = nodexAgentCallIdentity(key);
  const callReceipt = readNodexAgentCallReceipt(database, identity);
  if (!callReceipt) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "No matching prepared Agent Card move exists",
      false,
      "none",
    );
  }
  requireMatchingNodexAgentCallReceipt(callReceipt, key, command.requestHash);
  if (callReceipt.status === "committed") {
    return {
      ok: true,
      value: {
        output: replayMoveCardsOutput(callReceipt),
        duplicate: true,
        documentCommits: [],
        affectedDatabaseBlockIds: [],
        changeLogSeq: 0,
      },
    };
  }
  if (readBlockStoreEpoch(database) !== command.storeEpoch) {
    throw new NodexAgentReadError(
      "conflict",
      "The Nodex store changed after Card movement was prepared",
      false,
      "get_block_again",
    );
  }
  const heads = new Map<string, { readonly generation: number; readonly headSeq: number }>();
  const transferReceipts: BlockTransferReceipt[] = [];
  const databaseReceipts = [];
  for (const step of command.transfers) {
    const request = rebaseTransferRequest(step.transfer, heads);
    const transferred = applyBlockTransfer(database, request);
    if (!transferred.ok) {
      throw new NodexAgentReadError(
        transferred.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
        transferred.error.message,
        transferred.error.retryable,
        transferred.error.reloadRequired ? "get_block_again" : "none",
        { resourceId: step.cardId, domainCode: transferred.error.code },
      );
    }
    transferReceipts.push(transferred.value);
    for (const commit of transferred.value.documentCommits) {
      heads.set(commit.documentId, { generation: commit.generation, headSeq: commit.headSeq });
    }
    const normalizedCommand: NodexAgentTransferCommand = {
      threadId: command.threadId,
      callId: command.callId,
      projectId: command.projectId,
      requestHash: command.requestHash,
      mutationId: request.operationId,
      storeEpoch: command.storeEpoch,
      input: step.normalizedInput,
      transfer: request,
      destination: command.destination,
      leaseDocuments: command.leaseDocuments,
    };
    databaseReceipts.push(...applyDestinationValues(
      database,
      normalizedCommand,
      transferred.value,
    ));
  }
  const finalPlacement = compileFinalViewPlacement(database, command);
  if (finalPlacement) {
    const result = applyDatabaseMutation(database, finalPlacement);
    if (!result.ok) {
      throw new NodexAgentReadError(
        result.error.code.includes("conflict") ? "conflict" : "invalid_arguments",
        result.error.message,
        result.error.retryable,
        "query_database_again",
        { domainCode: result.error.code },
      );
    }
    databaseReceipts.push(result.value);
  }
  const output = MoveCardsV3OutputSchema.parse({
    data: {
      cards: command.input.cardIds.map((cardId) => ({
        cardId,
        location: toCardLocation(
          database,
          command.projectId,
          resultLocation(database, command.projectId, cardId),
        ),
      })),
      moved: command.input.cardIds.length,
    },
  });
  database.prepare(
    `
    UPDATE nodex_agent_call_receipts
    SET status = 'committed', result_metadata_json = ?, updated_at = ?
    WHERE call_identity = ? AND status = 'prepared'
  `).run(JSON.stringify({ output }), new Date().toISOString(), identity);
  const documentCommits = transferReceipts.flatMap((receipt) => receipt.documentCommits);
  return {
    ok: true,
    value: {
      output,
      duplicate: false,
      documentCommits,
      affectedDatabaseBlockIds: [...new Set([
        ...transferReceipts.flatMap((receipt) => receipt.affectedDatabaseBlockIds),
        ...databaseReceipts.flatMap((receipt) => receipt.affectedDatabaseBlockIds),
      ])].sort((left, right) => left.localeCompare(right)),
      changeLogSeq: Math.max(
        ...transferReceipts.map((receipt) => receipt.changeLogSeq),
        ...databaseReceipts.map((receipt) => receipt.changeLogSeq),
      ),
    },
  };
}

export function prepareNodexAgentMoveCards(
  database: Database.Database,
  request: PrepareNodexAgentMoveCardsRequest,
): PrepareNodexAgentMoveCardsResult {
  try {
    return database.transaction(() => prepareMoveCards(database, request)).immediate();
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
}

export function executeNodexAgentMoveCards(
  database: Database.Database,
  command: NodexAgentMoveCardsCommand,
): ExecuteNodexAgentMoveCardsResult {
  try {
    return database.transaction(() => executeMoveCards(database, command)).immediate();
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
}

export function prepareNodexAgentTransfer(
  database: Database.Database,
  request: PrepareNodexAgentTransferRequest,
): PrepareNodexAgentTransferResult {
  try {
    return database.transaction(() => prepareTransfer(database, request)).immediate();
  } catch (error) {
    return readFailure(error);
  }
}

export function executeNodexAgentTransfer(
  database: Database.Database,
  command: NodexAgentTransferCommand,
): ExecuteNodexAgentTransferResult {
  try {
    return database.transaction(() => executeTransfer(database, command)).immediate();
  } catch (error) {
    return readFailure(error);
  }
}
