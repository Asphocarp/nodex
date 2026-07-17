import type Database from "better-sqlite3";
import type {
  BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import {
  portableRichTextPlainText,
  type PortableRichText,
} from "../../shared/block-documents/portable-rich-text";
import {
  assessBlockSemanticContentForPage,
  BlockSemanticContentError,
} from "../../shared/block-documents/block-semantic-content";
import { prepareBlockTransfer } from "../local-store/block-transfers";
import { applyBlockTransfer } from "../local-store/block-transfers";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { mintNodexAgentEtag } from "../local-store/nodex-agent-etag";
import { applyDatabaseModuleV2 } from "../local-store/database-module-v2-runtime";
import {
  assertCurrentNodexAgentTurnAuthorityInDatabase,
  assertNodexAgentResourceAuthorizationInDatabase,
  assertNodexAgentResourceIntentsAuthorizedInDatabase,
  authorizeNodexAgentResourceInDatabase,
  authorizeProjectResourceInDatabase,
} from "../local-store/project-resource-grants";
import {
  databaseGroupValueFromKey,
  type DatabaseJsonValue,
  parseDatabaseViewConfigV2,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyReceiptV2,
} from "../../shared/database-module-v2";
import {
  parseDataSourceId,
  parseDataSourcePropertyId,
  parseDatabaseViewId,
} from "../../shared/database-identities";
import { createUuidV7 } from "../../shared/uuid-v7";
import {
  PAGE_LIFECYCLE_V2_CONTRACT_VERSION,
  parsePageLifecycleMutationRequestV2,
} from "../../shared/page-lifecycle-v2";
import { applyPageLifecycleMutationV2 } from "../local-store/page-lifecycle-v2-store";
import {
  applyLibraryContentRehomeInTransaction,
  prepareLibraryContentRehome,
} from "../local-store/library-content-rehome";
import { DEFAULT_WORKFLOW_STATUS } from "../../shared/workflow-status";
import {
  DuplicatePageV3OutputSchema,
  MovePagesV3OutputSchema,
  BlockIdSchema,
  TransferBlocksInputSchema,
  type CreateInput,
  type ExecuteNodexAgentDuplicatePageResult,
  type ExecuteNodexAgentMovePagesResult,
  type NodexAgentDuplicatePageCommand,
  type NodexAgentMovePagesCommand,
  type NodexAgentTransferAuthorizationEvidence,
  type PrepareNodexAgentDuplicatePageRequest,
  type PrepareNodexAgentDuplicatePageResult,
  type PrepareNodexAgentMovePagesRequest,
  type PrepareNodexAgentMovePagesResult,
  type PreparedNodexAgentCreateDestination,
  type TransferBlocksInput,
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
import {
  prepareNodexAgentDataSourceDestination,
  prepareNodexAgentDestination,
} from "./create-service";
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
  databaseBlockId: string,
): {
  readonly viewId: string;
  readonly dataSourceId: string;
  readonly groupKey: null;
} {
  const row = database.prepare(
    `
    SELECT view.id, view.data_source_id AS dataSourceId
    FROM database_containers container
    INNER JOIN database_views view ON view.id = container.default_view_id
    WHERE container.block_id = ? AND view.lifecycle = 'active'
    LIMIT 1
  `).get(databaseBlockId) as
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

function prepareV5PageDestination(
  database: Database.Database,
  projectId: string,
  normalized: CreateInput["destination"],
  destination: PrepareNodexAgentDuplicatePageRequest["input"]["destination"],
  allowForeignOwner: boolean,
): PreparedNodexAgentCreateDestination {
  if (destination.kind !== "data_source") {
    return prepareNodexAgentDestination(
      database,
      projectId,
      normalized,
      allowForeignOwner,
    );
  }
  if (normalized.kind !== "database") {
    throw new Error("Data Source destination normalization is inconsistent");
  }
  return prepareNodexAgentDataSourceDestination(
    database,
    projectId,
    normalized,
    destination.dataSourceId,
    allowForeignOwner,
  );
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
  const destination = prepareV5PageDestination(
    database,
    request.projectId,
    normalizedInput.destination as CreateInput["destination"],
    request.input.destination,
    request.authority !== undefined,
  );
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Nodex store has no epoch");
  const mutationId = existing?.mutation_id ?? `nodex-duplicate-page:${identity}`;
  const pageTransfer = destination.kind === "document"
    ? prepareBlockTransfer(database, {
        version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
        operationId: `${mutationId}:page-target`,
        projectId: sourceProjectId,
        storeEpoch,
        clientSessionId: `nodex-agent:${request.threadId}`,
        actor: {
          kind: "nodex_agent",
          threadId: request.threadId,
          callId: request.callId,
        },
        mode: "copy",
        rootBlockIds: [request.input.pageId],
        source: sourceIntent(database, sourceProjectId, sourceBlock),
        target: transferTarget(database, sourceProjectId, destination),
      })
    : null;
  if (pageTransfer && !pageTransfer.ok) {
    throw new NodexAgentReadError(
      pageTransfer.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
      pageTransfer.error.message,
      pageTransfer.error.retryable,
      pageTransfer.error.reloadRequired ? "get_block_again" : "none",
      { domainCode: pageTransfer.error.code },
    );
  }
  const allocations = existing
    ? parseJsonValue(
        existing.allocations_json,
        "Agent duplicate allocation receipt",
      )
    : [];
  if (!Array.isArray(allocations) || !allocations.every((id) => typeof id === "string")) {
    throw new Error("Agent duplicate allocation receipt is invalid");
  }
  const newPageId = (allocations[0] as string | undefined) ?? createUuidV7();
  const sourceDocument = database.prepare(`
    SELECT document.id AS documentId, document.generation,
      document.head_seq AS expectedHeadSeq
    FROM pages page
    INNER JOIN documents document ON document.id = page.document_id
    WHERE page.block_id = ?
  `).get(request.input.pageId) as {
    readonly documentId: string;
    readonly generation: number;
    readonly expectedHeadSeq: number;
  } | undefined;
  if (!sourceDocument) throw new Error(`Page ${request.input.pageId} has no Document`);
  const authorization: NodexAgentTransferAuthorizationEvidence = pageTransfer?.ok
    ? transferAuthorizationEvidence(database, {
        blocks: [sourceBlock],
        transfer: pageTransfer.value.request,
        documentIds: pageTransfer.value.leaseDocuments.map(
          (lease) => lease.documentId,
        ),
      })
    : {
        roots: {
          [request.input.pageId]: { type: "page", transformation: "preserved" },
        },
        documentIds: [sourceDocument.documentId],
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
      ) VALUES (?, ?, ?, ?, ?, 'duplicate_page', ?, ?, ?, ?, ?, '{}', 'prepared', ?, ?)
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
      JSON.stringify([newPageId]),
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
        ...(pageTransfer?.ok ? { transfer: pageTransfer.value.request } : {}),
        destination,
        leaseDocuments: pageTransfer?.ok
          ? pageTransfer.value.leaseDocuments
          : [sourceDocument],
        canonical: {
          newPageId,
        },
      },
      authorization,
    },
  };
}

function duplicatePageOutput(
  database: Database.Database,
  command: NodexAgentDuplicatePageCommand,
  receipt: Pick<
    BlockTransferReceipt,
    "copiedBlockIds" | "resultRootBlockIds"
  >,
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
  if (command.transfer) {
    const targetProjectId = command.destination.contentProjectId ?? command.projectId;
    const transferred = applyBlockTransfer(database, command.transfer, {
      persistTopLevelGrant:
        !command.authority ||
        command.resourceAccess?.persistResultingPageGrants === true,
      beforeTargetDocument: (rootPageIds) => {
        const copiedPageId = rootPageIds[0];
        if (!copiedPageId) {
          throw new Error("Duplicated Page ownership handoff has no root");
        }
        const copiedOwner = database.prepare(`
          SELECT project_id AS projectId FROM blocks WHERE id = ? AND type = 'page'
        `).get(copiedPageId) as { readonly projectId: string } | undefined;
        if (!copiedOwner) {
          throw new Error(`Duplicated Page ${copiedPageId} has no compatibility owner`);
        }
        if (copiedOwner.projectId === targetProjectId) return;
        const rehome = prepareLibraryContentRehome(database, {
          operationId: `${command.mutationId}:result:rehome`,
          callIdentity: identity,
          actorProjectId: command.projectId,
          sourceProjectId: copiedOwner.projectId,
          targetProjectId,
          rootPageIds: [copiedPageId],
          storeEpoch: command.storeEpoch,
        });
        applyLibraryContentRehomeInTransaction(database, rehome);
      },
    });
    if (!transferred.ok) {
      throw new NodexAgentReadError(
        transferred.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
        transferred.error.message,
        transferred.error.retryable,
        transferred.error.reloadRequired ? "get_block_again" : "none",
        { domainCode: transferred.error.code },
      );
    }
    const output = duplicatePageOutput(database, command, transferred.value);
    database.prepare(`
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
        affectedDatabaseBlockIds: transferred.value.affectedDatabaseBlockIds,
        changeLogSeq: transferred.value.changeLogSeq,
      },
    };
  }
  if (!command.canonical) {
    throw new Error("Prepared duplicate has no v81 clone authority");
  }
  const source = database.prepare(`
    SELECT block.project_id AS projectId, materialization.title_rich_json AS titleJson,
      materialization.nfm, materialization.block_tree_json AS blockTreeJson,
      status.value_json AS statusJson
    FROM blocks block
    INNER JOIN pages page ON page.block_id = block.id
    INNER JOIN document_materializations materialization
      ON materialization.document_id = page.document_id
    LEFT JOIN data_source_page_memberships membership
      ON membership.page_block_id = block.id AND membership.removed_at IS NULL
    LEFT JOIN data_source_property_values status
      ON status.data_source_id = membership.data_source_id
     AND status.membership_id = membership.id AND status.property_id = 'status'
    WHERE block.id = ? AND block.type = 'page'
  `).get(command.input.pageId) as {
    readonly projectId: string;
    readonly titleJson: string;
    readonly nfm: string;
    readonly blockTreeJson: string;
    readonly statusJson: string | null;
  } | undefined;
  if (!source) throw new Error(`Page ${command.input.pageId} has no clone authority`);
  const stagingDataSourceId = command.destination.kind === "database"
    ? command.destination.dataSourceId
    : (database.prepare(`
        SELECT source.id
        FROM project_database_bindings binding
        INNER JOIN data_sources source
          ON source.home_database_block_id = binding.database_block_id
         AND source.library_id = binding.library_id
         AND source.lifecycle = 'active'
        WHERE binding.project_id = ? AND binding.lifecycle = 'active'
        ORDER BY source.rank_key, source.id LIMIT 1
      `).get(command.destination.contentProjectId ?? source.projectId) as
        | { readonly id: string }
        | undefined)?.id;
  if (!stagingDataSourceId) throw new Error("Duplicate staging Data Source is unavailable");
  const tags = database.prepare(`
    SELECT schema_revision AS revision FROM data_source_properties
    WHERE data_source_id = ? AND id = 'tags' AND lifecycle = 'active'
  `).get(stagingDataSourceId) as { readonly revision: number } | undefined;
  if (!tags) throw new Error("Duplicate staging tags Property is unavailable");
  const sourceRichTitle = parseJsonValue(
    source.titleJson,
    "Source Page title",
  ) as unknown as PortableRichText;
  const lifecycle = applyPageLifecycleMutationV2(database,
    parsePageLifecycleMutationRequestV2({
      version: PAGE_LIFECYCLE_V2_CONTRACT_VERSION,
      operationId: `${command.mutationId}:clone:v2`,
      projectId: command.destination.contentProjectId ?? source.projectId,
      storeEpoch: command.storeEpoch,
      clientSessionId: `nodex-agent:${command.threadId}`,
      actor: {
        kind: "nodex_agent",
        threadId: command.threadId,
        callId: command.callId,
      },
      operation: {
        kind: "create_page",
        pageId: command.canonical.newPageId,
        title: portableRichTextPlainText(sourceRichTitle),
        richTitle: sourceRichTitle,
        nfm: source.nfm,
        status: source.statusJson
          ? JSON.parse(source.statusJson)
          : DEFAULT_WORKFLOW_STATUS,
        priority: null,
        estimate: null,
        tagOptionIds: [],
        newTagOptions: [],
        expectedTagsPropertyRevision: tags.revision,
        dueDate: null,
        scheduledStart: null,
        scheduledEnd: null,
        isAllDay: false,
        recurrence: null,
        reminders: [],
        scheduleTimezone: null,
        assignee: null,
        runInTarget: "localProject",
        runInLocalPath: null,
        runInBaseBranch: null,
        runInWorktreePath: null,
        runInEnvironmentPath: null,
        dataSourceId: stagingDataSourceId,
      },
    }), {
      allocateMembershipId: createUuidV7,
    });
  if (!lifecycle.ok) {
    throw new NodexAgentReadError(
      lifecycle.error.code.includes("conflict") ? "conflict" : "invalid_arguments",
      lifecycle.error.message,
      lifecycle.error.retryable,
      "query_database_again",
      { domainCode: lifecycle.error.code },
    );
  }
  const sourceBlocks = parseJsonValue(source.blockTreeJson, "Source Page Block tree");
  if (!Array.isArray(sourceBlocks)) throw new Error("Source Page Block tree is invalid");
  const sourceBlockIds = flattenBlocks(
    sourceBlocks as unknown as readonly BlockTreeNode[],
  ).map((block) => block.id);
  const blockIdMap = {
    [command.input.pageId]: lifecycle.value.pageId,
    ...Object.fromEntries(sourceBlockIds.map((id, index) => [
      id,
      lifecycle.value.createdBlockIds[index] as string,
    ])),
  };
  const cloned = {
    pageId: lifecycle.value.pageId,
    blockIdMap,
    databaseBlockId: lifecycle.value.databaseId as string,
    changeLogSeq: lifecycle.value.changeLogSeq,
  };
  const databaseReceipts: DatabaseApplyReceiptV2[] = [];
  const target = command.destination.kind === "database"
    ? { kind: "data_source" as const, dataSourceId: parseDataSourceId(command.destination.dataSourceId) }
    : command.destination.kind === "space"
      ? {
          kind: "library" as const,
          libraryId: (database.prepare(
            "SELECT library_id AS libraryId FROM pages WHERE block_id = ?",
          ).get(cloned.pageId) as { readonly libraryId: string }).libraryId,
        }
      : {
          kind: "page" as const,
          pageId: (database.prepare(
            "SELECT block_id AS pageId FROM pages WHERE document_id = ?",
          ).get(command.destination.documentId) as { readonly pageId: string }).pageId,
        };
  const clonedParent = database.prepare(`
    SELECT page.parent_kind AS parentKind, page.parent_id AS parentId,
      page.parent_revision AS parentRevision, membership.revision AS membershipRevision
    FROM pages page
    INNER JOIN data_source_page_memberships membership
      ON membership.page_block_id = page.block_id AND membership.removed_at IS NULL
    WHERE page.block_id = ?
  `).get(cloned.pageId) as {
    readonly parentKind: string;
    readonly parentId: string;
    readonly parentRevision: number;
    readonly membershipRevision: number;
  };
  const alreadyAtTarget = target.kind === "data_source"
    && clonedParent.parentKind === "data_source"
    && clonedParent.parentId === target.dataSourceId;
  if (!alreadyAtTarget) {
    const moved = applyDatabaseModuleV2(database, {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: `${command.mutationId}:destination:v2`,
      projectId: command.destination.contentProjectId ?? command.projectId,
      storeEpoch: command.storeEpoch,
      actor: {
        kind: "nodex_agent",
        threadId: command.threadId,
        callId: command.callId,
      },
      operations: [{
        kind: "transfer_page",
        pageId: cloned.pageId,
        expectedParentRevision: clonedParent.parentRevision,
        expectedActiveMembershipRevision: clonedParent.membershipRevision,
        target,
      }],
    });
    if (!moved.ok) {
      throw new NodexAgentReadError(
        moved.error.code.includes("conflict") ? "conflict" : "invalid_arguments",
        moved.error.message,
        moved.error.retryable,
        "query_database_again",
        { domainCode: moved.error.code },
      );
    }
    databaseReceipts.push(moved.value);
  }
  if (
    command.destination.kind === "database" &&
    command.input.destination.kind === "data_source" &&
    command.input.destination.values?.length
  ) {
    const destination = command.destination;
    const membership = database.prepare(`
      SELECT id FROM data_source_page_memberships
      WHERE data_source_id = ? AND page_block_id = ? AND removed_at IS NULL
    `).get(destination.dataSourceId, cloned.pageId) as { readonly id: string };
    const values = command.input.destination.values.map((draft) => {
      const current = database.prepare(`
        SELECT revision FROM data_source_property_values
        WHERE data_source_id = ? AND membership_id = ? AND property_id = ?
      `).get(destination.dataSourceId, membership.id, draft.propertyId) as
        | { readonly revision: number }
        | undefined;
      return {
        pageId: cloned.pageId,
        dataSourceId: parseDataSourceId(destination.dataSourceId),
        propertyId: parseDataSourcePropertyId(draft.propertyId),
        expectedValueRevision: current?.revision ?? 0,
        value: draft.value as DatabaseJsonValue,
      };
    });
    const setValues = applyDatabaseModuleV2(database, {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: `${command.mutationId}:values:v2`,
      projectId: command.destination.contentProjectId ?? command.projectId,
      storeEpoch: command.storeEpoch,
      actor: {
        kind: "nodex_agent",
        threadId: command.threadId,
        callId: command.callId,
      },
      operations: [{ kind: "set_values", values }],
    });
    if (!setValues.ok) {
      throw new NodexAgentReadError(
        setValues.error.code.includes("conflict") ? "conflict" : "invalid_arguments",
        setValues.error.message,
        setValues.error.retryable,
        "query_database_again",
        { domainCode: setValues.error.code },
      );
    }
    databaseReceipts.push(setValues.value);
  }
  if (command.destination.kind === "database" && command.destination.view) {
    const position = database.prepare(`
      SELECT revision FROM database_view_page_positions
      WHERE view_id = ? AND page_block_id = ?
    `).get(command.destination.view.viewId, cloned.pageId) as
      | { readonly revision: number }
      | undefined;
    const placed = applyDatabaseModuleV2(database, {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: `${command.mutationId}:view:v2`,
      projectId: command.destination.contentProjectId ?? command.projectId,
      storeEpoch: command.storeEpoch,
      actor: {
        kind: "nodex_agent",
        threadId: command.threadId,
        callId: command.callId,
      },
      operations: [{
        kind: "position_page",
        viewId: parseDatabaseViewId(command.destination.view.viewId),
        pageId: cloned.pageId,
        expectedPositionRevision: position?.revision ?? 0,
        groupKey: command.destination.view.groupKey,
        ...(command.destination.view.beforePageId
          ? { beforePageId: command.destination.view.beforePageId }
          : {}),
      }],
    });
    if (!placed.ok) {
      throw new NodexAgentReadError(
        placed.error.code.includes("conflict") ? "conflict" : "invalid_arguments",
        placed.error.message,
        placed.error.retryable,
        "query_database_again",
        { domainCode: placed.error.code },
      );
    }
    databaseReceipts.push(placed.value);
  }
  const syntheticReceipt = {
    copiedBlockIds: cloned.blockIdMap,
    resultRootBlockIds: [cloned.pageId],
  };
  const output = duplicatePageOutput(database, command, syntheticReceipt);
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
      documentCommits: [],
      affectedDatabaseBlockIds: [...new Set([
        cloned.databaseBlockId,
        ...databaseReceipts.flatMap((receipt) => receipt.affectedDatabaseIds),
      ])].sort((left, right) => left.localeCompare(right)),
      changeLogSeq: Math.max(
        cloned.changeLogSeq,
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
    from: source.location_kind === "space"
      ? { kind: "space" }
      : source.location_kind === "document" && source.containing_document_id
        ? {
            kind: "document",
            documentId: source.containing_document_id,
            ...(source.parent_block_id
              ? { parentBlockId: source.parent_block_id }
              : {}),
          }
        : source.location_kind === "database" && source.containing_database_id
          ? {
              kind: "database",
              databaseBlockId: source.containing_database_id,
            }
          : (() => {
              throw new Error(`Page ${source.id} has inconsistent location authority`);
            })(),
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
  const destination = prepareV5PageDestination(
    database,
    request.projectId,
    normalizedInputs[0]?.destination as CreateInput["destination"],
    request.input.destination,
    request.authority !== undefined,
  );
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Nodex store has no epoch");
  const mutationId = existing?.mutation_id ?? `nodex-move-pages:${identity}`;
  const transfers = [];
  const leases = [];
  const rehomeClosureOwners = new Map<string, string>();
  for (const [index, block] of blocks.entries()) {
    const normalizedInput = normalizedInputs[index] as TransferBlocksInput;
    const targetProjectId = destination.contentProjectId ?? block.project_id;
    const rehome = targetProjectId === block.project_id
      ? undefined
      : prepareLibraryContentRehome(database, {
          operationId: `${mutationId}:page:${index}:rehome`,
          callIdentity: identity,
          actorProjectId: request.projectId,
          sourceProjectId: block.project_id,
          targetProjectId,
          rootPageIds: [block.id],
          storeEpoch,
        });
    for (const blockId of rehome?.blockIds ?? []) {
      const priorRoot = rehomeClosureOwners.get(blockId);
      if (priorRoot && priorRoot !== block.id) {
        throw new NodexAgentReadError(
          "invalid_arguments",
          "Cross-owner Page moves cannot select both an ownership ancestor and its descendant",
          false,
          "none",
        );
      }
      rehomeClosureOwners.set(blockId, block.id);
    }
    if (destination.kind === "document") {
      const preparation = prepareBlockTransfer(database, {
        version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
        operationId: `${mutationId}:page:${index}`,
        projectId: block.project_id,
        storeEpoch,
        clientSessionId: `nodex-agent:${request.threadId}`,
        actor: {
          kind: "nodex_agent",
          threadId: request.threadId,
          callId: request.callId,
        },
        mode: "move",
        rootBlockIds: [block.id],
        source: sourceIntent(database, block.project_id, block),
        target: transferTarget(database, block.project_id, destination),
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
      transfers.push({
        pageId: block.id,
        sourceProjectId: block.project_id,
        targetProjectId,
        normalizedInput,
        transfer: preparation.value.request,
        ...(rehome ? { rehome } : {}),
      });
      leases.push(...preparation.value.leaseDocuments);
      continue;
    }
    const authority = database.prepare(`
      SELECT page.parent_revision AS parentRevision,
        page.parent_kind AS parentKind, page.parent_id AS parentId,
        COALESCE(membership.revision, 0) AS membershipRevision,
        document.id AS documentId, document.generation,
        document.head_seq AS expectedHeadSeq
      FROM pages page
      INNER JOIN documents document ON document.id = page.document_id
      LEFT JOIN data_source_page_memberships membership
        ON membership.page_block_id = page.block_id AND membership.removed_at IS NULL
      WHERE page.block_id = ?
    `).get(block.id) as {
      readonly parentRevision: number;
      readonly parentKind: string;
      readonly parentId: string;
      readonly membershipRevision: number;
      readonly documentId: string;
      readonly generation: number;
      readonly expectedHeadSeq: number;
    } | undefined;
    if (!authority) {
      throw new NodexAgentReadError(
        "projection_not_ready",
        `Page ${block.id} has no canonical move authority`,
        true,
        "get_block_again",
      );
    }
    if (
      destination.kind === "database" &&
      authority.parentKind === "data_source" &&
      authority.parentId === destination.dataSourceId
    ) {
      if (
        request.input.destination.kind === "data_source" &&
        request.input.destination.values?.length
      ) {
        throw new NodexAgentReadError(
          "invalid_arguments",
          "Moving within one Data Source cannot change independent property values",
          false,
          "none",
        );
      }
      continue;
    }
    transfers.push({
      pageId: block.id,
      sourceProjectId: block.project_id,
      targetProjectId,
      normalizedInput,
      transfer: null,
      ...(rehome ? { rehome } : {}),
      canonical: {
        expectedParentRevision: authority.parentRevision,
        expectedActiveMembershipRevision: authority.membershipRevision,
      },
    });
    leases.push({
      documentId: authority.documentId,
      generation: authority.generation,
      expectedHeadSeq: authority.expectedHeadSeq,
    });
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
  const databaseReceipts: DatabaseApplyReceiptV2[] = [];
  const transferReceipts: BlockTransferReceipt[] = [];
  const documentHeads = new Map<
    string,
    { readonly generation: number; readonly headSeq: number }
  >();
  const project = database.prepare(
    "SELECT library_id AS libraryId FROM projects WHERE id = ?",
  ).get(command.projectId) as { readonly libraryId: string } | undefined;
  if (!project) throw new Error(`Project ${command.projectId} has no Library`);
  const targetPageId = command.destination.kind === "document"
    ? (database.prepare(
        "SELECT block_id AS pageId FROM pages WHERE document_id = ?",
      ).get(command.destination.documentId) as { readonly pageId: string } | undefined)
      ?.pageId
    : undefined;
  if (command.destination.kind === "document" && !targetPageId) {
    throw new NodexAgentReadError(
      "not_found",
      "Destination Page is unavailable",
      false,
      "get_block_again",
    );
  }
  for (const [index, step] of command.transfers.entries()) {
    if (step.transfer) {
      const rehome = step.rehome;
      const target = step.transfer.target.kind === "document"
        && documentHeads.has(step.transfer.target.documentId)
        ? {
            ...step.transfer.target,
            generation: documentHeads.get(step.transfer.target.documentId)
              ?.generation as number,
            expectedHeadSeq: documentHeads.get(step.transfer.target.documentId)
              ?.headSeq as number,
          }
        : step.transfer.target;
      const transferred = applyBlockTransfer(database, {
        ...step.transfer,
        target,
      }, {
        persistTopLevelGrant:
          !command.authority ||
          command.resourceAccess?.persistResultingPageGrants === true,
        ...(rehome
          ? {
              beforeTargetDocument: (rootPageIds: readonly string[]) => {
                if (
                  rootPageIds.length !== 1 ||
                  rootPageIds[0] !== step.pageId
                ) {
                  throw new Error(
                    `Page ${step.pageId} ownership handoff received divergent roots`,
                  );
                }
                applyLibraryContentRehomeInTransaction(database, rehome);
              },
            }
          : {}),
      });
      if (!transferred.ok) {
        throw new NodexAgentReadError(
          transferred.error.code.includes("mismatch") ? "conflict" : "invalid_arguments",
          transferred.error.message,
          transferred.error.retryable,
          transferred.error.reloadRequired ? "get_block_again" : "none",
          { resourceId: step.pageId, domainCode: transferred.error.code },
        );
      }
      transferReceipts.push(transferred.value);
      for (const commit of transferred.value.documentCommits) {
        documentHeads.set(commit.documentId, {
          generation: commit.generation,
          headSeq: commit.headSeq,
        });
      }
      continue;
    }
    if (!step.canonical) {
      throw new Error(`Page ${step.pageId} has no frozen v81 transfer authority`);
    }
    const current = database.prepare(`
      SELECT parent_kind AS parentKind, parent_id AS parentId
      FROM pages WHERE block_id = ?
    `).get(step.pageId) as { readonly parentKind: string; readonly parentId: string };
    const alreadyAtTarget = command.destination.kind === "database"
      ? current.parentKind === "data_source"
        && current.parentId === command.destination.dataSourceId
      : command.destination.kind === "space"
        ? current.parentKind === "library" && current.parentId === project.libraryId
        : current.parentKind === "page" && current.parentId === targetPageId;
    if (!alreadyAtTarget) {
      const transfer = applyDatabaseModuleV2(database, {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        operationId: `${command.mutationId}:page:${index}:transfer:v2`,
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        actor: {
          kind: "nodex_agent",
          threadId: command.threadId,
          callId: command.callId,
        },
        operations: [{
          kind: "transfer_page",
          pageId: step.pageId,
          expectedParentRevision: step.canonical.expectedParentRevision,
          expectedActiveMembershipRevision:
            step.canonical.expectedActiveMembershipRevision,
          target: command.destination.kind === "database"
            ? {
                kind: "data_source",
                dataSourceId: parseDataSourceId(command.destination.dataSourceId),
              }
            : command.destination.kind === "space"
              ? { kind: "library", libraryId: project.libraryId }
              : { kind: "page", pageId: targetPageId as string },
        }],
      });
      if (!transfer.ok) {
        throw new NodexAgentReadError(
          transfer.error.code.includes("conflict") ? "conflict" : "invalid_arguments",
          transfer.error.message,
          transfer.error.retryable,
          "query_database_again",
          { resourceId: step.pageId, domainCode: transfer.error.code },
        );
      }
      databaseReceipts.push(transfer.value);
    }
    if (step.rehome) {
      applyLibraryContentRehomeInTransaction(database, step.rehome);
    }
    if (
      command.destination.kind === "database" &&
      command.input.destination.kind === "data_source" &&
      command.input.destination.values?.length
    ) {
      const destination = command.destination;
      const membership = database.prepare(`
        SELECT id FROM data_source_page_memberships
        WHERE data_source_id = ? AND page_block_id = ? AND removed_at IS NULL
      `).get(destination.dataSourceId, step.pageId) as { readonly id: string };
      const values = command.input.destination.values.map((draft) => {
        const value = database.prepare(`
          SELECT revision FROM data_source_property_values
          WHERE data_source_id = ? AND membership_id = ? AND property_id = ?
        `).get(destination.dataSourceId, membership.id, draft.propertyId) as
          | { readonly revision: number }
          | undefined;
        return {
          pageId: step.pageId,
          dataSourceId: parseDataSourceId(destination.dataSourceId),
          propertyId: parseDataSourcePropertyId(draft.propertyId),
          expectedValueRevision: value?.revision ?? 0,
          value: draft.value as DatabaseJsonValue,
        };
      });
      const setValues = applyDatabaseModuleV2(database, {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        operationId: `${command.mutationId}:page:${index}:values:v2`,
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        actor: {
          kind: "nodex_agent",
          threadId: command.threadId,
          callId: command.callId,
        },
        operations: [{ kind: "set_values", values }],
      });
      if (!setValues.ok) {
        throw new NodexAgentReadError(
          setValues.error.code.includes("conflict") ? "conflict" : "invalid_arguments",
          setValues.error.message,
          setValues.error.retryable,
          "query_database_again",
          { resourceId: step.pageId, domainCode: setValues.error.code },
        );
      }
      databaseReceipts.push(setValues.value);
    }
  }
  if (command.destination.kind === "database" && command.destination.view) {
    const destination = command.destination;
    const destinationView = command.destination.view;
    const view = database.prepare(`
      SELECT config_json AS configJson FROM database_views
      WHERE id = ? AND data_source_id = ? AND lifecycle = 'active'
    `).get(destinationView.viewId, destination.dataSourceId) as
      | { readonly configJson: string }
      | undefined;
    if (!view) throw new Error(`View ${destinationView.viewId} is unavailable`);
    const groupPropertyId = parseDatabaseViewConfigV2(
      JSON.parse(view.configJson) as unknown,
    ).group?.propertyId;
    if (groupPropertyId) {
      const property = database.prepare(`
        SELECT value_type AS valueType FROM data_source_properties
        WHERE data_source_id = ? AND id = ? AND lifecycle = 'active'
      `).get(destination.dataSourceId, groupPropertyId) as
        | { readonly valueType: DatabasePropertyValueType }
        | undefined;
      if (!property) throw new Error(`Grouped Property ${groupPropertyId} is unavailable`);
      const values = command.input.pageIds.map((pageId) => {
        const row = database.prepare(`
          SELECT value.revision
          FROM data_source_page_memberships membership
          LEFT JOIN data_source_property_values value
            ON value.data_source_id = membership.data_source_id
           AND value.membership_id = membership.id AND value.property_id = ?
          WHERE membership.data_source_id = ? AND membership.page_block_id = ?
            AND membership.removed_at IS NULL
        `).get(groupPropertyId, destination.dataSourceId, pageId) as
          | { readonly revision: number | null }
          | undefined;
        if (!row) throw new Error(`Page ${pageId} has no destination membership`);
        return {
          pageId,
          dataSourceId: parseDataSourceId(destination.dataSourceId),
          propertyId: parseDataSourcePropertyId(groupPropertyId),
          expectedValueRevision: row.revision ?? 0,
          value: databaseGroupValueFromKey(
            property.valueType,
            destinationView.groupKey,
          ),
        };
      });
      const grouped = applyDatabaseModuleV2(database, {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        operationId: `${command.mutationId}:final-view-group:v2`,
        projectId: command.projectId,
        storeEpoch: command.storeEpoch,
        actor: {
          kind: "nodex_agent",
          threadId: command.threadId,
          callId: command.callId,
        },
        operations: [{ kind: "set_values", values }],
      });
      if (!grouped.ok) {
        throw new NodexAgentReadError(
          grouped.error.code.includes("conflict") ? "conflict" : "invalid_arguments",
          grouped.error.message,
          grouped.error.retryable,
          "query_database_again",
          { domainCode: grouped.error.code },
        );
      }
      databaseReceipts.push(grouped.value);
    }
    const pages = command.input.pageIds.map((pageId) => {
      const position = database.prepare(`
        SELECT revision FROM database_view_page_positions
        WHERE view_id = ? AND page_block_id = ?
      `).get(destinationView.viewId, pageId) as
        | { readonly revision: number }
        | undefined;
      return { pageId, expectedPositionRevision: position?.revision ?? 0 };
    });
    const result = applyDatabaseModuleV2(database, {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: `${command.mutationId}:final-view-placement:v2`,
      projectId: command.projectId,
      storeEpoch: command.storeEpoch,
      actor: {
        kind: "nodex_agent",
        threadId: command.threadId,
        callId: command.callId,
      },
      operations: [{
        kind: "position_pages",
        viewId: parseDatabaseViewId(destinationView.viewId),
        pages,
        groupKey: destinationView.groupKey,
        ...(destinationView.beforePageId
          ? { beforePageId: destinationView.beforePageId }
          : {}),
      }],
    });
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
  return {
    ok: true,
    value: {
      output,
      duplicate: false,
      documentCommits: transferReceipts.flatMap(
        (receipt) => receipt.documentCommits,
      ),
      affectedDatabaseBlockIds: [...new Set([
        ...transferReceipts.flatMap((receipt) => receipt.affectedDatabaseBlockIds),
        ...databaseReceipts.flatMap((receipt) => receipt.affectedDatabaseIds),
      ])].sort((left, right) => left.localeCompare(right)),
      changeLogSeq: Math.max(
        0,
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
