import type Database from "better-sqlite3";
import {
  createCardDocumentGenesis,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import {
  portableRichTextPlainText,
  type PortableRichText,
} from "../../shared/block-documents/portable-rich-text";
import { createUuidV7 } from "../../shared/card-id";
import { DEFAULT_CARD_STATUS } from "../../shared/card-status";
import { parseCardLifecycleMutationRequest } from "../../shared/card-lifecycle";
import {
  DATABASE_MUTATION_CONTRACT_VERSION,
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  parseGeneralDatabaseViewConfig,
  type DatabaseJsonValue,
  type DatabaseMutationOperation,
} from "../../shared/database-kernel";
import {
  CreateOutputSchema,
  resolveDocumentAnchor,
  type CreateInput,
  type CreateOutput,
  type ExecuteNodexAgentCreateResult,
  type JsonValue,
  type NodexAgentCreateCardCommand,
  type PrepareNodexAgentCreateRequest,
  type PrepareNodexAgentCreateResult,
  type PreparedNodexAgentCreateDestination,
} from "../../shared/nodex-agent-tools";
import { applyBlockTransfer } from "../local-store/block-transfers";
import { applyCardLifecycleMutation } from "../local-store/card-block-lifecycle";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { applyDatabaseMutation } from "../local-store/database-kernel";
import {
  decodeNodexAgentToken,
  NodexAgentTokenError,
  type NodexAgentTokenKind,
} from "../local-store/nodex-agent-token-codec";
import {
  nodexAgentCallIdentity,
  readNodexAgentCallReceipt,
  requireMatchingNodexAgentCallReceipt,
  type NodexAgentCallReceiptRow,
} from "./call-receipts";
import {
  mintRevision,
  NodexAgentReadError,
  nodexAgentFingerprint,
  parseJsonValue,
  readFailure,
  requireProject,
} from "./read-support";

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

interface DatabaseValueRow {
  readonly membership_id: string;
  readonly membership_revision: number;
  readonly property_id: string;
  readonly property_schema_revision: number;
  readonly value_revision: number;
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

function decodeRevision(
  database: Database.Database,
  input: {
    readonly token: string;
    readonly kind: Exclude<NodexAgentTokenKind, "cursor">;
    readonly projectId: string;
    readonly subject: readonly string[];
    readonly recovery: "get_block_again" | "query_database_again";
  },
) {
  try {
    return decodeNodexAgentToken(database, input.token, {
      kind: input.kind,
      projectId: input.projectId,
      subject: input.subject,
    });
  } catch (error) {
    if (!(error instanceof NodexAgentTokenError)) throw error;
    throw new NodexAgentReadError(
      error.code === "invalid_token" ? "invalid_arguments" : "conflict",
      error.message,
      false,
      input.recovery,
      { resourceId: input.subject.at(-1), domainCode: error.code },
    );
  }
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
    "Card title cannot be blank",
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

function prepareSpaceDestination(
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
    "Space",
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
  const token = decodeRevision(database, {
    token: destination.ifRevision,
    kind: "document",
    projectId,
    subject: [destination.documentId],
    recovery: "get_block_again",
  });
  const generation = coordinate(token.state.generation, "Document generation");
  const expectedHeadSeq = coordinate(token.state.headSeq, "Document head");
  const row = readDocumentDestination(database, projectId, destination.documentId);
  if (row.generation !== generation || row.head_seq !== expectedHeadSeq) {
    throw new NodexAgentReadError(
      "conflict",
      `Document ${destination.documentId} changed after it was read`,
      false,
      "get_block_again",
      { resourceId: destination.documentId, domainCode: "document_revision_conflict" },
    );
  }
  const blockTree = parseJsonValue(
    row.block_tree_json as string,
    `Document ${destination.documentId} Block tree`,
  ) as unknown as readonly BlockTreeNode[];
  const anchor = resolveDocumentAnchor(blockTree, destination.at);
  return {
    kind: "document",
    documentId: destination.documentId,
    generation,
    expectedHeadSeq,
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
  const schemaToken = decodeRevision(database, {
    token: destination.ifSchemaRevision,
    kind: "database_schema",
    projectId,
    subject: [destination.databaseBlockId],
    recovery: "query_database_again",
  });
  const schemaRevision = coordinate(schemaToken.state.revision, "Database schema");
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
  if (databaseRow.schema_revision !== schemaRevision) {
    throw new NodexAgentReadError(
      "conflict",
      `Database ${destination.databaseBlockId} schema changed after it was read`,
      false,
      "query_database_again",
      { resourceId: destination.databaseBlockId, domainCode: "database_schema_conflict" },
    );
  }
  validateValueDrafts(
    database,
    projectId,
    destination.databaseBlockId,
    destination.values,
  );
  if (!destination.view) {
    return { kind: "database", databaseBlockId: destination.databaseBlockId, schemaRevision };
  }
  const viewToken = decodeRevision(database, {
    token: destination.view.ifRevision,
    kind: "view",
    projectId,
    subject: [destination.view.viewId],
    recovery: "query_database_again",
  });
  const viewRevision = coordinate(viewToken.state.revision, "Database View");
  const tokenDatabaseId = viewToken.state.databaseBlockId;
  if (tokenDatabaseId !== destination.databaseBlockId) {
    throw new NodexAgentReadError(
      "conflict",
      `View ${destination.view.viewId} does not belong to the destination Database`,
      false,
      "query_database_again",
    );
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
  if (!viewRow || viewRow.revision !== viewRevision) {
    throw new NodexAgentReadError(
      "conflict",
      `View ${destination.view.viewId} changed after it was read`,
      false,
      "query_database_again",
      { resourceId: destination.view.viewId, domainCode: "view_revision_conflict" },
    );
  }
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
  const beforeCardBlockId = resolveSiblingAnchor(
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
      ...(beforeCardBlockId ? { beforeCardBlockId } : {}),
    },
  };
}

export function prepareNodexAgentDestination(
  database: Database.Database,
  projectId: string,
  destination: CreateInput["destination"],
): PreparedNodexAgentCreateDestination {
  if (destination.kind === "space") {
    return prepareSpaceDestination(database, projectId, destination);
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
  const output = CreateOutputSchema.parse(metadata.output);
  return CreateOutputSchema.parse({
    ...output,
    data: { ...output.data, receipt: { duplicate: true } },
  });
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
  const cardId = allocate();
  const nfm = request.input.resource.body?.content ?? "";
  let genesis;
  try {
    genesis = createCardDocumentGenesis({
      documentId: `document:${cardId}`,
      ...(richTitle(request.input)
        ? { richTitle: richTitle(request.input) as PortableRichText }
        : { title: plainTitle(request.input) }),
      nfm,
      allocateBlockId: allocate,
    });
  } catch (error) {
    throw new NodexAgentReadError(
      "invalid_nfm",
      error instanceof Error ? error.message : "Card NFM is invalid",
      false,
      "none",
    );
  }
  let bodyBlockIds: readonly string[];
  try {
    const blocks = flattenBlocks(genesis.materialization.blockTree);
    if (blocks.some((block) => block.type === "card")) {
      throw new NodexAgentReadError(
        "invalid_nfm",
        "Card creation NFM cannot create an owning nested Card; use create again",
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
  const command: NodexAgentCreateCardCommand = {
    threadId: request.threadId,
    callId: request.callId,
    projectId: request.projectId,
    requestHash,
    mutationId,
    storeEpoch,
    input: request.input,
    cardId,
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
  command: NodexAgentCreateCardCommand,
) {
  let bodyIndex = 0;
  const request = parseCardLifecycleMutationRequest({
    version: 1,
    operationId: `${command.mutationId}:genesis`,
    projectId: command.projectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: `nodex-agent:${command.threadId}`,
    actor: { kind: "nodex_agent", threadId: command.threadId, callId: command.callId },
    operation: {
      kind: "create_card",
      cardId: command.cardId,
      title: plainTitle(command.input),
      ...(richTitle(command.input) ? { richTitle: richTitle(command.input) } : {}),
      nfm: command.input.resource.body?.content ?? "",
      status: DEFAULT_CARD_STATUS,
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
  const result = applyCardLifecycleMutation(database, request, {
    allocateBodyBlockId: () => {
      const blockId = command.bodyBlockIds[bodyIndex];
      if (!blockId) throw new Error("Prepared Card body allocation is incomplete");
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
      "Prepared Card body allocations no longer match the NFM body",
      false,
      "none",
    );
  }
  return result.value;
}

function applySpaceOrDocumentPlacement(
  database: Database.Database,
  command: NodexAgentCreateCardCommand,
  lifecycle: ReturnType<typeof applyLifecycleGenesis>,
){
  if (command.destination.kind === "database") return null;
  if (!lifecycle.databaseBlockId || !lifecycle.membershipId) {
    throw new Error("Card genesis did not create its primary membership");
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
    rootBlockIds: [command.cardId],
    expectedLocationRevisions: { [command.cardId]: lifecycle.locationRevision },
    source: {
      kind: "database",
      databaseBlockId: lifecycle.databaseBlockId,
      memberships: {
        [command.cardId]: {
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
  cardId: string,
): { readonly id: string; readonly database_block_id: string; readonly revision: number } {
  const row = database.prepare(
    `
    SELECT id, database_block_id, revision
    FROM database_memberships
    WHERE card_block_id = ? AND removed_at IS NULL
    LIMIT 1
  `).get(cardId) as
    | { readonly id: string; readonly database_block_id: string; readonly revision: number }
    | undefined;
  if (!row) throw new Error(`Card ${cardId} has no active membership`);
  return row;
}

function databaseValueOperations(
  database: Database.Database,
  command: NodexAgentCreateCardCommand,
  expectedValueRevision: number,
): readonly DatabaseMutationOperation[] {
  if (command.destination.kind !== "database") return [];
  const destination = command.input.destination;
  if (destination.kind !== "database" || !destination.values?.length) return [];
  return [{
    kind: "set_values",
    databaseBlockId: command.destination.databaseBlockId,
    entries: destination.values.map((draft) => ({
      cardBlockId: command.cardId,
      propertyId: draft.propertyId,
      expectedValueRevision,
      value: draft.value as DatabaseJsonValue,
    })),
  }];
}

function applyDatabasePlacement(
  database: Database.Database,
  command: NodexAgentCreateCardCommand,
){
  if (command.destination.kind !== "database") return [];
  const receipts = [];
  const current = primaryMembership(database, command.cardId);
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
        cardBlockId: command.cardId,
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
      ...(command.destination.view.beforeCardBlockId
        ? { beforeCardBlockId: command.destination.view.beforeCardBlockId }
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
        cardBlockId: command.cardId,
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
  command: NodexAgentCreateCardCommand,
): void {
  const storeEpoch = readBlockStoreEpoch(database);
  if (storeEpoch !== command.storeEpoch) {
    throw new NodexAgentReadError(
      "conflict",
      "The Nodex store changed after Card creation was prepared",
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
        `Document ${command.destination.documentId} changed before Card creation`,
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
      `Database ${command.destination.databaseBlockId} schema changed before Card creation`,
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
      `View ${command.destination.view.viewId} changed before Card creation`,
      false,
      "query_database_again",
    );
  }
}

function createOutput(
  database: Database.Database,
  command: NodexAgentCreateCardCommand,
): CreateOutput {
  const block = database.prepare(
    `
    SELECT location_revision, location_kind,
      containing_document_id, containing_database_id
    FROM blocks WHERE id = ? AND project_id = ?
  `).get(command.cardId, command.projectId) as {
    readonly location_revision: number;
    readonly location_kind: "space" | "document" | "database";
    readonly containing_document_id: string | null;
    readonly containing_database_id: string | null;
  };
  const document = database.prepare(
    "SELECT generation, head_seq, schema_key, schema_version FROM documents WHERE id = ?",
  ).get(`document:${command.cardId}`) as {
    readonly generation: number;
    readonly head_seq: number;
    readonly schema_key: string;
    readonly schema_version: number;
  };
  const destination = command.destination;
  const valueRows = destination.kind === "database"
    ? database.prepare(
        `
        SELECT
          value.membership_id, membership.revision AS membership_revision,
          value.property_id, property.schema_revision AS property_schema_revision,
          value.revision AS value_revision
        FROM database_property_values value
        INNER JOIN database_memberships membership
          ON membership.id = value.membership_id
        INNER JOIN database_properties property
          ON property.id = value.property_id
        WHERE membership.card_block_id = ?
          AND membership.database_block_id = ?
          AND membership.project_id = ?
          AND membership.removed_at IS NULL
      `,
      ).all(command.cardId, destination.databaseBlockId, command.projectId) as DatabaseValueRow[]
    : [];
  const requestedPropertyIds = command.input.destination.kind === "database"
    ? new Set((command.input.destination.values ?? []).map((draft) => draft.propertyId))
    : new Set<string>();
  const placement = destination.kind === "database" && destination.view
    ? database.prepare(
        `
        SELECT position.revision, position.group_key, membership.id AS membership_id,
          membership.revision AS membership_revision
        FROM database_view_positions position
        INNER JOIN database_memberships membership
          ON membership.card_block_id = position.block_id
         AND membership.database_block_id = ?
         AND membership.project_id = position.project_id
         AND membership.removed_at IS NULL
        WHERE position.view_id = ? AND position.block_id = ?
          AND position.project_id = ?
      `,
      ).get(
        destination.databaseBlockId,
        destination.view.viewId,
        command.cardId,
        command.projectId,
      ) as {
        readonly revision: number;
        readonly group_key: string | null;
        readonly membership_id: string;
        readonly membership_revision: number;
      } | undefined
    : undefined;
  const groupPropertyId = destination.kind === "database" && destination.view
    ? (() => {
        const row = database.prepare(
          "SELECT config_json FROM database_views WHERE id = ?",
        ).get(destination.view.viewId) as { readonly config_json: string } | undefined;
        if (!row) return null;
        return parseGeneralDatabaseViewConfig(
          JSON.parse(row.config_json) as unknown,
        ).group?.propertyId ?? null;
      })()
    : null;
  const groupValueRevision = groupPropertyId
    ? valueRows.find((row) => row.property_id === groupPropertyId)?.value_revision ?? 0
    : 0;
  const output = CreateOutputSchema.parse({
    schemaVersion: 1,
    data: {
      resource: {
        kind: "card",
        blockId: command.cardId,
        documentId: `document:${command.cardId}`,
        documentRevision: mintRevision(database, {
          kind: "document",
          projectId: command.projectId,
          subject: [`document:${command.cardId}`],
          state: {
            generation: document.generation,
            headSeq: document.head_seq,
            schemaKey: document.schema_key,
            schemaVersion: document.schema_version,
          },
        }),
        locationRevision: mintRevision(database, {
          kind: "location",
          projectId: command.projectId,
          subject: [command.cardId],
          state: {
            revision: block.location_revision,
            locationKind: block.location_kind,
            containingDocumentId: block.containing_document_id,
            containingDatabaseId: block.containing_database_id,
          },
        }),
        createdBodyBlockIds: command.bodyBlockIds,
      },
      ...(destination.kind === "database" ? {
        database: {
          databaseBlockId: destination.databaseBlockId,
          valueRevisions: Object.fromEntries(valueRows
            .filter((row) => requestedPropertyIds.has(row.property_id))
            .map((row) => [row.property_id, mintRevision(database, {
              kind: "database_value",
              projectId: command.projectId,
              subject: [destination.databaseBlockId, command.cardId, row.property_id],
              state: {
                membershipId: row.membership_id,
                membershipRevision: row.membership_revision,
                propertySchemaRevision: row.property_schema_revision,
                valueRevision: row.value_revision,
              },
            })])),
          ...(destination.view && placement ? {
            placementRevision: mintRevision(database, {
              kind: "view_placement",
              projectId: command.projectId,
              subject: [destination.view.viewId, command.cardId],
              state: {
                databaseBlockId: destination.databaseBlockId,
                viewRevision: destination.view.viewRevision,
                membershipId: placement.membership_id,
                membershipRevision: placement.membership_revision,
                positionRevision: placement.revision,
                groupPropertyId,
                groupValueRevision,
                groupKey: placement.group_key,
              },
            }),
          } : {}),
        },
      } : {}),
      receipt: { duplicate: false },
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
    nodexAgentCallIdentity({ ...command, tool: "create" }),
  );
  return output;
}

function executeCreate(
  database: Database.Database,
  command: NodexAgentCreateCardCommand,
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
      documentCommits: placement?.documentCommits ?? [],
      affectedDatabaseBlockIds: [...new Set([
        ...(lifecycle.databaseBlockId ? [lifecycle.databaseBlockId] : []),
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
  command: NodexAgentCreateCardCommand,
  options: CreateExecutionOptions = {},
): ExecuteNodexAgentCreateResult {
  try {
    return database.transaction(() => executeCreate(database, command, options)).immediate();
  } catch (error) {
    return readFailure(error);
  }
}
