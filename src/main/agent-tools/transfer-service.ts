import type Database from "better-sqlite3";
import { prepareBlockTransfer } from "../local-store/block-transfers";
import { applyBlockTransfer } from "../local-store/block-transfers";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { applyDatabaseMutation } from "../local-store/database-kernel";
import {
  DATABASE_MUTATION_CONTRACT_VERSION,
  type DatabaseJsonValue,
} from "../../shared/database-kernel";
import {
  TransferBlocksOutputSchema,
  type CreateInput,
  type ExecuteNodexAgentTransferResult,
  type JsonValue,
  type NodexAgentTransferCommand,
  type PrepareNodexAgentTransferRequest,
  type PrepareNodexAgentTransferResult,
  type PreparedNodexAgentCreateDestination,
  type TransferBlocksOutput,
} from "../../shared/nodex-agent-tools";
import type {
  BlockTransferIntentSource,
  BlockTransferIntentTarget,
  BlockTransferReceipt,
} from "../../shared/block-transfer";
import { BLOCK_TRANSFER_CONTRACT_VERSION } from "../../shared/block-transfer";
import {
  decodeNodexAgentToken,
  NodexAgentTokenError,
} from "../local-store/nodex-agent-token-codec";
import {
  nodexAgentCallIdentity,
  readNodexAgentCallReceipt,
  requireMatchingNodexAgentCallReceipt,
  type NodexAgentCallReceiptRow,
} from "./call-receipts";
import { prepareNodexAgentDestination } from "./create-service";
import {
  mintRevision,
  NodexAgentReadError,
  nodexAgentFingerprint,
  parseJsonValue,
  readFailure,
  requireProject,
} from "./read-support";

interface BlockLocationRow {
  readonly id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
  readonly location_revision: number;
}

function coordinate(value: JsonValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new NodexAgentReadError(
    "conflict",
    `${label} revision is incomplete`,
    false,
    "get_block_again",
  );
}

function readBlock(
  database: Database.Database,
  projectId: string,
  blockId: string,
): BlockLocationRow {
  const row = database.prepare(
    `
    SELECT id, type, lifecycle, location_kind,
      containing_document_id, containing_database_id, location_revision
    FROM blocks WHERE id = ? AND project_id = ?
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

function validateLocationToken(
  database: Database.Database,
  projectId: string,
  block: BlockLocationRow,
  token: string,
): void {
  let decoded;
  try {
    decoded = decodeNodexAgentToken(database, token, {
      kind: "location",
      projectId,
      subject: [block.id],
    });
  } catch (error) {
    if (!(error instanceof NodexAgentTokenError)) throw error;
    throw new NodexAgentReadError(
      error.code === "invalid_token" ? "invalid_arguments" : "conflict",
      error.message,
      false,
      "get_block_again",
      { resourceId: block.id, domainCode: error.code },
    );
  }
  const revision = coordinate(decoded.state.revision, "Block location");
  if (
    revision === block.location_revision
    && decoded.state.locationKind === block.location_kind
    && decoded.state.containingDocumentId === block.containing_document_id
    && decoded.state.containingDatabaseId === block.containing_database_id
  ) {
    return;
  }
  throw new NodexAgentReadError(
    "conflict",
    `Block ${block.id} moved after it was read`,
    false,
    "get_block_again",
    { resourceId: block.id, domainCode: "location_revision_conflict" },
  );
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
  const output = TransferBlocksOutputSchema.parse(metadata.output);
  return TransferBlocksOutputSchema.parse({
    ...output,
    data: { ...output.data, receipt: { duplicate: true } },
  });
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
  const blocks = request.input.items.map((item) => {
    const block = readBlock(database, request.projectId, item.blockId);
    validateLocationToken(
      database,
      request.projectId,
      block,
      item.ifLocationRevision,
    );
    return block;
  });
  const sources = new Set(blocks.map(sourceKey));
  if (sources.size !== 1) {
    throw new NodexAgentReadError(
      "mixed_transfer_sources",
      "Every transferred root must share one source container",
      false,
      "get_block_again",
    );
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
    rootBlockIds: request.input.items.map((item) => item.blockId),
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
  return {
    location,
    revision: mintRevision(database, {
      kind: "location",
      projectId,
      subject: [blockId],
      state: {
        revision: row.location_revision,
        locationKind: row.location_kind,
        containingDocumentId: row.containing_document_id,
        containingDatabaseId: row.containing_database_id,
      },
    }),
  };
}

function transferOutput(
  database: Database.Database,
  command: NodexAgentTransferCommand,
  receipt: BlockTransferReceipt,
): TransferBlocksOutput {
  const evidenceBySource = new Map(
    receipt.transformationEvidence.map((evidence) => [evidence.sourceBlockId, evidence]),
  );
  const results = command.input.items.map((item) => {
    const evidence = evidenceBySource.get(item.blockId);
    const resultBlockId = evidence?.resultCardId
      ?? receipt.copiedBlockIds[item.blockId]
      ?? item.blockId;
    const current = resultLocation(database, command.projectId, resultBlockId);
    return {
      sourceBlockId: item.blockId,
      resultBlockId,
      location: current.location,
      locationRevision: current.revision,
      transformation: evidence?.kind === "wrap"
        ? "wrapped" as const
        : evidence?.kind === "promote"
          ? "promoted" as const
          : "preserved" as const,
    };
  });
  return TransferBlocksOutputSchema.parse({
    schemaVersion: 1,
    data: {
      mode: command.input.mode,
      results,
      copiedBlockIds: receipt.copiedBlockIds,
      receipt: { duplicate: false },
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
