import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

import {
  BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION,
  BlockPropertyMutationV2ContractError,
  canonicalizeBlockPropertyMutationRequestV2,
  makeBlockPropertyFieldPathV2,
  parseBlockPropertyMutationCommandErrorV2,
  parseBlockPropertyMutationRequestV2,
  parseBlockPropertyMutationResultV2,
  stableStringifyBlockPropertyJsonV2,
  type BlockPropertyJsonValueV2,
  type BlockPropertyMutationCommandErrorV2,
  type BlockPropertyMutationCommandResultV2,
  type BlockPropertyMutationFieldResultV2,
  type BlockPropertyMutationRequestV2,
  type LibraryBlockPropertyMutationRequestV2,
  type BlockPropertyMutationResultV2,
  type SetIntrinsicBlockPropertyV2,
  type SetDataSourceScalarPropertyV2,
  type UpdateDataSourceSetPropertyV2,
} from "../../shared/block-property-mutations-v2";
import {
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import type { DataSourceOptionId } from "../../shared/database-identities";
import type { PageInput } from "../../shared/types";
import { assertValidPageInput } from "../../shared/page-input-validation";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";
import {
  authorizeContentResourceInDatabase,
  resolveContentResourceAuthorityInDatabase,
  type ContentResourceAuthority,
} from "./content-resource-authority";
import { libraryContentAccess } from "../../shared/content-access-context";
import { requireLocalProfileLibraryInDatabase } from "./local-profile-library";

export type BlockPropertyMutationV2FaultPoint =
  | "after_property_values"
  | "after_block_metadata"
  | "after_projections"
  | "after_change_log"
  | "after_ledger"
  | "before_commit"
  | "after_commit";

export interface ApplySourceBlockPropertyMutationV2Options {
  readonly faultInjector?: (point: BlockPropertyMutationV2FaultPoint) => void;
  readonly now?: () => string;
  readonly contentAuthority?: Extract<
    ContentResourceAuthority,
    { readonly kind: "local_user_library" }
  >;
  /**
   * The worker supplies the v81 projection refresher here so the authority
   * kernel stays independent from disposable scheduler/read-model modules.
   */
  readonly refreshProjections?: (
    database: Database.Database,
    input: Readonly<{
      projectId: string;
      pageIds: readonly string[];
      dataSourceIds: readonly string[];
      databaseIds: readonly string[];
      updatedAt: string;
    }>,
  ) => void;
}

const hasWriteAccess = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  resource: import("../../shared/resource-authorization").LibraryResource,
  options: ApplySourceBlockPropertyMutationV2Options,
): boolean => {
  if (options.contentAuthority) {
    const authorization = authorizeContentResourceInDatabase(database, {
      authority: options.contentAuthority,
      resource,
      action: "write",
    });
    return "allowed" in authorization && authorization.allowed;
  }
  return authorizeProjectResourceInDatabase(database, {
    projectId: request.projectId,
    resource,
    action: "write",
  }).allowed;
};

interface StoreEpochRow {
  readonly store_epoch: string;
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

interface SourceRow {
  readonly id: string;
  readonly library_id: string;
  readonly home_database_block_id: string;
  readonly lifecycle: string;
  readonly container_lifecycle: string;
  readonly block_type: string;
  readonly block_lifecycle: string;
}

interface PageRow {
  readonly block_id: string;
  readonly owner_project_id: string;
  readonly block_type: string;
  readonly block_lifecycle: string;
  readonly page_lifecycle: string;
  readonly library_id: string;
  readonly parent_kind: string;
  readonly parent_id: string;
}

interface MembershipRow {
  readonly id: string;
}

interface PropertyRow {
  readonly data_source_id: string;
  readonly id: string;
  readonly value_type: DatabasePropertyValueType;
  readonly config_json: string;
}

interface PropertyValueRow {
  readonly value_type: string;
  readonly value_json: string;
  readonly revision: number;
}

interface IntrinsicPropertyRow {
  readonly value_type: string;
  readonly value_json: string;
  readonly revision: number;
}

interface MutationEvidence {
  readonly canonicalRequest: string;
  readonly requestHash: string;
  readonly actorJson: string;
  readonly targetBlockIds: readonly string[];
  readonly targetBlockIdsJson: string;
  readonly dataSourceIds: readonly string[];
  readonly databaseIds: readonly string[];
  readonly databaseIdsJson: string;
  readonly fieldIntentsJson: string;
  readonly expectedRevisionsJson: string;
}

interface ResolvedSourceField {
  readonly input:
    | SetDataSourceScalarPropertyV2
    | UpdateDataSourceSetPropertyV2;
  readonly path: string;
  readonly pageId: string;
  readonly dataSourceId: string;
  readonly databaseId: string;
  readonly membershipId: string;
  readonly property: PropertyRow;
  readonly value: string | null | readonly DataSourceOptionId[];
  readonly valueJson: string;
  readonly currentRevision: number;
  readonly currentValue: string | null | readonly DataSourceOptionId[];
}

interface ResolvedIntrinsicField {
  readonly input: SetIntrinsicBlockPropertyV2;
  readonly path: string;
  readonly pageId: string;
  readonly ownerProjectId: string;
  readonly valueType: "null" | "boolean" | "number" | "string" | "json";
  readonly valueJson: string;
  readonly currentRevision: number;
  readonly currentValue: BlockPropertyJsonValueV2;
}

type ResolvedPropertyField = ResolvedIntrinsicField | ResolvedSourceField;

const MUTATION_KIND = "property_batch";
const EMPTY_ARRAY_JSON = "[]";
const EMPTY_OBJECT_JSON = "{}";
const SCHEDULE_PROPERTY_IDS = new Set([
  "scheduled_start",
  "scheduled_end",
]);
const INTRINSIC_SCHEDULE_KEYS = [
  "schedule.isAllDay",
  "schedule.timezone",
  "recurrence.config",
  "reminders.config",
] as const;
const RETIRED_INTRINSIC_PROPERTY_KEYS = new Set([
  "agent.blocked",
  "agent.status",
]);

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort(compareStrings);

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const makeError = (
  code: BlockPropertyMutationCommandErrorV2["code"],
  message: string,
  request?: Pick<BlockPropertyMutationRequestV2, "mutationId">,
  details: Pick<
    BlockPropertyMutationCommandErrorV2,
    "fieldPath" | "expectedRevision" | "actualRevision"
  > = {},
): BlockPropertyMutationCommandErrorV2 => ({
  code,
  message,
  retryable: false,
  ...(request ? { mutationId: request.mutationId } : {}),
  ...(details.fieldPath === undefined ? {} : { fieldPath: details.fieldPath }),
  ...(details.expectedRevision === undefined
    ? {}
    : { expectedRevision: details.expectedRevision }),
  ...(details.actualRevision === undefined
    ? {}
    : { actualRevision: details.actualRevision }),
});

class SourcePropertyMutationRejection extends Error {
  readonly error: BlockPropertyMutationCommandErrorV2;

  constructor(error: BlockPropertyMutationCommandErrorV2) {
    super(error.message);
    this.name = "SourcePropertyMutationRejection";
    this.error = error;
  }
}

const reject = (
  code: BlockPropertyMutationCommandErrorV2["code"],
  message: string,
  request: BlockPropertyMutationRequestV2,
  details?: Pick<
    BlockPropertyMutationCommandErrorV2,
    "fieldPath" | "expectedRevision" | "actualRevision"
  >,
): never => {
  throw new SourcePropertyMutationRejection(
    makeError(code, message, request, details),
  );
};

const parseJson = (
  value: string,
  request: BlockPropertyMutationRequestV2,
  path: string,
  label: string,
): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return reject(
      "property_value_corrupt",
      `${label} is not valid JSON`,
      request,
      { fieldPath: path },
    );
  }
};

const parsePropertyDefinition = (
  property: PropertyRow,
  request: BlockPropertyMutationRequestV2,
  path: string,
): Readonly<Record<string, DatabaseJsonValue>> => {
  try {
    return parseDatabasePropertyConfig(
      property.value_type,
      parseJson(
        property.config_json,
        request,
        path,
        `Property ${path} configuration`,
      ),
    );
  } catch (error) {
    if (error instanceof SourcePropertyMutationRejection) throw error;
    return reject(
      "property_value_corrupt",
      `Property ${path} has invalid configuration: ${error instanceof Error ? error.message : String(error)}`,
      request,
      { fieldPath: path },
    );
  }
};

const normalizeValue = (
  property: PropertyRow,
  value: unknown,
  request: BlockPropertyMutationRequestV2,
  path: string,
  corrupt: boolean,
): DatabaseJsonValue => {
  try {
    return normalizeDatabasePropertyValue(
      {
        valueType: property.value_type,
        config: parsePropertyDefinition(property, request, path),
      },
      value,
    );
  } catch (error) {
    if (error instanceof SourcePropertyMutationRejection) throw error;
    return reject(
      corrupt ? "property_value_corrupt" : "property_value_invalid",
      `${corrupt ? "Stored" : "Submitted"} Property ${path} value is invalid: ${error instanceof Error ? error.message : String(error)}`,
      request,
      { fieldPath: path },
    );
  }
};

const requireCanonicalScalar = (
  value: string | null,
  property: PropertyRow,
  request: BlockPropertyMutationRequestV2,
  path: string,
): void => {
  if (value === null && property.id !== "status") return;
  if (value !== null && value.length > 0 && value === value.trim()) return;
  reject(
    "property_value_invalid",
    `Property ${path} requires a canonical non-empty value`,
    request,
    { fieldPath: path },
  );
};

const validateAssignee = (
  property: PropertyRow,
  value: string | null,
  request: BlockPropertyMutationRequestV2,
  path: string,
): void => {
  if (property.id !== "assignee" || value === null) return;
  try {
    assertValidPageInput({ assignee: value }, "update");
  } catch (error) {
    reject(
      "property_value_invalid",
      `Property ${path} assignee is invalid: ${error instanceof Error ? error.message : String(error)}`,
      request,
      { fieldPath: path },
    );
  }
};

const inferIntrinsicValueType = (
  value: BlockPropertyJsonValueV2,
): ResolvedIntrinsicField["valueType"] => {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "json";
};

const validateKnownIntrinsicValue = (
  field: SetIntrinsicBlockPropertyV2,
  request: BlockPropertyMutationRequestV2,
  path: string,
): void => {
  if (RETIRED_INTRINSIC_PROPERTY_KEYS.has(field.propertyKey)) {
    reject(
      "property_not_found",
      `Intrinsic Property ${path} is retired`,
      request,
      { fieldPath: path },
    );
  }
  const candidate: Partial<PageInput> = {};
  switch (field.propertyKey) {
    case "run.target":
      candidate.runInTarget = field.value as PageInput["runInTarget"];
      break;
    case "run.localPath":
      candidate.runInLocalPath = field.value as PageInput["runInLocalPath"];
      break;
    case "run.baseBranch":
      candidate.runInBaseBranch = field.value as PageInput["runInBaseBranch"];
      break;
    case "run.worktreePath":
      candidate.runInWorktreePath =
        field.value as PageInput["runInWorktreePath"];
      break;
    case "run.environmentPath":
      candidate.runInEnvironmentPath =
        field.value as PageInput["runInEnvironmentPath"];
      break;
    case "schedule.isAllDay":
      if (typeof field.value === "boolean") return;
      reject(
        "property_value_invalid",
        `Intrinsic Property ${path} requires a boolean`,
        request,
        { fieldPath: path },
      );
      break;
    case "schedule.timezone":
      candidate.scheduleTimezone =
        field.value as PageInput["scheduleTimezone"];
      break;
    case "recurrence.config":
      candidate.recurrence = field.value as PageInput["recurrence"];
      break;
    case "reminders.config":
      candidate.reminders = field.value as unknown as PageInput["reminders"];
      break;
    default:
      return;
  }
  try {
    assertValidPageInput(candidate, "update");
  } catch (error) {
    reject(
      "property_value_invalid",
      `Intrinsic Property ${path} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      request,
      { fieldPath: path },
    );
  }
};

const readStoredIntrinsicValue = (
  row: IntrinsicPropertyRow | undefined,
  request: BlockPropertyMutationRequestV2,
  path: string,
): BlockPropertyJsonValueV2 => {
  if (!row) return null;
  const parsed = parseJson(
    row.value_json,
    request,
    path,
    `Stored intrinsic Property ${path}`,
  );
  try {
    const canonical = stableStringifyBlockPropertyJsonV2(parsed);
    if (canonical === row.value_json) {
      return JSON.parse(canonical) as BlockPropertyJsonValueV2;
    }
  } catch {
    // Rejected below as corrupt persisted authority.
  }
  return reject(
    "property_value_corrupt",
    `Stored intrinsic Property ${path} is not canonical JSON`,
    request,
    { fieldPath: path },
  );
};

const readStoredValue = (
  row: PropertyValueRow | undefined,
  property: PropertyRow,
  request: BlockPropertyMutationRequestV2,
  path: string,
): string | null | readonly DataSourceOptionId[] => {
  if (!row) return property.value_type === "multi_select" ? [] : null;
  if (row.value_type !== property.value_type) {
    return reject(
      "property_value_corrupt",
      `Stored Property ${path} type diverges from its definition`,
      request,
      { fieldPath: path },
    );
  }
  const parsed = parseJson(row.value_json, request, path, `Stored Property ${path}`);
  const normalized = normalizeValue(property, parsed, request, path, true);
  if (
    stableStringifyBlockPropertyJsonV2(normalized) !== row.value_json
  ) {
    return reject(
      "property_value_corrupt",
      `Stored Property ${path} is not canonical`,
      request,
      { fieldPath: path },
    );
  }
  if (property.value_type === "multi_select" && Array.isArray(normalized)) {
    return [...(normalized as readonly DataSourceOptionId[])].sort(
      compareStrings,
    );
  }
  if (normalized === null || typeof normalized === "string") return normalized;
  return reject(
    "property_value_corrupt",
    `Stored Property ${path} cannot be represented by the v2 contract`,
    request,
    { fieldPath: path },
  );
};

const readCurrentStoreEpoch = (database: Database.Database): string | null =>
  (database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as StoreEpochRow | undefined)?.store_epoch ?? null;

const readStoredMutation = (
  database: Database.Database,
  mutationId: string,
): StoredBlockMutationRow | null =>
  (database.prepare(`
    SELECT mutation_id, project_id, store_epoch, mutation_kind, actor_json,
      client_session_id, request_hash, request_json, target_block_ids_json,
      affected_document_ids_json, affected_database_block_ids_json,
      field_intents_json, expected_revisions_json, outcome, result_json,
      committed_revisions_json, document_heads_json, change_log_seq, recorded_at
    FROM block_mutations WHERE mutation_id = ?
  `).get(mutationId) as StoredBlockMutationRow | undefined) ?? null;

const makeMutationEvidence = (
  request: BlockPropertyMutationRequestV2,
): MutationEvidence => {
  const canonicalRequest = canonicalizeBlockPropertyMutationRequestV2(request);
  const targetBlockIds = uniqueSorted(
    request.fields.map((field) =>
      field.scope === "intrinsic" ? field.blockId : field.pageId,
    ),
  );
  const dataSourceIds = uniqueSorted(
    request.fields.flatMap((field) =>
      field.scope === "data_source" ? [field.dataSourceId] : [],
    ),
  );
  const fieldIntents = request.fields.map((field) => ({
    path: makeBlockPropertyFieldPathV2(field),
    operation: field.operation,
    scope: field.scope,
    ...(field.operation === "add_remove"
      ? { add: field.add, remove: field.remove }
      : {}),
  }));
  const expectedRevisions = Object.fromEntries(
    request.fields.flatMap((field) =>
      field.operation === "set"
        ? [[makeBlockPropertyFieldPathV2(field), field.expectedRevision] as const]
        : [],
    ),
  );
  return {
    canonicalRequest,
    requestHash: sha256(canonicalRequest),
    actorJson: stableStringifyBlockPropertyJsonV2(request.actor),
    targetBlockIds,
    targetBlockIdsJson: JSON.stringify(targetBlockIds),
    dataSourceIds,
    databaseIds: [],
    databaseIdsJson: EMPTY_ARRAY_JSON,
    fieldIntentsJson: stableStringifyBlockPropertyJsonV2(fieldIntents),
    expectedRevisionsJson:
      stableStringifyBlockPropertyJsonV2(expectedRevisions),
  };
};

const bindEvidenceDatabaseIds = (
  database: Database.Database,
  evidence: MutationEvidence,
): MutationEvidence => {
  if (evidence.dataSourceIds.length === 0) return evidence;
  const placeholders = evidence.dataSourceIds.map(() => "?").join(", ");
  const databaseIds = uniqueSorted(
    (database.prepare(`
      SELECT home_database_block_id AS databaseId
      FROM data_sources WHERE id IN (${placeholders})
    `).all(...evidence.dataSourceIds) as readonly {
      readonly databaseId: string;
    }[]).map((row) => row.databaseId),
  );
  return {
    ...evidence,
    databaseIds,
    databaseIdsJson: JSON.stringify(databaseIds),
  };
};

const storedMutationMatches = (
  stored: StoredBlockMutationRow,
  request: BlockPropertyMutationRequestV2,
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
  stored.field_intents_json === evidence.fieldIntentsJson &&
  stored.expected_revisions_json === evidence.expectedRevisionsJson &&
  stored.document_heads_json === EMPTY_OBJECT_JSON;

const loadStoredOutcome = (
  stored: StoredBlockMutationRow,
  request: BlockPropertyMutationRequestV2,
  evidence: MutationEvidence,
): BlockPropertyMutationCommandResultV2 => {
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
    const error = parseBlockPropertyMutationCommandErrorV2(
      JSON.parse(stored.result_json) as unknown,
    );
    return error.mutationId === request.mutationId
      ? { ok: false, error }
      : {
          ok: false,
          error: makeError(
            "unknown",
            `Rejected mutation ledger ${request.mutationId} has a mismatched result`,
            request,
          ),
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
  const result = parseBlockPropertyMutationResultV2(
    JSON.parse(stored.result_json) as unknown,
  );
  const expectedPaths = request.fields.map(makeBlockPropertyFieldPathV2);
  const resultPaths = result.fields.map((field) => field.path);
  const committedRevisionsJson = stableStringifyBlockPropertyJsonV2(
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
    JSON.stringify(resultPaths) !== JSON.stringify(expectedPaths) ||
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
  return { ok: true, value: { ...result, duplicate: true } };
};

const readSource = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  dataSourceId: string,
  path: string,
  options: ApplySourceBlockPropertyMutationV2Options,
): SourceRow => {
  const source = database.prepare(`
    SELECT source.id, source.library_id, source.home_database_block_id,
      source.lifecycle, container.lifecycle AS container_lifecycle,
      database_block.type AS block_type,
      database_block.lifecycle AS block_lifecycle
    FROM data_sources source
    INNER JOIN database_containers container
      ON container.block_id = source.home_database_block_id
    INNER JOIN blocks database_block
      ON database_block.id = container.block_id
    WHERE source.id = ?
  `).get(dataSourceId) as SourceRow | undefined;
  if (
    !source ||
    source.lifecycle !== "active" ||
    source.container_lifecycle !== "active" ||
    source.block_type !== "database" ||
    source.block_lifecycle !== "active"
  ) {
    return reject(
      "data_source_not_found",
      `Active Data Source is unavailable: ${dataSourceId}`,
      request,
      { fieldPath: path },
    );
  }
  if (hasWriteAccess(
    database,
    request,
    { kind: "data_source", dataSourceId },
    options,
  )) return source;
  return reject(
    "data_source_not_found",
    `Writable Data Source is unavailable: ${dataSourceId}`,
    request,
    { fieldPath: path },
  );
};

const readPageMembership = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  source: SourceRow,
  pageId: string,
  path: string,
): MembershipRow => {
  const page = readActivePage(database, request, pageId, path);
  if (
    page.library_id !== source.library_id ||
    page.parent_kind !== "data_source" ||
    page.parent_id !== source.id
  ) {
    return reject(
      "membership_not_found",
      `Page ${pageId} parent does not match Data Source ${source.id}`,
      request,
      { fieldPath: path },
    );
  }
  const memberships = database.prepare(`
    SELECT id FROM data_source_page_memberships
    WHERE page_block_id = ? AND data_source_id = ? AND removed_at IS NULL
  `).all(pageId, source.id) as readonly MembershipRow[];
  if (memberships.length === 1) return memberships[0]!;
  return reject(
    "membership_not_found",
    `Page ${pageId} requires exactly one active membership in Data Source ${source.id}`,
    request,
    { fieldPath: path },
  );
};

const readActivePage = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  pageId: string,
  path: string,
): PageRow => {
  const page = database.prepare(`
    SELECT page.block_id, block.type AS block_type,
      block.project_id AS owner_project_id,
      block.lifecycle AS block_lifecycle, page.lifecycle AS page_lifecycle,
      page.library_id, page.parent_kind, page.parent_id
    FROM pages page
    INNER JOIN blocks block ON block.id = page.block_id
    WHERE page.block_id = ?
  `).get(pageId) as PageRow | undefined;
  if (!page) {
    return reject(
      "block_not_found",
      `Page Block does not exist: ${pageId}`,
      request,
      { fieldPath: path },
    );
  }
  if (page.block_lifecycle !== "active" || page.page_lifecycle !== "active") {
    return reject(
      "block_not_active",
      `Page Block is not active: ${pageId}`,
      request,
      { fieldPath: path },
    );
  }
  if (page.block_type !== "page") {
    return reject(
      "block_type_mismatch",
      `Property mutations require a Page Block: ${pageId}`,
      request,
      { fieldPath: path },
    );
  }
  return page;
};

const readProperty = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  field: SetDataSourceScalarPropertyV2 | UpdateDataSourceSetPropertyV2,
  path: string,
): PropertyRow => {
  const property = database.prepare(`
    SELECT data_source_id, id, value_type, config_json
    FROM data_source_properties
    WHERE data_source_id = ? AND id = ? AND lifecycle = 'active'
  `).get(field.dataSourceId, field.propertyId) as PropertyRow | undefined;
  if (property) return property;
  return reject(
    "property_not_found",
    `Active Property ${field.propertyId} is outside Data Source ${field.dataSourceId}`,
    request,
    { fieldPath: path },
  );
};

const requireSupportedOperation = (
  property: PropertyRow,
  field: SetDataSourceScalarPropertyV2 | UpdateDataSourceSetPropertyV2,
  request: BlockPropertyMutationRequestV2,
  path: string,
): void => {
  if (field.operation === "add_remove" && property.value_type === "multi_select") {
    return;
  }
  if (
    field.operation === "set" &&
    ["text", "select", "date", "datetime", "person"].includes(
      property.value_type,
    )
  ) {
    return;
  }
  reject(
    "property_type_mismatch",
    `Operation ${field.operation} cannot mutate ${property.value_type} Property ${path}`,
    request,
    { fieldPath: path },
  );
};

const resolveIntrinsicField = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  field: SetIntrinsicBlockPropertyV2,
  options: ApplySourceBlockPropertyMutationV2Options,
): ResolvedIntrinsicField => {
  const path = makeBlockPropertyFieldPathV2(field);
  const page = readActivePage(database, request, field.blockId, path);
  if (!hasWriteAccess(
    database,
    request,
    { kind: "page", pageId: field.blockId },
    options,
  )) {
    return reject(
      "block_not_found",
      `Writable Page Block is unavailable: ${field.blockId}`,
      request,
      { fieldPath: path },
    );
  }
  validateKnownIntrinsicValue(field, request, path);
  const current = database.prepare(`
    SELECT value_type, value_json, revision FROM block_properties
    WHERE block_id = ? AND project_id = ? AND property_key = ?
  `).get(field.blockId, page.owner_project_id, field.propertyKey) as
    | IntrinsicPropertyRow
    | undefined;
  const actualRevision = current?.revision ?? 0;
  if (actualRevision !== field.expectedRevision) {
    return reject(
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
    pageId: field.blockId,
    ownerProjectId: page.owner_project_id,
    valueType: inferIntrinsicValueType(field.value),
    valueJson: stableStringifyBlockPropertyJsonV2(field.value),
    currentRevision: actualRevision,
    currentValue: readStoredIntrinsicValue(current, request, path),
  };
};

const resolveField = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  field: SetDataSourceScalarPropertyV2 | UpdateDataSourceSetPropertyV2,
  options: ApplySourceBlockPropertyMutationV2Options,
): ResolvedSourceField => {
  const path = makeBlockPropertyFieldPathV2(field);
  const source = readSource(
    database,
    request,
    field.dataSourceId,
    path,
    options,
  );
  const membership = readPageMembership(
    database,
    request,
    source,
    field.pageId,
    path,
  );
  const property = readProperty(database, request, field, path);
  requireSupportedOperation(property, field, request, path);
  const current = database.prepare(`
    SELECT value_type, value_json, revision
    FROM data_source_property_values
    WHERE data_source_id = ? AND membership_id = ? AND property_id = ?
  `).get(source.id, membership.id, property.id) as PropertyValueRow | undefined;
  const currentRevision = current?.revision ?? 0;
  const currentValue = readStoredValue(current, property, request, path);
  if (
    field.operation === "set" &&
    currentRevision !== field.expectedRevision
  ) {
    return reject(
      "property_conflict",
      `Property ${path} is at revision ${currentRevision}, not ${field.expectedRevision}`,
      request,
      {
        fieldPath: path,
        expectedRevision: field.expectedRevision,
        actualRevision: currentRevision,
      },
    );
  }
  if (field.operation === "set") {
    requireCanonicalScalar(field.value, property, request, path);
    validateAssignee(property, field.value, request, path);
    const value = normalizeValue(property, field.value, request, path, false);
    if (value !== null && typeof value !== "string") {
      return reject(
        "property_type_mismatch",
        `Property ${path} cannot be represented by a v2 scalar`,
        request,
        { fieldPath: path },
      );
    }
    return {
      input: field,
      path,
      pageId: field.pageId,
      dataSourceId: source.id,
      databaseId: source.home_database_block_id,
      membershipId: membership.id,
      property,
      value,
      valueJson: stableStringifyBlockPropertyJsonV2(value),
      currentRevision,
      currentValue,
    };
  }
  const next = new Set(currentValue as readonly DataSourceOptionId[]);
  for (const optionId of field.remove) next.delete(optionId);
  for (const optionId of field.add) next.add(optionId);
  const normalizedValue = normalizeValue(
    property,
    [...next],
    request,
    path,
    false,
  );
  if (!Array.isArray(normalizedValue)) {
    return reject(
      "property_type_mismatch",
      `Property ${path} cannot be represented by a v2 option set`,
      request,
      { fieldPath: path },
    );
  }
  const value = [...(normalizedValue as readonly DataSourceOptionId[])].sort(
    compareStrings,
  );
  return {
    input: field,
    path,
    pageId: field.pageId,
    dataSourceId: source.id,
    databaseId: source.home_database_block_id,
    membershipId: membership.id,
    property,
    value,
    valueJson: stableStringifyBlockPropertyJsonV2(normalizedValue),
    currentRevision,
    currentValue,
  };
};

const readIntrinsicScheduleValues = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  pageId: string,
  path: string,
): Map<string, unknown> => {
  const placeholders = INTRINSIC_SCHEDULE_KEYS.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT property_key, value_json FROM block_properties
    WHERE block_id = ? AND property_key IN (${placeholders})
  `).all(pageId, ...INTRINSIC_SCHEDULE_KEYS) as readonly {
    readonly property_key: string;
    readonly value_json: string;
  }[];
  return new Map(
    rows.map((row) => [
      row.property_key,
      parseJson(
        row.value_json,
        request,
        path,
        `Page ${pageId} intrinsic schedule Property ${row.property_key}`,
      ),
    ]),
  );
};

const isResolvedIntrinsicField = (
  field: ResolvedPropertyField,
): field is ResolvedIntrinsicField => field.input.scope === "intrinsic";

const validateScheduleAfterMutation = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  fields: readonly ResolvedPropertyField[],
): void => {
  const scheduleKeys = new Set<string>(INTRINSIC_SCHEDULE_KEYS);
  const byPage = new Map<string, ResolvedPropertyField[]>();
  for (const field of fields) {
    const affectsSchedule = isResolvedIntrinsicField(field)
      ? scheduleKeys.has(field.input.propertyKey)
      : SCHEDULE_PROPERTY_IDS.has(field.property.id);
    if (!affectsSchedule) continue;
    const pageFields = byPage.get(field.pageId) ?? [];
    pageFields.push(field);
    byPage.set(field.pageId, pageFields);
  }
  for (const [pageId, pageFields] of byPage) {
    const first = pageFields[0];
    if (!first) continue;
    const rows = database.prepare(`
      SELECT value.property_id, value.value_json
      FROM data_source_page_memberships membership
      INNER JOIN data_source_property_values value
        ON value.data_source_id = membership.data_source_id
       AND value.membership_id = membership.id
      WHERE membership.page_block_id = ? AND membership.removed_at IS NULL
        AND value.property_id IN ('scheduled_start', 'scheduled_end')
    `).all(pageId) as readonly {
      readonly property_id: string;
      readonly value_json: string;
    }[];
    const values = new Map<string, unknown>(
      rows.map((row) => [
        row.property_id,
        parseJson(
          row.value_json,
          request,
          first.path,
          `Page ${pageId} scheduled Property ${row.property_id}`,
        ),
      ]),
    );
    const intrinsic = readIntrinsicScheduleValues(
      database,
      request,
      pageId,
      first.path,
    );
    for (const field of pageFields) {
      if (isResolvedIntrinsicField(field)) {
        intrinsic.set(field.input.propertyKey, field.input.value);
        continue;
      }
      values.set(field.property.id, field.value);
    }
    const start = values.get("scheduled_start");
    const end = values.get("scheduled_end");
    if ((start == null) !== (end == null)) {
      reject(
        "property_value_invalid",
        `Page ${pageId} must set or clear scheduled_start and scheduled_end together`,
        request,
        { fieldPath: first.path },
      );
    }
    try {
      assertValidPageInput(
        {
          scheduledStart: start == null ? null : new Date(start as string),
          scheduledEnd: end == null ? null : new Date(end as string),
          isAllDay: intrinsic.get("schedule.isAllDay") as boolean | undefined,
          scheduleTimezone: intrinsic.get("schedule.timezone") as
            | string
            | null
            | undefined,
          recurrence: intrinsic.get("recurrence.config") as
            | PageInput["recurrence"]
            | undefined,
          reminders: intrinsic.get("reminders.config") as
            | PageInput["reminders"]
            | undefined,
        },
        "update",
      );
    } catch (error) {
      reject(
        "property_value_invalid",
        `Page ${pageId} has invalid scheduled metadata: ${error instanceof Error ? error.message : String(error)}`,
        request,
        { fieldPath: first.path },
      );
    }
  }
};

const resolveFields = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  options: ApplySourceBlockPropertyMutationV2Options,
): readonly ResolvedPropertyField[] => {
  const fields = request.fields.map((field) =>
    field.scope === "intrinsic"
      ? resolveIntrinsicField(database, request, field, options)
      : resolveField(database, request, field, options),
  );
  validateScheduleAfterMutation(database, request, fields);
  return fields;
};

const persistIntrinsicField = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  field: ResolvedIntrinsicField,
  now: string,
): BlockPropertyMutationFieldResultV2 => {
  const nextRevision = field.currentRevision + 1;
  if (field.currentRevision === 0) {
    database.prepare(`
      INSERT INTO block_properties (
        block_id, project_id, property_key, value_type, value_json,
        revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(
      field.pageId,
      field.ownerProjectId,
      field.input.propertyKey,
      field.valueType,
      field.valueJson,
      now,
    );
  } else {
    const update = database.prepare(`
      UPDATE block_properties
      SET value_type = ?, value_json = ?, revision = revision + 1,
        updated_at = ?
      WHERE block_id = ? AND project_id = ? AND property_key = ?
        AND revision = ?
    `).run(
      field.valueType,
      field.valueJson,
      now,
      field.pageId,
      field.ownerProjectId,
      field.input.propertyKey,
      field.currentRevision,
    );
    if (update.changes !== 1) {
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
    }
  }
  return {
    path: field.path,
    scope: "intrinsic",
    blockId: field.pageId,
    propertyKey: field.input.propertyKey,
    operation: "set",
    revision: nextRevision,
    value: field.input.value,
  };
};

const persistSourceField = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  field: ResolvedSourceField,
  now: string,
): BlockPropertyMutationFieldResultV2 => {
  const nextRevision = field.currentRevision + 1;
  if (field.currentRevision === 0) {
    database.prepare(`
      INSERT INTO data_source_property_values (
        data_source_id, membership_id, property_id, value_type,
        value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(
      field.dataSourceId,
      field.membershipId,
      field.property.id,
      field.property.value_type,
      field.valueJson,
      now,
    );
  } else {
    const update = database.prepare(`
      UPDATE data_source_property_values
      SET value_json = ?, revision = revision + 1, updated_at = ?
      WHERE data_source_id = ? AND membership_id = ? AND property_id = ?
        AND value_type = ? AND revision = ?
    `).run(
      field.valueJson,
      now,
      field.dataSourceId,
      field.membershipId,
      field.property.id,
      field.property.value_type,
      field.currentRevision,
    );
    if (update.changes !== 1) {
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
    }
  }
  if (
    field.property.id === "status" &&
    field.input.operation === "set" &&
    typeof field.value === "string"
  ) {
    database.prepare(`
      UPDATE database_view_page_positions
      SET group_key = ?, updated_at = ?
      WHERE page_block_id = ? AND view_id IN (
        SELECT id FROM database_views
        WHERE data_source_id = ? AND lifecycle = 'active' AND kind = 'kanban'
          AND json_extract(config_json, '$.group.propertyId') = 'status'
      )
    `).run(field.value, now, field.pageId, field.dataSourceId);
  }
  return {
    path: field.path,
    scope: "data_source",
    blockId: field.pageId,
    dataSourceId: field.dataSourceId,
    propertyId: field.input.propertyId,
    operation: field.input.operation,
    revision: nextRevision,
    value: field.value,
  };
};

const persistField = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  field: ResolvedPropertyField,
  now: string,
): BlockPropertyMutationFieldResultV2 =>
  isResolvedIntrinsicField(field)
    ? persistIntrinsicField(database, request, field, now)
    : persistSourceField(database, request, field, now);

const advanceBlockMetadataRevisions = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  pageIds: readonly string[],
  now: string,
): Readonly<Record<string, number>> => {
  const placeholders = pageIds.map(() => "?").join(", ");
  const update = database.prepare(`
    UPDATE blocks SET metadata_revision = metadata_revision + 1, updated_at = ?
    WHERE id IN (${placeholders})
  `).run(now, ...pageIds);
  if (update.changes !== pageIds.length) {
    return reject(
      "block_not_found",
      "A target Page disappeared while committing Properties",
      request,
    );
  }
  const rows = database.prepare(`
    SELECT id, metadata_revision FROM blocks
    WHERE id IN (${placeholders}) ORDER BY id
  `).all(...pageIds) as readonly {
    readonly id: string;
    readonly metadata_revision: number;
  }[];
  return Object.fromEntries(
    rows.map((row) => [row.id, row.metadata_revision]),
  );
};

const persistChangeLog = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  evidence: MutationEvidence,
  resolvedFields: readonly ResolvedPropertyField[],
  fieldResults: readonly BlockPropertyMutationFieldResultV2[],
  blockMetadataRevisions: Readonly<Record<string, number>>,
  now: string,
): number => {
  const resolvedByPath = new Map(
    resolvedFields.map((field) => [field.path, field]),
  );
  const committedRevisions = Object.fromEntries(
    fieldResults.map((field) => [field.path, field.revision]),
  );
  const payload = {
    version: BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION,
    requestHash: evidence.requestHash,
    fieldPaths: fieldResults.map((field) => field.path),
    fieldChanges: fieldResults.map((field) => {
      const resolved = resolvedByPath.get(field.path);
      if (!resolved) throw new Error(`Missing Property evidence for ${field.path}`);
      return {
        path: field.path,
        scope: field.scope,
        operation: field.operation,
        before: {
          exists: resolved.currentRevision > 0,
          revision: resolved.currentRevision,
          value: resolved.currentValue,
        },
        after: { exists: true, revision: field.revision, value: field.value },
      };
    }),
    committedRevisions,
    blockMetadataRevisions,
  };
  const insert = database.prepare(`
    INSERT INTO change_log (
      project_id, store_epoch, kind, operation_id, block_ids_json,
      document_ids_json, database_block_ids_json, payload_json, committed_at
    ) VALUES (?, ?, 'block_mutation', ?, ?, '[]', ?, ?, ?)
  `).run(
    request.projectId,
    request.storeEpoch,
    request.mutationId,
    evidence.targetBlockIdsJson,
    evidence.databaseIdsJson,
    stableStringifyBlockPropertyJsonV2(payload),
    now,
  );
  const sequence = Number(insert.lastInsertRowid);
  if (Number.isSafeInteger(sequence) && sequence >= 1) return sequence;
  throw new Error("SQLite returned an invalid change-log sequence");
};

const persistLedger = (
  database: Database.Database,
  request: BlockPropertyMutationRequestV2,
  evidence: MutationEvidence,
  outcome: "committed" | "rejected",
  resultJson: string,
  committedRevisionsJson: string,
  changeLogSeq: number | null,
  now: string,
): void => {
  database.prepare(`
    INSERT INTO block_mutations (
      mutation_id, project_id, store_epoch, mutation_kind, actor_json,
      client_session_id, request_hash, request_json, target_block_ids_json,
      affected_document_ids_json, affected_database_block_ids_json,
      field_intents_json, expected_revisions_json, outcome, result_json,
      committed_revisions_json, document_heads_json, change_log_seq, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, '{}', ?, ?)
  `).run(
    request.mutationId,
    request.projectId,
    request.storeEpoch,
    MUTATION_KIND,
    evidence.actorJson,
    request.clientSessionId ?? null,
    evidence.requestHash,
    evidence.canonicalRequest,
    evidence.targetBlockIdsJson,
    evidence.databaseIdsJson,
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
  request: BlockPropertyMutationRequestV2,
  evidence: MutationEvidence,
  error: BlockPropertyMutationCommandErrorV2,
  now: string,
): BlockPropertyMutationCommandResultV2 => {
  persistLedger(
    database,
    request,
    evidence,
    "rejected",
    stableStringifyBlockPropertyJsonV2(error),
    EMPTY_OBJECT_JSON,
    null,
    now,
  );
  return { ok: false, error };
};

/**
 * v2 authority for intrinsic and Source-scoped Page Properties.
 */
export const applySourceBlockPropertyMutationV2 = (
  database: Database.Database,
  rawRequest: unknown,
  options: ApplySourceBlockPropertyMutationV2Options = {},
): BlockPropertyMutationCommandResultV2 => {
  let request: BlockPropertyMutationRequestV2;
  try {
    request = parseBlockPropertyMutationRequestV2(rawRequest);
  } catch (error) {
    if (!(error instanceof BlockPropertyMutationV2ContractError)) throw error;
    return {
      ok: false,
      error: makeError(
        "invalid_property_mutation_request",
        error.message,
      ),
    };
  }
  const requestEvidence = makeMutationEvidence(request);
  const inject = (point: BlockPropertyMutationV2FaultPoint): void => {
    options.faultInjector?.(point);
  };
  const apply = database.transaction((): BlockPropertyMutationCommandResultV2 => {
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
    if (existing) return loadStoredOutcome(existing, request, requestEvidence);
    const project = database.prepare("SELECT 1 FROM projects WHERE id = ?")
      .get(request.projectId);
    if (!project) {
      return {
        ok: false,
        error: makeError(
          "project_not_found",
          `Project does not exist: ${request.projectId}`,
          request,
        ),
      };
    }
    const evidence = bindEvidenceDatabaseIds(database, requestEvidence);
    const now = options.now?.() ?? new Date().toISOString();
    let fields: readonly ResolvedPropertyField[];
    try {
      fields = resolveFields(database, request, options);
    } catch (error) {
      if (!(error instanceof SourcePropertyMutationRejection)) throw error;
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
    const fieldResults = fields.map((field) =>
      persistField(database, request, field, now),
    );
    inject("after_property_values");
    const blockMetadataRevisions = advanceBlockMetadataRevisions(
      database,
      request,
      evidence.targetBlockIds,
      now,
    );
    inject("after_block_metadata");
    options.refreshProjections?.(database, {
      projectId: request.projectId,
      pageIds: evidence.targetBlockIds,
      dataSourceIds: evidence.dataSourceIds,
      databaseIds: evidence.databaseIds,
      updatedAt: now,
    });
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
    const result: BlockPropertyMutationResultV2 = {
      version: BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION,
      mutationId: request.mutationId,
      projectId: request.projectId,
      storeEpoch: request.storeEpoch,
      duplicate: false,
      fields: fieldResults,
      blockMetadataRevisions,
      changeLogSeq,
      committedAt: now,
    };
    persistLedger(
      database,
      request,
      evidence,
      "committed",
      stableStringifyBlockPropertyJsonV2(result),
      stableStringifyBlockPropertyJsonV2(
        Object.fromEntries(
          fieldResults.map((field) => [field.path, field.revision]),
        ),
      ),
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

export const applyLibrarySourceBlockPropertyMutationV2 = (
  database: Database.Database,
  request: LibraryBlockPropertyMutationRequestV2,
  actor: BlockPropertyMutationRequestV2["actor"],
  accessActor: "app_window" | "http_loopback",
  options: Omit<ApplySourceBlockPropertyMutationV2Options, "contentAuthority"> = {},
): BlockPropertyMutationCommandResultV2 => {
  const local = requireLocalProfileLibraryInDatabase(database);
  const compatibilityProject = database.prepare(`
    SELECT id FROM projects
    WHERE library_id = ?
    ORDER BY created, id
    LIMIT 1
  `).get(local.libraryId) as { readonly id: string } | undefined;
  if (!compatibilityProject) {
    return {
      ok: false,
      error: makeError(
        "project_not_found",
        "The local Library has no compatibility storage Project",
      ),
    };
  }
  const authority = resolveContentResourceAuthorityInDatabase(database, {
    context: libraryContentAccess,
    actor: accessActor,
  });
  if (authority.kind !== "local_user_library") {
    return {
      ok: false,
      error: makeError(
        "invalid_property_mutation_request",
        "Local Library authority could not be resolved",
      ),
    };
  }
  return applySourceBlockPropertyMutationV2(
    database,
    {
      ...request,
      projectId: compatibilityProject.id,
      actor,
    },
    { ...options, contentAuthority: authority },
  );
};
