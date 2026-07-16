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
import { parsePageLifecycleMutationRequest } from "../../shared/page-lifecycle";
import {
  DATABASE_MUTATION_CONTRACT_VERSION,
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  type DatabaseJsonValue,
  type DatabaseMutationOperation,
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
  type ExecuteNodexAgentCreateResult,
  type NodexAgentCreatePageCommand,
  type NodexAgentCreatePagesCommand,
  type PrepareNodexAgentCreatePagesRequest,
  type PrepareNodexAgentCreatePagesResult,
  type PrepareNodexAgentCreateRequest,
  type PrepareNodexAgentCreateResult,
  type PreparedNodexAgentCreateDestination,
} from "../../shared/nodex-agent-tools";
import { parseInlineMarkdownTitle } from "../../shared/nfm/agent-title";
import { applyBlockTransfer } from "../local-store/block-transfers";
import { applyPageLifecycleMutation } from "../local-store/page-lifecycle";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { applyDatabaseMutation } from "../local-store/database-kernel";
import { mintNodexAgentEtag } from "../local-store/nodex-agent-etag";
import { authorizeProjectResourceInDatabase } from "../local-store/project-resource-grants";
import {
  nodexAgentCallIdentity,
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
import { readPageLocation, requirePageDocumentId } from "./page-adapter";
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
): PreparedNodexAgentCreateDestination {
  const row = readDocumentDestination(database, projectId, destination.documentId);
  const blockTree = parseJsonValue(
    row.block_tree_json as string,
    `Document ${destination.documentId} Block tree`,
  ) as unknown as readonly BlockTreeNode[];
  const anchor = resolveDocumentAnchor(blockTree, destination.at);
  return {
    kind: "document",
    documentId: destination.documentId,
    generation: row.generation,
    expectedHeadSeq: row.head_seq,
    ...anchor,
  };
}

function validateValueDrafts(
  database: Database.Database,
  projectId: string,
  databaseBlockId: string,
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
    FROM database_properties
    WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
      AND id IN (${placeholders})
  `).all(databaseBlockId, projectId, ...propertyIds) as readonly DatabasePropertyRow[];
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

function prepareDatabaseDestination(
  database: Database.Database,
  projectId: string,
  destination: Extract<CreateInput["destination"], { readonly kind: "database" }>,
): PreparedNodexAgentCreateDestination {
  const databaseRow = database.prepare(
    `
    SELECT capability.schema_revision
    FROM database_capabilities capability
    INNER JOIN blocks block
      ON block.id = capability.block_id
     AND block.project_id = capability.project_id
     AND block.type = 'database'
     AND block.lifecycle = 'active'
    WHERE capability.block_id = ? AND capability.project_id = ?
  `).get(destination.databaseBlockId, projectId) as
    | { readonly schema_revision: number }
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
    projectId,
    destination.databaseBlockId,
    destination.values,
  );
  if (!destination.view) {
    return { kind: "database", databaseBlockId: destination.databaseBlockId, schemaRevision };
  }
  const viewRow = database.prepare(
    `
    SELECT revision
    FROM database_views
    WHERE id = ? AND database_block_id = ? AND project_id = ?
      AND lifecycle = 'active'
  `).get(destination.view.viewId, destination.databaseBlockId, projectId) as
    | { readonly revision: number }
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
  const positionRows = database.prepare(
    `
    SELECT position.block_id AS id
    FROM database_view_positions position
    INNER JOIN blocks block
      ON block.id = position.block_id
     AND block.project_id = position.project_id
     AND block.lifecycle <> 'deleted'
    WHERE position.view_id = ? AND position.project_id = ?
      AND position.group_key IS ?
    ORDER BY position.rank_key, position.block_id
  `).all(destination.view.viewId, projectId, groupKey) as readonly { readonly id: string }[];
  const beforePageId = resolveSiblingAnchor(
    positionRows.map((row) => row.id),
    destination.view.at,
    `View ${destination.view.viewId}`,
  );
  return {
    kind: "database",
    databaseBlockId: destination.databaseBlockId,
    schemaRevision,
    view: {
      viewId: destination.view.viewId,
      viewRevision,
      groupKey,
      ...(beforePageId ? { beforePageId } : {}),
    },
  };
}

export function prepareNodexAgentDestination(
  database: Database.Database,
  projectId: string,
  destination: CreateInput["destination"],
): PreparedNodexAgentCreateDestination {
  if (destination.kind === "space") {
    return prepareLibraryDestination(database, projectId, destination);
  }
  if (destination.kind === "document") {
    return prepareDocumentDestination(database, projectId, destination);
  }
  return prepareDatabaseDestination(database, projectId, destination);
}

function replayOutput(receipt: NodexAgentCallReceiptRow): CreateOutput {
  const metadata = parseJsonValue(
    receipt.result_metadata_json,
    `Agent call ${receipt.call_identity} result metadata`,
  );
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new NodexAgentReadError(
      "internal_error",
      "Agent create result metadata is invalid",
      false,
      "none",
    );
  }
  return CreateOutputSchema.parse(metadata.output);
}

function prepareCreate(
  database: Database.Database,
  request: PrepareNodexAgentCreateRequest,
): PrepareNodexAgentCreateResult {
  requireProject(database, request.projectId);
  requireNonBlankTitle(request.input);
  const key = { ...request, tool: "create" };
  const identity = nodexAgentCallIdentity(key);
  const requestHash = nodexAgentFingerprint({
    tool: "create",
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
  const allocations = existing
    ? parseStringArray(existing.allocations_json, "Agent create allocation receipt")
    : [];
  let allocationIndex = 0;
  const allocate = (): string => {
    const value = allocations[allocationIndex] ?? createUuidV7();
    if (allocationIndex === allocations.length) allocations.push(value);
    allocationIndex += 1;
    return value;
  };
  const pageId = allocate();
  const nfm = request.input.resource.body?.content ?? "";
  let genesis;
  try {
    genesis = createPageDocumentGenesis({
      documentId: `document:${pageId}`,
      ...(richTitle(request.input)
        ? { richTitle: richTitle(request.input) as PortableRichText }
        : { title: plainTitle(request.input) }),
      nfm,
      allocateBlockId: allocate,
    });
  } catch (error) {
    throw new NodexAgentReadError(
      "invalid_nfm",
      error instanceof Error ? error.message : "Page NFM is invalid",
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
        "Page creation NFM cannot create an owning nested Page; use create again",
        false,
        "none",
      );
    }
    bodyBlockIds = blocks.map((block) => block.id);
  } finally {
    genesis.document.destroy();
  }
  const primaryMembershipId = allocate();
  const targetMembershipId = allocate();
  const destination = prepareNodexAgentDestination(
    database,
    request.projectId,
    request.input.destination,
  );
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) {
    throw new NodexAgentReadError(
      "internal_error",
      "The Nodex store has no epoch",
      false,
      "none",
    );
  }
  const mutationId = existing?.mutation_id ?? `nodex-create:${identity}`;
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
        call_identity, thread_id, call_id, project_id, tool, request_hash,
        mutation_id, allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'create', ?, ?, ?, '{}', 'prepared', ?, ?)
    `).run(
      identity,
      request.threadId,
      request.callId,
      request.projectId,
      requestHash,
      mutationId,
      JSON.stringify(allocations),
      now,
      now,
    );
  }
  const command: NodexAgentCreatePageCommand = {
    threadId: request.threadId,
    callId: request.callId,
    projectId: request.projectId,
    requestHash,
    mutationId,
    storeEpoch,
    input: request.input,
    pageId,
    bodyBlockIds,
    primaryMembershipId,
    targetMembershipId,
    destination,
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
      createdBodyBlockIds: bodyBlockIds,
      targetNfm: nfm,
    },
  };
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

function applyLifecycleGenesis(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
) {
  let bodyIndex = 0;
  const request = parsePageLifecycleMutationRequest({
    version: 1,
    operationId: `${command.mutationId}:genesis`,
    projectId: command.projectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: `nodex-agent:${command.threadId}`,
    actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
    operation: {
      kind: "create_page",
      pageId: command.pageId,
      title: plainTitle(command.input),
      ...(richTitle(command.input) ? { richTitle: richTitle(command.input) } : {}),
      nfm: command.input.resource.body?.content ?? "",
      status: DEFAULT_WORKFLOW_STATUS,
      priority: null,
      estimate: null,
      tags: [],
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
    },
  });
  const result = applyPageLifecycleMutation(database, request, {
    allocateBodyBlockId: () => {
      const blockId = command.bodyBlockIds[bodyIndex];
      if (!blockId) throw new Error("Prepared Page body allocation is incomplete");
      bodyIndex += 1;
      return blockId;
    },
    allocateMembershipId: () => command.primaryMembershipId,
  });
  if (!result.ok) {
    throwDomainFailure({
      message: result.error.message,
      code: result.error.code,
      recovery: "none",
    });
  }
  if (bodyIndex !== command.bodyBlockIds.length) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "Prepared Page body allocations no longer match the NFM body",
      false,
      "none",
    );
  }
  return result.value;
}

function applySpaceOrDocumentPlacement(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
  lifecycle: ReturnType<typeof applyLifecycleGenesis>,
){
  if (command.destination.kind === "database") return null;
  if (!lifecycle.databaseId || !lifecycle.membershipId) {
    throw new Error("Page genesis did not create its primary membership");
  }
  const target = command.destination.kind === "space"
    ? {
        kind: "space" as const,
        ...(command.destination.beforeBlockId
          ? { beforeBlockId: command.destination.beforeBlockId }
          : {}),
      }
    : {
        kind: "document" as const,
        documentId: command.destination.documentId,
        generation: command.destination.generation,
        expectedHeadSeq: command.destination.expectedHeadSeq,
        ...(command.destination.parentBlockId
          ? { parentBlockId: command.destination.parentBlockId }
          : {}),
        ...(command.destination.beforeBlockId
          ? { beforeBlockId: command.destination.beforeBlockId }
          : {}),
      };
  const result = applyBlockTransfer(database, {
    version: 1,
    operationId: `${command.mutationId}:placement`,
    projectId: command.projectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: `nodex-agent:${command.threadId}`,
    actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
    mode: "move",
    rootBlockIds: [command.pageId],
    expectedLocationRevisions: { [command.pageId]: lifecycle.parentRevision },
    source: {
      kind: "database",
      databaseBlockId: lifecycle.databaseId,
      memberships: {
        [command.pageId]: {
          membershipId: lifecycle.membershipId,
          revision: 1,
        },
      },
    },
    target,
  });
  if (result.ok) return result.value;
  throwDomainFailure({
    message: result.error.message,
    code: result.error.code,
    recovery: command.destination.kind === "document" ? "get_block_again" : "none",
  });
}

function primaryMembership(
  database: Database.Database,
  pageId: string,
): { readonly id: string; readonly database_block_id: string; readonly revision: number } {
  const row = database.prepare(
    `
    SELECT id, database_block_id, revision
    FROM database_memberships
    WHERE page_block_id = ? AND removed_at IS NULL
    LIMIT 1
  `).get(pageId) as
    | { readonly id: string; readonly database_block_id: string; readonly revision: number }
    | undefined;
  if (!row) throw new Error(`Page ${pageId} has no active membership`);
  return row;
}

function databaseValueOperations(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
  expectedValueRevision: number,
): readonly DatabaseMutationOperation[] {
  if (command.destination.kind !== "database") return [];
  const destination = command.input.destination;
  if (destination.kind !== "database" || !destination.values?.length) return [];
  return [{
    kind: "set_values",
    databaseBlockId: command.destination.databaseBlockId,
    entries: destination.values.map((draft) => ({
      pageId: command.pageId,
      propertyId: draft.propertyId,
      expectedValueRevision,
      value: draft.value as DatabaseJsonValue,
    })),
  }];
}

function applyDatabasePlacement(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
){
  if (command.destination.kind !== "database") return [];
  const receipts = [];
  const current = primaryMembership(database, command.pageId);
  const sameDatabase = current.database_block_id === command.destination.databaseBlockId;
  if (sameDatabase) {
    const detached = applyDatabaseMutation(database, {
      version: DATABASE_MUTATION_CONTRACT_VERSION,
      operationId: `${command.mutationId}:detach-primary`,
      projectId: command.projectId,
      storeEpoch: command.storeEpoch,
      clientSessionId: `nodex-agent:${command.threadId}`,
      actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
      operations: [{
        kind: "transfer_membership",
        pageId: command.pageId,
        expectedMembership: { membershipId: current.id, revision: current.revision },
        target: null,
      }],
    });
    if (!detached.ok) {
      throwDomainFailure({
        message: detached.error.message,
        code: detached.error.code,
        recovery: "query_database_again",
      });
    }
    receipts.push(detached.value);
  }
  const expectedValueRevision = sameDatabase ? 1 : 0;
  const expectedMembership = sameDatabase
    ? null
    : { membershipId: current.id, revision: current.revision };
  const target = {
    databaseBlockId: command.destination.databaseBlockId,
    membershipId: command.targetMembershipId,
    ...(command.destination.view ? {
      viewId: command.destination.view.viewId,
      groupKey: command.destination.view.groupKey,
      ...(command.destination.view.beforePageId
        ? { beforePageId: command.destination.view.beforePageId }
        : {}),
    } : {}),
  };
  const result = applyDatabaseMutation(database, {
    version: DATABASE_MUTATION_CONTRACT_VERSION,
    operationId: `${command.mutationId}:database`,
    projectId: command.projectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: `nodex-agent:${command.threadId}`,
    actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
    operations: [
      {
        kind: "transfer_membership",
        pageId: command.pageId,
        expectedMembership,
        target,
      },
      ...databaseValueOperations(database, command, expectedValueRevision),
    ],
  });
  if (result.ok) return [...receipts, result.value];
  throwDomainFailure({
    message: result.error.message,
    code: result.error.code,
    recovery: "query_database_again",
  });
}

function assertPreparedAuthority(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
): void {
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
      command.projectId,
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
    "SELECT schema_revision FROM database_capabilities WHERE block_id = ? AND project_id = ?",
  ).get(command.destination.databaseBlockId, command.projectId) as
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
    "SELECT revision FROM database_views WHERE id = ? AND database_block_id = ? AND project_id = ? AND lifecycle = 'active'",
  ).get(
    command.destination.view.viewId,
    command.destination.databaseBlockId,
    command.projectId,
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

function createOutput(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
): CreateOutput {
  const output = buildCreateOutput(database, command);
  database.prepare(
    `
    UPDATE nodex_agent_call_receipts
    SET status = 'committed', result_metadata_json = ?, updated_at = ?
    WHERE call_identity = ? AND status = 'prepared'
  `).run(
    JSON.stringify({ output }),
    new Date().toISOString(),
    nodexAgentCallIdentity({ ...command, tool: "create" }),
  );
  return output;
}

function executeCreate(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
  options: CreateExecutionOptions,
): ExecuteNodexAgentCreateResult {
  const identity = nodexAgentCallIdentity({ ...command, tool: "create" });
  const receipt = readNodexAgentCallReceipt(database, identity);
  if (!receipt) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "No matching prepared Agent create call exists",
      false,
      "none",
    );
  }
  requireMatchingNodexAgentCallReceipt(
    receipt,
    { ...command, tool: "create" },
    command.requestHash,
  );
  if (receipt.mutation_id !== command.mutationId) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "Prepared Agent create mutation identity changed",
      false,
      "none",
    );
  }
  if (receipt.status === "committed") {
    return {
      ok: true,
      value: {
        output: replayOutput(receipt),
        duplicate: true,
        documentCommits: [],
        affectedDatabaseBlockIds: [],
        changeLogSeq: 0,
      },
    };
  }
  assertPreparedAuthority(database, command);
  const lifecycle = applyLifecycleGenesis(database, command);
  options.faultInjector?.("after_genesis");
  const placement = applySpaceOrDocumentPlacement(database, command, lifecycle);
  const databaseReceipts = applyDatabasePlacement(database, command);
  options.faultInjector?.("after_placement");
  options.faultInjector?.("before_receipt");
  return {
    ok: true,
    value: {
      output: createOutput(database, command),
      duplicate: false,
      documentCommits: placement?.documentCommits ?? [],
      affectedDatabaseBlockIds: [...new Set([
        ...(lifecycle.databaseId ? [lifecycle.databaseId] : []),
        ...(placement?.affectedDatabaseBlockIds ?? []),
        ...databaseReceipts.flatMap((result) => result.affectedDatabaseBlockIds),
      ])].sort((left, right) => left.localeCompare(right)),
      changeLogSeq: Math.max(
        lifecycle.changeLogSeq,
        placement?.changeLogSeq ?? 0,
        ...databaseReceipts.map((result) => result.changeLogSeq),
      ),
    },
  };
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
      ),
      at: destination.at ?? { kind: "end" },
    };
  }
  const authorization = authorizeProjectResourceInDatabase(database, {
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
  batch: PrepareNodexAgentCreatePagesRequest["input"],
  index: number,
): CreateInput {
  const draft = batch.pages[index];
  if (!draft) throw new Error(`Page draft ${index} is unavailable`);
  const destination = legacyCreatePagesDestination(
    database,
    projectId,
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
    normalizedCreateInput(database, request.projectId, request.input, index)
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
  const destinations = inputs.map((input) =>
    prepareNodexAgentDestination(database, request.projectId, input.destination)
  );
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
        call_identity, thread_id, call_id, project_id, tool, request_hash,
        mutation_id, allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'create_pages', ?, ?, ?, '{}', 'prepared', ?, ?)
    `).run(
      identity,
      request.threadId,
      request.callId,
      request.projectId,
      requestHash,
      mutationId,
      JSON.stringify(allocations),
      now,
      now,
    );
  }
  const command: NodexAgentCreatePagesCommand = {
    threadId: request.threadId,
    callId: request.callId,
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
    projectId: command.projectId,
    requestHash: command.requestHash,
    mutationId: `${command.mutationId}:page:${index}`,
    storeEpoch: command.storeEpoch,
    destination: command.destination,
    ...page,
    pageId: page.pageId,
  };
}

function applyBatchSpaceOrDocumentPlacement(
  database: Database.Database,
  command: NodexAgentCreatePagesCommand,
  lifecycles: readonly ReturnType<typeof applyLifecycleGenesis>[],
) {
  if (command.destination.kind === "database") return null;
  const memberships = lifecycles.map((lifecycle, index) => {
    const page = command.pages[index];
    if (!page || !lifecycle.databaseId || !lifecycle.membershipId) {
      throw new Error("Page batch genesis did not create its primary membership");
    }
    return { page, lifecycle };
  });
  const sourceDatabaseBlockId = memberships[0]?.lifecycle.databaseId;
  if (!sourceDatabaseBlockId || memberships.some(
    ({ lifecycle }) => lifecycle.databaseId !== sourceDatabaseBlockId,
  )) {
    throw new Error("Page batch genesis did not share one primary Database");
  }
  const target = command.destination.kind === "space"
    ? {
        kind: "space" as const,
        ...(command.destination.beforeBlockId
          ? { beforeBlockId: command.destination.beforeBlockId }
          : {}),
      }
    : {
        kind: "document" as const,
        documentId: command.destination.documentId,
        generation: command.destination.generation,
        expectedHeadSeq: command.destination.expectedHeadSeq,
        ...(command.destination.parentBlockId
          ? { parentBlockId: command.destination.parentBlockId }
          : {}),
        ...(command.destination.beforeBlockId
          ? { beforeBlockId: command.destination.beforeBlockId }
          : {}),
      };
  const result = applyBlockTransfer(database, {
    version: 1,
    operationId: `${command.mutationId}:placement`,
    projectId: command.projectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: `nodex-agent:${command.threadId}`,
    actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
    mode: "move",
    rootBlockIds: memberships.map(({ page }) => page.pageId),
    expectedLocationRevisions: Object.fromEntries(memberships.map(({ page, lifecycle }) =>
      [page.pageId, lifecycle.parentRevision]
    )),
    source: {
      kind: "database",
      databaseBlockId: sourceDatabaseBlockId,
      memberships: Object.fromEntries(memberships.map(({ page, lifecycle }) => [
        page.pageId,
        { membershipId: lifecycle.membershipId as string, revision: 1 },
      ])),
    },
    target,
  });
  if (result.ok) return result.value;
  throwDomainFailure({
    message: result.error.message,
    code: result.error.code,
    recovery: command.destination.kind === "document" ? "get_block_again" : "none",
  });
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
    location: readPageLocation(database, command.projectId, page.pageId),
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
  assertPreparedAuthority(database, batchPageCommand(command, 0));
  const lifecycles = command.pages.map((_, index) =>
    applyLifecycleGenesis(database, batchPageCommand(command, index))
  );
  options.faultInjector?.("after_genesis");
  const placement = applyBatchSpaceOrDocumentPlacement(database, command, lifecycles);
  const databaseReceipts = command.destination.kind === "database"
    ? command.pages.flatMap((_, index) =>
        applyDatabasePlacement(database, batchPageCommand(command, index))
      )
    : [];
  options.faultInjector?.("after_placement");
  options.faultInjector?.("before_receipt");
  return {
    ok: true,
    value: {
      output: createPagesOutput(database, command),
      duplicate: false,
      documentCommits: placement?.documentCommits ?? [],
      affectedDatabaseBlockIds: [...new Set([
        ...lifecycles.flatMap((lifecycle) =>
          lifecycle.databaseId ? [lifecycle.databaseId] : []
        ),
        ...(placement?.affectedDatabaseBlockIds ?? []),
        ...databaseReceipts.flatMap((result) => result.affectedDatabaseBlockIds),
      ])].sort((left, right) => left.localeCompare(right)),
      changeLogSeq: Math.max(
        ...lifecycles.map((lifecycle) => lifecycle.changeLogSeq),
        placement?.changeLogSeq ?? 0,
        ...databaseReceipts.map((result) => result.changeLogSeq),
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

export function prepareNodexAgentCreate(
  database: Database.Database,
  request: PrepareNodexAgentCreateRequest,
): PrepareNodexAgentCreateResult {
  try {
    return database.transaction(() => prepareCreate(database, request)).immediate();
  } catch (error) {
    return readFailure(error);
  }
}

export function executeNodexAgentCreate(
  database: Database.Database,
  command: NodexAgentCreatePageCommand,
  options: CreateExecutionOptions = {},
): ExecuteNodexAgentCreateResult {
  try {
    return database.transaction(() => executeCreate(database, command, options)).immediate();
  } catch (error) {
    return readFailure(error);
  }
}
