import type Database from "better-sqlite3";
import {
  createPageDocumentGenesis,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import {
  portableRichTextPlainText,
  type PortableRichText,
} from "../../shared/block-documents/portable-rich-text";
import { createUuidV7 } from "../../shared/uuid-v7";
import { DEFAULT_WORKFLOW_STATUS } from "../../shared/workflow-status";
import {
  parseDataSourceId,
  parseDataSourcePropertyId,
  parseDatabaseViewId,
} from "../../shared/database-identities";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyOperationV2,
} from "../../shared/database-module-v2";
import {
  PAGE_LIFECYCLE_V2_CONTRACT_VERSION,
  parsePageLifecycleMutationRequestV2,
} from "../../shared/page-lifecycle-v2";
import { BLOCK_TRANSFER_INTENT_CONTRACT_VERSION } from "../../shared/block-transfer";
import {
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  type DatabaseJsonValue,
} from "../../shared/database-kernel";
import {
  CreateInputSchema,
  CreatePagesV3OutputSchema,
  CreateOutputSchema,
  BlockIdSchema,
  resolveDocumentAnchor,
  type CreateInput,
  type CreateOutput,
  type ExecuteNodexAgentCreatePagesResult,
  type NodexAgentCreatePageCommand,
  type NodexAgentCreatePagesCommand,
  type PrepareNodexAgentCreatePagesRequest,
  type PrepareNodexAgentCreatePagesResult,
  type PreparedNodexAgentCreateDestination,
} from "../../shared/nodex-agent-tools";
import { parseInlineMarkdownTitle } from "../../shared/nfm/agent-title";
import { applyPageLifecycleMutationV2 } from "../local-store/page-lifecycle-v2-store";
import {
  applyBlockTransfer,
  prepareBlockTransfer,
} from "../local-store/block-transfers";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import {
  applyDatabaseModuleV2,
  readDatabaseModuleV2,
} from "../local-store/database-module-v2-runtime";
import { mintNodexAgentEtag } from "../local-store/nodex-agent-etag";
import {
  assertCurrentNodexAgentTurnAuthorityInDatabase,
  assertNodexAgentResourceAuthorizationInDatabase,
  assertNodexAgentResourceIntentsAuthorizedInDatabase,
  authorizeNodexAgentResourceInDatabase,
  authorizeProjectResourceInDatabase,
} from "../local-store/project-resource-grants";
import {
  nodexAgentCallIdentity,
  nodexAgentCallProvenance,
  readNodexAgentCallReceipt,
  requireMatchingNodexAgentCallReceipt,
  type NodexAgentCallReceiptRow,
} from "./call-receipts";
import {
  NodexAgentReadError,
  nodexAgentFingerprint,
  parseJsonValue,
  readFailure,
  requireProject,
  toBlockLocation,
} from "./read-support";
import {
  documentBodyEtagState,
  titleEtagState,
} from "./semantic-guards";
import { readMutatedPageLocation, requirePageDocumentId } from "./page-adapter";
import { publicV3Failure } from "./v3-errors";

interface DocumentDestinationRow {
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly materialization_generation: number | null;
  readonly projected_seq: number | null;
  readonly materialization_schema_version: number | null;
  readonly block_tree_json: string | null;
}

interface DatabasePropertyRow {
  readonly id: string;
  readonly value_type: Parameters<typeof parseDatabasePropertyConfig>[0];
  readonly config_json: string;
  readonly schema_revision: number;
}

interface CreateExecutionOptions {
  readonly faultInjector?: (point: "after_genesis" | "after_placement" | "before_receipt") => void;
}

function throwDomainFailure(input: {
  readonly message: string;
  readonly code: string;
  readonly recovery: "get_block_again" | "query_database_again" | "none";
}): never {
  const conflict = input.code.includes("conflict")
    || input.code.includes("mismatch")
    || input.code.includes("changed")
    || input.code.includes("anchor");
  throw new NodexAgentReadError(
    conflict ? "conflict" : "invalid_arguments",
    input.message,
    false,
    input.recovery,
    { domainCode: input.code },
  );
}

function flattenBlocks(blocks: readonly BlockTreeNode[]): readonly BlockTreeNode[] {
  return blocks.flatMap((block) => [block, ...flattenBlocks(block.children)]);
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

function richTitle(input: CreateInput): PortableRichText | undefined {
  return input.resource.title.kind === "rich"
    ? input.resource.title.richText
    : undefined;
}

function plainTitle(input: CreateInput): string {
  return input.resource.title.kind === "plain"
    ? input.resource.title.text
    : portableRichTextPlainText(input.resource.title.richText);
}

function requireNonBlankTitle(input: CreateInput): void {
  if (plainTitle(input).trim()) return;
  throw new NodexAgentReadError(
    "invalid_arguments",
    "Page title cannot be blank",
    false,
    "none",
  );
}

function resolveSiblingAnchor(
  ids: readonly string[],
  at: Extract<CreateInput["destination"], { readonly kind: "space" }>["at"],
  label: string,
): string | undefined {
  if (!at || at.kind === "end") return undefined;
  if (at.kind === "start") return ids[0];
  const index = ids.indexOf(at.blockId);
  if (index < 0) {
    throw new NodexAgentReadError(
      "conflict",
      `${label} anchor ${at.blockId} is unavailable`,
      false,
      "get_block_again",
      { resourceId: at.blockId, domainCode: "position_anchor_not_found" },
    );
  }
  return at.kind === "before" ? ids[index] : ids[index + 1];
}

function prepareLibraryDestination(
  database: Database.Database,
  projectId: string,
  destination: Extract<CreateInput["destination"], { readonly kind: "space" }>,
): PreparedNodexAgentCreateDestination {
  const rows = database.prepare(
    `
    SELECT placement.block_id AS id
    FROM top_level_block_placements placement
    INNER JOIN blocks block
      ON block.id = placement.block_id
     AND block.project_id = placement.project_id
     AND block.location_kind = 'space'
     AND block.lifecycle <> 'deleted'
    WHERE placement.project_id = ?
    ORDER BY placement.rank_key, placement.block_id
  `).all(projectId) as readonly { readonly id: string }[];
  const beforeBlockId = resolveSiblingAnchor(
    rows.map((row) => row.id),
    destination.at,
    "Library",
  );
  return {
    kind: "space",
    contentProjectId: projectId,
    ...(beforeBlockId ? { beforeBlockId } : {}),
  };
}

function readDocumentDestination(
  database: Database.Database,
  projectId: string,
  documentId: string,
): DocumentDestinationRow {
  const row = database.prepare(
    `
    SELECT
      document.generation, document.head_seq, document.schema_key,
      document.schema_version, document.readiness,
      materialization.generation AS materialization_generation,
      materialization.projected_seq,
      materialization.schema_version AS materialization_schema_version,
      materialization.block_tree_json
    FROM documents document
    LEFT JOIN document_materializations materialization
      ON materialization.document_id = document.id
    WHERE document.id = ? AND document.project_id = ?
    LIMIT 1
  `).get(documentId, projectId) as DocumentDestinationRow | undefined;
  if (!row) {
    throw new NodexAgentReadError(
      "not_found",
      `Document ${documentId} was not found in the bound Project`,
      false,
      "none",
      { resourceId: documentId, domainCode: "document_not_found" },
    );
  }
  if (
    row.readiness !== "ready"
    || row.materialization_generation !== row.generation
    || row.projected_seq !== row.head_seq
    || row.materialization_schema_version !== row.schema_version
    || row.block_tree_json === null
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

function prepareDocumentDestination(
  database: Database.Database,
  projectId: string,
  destination: Extract<CreateInput["destination"], { readonly kind: "document" }>,
  allowForeignOwner = false,
): PreparedNodexAgentCreateDestination {
  const contentOwner = database.prepare(`
    SELECT project_id AS contentProjectId
    FROM documents
    WHERE id = ? AND (? = 1 OR project_id = ?)
    LIMIT 1
  `).get(destination.documentId, allowForeignOwner ? 1 : 0, projectId) as
    | { readonly contentProjectId: string }
    | undefined;
  if (!contentOwner) {
    throw new NodexAgentReadError(
      "not_found",
      `Document ${destination.documentId} was not found in the authorized Project`,
      false,
      "none",
    );
  }
  const row = readDocumentDestination(
    database,
    contentOwner.contentProjectId,
    destination.documentId,
  );
  const blockTree = parseJsonValue(
    row.block_tree_json as string,
    `Document ${destination.documentId} Block tree`,
  ) as unknown as readonly BlockTreeNode[];
  const anchor = resolveDocumentAnchor(blockTree, destination.at);
  return {
    kind: "document",
    contentProjectId: contentOwner.contentProjectId,
    documentId: destination.documentId,
    generation: row.generation,
    expectedHeadSeq: row.head_seq,
    ...anchor,
  };
}

function validateValueDrafts(
  database: Database.Database,
  dataSourceId: string,
  values: Extract<CreateInput["destination"], { readonly kind: "database" }>["values"],
): void {
  const propertyIds = (values ?? []).map((value) => value.propertyId);
  if (new Set(propertyIds).size !== propertyIds.length) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "Database destination repeats a property value",
      false,
      "none",
    );
  }
  if (propertyIds.length === 0) return;
  const placeholders = propertyIds.map(() => "?").join(", ");
  const rows = database.prepare(
    `
    SELECT id, value_type, config_json, schema_revision
    FROM data_source_properties
    WHERE data_source_id = ? AND lifecycle = 'active'
      AND id IN (${placeholders})
  `).all(dataSourceId, ...propertyIds) as readonly DatabasePropertyRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const draft of values ?? []) {
    const property = byId.get(draft.propertyId);
    if (!property) {
      throw new NodexAgentReadError(
        "not_found",
        `Database property ${draft.propertyId} is unavailable`,
        false,
        "query_database_again",
        { resourceId: draft.propertyId, domainCode: "property_not_found" },
      );
    }
    try {
      normalizeDatabasePropertyValue(
        {
          valueType: property.value_type,
          config: parseDatabasePropertyConfig(
            property.value_type,
            JSON.parse(property.config_json) as unknown,
          ),
        },
        draft.value,
      );
    } catch (error) {
      throw new NodexAgentReadError(
        "invalid_arguments",
        `Value for property ${draft.propertyId} is invalid: ${error instanceof Error ? error.message : String(error)}`,
        false,
        "query_database_again",
        { resourceId: draft.propertyId, domainCode: "database_value_invalid" },
      );
    }
  }
}

export function prepareNodexAgentDataSourceDestination(
  database: Database.Database,
  projectId: string,
  destination: Extract<CreateInput["destination"], { readonly kind: "database" }>,
  preferredDataSourceId: string,
  allowForeignOwner = false,
): PreparedNodexAgentCreateDestination {
  void allowForeignOwner;
  const databaseRow = database.prepare(
    `
    SELECT source.id AS data_source_id,
      source.schema_revision,
      source.home_database_block_id AS database_block_id,
      block.project_id AS contentProjectId
    FROM data_sources source
    INNER JOIN database_containers container
      ON container.block_id = source.home_database_block_id
     AND container.library_id = source.library_id
    INNER JOIN blocks block
      ON block.id = container.block_id
     AND block.type = 'database'
     AND block.lifecycle = 'active'
    INNER JOIN projects project
      ON project.id = ? AND project.library_id = source.library_id
    WHERE source.home_database_block_id = ?
      AND source.lifecycle = 'active'
      AND (? IS NULL OR source.id = ?)
      AND (? IS NULL OR source.id = (
        SELECT selected.data_source_id FROM database_views selected
        WHERE selected.id = ? AND selected.lifecycle = 'active'
      ))
    ORDER BY source.rank_key, source.id
    LIMIT 1
  `).get(
    projectId,
    destination.databaseBlockId,
    preferredDataSourceId,
    preferredDataSourceId,
    destination.view?.viewId ?? null,
    destination.view?.viewId ?? null,
  ) as
    | {
        readonly data_source_id: string;
        readonly schema_revision: number;
        readonly database_block_id: string;
        readonly contentProjectId: string;
      }
    | undefined;
  if (!databaseRow) {
    throw new NodexAgentReadError(
      "not_found",
      `Database ${destination.databaseBlockId} is unavailable`,
      false,
      "query_database_again",
      { resourceId: destination.databaseBlockId, domainCode: "database_not_found" },
    );
  }
  const schemaRevision = databaseRow.schema_revision;
  validateValueDrafts(
    database,
    databaseRow.data_source_id,
    destination.values,
  );
  if (!destination.view) {
    return {
      kind: "database",
      contentProjectId: databaseRow.contentProjectId,
      databaseBlockId: databaseRow.database_block_id,
      dataSourceId: databaseRow.data_source_id,
      schemaRevision,
    };
  }
  const viewRow = database.prepare(
    `
    SELECT revision, config_json
    FROM database_views
    WHERE id = ? AND database_block_id = ? AND data_source_id = ?
      AND lifecycle = 'active'
  `).get(
    destination.view.viewId,
    databaseRow.database_block_id,
    databaseRow.data_source_id,
  ) as
    | { readonly revision: number; readonly config_json: string }
    | undefined;
  if (!viewRow) {
    throw new NodexAgentReadError(
      "not_found",
      `View ${destination.view.viewId} is unavailable in the destination Database`,
      false,
      "query_database_again",
      { resourceId: destination.view.viewId, domainCode: "view_not_found" },
    );
  }
  const viewRevision = viewRow.revision;
  const groupKey = destination.view.groupKey ?? null;
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Nodex store has no epoch");
  const logicalRead = readDatabaseModuleV2(database, {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    projectId: databaseRow.contentProjectId,
    read: {
      target: { kind: "view", viewId: parseDatabaseViewId(destination.view.viewId) },
      mode: "query",
    },
  });
  if (!logicalRead.ok || logicalRead.value.value.kind !== "query") {
    throw new NodexAgentReadError(
      "projection_not_ready",
      `View ${destination.view.viewId} could not be read for placement`,
      true,
      "query_database_again",
    );
  }
  const logicalOrder = logicalRead.value.value.value;
  const beforePageId = resolveSiblingAnchor(
    logicalOrder.rows
      .filter((row) => row.effectiveGroupKey === groupKey)
      .map((row) => row.page.pageId),
    destination.view.at,
    `View ${destination.view.viewId}`,
  );
  return {
    kind: "database",
    contentProjectId: databaseRow.contentProjectId,
    databaseBlockId: databaseRow.database_block_id,
    dataSourceId: databaseRow.data_source_id,
    schemaRevision,
    view: {
      viewId: destination.view.viewId,
      viewRevision,
      groupKey,
      ...(beforePageId ? { beforePageId } : {}),
    },
  };
}

function prepareDatabaseDestination(
  database: Database.Database,
  projectId: string,
  destination: Extract<CreateInput["destination"], { readonly kind: "database" }>,
  allowForeignOwner = false,
): PreparedNodexAgentCreateDestination {
  const preferred = destination.view
    ? (database.prepare(`
        SELECT data_source_id AS dataSourceId
        FROM database_views
        WHERE id = ? AND database_block_id = ? AND lifecycle = 'active'
      `).get(destination.view.viewId, destination.databaseBlockId) as
        | { readonly dataSourceId: string }
        | undefined)?.dataSourceId
    : (database.prepare(`
        SELECT id AS dataSourceId FROM data_sources
        WHERE home_database_block_id = ? AND lifecycle = 'active'
        ORDER BY rank_key, id LIMIT 1
      `).get(destination.databaseBlockId) as
        | { readonly dataSourceId: string }
        | undefined)?.dataSourceId;
  if (!preferred) {
    throw new NodexAgentReadError(
      "not_found",
      `Database ${destination.databaseBlockId} has no active Data Source`,
      false,
      "query_database_again",
    );
  }
  return prepareNodexAgentDataSourceDestination(
    database,
    projectId,
    destination,
    preferred,
    allowForeignOwner,
  );
}

export function prepareNodexAgentDestination(
  database: Database.Database,
  projectId: string,
  destination: CreateInput["destination"],
  allowForeignOwner = false,
): PreparedNodexAgentCreateDestination {
  if (destination.kind === "space") {
    return prepareLibraryDestination(database, projectId, destination);
  }
  if (destination.kind === "document") {
    return prepareDocumentDestination(
      database,
      projectId,
      destination,
      allowForeignOwner,
    );
  }
  return prepareDatabaseDestination(
    database,
    projectId,
    destination,
    allowForeignOwner,
  );
}

function assertPreparedAuthority(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
): void {
  const contentProjectId = command.destination.contentProjectId
    ?? command.projectId;
  const storeEpoch = readBlockStoreEpoch(database);
  if (storeEpoch !== command.storeEpoch) {
    throw new NodexAgentReadError(
      "conflict",
      "The Nodex store changed after Page creation was prepared",
      false,
      "get_block_again",
    );
  }
  if (command.destination.kind === "document") {
    const row = readDocumentDestination(
      database,
      contentProjectId,
      command.destination.documentId,
    );
    if (
      row.generation !== command.destination.generation
      || row.head_seq !== command.destination.expectedHeadSeq
    ) {
      throw new NodexAgentReadError(
        "conflict",
        `Document ${command.destination.documentId} changed before Page creation`,
        false,
        "get_block_again",
      );
    }
  }
  if (command.destination.kind !== "database") return;
  const databaseRow = database.prepare(
    `SELECT schema_revision FROM data_sources
     WHERE id = ? AND home_database_block_id = ? AND lifecycle = 'active'`,
  ).get(command.destination.dataSourceId, command.destination.databaseBlockId) as
    | { readonly schema_revision: number }
    | undefined;
  if (!databaseRow || databaseRow.schema_revision !== command.destination.schemaRevision) {
    throw new NodexAgentReadError(
      "conflict",
      `Database ${command.destination.databaseBlockId} schema changed before Page creation`,
      false,
      "query_database_again",
    );
  }
  if (!command.destination.view) return;
  const view = database.prepare(
    `SELECT revision FROM database_views
     WHERE id = ? AND database_block_id = ? AND data_source_id = ?
       AND lifecycle = 'active'`,
  ).get(
    command.destination.view.viewId,
    command.destination.databaseBlockId,
    command.destination.dataSourceId,
  ) as { readonly revision: number } | undefined;
  if (!view || view.revision !== command.destination.view.viewRevision) {
    throw new NodexAgentReadError(
      "conflict",
      `View ${command.destination.view.viewId} changed before Page creation`,
      false,
      "query_database_again",
    );
  }
}

function assertExecutionAuthority(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
): void {
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
      resource: {
        kind: "data_source",
        dataSourceId: command.destination.dataSourceId,
      },
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
  if (!owner) throw new Error("Nodex Agent destination Document has no Page owner");
  assertNodexAgentResourceAuthorizationInDatabase(database, {
    authority: command.authority,
    resource: { kind: "page", pageId: owner.pageId },
    action: "create_child",
    ...(command.resourceAccess
      ? { resourceAccess: command.resourceAccess }
      : {}),
    callId: command.callId,
  });
}

function buildCreateOutput(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
): CreateOutput {
  const block = database.prepare(
    `
    SELECT block.location_kind, block.containing_document_id,
      block.containing_database_id, block_index.parent_block_id
    FROM blocks block
    LEFT JOIN document_block_index block_index
      ON block_index.block_id = block.id
     AND block_index.document_id = block.containing_document_id
    WHERE block.id = ? AND block.project_id = ?
  `).get(command.pageId, command.projectId) as {
    readonly location_kind: "space" | "document" | "database";
    readonly containing_document_id: string | null;
    readonly containing_database_id: string | null;
    readonly parent_block_id: string | null;
  };
  const materialization = database.prepare(
    `
    SELECT materialization.title_rich_json, materialization.nfm
    FROM document_materializations materialization
    INNER JOIN documents document
      ON document.id = materialization.document_id
     AND document.generation = materialization.generation
     AND document.head_seq = materialization.projected_seq
     AND document.schema_version = materialization.schema_version
     AND document.readiness = 'ready'
    WHERE materialization.document_id = ? AND document.project_id = ?
    `,
  ).get(`document:${command.pageId}`, command.projectId) as {
    readonly title_rich_json: string;
    readonly nfm: string;
  };
  if (!block || !materialization) {
    throw new NodexAgentReadError(
      "internal_error",
      "The created Page does not have exact current authority",
      true,
      "retry_same",
    );
  }
  const documentId = `document:${command.pageId}`;
  const richTitle = parseJsonValue(
    materialization.title_rich_json,
    `Document ${documentId} rich title`,
  ) as unknown as PortableRichText;
  const returnOptions = command.input.return;
  const output = CreateOutputSchema.parse({
    data: {
      resource: {
        kind: "page",
        blockId: command.pageId,
        documentId,
        location: toBlockLocation(block),
        bodyBlockCount: command.bodyBlockIds.length,
        ...(returnOptions?.blockIds === true
          ? { createdBodyBlockIds: command.bodyBlockIds }
          : {}),
        ...(returnOptions?.etags === true ? {
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
        } : {}),
      },
      ...(command.destination.kind === "database" ? {
        database: {
          databaseBlockId: command.destination.databaseBlockId,
        },
      } : {}),
    },
  });
  return output;
}

function replayCreatePagesOutput(receipt: NodexAgentCallReceiptRow) {
  const metadata = parseJsonValue(
    receipt.result_metadata_json,
    `Agent call ${receipt.call_identity} result metadata`,
  );
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new NodexAgentReadError(
      "internal_error",
      "Agent Page batch result metadata is invalid",
      false,
      "none",
    );
  }
  return CreatePagesV3OutputSchema.parse(metadata.output);
}

function legacyCreatePagesDestination(
  database: Database.Database,
  projectId: string,
  authority: PrepareNodexAgentCreatePagesRequest["authority"],
  resourceAccess: PrepareNodexAgentCreatePagesRequest["resourceAccess"],
  callId: string,
  destination: PrepareNodexAgentCreatePagesRequest["input"]["destination"],
  values: PrepareNodexAgentCreatePagesRequest["input"]["pages"][number]["values"],
): CreateInput["destination"] {
  if (destination.kind === "library") {
    const project = database.prepare(`
      SELECT lifecycle FROM projects WHERE id = ?
    `).get(projectId) as { readonly lifecycle: string } | undefined;
    if (project?.lifecycle === "active") {
      return { kind: "space", ...(destination.at ? { at: destination.at } : {}) };
    }
    throw new NodexAgentReadError(
      "authorization_denied",
      "Only an active Project can create a top-level Library Page",
      false,
      "none",
      { resourceId: projectId, domainCode: "project_read_only" },
    );
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
    ...(values ? { values } : {}),
    ...(destination.view ? { view: destination.view } : {}),
  };
}

function normalizedCreateInput(
  database: Database.Database,
  projectId: string,
  authority: PrepareNodexAgentCreatePagesRequest["authority"],
  resourceAccess: PrepareNodexAgentCreatePagesRequest["resourceAccess"],
  callId: string,
  batch: PrepareNodexAgentCreatePagesRequest["input"],
  index: number,
): CreateInput {
  const draft = batch.pages[index];
  if (!draft) throw new Error(`Page draft ${index} is unavailable`);
  const destination = legacyCreatePagesDestination(
    database,
    projectId,
    authority,
    resourceAccess,
    callId,
    batch.destination,
    draft.values,
  );
  return CreateInputSchema.parse({
    resource: {
      kind: "page",
      title: {
        kind: "rich",
        richText: [...parseInlineMarkdownTitle(draft.title)],
      },
      ...(draft.markdown !== undefined
        ? { body: { format: "nfm", content: draft.markdown } }
        : {}),
    },
    destination,
    ...(batch.return
      ? {
          return: {
            ...(batch.return.includes("block_ids") ? { blockIds: true } : {}),
            ...(batch.return.includes("etags") ? { etags: true } : {}),
          },
        }
      : {}),
  });
}

function preparedCreatePage(
  input: CreateInput,
  allocate: () => string,
) {
  requireNonBlankTitle(input);
  const pageId = allocate();
  const nfm = input.resource.body?.content ?? "";
  let genesis;
  try {
    genesis = createPageDocumentGenesis({
      documentId: `document:${pageId}`,
      ...(richTitle(input)
        ? { richTitle: richTitle(input) as PortableRichText }
        : { title: plainTitle(input) }),
      nfm,
      allocateBlockId: allocate,
    });
  } catch (error) {
    throw new NodexAgentReadError(
      "invalid_nfm",
      error instanceof Error ? error.message : "Page Nested Markdown is invalid",
      false,
      "none",
    );
  }
  let bodyBlockIds: readonly string[];
  try {
    const blocks = flattenBlocks(genesis.materialization.blockTree);
    if (blocks.some((block) => block.type === "page")) {
      throw new NodexAgentReadError(
        "invalid_nfm",
        "Page creation Nested Markdown cannot create an owning nested Page; use create_pages",
        false,
        "none",
      );
    }
    bodyBlockIds = blocks.map((block) => block.id);
  } finally {
    genesis.document.destroy();
  }
  return {
    input,
    pageId,
    bodyBlockIds,
    primaryMembershipId: allocate(),
    targetMembershipId: allocate(),
  };
}

function prepareCreatePages(
  database: Database.Database,
  request: PrepareNodexAgentCreatePagesRequest,
): PrepareNodexAgentCreatePagesResult {
  requireProject(database, request.projectId);
  const key = { ...request, tool: "create_pages" };
  const identity = nodexAgentCallIdentity(key);
  const requestHash = nodexAgentFingerprint({
    tool: "create_pages",
    projectId: request.projectId,
    input: request.input,
  });
  const existing = readNodexAgentCallReceipt(database, identity);
  if (existing) {
    requireMatchingNodexAgentCallReceipt(existing, key, requestHash);
    if (existing.status === "committed") {
      return {
        ok: true,
        value: { kind: "completed", output: replayCreatePagesOutput(existing) },
      };
    }
  }

  const inputs = request.input.pages.map((_, index) =>
    normalizedCreateInput(
      database,
      request.projectId,
      request.authority,
      request.resourceAccess,
      request.callId,
      request.input,
      index,
    )
  );
  const allocations = existing
    ? parseStringArray(existing.allocations_json, "Agent Page batch allocation receipt")
    : [];
  let allocationIndex = 0;
  const allocate = (): string => {
    const value = allocations[allocationIndex] ?? createUuidV7();
    if (allocationIndex === allocations.length) allocations.push(value);
    allocationIndex += 1;
    return value;
  };
  const pages = inputs.map((input) => preparedCreatePage(input, allocate));
  const destinations = inputs.map((input) => {
    if (
      input.destination.kind === "database" &&
      request.input.destination.kind === "data_source"
    ) {
      return prepareNodexAgentDataSourceDestination(
        database,
        request.projectId,
        input.destination,
        request.input.destination.dataSourceId,
        request.authority !== undefined,
      );
    }
    return prepareNodexAgentDestination(
      database,
      request.projectId,
      input.destination,
      request.authority !== undefined,
    );
  });
  const destination = destinations[0];
  if (!destination || destinations.some((candidate) =>
    JSON.stringify(candidate) !== JSON.stringify(destination)
  )) {
    throw new NodexAgentReadError(
      "internal_error",
      "Page batch destination did not resolve consistently",
      false,
      "none",
    );
  }
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) {
    throw new NodexAgentReadError(
      "internal_error",
      "The Nodex store has no epoch",
      false,
      "none",
    );
  }
  const mutationId = existing?.mutation_id ?? `nodex-create-pages:${identity}`;
  const now = new Date().toISOString();
  if (existing) {
    database.prepare(
      `
      UPDATE nodex_agent_call_receipts
      SET allocations_json = ?, updated_at = ?
      WHERE call_identity = ? AND status = 'prepared'
    `).run(JSON.stringify(allocations), now, identity);
  } else {
    database.prepare(
      `
      INSERT INTO nodex_agent_call_receipts (
        call_identity, thread_id, turn_id, call_id, project_id, tool, request_hash,
        mutation_id, authority_fingerprint, provenance_version,
        allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'create_pages', ?, ?, ?, ?, ?, '{}', 'prepared', ?, ?)
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
      JSON.stringify(allocations),
      now,
      now,
    );
  }
  const command: NodexAgentCreatePagesCommand = {
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
    pages,
  };
  return {
    ok: true,
    value: {
      kind: "prepared",
      command,
      leaseDocuments: destination.kind === "document"
        ? [{
            documentId: destination.documentId,
            generation: destination.generation,
            expectedHeadSeq: destination.expectedHeadSeq,
          }]
        : [],
      previews: pages.map((page) => ({
        pageId: page.pageId,
        title: plainTitle(page.input),
        bodyBlockCount: page.bodyBlockIds.length,
        targetMarkdown: page.input.resource.body?.content ?? "",
      })),
    },
  };
}

function batchPageCommand(
  command: NodexAgentCreatePagesCommand,
  index: number,
): NodexAgentCreatePageCommand {
  const page = command.pages[index];
  if (!page) throw new Error(`Prepared Page ${index} is unavailable`);
  return {
    threadId: command.threadId,
    callId: command.callId,
    ...(command.authority ? { authority: command.authority } : {}),
    ...(command.resourceAccess ? { resourceAccess: command.resourceAccess } : {}),
    projectId: command.destination.contentProjectId ?? command.projectId,
    requestHash: command.requestHash,
    mutationId: `${command.mutationId}:page:${index}`,
    storeEpoch: command.storeEpoch,
    destination: command.destination,
    ...page,
    pageId: page.pageId,
  };
}

function createdPageV3Output(
  database: Database.Database,
  command: NodexAgentCreatePagesCommand,
  index: number,
) {
  const page = command.pages[index];
  if (!page) throw new Error(`Created Page ${index} is unavailable`);
  const legacy = buildCreateOutput(database, batchPageCommand(command, index));
  return {
    pageId: page.pageId,
    location: readMutatedPageLocation(database, page.pageId),
    bodyBlocksCreated: page.bodyBlockIds.length,
    ...(command.input.return?.includes("block_ids")
      ? { blockIds: page.bodyBlockIds }
      : {}),
    ...(legacy.data.resource.etags ? { etags: legacy.data.resource.etags } : {}),
  };
}

function createPagesOutput(
  database: Database.Database,
  command: NodexAgentCreatePagesCommand,
) {
  const output = CreatePagesV3OutputSchema.parse({
    data: {
      pages: command.pages.map((_, index) => createdPageV3Output(database, command, index)),
      created: command.pages.length,
    },
  });
  database.prepare(
    `
    UPDATE nodex_agent_call_receipts
    SET status = 'committed', result_metadata_json = ?, updated_at = ?
    WHERE call_identity = ? AND status = 'prepared'
  `).run(
    JSON.stringify({ output }),
    new Date().toISOString(),
    nodexAgentCallIdentity({ ...command, tool: "create_pages" }),
  );
  return output;
}

function canonicalCreateSourceId(
  database: Database.Database,
  command: NodexAgentCreatePagesCommand,
): string {
  if (command.destination.kind === "database") {
    return command.destination.dataSourceId;
  }
  const row = database.prepare(`
    SELECT source.id
    FROM project_database_bindings binding
    INNER JOIN data_sources source
      ON source.home_database_block_id = binding.database_block_id
     AND source.library_id = binding.library_id
     AND source.lifecycle = 'active'
    WHERE binding.project_id = ? AND binding.lifecycle = 'active'
    ORDER BY source.rank_key, source.id
    LIMIT 1
  `).get(command.destination.contentProjectId ?? command.projectId) as
    | { readonly id: string }
    | undefined;
  if (row) return row.id;
  throw new NodexAgentReadError(
    "not_found",
    `Project ${command.projectId} has no active default Data Source`,
    false,
    "query_database_again",
  );
}

const canonicalCreateProjectId = (
  command: NodexAgentCreatePagesCommand,
): string => command.destination.contentProjectId ?? command.projectId;

function applyCanonicalCreatePage(
  database: Database.Database,
  command: NodexAgentCreatePagesCommand,
  index: number,
) {
  const page = command.pages[index];
  if (!page) throw new Error(`Prepared Page ${index} is unavailable`);
  const contentProjectId = canonicalCreateProjectId(command);
  const dataSourceId = parseDataSourceId(canonicalCreateSourceId(database, command));
  const tags = database.prepare(`
    SELECT schema_revision AS revision
    FROM data_source_properties
    WHERE data_source_id = ? AND id = 'tags' AND lifecycle = 'active'
  `).get(dataSourceId) as { readonly revision: number } | undefined;
  if (!tags) {
    throw new NodexAgentReadError(
      "projection_not_ready",
      `Data Source ${dataSourceId} has no active tags Property`,
      true,
      "query_database_again",
    );
  }
  let bodyIndex = 0;
  const request = parsePageLifecycleMutationRequestV2({
    version: PAGE_LIFECYCLE_V2_CONTRACT_VERSION,
    operationId: `${command.mutationId}:page:${index}:genesis:v2`,
    projectId: contentProjectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: `nodex-agent:${command.threadId}`,
    actor: {
      kind: "nodex_agent",
      threadId: command.threadId,
      callId: command.callId,
    },
    operation: {
      kind: "create_page",
      pageId: page.pageId,
      title: plainTitle(page.input),
      ...(richTitle(page.input) ? { richTitle: richTitle(page.input) } : {}),
      nfm: page.input.resource.body?.content ?? "",
      status: DEFAULT_WORKFLOW_STATUS,
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
      dataSourceId,
      ...(command.destination.kind === "database" &&
          command.destination.view?.beforePageId
        ? { beforeViewPageId: command.destination.view.beforePageId }
        : {}),
    },
  });
  const lifecycle = applyPageLifecycleMutationV2(database, request, {
    allocateBodyBlockId: () => {
      const blockId = page.bodyBlockIds[bodyIndex];
      if (!blockId) throw new Error("Prepared Page body allocation is incomplete");
      bodyIndex += 1;
      return blockId;
    },
    allocateMembershipId: () => page.primaryMembershipId,
  });
  if (!lifecycle.ok) {
    throwDomainFailure({
      message: lifecycle.error.message,
      code: lifecycle.error.code,
      recovery: "query_database_again",
    });
  }
  if (bodyIndex !== page.bodyBlockIds.length) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "Prepared Page body allocations no longer match the Nested Markdown body",
      false,
      "none",
    );
  }
  return lifecycle.value;
}

function applyCanonicalCreateFollowup(
  database: Database.Database,
  command: NodexAgentCreatePagesCommand,
  index: number,
) {
  const page = command.pages[index];
  if (!page) throw new Error(`Prepared Page ${index} is unavailable`);
  const contentProjectId = canonicalCreateProjectId(command);
  if (command.destination.kind !== "database") {
    const source = database.prepare(`
      SELECT parent_id AS dataSourceId
      FROM pages
      WHERE block_id = ? AND parent_kind = 'data_source'
    `).get(page.pageId) as { readonly dataSourceId: string } | undefined;
    const target = command.destination.kind === "document"
      ? database.prepare(`
          SELECT block_id AS pageId
          FROM pages
          WHERE document_id = ? AND lifecycle = 'active'
        `).get(command.destination.documentId) as
          | { readonly pageId: string }
          | undefined
      : null;
    const project = command.destination.kind === "space"
      ? database.prepare(`
          SELECT library_id AS libraryId FROM projects WHERE id = ?
        `).get(contentProjectId) as { readonly libraryId: string } | undefined
      : null;
    if (!source || (command.destination.kind === "document" && !target) ||
      (command.destination.kind === "space" && !project)) {
      throw new Error(
        `Page ${page.pageId} cannot resolve its canonical transfer edge`,
      );
    }
    const prepared = prepareBlockTransfer(database, {
      version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
      operationId: `${command.mutationId}:page:${index}:destination:v2`,
      projectId: contentProjectId,
      storeEpoch: command.storeEpoch,
      clientSessionId: `nodex-agent:${command.threadId}`,
      actor: {
        kind: "nodex_agent",
        threadId: command.threadId,
        callId: command.callId,
      },
      mode: "move",
      rootBlockIds: [page.pageId],
      source: { kind: "data_source", dataSourceId: source.dataSourceId },
      target: command.destination.kind === "document"
        ? {
            kind: "page",
            pageId: (target as { readonly pageId: string }).pageId,
            ...(command.destination.parentBlockId
              ? { parentBlockId: command.destination.parentBlockId }
              : {}),
            ...(command.destination.beforeBlockId
              ? { beforeBlockId: command.destination.beforeBlockId }
              : {}),
          }
        : {
            kind: "library",
            libraryId: (project as { readonly libraryId: string }).libraryId,
            ...(command.destination.beforeBlockId
              ? { beforeBlockId: command.destination.beforeBlockId }
              : {}),
          },
    });
    if (!prepared.ok) {
      throwDomainFailure({
        message: prepared.error.message,
        code: prepared.error.code,
        recovery: prepared.error.reloadRequired ? "get_block_again" : "none",
      });
    }
    const transferred = applyBlockTransfer(database, prepared.value.request, {
      persistTopLevelGrant:
        !command.authority ||
        command.resourceAccess?.persistResultingPageGrants === true,
    });
    if (transferred.ok) return transferred.value;
    throwDomainFailure({
      message: transferred.error.message,
      code: transferred.error.code,
      recovery: transferred.error.reloadRequired ? "get_block_again" : "none",
    });
  }
  const operations: DatabaseApplyOperationV2[] = [];
  if (command.destination.kind === "database") {
    const destination = command.destination;
    const inputDestination = page.input.destination;
    if (inputDestination.kind !== "database") {
      throw new Error("Prepared Data Source Page lost its value intent");
    }
    if (inputDestination.values?.length) {
      const membership = database.prepare(`
        SELECT id FROM data_source_page_memberships
        WHERE data_source_id = ? AND page_block_id = ? AND removed_at IS NULL
      `).get(destination.dataSourceId, page.pageId) as
        | { readonly id: string }
        | undefined;
      if (!membership) throw new Error(`Page ${page.pageId} has no active membership`);
      const values = inputDestination.values.map((draft) => {
        const existing = database.prepare(`
          SELECT revision FROM data_source_property_values
          WHERE data_source_id = ? AND membership_id = ? AND property_id = ?
        `).get(
          destination.dataSourceId,
          membership.id,
          draft.propertyId,
        ) as { readonly revision: number } | undefined;
        return {
          pageId: page.pageId,
          dataSourceId: parseDataSourceId(destination.dataSourceId),
          propertyId: parseDataSourcePropertyId(draft.propertyId),
          expectedValueRevision: existing?.revision ?? 0,
          value: draft.value as DatabaseJsonValue,
        };
      });
      operations.push({ kind: "set_values", values });
    }
    if (command.destination.view) {
      const position = database.prepare(`
        SELECT revision FROM database_view_page_positions
        WHERE view_id = ? AND page_block_id = ?
      `).get(command.destination.view.viewId, page.pageId) as
        | { readonly revision: number }
        | undefined;
      operations.push({
        kind: "position_page",
        viewId: parseDatabaseViewId(command.destination.view.viewId),
        pageId: page.pageId,
        expectedPositionRevision: position?.revision ?? 0,
        groupKey: command.destination.view.groupKey,
        ...(command.destination.view.beforePageId
          ? { beforePageId: command.destination.view.beforePageId }
          : {}),
      });
    }
  }
  if (operations.length === 0) return null;
  const result = applyDatabaseModuleV2(database, {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    operationId: `${command.mutationId}:page:${index}:destination:v2`,
    projectId: contentProjectId,
    storeEpoch: command.storeEpoch,
    actor: {
      kind: "nodex_agent",
      threadId: command.threadId,
      callId: command.callId,
    },
    operations,
  });
  if (result.ok) return result.value;
  throwDomainFailure({
    message: result.error.message,
    code: result.error.code,
    recovery: "query_database_again",
  });
}

function executeCreatePages(
  database: Database.Database,
  command: NodexAgentCreatePagesCommand,
  options: CreateExecutionOptions,
): ExecuteNodexAgentCreatePagesResult {
  const key = { ...command, tool: "create_pages" };
  const identity = nodexAgentCallIdentity(key);
  const receipt = readNodexAgentCallReceipt(database, identity);
  if (!receipt) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "No matching prepared Agent Page batch exists",
      false,
      "none",
    );
  }
  requireMatchingNodexAgentCallReceipt(receipt, key, command.requestHash);
  if (receipt.mutation_id !== command.mutationId) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "Prepared Agent Page batch mutation identity changed",
      false,
      "none",
    );
  }
  if (receipt.status === "committed") {
    return {
      ok: true,
      value: {
        output: replayCreatePagesOutput(receipt),
        duplicate: true,
        documentCommits: [],
        affectedDatabaseBlockIds: [],
        changeLogSeq: 0,
      },
    };
  }
  assertExecutionAuthority(database, batchPageCommand(command, 0));
  assertPreparedAuthority(database, batchPageCommand(command, 0));
  const lifecycles = command.pages.map((_, index) =>
    applyCanonicalCreatePage(database, command, index)
  );
  options.faultInjector?.("after_genesis");
  const placementReceipts = command.pages.flatMap((_, index) => {
    const receipt = applyCanonicalCreateFollowup(database, command, index);
    return receipt ? [receipt] : [];
  });
  options.faultInjector?.("after_placement");
  options.faultInjector?.("before_receipt");
  return {
    ok: true,
    value: {
      output: createPagesOutput(database, command),
      duplicate: false,
      documentCommits: placementReceipts.flatMap((receipt) =>
        "documentCommits" in receipt ? receipt.documentCommits : []
      ),
      affectedDatabaseBlockIds: [...new Set([
        ...lifecycles.flatMap((lifecycle) =>
          lifecycle.databaseId ? [lifecycle.databaseId] : []
        ),
        ...placementReceipts.flatMap((result) =>
          "affectedDatabaseIds" in result
            ? result.affectedDatabaseIds
            : result.affectedDatabaseBlockIds
        ),
      ])].sort((left, right) => left.localeCompare(right)),
      changeLogSeq: Math.max(
        ...lifecycles.map((lifecycle) => lifecycle.changeLogSeq),
        ...placementReceipts.map((result) => result.changeLogSeq),
      ),
    },
  };
}

export function prepareNodexAgentCreatePages(
  database: Database.Database,
  request: PrepareNodexAgentCreatePagesRequest,
): PrepareNodexAgentCreatePagesResult {
  try {
    return database.transaction(() => prepareCreatePages(database, request)).immediate();
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
}

export function executeNodexAgentCreatePages(
  database: Database.Database,
  command: NodexAgentCreatePagesCommand,
  options: CreateExecutionOptions = {},
): ExecuteNodexAgentCreatePagesResult {
  try {
    return database.transaction(() => executeCreatePages(database, command, options)).immediate();
  } catch (error) {
    const failure = readFailure(error);
    return { ok: false, error: publicV3Failure(failure.error) };
  }
}
