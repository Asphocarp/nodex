import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  parseDatabasePropertyConfig,
  parseDatabaseViewConfigV2,
  type DatabaseJsonValue,
  type DatabaseViewFilterNode,
} from "../../shared/database-kernel";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import {
  LEGACY_WORKFLOW_STATUS_ORDER,
  WORKFLOW_STATUS_CUTOVER_MAP,
  isLegacyWorkflowStatus,
  upgradeLegacyWorkflowStatus,
} from "../../shared/workflow-status-cutover";
import {
  WORKFLOW_STATUS_COLUMNS,
  WORKFLOW_STATUS_LABELS,
  isWorkflowStatus,
  type WorkflowStatus,
} from "../../shared/workflow-status";
import { DatabaseIdentityCutoverError } from "./database-identity-cutover";

const SOURCE_SCHEMA_VERSION = 81;
const TARGET_SCHEMA_VERSION = 82;
const IMMUTABLE_EVIDENCE_TRIGGERS = [
  "block_mutations_are_immutable",
  "change_log_is_immutable",
] as const;

export const WORKFLOW_STATUS_CUTOVER_FAULT_POINTS = [
  "after_preflight",
  "after_authority_rewrite",
  "after_projection_rewrite",
  "after_evidence_rewrite",
  "before_publish",
] as const;

export type WorkflowStatusCutoverFaultPoint =
  (typeof WORKFLOW_STATUS_CUTOVER_FAULT_POINTS)[number];

export interface WorkflowStatusCutoverSqliteOptions {
  readonly nextStoreEpoch?: string;
  readonly now?: string;
  readonly injectFault?: (point: WorkflowStatusCutoverFaultPoint) => void;
}

export interface WorkflowStatusCutoverSqliteReport {
  readonly sourceVersion: typeof SOURCE_SCHEMA_VERSION;
  readonly targetVersion: typeof TARGET_SCHEMA_VERSION;
  readonly previousStoreEpoch: string;
  readonly nextStoreEpoch: string;
  readonly migratedStatusProperties: number;
  readonly migratedStatusValues: number;
  readonly rewrittenViews: number;
  readonly rewrittenPositions: number;
  readonly rewrittenReadModels: number;
  readonly rewrittenEvidenceAggregates: number;
  readonly clearedDatabaseModuleReceipts: number;
  readonly clearedAgentCallReceipts: number;
}

interface NamedSqliteObject {
  readonly name: string;
  readonly sql: string;
}

interface StatusPropertyRow {
  readonly data_source_id: string;
  readonly config_json: string;
  readonly value_type: string;
}

interface StatusValueRow {
  readonly membership_id: string;
  readonly data_source_id: string;
  readonly property_id: string;
  readonly value_json: string;
}

interface ViewRow {
  readonly id: string;
  readonly config_json: string;
}

interface EvidenceRow {
  readonly mutation_id: string;
  readonly mutation_kind: string;
  readonly request_hash: string;
  readonly request_json: string;
  readonly field_intents_json: string;
  readonly expected_revisions_json: string;
  readonly result_json: string;
  readonly committed_revisions_json: string;
  readonly change_log_seq: number;
  readonly change_payload_json: string;
}

const canonicalJson = (value: unknown): string =>
  stableStringifyBlockPropertyJson(value);

const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new DatabaseIdentityCutoverError(
      `${label} is not valid JSON`,
      { cause: error },
    );
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

const tableExists = (
  database: Database.Database,
  tableName: string,
): boolean =>
  database
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get(tableName) !== undefined;

const requireTables = (
  database: Database.Database,
  tableNames: readonly string[],
): void => {
  const missing = tableNames.filter((tableName) => !tableExists(database, tableName));
  if (missing.length === 0) return;
  throw new DatabaseIdentityCutoverError(
    `Schema v81 status cutover is missing required table(s): ${missing.join(", ")}`,
  );
};

const mapLegacyStatus = (value: unknown, label: string): WorkflowStatus => {
  if (isLegacyWorkflowStatus(value)) return WORKFLOW_STATUS_CUTOVER_MAP[value];
  throw new DatabaseIdentityCutoverError(
    `${label} is not a recognized v81 workflow status`,
  );
};

const rewriteStatusValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return upgradeLegacyWorkflowStatus(value) ?? value;
  }
  if (Array.isArray(value)) return value.map(rewriteStatusValue);
  return value;
};

const rewriteStatusFilterValue = (
  value: DatabaseJsonValue,
  label: string,
): DatabaseJsonValue => {
  if (typeof value === "string") return mapLegacyStatus(value, label);
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      rewriteStatusFilterValue(entry, `${label}[${index}]`));
  }
  return value;
};

const statusPathPattern = /(?:^|\.)properties\.status(?:\.|$)/u;
const statusValueKeys = new Set([
  "columnId",
  "fromStatus",
  "toStatus",
  "sourceStatus",
  "viewGroupKey",
]);
const workflowStatusMutationKinds = new Set([
  "block_transfer",
  "database_module_apply_v2",
  "database_operation",
  "page_clone",
  "page_lifecycle",
  "page_lifecycle_v2",
]);

const rewriteStatusPath = (value: string): string => {
  if (!statusPathPattern.test(value)) return value;
  for (const legacyStatus of LEGACY_WORKFLOW_STATUS_ORDER) {
    const suffix = `.options.${legacyStatus}`;
    if (!value.endsWith(suffix)) continue;
    return `${value.slice(0, -suffix.length)}.options.${WORKFLOW_STATUS_CUTOVER_MAP[legacyStatus]}`;
  }
  return value;
};

const rewriteEvidenceJson = (
  value: unknown,
  statusContext = false,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteEvidenceJson(entry, statusContext));
  }
  if (!isRecord(value)) {
    return statusContext ? rewriteStatusValue(value) : value;
  }

  const recordStatusContext = statusContext
    || value.propertyId === "status"
    || (typeof value.path === "string" && statusPathPattern.test(value.path));
  const rewritten: Record<string, unknown> = {};
  for (const [originalKey, candidate] of Object.entries(value)) {
    const key = rewriteStatusPath(originalKey);
    if (key === "actor") {
      rewritten[key] = candidate;
      continue;
    }
    if (key === "path" && typeof candidate === "string") {
      rewritten[key] = rewriteStatusPath(candidate);
      continue;
    }
    if (
      recordStatusContext
      && key === "name"
      && typeof value.id === "string"
      && isLegacyWorkflowStatus(value.id)
    ) {
      rewritten[key] = WORKFLOW_STATUS_LABELS[WORKFLOW_STATUS_CUTOVER_MAP[value.id]];
      continue;
    }
    if ((recordStatusContext && key === "status") || statusValueKeys.has(key)) {
      rewritten[key] = rewriteStatusValue(candidate);
      continue;
    }
    if (key === "groupKey" && typeof candidate === "string") {
      rewritten[key] = rewriteStatusValue(candidate);
      continue;
    }
    if (
      recordStatusContext
      && (key === "value" || key === "add" || key === "remove")
    ) {
      rewritten[key] = rewriteStatusValue(candidate);
      continue;
    }
    rewritten[key] = rewriteEvidenceJson(candidate, recordStatusContext);
  }
  return rewritten;
};

const rewriteFilter = (
  filter: DatabaseViewFilterNode,
  viewId: string,
): DatabaseViewFilterNode => {
  if (filter.kind === "group") {
    return {
      ...filter,
      children: filter.children.map((child) => rewriteFilter(child, viewId)),
    };
  }
  if (filter.propertyId !== "status" || filter.value === undefined) return filter;
  return {
    ...filter,
    value: rewriteStatusFilterValue(filter.value, `View ${viewId} status filter`),
  };
};

const rewriteStatusPropertyConfig = (
  row: StatusPropertyRow,
): string => {
  if (row.value_type !== "select") {
    throw new DatabaseIdentityCutoverError(
      `Data Source ${row.data_source_id} status property is not select`,
    );
  }
  const config = parseDatabasePropertyConfig("select", parseJson(
    row.config_json,
    `Data Source ${row.data_source_id} status config`,
  ));
  const options = config.options;
  if (!Array.isArray(options) || options.length !== LEGACY_WORKFLOW_STATUS_ORDER.length) {
    throw new DatabaseIdentityCutoverError(
      `Data Source ${row.data_source_id} status registry is not the exact v81 shape`,
    );
  }
  const optionById = new Map<string, Record<string, unknown>>();
  for (const candidate of options) {
    if (!isRecord(candidate) || typeof candidate.id !== "string") {
      throw new DatabaseIdentityCutoverError(
        `Data Source ${row.data_source_id} status registry contains an invalid option`,
      );
    }
    if (optionById.has(candidate.id)) {
      throw new DatabaseIdentityCutoverError(
        `Data Source ${row.data_source_id} status registry contains duplicate option ${candidate.id}`,
      );
    }
    optionById.set(candidate.id, candidate);
  }
  if (
    optionById.size !== LEGACY_WORKFLOW_STATUS_ORDER.length
    || LEGACY_WORKFLOW_STATUS_ORDER.some((status) => !optionById.has(status))
  ) {
    throw new DatabaseIdentityCutoverError(
      `Data Source ${row.data_source_id} status registry contains an unknown v81 identity`,
    );
  }
  return canonicalJson({
    ...config,
    options: LEGACY_WORKFLOW_STATUS_ORDER.map((legacyStatus) => {
      const option = optionById.get(legacyStatus);
      if (!option) {
        throw new DatabaseIdentityCutoverError(
          `Data Source ${row.data_source_id} status registry is incomplete`,
        );
      }
      const status = WORKFLOW_STATUS_CUTOVER_MAP[legacyStatus];
      return {
        ...option,
        id: status,
        name: WORKFLOW_STATUS_LABELS[status],
      };
    }),
  });
};

const readImmutableTriggers = (
  database: Database.Database,
): readonly NamedSqliteObject[] =>
  IMMUTABLE_EVIDENCE_TRIGGERS.map((name) => {
    const trigger = database.prepare(`
      SELECT name, sql FROM sqlite_schema
      WHERE type = 'trigger' AND name = ? AND sql IS NOT NULL
    `).get(name) as NamedSqliteObject | undefined;
    if (trigger) return trigger;
    throw new DatabaseIdentityCutoverError(
      `Schema v81 is missing immutable evidence trigger ${name}`,
    );
  });

const rewriteCommittedEvidence = (database: Database.Database): number => {
  const triggers = readImmutableTriggers(database);
  const rows = database.prepare(`
    SELECT
      mutation.mutation_id,
      mutation.mutation_kind,
      mutation.request_hash,
      mutation.request_json,
      mutation.field_intents_json,
      mutation.expected_revisions_json,
      mutation.result_json,
      mutation.committed_revisions_json,
      mutation.change_log_seq,
      change.payload_json AS change_payload_json
    FROM block_mutations mutation
    INNER JOIN change_log change ON change.seq = mutation.change_log_seq
    WHERE mutation.outcome = 'committed'
    ORDER BY mutation.recorded_at, mutation.mutation_id
  `).all() as readonly EvidenceRow[];

  const rewrites = rows.flatMap((row) => {
    const workflowStatusContext = workflowStatusMutationKinds.has(
      row.mutation_kind,
    );
    const requestJson = canonicalJson(rewriteEvidenceJson(parseJson(
      row.request_json,
      `Mutation ${row.mutation_id} request`,
    ), workflowStatusContext));
    const requestHash = createHash("sha256").update(requestJson).digest("hex");
    const fieldIntentsJson = canonicalJson(rewriteEvidenceJson(parseJson(
      row.field_intents_json,
      `Mutation ${row.mutation_id} field intents`,
    ), workflowStatusContext));
    const expectedRevisionsJson = canonicalJson(rewriteEvidenceJson(parseJson(
      row.expected_revisions_json,
      `Mutation ${row.mutation_id} expected revisions`,
    ), workflowStatusContext));
    const resultJson = canonicalJson(rewriteEvidenceJson(parseJson(
      row.result_json,
      `Mutation ${row.mutation_id} result`,
    ), workflowStatusContext));
    const committedRevisionsJson = canonicalJson(rewriteEvidenceJson(parseJson(
      row.committed_revisions_json,
      `Mutation ${row.mutation_id} committed revisions`,
    ), workflowStatusContext));
    const rawChangePayload = rewriteEvidenceJson(parseJson(
      row.change_payload_json,
      `Mutation ${row.mutation_id} change payload`,
    ), workflowStatusContext);
    const changePayload = isRecord(rawChangePayload)
      && Object.hasOwn(rawChangePayload, "requestHash")
      ? { ...rawChangePayload, requestHash }
      : rawChangePayload;
    const changePayloadJson = canonicalJson(changePayload);
    const changed = requestJson !== row.request_json
      || requestHash !== row.request_hash
      || fieldIntentsJson !== row.field_intents_json
      || expectedRevisionsJson !== row.expected_revisions_json
      || resultJson !== row.result_json
      || committedRevisionsJson !== row.committed_revisions_json
      || changePayloadJson !== row.change_payload_json;
    return changed
      ? [{
          ...row,
          requestJson,
          requestHash,
          fieldIntentsJson,
          expectedRevisionsJson,
          resultJson,
          committedRevisionsJson,
          changePayloadJson,
        }]
      : [];
  });

  for (const trigger of triggers) {
    database.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)}`);
  }
  try {
    const updateMutation = database.prepare(`
      UPDATE block_mutations
      SET request_json = ?, request_hash = ?, field_intents_json = ?,
        expected_revisions_json = ?, result_json = ?, committed_revisions_json = ?
      WHERE mutation_id = ?
    `);
    const updateChange = database.prepare(
      "UPDATE change_log SET payload_json = ? WHERE seq = ?",
    );
    for (const rewrite of rewrites) {
      updateMutation.run(
        rewrite.requestJson,
        rewrite.requestHash,
        rewrite.fieldIntentsJson,
        rewrite.expectedRevisionsJson,
        rewrite.resultJson,
        rewrite.committedRevisionsJson,
        rewrite.mutation_id,
      );
      updateChange.run(rewrite.changePayloadJson, rewrite.change_log_seq);
    }
  } finally {
    for (const trigger of triggers) database.exec(trigger.sql);
  }
  return rewrites.length;
};

const clearAgentCallReceipts = (database: Database.Database): number => {
  if (!tableExists(database, "nodex_agent_call_receipts")) return 0;
  const triggerName = "nodex_agent_committed_call_receipts_cannot_delete";
  const trigger = database.prepare(`
    SELECT name, sql FROM sqlite_schema
    WHERE type = 'trigger' AND name = ? AND sql IS NOT NULL
  `).get(triggerName) as NamedSqliteObject | undefined;
  if (!trigger) {
    throw new DatabaseIdentityCutoverError(
      `Schema v81 is missing Agent receipt trigger ${triggerName}`,
    );
  }
  database.exec(`DROP TRIGGER ${quoteIdentifier(triggerName)}`);
  try {
    return database.prepare("DELETE FROM nodex_agent_call_receipts").run().changes;
  } finally {
    database.exec(trigger.sql);
  }
};

const assertPublishedFilter = (
  filter: DatabaseViewFilterNode,
  viewId: string,
): void => {
  if (filter.kind === "group") {
    for (const child of filter.children) assertPublishedFilter(child, viewId);
    return;
  }
  if (filter.propertyId !== "status" || filter.value === undefined) return;
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  for (const value of values) {
    if (typeof value !== "string") continue;
    if (isWorkflowStatus(value)) continue;
    throw new DatabaseIdentityCutoverError(
      `View ${viewId} retained a non-canonical status filter`,
    );
  }
};

const assertPublishedStatusState = (
  database: Database.Database,
  statusGroupedViewIds: ReadonlySet<string>,
): void => {
  const properties = database.prepare(`
    SELECT data_source_id, config_json, value_type
    FROM data_source_properties
    WHERE id = 'status'
  `).all() as readonly StatusPropertyRow[];
  for (const property of properties) {
    const config = parseDatabasePropertyConfig(
      "select",
      parseJson(property.config_json, "Published status config"),
    );
    const publishedOptions = Array.isArray(config.options)
      ? config.options.map((option) => isRecord(option)
        ? { id: option.id, name: option.name }
        : option)
      : config.options;
    if (canonicalJson(publishedOptions) !== canonicalJson(WORKFLOW_STATUS_COLUMNS)) {
      throw new DatabaseIdentityCutoverError(
        `Data Source ${property.data_source_id} did not publish the canonical status registry`,
      );
    }
  }

  const values = database.prepare(`
    SELECT value.value_json
    FROM data_source_property_values value
    WHERE value.property_id = 'status'
  `).all() as readonly { readonly value_json: string }[];
  for (const row of values) {
    const value = parseJson(row.value_json, "Published status value");
    if (!isWorkflowStatus(value)) {
      throw new DatabaseIdentityCutoverError("Published status value is invalid");
    }
  }

  const views = database.prepare(`
    SELECT id, config_json FROM database_views
  `).all() as readonly ViewRow[];
  for (const view of views) {
    const config = parseDatabaseViewConfigV2(parseJson(
      view.config_json,
      `Published View ${view.id}`,
    ));
    assertPublishedFilter(config.filter, view.id);
  }

  const positions = database.prepare(`
    SELECT view_id, group_key FROM database_view_page_positions
  `).all() as readonly { readonly view_id: string; readonly group_key: string | null }[];
  for (const position of positions) {
    if (!statusGroupedViewIds.has(position.view_id) || position.group_key === null) continue;
    if (!isWorkflowStatus(position.group_key)) {
      throw new DatabaseIdentityCutoverError("Published status position is not canonical");
    }
  }

  const readModels = database.prepare(`
    SELECT page_block_id, database_values_json, view_id, view_group_key
    FROM page_read_model
  `).all() as readonly {
    readonly page_block_id: string;
    readonly database_values_json: string;
    readonly view_id: string | null;
    readonly view_group_key: string | null;
  }[];
  for (const row of readModels) {
    const valuesJson = parseJson(
      row.database_values_json,
      `Published Page ${row.page_block_id} read model values`,
    );
    if (!isRecord(valuesJson)) {
      throw new DatabaseIdentityCutoverError(
        `Published Page ${row.page_block_id} read model values are invalid`,
      );
    }
    if (Object.hasOwn(valuesJson, "status") && !isWorkflowStatus(valuesJson.status)) {
      throw new DatabaseIdentityCutoverError(
        `Published Page ${row.page_block_id} read model status is not canonical`,
      );
    }
    if (
      row.view_id !== null
      && statusGroupedViewIds.has(row.view_id)
      && row.view_group_key !== null
      && !isWorkflowStatus(row.view_group_key)
    ) {
      throw new DatabaseIdentityCutoverError(
        `Published Page ${row.page_block_id} read model group is not canonical`,
      );
    }
  }

  const foreignKeyViolations = database.pragma("foreign_key_check") as readonly unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new DatabaseIdentityCutoverError(
      `Schema v82 pre-publish audit found ${foreignKeyViolations.length} foreign-key violation(s)`,
    );
  }
  const quickCheck = database.pragma("quick_check", { simple: true });
  if (quickCheck !== "ok") {
    throw new DatabaseIdentityCutoverError(`Schema v82 quick_check failed: ${String(quickCheck)}`);
  }
};

const migrateInsideTransaction = (
  database: Database.Database,
  options: WorkflowStatusCutoverSqliteOptions,
): WorkflowStatusCutoverSqliteReport => {
  const properties = database.prepare(`
    SELECT data_source_id, config_json, value_type
    FROM data_source_properties
    WHERE id = 'status'
    ORDER BY data_source_id
  `).all() as readonly StatusPropertyRow[];
  const rewrittenPropertyConfigs = properties.map((property) => ({
    dataSourceId: property.data_source_id,
    configJson: rewriteStatusPropertyConfig(property),
  }));
  const values = database.prepare(`
    SELECT membership_id, data_source_id, property_id, value_json
    FROM data_source_property_values
    WHERE property_id = 'status'
    ORDER BY data_source_id, membership_id
  `).all() as readonly StatusValueRow[];
  const rewrittenValues = values.map((row) => ({
    ...row,
    valueJson: canonicalJson(mapLegacyStatus(
      parseJson(row.value_json, `Status value ${row.membership_id}`),
      `Status value ${row.membership_id}`,
    )),
  }));
  const views = database.prepare(`
    SELECT id, config_json FROM database_views ORDER BY id
  `).all() as readonly ViewRow[];
  const rewrittenViews = views.map((view) => {
    const config = parseDatabaseViewConfigV2(parseJson(
      view.config_json,
      `View ${view.id} config`,
    ));
    return {
      id: view.id,
      configJson: canonicalJson({
        ...config,
        filter: rewriteFilter(config.filter, view.id),
      }),
      groupedByStatus: config.group?.propertyId === "status",
    };
  });
  const statusGroupedViewIds = new Set(
    rewrittenViews.filter((view) => view.groupedByStatus).map((view) => view.id),
  );
  options.injectFault?.("after_preflight");

  const updateProperty = database.prepare(`
    UPDATE data_source_properties
    SET config_json = ?
    WHERE data_source_id = ? AND id = 'status'
  `);
  for (const property of rewrittenPropertyConfigs) {
    updateProperty.run(property.configJson, property.dataSourceId);
  }
  const updateValue = database.prepare(`
    UPDATE data_source_property_values
    SET value_json = ?
    WHERE membership_id = ? AND data_source_id = ? AND property_id = ?
  `);
  for (const value of rewrittenValues) {
    updateValue.run(
      value.valueJson,
      value.membership_id,
      value.data_source_id,
      value.property_id,
    );
  }
  const updateView = database.prepare(
    "UPDATE database_views SET config_json = ? WHERE id = ?",
  );
  for (const view of rewrittenViews) updateView.run(view.configJson, view.id);
  const positions = database.prepare(`
    SELECT view_id, page_block_id, group_key
    FROM database_view_page_positions
    ORDER BY view_id, page_block_id
  `).all() as readonly {
    readonly view_id: string;
    readonly page_block_id: string;
    readonly group_key: string | null;
  }[];
  const updatePosition = database.prepare(`
    UPDATE database_view_page_positions
    SET group_key = ?
    WHERE view_id = ? AND page_block_id = ?
  `);
  let rewrittenPositions = 0;
  for (const position of positions) {
    if (!statusGroupedViewIds.has(position.view_id) || position.group_key === null) continue;
    const groupKey = mapLegacyStatus(
      position.group_key,
      `View ${position.view_id} position ${position.page_block_id}`,
    );
    updatePosition.run(groupKey, position.view_id, position.page_block_id);
    rewrittenPositions += 1;
  }
  options.injectFault?.("after_authority_rewrite");

  const readModels = database.prepare(`
    SELECT page_block_id, database_values_json, view_id, view_group_key
    FROM page_read_model
    ORDER BY page_block_id
  `).all() as readonly {
    readonly page_block_id: string;
    readonly database_values_json: string;
    readonly view_id: string | null;
    readonly view_group_key: string | null;
  }[];
  const updateReadModel = database.prepare(`
    UPDATE page_read_model
    SET database_values_json = ?, view_group_key = ?
    WHERE page_block_id = ?
  `);
  let rewrittenReadModels = 0;
  for (const row of readModels) {
    const valuesJson = parseJson(
      row.database_values_json,
      `Page ${row.page_block_id} read model values`,
    );
    if (!isRecord(valuesJson)) {
      throw new DatabaseIdentityCutoverError(
        `Page ${row.page_block_id} read model values are not an object`,
      );
    }
    const status = Object.hasOwn(valuesJson, "status")
      ? mapLegacyStatus(valuesJson.status, `Page ${row.page_block_id} read model status`)
      : undefined;
    const groupKey = row.view_id !== null
      && statusGroupedViewIds.has(row.view_id)
      && row.view_group_key !== null
      ? mapLegacyStatus(row.view_group_key, `Page ${row.page_block_id} read model group`)
      : row.view_group_key;
    if (status === undefined && groupKey === row.view_group_key) continue;
    updateReadModel.run(
      canonicalJson(status === undefined ? valuesJson : { ...valuesJson, status }),
      groupKey,
      row.page_block_id,
    );
    rewrittenReadModels += 1;
  }
  options.injectFault?.("after_projection_rewrite");

  const rewrittenEvidenceAggregates = rewriteCommittedEvidence(database);
  options.injectFault?.("after_evidence_rewrite");
  const clearedDatabaseModuleReceipts = database
    .prepare("DELETE FROM database_module_receipts")
    .run().changes;
  const clearedAgentCallReceipts = clearAgentCallReceipts(database);
  const metadata = database.prepare(`
    SELECT store_epoch FROM block_store_metadata WHERE id = 1
  `).get() as { readonly store_epoch: string } | undefined;
  if (!metadata) {
    throw new DatabaseIdentityCutoverError("Schema v81 has no store epoch metadata");
  }
  const nextStoreEpoch = options.nextStoreEpoch ?? randomUUID();
  if (!nextStoreEpoch || nextStoreEpoch === metadata.store_epoch) {
    throw new DatabaseIdentityCutoverError("Schema v82 requires a distinct store epoch");
  }
  const now = options.now ?? new Date().toISOString();
  database.prepare(`
    UPDATE block_store_metadata SET store_epoch = ?, updated_at = ? WHERE id = 1
  `).run(nextStoreEpoch, now);

  assertPublishedStatusState(database, statusGroupedViewIds);
  options.injectFault?.("before_publish");
  database.pragma(`user_version = ${TARGET_SCHEMA_VERSION}`);
  return {
    sourceVersion: SOURCE_SCHEMA_VERSION,
    targetVersion: TARGET_SCHEMA_VERSION,
    previousStoreEpoch: metadata.store_epoch,
    nextStoreEpoch,
    migratedStatusProperties: rewrittenPropertyConfigs.length,
    migratedStatusValues: rewrittenValues.length,
    rewrittenViews: rewrittenViews.length,
    rewrittenPositions,
    rewrittenReadModels,
    rewrittenEvidenceAggregates,
    clearedDatabaseModuleReceipts,
    clearedAgentCallReceipts,
  };
};

export function migrateWorkflowStatusesV81ToV82(
  database: Database.Database,
  options: WorkflowStatusCutoverSqliteOptions = {},
): WorkflowStatusCutoverSqliteReport {
  if (database.inTransaction) {
    throw new DatabaseIdentityCutoverError(
      "Workflow status cutover requires ownership of the outer transaction",
    );
  }
  const sourceVersion = database.pragma("user_version", { simple: true }) as number;
  if (sourceVersion !== SOURCE_SCHEMA_VERSION) {
    throw new DatabaseIdentityCutoverError(
      `Workflow status cutover requires schema v81, received v${sourceVersion}`,
    );
  }
  requireTables(database, [
    "block_store_metadata",
    "data_source_properties",
    "data_source_property_values",
    "database_views",
    "database_view_page_positions",
    "page_read_model",
    "block_mutations",
    "change_log",
    "database_module_receipts",
  ]);

  const migrate = database.transaction(() => migrateInsideTransaction(database, options));
  const report = migrate.immediate();
  const foreignKeyViolations = database.pragma("foreign_key_check") as readonly unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new DatabaseIdentityCutoverError(
      `Schema v82 post-publish audit found ${foreignKeyViolations.length} foreign-key violation(s)`,
    );
  }
  return report;
}
