import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { blockNoteToNfm } from "../../shared/block-documents/nfm-blocknote-adapter";
import type { BlockTreeNode } from "../../shared/block-documents/block-document-codec";
import { extractPlainText } from "../../shared/nfm/extract-text";
import { serializeNfm } from "../../shared/nfm/serializer";
import {
  GetBlockOutputSchema,
  type GetBlockInput,
  type GetBlockOutput,
  type JsonValue,
} from "../../shared/nodex-agent-tools";
import {
  assertResponseSize,
  mintCursor,
  mintRevision,
  NodexAgentReadError,
  nodexAgentFingerprint,
  parseJsonValue,
  readCursorState,
  requireProject,
  toBlockLocation,
} from "./read-support";

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
): readonly DatabaseValueRow[] {
  return database.prepare(
    `
    SELECT
      membership.id AS membership_id,
      membership.revision AS membership_revision,
      membership.database_block_id,
      property.id AS property_id,
      property.schema_revision AS property_schema_revision,
      value.value_json,
      value.revision AS value_revision
    FROM database_memberships membership
    INNER JOIN database_properties property
      ON property.database_block_id = membership.database_block_id
     AND property.project_id = membership.project_id
     AND property.lifecycle = 'active'
    INNER JOIN database_property_values value
      ON value.membership_id = membership.id
     AND value.property_id = property.id
     AND value.database_block_id = membership.database_block_id
     AND value.project_id = membership.project_id
    WHERE membership.card_block_id = ?
      AND membership.project_id = ?
      AND membership.removed_at IS NULL
    ORDER BY property.rank_key, property.id
  `).all(blockId, projectId) as readonly DatabaseValueRow[];
}

function readDatabaseSchemaRevision(
  database: Database.Database,
  projectId: string,
  blockId: string,
): number | null {
  const row = database.prepare(
    `
    SELECT capability.schema_revision
    FROM database_capabilities capability
    INNER JOIN blocks block
      ON block.id = capability.block_id
     AND block.project_id = capability.project_id
     AND block.type = 'database'
     AND block.lifecycle <> 'deleted'
    WHERE capability.block_id = ? AND capability.project_id = ?
    LIMIT 1
  `).get(blockId, projectId) as { readonly schema_revision: number } | undefined;
  return row?.schema_revision ?? null;
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

  if (requested.format === "summary") {
    return { body: { format: "summary", text: extractPlainText(selectedNfm, 4_096) } };
  }
  if (requested.format === "nfm") {
    return {
      body: {
        format: "nfm",
        content: selectedNfm,
        contentHash: createHash("sha256").update(selectedNfm).digest("hex"),
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
  const nextOffset = offset + pageRecords.length;
  const hasMore = nextOffset < records.length;
  return {
    body: { format: "blocks", blocks: pageRecords },
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

  const body = document
    ? documentBody(database, { projectId, request, block, document })
    : null;
  const valueRows = request.include?.properties
    ? readDatabaseValues(database, projectId, block.id)
    : [];
  const schemaRevision = request.include?.database || request.include === undefined
    ? readDatabaseSchemaRevision(database, projectId, block.id)
    : null;
  const richTitle = document?.owner_block_id === block.id && document.title_rich_json
    ? parseJsonValue(document.title_rich_json, `Document ${document.id} rich title`)
    : null;
  const title = document?.owner_block_id === block.id && document.title !== null
    ? Array.isArray(richTitle) && richTitle.length > 0
      ? { kind: "rich" as const, richText: richTitle }
      : { kind: "plain" as const, text: document.title }
    : undefined;

  const rawOutput = {
    schemaVersion: 1,
    data: {
      block: {
        blockId: block.id,
        type: block.type,
        ...(title ? { title } : {}),
        lifecycle: block.lifecycle,
        location: toBlockLocation(block),
        locationRevision: mintRevision(database, {
          kind: "location",
          projectId,
          subject: [block.id],
          state: {
            revision: block.location_revision,
            locationKind: block.location_kind,
            containingDocumentId: block.containing_document_id,
            containingDatabaseId: block.containing_database_id,
          },
        }),
        ...(request.include?.properties ? {
          properties: Object.fromEntries(valueRows.map((row) => [row.property_id, {
            value: parseJsonValue(row.value_json, `Database value ${row.property_id}`),
            revision: mintRevision(database, {
              kind: "database_value",
              projectId,
              subject: [row.database_block_id, block.id, row.property_id],
              state: {
                membershipId: row.membership_id,
                membershipRevision: row.membership_revision,
                propertySchemaRevision: row.property_schema_revision,
                valueRevision: row.value_revision,
              },
            }),
          }])),
        } : {}),
      },
      ...(document && body ? {
        document: {
          documentId: document.id,
          ownerBlockId: document.owner_block_id,
          revision: mintRevision(database, {
            kind: "document",
            projectId,
            subject: [document.id],
            state: {
              generation: document.generation,
              headSeq: document.head_seq,
              schemaKey: document.schema_key,
              schemaVersion: document.schema_version,
            },
          }),
          body: body.body,
        },
      } : {}),
      ...(schemaRevision !== null ? {
        database: {
          databaseBlockId: block.id,
          schemaRevision: mintRevision(database, {
            kind: "database_schema",
            projectId,
            subject: [block.id],
            state: { revision: schemaRevision },
          }),
        },
      } : {}),
    },
    ...(body?.page ? { page: body.page } : {}),
  };
  assertResponseSize(rawOutput);
  return GetBlockOutputSchema.parse(rawOutput);
}
