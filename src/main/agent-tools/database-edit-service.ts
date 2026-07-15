import type Database from "better-sqlite3";
import {
  DATABASE_MUTATION_CONTRACT_VERSION,
  databaseGroupValueFromKey,
  normalizeDatabasePropertyValue,
  parseDatabaseMutationRequest,
  parseDatabasePropertyConfig,
  parseGeneralDatabaseViewConfig,
  type DatabaseJsonValue,
  type DatabaseMutationOperation,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import {
  EditDatabaseOutputSchema,
  type EditDatabaseOutput,
  type ExecuteNodexAgentDatabaseEditResult,
  type NodexAgentDatabaseEditCommand,
  type PrepareNodexAgentDatabaseEditRequest,
  type PrepareNodexAgentDatabaseEditResult,
} from "../../shared/nodex-agent-tools";
import { readBlockStoreEpoch } from "../local-store/block-store-metadata";
import { applyDatabaseMutation } from "../local-store/database-kernel";
import {
  assertNodexAgentEtag,
  mintNodexAgentEtag,
  NodexAgentEtagError,
} from "../local-store/nodex-agent-etag";
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
} from "./read-support";
import {
  databaseValueEtagState,
  viewPlacementEtagState,
} from "./semantic-guards";

interface MembershipValueRow {
  readonly membership_id: string;
  readonly membership_revision: number;
  readonly property_schema_revision: number;
  readonly value_json: string;
  readonly value_revision: number;
  readonly value_type: DatabasePropertyValueType;
  readonly config_json: string;
}

interface ViewRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly revision: number;
  readonly config_json: string;
}

interface PlacementRow {
  readonly membership_id: string;
  readonly membership_revision: number;
  readonly position_revision: number;
  readonly group_key: string | null;
  readonly group_value_revision: number;
}

function requireDatabase(
  database: Database.Database,
  request: PrepareNodexAgentDatabaseEditRequest,
): void {
  const row = database.prepare(
    `
    SELECT capability.schema_revision
    FROM database_capabilities capability
    INNER JOIN blocks block
      ON block.id = capability.block_id
     AND block.project_id = capability.project_id
     AND block.type = 'database'
     AND block.lifecycle = 'active'
    WHERE capability.block_id = ? AND capability.project_id = ?
  `).get(request.input.databaseBlockId, request.projectId) as
    | { readonly schema_revision: number }
    | undefined;
  if (row) return;
  throw new NodexAgentReadError(
    "not_found",
    `Database ${request.input.databaseBlockId} is unavailable`,
    false,
    "query_database_again",
    { resourceId: request.input.databaseBlockId, domainCode: "database_not_found" },
  );
}

function readMembershipValue(
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly databaseBlockId: string;
    readonly blockId: string;
    readonly propertyId: string;
  },
): MembershipValueRow {
  const row = database.prepare(
    `
    SELECT
      membership.id AS membership_id,
      membership.revision AS membership_revision,
      property.schema_revision AS property_schema_revision,
      COALESCE(value.value_json, 'null') AS value_json,
      COALESCE(value.revision, 0) AS value_revision,
      property.value_type, property.config_json
    FROM database_memberships membership
    INNER JOIN database_properties property
      ON property.database_block_id = membership.database_block_id
     AND property.project_id = membership.project_id
     AND property.id = ?
     AND property.lifecycle = 'active'
    LEFT JOIN database_property_values value
      ON value.membership_id = membership.id
     AND value.property_id = property.id
    WHERE membership.card_block_id = ?
      AND membership.database_block_id = ?
      AND membership.project_id = ?
      AND membership.removed_at IS NULL
  `).get(
    input.propertyId,
    input.blockId,
    input.databaseBlockId,
    input.projectId,
  ) as MembershipValueRow | undefined;
  if (row) return row;
  throw new NodexAgentReadError(
    "not_found",
    `Block ${input.blockId} or property ${input.propertyId} is unavailable in the Database`,
    false,
    "query_database_again",
    { resourceId: input.blockId, domainCode: "database_value_not_found" },
  );
}

function compileValueSet(
  database: Database.Database,
  request: PrepareNodexAgentDatabaseEditRequest,
  edit: Extract<PrepareNodexAgentDatabaseEditRequest["input"]["edits"][number], {
    readonly kind: "value.set";
  }>,
): DatabaseMutationOperation {
  const row = readMembershipValue(database, {
    projectId: request.projectId,
    databaseBlockId: request.input.databaseBlockId,
    blockId: edit.blockId,
    propertyId: edit.propertyId,
  });
  try {
    assertNodexAgentEtag(database, edit.ifMatch, databaseValueEtagState({
      projectId: request.projectId,
      databaseBlockId: request.input.databaseBlockId,
      blockId: edit.blockId,
      propertyId: edit.propertyId,
      value: parseJsonValue(row.value_json, "Database value"),
      membershipId: row.membership_id,
      membershipRevision: row.membership_revision,
      propertySchemaRevision: row.property_schema_revision,
      valueRevision: row.value_revision,
    }));
  } catch (error) {
    if (!(error instanceof NodexAgentEtagError)) throw error;
    throw new NodexAgentReadError(
      error.code === "invalid_etag" ? "invalid_arguments" : "conflict",
      error.message,
      false,
      error.code === "invalid_etag" ? "none" : "query_database_again",
      { resourceId: edit.blockId, domainCode: error.code },
    );
  }
  try {
    normalizeDatabasePropertyValue(
      {
        valueType: row.value_type,
        config: parseDatabasePropertyConfig(
          row.value_type,
          JSON.parse(row.config_json) as unknown,
        ),
      },
      edit.value,
    );
  } catch (error) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Database value is invalid: ${error instanceof Error ? error.message : String(error)}`,
      false,
      "query_database_again",
      { resourceId: edit.propertyId, domainCode: "database_value_invalid" },
    );
  }
  return {
    kind: "set_value",
    cardBlockId: edit.blockId,
    databaseBlockId: request.input.databaseBlockId,
    propertyId: edit.propertyId,
    expectedValueRevision: row.value_revision,
    value: edit.value as DatabaseJsonValue,
  };
}

function compileSetIntent(
  database: Database.Database,
  request: PrepareNodexAgentDatabaseEditRequest,
  edit: Extract<PrepareNodexAgentDatabaseEditRequest["input"]["edits"][number], {
    readonly kind: "value.add_remove";
  }>,
): DatabaseMutationOperation {
  const overlap = edit.add.find((entry) => edit.remove.includes(entry));
  if (overlap) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Set value ${overlap} cannot be added and removed together`,
      false,
      "none",
    );
  }
  const row = readMembershipValue(database, {
    projectId: request.projectId,
    databaseBlockId: request.input.databaseBlockId,
    blockId: edit.blockId,
    propertyId: edit.propertyId,
  });
  if (row.value_type !== "multi_select") {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Property ${edit.propertyId} does not support add/remove set intent`,
      false,
      "query_database_again",
      { resourceId: edit.propertyId, domainCode: "property_type_mismatch" },
    );
  }
  return {
    kind: "add_remove_value",
    cardBlockId: edit.blockId,
    databaseBlockId: request.input.databaseBlockId,
    propertyId: edit.propertyId,
    add: edit.add,
    remove: edit.remove,
  };
}

function readView(
  database: Database.Database,
  projectId: string,
  databaseBlockId: string,
  viewId: string,
): ViewRow {
  const row = database.prepare(
    `
    SELECT id, database_block_id, revision, config_json
    FROM database_views
    WHERE id = ? AND database_block_id = ? AND project_id = ?
      AND lifecycle = 'active'
  `).get(viewId, databaseBlockId, projectId) as ViewRow | undefined;
  if (row) return row;
  throw new NodexAgentReadError(
    "not_found",
    `View ${viewId} is unavailable in the Database`,
    false,
    "query_database_again",
    { resourceId: viewId, domainCode: "view_not_found" },
  );
}

function readPlacement(
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly databaseBlockId: string;
    readonly view: ViewRow;
    readonly blockId: string;
    readonly groupPropertyId: string | null;
  },
): PlacementRow {
  const row = database.prepare(
    `
    SELECT
      membership.id AS membership_id,
      membership.revision AS membership_revision,
      position.revision AS position_revision,
      position.group_key,
      COALESCE(group_value.revision, 0) AS group_value_revision
    FROM database_view_positions position
    INNER JOIN database_memberships membership
      ON membership.card_block_id = position.block_id
     AND membership.database_block_id = ?
     AND membership.project_id = position.project_id
     AND membership.removed_at IS NULL
    LEFT JOIN database_property_values group_value
      ON group_value.membership_id = membership.id
     AND group_value.property_id = ?
    WHERE position.view_id = ? AND position.block_id = ?
      AND position.project_id = ?
  `).get(
    input.databaseBlockId,
    input.groupPropertyId,
    input.view.id,
    input.blockId,
    input.projectId,
  ) as PlacementRow | undefined;
  if (row) return row;
  throw new NodexAgentReadError(
    "not_found",
    `Block ${input.blockId} has no position in View ${input.view.id}`,
    false,
    "query_database_again",
    { resourceId: input.blockId, domainCode: "view_position_not_found" },
  );
}

function nextPlacementId(
  database: Database.Database,
  input: {
    readonly viewId: string;
    readonly projectId: string;
    readonly blockId: string;
    readonly groupKey: string | null;
  },
): string | null {
  const row = database.prepare(
    `
    SELECT candidate.block_id
    FROM database_view_positions current
    INNER JOIN database_view_positions candidate
      ON candidate.view_id = current.view_id
     AND candidate.project_id = current.project_id
     AND candidate.group_key IS current.group_key
     AND (
       candidate.rank_key > current.rank_key
       OR (candidate.rank_key = current.rank_key AND candidate.block_id > current.block_id)
     )
    WHERE current.view_id = ? AND current.project_id = ?
      AND current.block_id = ? AND current.group_key IS ?
    ORDER BY candidate.rank_key, candidate.block_id
    LIMIT 1
    `,
  ).get(input.viewId, input.projectId, input.blockId, input.groupKey) as
    | { readonly block_id: string }
    | undefined;
  return row?.block_id ?? null;
}

function validatePlacementEtag(
  database: Database.Database,
  request: PrepareNodexAgentDatabaseEditRequest,
  input: {
    readonly view: ViewRow;
    readonly blockId: string;
    readonly etag: string;
    readonly placement: PlacementRow;
  },
): void {
  try {
    assertNodexAgentEtag(database, input.etag, viewPlacementEtagState({
      projectId: request.projectId,
      databaseBlockId: request.input.databaseBlockId,
      viewId: input.view.id,
      blockId: input.blockId,
      groupKey: input.placement.group_key,
      beforeBlockId: nextPlacementId(database, {
        viewId: input.view.id,
        projectId: request.projectId,
        blockId: input.blockId,
        groupKey: input.placement.group_key,
      }),
      membershipId: input.placement.membership_id,
      membershipRevision: input.placement.membership_revision,
      viewRevision: input.view.revision,
      positionRevision: input.placement.position_revision,
      groupValueRevision: input.placement.group_value_revision,
    }));
  } catch (error) {
    if (!(error instanceof NodexAgentEtagError)) throw error;
    throw new NodexAgentReadError(
      error.code === "invalid_etag" ? "invalid_arguments" : "conflict",
      error.message,
      false,
      error.code === "invalid_etag" ? "none" : "query_database_again",
      { resourceId: input.blockId, domainCode: error.code },
    );
  }
}

function beforePlacementId(
  database: Database.Database,
  input: {
    readonly viewId: string;
    readonly projectId: string;
    readonly groupKey: string | null;
    readonly selected: ReadonlySet<string>;
    readonly at: Extract<PrepareNodexAgentDatabaseEditRequest["input"]["edits"][number], {
      readonly kind: "view.place";
    }>["at"];
  },
): string | undefined {
  const ids = (database.prepare(
    `
    SELECT block_id
    FROM database_view_positions
    WHERE view_id = ? AND project_id = ? AND group_key IS ?
    ORDER BY rank_key, block_id
  `).all(input.viewId, input.projectId, input.groupKey) as readonly {
    readonly block_id: string;
  }[]).map((row) => row.block_id).filter((id) => !input.selected.has(id));
  if (!input.at || input.at.kind === "end") return undefined;
  if (input.at.kind === "start") return ids[0];
  if (input.selected.has(input.at.blockId)) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      "View placement anchor cannot be one of the moved Blocks",
      false,
      "none",
    );
  }
  const index = ids.indexOf(input.at.blockId);
  if (index < 0) {
    throw new NodexAgentReadError(
      "conflict",
      `View placement anchor ${input.at.blockId} is unavailable in the target group`,
      false,
      "query_database_again",
      { resourceId: input.at.blockId, domainCode: "position_anchor_not_found" },
    );
  }
  return input.at.kind === "before" ? ids[index] : ids[index + 1];
}

function compileViewPlacement(
  database: Database.Database,
  request: PrepareNodexAgentDatabaseEditRequest,
  edit: Extract<PrepareNodexAgentDatabaseEditRequest["input"]["edits"][number], {
    readonly kind: "view.place";
  }>,
): readonly DatabaseMutationOperation[] {
  const view = readView(
    database,
    request.projectId,
    request.input.databaseBlockId,
    edit.viewId,
  );
  const config = parseGeneralDatabaseViewConfig(JSON.parse(view.config_json) as unknown);
  const groupPropertyId = config.group?.propertyId ?? null;
  const groupKey = edit.groupKey ?? null;
  if (!groupPropertyId && groupKey !== null) {
    throw new NodexAgentReadError(
      "invalid_arguments",
      `Ungrouped View ${edit.viewId} requires a null groupKey`,
      false,
      "query_database_again",
    );
  }
  const placements = edit.items.map((item) => {
    const placement = readPlacement(database, {
      projectId: request.projectId,
      databaseBlockId: request.input.databaseBlockId,
      view,
      blockId: item.blockId,
      groupPropertyId,
    });
    validatePlacementEtag(database, request, {
      view,
      blockId: item.blockId,
      etag: item.ifMatch,
      placement,
    });
    return { item, placement };
  });
  const selected = new Set(edit.items.map((item) => item.blockId));
  const beforeCardBlockId = beforePlacementId(database, {
    viewId: edit.viewId,
    projectId: request.projectId,
    groupKey,
    selected,
    at: edit.at,
  });
  const groupValues = groupPropertyId
    ? (() => {
        const property = database.prepare(
          `
          SELECT value_type, config_json
          FROM database_properties
          WHERE id = ? AND database_block_id = ? AND project_id = ?
            AND lifecycle = 'active'
        `,
        ).get(groupPropertyId, request.input.databaseBlockId, request.projectId) as
          | { readonly value_type: DatabasePropertyValueType; readonly config_json: string }
          | undefined;
        if (!property) {
          throw new NodexAgentReadError(
            "projection_not_ready",
            `View ${edit.viewId} grouping property is unavailable`,
            true,
            "query_database_again",
          );
        }
        const rawValue = databaseGroupValueFromKey(property.value_type, groupKey);
        const value = normalizeDatabasePropertyValue(
          {
            valueType: property.value_type,
            config: parseDatabasePropertyConfig(
              property.value_type,
              JSON.parse(property.config_json) as unknown,
            ),
          },
          rawValue,
        );
        return [{
          kind: "set_values" as const,
          databaseBlockId: request.input.databaseBlockId,
          entries: placements.map(({ item, placement }) => ({
            cardBlockId: item.blockId,
            propertyId: groupPropertyId,
            expectedValueRevision: placement.group_value_revision,
            value,
          })),
        }];
      })()
    : [];
  return [
    ...groupValues,
    {
      kind: "position_cards",
      viewId: edit.viewId,
      cards: placements.map(({ item, placement }) => ({
        cardBlockId: item.blockId,
        expectedPositionRevision: placement.position_revision,
      })),
      groupKey,
      ...(beforeCardBlockId ? { beforeCardBlockId } : {}),
    },
  ];
}

function replayOutput(receipt: NodexAgentCallReceiptRow): EditDatabaseOutput {
  const metadata = parseJsonValue(
    receipt.result_metadata_json,
    `Agent call ${receipt.call_identity} result metadata`,
  );
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error("Agent Database edit result metadata is invalid");
  }
  return EditDatabaseOutputSchema.parse(metadata.output);
}

function prepareDatabaseEdit(
  database: Database.Database,
  request: PrepareNodexAgentDatabaseEditRequest,
): PrepareNodexAgentDatabaseEditResult {
  requireProject(database, request.projectId);
  const key = { ...request, tool: "edit_database" };
  const identity = nodexAgentCallIdentity(key);
  const requestHash = nodexAgentFingerprint({
    tool: "edit_database",
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
  requireDatabase(database, request);
  const operations = request.input.edits.flatMap((edit): readonly DatabaseMutationOperation[] => {
    if (edit.kind === "value.set") {
      return [compileValueSet(database, request, edit)];
    }
    if (edit.kind === "value.add_remove") {
      return [compileSetIntent(database, request, edit)];
    }
    return compileViewPlacement(database, request, edit);
  });
  const storeEpoch = readBlockStoreEpoch(database);
  if (!storeEpoch) throw new Error("Nodex store has no epoch");
  const mutationId = existing?.mutation_id ?? `nodex-database:${identity}`;
  const mutation = {
    version: DATABASE_MUTATION_CONTRACT_VERSION,
    operationId: mutationId,
    projectId: request.projectId,
    storeEpoch,
    clientSessionId: `nodex-agent:${request.threadId}`,
    actor: { kind: "nodex_agent", threadId: request.threadId, callId: request.callId },
    operations,
  } as const;
  parseDatabaseMutationRequest(mutation);
  const now = new Date().toISOString();
  if (!existing) {
    database.prepare(
      `
      INSERT INTO nodex_agent_call_receipts (
        call_identity, thread_id, call_id, project_id, tool, request_hash,
        mutation_id, allocations_json, result_metadata_json, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'edit_database', ?, ?, '[]', '{}', 'prepared', ?, ?)
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
        mutation,
      },
    },
  };
}

function outputDatabaseEdit(
  database: Database.Database,
  command: NodexAgentDatabaseEditCommand,
): EditDatabaseOutput {
  const valueTargets = command.mutation.operations.flatMap((operation) => {
    if (operation.kind === "set_value" || operation.kind === "add_remove_value") {
      return [{ blockId: operation.cardBlockId, propertyId: operation.propertyId }];
    }
    if (operation.kind === "set_values") {
      return operation.entries.map((entry) => ({
        blockId: entry.cardBlockId,
        propertyId: entry.propertyId,
      }));
    }
    return [];
  });
  const uniqueValues = [...new Map(valueTargets.map((target) => [
    `${target.blockId}\0${target.propertyId}`,
    target,
  ])).values()];
  const placementTargets = command.mutation.operations.flatMap((operation) => {
    if (operation.kind === "position_card") {
      return [{ blockId: operation.cardBlockId, viewId: operation.viewId }];
    }
    if (operation.kind === "position_cards") {
      return operation.cards.map((entry) => ({
        blockId: entry.cardBlockId,
        viewId: operation.viewId,
      }));
    }
    return [];
  });
  const uniquePlacements = [...new Map(placementTargets.map((target) => [
    `${target.blockId}\0${target.viewId}`,
    target,
  ])).values()];
  const includeEtags = command.input.return?.etags === true;
  return EditDatabaseOutputSchema.parse({
    data: {
      databaseBlockId: command.input.databaseBlockId,
      effects: {
        valuesSet: command.input.edits.filter((edit) => edit.kind === "value.set").length,
        setsChanged: command.input.edits.filter(
          (edit) => edit.kind === "value.add_remove",
        ).length,
        placementsChanged: command.input.edits.reduce(
          (count, edit) => count + (edit.kind === "view.place" ? edit.items.length : 0),
          0,
        ),
      },
      ...(includeEtags ? { etags: {
        values: uniqueValues.map((target) => {
        const row = readMembershipValue(database, {
          projectId: command.projectId,
          databaseBlockId: command.input.databaseBlockId,
          blockId: target.blockId,
          propertyId: target.propertyId,
        });
        return {
          blockId: target.blockId,
          propertyId: target.propertyId,
          etag: mintNodexAgentEtag(database, databaseValueEtagState({
            projectId: command.projectId,
            databaseBlockId: command.input.databaseBlockId,
            blockId: target.blockId,
            propertyId: target.propertyId,
            value: parseJsonValue(row.value_json, "Database value"),
            membershipId: row.membership_id,
            membershipRevision: row.membership_revision,
            propertySchemaRevision: row.property_schema_revision,
            valueRevision: row.value_revision,
          })),
        };
      }),
        placements: uniquePlacements.map((target) => {
        const view = readView(
          database,
          command.projectId,
          command.input.databaseBlockId,
          target.viewId,
        );
        const config = parseGeneralDatabaseViewConfig(
          JSON.parse(view.config_json) as unknown,
        );
        const groupPropertyId = config.group?.propertyId ?? null;
        const placement = readPlacement(database, {
          projectId: command.projectId,
          databaseBlockId: command.input.databaseBlockId,
          view,
          blockId: target.blockId,
          groupPropertyId,
        });
        return {
          blockId: target.blockId,
          viewId: target.viewId,
          etag: mintNodexAgentEtag(database, viewPlacementEtagState({
            projectId: command.projectId,
            databaseBlockId: command.input.databaseBlockId,
            viewId: target.viewId,
            blockId: target.blockId,
            groupKey: placement.group_key,
            beforeBlockId: nextPlacementId(database, {
              viewId: target.viewId,
              projectId: command.projectId,
              blockId: target.blockId,
              groupKey: placement.group_key,
            }),
            membershipId: placement.membership_id,
            membershipRevision: placement.membership_revision,
            viewRevision: view.revision,
            positionRevision: placement.position_revision,
            groupValueRevision: placement.group_value_revision,
          })),
        };
      }),
      } } : {}),
    },
  });
}

function executeDatabaseEdit(
  database: Database.Database,
  command: NodexAgentDatabaseEditCommand,
): ExecuteNodexAgentDatabaseEditResult {
  const identity = nodexAgentCallIdentity({ ...command, tool: "edit_database" });
  const callReceipt = readNodexAgentCallReceipt(database, identity);
  if (!callReceipt) {
    throw new NodexAgentReadError(
      "idempotency_collision",
      "No matching prepared Agent Database edit exists",
      false,
      "none",
    );
  }
  requireMatchingNodexAgentCallReceipt(
    callReceipt,
    { ...command, tool: "edit_database" },
    command.requestHash,
  );
  if (callReceipt.status === "committed") {
    return {
      ok: true,
      value: {
        output: replayOutput(callReceipt),
        duplicate: true,
        affectedDatabaseBlockIds: [],
        changeLogSeq: 0,
      },
    };
  }
  if (readBlockStoreEpoch(database) !== command.storeEpoch) {
    throw new NodexAgentReadError(
      "conflict",
      "The Nodex store changed after Database edit preparation",
      false,
      "query_database_again",
    );
  }
  const result = applyDatabaseMutation(database, command.mutation);
  if (!result.ok) {
    throw new NodexAgentReadError(
      result.error.code.includes("conflict") ? "conflict" : "invalid_arguments",
      result.error.message,
      result.error.retryable,
      result.error.code.includes("conflict") ? "query_database_again" : "none",
      { domainCode: result.error.code },
    );
  }
  const output = outputDatabaseEdit(database, command);
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
      affectedDatabaseBlockIds: result.value.affectedDatabaseBlockIds,
      changeLogSeq: result.value.changeLogSeq,
    },
  };
}

export function prepareNodexAgentDatabaseEdit(
  database: Database.Database,
  request: PrepareNodexAgentDatabaseEditRequest,
): PrepareNodexAgentDatabaseEditResult {
  try {
    return database.transaction(() => prepareDatabaseEdit(database, request)).immediate();
  } catch (error) {
    return readFailure(error);
  }
}

export function executeNodexAgentDatabaseEdit(
  database: Database.Database,
  command: NodexAgentDatabaseEditCommand,
): ExecuteNodexAgentDatabaseEditResult {
  try {
    return database.transaction(() => executeDatabaseEdit(database, command)).immediate();
  } catch (error) {
    return readFailure(error);
  }
}
