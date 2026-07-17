import type Database from "better-sqlite3";
import type {
  BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import type { PortableRichText } from "../../shared/block-documents/portable-rich-text";
import {
  assessBlockSemanticContentForPage,
  BlockSemanticContentError,
} from "../../shared/block-documents/block-semantic-content";
import { prepareBlockTransfer } from "../local-store/block-transfers";
import { applyBlockTransfer } from "../local-store/block-transfers";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { mintNodexAgentEtag } from "../local-store/nodex-agent-etag";
import { applyDatabaseMutation } from "../local-store/database-kernel";
import {
  assertCurrentNodexAgentTurnAuthorityInDatabase,
  assertNodexAgentResourceAuthorizationInDatabase,
  assertNodexAgentResourceIntentsAuthorizedInDatabase,
  authorizeNodexAgentResourceInDatabase,
  authorizeProjectResourceInDatabase,
} from "../local-store/project-resource-grants";
import {
  applyLibraryContentRehomeInTransaction,
  prepareLibraryContentRehome,
} from "../local-store/library-content-rehome";
import {
  DATABASE_MUTATION_CONTRACT_VERSION,
  databaseGroupValueFromKey,
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  type DatabaseJsonValue,
  type DatabaseMutationRequest,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import { resolveLegacyDatabaseViewOrderConfig } from "../local-store/legacy-database-view-logical-order";
import {
  DuplicatePageV3OutputSchema,
  MovePagesV3OutputSchema,
  BlockIdSchema,
  BlockLocationSchema,
  TransferBlocksInputSchema,
  TransferBlocksOutputSchema,
  type CreateInput,
  type ExecuteNodexAgentTransferResult,
  type ExecuteNodexAgentDuplicatePageResult,
  type ExecuteNodexAgentMovePagesResult,
  type NodexAgentDuplicatePageCommand,
  type NodexAgentMovePagesCommand,
  type NodexAgentTransferCommand,
  type NodexAgentTransferAuthorizationEvidence,
  type PrepareNodexAgentTransferRequest,
  type PrepareNodexAgentTransferResult,
  type PrepareNodexAgentDuplicatePageRequest,
  type PrepareNodexAgentDuplicatePageResult,
  type PrepareNodexAgentMovePagesRequest,
  type PrepareNodexAgentMovePagesResult,
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
import { BLOCK_TRANSFER_INTENT_CONTRACT_VERSION } from "../../shared/block-transfer";
import {
  nodexAgentCallIdentity,
  nodexAgentCallProvenance,
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

import {
  readMutatedPageDocumentId,
  readMutatedPageLocation,
  requirePageDocumentId,
  requirePageStorageContext,
} from "./page-adapter";
import { documentBodyEtagState, titleEtagState } from "./semantic-guards";
import { publicV3Failure } from "./v3-errors";

const assertTransferDestinationAuthority = (
  database: Database.Database,
  command: Pick<
    NodexAgentDuplicatePageCommand,
    "authority" | "resourceAccess" | "callId" | "destination"
  >,
): void => {
  assertCurrentNodexAgentTurnAuthorityInDatabase(database, command.authority);
  if (!command.authority) return;
  if (command.destination.kind === "space") {
    assertNodexAgentResourceIntentsAuthorizedInDatabase(database, {
      authority: command.authority,
      callId: command.callId,
      intents: [{
        target: { kind: "library", libraryId: command.authority.libraryId },
        action: "create_child",
      }],
      ...(command.resourceAccess
        ? { resourceAccess: command.resourceAccess }
        : {}),
    });
    return;
  }
  if (command.destination.kind === "database") {
    assertNodexAgentResourceAuthorizationInDatabase(database, {
      authority: command.authority,
      resource: { kind: "database", databaseId: command.destination.databaseBlockId },
      action: "create_child",
      ...(command.resourceAccess
        ? { resourceAccess: command.resourceAccess }
        : {}),
      callId: command.callId,
    });
    return;
  }
  if (command.destination.kind !== "document") return;
  const owner = database.prepare(`
    SELECT ownership.block_id AS pageId
    FROM block_documents ownership
    INNER JOIN pages page ON page.block_id = ownership.block_id
    WHERE ownership.document_id = ?
  `).get(command.destination.documentId) as { readonly pageId: string } | undefined;
  if (!owner) throw new Error("Nodex Agent transfer destination has no Page owner");
  assertNodexAgentResourceAuthorizationInDatabase(database, {
    authority: command.authority,
    resource: { kind: "page", pageId: owner.pageId },
    action: "create_child",
    ...(command.resourceAccess
      ? { resourceAccess: command.resourceAccess }
      : {}),
    callId: command.callId,
  });
};

interface BlockLocationRow {
  readonly id: string;
  readonly project_id: string;
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
    SELECT block.id, block.project_id, block.type, block.lifecycle, block.location_kind,
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

function sourceIntent(
  database: Database.Database,
  projectId: string,
  block: BlockLocationRow,
): BlockTransferIntentSource {
  if (block.location_kind === "space") {
    const project = database.prepare(`
      SELECT library_id AS libraryId FROM projects WHERE id = ?
    `).get(projectId) as { readonly libraryId: string } | undefined;
    if (!project) throw new Error(`Project ${projectId} has no Library`);
    return { kind: "library", libraryId: project.libraryId };
  }
  if (block.location_kind === "document" && block.containing_document_id) {
    const page = database.prepare(`
      SELECT block_id AS pageId FROM pages WHERE document_id = ?
    `).get(block.containing_document_id) as
      | { readonly pageId: string }
      | undefined;
    if (page) return { kind: "page", pageId: page.pageId };
    return { kind: "document", documentId: block.containing_document_id };
  }
  if (block.location_kind === "database" && block.containing_database_id) {
    const source = database.prepare(`
      SELECT parent_id AS dataSourceId FROM pages
      WHERE block_id = ? AND parent_kind = 'data_source'
    `).get(block.id) as { readonly dataSourceId: string } | undefined;
    if (!source) throw new Error(`Page ${block.id} has no Data Source parent`);
    return { kind: "data_source", dataSourceId: source.dataSourceId };
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
      if (!coercesDocumentRoots || block.type === "page") {
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
        const assessment = assessBlockSemanticContentForPage(source);
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
): {
  readonly viewId: string;
  readonly dataSourceId: string;
  readonly groupKey: null;
} {
  const row = database.prepare(
    `
    SELECT id, data_source_id AS dataSourceId
    FROM database_views
    WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
    ORDER BY is_primary DESC, rank_key, id
    LIMIT 1
  `).get(databaseBlockId, projectId) as
    | { readonly id: string; readonly dataSourceId: string }
    | undefined;
  if (!row) {
    throw new NodexAgentReadError(
      "unsupported_resource",
      `Database ${databaseBlockId} has no active View for transfer staging`,
      false,
      "query_database_again",
      { resourceId: databaseBlockId, domainCode: "database_view_required" },
    );
  }
  return { viewId: row.id, dataSourceId: row.dataSourceId, groupKey: null };
}

function transferTarget(
  database: Database.Database,
  projectId: string,
  destination: PreparedNodexAgentCreateDestination,
): BlockTransferIntentTarget {
  if (destination.kind === "space") {
    const project = database.prepare(`
      SELECT library_id AS libraryId FROM projects WHERE id = ?
    `).get(projectId) as { readonly libraryId: string } | undefined;
    if (!project) throw new Error(`Project ${projectId} has no Library`);
    return {
      kind: "library",
      libraryId: project.libraryId,
      ...(destination.beforeBlockId ? { beforeBlockId: destination.beforeBlockId } : {}),
    };
  }
  if (destination.kind === "document") {
    const page = database.prepare(`
      SELECT block_id AS pageId FROM pages WHERE document_id = ?
    `).get(destination.documentId) as
      | { readonly pageId: string }
      | undefined;
    if (page) {
      return {
        kind: "page",
        pageId: page.pageId,
        ...(destination.parentBlockId
          ? { parentBlockId: destination.parentBlockId }
          : {}),
        ...(destination.beforeBlockId
          ? { beforeBlockId: destination.beforeBlockId }
          : {}),
      };
    }
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
  const dataSourceId = "dataSourceId" in view
    ? view.dataSourceId
    : (database.prepare(`
        SELECT data_source_id AS dataSourceId
        FROM database_views
        WHERE id = ? AND database_block_id = ? AND lifecycle = 'active'
      `).get(view.viewId, destination.databaseBlockId) as
        | { readonly dataSourceId: string }
        | undefined)?.dataSourceId;
  if (!dataSourceId) {
    throw new NodexAgentReadError(
      "unsupported_resource",
      `View ${view.viewId} has no active Data Source target`,
      false,
      "query_database_again",
    );
  }
  return {
    kind: "data_source",
    dataSourceId,
    viewId: view.viewId,
    groupKey: view.groupKey,
    ...(destination.view?.beforePageId
      ? { beforePageId: destination.view.beforePageId }
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
  const source = sourceIntent(
    database,
    request.projectId,
    blocks[0] as BlockLocationRow,
  );
  const target = transferTarget(database, request.projectId, destination);
  if (
    request.input.mode === "move"
    && ((source.kind === "page"
      && target.kind === "page"
      && source.pageId === target.pageId)
      || (source.kind === "document"
        && target.kind === "document"
        && source.documentId === target.documentId))
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
    && source.kind === "data_source"
    && target.kind === "data_source"
    && source.dataSourceId === target.dataSourceId
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
    version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
    operationId: mutationId,
    projectId: request.projectId,
    storeEpoch,
    clientSessionId: `nodex-agent:${request.threadId}`,
    actor: { kind: "nodex_agent", threadId: request.threadId, callId: request.callId },
    mode: request.input.mode,
    rootBlockIds: request.input.blockIds,
    source,
    target,
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
        call_identity, thread_id, turn_id, call_id, project_id, tool, request_hash,
        mutation_id, authority_fingerprint, provenance_version,
        allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'transfer_blocks', ?, ?, ?, ?, '[]', '{}', 'prepared', ?, ?)
    `).run(
      identity,
      request.threadId,
      request.authority?.turnId ?? null,
      request.callId,
      request.projectId,
      requestHash,
      mutationId,
      nodexAgentCallProvenance(request)[1],
      nodexAgentCallProvenance(request)[2],
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
        ...(request.authority ? { authority: request.authority } : {}),
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
  pageId: string,
  databaseBlockId: string,
) {
  const row = database.prepare(
    `
    SELECT id, revision
    FROM database_memberships
    WHERE page_block_id = ? AND database_block_id = ? AND removed_at IS NULL
  `).get(pageId, databaseBlockId) as
    | { readonly id: string; readonly revision: number }
    | undefined;
  if (!row) throw new Error(`Transferred Page ${pageId} has no target membership`);
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
  for (const pageId of results) {
    let membership = activeMembership(
      database,
      pageId,
      command.destination.databaseBlockId,
    );
    if (!command.destination.view) {
      const detach = applyDatabaseMutation(database, {
        version: DATABASE_MUTATION_CONTRACT_VERSION,
        operationId: `${command.mutationId}:detach:${pageId}`,
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
        operations: [{
          kind: "transfer_membership",
          pageId,
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
        operationId: `${command.mutationId}:membership:${pageId}`,
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
        operations: [{
          kind: "transfer_membership",
          pageId,
          expectedMembership: null,
          target: {
            databaseBlockId: command.destination.databaseBlockId,
            membershipId: `membership:${command.mutationId}:${pageId}`,
          },
        }],
      });
      if (!readd.ok) throw new Error(readd.error.message);
      databaseReceipts.push(readd.value);
      membership = activeMembership(
        database,
        pageId,
        command.destination.databaseBlockId,
      );
    }
    if (!inputDestination.values?.length) continue;
    const values = applyDatabaseMutation(database, {
      version: DATABASE_MUTATION_CONTRACT_VERSION,
      operationId: `${command.mutationId}:values:${pageId}`,
      projectId: command.projectId,
      storeEpoch: command.storeEpoch,
      actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
      operations: [{
        kind: "set_values",
        databaseBlockId: command.destination.databaseBlockId,
        entries: inputDestination.values.map((draft) => ({
          pageId,
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
    const resultBlockId = evidence?.resultPageId
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
  return DuplicatePageV3OutputSchema.parse(metadata.output);
}

type CanonicalTransferDestination =
  | PrepareNodexAgentDuplicatePageRequest["input"]["destination"]
  | PrepareNodexAgentMovePagesRequest["input"]["destination"];

function legacyTransferDestination(
  database: Database.Database,
  projectId: string,
  authority:
    | PrepareNodexAgentDuplicatePageRequest["authority"]
    | PrepareNodexAgentMovePagesRequest["authority"],
  resourceAccess:
    | PrepareNodexAgentDuplicatePageRequest["resourceAccess"]
    | PrepareNodexAgentMovePagesRequest["resourceAccess"],
  callId: string,
  destination: CanonicalTransferDestination,
): TransferBlocksInput["destination"] {
  if (destination.kind === "library") {
    return { kind: "space", ...(destination.at ? { at: destination.at } : {}) };
  }
  if (destination.kind === "page") {
    return {
      kind: "document",
      documentId: requirePageDocumentId(
        database,
        projectId,
        destination.pageId,
        "create_child",
        authority,
        resourceAccess,
        callId,
        "prepare",
      ),
      at: destination.at ?? { kind: "end" },
    };
  }
  const authorization = authority
    ? authorizeNodexAgentResourceInDatabase(database, {
        authority,
        resource: { kind: "data_source", dataSourceId: destination.dataSourceId },
        action: "create_child",
        ...(resourceAccess ? { resourceAccess } : {}),
        callId,
        phase: "prepare",
      })
    : authorizeProjectResourceInDatabase(database, {
        projectId,
        resource: { kind: "data_source", dataSourceId: destination.dataSourceId },
        action: "create_child",
      });
  if (!authorization.allowed) {
    throw new NodexAgentReadError(
      authorization.reason === "resource_not_found" ? "not_found" : "authorization_denied",
      `Data Source ${destination.dataSourceId} create denied: ${authorization.reason}`,
      false,
      "none",
      { resourceId: destination.dataSourceId, domainCode: authorization.reason },
    );
  }
  const source = database.prepare(`
    SELECT home_database_block_id AS databaseBlockId
    FROM data_sources WHERE id = ? AND lifecycle = 'active'
  `).get(destination.dataSourceId) as { readonly databaseBlockId: string } | undefined;
  if (!source) {
    throw new NodexAgentReadError(
      "not_found",
      `Data Source ${destination.dataSourceId} was not found`,
      false,
      "none",
    );
  }
  return {
    kind: "database",
    databaseBlockId: BlockIdSchema.parse(source.databaseBlockId),
    ...(destination.values ? { values: destination.values } : {}),
    ...(destination.view ? { view: destination.view } : {}),
  };
}

function normalizedDuplicateInput(
  database: Database.Database,
  request: PrepareNodexAgentDuplicatePageRequest,
): TransferBlocksInput {
  const destination = legacyTransferDestination(
    database,
    request.projectId,
    request.authority,
    request.resourceAccess,
    request.callId,
    request.input.destination,
  );
  return TransferBlocksInputSchema.parse({
    mode: "copy",
    blockIds: [request.input.pageId],
    destination,
    ...(request.input.return?.includes("block_map")
      ? { return: { blockMap: true } }
      : {}),
  });
}

function prepareDuplicatePage(
  database: Database.Database,
  request: PrepareNodexAgentDuplicatePageRequest,
): PrepareNodexAgentDuplicatePageResult {
  requireProject(database, request.projectId);
  const key = { ...request, tool: "duplicate_page" };
  const identity = nodexAgentCallIdentity(key);
  const requestHash = nodexAgentFingerprint({
    tool: "duplicate_page",
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

  const sourcePage = requirePageStorageContext(
    database,
    request.projectId,
    request.input.pageId,
    "read",
    request.authority,
    request.resourceAccess,
    request.callId,
    "prepare",
  );
  const sourceProjectId = sourcePage.contentProjectId;
  const sourceBlock = readBlock(database, sourceProjectId, request.input.pageId);
  if (sourceBlock.type !== "page") {
    throw new NodexAgentReadError(
      "unsupported_resource",
      `Block ${request.input.pageId} is not a Page`,
      false,
      "none",
      { resourceId: request.input.pageId, domainCode: "page_root_required" },
    );
  }
  requirePageDocumentId(
    database,
    request.projectId,
    request.input.pageId,
    "read",
    request.authority,
    request.resourceAccess,
    request.callId,
    "prepare",
  );
  const normalizedInput = normalizedDuplicateInput(database, request);
  const destination = prepareNodexAgentDestination(
    database,
    request.projectId,
    normalizedInput.destination as CreateInput["destination"],
    request.authority !== undefined,
  );
  const targetProjectId = destination.contentProjectId ?? request.projectId;
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Nodex store has no epoch");
  const mutationId = existing?.mutation_id ?? `nodex-duplicate-page:${identity}`;
  const preparation = prepareBlockTransfer(database, {
    version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
    operationId: mutationId,
    projectId: sourceProjectId,
    storeEpoch,
    clientSessionId: `nodex-agent:${request.threadId}`,
    actor: { kind: "nodex_agent", threadId: request.threadId, callId: request.callId },
    mode: "copy",
    rootBlockIds: [request.input.pageId],
    source: sourceIntent(database, sourceProjectId, sourceBlock),
    target: sourceProjectId === targetProjectId
      ? transferTarget(database, sourceProjectId, destination)
      : transferTarget(database, sourceProjectId, {
          kind: "space",
          contentProjectId: sourceProjectId,
        }),
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
  if (authorization.roots[request.input.pageId]?.transformation !== "preserved") {
    throw new NodexAgentReadError(
      "unsupported_resource",
      "duplicate_page accepts only a complete Page root",
      false,
      "none",
      { resourceId: request.input.pageId, domainCode: "page_root_required" },
    );
  }
  const now = new Date().toISOString();
  if (!existing) {
    database.prepare(
      `
      INSERT INTO nodex_agent_call_receipts (
        call_identity, thread_id, turn_id, call_id, project_id, tool, request_hash,
        mutation_id, authority_fingerprint, provenance_version,
        allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'duplicate_page', ?, ?, ?, ?, '[]', '{}', 'prepared', ?, ?)
    `).run(
      identity,
      request.threadId,
      request.authority?.turnId ?? null,
      request.callId,
      request.projectId,
      requestHash,
      mutationId,
      nodexAgentCallProvenance(request)[1],
      nodexAgentCallProvenance(request)[2],
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
        ...(request.authority ? { authority: request.authority } : {}),
        ...(request.resourceAccess ? { resourceAccess: request.resourceAccess } : {}),
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

function duplicatePageOutput(
  database: Database.Database,
  command: NodexAgentDuplicatePageCommand,
  receipt: BlockTransferReceipt,
) {
  const contentProjectId = command.destination.contentProjectId
    ?? command.projectId;
  const pageId = receipt.copiedBlockIds[command.input.pageId]
    ?? receipt.resultRootBlockIds[0];
  if (!pageId || pageId === command.input.pageId) {
    throw new NodexAgentReadError(
      "internal_error",
      "Page duplication did not produce a fresh Page identity",
      false,
      "none",
    );
  }
  const documentId = readMutatedPageDocumentId(database, pageId);
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
      "Duplicated Page materialization is unavailable",
      true,
      "retry_same",
    );
  }
  const blocks = parseJsonValue(
    materialization.block_tree_json,
    `Document ${documentId} Block tree`,
  );
  if (!Array.isArray(blocks)) throw new Error("Duplicated Page Block tree is invalid");
  const richTitle = parseJsonValue(
    materialization.title_rich_json,
    `Document ${documentId} rich title`,
  ) as unknown as PortableRichText;
  return DuplicatePageV3OutputSchema.parse({
    data: {
      sourcePageId: command.input.pageId,
      pageId,
      location: readMutatedPageLocation(database, pageId),
      bodyBlocksCreated: flattenBlocks(blocks as unknown as readonly BlockTreeNode[]).length,
      ...(command.input.return?.includes("block_map")
        ? { blockMap: receipt.copiedBlockIds }
        : {}),
      ...(command.input.return?.includes("etags")
        ? {
            etags: {
              title: mintNodexAgentEtag(database, titleEtagState({
                projectId: contentProjectId,
                documentId,
                richTitle,
              })),
              body: mintNodexAgentEtag(database, documentBodyEtagState({
                projectId: contentProjectId,
                documentId,
                nfm: materialization.nfm,
              })),
            },
          }
        : {}),
    },
  });
}

function executeDuplicatePage(
  database: Database.Database,
  command: NodexAgentDuplicatePageCommand,
): ExecuteNodexAgentDuplicatePageResult {
  const key = { ...command, tool: "duplicate_page" };
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
  assertTransferDestinationAuthority(database, command);
  assertNodexAgentResourceAuthorizationInDatabase(database, {
    authority: command.authority,
    resource: { kind: "page", pageId: command.input.pageId },
    action: "read",
    ...(command.resourceAccess
      ? { resourceAccess: command.resourceAccess }
      : {}),
    callId: command.callId,
  });
  if (readBlockStoreEpoch(database) !== command.storeEpoch) {
    throw new NodexAgentReadError(
      "conflict",
      "The Nodex store changed after Page duplication was prepared",
      false,
      "get_block_again",
    );
  }
  const sourceProjectId = command.transfer.projectId;
  const targetProjectId = command.destination.contentProjectId
    ?? command.projectId;
  const staged = applyBlockTransfer(database, command.transfer, {
    persistTopLevelGrant: sourceProjectId === targetProjectId
      && (
        !command.authority
        || command.resourceAccess?.persistResultingPageGrants === true
      ),
  });
  const transferred = (() => {
    if (!staged.ok || sourceProjectId === targetProjectId) return staged;
    const copiedPageId = staged.value.copiedBlockIds[command.input.pageId]
      ?? staged.value.resultRootBlockIds[0];
    if (!copiedPageId) {
      throw new Error("Staged Page copy did not produce a root identity");
    }
    const rehome = prepareLibraryContentRehome(database, {
      operationId: `${command.mutationId}:rehome`,
      callIdentity: identity,
      actorProjectId: command.projectId,
      sourceProjectId,
      targetProjectId,
      rootPageIds: [copiedPageId],
      storeEpoch: command.storeEpoch,
    });
    applyLibraryContentRehomeInTransaction(database, rehome);
    const copiedBlock = readBlock(database, targetProjectId, copiedPageId);
    const targetPreparation = prepareBlockTransfer(database, {
      version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
      operationId: `${command.mutationId}:target`,
      projectId: targetProjectId,
      storeEpoch: command.storeEpoch,
      clientSessionId: `nodex-agent:${command.threadId}`,
      actor: {
        kind: "nodex_agent",
        threadId: command.threadId,
        callId: command.callId,
      },
      mode: "move",
      rootBlockIds: [copiedPageId],
      source: sourceIntent(database, targetProjectId, copiedBlock),
      target: transferTarget(database, targetProjectId, command.destination),
    });
    if (!targetPreparation.ok) {
      throw new NodexAgentReadError(
        targetPreparation.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
        targetPreparation.error.message,
        targetPreparation.error.retryable,
        targetPreparation.error.reloadRequired ? "get_block_again" : "none",
      );
    }
    const placed = applyBlockTransfer(database, targetPreparation.value.request, {
      persistTopLevelGrant:
        !command.authority
        || command.resourceAccess?.persistResultingPageGrants === true,
    });
    if (!placed.ok) return placed;
    return {
      ok: true as const,
      value: {
        ...placed.value,
        mode: "copy" as const,
        sourceRootBlockIds: command.transfer.rootBlockIds,
        copiedBlockIds: staged.value.copiedBlockIds,
        documentCommits: [
          ...staged.value.documentCommits,
          ...placed.value.documentCommits,
        ],
        affectedDatabaseBlockIds: [...new Set([
          ...staged.value.affectedDatabaseBlockIds,
          ...placed.value.affectedDatabaseBlockIds,
        ])].sort((left, right) => left.localeCompare(right)),
        changeLogSeq: Math.max(
          staged.value.changeLogSeq,
          placed.value.changeLogSeq,
        ),
      },
    };
  })();
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
    projectId: targetProjectId,
    input: command.normalizedInput,
  };
  const databaseReceipts = applyDestinationValues(
    database,
    normalizedCommand,
    transferred.value,
  );
  const output = duplicatePageOutput(database, command, transferred.value);
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

export function prepareNodexAgentDuplicatePage(
  database: Database.Database,
  request: PrepareNodexAgentDuplicatePageRequest,
): PrepareNodexAgentDuplicatePageResult {
  try {
    return database.transaction(() => prepareDuplicatePage(database, request)).immediate();
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
}

export function executeNodexAgentDuplicatePage(
  database: Database.Database,
  command: NodexAgentDuplicatePageCommand,
): ExecuteNodexAgentDuplicatePageResult {
  try {
    return database.transaction(() => executeDuplicatePage(database, command)).immediate();
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
}

function replayMovePagesOutput(receipt: NodexAgentCallReceiptRow) {
  const metadata = parseJsonValue(
    receipt.result_metadata_json,
    `Agent call ${receipt.call_identity} result metadata`,
  );
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new NodexAgentReadError(
      "internal_error",
      "Agent Page move result metadata is invalid",
      false,
      "none",
    );
  }
  return MovePagesV3OutputSchema.parse(metadata.output);
}

function normalizedMoveInput(
  database: Database.Database,
  request: PrepareNodexAgentMovePagesRequest,
  pageId: string,
  source: BlockLocationRow,
): TransferBlocksInput {
  const destination = legacyTransferDestination(
    database,
    request.projectId,
    request.authority,
    request.resourceAccess,
    request.callId,
    request.input.destination,
  );
  return TransferBlocksInputSchema.parse({
    mode: "move",
    blockIds: [pageId],
    from: resultLocation(database, source.project_id, source.id),
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
        `Document ${lease.documentId} changed while preparing Page moves`,
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

function assertExternalMoveAnchors(request: PrepareNodexAgentMovePagesRequest): void {
  const selected = new Set<string>(request.input.pageIds);
  if (request.input.destination.kind === "page"
    && selected.has(request.input.destination.pageId)) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "A moved Page cannot be its own destination Page",
      false,
      "none",
    );
  }
  const anchor = request.input.destination.kind === "data_source"
    ? request.input.destination.view?.at
    : request.input.destination.at;
  if (anchor && (anchor.kind === "before" || anchor.kind === "after")
    && selected.has(anchor.blockId)) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "A Page move anchor must be outside the moved Page set",
      false,
      "none",
      { resourceId: anchor.blockId, domainCode: "move_anchor_selected" },
    );
  }
}

function prepareMovePages(
  database: Database.Database,
  request: PrepareNodexAgentMovePagesRequest,
): PrepareNodexAgentMovePagesResult {
  requireProject(database, request.projectId);
  const key = { ...request, tool: "move_pages" };
  const identity = nodexAgentCallIdentity(key);
  const requestHash = nodexAgentFingerprint({
    tool: "move_pages",
    projectId: request.projectId,
    input: request.input,
  });
  const existing = readNodexAgentCallReceipt(database, identity);
  if (existing) {
    requireMatchingNodexAgentCallReceipt(existing, key, requestHash);
    if (existing.status === "committed") {
      return {
        ok: true,
        value: { kind: "completed", output: replayMovePagesOutput(existing) },
      };
    }
  }
  assertExternalMoveAnchors(request);
  const blocks = request.input.pageIds.map((pageId) => {
    const page = requirePageStorageContext(
      database,
      request.projectId,
      pageId,
      "move",
      request.authority,
      request.resourceAccess,
      request.callId,
      "prepare",
    );
    const block = readBlock(database, page.contentProjectId, pageId);
    if (block.type === "page") return block;
    throw new NodexAgentReadError(
      "unsupported_resource",
      `Block ${pageId} is not a Page`,
      false,
      "none",
      { resourceId: pageId, domainCode: "page_root_required" },
    );
  });
  blocks.forEach((block) => requirePageDocumentId(
    database,
    request.projectId,
    block.id,
    "read",
    request.authority,
    request.resourceAccess,
    request.callId,
    "prepare",
  ));
  const normalizedInputs = blocks.map((block) =>
    normalizedMoveInput(database, request, block.id, block)
  );
  const destination = prepareNodexAgentDestination(
    database,
    request.projectId,
    normalizedInputs[0]?.destination as CreateInput["destination"],
    request.authority !== undefined,
  );
  const targetProjectId = destination.contentProjectId ?? request.projectId;
  const hasSameDatabasePage = destination.kind === "database"
    && blocks.some((block) =>
      block.project_id === targetProjectId
      &&
      block.location_kind === "database"
      && block.containing_database_id === destination.databaseBlockId
    );
  if (hasSameDatabasePage) {
    if (request.input.destination.kind !== "data_source" || !request.input.destination.view) {
      throw new NodexAgentReadError(
        "invalid_arguments",
        "Moving within one Data Source requires a destination View placement",
        false,
        "none",
      );
    }
    if (request.input.destination.values?.length) {
      throw new NodexAgentReadError(
        "invalid_arguments",
        "Moving within one Data Source cannot change independent property values",
        false,
        "none",
      );
    }
  }
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Nodex store has no epoch");
  const mutationId = existing?.mutation_id ?? `nodex-move-pages:${identity}`;
  const transfers = [];
  const leases = [];
  for (const [index, block] of blocks.entries()) {
    const normalizedInput = normalizedInputs[index] as TransferBlocksInput;
    const sourceProjectId = block.project_id;
    const sameDatabase = block.location_kind === "database"
      && sourceProjectId === targetProjectId
      && destination.kind === "database"
      && block.containing_database_id === destination.databaseBlockId;
    if (sameDatabase) continue;
    const rehome = sourceProjectId === targetProjectId
      ? undefined
      : prepareLibraryContentRehome(database, {
          operationId: `${mutationId}:page:${index}:rehome`,
          callIdentity: identity,
          actorProjectId: request.projectId,
          sourceProjectId,
          targetProjectId,
          rootPageIds: [block.id],
          storeEpoch,
        });
    const intendedTarget = rehome
      ? {
          kind: "space" as const,
          contentProjectId: sourceProjectId,
        }
      : destination;
    const preparation = block.location_kind === "space" && rehome
      ? null
      : prepareBlockTransfer(database, {
      version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
      operationId: `${mutationId}:page:${index}`,
      projectId: sourceProjectId,
      storeEpoch,
      clientSessionId: `nodex-agent:${request.threadId}`,
      actor: { kind: "nodex_agent", threadId: request.threadId, callId: request.callId },
      mode: "move",
      rootBlockIds: [block.id],
      source: sourceIntent(database, sourceProjectId, block),
      target: transferTarget(database, sourceProjectId, intendedTarget),
    });
    if (preparation && !preparation.ok) {
      throw new NodexAgentReadError(
        preparation.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
        preparation.error.message,
        preparation.error.retryable,
        preparation.error.reloadRequired ? "get_block_again" : "none",
        { domainCode: preparation.error.code },
      );
    }
    transfers.push({
      pageId: block.id,
      sourceProjectId,
      targetProjectId,
      normalizedInput,
      transfer: preparation?.value.request ?? null,
      ...(rehome ? { rehome } : {}),
    });
    if (preparation?.ok) leases.push(...preparation.value.leaseDocuments);
    if (rehome) {
      const documentPlaceholders = rehome.documentIds.map(() => "?").join(", ");
      leases.push(...(database.prepare(`
        SELECT id AS documentId, generation, head_seq AS expectedHeadSeq
        FROM documents
        WHERE project_id = ? AND id IN (${documentPlaceholders})
      `).all(sourceProjectId, ...rehome.documentIds) as readonly {
        readonly documentId: string;
        readonly generation: number;
        readonly expectedHeadSeq: number;
      }[]));
    }
  }
  const claimedRehomeBlockIds = new Map<string, string>();
  for (const transfer of transfers) {
    if (!transfer.rehome) continue;
    for (const blockId of transfer.rehome.blockIds) {
      const claimedByPageId = claimedRehomeBlockIds.get(blockId);
      if (claimedByPageId && claimedByPageId !== transfer.pageId) {
        throw new NodexAgentReadError(
          "invalid_arguments",
          "Cross-owner Page moves cannot select both an ownership ancestor and its descendant",
          false,
          "none",
          {
            resourceId: transfer.pageId,
            domainCode: "overlapping_ownership_closures",
          },
        );
      }
      claimedRehomeBlockIds.set(blockId, transfer.pageId);
    }
  }
  if (hasSameDatabasePage) {
    if (request.input.destination.kind !== "data_source" || !request.input.destination.view) {
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
      { type: "page", transformation: "preserved" as const },
    ])),
    documentIds: leaseDocuments.map((lease) => lease.documentId),
  };
  const now = new Date().toISOString();
  if (!existing) {
    database.prepare(
      `
      INSERT INTO nodex_agent_call_receipts (
        call_identity, thread_id, turn_id, call_id, project_id, tool, request_hash,
        mutation_id, authority_fingerprint, provenance_version,
        allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'move_pages', ?, ?, ?, ?, '[]', '{}', 'prepared', ?, ?)
    `).run(
      identity,
      request.threadId,
      request.authority?.turnId ?? null,
      request.callId,
      request.projectId,
      requestHash,
      mutationId,
      nodexAgentCallProvenance(request)[1],
      nodexAgentCallProvenance(request)[2],
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
        ...(request.authority ? { authority: request.authority } : {}),
        ...(request.resourceAccess ? { resourceAccess: request.resourceAccess } : {}),
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
  command: NodexAgentMovePagesCommand,
): DatabaseMutationRequest | null {
  if (command.destination.kind !== "database" || !command.destination.view) return null;
  const destination = command.destination;
  const contentProjectId = destination.contentProjectId ?? command.projectId;
  const view = database.prepare(
    `
    SELECT revision, config_json
    FROM database_views
    WHERE id = ? AND database_block_id = ? AND project_id = ? AND lifecycle = 'active'
  `).get(
    command.destination.view.viewId,
    command.destination.databaseBlockId,
    contentProjectId,
  ) as { readonly revision: number; readonly config_json: string } | undefined;
  if (!view || view.revision !== command.destination.view.viewRevision) {
    throw new NodexAgentReadError(
      "conflict",
      `View ${command.destination.view.viewId} changed before Page movement`,
      false,
      "query_database_again",
    );
  }
  const orderConfig = resolveLegacyDatabaseViewOrderConfig(view.config_json);
  const groupPropertyId = orderConfig.groupPropertyId;
  const groupKey = command.destination.view.groupKey;
  if (!orderConfig.usesExplicitGroups && !groupPropertyId && groupKey !== null) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Ungrouped View ${command.destination.view.viewId} requires a null groupKey`,
      false,
      "query_database_again",
    );
  }
  const placements = command.input.pageIds.map((pageId) => {
    const row = database.prepare(
      `
      SELECT membership.id AS membership_id,
        COALESCE(position.revision, 0) AS position_revision,
        COALESCE(group_value.revision, 0) AS group_value_revision
      FROM database_memberships membership
      LEFT JOIN database_view_positions position
        ON position.view_id = ? AND position.block_id = membership.page_block_id
       AND position.project_id = membership.project_id
      LEFT JOIN database_property_values group_value
        ON group_value.membership_id = membership.id AND group_value.property_id = ?
      WHERE membership.page_block_id = ? AND membership.database_block_id = ?
        AND membership.project_id = ? AND membership.removed_at IS NULL
    `).get(
      destination.view?.viewId,
      groupPropertyId,
      pageId,
      destination.databaseBlockId,
      contentProjectId,
    ) as {
      readonly membership_id: string;
      readonly position_revision: number;
      readonly group_value_revision: number;
    } | undefined;
    if (row) return { pageId, ...row };
    throw new NodexAgentReadError(
      "conflict",
      `Page ${pageId} has no active destination Database membership`,
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
          contentProjectId,
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
            pageId: placement.pageId,
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
    projectId: contentProjectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: `nodex-agent:${command.threadId}`,
    actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
    operations: [
      ...operations,
      {
        kind: "position_pages",
        viewId: command.destination.view.viewId,
        pages: placements.map((placement) => ({
          pageId: placement.pageId,
          expectedPositionRevision: placement.position_revision,
        })),
        groupKey,
        ...(command.destination.view.beforePageId
          ? { beforePageId: command.destination.view.beforePageId }
          : {}),
      },
    ],
  };
}

function executeMovePages(
  database: Database.Database,
  command: NodexAgentMovePagesCommand,
): ExecuteNodexAgentMovePagesResult {
  const key = { ...command, tool: "move_pages" };
  const identity = nodexAgentCallIdentity(key);
  const callReceipt = readNodexAgentCallReceipt(database, identity);
  if (!callReceipt) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "No matching prepared Agent Page move exists",
      false,
      "none",
    );
  }
  requireMatchingNodexAgentCallReceipt(callReceipt, key, command.requestHash);
  if (callReceipt.status === "committed") {
    return {
      ok: true,
      value: {
        output: replayMovePagesOutput(callReceipt),
        duplicate: true,
        documentCommits: [],
        affectedDatabaseBlockIds: [],
        changeLogSeq: 0,
      },
    };
  }
  assertTransferDestinationAuthority(database, command);
  for (const pageId of command.input.pageIds) {
    assertNodexAgentResourceAuthorizationInDatabase(database, {
      authority: command.authority,
      resource: { kind: "page", pageId },
      action: "move",
      ...(command.resourceAccess
        ? { resourceAccess: command.resourceAccess }
        : {}),
      callId: command.callId,
    });
  }
  if (readBlockStoreEpoch(database) !== command.storeEpoch) {
    throw new NodexAgentReadError(
      "conflict",
      "The Nodex store changed after Page movement was prepared",
      false,
      "get_block_again",
    );
  }
  const heads = new Map<string, { readonly generation: number; readonly headSeq: number }>();
  const transferReceipts: BlockTransferReceipt[] = [];
  const databaseReceipts = [];
  for (const [index, step] of command.transfers.entries()) {
    const targetProjectId = step.targetProjectId ?? command.projectId;
    const stagingRequest = step.transfer
      ? rebaseTransferRequest(step.transfer, heads)
      : null;
    let completedRequest = stagingRequest;
    const staged = stagingRequest
      ? applyBlockTransfer(database, stagingRequest, {
          persistTopLevelGrant: !step.rehome
            && (
              !command.authority
              || command.resourceAccess?.persistResultingPageGrants === true
            ),
        })
      : null;
    if (staged && !staged.ok) {
      throw new NodexAgentReadError(
        staged.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
        staged.error.message,
        staged.error.retryable,
        staged.error.reloadRequired ? "get_block_again" : "none",
        { resourceId: step.pageId, domainCode: staged.error.code },
      );
    }
    if (staged?.ok) {
      transferReceipts.push(staged.value);
      for (const commit of staged.value.documentCommits) {
        heads.set(commit.documentId, { generation: commit.generation, headSeq: commit.headSeq });
      }
    }

    const transferred = (() => {
      if (!step.rehome) {
        if (!staged?.ok || !stagingRequest) {
          throw new NodexAgentReadError(
            "internal_error",
            `Page ${step.pageId} has no prepared transfer`,
            false,
            "none",
          );
        }
        return staged;
      }
      applyLibraryContentRehomeInTransaction(database, step.rehome);
      const rehomedBlock = readBlock(database, targetProjectId, step.pageId);
      const finalPreparation = prepareBlockTransfer(database, {
        version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
        operationId: `${command.mutationId}:page:${index}:target`,
        projectId: targetProjectId,
        storeEpoch: command.storeEpoch,
        clientSessionId: `nodex-agent:${command.threadId}`,
        actor: {
          kind: "nodex_agent",
          threadId: command.threadId,
          callId: command.callId,
        },
        mode: "move",
        rootBlockIds: [step.pageId],
        source: sourceIntent(database, targetProjectId, rehomedBlock),
        target: transferTarget(database, targetProjectId, command.destination),
      });
      if (!finalPreparation.ok) {
        throw new NodexAgentReadError(
          finalPreparation.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
          finalPreparation.error.message,
          finalPreparation.error.retryable,
          finalPreparation.error.reloadRequired ? "get_block_again" : "none",
          { resourceId: step.pageId, domainCode: finalPreparation.error.code },
        );
      }
      completedRequest = finalPreparation.value.request;
      const placed = applyBlockTransfer(database, finalPreparation.value.request, {
        persistTopLevelGrant:
          !command.authority
          || command.resourceAccess?.persistResultingPageGrants === true,
      });
      if (!placed.ok) return placed;
      transferReceipts.push(placed.value);
      for (const commit of placed.value.documentCommits) {
        heads.set(commit.documentId, { generation: commit.generation, headSeq: commit.headSeq });
      }
      return placed;
    })();
    if (!transferred.ok) {
      throw new NodexAgentReadError(
        transferred.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
        transferred.error.message,
        transferred.error.retryable,
        transferred.error.reloadRequired ? "get_block_again" : "none",
        { resourceId: step.pageId, domainCode: transferred.error.code },
      );
    }
    if (!completedRequest) {
      throw new NodexAgentReadError(
        "internal_error",
        `Page ${step.pageId} has no completed transfer request`,
        false,
        "none",
      );
    }
    const normalizedCommand: NodexAgentTransferCommand = {
      threadId: command.threadId,
      callId: command.callId,
      ...(command.authority ? { authority: command.authority } : {}),
      projectId: targetProjectId,
      requestHash: command.requestHash,
      mutationId: `${command.mutationId}:page:${index}`,
      storeEpoch: command.storeEpoch,
      input: step.normalizedInput,
      transfer: completedRequest,
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
  const output = MovePagesV3OutputSchema.parse({
    data: {
      pages: command.input.pageIds.map((pageId) => ({
        pageId,
        location: readMutatedPageLocation(database, pageId),
      })),
      moved: command.input.pageIds.length,
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

export function prepareNodexAgentMovePages(
  database: Database.Database,
  request: PrepareNodexAgentMovePagesRequest,
): PrepareNodexAgentMovePagesResult {
  try {
    return database.transaction(() => prepareMovePages(database, request)).immediate();
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
}

export function executeNodexAgentMovePages(
  database: Database.Database,
  command: NodexAgentMovePagesCommand,
): ExecuteNodexAgentMovePagesResult {
  try {
    return database.transaction(() => executeMovePages(database, command)).immediate();
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
