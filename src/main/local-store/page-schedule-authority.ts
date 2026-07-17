import type Database from "better-sqlite3";
import type { BlockPropertyJsonValue } from "../../shared/block-property-mutations";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import type {
  BlockPropertyFieldMutationV2,
  BlockPropertyMutationResultV2,
} from "../../shared/block-property-mutations-v2";
import {
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import type { WorkflowStatus } from "../../shared/workflow-status";
import type { RecurrenceConfig, ReminderConfig } from "../../shared/types";
import { applySourceBlockPropertyMutationV2 } from "./block-property-mutations-v2-store";
import { rebuildBlockPropertyMutationProjections } from "./block-property-mutation-projections";

export interface AuthoritativePageSchedulePatch {
  readonly status?: WorkflowStatus;
  readonly scheduledStart?: Date | null;
  readonly scheduledEnd?: Date | null;
  readonly isAllDay?: boolean;
  readonly recurrence?: RecurrenceConfig | null;
  readonly reminders?: readonly ReminderConfig[];
  readonly scheduleTimezone?: string | null;
}

export interface ApplyAuthoritativePageSchedulePatchInput {
  readonly projectId: string;
  readonly pageId: string;
  readonly operationId: string;
  readonly clientSessionId?: string;
  readonly patch: AuthoritativePageSchedulePatch;
}

interface DatabasePropertyRow {
  readonly data_source_id: string;
  readonly property_id: string;
  readonly property_key: string;
  readonly revision: number;
  readonly value_json: string;
}

interface IntrinsicPropertyRow {
  readonly property_key: string;
  readonly revision: number;
  readonly value_json: string;
}

export class PageScheduleAuthorityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PageScheduleAuthorityError";
  }
}

const DATABASE_PATCH_KEYS = [
  "status",
  "scheduled_start",
  "scheduled_end",
] as const;

const INTRINSIC_PATCH_KEYS = [
  "schedule.isAllDay",
  "recurrence.config",
  "reminders.config",
  "schedule.timezone",
] as const;

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row?.store_epoch) return row.store_epoch;
  throw new PageScheduleAuthorityError("Block store epoch is missing");
};

const readDatabaseProperties = (
  database: Database.Database,
  projectId: string,
  pageId: string,
): ReadonlyMap<string, DatabasePropertyRow> => {
  const placeholders = DATABASE_PATCH_KEYS.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `
      SELECT
        membership.data_source_id,
        property.id AS property_id,
        property.id AS property_key,
        value.revision,
        value.value_json
      FROM data_source_page_memberships membership
      INNER JOIN data_sources source
        ON source.id = membership.data_source_id
      INNER JOIN blocks page
        ON page.id = membership.page_block_id
        AND page.project_id = ?
        AND page.type = 'page'
        AND page.location_kind = 'database'
        AND page.containing_database_id = source.home_database_block_id
      INNER JOIN data_source_properties property
        ON property.data_source_id = membership.data_source_id
        AND property.lifecycle = 'active'
        AND property.id IN (${placeholders})
      INNER JOIN data_source_property_values value
        ON value.membership_id = membership.id
        AND value.property_id = property.id
        AND value.data_source_id = membership.data_source_id
      WHERE membership.page_block_id = ?
        AND membership.removed_at IS NULL
    `,
    )
    .all(
      projectId,
      ...DATABASE_PATCH_KEYS,
      pageId,
    ) as readonly DatabasePropertyRow[];
  return new Map(rows.map((row) => [row.property_key, row] as const));
};

const readIntrinsicProperties = (
  database: Database.Database,
  projectId: string,
  pageId: string,
): ReadonlyMap<string, IntrinsicPropertyRow> => {
  const placeholders = INTRINSIC_PATCH_KEYS.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `
      SELECT property_key, revision, value_json
      FROM block_properties
      WHERE block_id = ? AND project_id = ?
        AND property_key IN (${placeholders})
    `,
    )
    .all(
      pageId,
      projectId,
      ...INTRINSIC_PATCH_KEYS,
    ) as readonly IntrinsicPropertyRow[];
  return new Map(rows.map((row) => [row.property_key, row] as const));
};

const requireDatabaseProperty = (
  properties: ReadonlyMap<string, DatabasePropertyRow>,
  key: string,
  pageId: string,
): DatabasePropertyRow => {
  const row = properties.get(key);
  if (row) return row;
  throw new PageScheduleAuthorityError(
    `Page ${pageId} is missing Data Source property ${key}`,
  );
};

const requireIntrinsicProperty = (
  properties: ReadonlyMap<string, IntrinsicPropertyRow>,
  key: string,
  pageId: string,
): IntrinsicPropertyRow => {
  const row = properties.get(key);
  if (row) return row;
  throw new PageScheduleAuthorityError(
    `Page ${pageId} is missing intrinsic property ${key}`,
  );
};

const isChanged = (
  storedJson: string,
  value: BlockPropertyJsonValue,
): boolean => storedJson !== stableStringifyBlockPropertyJson(value);

const normalizeJsonValue = (value: unknown): BlockPropertyJsonValue =>
  JSON.parse(stableStringifyBlockPropertyJson(value)) as BlockPropertyJsonValue;

const makeDatabaseField = (
  row: DatabasePropertyRow,
  pageId: string,
  value: string | null,
): BlockPropertyFieldMutationV2 => ({
  scope: "data_source",
  pageId,
  dataSourceId: parseDataSourceId(row.data_source_id),
  propertyId: parseDataSourcePropertyId(row.property_id),
  operation: "set",
  expectedRevision: row.revision,
  value,
});

const makeIntrinsicField = (
  row: IntrinsicPropertyRow,
  pageId: string,
  value: BlockPropertyJsonValue,
): BlockPropertyFieldMutationV2 => ({
  scope: "intrinsic",
  blockId: pageId,
  propertyKey: row.property_key,
  operation: "set",
  expectedRevision: row.revision,
  value,
});

/**
 * Apply one recurrence/schedule intent through the typed property kernel.
 * The function composes inside an existing writer transaction so a Page split
 * can update the old series and create the new Page atomically.
 */
export const applyAuthoritativePageSchedulePatchInTransaction = (
  database: Database.Database,
  input: ApplyAuthoritativePageSchedulePatchInput,
): BlockPropertyMutationResultV2 | null => {
  if (!database.inTransaction) {
    throw new PageScheduleAuthorityError(
      "applyAuthoritativePageSchedulePatchInTransaction requires an active writer transaction",
    );
  }
  const databaseProperties = readDatabaseProperties(
    database,
    input.projectId,
    input.pageId,
  );
  const intrinsicProperties = readIntrinsicProperties(
    database,
    input.projectId,
    input.pageId,
  );
  const fields: BlockPropertyFieldMutationV2[] = [];

  const addDatabase = (key: string, value: string | null): void => {
    const row = requireDatabaseProperty(databaseProperties, key, input.pageId);
    if (!isChanged(row.value_json, value)) return;
    fields.push(makeDatabaseField(row, input.pageId, value));
  };
  const addIntrinsic = (key: string, value: BlockPropertyJsonValue): void => {
    const row = requireIntrinsicProperty(
      intrinsicProperties,
      key,
      input.pageId,
    );
    if (!isChanged(row.value_json, value)) return;
    fields.push(makeIntrinsicField(row, input.pageId, value));
  };

  if (input.patch.status !== undefined) {
    addDatabase("status", input.patch.status);
  }
  if (input.patch.scheduledStart !== undefined) {
    addDatabase(
      "scheduled_start",
      input.patch.scheduledStart?.toISOString() ?? null,
    );
  }
  if (input.patch.scheduledEnd !== undefined) {
    addDatabase(
      "scheduled_end",
      input.patch.scheduledEnd?.toISOString() ?? null,
    );
  }
  if (input.patch.isAllDay !== undefined) {
    addIntrinsic("schedule.isAllDay", input.patch.isAllDay);
  }
  if (input.patch.recurrence !== undefined) {
    addIntrinsic(
      "recurrence.config",
      normalizeJsonValue(input.patch.recurrence),
    );
  }
  if (input.patch.reminders !== undefined) {
    addIntrinsic("reminders.config", normalizeJsonValue(input.patch.reminders));
  }
  if (input.patch.scheduleTimezone !== undefined) {
    addIntrinsic("schedule.timezone", input.patch.scheduleTimezone);
  }
  if (fields.length === 0) return null;

  const result = applySourceBlockPropertyMutationV2(
    database,
    {
      version: 2,
      mutationId: input.operationId,
      projectId: input.projectId,
      storeEpoch: readStoreEpoch(database),
      ...(input.clientSessionId
        ? { clientSessionId: input.clientSessionId }
        : {}),
      actor: { kind: "page-occurrence" },
      fields,
    },
    {
      refreshProjections: (projectionDatabase, projection) => {
        rebuildBlockPropertyMutationProjections(
          projectionDatabase,
          projection.projectId,
          projection.pageIds,
          projection.updatedAt,
        );
      },
    },
  );
  if (result.ok) return result.value;
  throw new PageScheduleAuthorityError(
    `Schedule mutation ${input.operationId} failed: ${result.error.code}: ${result.error.message}`,
  );
};
