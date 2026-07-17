import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  canonicalizeTagName,
  isReservedDataSourcePropertyId,
  type BuiltInDataSourcePropertyId,
} from "../../shared/database-identities";
import {
  databaseGroupKeyForValue,
  databaseGroupValueFromKey,
  parseDatabasePropertyConfig,
  parseDatabaseViewConfig,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import {
  createOptionIdentityMappings,
  createPropertyIdentityMappings,
  DatabaseIdentityCutoverError,
  rewriteCommittedBlockPropertyEvidence,
  rewriteCommittedDatabaseOperationEvidence,
  rewriteCommittedPageLifecycleCreateEvidence,
  rewriteDatabaseViewConfigV1ToV2,
  type BlockPropertyEvidenceAggregate,
  type OptionIdentityMapping,
  type PropertyIdentityMapping,
} from "./database-identity-cutover";

const SOURCE_SCHEMA_VERSION = 80;
const TARGET_SCHEMA_VERSION = 81;
const LEGACY_AUTHORITY_TABLES = [
  "database_property_values",
  "database_view_positions",
  "database_memberships",
  "database_properties",
  "database_capabilities",
] as const;
const IMMUTABLE_EVIDENCE_TRIGGERS = [
  "block_mutations_are_immutable",
  "change_log_is_immutable",
] as const;

export const DATABASE_IDENTITY_CUTOVER_FAULT_POINTS = [
  "after_identity_maps",
  "after_authority_rebuild",
  "after_evidence_rewrite",
  "before_publish",
] as const;

export type DatabaseIdentityCutoverFaultPoint =
  (typeof DATABASE_IDENTITY_CUTOVER_FAULT_POINTS)[number];

export interface DatabaseIdentityCutoverSqliteOptions {
  readonly nextStoreEpoch?: string;
  readonly now?: string;
  readonly injectFault?: (point: DatabaseIdentityCutoverFaultPoint) => void;
}

export interface DatabaseIdentityCutoverSqliteReport {
  readonly sourceVersion: typeof SOURCE_SCHEMA_VERSION;
  readonly targetVersion: typeof TARGET_SCHEMA_VERSION;
  readonly previousStoreEpoch: string;
  readonly nextStoreEpoch: string;
  readonly propertyMappings: number;
  readonly optionMappings: number;
  readonly rewrittenPropertyValues: number;
  readonly rewrittenViews: number;
  readonly rewrittenPositions: number;
  readonly rewrittenEvidenceAggregates: number;
  readonly clearedDatabaseModuleReceipts: number;
  readonly clearedAgentCallReceipts: number;
}

interface PropertyRow {
  readonly id: string;
  readonly data_source_id: string;
  readonly key: string;
  readonly name: string;
  readonly value_type: DatabasePropertyValueType;
  readonly config_json: string;
  readonly rank_key: string;
  readonly lifecycle: "active" | "deleted";
  readonly schema_revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface PropertyValueRow {
  readonly membership_id: string;
  readonly property_id: string;
  readonly data_source_id: string;
  readonly value_type: DatabasePropertyValueType;
  readonly value_json: string;
  readonly revision: number;
  readonly updated_at: string;
}

interface ViewRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly data_source_id: string;
  readonly name: string;
  readonly kind: "kanban" | "list" | "calendar" | "canvas";
  readonly config_json: string;
  readonly revision: number;
  readonly rank_key: string;
  readonly lifecycle: "active" | "deleted";
  readonly created_at: string;
  readonly updated_at: string;
}

interface PositionRow {
  readonly view_id: string;
  readonly page_block_id: string;
  readonly group_key: string | null;
  readonly rank_key: string;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface PageReadModelRow extends Record<string, unknown> {
  readonly page_block_id: string;
  readonly membership_id: string | null;
  readonly database_values_json: string;
  readonly view_id: string | null;
  readonly view_group_key: string | null;
}

interface EvidenceRow {
  readonly mutation_id: string;
  readonly project_id: string;
  readonly store_epoch: string;
  readonly mutation_kind: string;
  readonly request_hash: string;
  readonly request_json: string;
  readonly field_intents_json: string;
  readonly expected_revisions_json: string;
  readonly outcome: "committed" | "rejected";
  readonly result_json: string;
  readonly committed_revisions_json: string;
  readonly change_log_seq: number | null;
  readonly change_project_id: string | null;
  readonly change_store_epoch: string | null;
  readonly change_operation_id: string | null;
  readonly change_payload_json: string | null;
}

interface EvidenceRewrite {
  readonly mutationId: string;
  readonly changeLogSeq: number;
  readonly evidence: {
    readonly requestJson: string;
    readonly requestHash: string;
    readonly fieldIntentsJson: string;
    readonly expectedRevisionsJson: string;
    readonly resultJson: string;
    readonly committedRevisionsJson: string;
    readonly changePayloadJson: string;
  };
}

interface NamedSqliteObject {
  readonly name: string;
  readonly sql: string;
}

const BUILT_IN_VALUE_TYPES: Readonly<
  Record<BuiltInDataSourcePropertyId, DatabasePropertyValueType>
> = {
  status: "select",
  priority: "select",
  estimate: "select",
  tags: "multi_select",
  due_date: "date",
  scheduled_start: "datetime",
  scheduled_end: "datetime",
  assignee: "person",
};

const mappingKey = (...coordinates: readonly string[]): string =>
  stableStringifyBlockPropertyJson(coordinates);

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const readUserVersion = (database: Database.Database): number =>
  database.pragma("user_version", { simple: true }) as number;

const requireCanonicalIdentity = (value: string, label: string): string => {
  if (
    value.length >= 1 &&
    value.length <= 512 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return value;
  }
  throw new DatabaseIdentityCutoverError(`${label} is not a canonical identity`);
};

const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new DatabaseIdentityCutoverError(`${label} is not valid JSON${detail}`);
  }
};

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
    `Schema v80 cutover is missing required table(s): ${missing.join(", ")}`,
  );
};

const legacyReferencePattern = new RegExp(
  `\\b(?:${LEGACY_AUTHORITY_TABLES.join("|")})\\b`,
  "u",
);

const assertNoForeignKeyViolations = (
  database: Database.Database,
  label: string,
): void => {
  const violations = database.pragma("foreign_key_check") as readonly unknown[];
  if (violations.length === 0) return;
  throw new DatabaseIdentityCutoverError(
    `${label} found ${violations.length} foreign-key violation(s): ${JSON.stringify(violations.slice(0, 10))}`,
  );
};

const canonicalJson = (value: unknown): string =>
  stableStringifyBlockPropertyJson(value);

const propertyMappingIndexes = (
  mappings: readonly PropertyIdentityMapping[],
): {
  readonly byOldCoordinate: ReadonlyMap<string, PropertyIdentityMapping>;
  readonly byOldId: ReadonlyMap<string, PropertyIdentityMapping>;
} => ({
  byOldCoordinate: new Map(
    mappings.map((mapping) => [
      mappingKey(mapping.dataSourceId, mapping.oldPropertyId),
      mapping,
    ]),
  ),
  byOldId: new Map(mappings.map((mapping) => [mapping.oldPropertyId, mapping])),
});

const optionMappingIndex = (
  mappings: readonly OptionIdentityMapping[],
): ReadonlyMap<string, OptionIdentityMapping> =>
  new Map(
    mappings.map((mapping) => [
      mappingKey(
        mapping.dataSourceId,
        mapping.oldPropertyId,
        mapping.oldOptionId,
      ),
      mapping,
    ]),
  );

const rewriteOptionId = (
  index: ReadonlyMap<string, OptionIdentityMapping>,
  property: PropertyIdentityMapping,
  oldOptionId: string,
): string => {
  const mapping = index.get(
    mappingKey(property.dataSourceId, property.oldPropertyId, oldOptionId),
  );
  if (mapping) return mapping.newOptionId;
  throw new DatabaseIdentityCutoverError(
    `Missing option mapping for ${property.dataSourceId}/${property.oldPropertyId}/${oldOptionId}`,
  );
};

const rewritePropertyValue = (input: {
  readonly valueType: DatabasePropertyValueType;
  readonly value: unknown;
  readonly property: PropertyIdentityMapping;
  readonly optionIndex: ReadonlyMap<string, OptionIdentityMapping>;
}): DatabaseJsonValue => {
  if (input.value === null) return null;
  if (input.valueType === "select") {
    if (typeof input.value !== "string") {
      throw new DatabaseIdentityCutoverError(
        `Select Property ${input.property.oldPropertyId} has a non-string value`,
      );
    }
    return rewriteOptionId(input.optionIndex, input.property, input.value);
  }
  if (input.valueType === "multi_select") {
    if (
      !Array.isArray(input.value) ||
      input.value.some((entry) => typeof entry !== "string")
    ) {
      throw new DatabaseIdentityCutoverError(
        `Multi-select Property ${input.property.oldPropertyId} has a non-string member`,
      );
    }
    return [...new Set(input.value as readonly string[])]
      .map((entry) => rewriteOptionId(input.optionIndex, input.property, entry))
      .sort(compareStrings);
  }
  return input.value as DatabaseJsonValue;
};

const assertCanonicalProjectionParity = (
  database: Database.Database,
): void => {
  const mismatch = database.prepare(`
    SELECT coordinate FROM (
      SELECT 'container:' || capability.block_id AS coordinate
      FROM database_capabilities capability
      LEFT JOIN projects project ON project.id = capability.project_id
      LEFT JOIN database_containers container
        ON container.block_id = capability.block_id
       AND container.library_id = project.library_id
       AND container.name = capability.name
       AND container.metadata_revision = capability.schema_revision
      WHERE container.block_id IS NULL

      UNION ALL

      SELECT 'source:' || capability.block_id AS coordinate
      FROM database_capabilities capability
      LEFT JOIN data_sources source
        ON source.home_database_block_id = capability.block_id
       AND source.schema_key = capability.schema_key
       AND source.schema_revision = capability.schema_revision
      WHERE source.id IS NULL

      UNION ALL

      SELECT 'property:' || property.id AS coordinate
      FROM database_properties property
      LEFT JOIN data_sources source
        ON source.home_database_block_id = property.database_block_id
      LEFT JOIN data_source_properties canonical
        ON canonical.id = property.id
       AND canonical.data_source_id = source.id
       AND canonical.key = property.key
       AND canonical.name = property.name
       AND canonical.value_type = property.value_type
       AND canonical.config_json = property.config_json
       AND canonical.rank_key = property.rank_key
       AND canonical.lifecycle = property.lifecycle
       AND canonical.schema_revision = property.schema_revision
      WHERE canonical.id IS NULL

      UNION ALL

      SELECT 'membership:' || membership.id AS coordinate
      FROM database_memberships membership
      LEFT JOIN data_sources source
        ON source.home_database_block_id = membership.database_block_id
      LEFT JOIN data_source_page_memberships canonical
        ON canonical.id = membership.id
       AND canonical.data_source_id = source.id
       AND canonical.page_block_id = membership.page_block_id
       AND canonical.revision = membership.revision
       AND canonical.created_at = membership.created_at
       AND canonical.removed_at IS membership.removed_at
      WHERE canonical.id IS NULL

      UNION ALL

      SELECT 'value:' || value.membership_id || '/' || value.property_id
      FROM database_property_values value
      LEFT JOIN data_sources source
        ON source.home_database_block_id = value.database_block_id
      LEFT JOIN data_source_property_values canonical
        ON canonical.membership_id = value.membership_id
       AND canonical.property_id = value.property_id
       AND canonical.data_source_id = source.id
       AND canonical.value_type = value.value_type
       AND canonical.value_json = value.value_json
       AND canonical.revision = value.revision
       AND canonical.updated_at = value.updated_at
      WHERE canonical.membership_id IS NULL

      UNION ALL

      SELECT 'position:' || position.view_id || '/' || position.block_id
      FROM database_view_positions position
      LEFT JOIN database_view_page_positions canonical
        ON canonical.view_id = position.view_id
       AND canonical.page_block_id = position.block_id
       AND canonical.group_key IS position.group_key
       AND canonical.rank_key = position.rank_key
       AND canonical.revision = position.revision
       AND canonical.created_at = position.created_at
       AND canonical.updated_at = position.updated_at
      WHERE canonical.view_id IS NULL
    ) ORDER BY coordinate LIMIT 1
  `).get() as { readonly coordinate: string } | undefined;
  if (!mismatch) return;
  throw new DatabaseIdentityCutoverError(
    `Canonical v80 projection diverges at ${mismatch.coordinate}`,
  );
};

const readPropertiesAndMappings = (database: Database.Database): {
  readonly rows: readonly PropertyRow[];
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
} => {
  const rows = database.prepare(`
    SELECT id, data_source_id, key, name, value_type, config_json, rank_key,
      lifecycle, schema_revision, created_at, updated_at
    FROM data_source_properties
    ORDER BY data_source_id, id
  `).all() as readonly PropertyRow[];
  const propertyMappings = createPropertyIdentityMappings(
    rows.map((row) => {
      const key = isReservedDataSourcePropertyId(row.key)
        ? row.key
        : undefined;
      const reservedPropertyId =
        key !== undefined && BUILT_IN_VALUE_TYPES[key] === row.value_type
          ? key
          : undefined;
      return {
        dataSourceId: row.data_source_id,
        oldPropertyId: row.id,
        ...(reservedPropertyId === undefined ? {} : { reservedPropertyId }),
      };
    }),
  );
  const propertyIndex = propertyMappingIndexes(propertyMappings).byOldCoordinate;
  const optionCandidates = rows.flatMap((row) => {
    if (row.value_type !== "select" && row.value_type !== "multi_select") {
      parseDatabasePropertyConfig(
        row.value_type,
        parseJson(row.config_json, `Property ${row.id} config`),
      );
      return [];
    }
    const config = parseDatabasePropertyConfig(
      row.value_type,
      parseJson(row.config_json, `Property ${row.id} config`),
    );
    const options = config.options;
    if (!Array.isArray(options)) {
      throw new DatabaseIdentityCutoverError(
        `Option-bearing Property ${row.id} has no option registry`,
      );
    }
    const property = propertyIndex.get(mappingKey(row.data_source_id, row.id));
    if (!property) {
      throw new DatabaseIdentityCutoverError(
        `Missing Property mapping for ${row.data_source_id}/${row.id}`,
      );
    }
    const tagNames = new Set<string>();
    return options.map((candidate, index) => {
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        throw new DatabaseIdentityCutoverError(
          `Property ${row.id} option ${index} is not an object`,
        );
      }
      const option = candidate as Readonly<Record<string, DatabaseJsonValue>>;
      if (typeof option.id !== "string" || typeof option.name !== "string") {
        throw new DatabaseIdentityCutoverError(
          `Property ${row.id} option ${index} has invalid identity or name`,
        );
      }
      if (property.newPropertyId === "tags") {
        const name = canonicalizeTagName(option.name, { maxLength: 256 });
        if (tagNames.has(name)) {
          throw new DatabaseIdentityCutoverError(
            `Tags Property ${row.id} contains ambiguous canonical name ${name}`,
          );
        }
        tagNames.add(name);
      }
      return {
        dataSourceId: row.data_source_id,
        oldPropertyId: row.id,
        newPropertyId: property.newPropertyId,
        oldOptionId: option.id,
      };
    });
  });
  return {
    rows,
    propertyMappings,
    optionMappings: createOptionIdentityMappings(optionCandidates),
  };
};

const installTemporaryIdentityMaps = (
  database: Database.Database,
  propertyMappings: readonly PropertyIdentityMapping[],
  optionMappings: readonly OptionIdentityMapping[],
): void => {
  database.exec(`
    DROP TABLE IF EXISTS temp.database_identity_property_map_v81;
    DROP TABLE IF EXISTS temp.database_identity_option_map_v81;
    CREATE TEMP TABLE database_identity_property_map_v81 (
      data_source_id TEXT NOT NULL,
      old_property_id TEXT NOT NULL,
      new_property_id TEXT NOT NULL,
      collision_counter INTEGER,
      PRIMARY KEY (data_source_id, old_property_id),
      UNIQUE (data_source_id, new_property_id)
    ) WITHOUT ROWID;
    CREATE TEMP TABLE database_identity_option_map_v81 (
      data_source_id TEXT NOT NULL,
      old_property_id TEXT NOT NULL,
      new_property_id TEXT NOT NULL,
      old_option_id TEXT NOT NULL,
      new_option_id TEXT NOT NULL,
      collision_counter INTEGER,
      PRIMARY KEY (data_source_id, old_property_id, old_option_id),
      UNIQUE (data_source_id, new_property_id, new_option_id)
    ) WITHOUT ROWID;
  `);
  const insertProperty = database.prepare(`
    INSERT INTO temp.database_identity_property_map_v81 (
      data_source_id, old_property_id, new_property_id, collision_counter
    ) VALUES (?, ?, ?, ?)
  `);
  for (const mapping of propertyMappings) {
    insertProperty.run(
      mapping.dataSourceId,
      mapping.oldPropertyId,
      mapping.newPropertyId,
      mapping.collisionCounter,
    );
  }
  const insertOption = database.prepare(`
    INSERT INTO temp.database_identity_option_map_v81 (
      data_source_id, old_property_id, new_property_id, old_option_id,
      new_option_id, collision_counter
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const mapping of optionMappings) {
    insertOption.run(
      mapping.dataSourceId,
      mapping.oldPropertyId,
      mapping.newPropertyId,
      mapping.oldOptionId,
      mapping.newOptionId,
      mapping.collisionCounter,
    );
  }
};

const rewritePropertyConfig = (input: {
  readonly row: PropertyRow;
  readonly property: PropertyIdentityMapping;
  readonly optionIndex: ReadonlyMap<string, OptionIdentityMapping>;
}): string => {
  const config = parseDatabasePropertyConfig(
    input.row.value_type,
    parseJson(input.row.config_json, `Property ${input.row.id} config`),
  );
  if (input.row.value_type !== "select" && input.row.value_type !== "multi_select") {
    return canonicalJson(config);
  }
  const options = config.options;
  if (!Array.isArray(options)) {
    throw new DatabaseIdentityCutoverError(
      `Option-bearing Property ${input.row.id} has no option registry`,
    );
  }
  return canonicalJson({
    ...config,
    options: options.map((candidate) => {
      const option = candidate as Readonly<Record<string, DatabaseJsonValue>>;
      const oldOptionId = option.id;
      if (typeof oldOptionId !== "string" || typeof option.name !== "string") {
        throw new DatabaseIdentityCutoverError(
          `Property ${input.row.id} contains an invalid option`,
        );
      }
      return {
        ...option,
        id: rewriteOptionId(input.optionIndex, input.property, oldOptionId),
        ...(input.property.newPropertyId === "tags"
          ? { name: canonicalizeTagName(option.name, { maxLength: 256 }) }
          : {}),
      };
    }),
  });
};

const containsChangedIdentity = (
  values: readonly string[],
  candidate: string,
): boolean => values.some((value) => candidate.includes(value));

const changedLegacyIdentities = (
  propertyMappings: readonly PropertyIdentityMapping[],
  optionMappings: readonly OptionIdentityMapping[],
): readonly string[] => [
  ...propertyMappings.flatMap((mapping) =>
    mapping.oldPropertyId === mapping.newPropertyId
      ? []
      : [mapping.oldPropertyId],
  ),
  ...optionMappings.flatMap((mapping) =>
    mapping.oldOptionId === mapping.newOptionId ? [] : [mapping.oldOptionId],
  ),
];

const prepareEvidenceRewrites = (input: {
  readonly database: Database.Database;
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
}): readonly EvidenceRewrite[] => {
  const changedIdentities = changedLegacyIdentities(
    input.propertyMappings,
    input.optionMappings,
  );
  const rows = input.database.prepare(`
    SELECT
      mutation.mutation_id,
      mutation.project_id,
      mutation.store_epoch,
      mutation.mutation_kind,
      mutation.request_hash,
      mutation.request_json,
      mutation.field_intents_json,
      mutation.expected_revisions_json,
      mutation.outcome,
      mutation.result_json,
      mutation.committed_revisions_json,
      mutation.change_log_seq,
      change.project_id AS change_project_id,
      change.store_epoch AS change_store_epoch,
      change.operation_id AS change_operation_id,
      change.payload_json AS change_payload_json
    FROM block_mutations mutation
    LEFT JOIN change_log change ON change.seq = mutation.change_log_seq
    ORDER BY mutation.recorded_at, mutation.mutation_id
  `).all() as readonly EvidenceRow[];
  const rewrites: EvidenceRewrite[] = [];
  for (const row of rows) {
    if (row.mutation_kind === "page_lifecycle") {
      if (row.outcome === "rejected") continue;
      const result = parseJson(
        row.result_json,
        `Page Lifecycle evidence ${row.mutation_id} result`,
      );
      const dataSourceId =
        typeof result === "object" &&
        result !== null &&
        !Array.isArray(result) &&
        typeof (result as Readonly<Record<string, unknown>>).dataSourceId ===
          "string"
          ? ((result as Readonly<Record<string, unknown>>)
              .dataSourceId as string)
          : null;
      const tagsProperty = dataSourceId
        ? input.propertyMappings.find(
            (mapping) =>
              mapping.dataSourceId === dataSourceId &&
              mapping.newPropertyId === "tags",
          )
        : undefined;
      if (tagsProperty) {
        const rewritten = rewriteCommittedPageLifecycleCreateEvidence({
          evidence: {
            mutationKind: row.mutation_kind,
            outcome: row.outcome,
            requestJson: row.request_json,
            requestHash: row.request_hash,
            fieldIntentsJson: row.field_intents_json,
            resultJson: row.result_json,
            changePayloadJson: row.change_payload_json,
          },
          oldTagsPropertyId: tagsProperty.oldPropertyId,
          propertyMappings: input.propertyMappings,
          optionMappings: input.optionMappings,
        });
        if (rewritten.kind === "rewritten_committed_create") {
          if (
            row.change_log_seq === null ||
            row.change_project_id !== row.project_id ||
            row.change_store_epoch !== row.store_epoch ||
            row.change_operation_id !== row.mutation_id
          ) {
            throw new DatabaseIdentityCutoverError(
              `Committed Page Lifecycle evidence ${row.mutation_id} has inconsistent ledger/change coordinates`,
            );
          }
          rewrites.push({
            mutationId: row.mutation_id,
            changeLogSeq: row.change_log_seq,
            evidence: {
              requestJson: rewritten.evidence.requestJson,
              requestHash: rewritten.evidence.requestHash,
              fieldIntentsJson: rewritten.evidence.fieldIntentsJson,
              expectedRevisionsJson: row.expected_revisions_json,
              resultJson: rewritten.evidence.resultJson,
              committedRevisionsJson: row.committed_revisions_json,
              changePayloadJson: rewritten.evidence.changePayloadJson,
            },
          });
          continue;
        }
      }
      if (
        containsChangedIdentity(changedIdentities, [
          row.request_json,
          row.field_intents_json,
          row.expected_revisions_json,
          row.result_json,
          row.committed_revisions_json,
          row.change_payload_json ?? "",
        ].join("\n"))
      ) {
        throw new DatabaseIdentityCutoverError(
          `Committed Page Lifecycle evidence ${row.mutation_id} contains an unsupported old Property or option reference`,
        );
      }
      continue;
    }
    if (row.mutation_kind === "database_operation") {
      const rewritten = rewriteCommittedDatabaseOperationEvidence({
        evidence: {
          mutationKind: row.mutation_kind,
          outcome: row.outcome,
          requestJson: row.request_json,
          requestHash: row.request_hash,
          fieldIntentsJson: row.field_intents_json,
          expectedRevisionsJson: row.expected_revisions_json,
          resultJson: row.result_json,
          committedRevisionsJson: row.committed_revisions_json,
          changePayloadJson: row.change_payload_json,
        },
        propertyMappings: input.propertyMappings,
        optionMappings: input.optionMappings,
      });
      if (rewritten.kind === "rewritten_committed_database_operation") {
        if (
          row.change_log_seq === null ||
          row.change_project_id !== row.project_id ||
          row.change_store_epoch !== row.store_epoch ||
          row.change_operation_id !== row.mutation_id
        ) {
          throw new DatabaseIdentityCutoverError(
            `Committed Database operation evidence ${row.mutation_id} has inconsistent ledger/change coordinates`,
          );
        }
        rewrites.push({
          mutationId: row.mutation_id,
          changeLogSeq: row.change_log_seq,
          evidence: rewritten.evidence,
        });
      }
      continue;
    }
    if (row.mutation_kind !== "property_batch") {
      if (
        row.outcome === "committed" &&
        containsChangedIdentity(changedIdentities, [
          row.request_json,
          row.field_intents_json,
          row.expected_revisions_json,
          row.result_json,
          row.committed_revisions_json,
          row.change_payload_json ?? "",
        ].join("\n"))
      ) {
        throw new DatabaseIdentityCutoverError(
          `Committed ${row.mutation_kind} evidence ${row.mutation_id} contains an unsupported old Property or option reference`,
        );
      }
      continue;
    }
    const aggregate: BlockPropertyEvidenceAggregate = {
      mutationKind: row.mutation_kind,
      outcome: row.outcome,
      requestJson: row.request_json,
      requestHash: row.request_hash,
      fieldIntentsJson: row.field_intents_json,
      expectedRevisionsJson: row.expected_revisions_json,
      resultJson: row.result_json,
      committedRevisionsJson: row.committed_revisions_json,
      changePayloadJson: row.change_payload_json,
    };
    const rewritten = rewriteCommittedBlockPropertyEvidence({
      evidence: aggregate,
      propertyMappings: input.propertyMappings,
      optionMappings: input.optionMappings,
    });
    if (rewritten.kind !== "rewritten_committed") continue;
    if (
      row.change_log_seq === null ||
      row.change_project_id !== row.project_id ||
      row.change_store_epoch !== row.store_epoch ||
      row.change_operation_id !== row.mutation_id
    ) {
      throw new DatabaseIdentityCutoverError(
        `Committed Property evidence ${row.mutation_id} has inconsistent ledger/change coordinates`,
      );
    }
    rewrites.push({
      mutationId: row.mutation_id,
      changeLogSeq: row.change_log_seq,
      evidence: rewritten.evidence,
    });
  }
  return rewrites;
};

const rewriteRevisionKey = (
  key: string,
  propertyByOldId: ReadonlyMap<string, PropertyIdentityMapping>,
): string => {
  if (key.startsWith("property:")) {
    const oldPropertyId = key.slice("property:".length);
    const property = propertyByOldId.get(oldPropertyId);
    return property ? `property:${property.newPropertyId}` : key;
  }
  if (!key.startsWith("value:")) return key;
  const matches = [...propertyByOldId.values()]
    .filter((property) => key.endsWith(`:${property.oldPropertyId}`))
    .sort((left, right) => right.oldPropertyId.length - left.oldPropertyId.length);
  const property = matches[0];
  if (!property) return key;
  return `${key.slice(0, -(property.oldPropertyId.length))}${property.newPropertyId}`;
};

const rewriteRevisionRecord = (
  value: unknown,
  propertyByOldId: ReadonlyMap<string, PropertyIdentityMapping>,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DatabaseIdentityCutoverError(`${label} must be an object`);
  }
  const rewritten = Object.entries(value).map(([key, revision]) => [
    rewriteRevisionKey(key, propertyByOldId),
    revision,
  ] as const);
  if (new Set(rewritten.map(([key]) => key)).size !== rewritten.length) {
    throw new DatabaseIdentityCutoverError(
      `${label} collides after Property identity rewriting`,
    );
  }
  return Object.fromEntries(rewritten);
};

const rewriteDatabaseModuleChangePayloads = (
  database: Database.Database,
  propertyByOldId: ReadonlyMap<string, PropertyIdentityMapping>,
): number => {
  const rows = database.prepare(`
    SELECT seq, payload_json
    FROM change_log
    WHERE json_extract(payload_json, '$.mutationKind') = 'database_module_apply'
    ORDER BY seq
  `).all() as readonly {
    readonly seq: number;
    readonly payload_json: string;
  }[];
  const update = database.prepare(
    "UPDATE change_log SET payload_json = ? WHERE seq = ?",
  );
  for (const row of rows) {
    const payload = parseJson(row.payload_json, `Database Module change ${row.seq}`);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new DatabaseIdentityCutoverError(
        `Database Module change ${row.seq} payload is not an object`,
      );
    }
    const record = payload as Readonly<Record<string, unknown>>;
    if (record.version !== 1) {
      throw new DatabaseIdentityCutoverError(
        `Database Module change ${row.seq} has unsupported version`,
      );
    }
    update.run(
      canonicalJson({
        ...record,
        version: 2,
        committedRevisions: rewriteRevisionRecord(
          record.committedRevisions,
          propertyByOldId,
          `Database Module change ${row.seq} revisions`,
        ),
      }),
      row.seq,
    );
  }
  return rows.length;
};

const readImmutableTriggerDefinitions = (
  database: Database.Database,
): readonly NamedSqliteObject[] =>
  IMMUTABLE_EVIDENCE_TRIGGERS.map((name) => {
    const row = database.prepare(`
      SELECT name, sql FROM sqlite_schema
      WHERE type = 'trigger' AND name = ? AND sql IS NOT NULL
    `).get(name) as NamedSqliteObject | undefined;
    if (row) return row;
    throw new DatabaseIdentityCutoverError(
      `Schema v80 is missing immutable evidence trigger ${name}`,
    );
  });

const applyEvidenceRewrites = (input: {
  readonly database: Database.Database;
  readonly rewrites: readonly EvidenceRewrite[];
  readonly immutableTriggers: readonly NamedSqliteObject[];
  readonly propertyByOldId: ReadonlyMap<string, PropertyIdentityMapping>;
  readonly afterUpdates?: () => void;
}): void => {
  for (const trigger of input.immutableTriggers) {
    input.database.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)}`);
  }
  const updateMutation = input.database.prepare(`
    UPDATE block_mutations
    SET request_json = ?, request_hash = ?, field_intents_json = ?,
      expected_revisions_json = ?, result_json = ?,
      committed_revisions_json = ?
    WHERE mutation_id = ?
  `);
  const updateChange = input.database.prepare(
    "UPDATE change_log SET payload_json = ? WHERE seq = ?",
  );
  for (const rewrite of input.rewrites) {
    updateMutation.run(
      rewrite.evidence.requestJson,
      rewrite.evidence.requestHash,
      rewrite.evidence.fieldIntentsJson,
      rewrite.evidence.expectedRevisionsJson,
      rewrite.evidence.resultJson,
      rewrite.evidence.committedRevisionsJson,
      rewrite.mutationId,
    );
    updateChange.run(
      rewrite.evidence.changePayloadJson,
      rewrite.changeLogSeq,
    );
  }
  rewriteDatabaseModuleChangePayloads(
    input.database,
    input.propertyByOldId,
  );
  input.afterUpdates?.();
  for (const trigger of input.immutableTriggers) input.database.exec(trigger.sql);
};

const clearPreCutoverAgentCallReceipts = (
  database: Database.Database,
): number => {
  if (!tableExists(database, "nodex_agent_call_receipts")) return 0;
  const triggerName = "nodex_agent_committed_call_receipts_cannot_delete";
  const trigger = database.prepare(`
    SELECT name, sql FROM sqlite_schema
    WHERE type = 'trigger' AND name = ? AND sql IS NOT NULL
  `).get(triggerName) as NamedSqliteObject | undefined;
  if (!trigger) {
    throw new DatabaseIdentityCutoverError(
      `Schema v80 is missing Agent receipt trigger ${triggerName}`,
    );
  }
  database.exec(`DROP TRIGGER ${quoteIdentifier(triggerName)}`);
  const cleared = database.prepare("DELETE FROM nodex_agent_call_receipts")
    .run().changes;
  database.exec(trigger.sql);
  return cleared;
};

const rebuildPropertyAuthority = (input: {
  readonly database: Database.Database;
  readonly rows: readonly PropertyRow[];
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
}): number => {
  const { database } = input;
  const propertyIndex = propertyMappingIndexes(
    input.propertyMappings,
  ).byOldCoordinate;
  const optionIndex = optionMappingIndex(input.optionMappings);
  database.exec(`
    DROP TABLE IF EXISTS data_source_property_values_v81;
    DROP TABLE IF EXISTS data_source_properties_v81;
    CREATE TABLE data_source_properties_v81 (
      data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      value_type TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      rank_key TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      schema_revision INTEGER NOT NULL DEFAULT 1 CHECK (schema_revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (data_source_id, id),
      CHECK (length(id) BETWEEN 1 AND 128),
      CHECK (length(name) BETWEEN 1 AND 256),
      CHECK (value_type IN (
        'text', 'number', 'checkbox', 'select', 'multi_select',
        'date', 'datetime', 'person'
      )),
      CHECK (lifecycle IN ('active', 'deleted')),
      CHECK (json_valid(config_json) AND json_type(config_json) = 'object')
    ) WITHOUT ROWID;

    CREATE TABLE data_source_property_values_v81 (
      data_source_id TEXT NOT NULL,
      membership_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (data_source_id, membership_id, property_id),
      FOREIGN KEY (membership_id, data_source_id)
        REFERENCES data_source_page_memberships(id, data_source_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (data_source_id, property_id)
        REFERENCES data_source_properties(data_source_id, id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (value_type IN (
        'text', 'number', 'checkbox', 'select', 'multi_select',
        'date', 'datetime', 'person'
      )),
      CHECK (json_valid(value_json))
    ) WITHOUT ROWID;
  `);
  const insertProperty = database.prepare(`
    INSERT INTO data_source_properties_v81 (
      data_source_id, id, name, value_type, config_json, rank_key, lifecycle,
      schema_revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of input.rows) {
    const property = propertyIndex.get(mappingKey(row.data_source_id, row.id));
    if (!property) {
      throw new DatabaseIdentityCutoverError(
        `Missing Property mapping for ${row.data_source_id}/${row.id}`,
      );
    }
    insertProperty.run(
      row.data_source_id,
      property.newPropertyId,
      row.name,
      row.value_type,
      rewritePropertyConfig({ row, property, optionIndex }),
      row.rank_key,
      row.lifecycle,
      row.schema_revision,
      row.created_at,
      row.updated_at,
    );
  }
  const values = database.prepare(`
    SELECT membership_id, property_id, data_source_id, value_type, value_json,
      revision, updated_at
    FROM data_source_property_values
    ORDER BY data_source_id, membership_id, property_id
  `).all() as readonly PropertyValueRow[];
  const propertyRows = new Map(
    input.rows.map((row) => [
      mappingKey(row.data_source_id, row.id),
      row,
    ]),
  );
  const insertValue = database.prepare(`
    INSERT INTO data_source_property_values_v81 (
      data_source_id, membership_id, property_id, value_type, value_json,
      revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const value of values) {
    const key = mappingKey(value.data_source_id, value.property_id);
    const property = propertyIndex.get(key);
    const propertyRow = propertyRows.get(key);
    if (!property || !propertyRow) {
      throw new DatabaseIdentityCutoverError(
        `Value ${value.membership_id}/${value.property_id} has no Property mapping`,
      );
    }
    if (value.value_type !== propertyRow.value_type) {
      throw new DatabaseIdentityCutoverError(
        `Value ${value.membership_id}/${value.property_id} type diverges from its Property`,
      );
    }
    insertValue.run(
      value.data_source_id,
      value.membership_id,
      property.newPropertyId,
      value.value_type,
      canonicalJson(
        rewritePropertyValue({
          valueType: value.value_type,
          value: parseJson(
            value.value_json,
            `Value ${value.membership_id}/${value.property_id}`,
          ),
          property,
          optionIndex,
        }),
      ),
      value.revision,
      value.updated_at,
    );
  }
  database.exec(`
    DROP TABLE data_source_property_values;
    DROP TABLE data_source_properties;
    ALTER TABLE data_source_properties_v81 RENAME TO data_source_properties;
    ALTER TABLE data_source_property_values_v81
      RENAME TO data_source_property_values;
    CREATE INDEX idx_data_source_properties_order
      ON data_source_properties(data_source_id, lifecycle, rank_key, id);
    CREATE INDEX idx_data_source_property_values_property
      ON data_source_property_values(data_source_id, property_id, membership_id);
  `);
  return values.length;
};

const readViews = (database: Database.Database): readonly ViewRow[] =>
  database.prepare(`
    SELECT id, database_block_id, data_source_id, name, kind, config_json,
      revision, rank_key, lifecycle, created_at, updated_at
    FROM database_views
    ORDER BY id
  `).all() as readonly ViewRow[];

const rewritePositionGroupKey = (input: {
  readonly position: PositionRow;
  readonly view: ViewRow;
  readonly propertyByOldCoordinate: ReadonlyMap<string, PropertyIdentityMapping>;
  readonly optionIndex: ReadonlyMap<string, OptionIdentityMapping>;
  readonly propertyRows: ReadonlyMap<string, PropertyRow>;
}): string | null => {
  if (input.position.group_key === null) return null;
  const config = parseDatabaseViewConfig(
    parseJson(input.view.config_json, `View ${input.view.id} config`),
  );
  if (!config.group) return input.position.group_key;
  const key = mappingKey(input.view.data_source_id, config.group.propertyId);
  const property = input.propertyByOldCoordinate.get(key);
  const propertyRow = input.propertyRows.get(key);
  if (!property || !propertyRow) {
    throw new DatabaseIdentityCutoverError(
      `View ${input.view.id} group Property has no identity mapping`,
    );
  }
  const value = databaseGroupValueFromKey(
    propertyRow.value_type,
    input.position.group_key,
  );
  return databaseGroupKeyForValue(
    rewritePropertyValue({
      valueType: propertyRow.value_type,
      value,
      property,
      optionIndex: input.optionIndex,
    }),
  );
};

const installViewIntegrityTriggers = (database: Database.Database): void => {
  database.exec(`
    CREATE TRIGGER database_containers_default_view_is_owned_insert
      BEFORE INSERT ON database_containers
      WHEN NEW.default_view_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM database_views view
          WHERE view.id = NEW.default_view_id
            AND view.database_block_id = NEW.block_id
            AND view.lifecycle = 'active'
        )
      BEGIN
        SELECT RAISE(ABORT, 'Database default View must be active and owned by its Container');
      END;

    CREATE TRIGGER database_containers_default_view_is_owned_update
      BEFORE UPDATE OF default_view_id, block_id ON database_containers
      WHEN NEW.default_view_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM database_views view
          WHERE view.id = NEW.default_view_id
            AND view.database_block_id = NEW.block_id
            AND view.lifecycle = 'active'
        )
      BEGIN
        SELECT RAISE(ABORT, 'Database default View must be active and owned by its Container');
      END;

    CREATE TRIGGER database_views_preserve_container_default_update
      BEFORE UPDATE OF database_block_id, lifecycle ON database_views
      WHEN EXISTS (
        SELECT 1 FROM database_containers container
        WHERE container.default_view_id = OLD.id
          AND (NEW.database_block_id <> container.block_id OR NEW.lifecycle <> 'active')
      )
      BEGIN
        SELECT RAISE(ABORT, 'A Database default View must remain active and owned');
      END;

    CREATE TRIGGER database_views_preserve_container_default_delete
      BEFORE DELETE ON database_views
      WHEN EXISTS (
        SELECT 1 FROM database_containers container
        WHERE container.default_view_id = OLD.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'A Database default View cannot be deleted');
      END;

    CREATE TRIGGER database_view_page_positions_require_active_membership_insert
      BEFORE INSERT ON database_view_page_positions
      WHEN NOT EXISTS (
        SELECT 1
        FROM database_views view
        INNER JOIN data_source_page_memberships membership
          ON membership.data_source_id = view.data_source_id
         AND membership.page_block_id = NEW.page_block_id
         AND membership.removed_at IS NULL
        WHERE view.id = NEW.view_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Database View position requires active Source membership');
      END;

    CREATE TRIGGER database_view_page_positions_require_active_membership_update
      BEFORE UPDATE OF view_id, page_block_id ON database_view_page_positions
      WHEN NOT EXISTS (
        SELECT 1
        FROM database_views view
        INNER JOIN data_source_page_memberships membership
          ON membership.data_source_id = view.data_source_id
         AND membership.page_block_id = NEW.page_block_id
         AND membership.removed_at IS NULL
        WHERE view.id = NEW.view_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Database View position requires active Source membership');
      END;
  `);
};

const rebuildViewAuthority = (input: {
  readonly database: Database.Database;
  readonly views: readonly ViewRow[];
  readonly propertyRows: readonly PropertyRow[];
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
}): number => {
  const { database } = input;
  const positions = database.prepare(`
    SELECT view_id, page_block_id, group_key, rank_key, revision,
      created_at, updated_at
    FROM database_view_page_positions
    ORDER BY view_id, page_block_id
  `).all() as readonly PositionRow[];
  const propertyByOldCoordinate = propertyMappingIndexes(
    input.propertyMappings,
  ).byOldCoordinate;
  const optionIndex = optionMappingIndex(input.optionMappings);
  const propertyRows = new Map(
    input.propertyRows.map((row) => [
      mappingKey(row.data_source_id, row.id),
      row,
    ]),
  );
  const viewsById = new Map(input.views.map((view) => [view.id, view]));
  database.exec(`
    DROP TABLE IF EXISTS database_view_page_positions_v81;
    DROP TABLE IF EXISTS database_views_v81;
    CREATE TABLE database_views_v81 (
      id TEXT PRIMARY KEY,
      database_block_id TEXT NOT NULL,
      data_source_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      rank_key TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (database_block_id)
        REFERENCES database_containers(block_id) ON DELETE CASCADE,
      FOREIGN KEY (data_source_id, database_block_id)
        REFERENCES data_sources(id, home_database_block_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (kind IN ('kanban', 'list', 'calendar', 'canvas')),
      CHECK (lifecycle IN ('active', 'deleted')),
      CHECK (json_valid(config_json) AND json_type(config_json) = 'object')
    ) WITHOUT ROWID;

    CREATE TABLE database_view_page_positions_v81 (
      view_id TEXT NOT NULL,
      page_block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
      group_key TEXT,
      rank_key TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (view_id, page_block_id),
      FOREIGN KEY (view_id) REFERENCES database_views(id) ON DELETE CASCADE
    ) WITHOUT ROWID;
  `);
  const insertView = database.prepare(`
    INSERT INTO database_views_v81 (
      id, database_block_id, data_source_id, name, kind, config_json,
      revision, rank_key, lifecycle, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const view of input.views) {
    const rewritten = rewriteDatabaseViewConfigV1ToV2({
      config: parseJson(view.config_json, `View ${view.id} config`),
      dataSourceId: view.data_source_id,
      propertyMappings: input.propertyMappings,
      optionMappings: input.optionMappings,
    });
    insertView.run(
      view.id,
      view.database_block_id,
      view.data_source_id,
      view.name,
      view.kind,
      canonicalJson(rewritten),
      view.revision,
      view.rank_key,
      view.lifecycle,
      view.created_at,
      view.updated_at,
    );
  }
  const insertPosition = database.prepare(`
    INSERT INTO database_view_page_positions_v81 (
      view_id, page_block_id, group_key, rank_key, revision,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const position of positions) {
    const view = viewsById.get(position.view_id);
    if (!view) {
      throw new DatabaseIdentityCutoverError(
        `Position ${position.view_id}/${position.page_block_id} has no View`,
      );
    }
    insertPosition.run(
      position.view_id,
      position.page_block_id,
      rewritePositionGroupKey({
        position,
        view,
        propertyByOldCoordinate,
        optionIndex,
        propertyRows,
      }),
      position.rank_key,
      position.revision,
      position.created_at,
      position.updated_at,
    );
  }
  database.exec(`
    DROP TABLE database_view_page_positions;
    DROP TABLE database_views;
    ALTER TABLE database_views_v81 RENAME TO database_views;
    ALTER TABLE database_view_page_positions_v81
      RENAME TO database_view_page_positions;
    CREATE INDEX idx_database_views_database_order
      ON database_views(database_block_id, lifecycle, rank_key, id);
    CREATE INDEX idx_database_views_source
      ON database_views(data_source_id, lifecycle, id);
    CREATE INDEX idx_database_view_page_positions_order
      ON database_view_page_positions(
        view_id, group_key, rank_key, page_block_id
      );
  `);
  installViewIntegrityTriggers(database);
  return positions.length;
};

const assertPositionGroupsMatchValues = (
  database: Database.Database,
): void => {
  const rows = database.prepare(`
    SELECT
      position.view_id,
      position.page_block_id,
      position.group_key,
      view.data_source_id,
      view.config_json,
      membership.id AS membership_id
    FROM database_view_page_positions position
    INNER JOIN database_views view ON view.id = position.view_id
    LEFT JOIN data_source_page_memberships membership
      ON membership.data_source_id = view.data_source_id
     AND membership.page_block_id = position.page_block_id
     AND membership.removed_at IS NULL
    ORDER BY position.view_id, position.page_block_id
  `).all() as readonly {
    readonly view_id: string;
    readonly page_block_id: string;
    readonly group_key: string | null;
    readonly data_source_id: string;
    readonly config_json: string;
    readonly membership_id: string | null;
  }[];
  for (const row of rows) {
    if (!row.membership_id) {
      throw new DatabaseIdentityCutoverError(
        `Position ${row.view_id}/${row.page_block_id} has no active Source membership`,
      );
    }
    const config = parseJson(row.config_json, `View ${row.view_id} config`) as {
      readonly group?: null | { readonly propertyId: string };
    };
    if (!config.group) continue;
    const value = database.prepare(`
      SELECT value_json
      FROM data_source_property_values
      WHERE data_source_id = ? AND membership_id = ? AND property_id = ?
    `).get(
      row.data_source_id,
      row.membership_id,
      config.group.propertyId,
    ) as { readonly value_json: string } | undefined;
    const effective = databaseGroupKeyForValue(
      value
        ? (parseJson(value.value_json, "Grouped Property value") as DatabaseJsonValue)
        : undefined,
    );
    if (effective === row.group_key) continue;
    throw new DatabaseIdentityCutoverError(
      `Position ${row.view_id}/${row.page_block_id} group does not match its Property value`,
    );
  }
};

const readSafeBlockSchemaObjects = (
  database: Database.Database,
): readonly NamedSqliteObject[] =>
  (database.prepare(`
    SELECT name, sql
    FROM sqlite_schema
    WHERE tbl_name = 'blocks'
      AND type IN ('index', 'trigger')
      AND sql IS NOT NULL
    ORDER BY type, name
  `).all() as readonly NamedSqliteObject[]).filter(
    (object) => !legacyReferencePattern.test(object.sql),
  );

const rebuildBlocksWithoutLegacyAuthority = (
  database: Database.Database,
): void => {
  const retainedObjects = readSafeBlockSchemaObjects(database);
  database.exec(`
    DROP TABLE IF EXISTS blocks_v81;
    CREATE TABLE blocks_v81 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      location_kind TEXT NOT NULL,
      containing_document_id TEXT,
      containing_database_id TEXT,
      location_revision INTEGER NOT NULL DEFAULT 1 CHECK (location_revision >= 1),
      metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK (metadata_revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (id, project_id),
      FOREIGN KEY (containing_document_id)
        REFERENCES documents(id) ON DELETE RESTRICT,
      FOREIGN KEY (containing_database_id)
        REFERENCES database_containers(block_id) ON DELETE RESTRICT,
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (
        (location_kind = 'space'
          AND containing_document_id IS NULL
          AND containing_database_id IS NULL)
        OR (location_kind = 'document'
          AND containing_document_id IS NOT NULL
          AND containing_database_id IS NULL)
        OR (location_kind = 'database'
          AND containing_document_id IS NULL
          AND containing_database_id IS NOT NULL)
      )
    );
    INSERT INTO blocks_v81 (
      id, project_id, type, lifecycle, location_kind,
      containing_document_id, containing_database_id,
      location_revision, metadata_revision, created_at, updated_at
    )
    SELECT
      id, project_id, type, lifecycle, location_kind,
      containing_document_id, containing_database_id,
      location_revision, metadata_revision, created_at, updated_at
    FROM blocks;
    DROP TABLE blocks;
    ALTER TABLE blocks_v81 RENAME TO blocks;
  `);
  for (const object of retainedObjects) database.exec(object.sql);
};

const installCanonicalDatabaseAuthorityTriggers = (
  database: Database.Database,
): void => {
  database.exec(`
    CREATE TRIGGER database_containers_require_database_block_insert
      BEFORE INSERT ON database_containers
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks block
        INNER JOIN projects project ON project.id = block.project_id
        WHERE block.id = NEW.block_id
          AND block.type = 'database'
          AND project.library_id = NEW.library_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Database Container must match a Database Block in its Library');
      END;

    CREATE TRIGGER database_containers_require_database_block_update
      BEFORE UPDATE OF block_id, library_id ON database_containers
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks block
        INNER JOIN projects project ON project.id = block.project_id
        WHERE block.id = NEW.block_id
          AND block.type = 'database'
          AND project.library_id = NEW.library_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Database Container must match a Database Block in its Library');
      END;

    CREATE TRIGGER data_sources_require_container_library_insert
      BEFORE INSERT ON data_sources
      WHEN NOT EXISTS (
        SELECT 1 FROM database_containers container
        WHERE container.block_id = NEW.home_database_block_id
          AND container.library_id = NEW.library_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Data Source must share its Database Container Library');
      END;

    CREATE TRIGGER data_sources_require_container_library_update
      BEFORE UPDATE OF library_id, home_database_block_id ON data_sources
      WHEN NOT EXISTS (
        SELECT 1 FROM database_containers container
        WHERE container.block_id = NEW.home_database_block_id
          AND container.library_id = NEW.library_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Data Source must share its Database Container Library');
      END;

    CREATE TRIGGER blocks_type_updates_preserve_database_containers
      BEFORE UPDATE OF type ON blocks
      WHEN NEW.type <> 'database'
        AND EXISTS (
          SELECT 1 FROM database_containers container
          WHERE container.block_id = OLD.id
        )
      BEGIN
        SELECT RAISE(ABORT, 'Database Block type cannot change while its Container exists');
      END;

    CREATE TRIGGER data_source_memberships_require_page_block_insert
      BEFORE INSERT ON data_source_page_memberships
      WHEN NEW.removed_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks page
          INNER JOIN data_sources source ON source.id = NEW.data_source_id
          WHERE page.id = NEW.page_block_id
            AND page.type = 'page'
            AND page.location_kind = 'database'
            AND page.containing_database_id = source.home_database_block_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'Active Source membership must match the Page Database parent');
      END;

    CREATE TRIGGER data_source_memberships_require_page_block_update
      BEFORE UPDATE OF data_source_id, page_block_id, removed_at
      ON data_source_page_memberships
      WHEN NEW.removed_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks page
          INNER JOIN data_sources source ON source.id = NEW.data_source_id
          WHERE page.id = NEW.page_block_id
            AND page.type = 'page'
            AND page.location_kind = 'database'
            AND page.containing_database_id = source.home_database_block_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'Active Source membership must match the Page Database parent');
      END;

    CREATE TRIGGER blocks_active_source_membership_requires_database_location
      BEFORE UPDATE OF type, location_kind, containing_document_id,
        containing_database_id ON blocks
      WHEN EXISTS (
        SELECT 1
        FROM data_source_page_memberships membership
        INNER JOIN data_sources source ON source.id = membership.data_source_id
        WHERE membership.page_block_id = OLD.id
          AND membership.removed_at IS NULL
          AND (
            NEW.type <> 'page'
            OR NEW.location_kind <> 'database'
            OR NEW.containing_document_id IS NOT NULL
            OR NEW.containing_database_id IS NOT source.home_database_block_id
          )
      )
      BEGIN
        SELECT RAISE(ABORT, 'Page location cannot diverge from its active Source membership');
      END;

    CREATE TRIGGER data_source_property_values_require_matching_type_insert
      BEFORE INSERT ON data_source_property_values
      WHEN NOT EXISTS (
        SELECT 1 FROM data_source_properties property
        WHERE property.data_source_id = NEW.data_source_id
          AND property.id = NEW.property_id
          AND property.value_type = NEW.value_type
          AND property.lifecycle = 'active'
      )
      BEGIN
        SELECT RAISE(ABORT, 'Data Source Property value must match an active Property type');
      END;

    CREATE TRIGGER data_source_property_values_require_matching_type_update
      BEFORE UPDATE OF data_source_id, property_id, value_type
      ON data_source_property_values
      WHEN NOT EXISTS (
        SELECT 1 FROM data_source_properties property
        WHERE property.data_source_id = NEW.data_source_id
          AND property.id = NEW.property_id
          AND property.value_type = NEW.value_type
          AND property.lifecycle = 'active'
      )
      BEGIN
        SELECT RAISE(ABORT, 'Data Source Property value must match an active Property type');
      END;
  `);
};

const rewritePageReadDatabaseValues = (input: {
  readonly row: PageReadModelRow;
  readonly sourceId: string | null;
  readonly propertiesByNewCoordinate: ReadonlyMap<
    string,
    { readonly row: PropertyRow; readonly mapping: PropertyIdentityMapping }
  >;
  readonly optionIndex: ReadonlyMap<string, OptionIdentityMapping>;
}): string => {
  const parsed = parseJson(
    input.row.database_values_json,
    `Page read projection ${input.row.page_block_id} Database values`,
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DatabaseIdentityCutoverError(
      `Page read projection ${input.row.page_block_id} Database values are not an object`,
    );
  }
  if (!input.sourceId) return canonicalJson(parsed);
  const values = Object.entries(parsed).map(([propertyId, value]) => {
    const property = input.propertiesByNewCoordinate.get(
      mappingKey(input.sourceId ?? "", propertyId),
    );
    if (!property) return [propertyId, value] as const;
    if (property.mapping.newPropertyId === "tags") {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new DatabaseIdentityCutoverError(
          `Page read projection ${input.row.page_block_id} tags are not an option array`,
        );
      }
      const config = parseDatabasePropertyConfig(
        property.row.value_type,
        parseJson(
          property.row.config_json,
          `Tags Property ${property.row.id} config`,
        ),
      );
      const namesById = new Map(
        (config.options as readonly DatabaseJsonValue[]).map((candidate) => {
          const option = candidate as Readonly<Record<string, DatabaseJsonValue>>;
          if (typeof option.id !== "string" || typeof option.name !== "string") {
            throw new DatabaseIdentityCutoverError(
              `Tags Property ${property.row.id} contains an invalid option`,
            );
          }
          return [
            option.id,
            canonicalizeTagName(option.name, { maxLength: 256 }),
          ] as const;
        }),
      );
      return [
        propertyId,
        (value as readonly string[]).map((optionId) => {
          const name = namesById.get(optionId);
          if (name) return name;
          throw new DatabaseIdentityCutoverError(
            `Page read projection ${input.row.page_block_id} references unknown tag option ${optionId}`,
          );
        }),
      ] as const;
    }
    return [
      propertyId,
      rewritePropertyValue({
        valueType: property.row.value_type,
        value,
        property: property.mapping,
        optionIndex: input.optionIndex,
      }),
    ] as const;
  });
  return canonicalJson(Object.fromEntries(values));
};

const installPageReadModelValidationTriggers = (
  database: Database.Database,
): void => {
  database.exec(`
    CREATE TRIGGER page_read_model_validate_insert
      BEFORE INSERT ON page_read_model
      WHEN NOT EXISTS (
        SELECT 1 FROM blocks page
        WHERE page.id = NEW.page_block_id
          AND page.project_id = NEW.project_id
          AND page.type = 'page'
      ) OR (
        NEW.membership_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM data_source_page_memberships membership
          INNER JOIN data_sources source ON source.id = membership.data_source_id
          WHERE membership.id = NEW.membership_id
            AND membership.page_block_id = NEW.page_block_id
            AND membership.removed_at IS NULL
            AND source.home_database_block_id = NEW.database_block_id
        )
      ) OR (
        NEW.view_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM database_views view
          INNER JOIN data_source_page_memberships membership
            ON membership.id = NEW.membership_id
           AND membership.data_source_id = view.data_source_id
          WHERE view.id = NEW.view_id
            AND view.database_block_id = NEW.database_block_id
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'Page read model source coordinates are invalid or stale');
      END;

    CREATE TRIGGER page_read_model_validate_update
      BEFORE UPDATE ON page_read_model
      WHEN NOT EXISTS (
        SELECT 1 FROM blocks page
        WHERE page.id = NEW.page_block_id
          AND page.project_id = NEW.project_id
          AND page.type = 'page'
      ) OR (
        NEW.membership_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM data_source_page_memberships membership
          INNER JOIN data_sources source ON source.id = membership.data_source_id
          WHERE membership.id = NEW.membership_id
            AND membership.page_block_id = NEW.page_block_id
            AND membership.removed_at IS NULL
            AND source.home_database_block_id = NEW.database_block_id
        )
      ) OR (
        NEW.view_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM database_views view
          INNER JOIN data_source_page_memberships membership
            ON membership.id = NEW.membership_id
           AND membership.data_source_id = view.data_source_id
          WHERE view.id = NEW.view_id
            AND view.database_block_id = NEW.database_block_id
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'Page read model source coordinates are invalid or stale');
      END;
  `);
};

const rebuildPageReadModel = (input: {
  readonly database: Database.Database;
  readonly propertyRows: readonly PropertyRow[];
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
}): void => {
  const rows = input.database.prepare(`
    SELECT * FROM page_read_model ORDER BY page_block_id
  `).all() as readonly PageReadModelRow[];
  const sourceByMembership = new Map(
    (input.database.prepare(`
      SELECT id, data_source_id FROM data_source_page_memberships
    `).all() as readonly {
      readonly id: string;
      readonly data_source_id: string;
    }[]).map((row) => [row.id, row.data_source_id]),
  );
  const propertyRowsByOldCoordinate = new Map(
    input.propertyRows.map((row) => [
      mappingKey(row.data_source_id, row.id),
      row,
    ]),
  );
  const propertiesByNewCoordinate = new Map(
    input.propertyMappings.map((mapping) => {
      const row = propertyRowsByOldCoordinate.get(
        mappingKey(mapping.dataSourceId, mapping.oldPropertyId),
      );
      if (!row) {
        throw new DatabaseIdentityCutoverError(
          `Missing Property row for mapping ${mapping.oldPropertyId}`,
        );
      }
      return [
        mappingKey(mapping.dataSourceId, mapping.newPropertyId),
        { row, mapping },
      ];
    }),
  );
  const optionIndex = optionMappingIndex(input.optionMappings);
  input.database.exec(`
    DROP TABLE IF EXISTS page_read_model_v81;
    CREATE TABLE page_read_model_v81 (
      page_block_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      location_kind TEXT NOT NULL,
      containing_document_id TEXT,
      containing_database_id TEXT,
      top_level_rank_key TEXT,
      location_revision INTEGER NOT NULL CHECK (location_revision >= 1),
      metadata_revision INTEGER NOT NULL CHECK (metadata_revision >= 1),
      document_id TEXT NOT NULL UNIQUE,
      document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
      document_projected_seq INTEGER NOT NULL CHECK (document_projected_seq >= 0),
      document_schema_version INTEGER NOT NULL CHECK (document_schema_version >= 1),
      document_authority TEXT NOT NULL,
      membership_id TEXT,
      database_block_id TEXT,
      view_id TEXT,
      view_group_key TEXT,
      view_rank_key TEXT,
      title TEXT NOT NULL,
      description_preview TEXT NOT NULL,
      description_length INTEGER NOT NULL CHECK (description_length >= 0),
      has_description INTEGER NOT NULL CHECK (has_description IN (0, 1)),
      database_values_json TEXT NOT NULL DEFAULT '{}',
      intrinsic_properties_json TEXT NOT NULL DEFAULT '{}',
      property_revisions_json TEXT NOT NULL DEFAULT '{}',
      projection_version INTEGER NOT NULL DEFAULT 1 CHECK (projection_version >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (page_block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (containing_document_id)
        REFERENCES documents(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (containing_database_id)
        REFERENCES database_containers(block_id) ON DELETE RESTRICT,
      FOREIGN KEY (membership_id)
        REFERENCES data_source_page_memberships(id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (database_block_id)
        REFERENCES database_containers(block_id) ON DELETE RESTRICT,
      FOREIGN KEY (view_id)
        REFERENCES database_views(id) ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (location_kind IN ('space', 'document', 'database')),
      CHECK (
        (location_kind = 'space'
          AND containing_document_id IS NULL
          AND containing_database_id IS NULL)
        OR (location_kind = 'document'
          AND containing_document_id IS NOT NULL
          AND containing_database_id IS NULL)
        OR (location_kind = 'database'
          AND containing_document_id IS NULL
          AND containing_database_id IS NOT NULL)
      ),
      CHECK (document_authority IN ('legacy_shadow', 'ydoc_primary')),
      CHECK (
        (membership_id IS NULL AND database_block_id IS NULL)
        OR (membership_id IS NOT NULL AND database_block_id IS NOT NULL)
      ),
      CHECK (view_id IS NULL OR membership_id IS NOT NULL),
      CHECK (json_valid(database_values_json) AND json_type(database_values_json) = 'object'),
      CHECK (json_valid(intrinsic_properties_json) AND json_type(intrinsic_properties_json) = 'object'),
      CHECK (json_valid(property_revisions_json) AND json_type(property_revisions_json) = 'object'),
      CHECK (length(created_at) > 0 AND length(updated_at) > 0)
    ) WITHOUT ROWID;
  `);
  const columnNames = [
    "page_block_id", "project_id", "lifecycle", "location_kind",
    "containing_document_id", "containing_database_id", "top_level_rank_key",
    "location_revision", "metadata_revision", "document_id",
    "document_generation", "document_projected_seq", "document_schema_version",
    "document_authority", "membership_id", "database_block_id", "view_id",
    "view_group_key", "view_rank_key", "title", "description_preview",
    "description_length", "has_description", "database_values_json",
    "intrinsic_properties_json", "property_revisions_json", "projection_version",
    "created_at", "updated_at",
  ] as const;
  const insert = input.database.prepare(`
    INSERT INTO page_read_model_v81 (${columnNames.join(", ")})
    VALUES (${columnNames.map(() => "?").join(", ")})
  `);
  for (const row of rows) {
    const sourceId = row.membership_id
      ? sourceByMembership.get(row.membership_id) ?? null
      : null;
    if (row.membership_id && !sourceId) {
      throw new DatabaseIdentityCutoverError(
        `Page read projection ${row.page_block_id} has an unknown membership`,
      );
    }
    const canonicalPosition = row.view_id
      ? (input.database.prepare(`
          SELECT group_key FROM database_view_page_positions
          WHERE view_id = ? AND page_block_id = ?
        `).get(row.view_id, row.page_block_id) as
          | { readonly group_key: string | null }
          | undefined)
      : undefined;
    const rewritten: Readonly<Record<string, unknown>> = {
      ...row,
      database_values_json: rewritePageReadDatabaseValues({
        row,
        sourceId,
        propertiesByNewCoordinate,
        optionIndex,
      }),
      view_group_key: canonicalPosition?.group_key ?? row.view_group_key,
    };
    insert.run(...columnNames.map((columnName) => rewritten[columnName]));
  }
  input.database.exec(`
    DROP TABLE page_read_model;
    ALTER TABLE page_read_model_v81 RENAME TO page_read_model;
    CREATE INDEX idx_page_read_model_project_lifecycle
      ON page_read_model(project_id, lifecycle, page_block_id);
    CREATE INDEX idx_page_read_model_view_order
      ON page_read_model(view_id, view_group_key, view_rank_key, page_block_id)
      WHERE view_id IS NOT NULL;
    CREATE INDEX idx_page_read_model_document_freshness
      ON page_read_model(document_id, document_generation, document_projected_seq);
  `);
  installPageReadModelValidationTriggers(input.database);
};

const dropTriggersReferencingLegacyAuthority = (
  database: Database.Database,
): void => {
  for (const triggerName of [
    "block_documents_page_projection_after_insert",
    "blocks_page_projection_after_update",
    "top_level_placements_library_after_insert",
    "top_level_placements_library_after_update",
    "top_level_placements_library_after_delete",
  ]) {
    database.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)}`);
  }
  const triggers = database.prepare(`
    SELECT name, sql FROM sqlite_schema
    WHERE type = 'trigger' AND sql IS NOT NULL
    ORDER BY name
  `).all() as readonly NamedSqliteObject[];
  for (const trigger of triggers) {
    if (!legacyReferencePattern.test(trigger.sql)) continue;
    database.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)}`);
  }
};

const assertNoExternalLegacyForeignKeys = (
  database: Database.Database,
): void => {
  const tables = database.prepare(`
    SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name
  `).all() as readonly { readonly name: string }[];
  for (const { name } of tables) {
    if ((LEGACY_AUTHORITY_TABLES as readonly string[]).includes(name)) continue;
    const foreignKeys = database.pragma(
      `foreign_key_list(${quoteIdentifier(name)})`,
    ) as readonly { readonly table: string }[];
    const legacy = foreignKeys.find((foreignKey) =>
      (LEGACY_AUTHORITY_TABLES as readonly string[]).includes(foreignKey.table),
    );
    if (!legacy) continue;
    throw new DatabaseIdentityCutoverError(
      `Table ${name} still foreign-key references legacy authority ${legacy.table}`,
    );
  }
};

const dropLegacyAuthorityTables = (database: Database.Database): void => {
  assertNoExternalLegacyForeignKeys(database);
  for (const tableName of LEGACY_AUTHORITY_TABLES) {
    database.exec(`DROP TABLE ${quoteIdentifier(tableName)}`);
  }
};

const assertNoLegacySchemaReferences = (
  database: Database.Database,
): void => {
  const references = database.prepare(`
    SELECT type, name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL
    ORDER BY type, name
  `).all() as readonly {
    readonly type: string;
    readonly name: string;
    readonly sql: string;
  }[];
  const retained = references.find((reference) =>
    legacyReferencePattern.test(reference.sql),
  );
  if (!retained) return;
  throw new DatabaseIdentityCutoverError(
    `${retained.type} ${retained.name} still references legacy Database authority`,
  );
};

const assertNoActiveOldIdentities = (input: {
  readonly database: Database.Database;
  readonly propertyMappings: readonly PropertyIdentityMapping[];
  readonly optionMappings: readonly OptionIdentityMapping[];
}): void => {
  const identities = changedLegacyIdentities(
    input.propertyMappings,
    input.optionMappings,
  );
  if (identities.length === 0) return;
  const samples: { readonly location: string; readonly value: string }[] = [];
  const append = (
    location: string,
    rows: readonly { readonly value: string; readonly source?: string }[],
  ): void => {
    for (const row of rows) {
      samples.push({
        location: row.source ? `${location} ${row.source}` : location,
        value: row.value,
      });
    }
  };
  append("canonical Database authority", input.database.prepare(`
    SELECT id AS value FROM data_source_properties
    UNION ALL
      SELECT json_extract(option.value, '$.id')
      FROM data_source_properties property,
        json_each(property.config_json, '$.options') option
    UNION ALL SELECT property_id FROM data_source_property_values
    UNION ALL SELECT value_json FROM data_source_property_values
    UNION ALL SELECT COALESCE(group_key, '') FROM database_view_page_positions
    UNION ALL SELECT COALESCE(view_group_key, '') FROM page_read_model
  `).all() as readonly { readonly value: string }[]);
  append("committed mutation evidence", input.database.prepare(`
    SELECT mutation_id || '.request_json' AS source, request_json AS value
    FROM block_mutations WHERE outcome = 'committed'
    UNION ALL SELECT mutation_id || '.field_intents_json', field_intents_json
    FROM block_mutations WHERE outcome = 'committed'
    UNION ALL SELECT mutation_id || '.expected_revisions_json', expected_revisions_json
    FROM block_mutations WHERE outcome = 'committed'
    UNION ALL SELECT mutation_id || '.result_json', result_json
    FROM block_mutations WHERE outcome = 'committed'
    UNION ALL SELECT mutation_id || '.committed_revisions_json', committed_revisions_json
    FROM block_mutations WHERE outcome = 'committed'
    UNION ALL SELECT 'change_log:' || seq || ':' || COALESCE(operation_id, 'none'), payload_json
    FROM change_log
  `).all() as readonly { readonly source: string; readonly value: string }[]);
  if (tableExists(input.database, "nodex_agent_call_receipts")) {
    append("Nodex Agent receipts", input.database.prepare(`
      SELECT allocations_json AS value FROM nodex_agent_call_receipts
      UNION ALL SELECT result_metadata_json FROM nodex_agent_call_receipts
    `).all() as readonly { readonly value: string }[]);
  }
  if (tableExists(input.database, "project_session_tabs")) {
    append("Project session state", input.database.prepare(`
      SELECT config_json AS value FROM project_session_tabs
      UNION ALL SELECT state_json FROM project_session_tabs
    `).all() as readonly { readonly value: string }[]);
  }
  for (const identity of identities) {
    const retained = samples.find((sample) => sample.value.includes(identity));
    if (!retained) continue;
    throw new DatabaseIdentityCutoverError(
      `${retained.location} still contains old mapped identity ${identity}`,
    );
  }
};

const assertPublishedShape = (database: Database.Database): void => {
  const propertyColumns = database.pragma(
    "table_info(data_source_properties)",
  ) as readonly { readonly name: string; readonly pk: number }[];
  if (propertyColumns.some((column) => column.name === "key")) {
    throw new DatabaseIdentityCutoverError(
      "v81 Property authority still contains the removed key column",
    );
  }
  const primaryKey = propertyColumns
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  if (primaryKey.join(",") !== "data_source_id,id") {
    throw new DatabaseIdentityCutoverError(
      "v81 Property authority does not use its owner-scoped primary key",
    );
  }
  const valuePrimaryKey = (
    database.pragma("table_info(data_source_property_values)") as readonly {
      readonly name: string;
      readonly pk: number;
    }[]
  )
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
  if (
    valuePrimaryKey.join(",") !==
    "data_source_id,membership_id,property_id"
  ) {
    throw new DatabaseIdentityCutoverError(
      "v81 Property values do not use fully scoped primary coordinates",
    );
  }
  const viewColumns = new Set(
    (
      database.pragma("table_info(database_views)") as readonly {
        readonly name: string;
      }[]
    ).map((column) => column.name),
  );
  if (viewColumns.has("project_id") || viewColumns.has("is_primary")) {
    throw new DatabaseIdentityCutoverError(
      "v81 View authority still contains legacy Project/default columns",
    );
  }
};

const migrateInsideTransaction = (
  database: Database.Database,
  options: DatabaseIdentityCutoverSqliteOptions,
): DatabaseIdentityCutoverSqliteReport => {
  assertCanonicalProjectionParity(database);
  const now = options.now ?? new Date().toISOString();
  let previousMetadata = database.prepare(`
    SELECT store_epoch FROM block_store_metadata WHERE id = 1
  `).get() as { readonly store_epoch: string } | undefined;
  if (!previousMetadata) {
    const projectCount = database.prepare("SELECT COUNT(*) FROM projects").pluck()
      .get() as number;
    const blockCount = database.prepare("SELECT COUNT(*) FROM blocks").pluck()
      .get() as number;
    if (projectCount === 0 && blockCount === 0) {
      const emptyStoreEpoch = randomUUID();
      database.prepare(`
        INSERT INTO block_store_metadata (id, store_epoch, created_at, updated_at)
        VALUES (1, ?, ?, ?)
      `).run(emptyStoreEpoch, now, now);
      previousMetadata = { store_epoch: emptyStoreEpoch };
    }
  }
  if (!previousMetadata) {
    throw new DatabaseIdentityCutoverError(
      "Schema v80 has no Block store metadata singleton",
    );
  }
  const previousStoreEpoch = requireCanonicalIdentity(
    previousMetadata.store_epoch,
    "previous store epoch",
  );
  const nextStoreEpoch = requireCanonicalIdentity(
    options.nextStoreEpoch ?? randomUUID(),
    "next store epoch",
  );
  if (nextStoreEpoch === previousStoreEpoch) {
    throw new DatabaseIdentityCutoverError("v81 must rotate the store epoch");
  }
  const {
    rows: propertyRows,
    propertyMappings,
    optionMappings,
  } = readPropertiesAndMappings(database);
  installTemporaryIdentityMaps(database, propertyMappings, optionMappings);
  options.injectFault?.("after_identity_maps");

  const immutableTriggers = readImmutableTriggerDefinitions(database);
  const evidenceRewrites = prepareEvidenceRewrites({
    database,
    propertyMappings,
    optionMappings,
  });
  const views = readViews(database);
  const rewrittenPropertyValues = rebuildPropertyAuthority({
    database,
    rows: propertyRows,
    propertyMappings,
    optionMappings,
  });
  const rewrittenPositions = rebuildViewAuthority({
    database,
    views,
    propertyRows,
    propertyMappings,
    optionMappings,
  });
  assertPositionGroupsMatchValues(database);
  rebuildBlocksWithoutLegacyAuthority(database);
  rebuildPageReadModel({
    database,
    propertyRows,
    propertyMappings,
    optionMappings,
  });
  installCanonicalDatabaseAuthorityTriggers(database);
  options.injectFault?.("after_authority_rebuild");

  const { byOldId: propertyByOldId } = propertyMappingIndexes(propertyMappings);
  applyEvidenceRewrites({
    database,
    rewrites: evidenceRewrites,
    immutableTriggers,
    propertyByOldId,
    afterUpdates: () => options.injectFault?.("after_evidence_rewrite"),
  });

  dropTriggersReferencingLegacyAuthority(database);
  dropLegacyAuthorityTables(database);
  const clearedDatabaseModuleReceipts = database
    .prepare("DELETE FROM database_module_receipts")
    .run().changes;
  const clearedAgentCallReceipts = clearPreCutoverAgentCallReceipts(database);
  database.prepare(`
    UPDATE block_store_metadata SET store_epoch = ?, updated_at = ? WHERE id = 1
  `).run(nextStoreEpoch, now);

  assertNoLegacySchemaReferences(database);
  assertNoActiveOldIdentities({
    database,
    propertyMappings,
    optionMappings,
  });
  assertPublishedShape(database);
  assertNoForeignKeyViolations(database, "Schema v81 pre-publish audit");
  options.injectFault?.("before_publish");
  database.exec(`
    DROP TABLE temp.database_identity_option_map_v81;
    DROP TABLE temp.database_identity_property_map_v81;
  `);
  database.pragma(`user_version = ${TARGET_SCHEMA_VERSION}`);
  return {
    sourceVersion: SOURCE_SCHEMA_VERSION,
    targetVersion: TARGET_SCHEMA_VERSION,
    previousStoreEpoch,
    nextStoreEpoch,
    propertyMappings: propertyMappings.length,
    optionMappings: optionMappings.length,
    rewrittenPropertyValues,
    rewrittenViews: views.length,
    rewrittenPositions,
    rewrittenEvidenceAggregates: evidenceRewrites.length,
    clearedDatabaseModuleReceipts,
    clearedAgentCallReceipts,
  };
};

export const migrateDatabaseIdentityAuthorityV80ToV81 = (
  database: Database.Database,
  options: DatabaseIdentityCutoverSqliteOptions = {},
): DatabaseIdentityCutoverSqliteReport => {
  if (database.inTransaction) {
    throw new DatabaseIdentityCutoverError(
      "Database identity cutover requires ownership of the outer transaction",
    );
  }
  const sourceVersion = readUserVersion(database);
  if (sourceVersion !== SOURCE_SCHEMA_VERSION) {
    throw new DatabaseIdentityCutoverError(
      `Database identity cutover requires schema v80, received v${sourceVersion}`,
    );
  }
  requireTables(database, [
    "projects",
    "blocks",
    "block_store_metadata",
    "database_containers",
    "data_sources",
    "data_source_properties",
    "data_source_page_memberships",
    "data_source_property_values",
    "database_views",
    "database_view_page_positions",
    "page_read_model",
    "block_mutations",
    "change_log",
    "database_module_receipts",
    ...LEGACY_AUTHORITY_TABLES,
  ]);

  const foreignKeysWereEnabled = Boolean(
    database.pragma("foreign_keys", { simple: true }),
  );
  const legacyAlterTableWasEnabled = Boolean(
    database.pragma("legacy_alter_table", { simple: true }),
  );
  database.pragma("foreign_keys = OFF");
  database.pragma("legacy_alter_table = ON");
  try {
    const migrate = database.transaction(() =>
      migrateInsideTransaction(database, options),
    );
    const report = migrate.immediate();
    if (!legacyAlterTableWasEnabled) database.pragma("legacy_alter_table = OFF");
    if (foreignKeysWereEnabled) database.pragma("foreign_keys = ON");
    assertNoForeignKeyViolations(database, "Schema v81 post-publish audit");
    return report;
  } finally {
    if (
      Boolean(database.pragma("legacy_alter_table", { simple: true })) !==
      legacyAlterTableWasEnabled
    ) {
      database.pragma(
        `legacy_alter_table = ${legacyAlterTableWasEnabled ? "ON" : "OFF"}`,
      );
    }
    if (
      Boolean(database.pragma("foreign_keys", { simple: true })) !==
      foreignKeysWereEnabled
    ) {
      database.pragma(`foreign_keys = ${foreignKeysWereEnabled ? "ON" : "OFF"}`);
    }
  }
};
