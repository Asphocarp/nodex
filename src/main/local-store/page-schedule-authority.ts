import type Database from "better-sqlite3";
import type {
  BlockPropertyFieldMutation,
  BlockPropertyJsonValue,
  BlockPropertyMutationResult,
} from "../../shared/block-property-mutations";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import type { WorkflowStatus } from "../../shared/workflow-status";
import type { RecurrenceConfig, ReminderConfig } from "../../shared/types";
import { applyBlockPropertyMutation } from "./block-property-mutations";

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
  readonly database_block_id: string;
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
        membership.database_block_id,
        property.id AS property_id,
        property.key AS property_key,
        value.revision,
        value.value_json
      FROM database_memberships membership
      INNER JOIN database_properties property
        ON property.database_block_id = membership.database_block_id
        AND property.project_id = membership.project_id
        AND property.lifecycle = 'active'
        AND property.key IN (${placeholders})
      INNER JOIN database_property_values value
        ON value.membership_id = membership.id
        AND value.property_id = property.id
        AND value.database_block_id = property.database_block_id
        AND value.project_id = property.project_id
      WHERE membership.page_block_id = ?
        AND membership.project_id = ?
        AND membership.removed_at IS NULL
    `,
    )
    .all(
      ...DATABASE_PATCH_KEYS,
      pageId,
      projectId,
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
): BlockPropertyFieldMutation => ({
  scope: "database",
  pageId,
  databaseBlockId: row.database_block_id,
  propertyId: row.property_id,
  operation: "set",
  expectedRevision: row.revision,
  value,
});

const makeIntrinsicField = (
  row: IntrinsicPropertyRow,
  pageId: string,
  value: BlockPropertyJsonValue,
): BlockPropertyFieldMutation => ({
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
): BlockPropertyMutationResult | null => {
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
  const fields: BlockPropertyFieldMutation[] = [];

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

  const result = applyBlockPropertyMutation(database, {
    version: 1,
    mutationId: input.operationId,
    projectId: input.projectId,
    storeEpoch: readStoreEpoch(database),
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    actor: { kind: "page-occurrence" },
    fields,
  });
  if (result.ok) return result.value;
  throw new PageScheduleAuthorityError(
    `Schedule mutation ${input.operationId} failed: ${result.error.code}: ${result.error.message}`,
  );
};
