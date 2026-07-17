import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { blockNoteToNfm } from "../../shared/block-documents/nfm-blocknote-adapter";
import type { BlockTreeNode } from "../../shared/block-documents/block-document-codec";
import { canonicalizePortableRichText } from "../../shared/block-documents/portable-rich-text";
import { extractPlainText } from "../../shared/nfm/extract-text";
import { serializeNfm } from "../../shared/nfm/serializer";
import {
  GetBlockOutputSchema,
  type GetBlockInput,
  type GetBlockOutput,
  type JsonValue,
} from "../../shared/nodex-agent-tools";
import { mintNodexAgentEtag } from "../local-store/nodex-agent-etag";
import {
  assertResponseSize,
  mintCursor,
  NodexAgentReadError,
  nodexAgentFingerprint,
  parseJsonValue,
  readCursorState,
  requireProject,
  toBlockLocation,
} from "./read-support";
import {
  databaseValueEtagState,
  documentBlockEtagState,
  documentBodyEtagState,
  documentSubtreeEtagState,
  titleEtagState,
} from "./semantic-guards";

interface BlockRow {
  readonly id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
  readonly location_revision: number;
  readonly parent_block_id: string | null;
  readonly owned_document_id: string | null;
  readonly containing_owner_block_id: string | null;
}

interface DocumentRow {
  readonly id: string;
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
  readonly preview: string | null;
  readonly block_tree_json: string | null;
}

interface DatabaseValueRow {
  readonly membership_id: string;
  readonly membership_revision: number;
  readonly database_block_id: string;
  readonly property_id: string;
  readonly property_schema_revision: number;
  readonly value_json: string;
  readonly value_revision: number;
}

interface FoundNode {
  readonly node: BlockTreeNode;
  readonly parentBlockId: string | null;
  readonly siblingIndex: number;
}

function readBlockRow(
  database: Database.Database,
  projectId: string,
  blockId: string,
): BlockRow | null {
  return (database.prepare(
    `
    SELECT
      block.id, block.type, block.lifecycle, block.location_kind,
      block.containing_document_id, block.containing_database_id,
      block.location_revision, block_index.parent_block_id,
      owned.document_id AS owned_document_id,
      containing_owner.block_id AS containing_owner_block_id
    FROM blocks block
    LEFT JOIN document_block_index block_index
      ON block_index.block_id = block.id
     AND block_index.document_id = block.containing_document_id
    LEFT JOIN block_documents owned
      ON owned.block_id = block.id
     AND owned.project_id = block.project_id
    LEFT JOIN block_documents containing_owner
      ON containing_owner.document_id = block.containing_document_id
     AND containing_owner.project_id = block.project_id
    WHERE block.id = ? AND block.project_id = ?
    LIMIT 1
  `).get(blockId, projectId) as BlockRow | undefined) ?? null;
}

function readDocumentRow(
  database: Database.Database,
  projectId: string,
  documentId: string,
): DocumentRow | null {
  return (database.prepare(
    `
    SELECT
      document.id, ownership.block_id AS owner_block_id,
      document.generation, document.head_seq, document.schema_key,
      document.schema_version, document.readiness,
      materialization.generation AS materialization_generation,
      materialization.projected_seq,
      materialization.schema_version AS materialization_schema_version,
      materialization.title, materialization.title_rich_json,
      materialization.nfm, materialization.preview,
      materialization.block_tree_json
    FROM documents document
    INNER JOIN block_documents ownership
      ON ownership.document_id = document.id
     AND ownership.project_id = document.project_id
    LEFT JOIN document_materializations materialization
      ON materialization.document_id = document.id
    WHERE document.id = ? AND document.project_id = ?
    LIMIT 1
  `).get(documentId, projectId) as DocumentRow | undefined) ?? null;
}

function requireExactMaterialization(row: DocumentRow): void {
  if (
    row.readiness === "ready"
    && row.materialization_generation === row.generation
    && row.projected_seq === row.head_seq
    && row.materialization_schema_version === row.schema_version
    && row.nfm !== null
    && row.block_tree_json !== null
  ) {
    return;
  }
  throw new NodexAgentReadError(
    "projection_not_ready",
    `Document ${row.id} does not have an exact current materialization`,
    true,
    "get_block_again",
    { resourceId: row.id, domainCode: row.readiness },
  );
}

function parseBlockTree(row: DocumentRow): readonly BlockTreeNode[] {
  const parsed = parseJsonValue(row.block_tree_json as string, `Document ${row.id} Block tree`);
  if (Array.isArray(parsed)) return parsed as unknown as readonly BlockTreeNode[];
  throw new NodexAgentReadError(
    "internal_error",
    `Document ${row.id} Block tree is not an array`,
    false,
    "none",
    { resourceId: row.id, domainCode: "corrupt_block_tree" },
  );
}

function findNode(
  nodes: readonly BlockTreeNode[],
  blockId: string,
  parentBlockId: string | null = null,
): FoundNode | null {
  for (const [siblingIndex, node] of nodes.entries()) {
    if (node.id === blockId) return { node, parentBlockId, siblingIndex };
    const nested = findNode(node.children, blockId, node.id);
    if (nested) return nested;
  }
  return null;
}

function flattenNodes(
  nodes: readonly BlockTreeNode[],
  maxDepth: number,
  parentBlockId: string | null = null,
  depth = 0,
  rootSiblingIndex?: number,
): Array<{
  readonly blockId: string;
  readonly parentBlockId: string | null;
  readonly siblingIndex: number;
  readonly depth: number;
  readonly type: string;
  readonly props: Readonly<Record<string, JsonValue>>;
  readonly content?: JsonValue;
}> {
  if (depth > maxDepth) return [];
  return nodes.flatMap((node, siblingIndex) => [{
    blockId: node.id,
    parentBlockId,
    siblingIndex: rootSiblingIndex ?? siblingIndex,
    depth,
    type: node.type,
    props: node.props as Readonly<Record<string, JsonValue>>,
    ...(node.content !== undefined ? { content: node.content as JsonValue } : {}),
  }, ...flattenNodes(node.children, maxDepth, node.id, depth + 1)]);
}

function readDatabaseValues(
  database: Database.Database,
  projectId: string,
  blockId: string,
  propertyIds: readonly string[] | undefined,
): readonly DatabaseValueRow[] {
  const rows = database.prepare(
    `
    SELECT
      membership.id AS membership_id,
      membership.revision AS membership_revision,
      source.home_database_block_id AS database_block_id,
      property.id AS property_id,
      property.schema_revision AS property_schema_revision,
      COALESCE(value.value_json, 'null') AS value_json,
      COALESCE(value.revision, 0) AS value_revision
    FROM data_source_page_memberships membership
    INNER JOIN data_sources source
      ON source.id = membership.data_source_id
    INNER JOIN blocks page
      ON page.id = membership.page_block_id
     AND page.project_id = ?
    INNER JOIN data_source_properties property
      ON property.data_source_id = membership.data_source_id
     AND property.lifecycle = 'active'
    LEFT JOIN data_source_property_values value
      ON value.membership_id = membership.id
     AND value.property_id = property.id
     AND value.data_source_id = membership.data_source_id
    WHERE membership.page_block_id = ?
      AND membership.removed_at IS NULL
    ORDER BY property.rank_key, property.id
  `).all(projectId, blockId) as readonly DatabaseValueRow[];
  if (!propertyIds) return rows;
  const byPropertyId = new Map(rows.map((row) => [row.property_id, row] as const));
  const missing = propertyIds.find((propertyId) => !byPropertyId.has(propertyId));
  if (missing) {
    throw new NodexAgentReadError(
      "not_found",
      `Database property ${missing} was not found for Block ${blockId}`,
      false,
      "query_database_again",
      { resourceId: missing, domainCode: "database_value_not_found" },
    );
  }
  return propertyIds.map((propertyId) => byPropertyId.get(propertyId) as DatabaseValueRow);
}

function hasDatabaseCapability(
  database: Database.Database,
  blockId: string,
): boolean {
  const row = database.prepare(
    `
    SELECT 1
    FROM database_containers container
    INNER JOIN blocks block
      ON block.id = container.block_id
     AND block.type = 'database'
     AND block.lifecycle <> 'deleted'
    WHERE container.block_id = ?
    LIMIT 1
  `).get(blockId);
  return row !== undefined;
}

type BlockGuardKind = "block.update" | "block.delete";

function requestedBlockGuards(request: GetBlockInput): ReadonlyMap<string, BlockGuardKind> {
  const guards = new Map<string, BlockGuardKind>();
  for (const preparation of request.prepareFor ?? []) {
    if (preparation.kind !== "block.update" && preparation.kind !== "block.delete") continue;
    for (const blockId of preparation.blockIds) {
      const existing = guards.get(blockId);
      if (!existing || existing === preparation.kind) {
        guards.set(blockId, preparation.kind);
        continue;
      }
      throw new NodexAgentReadError(
        "invalid_arguments",
        `Block ${blockId} cannot be prepared for update and deletion in one read`,
        false,
        "none",
        { resourceId: blockId, domainCode: "ambiguous_block_preparation" },
      );
    }
  }
  return guards;
}

function preparedValuePropertyIds(request: GetBlockInput): ReadonlySet<string> {
  return new Set(
    (request.prepareFor ?? []).flatMap((preparation) =>
      preparation.kind === "value.set" ? preparation.propertyIds : []),
  );
}

function documentBody(
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly request: GetBlockInput;
    readonly block: BlockRow;
    readonly document: DocumentRow;
  },
): { readonly body: unknown; readonly page?: unknown } | null {
  const requested = input.request.include === undefined
    ? { format: "nfm" as const }
    : input.request.include.document;
  const blockGuards = requestedBlockGuards(input.request);
  const preparesBody = input.request.prepareFor?.some(
    (preparation) => preparation.kind === "document.replace",
  ) === true;
  if (!requested && (preparesBody || blockGuards.size > 0)) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "Document preparation requires a matching document representation",
      false,
      "none",
      { resourceId: input.block.id, domainCode: "document_representation_required" },
    );
  }
  if (!requested) return null;
  if (requested.format !== "blocks" && input.request.page) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "Pagination is supported only for the blocks document representation",
      false,
      "none",
    );
  }

  const roots = parseBlockTree(input.document);
  const ownsSelectedDocument = input.document.owner_block_id === input.block.id;
  const found = ownsSelectedDocument ? null : findNode(roots, input.block.id);
  if (!ownsSelectedDocument && !found) {
    throw new NodexAgentReadError(
      "projection_not_ready",
      `Block ${input.block.id} is missing from its current Document projection`,
      true,
      "get_block_again",
      { resourceId: input.block.id, domainCode: "block_index_projection_mismatch" },
    );
  }
  const scope = requested.scope ?? (ownsSelectedDocument ? "owner" : "subtree");
  const selectedRoots = scope === "owner" || ownsSelectedDocument
    ? roots
    : [found?.node as BlockTreeNode];
  const selectedNfm = scope === "owner" || ownsSelectedDocument
    ? input.document.nfm as string
    : serializeNfm(blockNoteToNfm(selectedRoots));

  if (preparesBody && (requested.format !== "nfm" || scope !== "owner")) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "Document replacement preparation requires the complete owner NFM representation",
      false,
      "none",
      { resourceId: input.document.id, domainCode: "document_body_not_returned" },
    );
  }
  if (blockGuards.size > 0 && requested.format !== "blocks") {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "Block update or deletion preparation requires the blocks representation",
      false,
      "none",
      { resourceId: input.document.id, domainCode: "block_representation_required" },
    );
  }

  if (requested.format === "summary") {
    return { body: { format: "summary", text: extractPlainText(selectedNfm, 4_096) } };
  }
  if (requested.format === "nfm") {
    return {
      body: {
        format: "nfm",
        content: selectedNfm,
        contentHash: createHash("sha256").update(selectedNfm).digest("hex"),
        ...(preparesBody ? {
          etag: mintNodexAgentEtag(database, documentBodyEtagState({
            projectId: input.projectId,
            documentId: input.document.id,
            nfm: selectedNfm,
          })),
        } : {}),
      },
    };
  }

  const maxDepth = requested.maxDepth ?? 512;
  const records = scope === "owner" || ownsSelectedDocument
    ? flattenNodes(selectedRoots, maxDepth)
    : flattenNodes(
      selectedRoots,
      maxDepth,
      found?.parentBlockId ?? null,
      0,
      found?.siblingIndex,
    );
  const limit = input.request.page?.limit ?? 40;
  const fingerprint = nodexAgentFingerprint({
    blockId: input.block.id,
    documentId: input.document.id,
    format: "blocks",
    scope,
    maxDepth,
  });
  const cursorState = {
    fingerprint,
    generation: input.document.generation,
    headSeq: input.document.head_seq,
  };
  const { offset } = readCursorState(database, {
    token: input.request.page?.cursor,
    projectId: input.projectId,
    subject: ["get_block", input.block.id],
    expected: cursorState,
    recovery: "get_block_again",
  });
  const pageRecords = records.slice(offset, offset + limit);
  const pageIds = new Set(pageRecords.map((record) => record.blockId));
  const unavailablePreparedId = [...blockGuards.keys()].find((blockId) =>
    !pageIds.has(blockId) || !findNode(selectedRoots, blockId));
  if (unavailablePreparedId) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Prepared Block ${unavailablePreparedId} is not present in the returned page and scope`,
      false,
      "get_block_again",
      { resourceId: unavailablePreparedId, domainCode: "prepared_block_not_returned" },
    );
  }
  const preparedRecords = pageRecords.map((record) => {
    const guardKind = blockGuards.get(record.blockId);
    if (!guardKind) return record;
    const node = findNode(selectedRoots, record.blockId)?.node;
    if (!node) return record;
    const state = guardKind === "block.update"
      ? documentBlockEtagState({
        projectId: input.projectId,
        documentId: input.document.id,
        block: node,
      })
      : documentSubtreeEtagState({
        projectId: input.projectId,
        documentId: input.document.id,
        block: node,
      });
    return { ...record, etag: mintNodexAgentEtag(database, state) };
  });
  const nextOffset = offset + pageRecords.length;
  const hasMore = nextOffset < records.length;
  return {
    body: { format: "blocks", blocks: preparedRecords },
    page: {
      hasMore,
      ...(hasMore ? {
        nextCursor: mintCursor(database, {
          projectId: input.projectId,
          subject: ["get_block", input.block.id],
          offset: nextOffset,
          state: cursorState,
        }),
      } : {}),
    },
  };
}

export function readNodexAgentBlock(
  database: Database.Database,
  projectId: string,
  request: GetBlockInput,
): GetBlockOutput {
  requireProject(database, projectId);
  const block = readBlockRow(database, projectId, request.blockId);
  if (!block) {
    throw new NodexAgentReadError(
      "not_found",
      `Block ${request.blockId} was not found in the bound Project`,
      false,
      "none",
      { resourceId: request.blockId, domainCode: "block_not_found" },
    );
  }

  const documentId = block.owned_document_id ?? block.containing_document_id;
  const document = documentId ? readDocumentRow(database, projectId, documentId) : null;
  if (document) requireExactMaterialization(document);
  if (documentId && !document) {
    throw new NodexAgentReadError(
      "projection_not_ready",
      `Document ${documentId} is unavailable`,
      true,
      "get_block_again",
      { resourceId: documentId, domainCode: "document_not_found" },
    );
  }
  const preparesDocument = request.prepareFor?.some((preparation) =>
    preparation.kind === "document.replace"
    || preparation.kind === "block.update"
    || preparation.kind === "block.delete") === true;
  if (preparesDocument && !document) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Block ${block.id} does not belong to a readable Document`,
      false,
      "none",
      { resourceId: block.id, domainCode: "document_not_available" },
    );
  }

  const body = document
    ? documentBody(database, { projectId, request, block, document })
    : null;
  const propertySelection = request.include?.properties?.propertyIds;
  const preparedPropertyIds = preparedValuePropertyIds(request);
  if (preparedPropertyIds.size > 0 && !request.include?.properties) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "Database value preparation requires properties in the read representation",
      false,
      "none",
      { resourceId: block.id, domainCode: "property_representation_required" },
    );
  }
  const unselectedPreparedProperty = propertySelection
    ? [...preparedPropertyIds].find(
      (propertyId) => !new Set<string>(propertySelection).has(propertyId),
    )
    : undefined;
  if (unselectedPreparedProperty) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Prepared property ${unselectedPreparedProperty} is not selected for return`,
      false,
      "none",
      { resourceId: unselectedPreparedProperty, domainCode: "prepared_property_not_returned" },
    );
  }
  const valueRows = request.include?.properties
    ? readDatabaseValues(database, projectId, block.id, propertySelection)
    : [];
  const includeDatabase = (request.include?.database || request.include === undefined)
    && hasDatabaseCapability(database, block.id);
  const richTitle = document?.owner_block_id === block.id && document.title_rich_json !== null
    ? canonicalizePortableRichText(
      parseJsonValue(document.title_rich_json, `Document ${document.id} rich title`),
    )
    : null;
  const title = document?.owner_block_id === block.id && document.title !== null
    ? richTitle && richTitle.length > 0
      ? { kind: "rich" as const, richText: richTitle }
      : { kind: "plain" as const, text: document.title }
    : undefined;
  const preparesTitle = request.prepareFor?.some(
    (preparation) => preparation.kind === "title.set",
  ) === true;
  if (preparesTitle && (!title || !richTitle || !document)) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Block ${block.id} does not expose an editable Document title`,
      false,
      "none",
      { resourceId: block.id, domainCode: "title_not_available" },
    );
  }

  const rawOutput = {
    data: {
      block: {
        blockId: block.id,
        type: block.type,
        ...(title ? {
          title: {
            value: title,
            ...(preparesTitle && richTitle && document ? {
              etag: mintNodexAgentEtag(database, titleEtagState({
                projectId,
                documentId: document.id,
                richTitle,
              })),
            } : {}),
          },
        } : {}),
        lifecycle: block.lifecycle,
        location: toBlockLocation(block),
        ...(request.include?.properties ? {
          properties: Object.fromEntries(valueRows.map((row) => {
            const value = parseJsonValue(row.value_json, `Database value ${row.property_id}`);
            return [row.property_id, {
              value,
              ...(preparedPropertyIds.has(row.property_id) ? {
                etag: mintNodexAgentEtag(database, databaseValueEtagState({
                  projectId,
                  databaseBlockId: row.database_block_id,
                  blockId: block.id,
                  propertyId: row.property_id,
                  value,
                  membershipId: row.membership_id,
                  membershipRevision: row.membership_revision,
                  propertySchemaRevision: row.property_schema_revision,
                  valueRevision: row.value_revision,
                })),
              } : {}),
            }];
          })),
        } : {}),
      },
      ...(document && body ? {
        document: {
          documentId: document.id,
          ownerBlockId: document.owner_block_id,
          body: body.body,
        },
      } : {}),
      ...(includeDatabase ? {
        database: {
          databaseBlockId: block.id,
        },
      } : {}),
    },
    ...(body?.page ? { page: body.page } : {}),
  };
  assertResponseSize(rawOutput);
  return GetBlockOutputSchema.parse(rawOutput);
}
