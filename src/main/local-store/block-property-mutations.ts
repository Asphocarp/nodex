import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION,
  canonicalizeBlockPropertyMutationRequest,
  makeBlockPropertyFieldPath,
  parseBlockPropertyMutationCommandError,
  parseBlockPropertyMutationRequest,
  parseBlockPropertyMutationResult,
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
  type BlockPropertyMutationCommandError,
  type BlockPropertyMutationCommandResult,
  type BlockPropertyMutationFieldResult,
  type BlockPropertyMutationRequest,
  type BlockPropertyMutationResult,
  type SetDatabaseScalarProperty,
  type SetIntrinsicBlockProperty,
  type UpdateDatabaseSetProperty,
} from "../../shared/block-property-mutations";
import type { CardInput } from "../../shared/types";
import { rebuildBlockPropertyMutationProjections } from "./block-property-mutation-projections";
import { assertValidCardInput } from "./card-input-validation";

export type BlockPropertyMutationFaultPoint =
  | "after_property_values"
  | "after_block_metadata"
  | "after_projections"
  | "after_change_log"
  | "after_ledger"
  | "before_commit"
  | "after_commit";

export interface ApplyBlockPropertyMutationOptions {
  readonly faultInjector?: (point: BlockPropertyMutationFaultPoint) => void;
  readonly now?: () => string;
}

interface StoreEpochRow {
  readonly store_epoch: string;
}

interface BlockRow {
  readonly id: string;
  readonly type: string;
  readonly lifecycle: string;
  readonly metadata_revision: number;
}

interface IntrinsicPropertyRow {
  readonly value_type: string;
  readonly value_json: string;
  readonly revision: number;
}

interface DatabaseCapabilityRow {
  readonly block_id: string;
  readonly block_type: string;
  readonly block_lifecycle: string;
}

interface DatabaseMembershipRow {
  readonly id: string;
}

interface DatabasePropertyRow {
  readonly id: string;
  readonly key: string;
  readonly value_type: string;
  readonly config_json: string;
}

interface DatabasePropertyValueRow {
  readonly value_type: string;
  readonly value_json: string;
  readonly revision: number;
}

interface StoredBlockMutationRow {
  readonly mutation_id: string;
  readonly project_id: string;
  readonly store_epoch: string;
  readonly mutation_kind: string;
  readonly actor_json: string;
  readonly client_session_id: string | null;
  readonly request_hash: string;
  readonly request_json: string;
  readonly target_block_ids_json: string;
  readonly affected_document_ids_json: string;
  readonly affected_database_block_ids_json: string;
  readonly field_intents_json: string;
  readonly expected_revisions_json: string;
  readonly outcome: string;
  readonly result_json: string;
  readonly committed_revisions_json: string;
  readonly document_heads_json: string;
  readonly change_log_seq: number | null;
  readonly recorded_at: string;
}

interface MutationEvidence {
  readonly canonicalRequest: string;
  readonly requestHash: string;
  readonly actorJson: string;
  readonly targetBlockIds: readonly string[];
  readonly targetBlockIdsJson: string;
  readonly databaseBlockIds: readonly string[];
  readonly databaseBlockIdsJson: string;
  readonly fieldIntentsJson: string;
  readonly expectedRevisionsJson: string;
}

interface ResolvedIntrinsicField {
  readonly input: SetIntrinsicBlockProperty;
  readonly path: string;
  readonly blockId: string;
  readonly valueType: "null" | "boolean" | "number" | "string" | "json";
  readonly valueJson: string;
  readonly currentRevision: number;
  readonly currentValue: BlockPropertyJsonValue;
}

interface ResolvedDatabaseField {
  readonly input: SetDatabaseScalarProperty | UpdateDatabaseSetProperty;
  readonly path: string;
  readonly blockId: string;
  readonly membershipId: string;
  readonly propertyKey: string;
  readonly valueType:
    "select" | "multi_select" | "date" | "datetime" | "person";
  readonly value: string | null | readonly string[];
  readonly valueJson: string;
  readonly currentRevision: number;
  readonly currentValue: BlockPropertyJsonValue;
}

type ResolvedPropertyField = ResolvedIntrinsicField | ResolvedDatabaseField;

const MUTATION_KIND = "property_batch";
const EMPTY_ARRAY_JSON = "[]";
const EMPTY_OBJECT_JSON = "{}";
const RETIRED_INTRINSIC_PROPERTY_KEYS = new Set([
  "agent.blocked",
  "agent.status",
]);

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort(compareStrings);

const parseStoredPropertyValue = (
  valueJson: string | undefined,
  request: BlockPropertyMutationRequest,
  path: string,
): BlockPropertyJsonValue => {
  if (valueJson === undefined) return null;
  try {
    return JSON.parse(valueJson) as BlockPropertyJsonValue;
  } catch {
    return reject(
      "property_value_corrupt",
      `Stored property ${path} is not valid JSON`,
      request,
      { fieldPath: path },
    );
  }
};

const makeError = (
  code: BlockPropertyMutationCommandError["code"],
  message: string,
  request?: Pick<BlockPropertyMutationRequest, "mutationId">,
  details: Pick<
    BlockPropertyMutationCommandError,
    "fieldPath" | "expectedRevision" | "actualRevision"
  > = {},
): BlockPropertyMutationCommandError => ({
  code,
  message,
  retryable: false,
  ...(request === undefined ? {} : { mutationId: request.mutationId }),
  ...(details.fieldPath === undefined ? {} : { fieldPath: details.fieldPath }),
  ...(details.expectedRevision === undefined
    ? {}
    : { expectedRevision: details.expectedRevision }),
  ...(details.actualRevision === undefined
    ? {}
    : { actualRevision: details.actualRevision }),
});

class PropertyMutationRejection extends Error {
  readonly error: BlockPropertyMutationCommandError;

  constructor(error: BlockPropertyMutationCommandError) {
    super(error.message);
    this.name = "PropertyMutationRejection";
    this.error = error;
  }
}

const reject = (
  code: BlockPropertyMutationCommandError["code"],
  message: string,
  request: BlockPropertyMutationRequest,
  details?: Pick<
    BlockPropertyMutationCommandError,
    "fieldPath" | "expectedRevision" | "actualRevision"
  >,
): never => {
  throw new PropertyMutationRejection(
    makeError(code, message, request, details),
  );
};

const readCurrentStoreEpoch = (database: Database.Database): string | null =>
  (
    database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as StoreEpochRow | undefined
  )?.store_epoch ?? null;

const readStoredMutation = (
  database: Database.Database,
  mutationId: string,
): StoredBlockMutationRow | null =>
  (database
    .prepare(
      `
      SELECT
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        client_session_id, request_hash, request_json, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json,
        field_intents_json, expected_revisions_json, outcome, result_json,
        committed_revisions_json, document_heads_json, change_log_seq,
        recorded_at
      FROM block_mutations
      WHERE mutation_id = ?
    `,
    )
    .get(mutationId) as StoredBlockMutationRow | undefined) ?? null;

const inferIntrinsicValueType = (
  value: BlockPropertyJsonValue,
): ResolvedIntrinsicField["valueType"] => {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "json";
};

const validateKnownIntrinsicValue = (
  field: SetIntrinsicBlockProperty,
  request: BlockPropertyMutationRequest,
  path: string,
): void => {
  if (RETIRED_INTRINSIC_PROPERTY_KEYS.has(field.propertyKey)) {
    return reject(
      "property_not_found",
      `Intrinsic property ${path} is retired`,
      request,
      { fieldPath: path },
    );
  }
  const candidate: Partial<CardInput> = {};
  switch (field.propertyKey) {
    case "run.target":
      candidate.runInTarget = field.value as CardInput["runInTarget"];
      break;
    case "run.localPath":
      candidate.runInLocalPath = field.value as CardInput["runInLocalPath"];
      break;
    case "run.baseBranch":
      candidate.runInBaseBranch = field.value as CardInput["runInBaseBranch"];
      break;
    case "run.worktreePath":
      candidate.runInWorktreePath =
        field.value as CardInput["runInWorktreePath"];
      break;
    case "run.environmentPath":
      candidate.runInEnvironmentPath =
        field.value as CardInput["runInEnvironmentPath"];
      break;
    case "schedule.isAllDay":
      if (typeof field.value === "boolean") return;
      return reject(
        "property_value_invalid",
        `Intrinsic property ${path} requires a boolean`,
        request,
        { fieldPath: path },
      );
    case "schedule.timezone":
      candidate.scheduleTimezone = field.value as CardInput["scheduleTimezone"];
      break;
    case "recurrence.config":
      candidate.recurrence = field.value as CardInput["recurrence"];
      break;
    case "reminders.config":
      candidate.reminders = field.value as unknown as CardInput["reminders"];
      break;
    default:
      return;
  }
  try {
    assertValidCardInput(candidate, "update");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reject(
      "property_value_invalid",
      `Intrinsic property ${path} is invalid: ${detail}`,
      request,
      { fieldPath: path },
    );
  }
};

const makeMutationEvidence = (
  request: BlockPropertyMutationRequest,
): MutationEvidence => {
  const canonicalRequest = canonicalizeBlockPropertyMutationRequest(request);
  const targetBlockIds = uniqueSorted(
    request.fields.map((field) =>
      field.scope === "intrinsic" ? field.blockId : field.cardBlockId,
    ),
  );
  const databaseBlockIds = uniqueSorted(
    request.fields.flatMap((field) =>
      field.scope === "database" ? [field.databaseBlockId] : [],
    ),
  );
  const fieldIntents = request.fields.map((field) => ({
    path: makeBlockPropertyFieldPath(field),
    operation: field.operation,
    scope: field.scope,
    ...(field.operation === "add_remove"
      ? { add: field.add, remove: field.remove }
      : {}),
  }));
  const expectedRevisions = Object.fromEntries(
    request.fields.flatMap((field) =>
      field.operation === "set"
        ? [[makeBlockPropertyFieldPath(field), field.expectedRevision] as const]
        : [],
    ),
  );
  return {
    canonicalRequest,
    requestHash: sha256(canonicalRequest),
    actorJson: stableStringifyBlockPropertyJson(request.actor),
    targetBlockIds,
    targetBlockIdsJson: JSON.stringify(targetBlockIds),
    databaseBlockIds,
    databaseBlockIdsJson: JSON.stringify(databaseBlockIds),
    fieldIntentsJson: stableStringifyBlockPropertyJson(fieldIntents),
    expectedRevisionsJson: stableStringifyBlockPropertyJson(expectedRevisions),
  };
};

const storedMutationMatches = (
  stored: StoredBlockMutationRow,
  request: BlockPropertyMutationRequest,
  evidence: MutationEvidence,
): boolean =>
  stored.project_id === request.projectId &&
  stored.store_epoch === request.storeEpoch &&
  stored.mutation_kind === MUTATION_KIND &&
  stored.actor_json === evidence.actorJson &&
  stored.client_session_id === (request.clientSessionId ?? null) &&
  stored.request_hash === evidence.requestHash &&
  stored.request_json === evidence.canonicalRequest &&
  stored.target_block_ids_json === evidence.targetBlockIdsJson &&
  stored.affected_document_ids_json === EMPTY_ARRAY_JSON &&
  stored.affected_database_block_ids_json === evidence.databaseBlockIdsJson &&
  stored.field_intents_json === evidence.fieldIntentsJson &&
  stored.expected_revisions_json === evidence.expectedRevisionsJson &&
  stored.document_heads_json === EMPTY_OBJECT_JSON;

const loadStoredOutcome = (
  stored: StoredBlockMutationRow,
  request: BlockPropertyMutationRequest,
  evidence: MutationEvidence,
): BlockPropertyMutationCommandResult => {
  if (!storedMutationMatches(stored, request, evidence)) {
    return {
      ok: false,
      error: makeError(
        "mutation_id_collision",
        `Mutation ID ${request.mutationId} is already bound to another request`,
        request,
      ),
    };
  }
  if (stored.outcome === "rejected") {
    if (
      stored.change_log_seq !== null ||
      stored.committed_revisions_json !== EMPTY_OBJECT_JSON
    ) {
      return {
        ok: false,
        error: makeError(
          "unknown",
          `Rejected mutation ledger ${request.mutationId} has committed evidence`,
          request,
        ),
      };
    }
    const error = parseBlockPropertyMutationCommandError(
      JSON.parse(stored.result_json) as unknown,
    );
    if (error.mutationId !== request.mutationId) {
      return {
        ok: false,
        error: makeError(
          "unknown",
          `Rejected mutation ledger ${request.mutationId} has a mismatched result`,
          request,
        ),
      };
    }
    return {
      ok: false,
      error,
    };
  }
  if (stored.outcome !== "committed" || stored.change_log_seq === null) {
    return {
      ok: false,
      error: makeError(
        "unknown",
        `Mutation ledger ${request.mutationId} has an invalid outcome`,
        request,
      ),
    };
  }
  const result = parseBlockPropertyMutationResult(
    JSON.parse(stored.result_json) as unknown,
  );
  const committedRevisionsJson = stableStringifyBlockPropertyJson(
    Object.fromEntries(
      result.fields.map((field) => [field.path, field.revision]),
    ),
  );
  if (
    result.duplicate ||
    result.mutationId !== request.mutationId ||
    result.projectId !== request.projectId ||
    result.storeEpoch !== request.storeEpoch ||
    result.changeLogSeq !== stored.change_log_seq ||
    result.committedAt !== stored.recorded_at ||
    committedRevisionsJson !== stored.committed_revisions_json
  ) {
    return {
      ok: false,
      error: makeError(
        "unknown",
        `Mutation ledger ${request.mutationId} has a mismatched committed result`,
        request,
      ),
    };
  }
  return {
    ok: true,
    value: { ...result, duplicate: true },
  };
};

const readCardBlock = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  blockId: string,
  path: string,
): BlockRow => {
  const row = database
    .prepare(
      `
      SELECT id, type, lifecycle, metadata_revision
      FROM blocks
      WHERE id = ? AND project_id = ?
    `,
    )
    .get(blockId, request.projectId) as BlockRow | undefined;
  if (!row) {
    return reject(
      "block_not_found",
      `Card Block does not exist in Project ${request.projectId}: ${blockId}`,
      request,
      { fieldPath: path },
    );
  }
  if (row.lifecycle !== "active") {
    reject(
      "block_not_active",
      `Card Block is not active: ${blockId}`,
      request,
      { fieldPath: path },
    );
  }
  if (row.type !== "card") {
    reject(
      "block_type_mismatch",
      `Property mutations in this slice require a Card Block: ${blockId}`,
      request,
      { fieldPath: path },
    );
  }
  return row;
};

const resolveIntrinsicField = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  field: SetIntrinsicBlockProperty,
): ResolvedIntrinsicField => {
  const path = makeBlockPropertyFieldPath(field);
  readCardBlock(database, request, field.blockId, path);
  validateKnownIntrinsicValue(field, request, path);
  const current = database
    .prepare(
      `
      SELECT value_type, value_json, revision
      FROM block_properties
      WHERE block_id = ? AND project_id = ? AND property_key = ?
    `,
    )
    .get(field.blockId, request.projectId, field.propertyKey) as
    IntrinsicPropertyRow | undefined;
  const actualRevision = current?.revision ?? 0;
  if (actualRevision !== field.expectedRevision) {
    reject(
      "property_conflict",
      `Property ${path} is at revision ${actualRevision}, not ${field.expectedRevision}`,
      request,
      {
        fieldPath: path,
        expectedRevision: field.expectedRevision,
        actualRevision,
      },
    );
  }
  return {
    input: field,
    path,
    blockId: field.blockId,
    valueType: inferIntrinsicValueType(field.value),
    valueJson: stableStringifyBlockPropertyJson(field.value),
    currentRevision: actualRevision,
    currentValue: parseStoredPropertyValue(current?.value_json, request, path),
  };
};

const readDatabaseScope = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  field: SetDatabaseScalarProperty | UpdateDatabaseSetProperty,
  path: string,
): {
  readonly membership: DatabaseMembershipRow;
  readonly property: DatabasePropertyRow;
} => {
  readCardBlock(database, request, field.cardBlockId, path);
  const capability = database
    .prepare(
      `
      SELECT
        capability.block_id,
        database_block.type AS block_type,
        database_block.lifecycle AS block_lifecycle
      FROM database_capabilities capability
      INNER JOIN blocks database_block
        ON database_block.id = capability.block_id
        AND database_block.project_id = capability.project_id
      WHERE capability.block_id = ? AND capability.project_id = ?
    `,
    )
    .get(field.databaseBlockId, request.projectId) as
    DatabaseCapabilityRow | undefined;
  if (
    !capability ||
    capability.block_type !== "database" ||
    capability.block_lifecycle !== "active"
  ) {
    reject(
      "database_not_found",
      `Active Database does not exist in Project ${request.projectId}: ${field.databaseBlockId}`,
      request,
      { fieldPath: path },
    );
  }
  const membership = database
    .prepare(
      `
      SELECT id
      FROM database_memberships
      WHERE card_block_id = ?
        AND database_block_id = ?
        AND project_id = ?
        AND removed_at IS NULL
    `,
    )
    .get(field.cardBlockId, field.databaseBlockId, request.projectId) as
    DatabaseMembershipRow | undefined;
  if (!membership) {
    return reject(
      "membership_not_found",
      `Card ${field.cardBlockId} is not an active member of Database ${field.databaseBlockId}`,
      request,
      { fieldPath: path },
    );
  }
  const property = database
    .prepare(
      `
      SELECT id, key, value_type, config_json
      FROM database_properties
      WHERE id = ?
        AND database_block_id = ?
        AND project_id = ?
        AND lifecycle = 'active'
    `,
    )
    .get(field.propertyId, field.databaseBlockId, request.projectId) as
    DatabasePropertyRow | undefined;
  if (!property) {
    return reject(
      "property_not_found",
      `Database property is outside the active Database scope: ${field.propertyId}`,
      request,
      { fieldPath: path },
    );
  }
  return { membership, property };
};

const parseStoredSet = (
  row: DatabasePropertyValueRow | undefined,
  request: BlockPropertyMutationRequest,
  path: string,
): readonly string[] => {
  if (!row) return [];
  if (row.value_type !== "multi_select") {
    reject(
      "property_value_corrupt",
      `Stored set property ${path} has type ${row.value_type}`,
      request,
      { fieldPath: path },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(row.value_json) as unknown;
  } catch {
    reject(
      "property_value_corrupt",
      `Stored set property ${path} is not valid JSON`,
      request,
      { fieldPath: path },
    );
  }
  if (value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.length === 0 ||
        entry !== entry.trim(),
    )
  ) {
    reject(
      "property_value_corrupt",
      `Stored set property ${path} is not a canonical string set`,
      request,
      { fieldPath: path },
    );
  }
  return uniqueSorted(value as string[]);
};

const parsePropertyConfig = (
  property: DatabasePropertyRow,
  request: BlockPropertyMutationRequest,
  path: string,
): Readonly<Record<string, unknown>> => {
  let config: unknown;
  try {
    config = JSON.parse(property.config_json) as unknown;
  } catch {
    return reject(
      "property_value_corrupt",
      `Database property ${path} has invalid configuration JSON`,
      request,
      { fieldPath: path },
    );
  }
  if (typeof config === "object" && config !== null && !Array.isArray(config)) {
    return config as Readonly<Record<string, unknown>>;
  }
  return reject(
    "property_value_corrupt",
    `Database property ${path} configuration must be an object`,
    request,
    { fieldPath: path },
  );
};

const isCanonicalDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const isCanonicalDateTime = (value: string): boolean => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

const validateDatabaseScalarValue = (
  property: DatabasePropertyRow,
  value: string | null,
  request: BlockPropertyMutationRequest,
  path: string,
): void => {
  if (value === null) {
    if (property.key !== "status") return;
    return reject(
      "property_value_invalid",
      `Database status property ${path} cannot be null`,
      request,
      { fieldPath: path },
    );
  }
  const scalarValue = value;
  if (scalarValue.length === 0 || scalarValue !== scalarValue.trim()) {
    reject(
      "property_value_invalid",
      `Database property ${path} requires a canonical non-empty value`,
      request,
      { fieldPath: path },
    );
  }
  if (property.value_type === "date" && !isCanonicalDate(scalarValue)) {
    reject(
      "property_value_invalid",
      `Database date property ${path} requires YYYY-MM-DD`,
      request,
      { fieldPath: path },
    );
  }
  if (property.value_type === "datetime" && !isCanonicalDateTime(scalarValue)) {
    reject(
      "property_value_invalid",
      `Database datetime property ${path} requires canonical UTC ISO-8601`,
      request,
      { fieldPath: path },
    );
  }
  if (property.key === "assignee") {
    try {
      assertValidCardInput({ assignee: scalarValue }, "update");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reject(
        "property_value_invalid",
        `Database assignee property ${path} is invalid: ${detail}`,
        request,
        { fieldPath: path },
      );
    }
  }
  if (property.value_type !== "select") return;
  const config = parsePropertyConfig(property, request, path);
  const options = config.options;
  if (options === undefined) return;
  if (!Array.isArray(options)) {
    return reject(
      "property_value_corrupt",
      `Database select property ${path} has invalid options`,
      request,
      { fieldPath: path },
    );
  }
  const optionIds = options.flatMap((option: unknown) => {
    if (
      typeof option !== "object" ||
      option === null ||
      Array.isArray(option)
    ) {
      return [];
    }
    const id = (option as Readonly<Record<string, unknown>>).id;
    return typeof id === "string" ? [id] : [];
  });
  if (optionIds.length === options.length && optionIds.includes(scalarValue)) {
    return;
  }
  reject(
    "property_value_invalid",
    `Database select property ${path} does not define option ${scalarValue}`,
    request,
    { fieldPath: path },
  );
};

const validateDatabaseSetValue = (
  property: DatabasePropertyRow,
  value: readonly string[],
  request: BlockPropertyMutationRequest,
  path: string,
): void => {
  if (property.key === "tags") {
    try {
      assertValidCardInput({ tags: [...value] }, "update");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reject(
        "property_value_invalid",
        `Database tags property ${path} is invalid: ${detail}`,
        request,
        { fieldPath: path },
      );
    }
    // The seeded Card tags property is intentionally open-ended. Its values
    // are application-level tag identities, so a field-level add/remove intent
    // must not require a separate Database schema mutation first. Custom
    // multi-select properties continue through the closed option validation
    // below.
    return;
  }
  const config = parsePropertyConfig(property, request, path);
  const options = config.options;
  if (options === undefined) return;
  if (!Array.isArray(options)) {
    return reject(
      "property_value_corrupt",
      `Database multi-select property ${path} has invalid options`,
      request,
      { fieldPath: path },
    );
  }
  const optionIds = options.flatMap((option: unknown) => {
    if (
      typeof option !== "object" ||
      option === null ||
      Array.isArray(option)
    ) {
      return [];
    }
    const id = (option as Readonly<Record<string, unknown>>).id;
    return typeof id === "string" ? [id] : [];
  });
  if (
    optionIds.length === options.length &&
    value.every((member) => optionIds.includes(member))
  ) {
    return;
  }
  reject(
    "property_value_invalid",
    `Database multi-select property ${path} contains an undefined option`,
    request,
    { fieldPath: path },
  );
};

const resolveDatabaseField = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  field: SetDatabaseScalarProperty | UpdateDatabaseSetProperty,
): ResolvedDatabaseField => {
  const path = makeBlockPropertyFieldPath(field);
  const { membership, property } = readDatabaseScope(
    database,
    request,
    field,
    path,
  );
  const supportedTypes: readonly ResolvedDatabaseField["valueType"][] = [
    "select",
    "multi_select",
    "date",
    "datetime",
    "person",
  ];
  if (
    !supportedTypes.includes(
      property.value_type as ResolvedDatabaseField["valueType"],
    )
  ) {
    reject(
      "property_type_mismatch",
      `Database property ${field.propertyId} has unsupported type ${property.value_type}`,
      request,
      { fieldPath: path },
    );
  }
  const valueType = property.value_type as ResolvedDatabaseField["valueType"];
  if (
    (field.operation === "set" && valueType === "multi_select") ||
    (field.operation === "add_remove" && valueType !== "multi_select")
  ) {
    reject(
      "property_type_mismatch",
      `Operation ${field.operation} does not match Database property type ${valueType}`,
      request,
      { fieldPath: path },
    );
  }
  const current = database
    .prepare(
      `
      SELECT value_type, value_json, revision
      FROM database_property_values
      WHERE membership_id = ? AND property_id = ?
    `,
    )
    .get(membership.id, field.propertyId) as
    DatabasePropertyValueRow | undefined;
  if (current && current.value_type !== valueType) {
    reject(
      "property_value_corrupt",
      `Stored property ${path} disagrees with its Database definition`,
      request,
      { fieldPath: path },
    );
  }
  const actualRevision = current?.revision ?? 0;
  if (field.operation === "set" && actualRevision !== field.expectedRevision) {
    reject(
      "property_conflict",
      `Property ${path} is at revision ${actualRevision}, not ${field.expectedRevision}`,
      request,
      {
        fieldPath: path,
        expectedRevision: field.expectedRevision,
        actualRevision,
      },
    );
  }
  if (field.operation === "set") {
    validateDatabaseScalarValue(property, field.value, request, path);
    return {
      input: field,
      path,
      blockId: field.cardBlockId,
      membershipId: membership.id,
      propertyKey: property.key,
      valueType,
      value: field.value,
      valueJson: JSON.stringify(field.value),
      currentRevision: actualRevision,
      currentValue: parseStoredPropertyValue(
        current?.value_json,
        request,
        path,
      ),
    };
  }
  const next = new Set(parseStoredSet(current, request, path));
  for (const member of field.remove) next.delete(member);
  for (const member of field.add) next.add(member);
  const value = [...next].sort(compareStrings);
  validateDatabaseSetValue(property, value, request, path);
  return {
    input: field,
    path,
    blockId: field.cardBlockId,
    membershipId: membership.id,
    propertyKey: property.key,
    valueType,
    value,
    valueJson: JSON.stringify(value),
    currentRevision: actualRevision,
    currentValue: parseStoredSet(current, request, path),
  };
};

const readJsonPropertyRows = (
  rows: readonly { readonly key: string; readonly value_json: string }[],
  request: BlockPropertyMutationRequest,
  blockId: string,
): Map<string, unknown> => {
  const values = new Map<string, unknown>();
  for (const row of rows) {
    try {
      values.set(row.key, JSON.parse(row.value_json) as unknown);
    } catch {
      reject(
        "property_value_corrupt",
        `Card ${blockId} property ${row.key} is not valid JSON`,
        request,
      );
    }
  }
  return values;
};

const validateScheduledMetadataAfterMutation = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  fields: readonly ResolvedPropertyField[],
): void => {
  const scheduleKeys = new Set([
    "scheduled_start",
    "scheduled_end",
    "schedule.isAllDay",
    "schedule.timezone",
    "recurrence.config",
    "reminders.config",
  ]);
  const fieldsByBlock = new Map<string, ResolvedPropertyField[]>();
  for (const field of fields) {
    const fieldsForBlock = fieldsByBlock.get(field.blockId) ?? [];
    fieldsForBlock.push(field);
    fieldsByBlock.set(field.blockId, fieldsForBlock);
  }

  for (const [blockId, blockFields] of fieldsByBlock) {
    if (
      !blockFields.some((field) =>
        scheduleKeys.has(
          isResolvedIntrinsicField(field)
            ? field.input.propertyKey
            : field.propertyKey,
        ),
      )
    ) {
      continue;
    }
    const databaseValues = readJsonPropertyRows(
      database
        .prepare(
          `
          SELECT property.key, value.value_json
          FROM database_memberships membership
          INNER JOIN database_properties property
            ON property.database_block_id = membership.database_block_id
            AND property.project_id = membership.project_id
            AND property.lifecycle = 'active'
            AND property.key IN ('scheduled_start', 'scheduled_end')
          INNER JOIN database_property_values value
            ON value.membership_id = membership.id
            AND value.property_id = property.id
          WHERE membership.card_block_id = ?
            AND membership.project_id = ?
            AND membership.removed_at IS NULL
        `,
        )
        .all(blockId, request.projectId) as readonly {
        readonly key: string;
        readonly value_json: string;
      }[],
      request,
      blockId,
    );
    const intrinsicValues = readJsonPropertyRows(
      database
        .prepare(
          `
          SELECT property_key AS key, value_json
          FROM block_properties
          WHERE block_id = ?
            AND project_id = ?
            AND property_key IN (
              'schedule.isAllDay', 'schedule.timezone',
              'recurrence.config', 'reminders.config'
            )
        `,
        )
        .all(blockId, request.projectId) as readonly {
        readonly key: string;
        readonly value_json: string;
      }[],
      request,
      blockId,
    );
    for (const field of blockFields) {
      if (isResolvedIntrinsicField(field)) {
        intrinsicValues.set(field.input.propertyKey, field.input.value);
        continue;
      }
      databaseValues.set(field.propertyKey, field.value);
    }
    const toDate = (key: string): Date | null => {
      const value = databaseValues.get(key);
      if (value === null || value === undefined) return null;
      return new Date(value as string);
    };
    const fieldPath = blockFields.find((field) =>
      scheduleKeys.has(
        isResolvedIntrinsicField(field)
          ? field.input.propertyKey
          : field.propertyKey,
      ),
    )?.path;
    const scheduledStart = toDate("scheduled_start");
    const scheduledEnd = toDate("scheduled_end");
    if ((scheduledStart === null) !== (scheduledEnd === null)) {
      reject(
        "property_value_invalid",
        `Card ${blockId} must set or clear scheduled_start and scheduled_end together`,
        request,
        fieldPath ? { fieldPath } : undefined,
      );
    }
    try {
      assertValidCardInput(
        {
          scheduledStart,
          scheduledEnd,
          isAllDay: intrinsicValues.get("schedule.isAllDay") as
            boolean | undefined,
          recurrence: intrinsicValues.get("recurrence.config") as
            CardInput["recurrence"] | undefined,
          reminders: intrinsicValues.get("reminders.config") as
            CardInput["reminders"] | undefined,
          scheduleTimezone: intrinsicValues.get("schedule.timezone") as
            CardInput["scheduleTimezone"] | undefined,
        },
        "update",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reject(
        "property_value_invalid",
        `Card ${blockId} has invalid scheduled metadata: ${detail}`,
        request,
        fieldPath ? { fieldPath } : undefined,
      );
    }
  }
};

const resolveFields = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
): readonly ResolvedPropertyField[] => {
  const fields = request.fields.map((field) =>
    field.scope === "intrinsic"
      ? resolveIntrinsicField(database, request, field)
      : resolveDatabaseField(database, request, field),
  );
  validateScheduledMetadataAfterMutation(database, request, fields);
  return fields;
};

const persistIntrinsicField = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  field: ResolvedIntrinsicField,
  now: string,
): number => {
  const nextRevision = field.currentRevision + 1;
  if (field.currentRevision === 0) {
    database
      .prepare(
        `
        INSERT INTO block_properties (
          block_id, project_id, property_key, value_type, value_json,
          revision, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?)
      `,
      )
      .run(
        field.blockId,
        request.projectId,
        field.input.propertyKey,
        field.valueType,
        field.valueJson,
        now,
      );
    return nextRevision;
  }
  const update = database
    .prepare(
      `
      UPDATE block_properties
      SET value_type = ?, value_json = ?, revision = revision + 1, updated_at = ?
      WHERE block_id = ?
        AND project_id = ?
        AND property_key = ?
        AND revision = ?
    `,
    )
    .run(
      field.valueType,
      field.valueJson,
      now,
      field.blockId,
      request.projectId,
      field.input.propertyKey,
      field.currentRevision,
    );
  if (update.changes === 1) return nextRevision;
  return reject(
    "property_conflict",
    `Property ${field.path} changed while committing`,
    request,
    {
      fieldPath: field.path,
      expectedRevision: field.currentRevision,
      actualRevision: field.currentRevision + 1,
    },
  );
};

const persistDatabaseField = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  field: ResolvedDatabaseField,
  now: string,
): number => {
  const syncPrimaryKanbanGroup = (): void => {
    if (field.propertyKey !== "status" || field.input.operation !== "set") {
      return;
    }
    if (typeof field.value !== "string") {
      return reject(
        "property_value_invalid",
        `Database status property ${field.path} requires a group key`,
        request,
        { fieldPath: field.path },
      );
    }
    database
      .prepare(
        `
        UPDATE database_view_positions
        SET group_key = ?, updated_at = ?
        WHERE block_id = ?
          AND project_id = ?
          AND view_id IN (
            SELECT id
            FROM database_views
            WHERE database_block_id = ?
              AND project_id = ?
              AND kind = 'kanban'
              AND is_primary = 1
          )
      `,
      )
      .run(
        field.value,
        now,
        field.blockId,
        request.projectId,
        field.input.databaseBlockId,
        request.projectId,
      );
  };
  const nextRevision = field.currentRevision + 1;
  if (field.currentRevision === 0) {
    database
      .prepare(
        `
        INSERT INTO database_property_values (
          membership_id, property_id, database_block_id, project_id,
          value_type, value_json, revision, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `,
      )
      .run(
        field.membershipId,
        field.input.propertyId,
        field.input.databaseBlockId,
        request.projectId,
        field.valueType,
        field.valueJson,
        now,
      );
    syncPrimaryKanbanGroup();
    return nextRevision;
  }
  const update = database
    .prepare(
      `
      UPDATE database_property_values
      SET value_json = ?, revision = revision + 1, updated_at = ?
      WHERE membership_id = ?
        AND property_id = ?
        AND database_block_id = ?
        AND project_id = ?
        AND value_type = ?
        AND revision = ?
    `,
    )
    .run(
      field.valueJson,
      now,
      field.membershipId,
      field.input.propertyId,
      field.input.databaseBlockId,
      request.projectId,
      field.valueType,
      field.currentRevision,
    );
  if (update.changes === 1) {
    syncPrimaryKanbanGroup();
    return nextRevision;
  }
  return reject(
    "property_conflict",
    `Property ${field.path} changed while committing`,
    request,
    {
      fieldPath: field.path,
      expectedRevision: field.currentRevision,
      actualRevision: field.currentRevision + 1,
    },
  );
};

const isResolvedIntrinsicField = (
  field: ResolvedPropertyField,
): field is ResolvedIntrinsicField => field.input.scope === "intrinsic";

const persistFields = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  fields: readonly ResolvedPropertyField[],
  now: string,
): readonly BlockPropertyMutationFieldResult[] =>
  fields.map((field): BlockPropertyMutationFieldResult => {
    const revision = isResolvedIntrinsicField(field)
      ? persistIntrinsicField(database, request, field, now)
      : persistDatabaseField(database, request, field, now);
    if (isResolvedIntrinsicField(field)) {
      return {
        path: field.path,
        scope: "intrinsic",
        blockId: field.blockId,
        propertyKey: field.input.propertyKey,
        operation: "set",
        revision,
        value: field.input.value,
      };
    }
    return {
      path: field.path,
      scope: "database",
      blockId: field.blockId,
      databaseBlockId: field.input.databaseBlockId,
      propertyId: field.input.propertyId,
      operation: field.input.operation,
      revision,
      value: field.value,
    };
  });

const advanceBlockMetadataRevisions = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  blockIds: readonly string[],
  now: string,
): Readonly<Record<string, number>> => {
  const placeholders = blockIds.map(() => "?").join(", ");
  const update = database
    .prepare(
      `
      UPDATE blocks
      SET metadata_revision = metadata_revision + 1, updated_at = ?
      WHERE project_id = ? AND id IN (${placeholders})
    `,
    )
    .run(now, request.projectId, ...blockIds);
  if (update.changes !== blockIds.length) {
    reject(
      "block_not_found",
      "A target Block disappeared while committing property mutations",
      request,
    );
  }
  const rows = database
    .prepare(
      `
      SELECT id, metadata_revision
      FROM blocks
      WHERE project_id = ? AND id IN (${placeholders})
      ORDER BY id
    `,
    )
    .all(request.projectId, ...blockIds) as Pick<
    BlockRow,
    "id" | "metadata_revision"
  >[];
  return Object.fromEntries(rows.map((row) => [row.id, row.metadata_revision]));
};

const persistChangeLog = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  evidence: MutationEvidence,
  resolvedFields: readonly ResolvedPropertyField[],
  fieldResults: readonly BlockPropertyMutationFieldResult[],
  blockMetadataRevisions: Readonly<Record<string, number>>,
  now: string,
): number => {
  const committedRevisions = Object.fromEntries(
    fieldResults.map((field) => [field.path, field.revision]),
  );
  const payload = {
    version: BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION,
    requestHash: evidence.requestHash,
    fieldPaths: fieldResults.map((field) => field.path),
    fieldChanges: fieldResults.map((field) => {
      const resolved = resolvedFields.find(
        (candidate) => candidate.path === field.path,
      );
      if (!resolved) {
        throw new Error(`Missing resolved property evidence for ${field.path}`);
      }
      return {
        path: field.path,
        scope: field.scope,
        operation: field.operation,
        before: {
          exists: resolved.currentRevision > 0,
          revision: resolved.currentRevision,
          value: resolved.currentValue,
        },
        after: {
          exists: true,
          revision: field.revision,
          value: field.value,
        },
      };
    }),
    committedRevisions,
    blockMetadataRevisions,
  };
  const insert = database
    .prepare(
      `
      INSERT INTO change_log (
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?)
    `,
    )
    .run(
      request.projectId,
      request.storeEpoch,
      "block_mutation",
      request.mutationId,
      evidence.targetBlockIdsJson,
      evidence.databaseBlockIdsJson,
      stableStringifyBlockPropertyJson(payload),
      now,
    );
  const sequence = Number(insert.lastInsertRowid);
  if (Number.isSafeInteger(sequence) && sequence >= 1) return sequence;
  throw new Error("SQLite returned an invalid change-log sequence");
};

const persistLedger = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  evidence: MutationEvidence,
  outcome: "committed" | "rejected",
  resultJson: string,
  committedRevisionsJson: string,
  changeLogSeq: number | null,
  now: string,
): void => {
  database
    .prepare(
      `
      INSERT INTO block_mutations (
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        client_session_id, request_hash, request_json, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json,
        field_intents_json, expected_revisions_json, outcome, result_json,
        committed_revisions_json, document_heads_json, change_log_seq,
        recorded_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, '{}', ?, ?
      )
    `,
    )
    .run(
      request.mutationId,
      request.projectId,
      request.storeEpoch,
      MUTATION_KIND,
      evidence.actorJson,
      request.clientSessionId ?? null,
      evidence.requestHash,
      evidence.canonicalRequest,
      evidence.targetBlockIdsJson,
      evidence.databaseBlockIdsJson,
      evidence.fieldIntentsJson,
      evidence.expectedRevisionsJson,
      outcome,
      resultJson,
      committedRevisionsJson,
      changeLogSeq,
      now,
    );
};

const persistRejectedOutcome = (
  database: Database.Database,
  request: BlockPropertyMutationRequest,
  evidence: MutationEvidence,
  error: BlockPropertyMutationCommandError,
  now: string,
): BlockPropertyMutationCommandResult => {
  persistLedger(
    database,
    request,
    evidence,
    "rejected",
    stableStringifyBlockPropertyJson(error),
    EMPTY_OBJECT_JSON,
    null,
    now,
  );
  return { ok: false, error };
};

/**
 * Apply one field-level Card property batch on the process-wide SQLite writer.
 * Every field is validated before the first write, then values, one metadata
 * revision per Card, the change cursor, and the immutable receipt commit in one
 * IMMEDIATE transaction.
 */
export const applyBlockPropertyMutation = (
  database: Database.Database,
  rawRequest: BlockPropertyMutationRequest,
  options: ApplyBlockPropertyMutationOptions = {},
): BlockPropertyMutationCommandResult => {
  const request = parseBlockPropertyMutationRequest(rawRequest);
  const evidence = makeMutationEvidence(request);
  const inject = (point: BlockPropertyMutationFaultPoint): void => {
    options.faultInjector?.(point);
  };
  const apply = database.transaction((): BlockPropertyMutationCommandResult => {
    const currentEpoch = readCurrentStoreEpoch(database);
    if (currentEpoch !== request.storeEpoch) {
      return {
        ok: false,
        error: makeError(
          "store_epoch_mismatch",
          `Mutation belongs to store epoch ${request.storeEpoch}; current epoch is ${currentEpoch ?? "missing"}`,
          request,
        ),
      };
    }
    const existing = readStoredMutation(database, request.mutationId);
    if (existing) return loadStoredOutcome(existing, request, evidence);
    const projectExists = database
      .prepare("SELECT 1 AS present FROM projects WHERE id = ?")
      .get(request.projectId);
    if (!projectExists) {
      return {
        ok: false,
        error: makeError(
          "project_not_found",
          `Project does not exist: ${request.projectId}`,
          request,
        ),
      };
    }

    const now = options.now?.() ?? new Date().toISOString();
    let fields: readonly ResolvedPropertyField[];
    try {
      fields = resolveFields(database, request);
    } catch (error) {
      if (!(error instanceof PropertyMutationRejection)) throw error;
      const outcome = persistRejectedOutcome(
        database,
        request,
        evidence,
        error.error,
        now,
      );
      inject("after_ledger");
      inject("before_commit");
      return outcome;
    }

    const fieldResults = persistFields(database, request, fields, now);
    inject("after_property_values");
    const blockMetadataRevisions = advanceBlockMetadataRevisions(
      database,
      request,
      evidence.targetBlockIds,
      now,
    );
    inject("after_block_metadata");
    rebuildBlockPropertyMutationProjections(
      database,
      request.projectId,
      evidence.targetBlockIds,
      now,
    );
    inject("after_projections");
    const changeLogSeq = persistChangeLog(
      database,
      request,
      evidence,
      fields,
      fieldResults,
      blockMetadataRevisions,
      now,
    );
    inject("after_change_log");
    const result: BlockPropertyMutationResult = {
      version: BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION,
      mutationId: request.mutationId,
      projectId: request.projectId,
      storeEpoch: request.storeEpoch,
      duplicate: false,
      fields: fieldResults,
      blockMetadataRevisions,
      changeLogSeq,
      committedAt: now,
    };
    const committedRevisions = Object.fromEntries(
      fieldResults.map((field) => [field.path, field.revision]),
    );
    persistLedger(
      database,
      request,
      evidence,
      "committed",
      stableStringifyBlockPropertyJson(result),
      stableStringifyBlockPropertyJson(committedRevisions),
      changeLogSeq,
      now,
    );
    inject("after_ledger");
    inject("before_commit");
    return { ok: true, value: result };
  });
  const result = apply.immediate();
  inject("after_commit");
  return result;
};
