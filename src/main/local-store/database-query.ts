import type Database from "better-sqlite3";
import {
  evaluateDatabaseViewFilter,
  parseGeneralDatabaseViewConfig,
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
  type GeneralDatabaseViewConfig,
  type GeneralDatabaseViewKind,
} from "../../shared/database-kernel";
import type {
  CardContentSummary,
  GeneralDatabaseCatalog,
  GeneralDatabaseCapability,
  GeneralDatabaseDescriptor,
  GeneralDatabaseManagement,
  GeneralDatabaseMembershipState,
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseRow,
  GeneralDatabaseValue,
  GeneralDatabaseViewDefinition,
  GeneralDatabaseViewQuery,
} from "../../shared/database-query";
import { getDb } from "./database";
import {
  canonicalizePortableRichText,
  portableRichTextPlainText,
} from "../../shared/block-documents/portable-rich-text";

export type {
  CardContentSummary,
  GeneralDatabaseCatalog,
  GeneralDatabaseCapability,
  GeneralDatabaseDescriptor,
  GeneralDatabaseManagement,
  GeneralDatabaseMembershipState,
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseRow,
  GeneralDatabaseValue,
  GeneralDatabaseViewDefinition,
  GeneralDatabaseViewQuery,
} from "../../shared/database-query";

interface DatabaseCapabilityRow {
  readonly block_id: string;
  readonly project_id: string;
  readonly name: string;
  readonly is_primary: number;
  readonly schema_key: string;
  readonly schema_revision: number;
  readonly metadata_revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface DatabasePropertyRow {
  readonly id: string;
  readonly database_block_id: string;
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

interface DatabaseViewRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly project_id: string;
  readonly name: string;
  readonly kind: GeneralDatabaseViewKind;
  readonly config_json: string;
  readonly is_primary: number;
  readonly revision: number;
  readonly rank_key: string;
  readonly lifecycle: "active" | "deleted";
  readonly created_at: string;
  readonly updated_at: string;
}

interface CardSummaryRow {
  readonly block_id: string;
  readonly project_id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
  readonly top_level_rank_key: string | null;
  readonly location_revision: number;
  readonly metadata_revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly document_id: string;
  readonly document_generation: number;
  readonly document_head_seq: number;
  readonly document_authority: "legacy_shadow" | "ydoc_primary";
  readonly projected_seq: number | null;
  readonly title: string | null;
  readonly title_rich_json: string | null;
  readonly preview: string | null;
  readonly plain_text: string | null;
}

interface MembershipRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly card_block_id: string;
  readonly revision: number;
  readonly created_at: string;
  readonly group_key: string | null;
  readonly rank_key: string | null;
  readonly position_revision: number | null;
}

interface ValueRow {
  readonly membership_id: string;
  readonly property_id: string;
  readonly value_type: DatabasePropertyValueType;
  readonly value_json: string;
  readonly revision: number;
}

interface ActiveMembershipAuthorityRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly card_block_id: string;
  readonly revision: number;
  readonly created_at: string;
}

interface MembershipPositionAuthorityRow {
  readonly view_id: string;
  readonly block_id: string;
  readonly group_key: string | null;
  readonly rank_key: string;
  readonly revision: number;
}

export class GeneralDatabaseQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneralDatabaseQueryError";
  }
}

const readPrimaryDatabaseBlockId = (
  database: Database.Database,
  projectId: string,
): string | null => {
  const rows = database
    .prepare(
      `
      SELECT capability.block_id
      FROM database_capabilities capability
      INNER JOIN blocks block
        ON block.id = capability.block_id
       AND block.project_id = capability.project_id
       AND block.type = 'database'
       AND block.lifecycle = 'active'
      WHERE capability.project_id = ? AND capability.is_primary = 1
      ORDER BY capability.block_id
      LIMIT 2
    `,
    )
    .all(projectId) as readonly { readonly block_id: string }[];
  if (rows.length < 2) return rows[0]?.block_id ?? null;
  throw new GeneralDatabaseQueryError(
    `Project ${projectId} has more than one active primary Database`,
  );
};

const parseJson = (value: string, label: string): DatabaseJsonValue => {
  try {
    return JSON.parse(value) as DatabaseJsonValue;
  } catch {
    throw new GeneralDatabaseQueryError(`${label} contains invalid JSON`);
  }
};

const parseJsonRecord = (
  value: string,
  label: string,
): Readonly<Record<string, DatabaseJsonValue>> => {
  const parsed = parseJson(value, label);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Readonly<Record<string, DatabaseJsonValue>>;
  }
  throw new GeneralDatabaseQueryError(`${label} must be a JSON object`);
};

const rowToCapability = (
  row: DatabaseCapabilityRow,
): GeneralDatabaseCapability => ({
  blockId: row.block_id,
  projectId: row.project_id,
  name: row.name,
  isPrimary: row.is_primary === 1,
  schemaKey: row.schema_key,
  schemaRevision: row.schema_revision,
  metadataRevision: row.metadata_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToProperty = (
  row: DatabasePropertyRow,
): GeneralDatabasePropertyDefinition => ({
  id: row.id,
  databaseBlockId: row.database_block_id,
  key: row.key,
  name: row.name,
  valueType: row.value_type,
  config: parseJsonRecord(
    row.config_json,
    `Database property ${row.id} config`,
  ),
  rankKey: row.rank_key,
  lifecycle: row.lifecycle,
  revision: row.schema_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToView = (row: DatabaseViewRow): GeneralDatabaseViewDefinition => {
  const storedConfig = parseJsonRecord(
    row.config_json,
    `Database View ${row.id} config`,
  );
  let config: GeneralDatabaseViewConfig;
  try {
    config = parseGeneralDatabaseViewConfig(storedConfig);
  } catch (error) {
    throw new GeneralDatabaseQueryError(
      `Active Database View ${row.id} has an invalid durable config: ${(error as Error).message}`,
    );
  }
  return {
    id: row.id,
    databaseBlockId: row.database_block_id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    config,
    isPrimary: row.is_primary === 1,
    revision: row.revision,
    rankKey: row.rank_key,
    lifecycle: row.lifecycle,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const readCapabilityRow = (
  database: Database.Database,
  projectId: string,
  databaseBlockId: string,
): DatabaseCapabilityRow | null =>
  (database
    .prepare(
      `
      SELECT
        capability.block_id, capability.project_id, capability.name,
        capability.is_primary, capability.schema_key,
        capability.schema_revision, block.metadata_revision,
        capability.created_at, capability.updated_at
      FROM database_capabilities capability
      INNER JOIN blocks block
        ON block.id = capability.block_id
       AND block.project_id = capability.project_id
       AND block.type = 'database'
       AND block.lifecycle = 'active'
      WHERE capability.block_id = ? AND capability.project_id = ?
      LIMIT 1
    `,
    )
    .get(databaseBlockId, projectId) as DatabaseCapabilityRow | undefined) ??
  null;

const readPropertyRows = (
  database: Database.Database,
  projectId: string,
  databaseBlockId: string,
): DatabasePropertyRow[] =>
  database
    .prepare(
      `
      SELECT
        id, database_block_id, key, name, value_type, config_json,
        rank_key, lifecycle, schema_revision, created_at, updated_at
      FROM database_properties
      WHERE database_block_id = ? AND project_id = ?
      ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id
    `,
    )
    .all(databaseBlockId, projectId) as DatabasePropertyRow[];

const readViewRows = (
  database: Database.Database,
  projectId: string,
  databaseBlockId: string,
): DatabaseViewRow[] =>
  database
    .prepare(
      `
      SELECT
        id, database_block_id, project_id, name, kind, config_json,
        is_primary, revision, rank_key, lifecycle, created_at, updated_at
      FROM database_views
      WHERE database_block_id = ? AND project_id = ?
      ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id
    `,
    )
    .all(databaseBlockId, projectId) as DatabaseViewRow[];

export const readGeneralDatabaseDescriptor = (
  projectId: string,
  databaseBlockId: string,
  database: Database.Database = getDb(),
): GeneralDatabaseDescriptor | null => {
  const capability = readCapabilityRow(database, projectId, databaseBlockId);
  if (!capability) return null;
  return {
    database: rowToCapability(capability),
    properties: readPropertyRows(database, projectId, databaseBlockId).map(
      rowToProperty,
    ),
    views: readViewRows(database, projectId, databaseBlockId).map(rowToView),
  };
};

export const readPrimaryGeneralDatabaseDescriptor = (
  projectId: string,
  database: Database.Database = getDb(),
): GeneralDatabaseDescriptor | null => {
  const databaseBlockId = readPrimaryDatabaseBlockId(database, projectId);
  if (!databaseBlockId) return null;
  return readGeneralDatabaseDescriptor(projectId, databaseBlockId, database);
};

export const readGeneralDatabaseCatalog = (
  projectId: string,
  database: Database.Database = getDb(),
): GeneralDatabaseCatalog => {
  const rows = database
    .prepare(
      `
      SELECT capability.block_id
      FROM database_capabilities capability
      INNER JOIN blocks block
        ON block.id = capability.block_id
       AND block.project_id = capability.project_id
       AND block.type = 'database'
       AND block.lifecycle = 'active'
      LEFT JOIN top_level_block_placements placement
        ON placement.block_id = capability.block_id
       AND placement.project_id = capability.project_id
      WHERE capability.project_id = ?
      ORDER BY
        CASE WHEN placement.rank_key IS NULL THEN 1 ELSE 0 END,
        placement.rank_key,
        capability.block_id
    `,
    )
    .all(projectId) as readonly { readonly block_id: string }[];

  return {
    databases: rows.map((row) => {
      const descriptor = readGeneralDatabaseDescriptor(
        projectId,
        row.block_id,
        database,
      );
      if (descriptor) return descriptor;
      throw new GeneralDatabaseQueryError(
        `Active Database ${row.block_id} disappeared while reading its catalog`,
      );
    }),
  };
};

const readCardSummaryRows = (
  database: Database.Database,
  projectId: string,
  blockIds: readonly string[],
): CardSummaryRow[] => {
  if (blockIds.length === 0) return [];
  const placeholders = blockIds.map(() => "?").join(", ");
  return database
    .prepare(
      `
      SELECT
        block.id AS block_id, block.project_id, block.lifecycle,
        block.location_kind, block.containing_document_id,
        block.containing_database_id,
        placement.rank_key AS top_level_rank_key,
        block.location_revision, block.metadata_revision,
        block.created_at, block.updated_at,
        ownership.document_id, document.generation AS document_generation,
        document.head_seq AS document_head_seq,
        document.authority AS document_authority,
        materialization.projected_seq, materialization.title,
        materialization.title_rich_json,
        materialization.preview, materialization.plain_text
      FROM blocks block
      INNER JOIN block_documents ownership
        ON ownership.block_id = block.id
       AND ownership.project_id = block.project_id
      INNER JOIN documents document
        ON document.id = ownership.document_id
       AND document.project_id = ownership.project_id
      LEFT JOIN top_level_block_placements placement
        ON placement.block_id = block.id
       AND placement.project_id = block.project_id
      LEFT JOIN document_materializations materialization
        ON materialization.document_id = document.id
       AND materialization.generation = document.generation
       AND materialization.projected_seq = document.head_seq
       AND materialization.schema_version = document.schema_version
      WHERE block.project_id = ?
        AND block.type = 'card'
        AND block.id IN (${placeholders})
      ORDER BY block.id
    `,
    )
    .all(projectId, ...blockIds) as CardSummaryRow[];
};

const rowToCardSummary = (row: CardSummaryRow): CardContentSummary => {
  const materializationMissing =
    row.projected_seq === null ||
    row.title === null ||
    row.title_rich_json === null ||
    row.preview === null ||
    row.plain_text === null;
  if (row.document_authority === "ydoc_primary" && materializationMissing) {
    throw new GeneralDatabaseQueryError(
      `Y.Doc-primary Card ${row.block_id} has no exact-head materialization`,
    );
  }
  const richTitle = materializationMissing
    ? null
    : canonicalizePortableRichText(JSON.parse(row.title_rich_json as string));
  if (richTitle && portableRichTextPlainText(richTitle) !== row.title) {
    throw new GeneralDatabaseQueryError(
      `Card ${row.block_id} has divergent rich and plain title projections`,
    );
  }
  return {
    blockId: row.block_id,
    projectId: row.project_id,
    lifecycle: row.lifecycle,
    location:
      row.location_kind === "space"
        ? { kind: "space", rankKey: row.top_level_rank_key }
        : row.location_kind === "document"
          ? {
            kind: "document",
            documentId:
              row.containing_document_id ??
              (() => {
                throw new GeneralDatabaseQueryError(
                  `Card ${row.block_id} has an invalid Document location`,
                );
              })(),
            }
          : {
              kind: "database",
              databaseBlockId:
                row.containing_database_id ??
                (() => {
                  throw new GeneralDatabaseQueryError(
                    `Card ${row.block_id} has an invalid Database location`,
                  );
                })(),
            },
    locationRevision: row.location_revision,
    metadataRevision: row.metadata_revision,
    documentId: row.document_id,
    documentGeneration: row.document_generation,
    documentHeadSeq: row.document_head_seq,
    documentAuthority: row.document_authority,
    content: materializationMissing
      ? null
      : {
          projectedSeq: row.projected_seq,
          title: row.title,
          richTitle: richTitle ?? [],
          preview: row.preview,
          plainText: row.plain_text,
        },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const readCardContentSummaries = (
  projectId: string,
  blockIds: readonly string[],
  database: Database.Database = getDb(),
): readonly CardContentSummary[] => {
  const byId = new Map(
    readCardSummaryRows(database, projectId, [...new Set(blockIds)])
      .map(rowToCardSummary)
      .map((summary) => [summary.blockId, summary] as const),
  );
  return blockIds.flatMap((blockId) => {
    const summary = byId.get(blockId);
    return summary ? [summary] : [];
  });
};

export const readCardContentSummary = (
  projectId: string,
  blockId: string,
  database: Database.Database = getDb(),
): CardContentSummary | null =>
  readCardContentSummaries(projectId, [blockId], database)[0] ?? null;

export const readGeneralDatabaseManagement = (
  projectId: string,
  database: Database.Database = getDb(),
): GeneralDatabaseManagement => {
  const cardIds = database
    .prepare(
      `
      SELECT id
      FROM blocks
      WHERE project_id = ? AND type = 'card' AND lifecycle = 'active'
      ORDER BY created_at, id
    `,
    )
    .all(projectId) as readonly { readonly id: string }[];
  const cards = readCardContentSummaries(
    projectId,
    cardIds.map((row) => row.id),
    database,
  );
  if (cards.length !== cardIds.length) {
    throw new GeneralDatabaseQueryError(
      `Project ${projectId} contains an active Card without readable Document authority`,
    );
  }

  const membershipRows = database
    .prepare(
      `
      SELECT
        membership.id, membership.database_block_id,
        membership.card_block_id, membership.revision, membership.created_at
      FROM database_memberships membership
      INNER JOIN blocks card
        ON card.id = membership.card_block_id
       AND card.project_id = membership.project_id
       AND card.type = 'card'
       AND card.lifecycle = 'active'
       AND card.location_kind = 'database'
       AND card.containing_database_id = membership.database_block_id
      WHERE membership.project_id = ? AND membership.removed_at IS NULL
      ORDER BY membership.card_block_id, membership.id
    `,
    )
    .all(projectId) as readonly ActiveMembershipAuthorityRow[];
  const membershipByCard = new Map<
    string,
    ActiveMembershipAuthorityRow
  >();
  for (const row of membershipRows) {
    if (membershipByCard.has(row.card_block_id)) {
      throw new GeneralDatabaseQueryError(
        `Card ${row.card_block_id} has more than one active Database membership`,
      );
    }
    membershipByCard.set(row.card_block_id, row);
  }

  const positionRows = database
    .prepare(
      `
      SELECT
        position.view_id, position.block_id, position.group_key,
        position.rank_key, position.revision
      FROM database_view_positions position
      INNER JOIN database_views view
        ON view.id = position.view_id
       AND view.project_id = position.project_id
       AND view.lifecycle = 'active'
      INNER JOIN database_memberships membership
        ON membership.card_block_id = position.block_id
       AND membership.project_id = position.project_id
       AND membership.database_block_id = view.database_block_id
       AND membership.removed_at IS NULL
      WHERE position.project_id = ?
      ORDER BY position.block_id, position.view_id
    `,
    )
    .all(projectId) as readonly MembershipPositionAuthorityRow[];
  const positionsByCard = new Map<
    string,
    MembershipPositionAuthorityRow[]
  >();
  for (const row of positionRows) {
    const positions = positionsByCard.get(row.block_id) ?? [];
    positions.push(row);
    positionsByCard.set(row.block_id, positions);
  }

  const states: GeneralDatabaseMembershipState[] = cards.map((card) => {
    const membership = membershipByCard.get(card.blockId) ?? null;
    return {
      card,
      membership: membership
        ? {
            id: membership.id,
            databaseBlockId: membership.database_block_id,
            cardBlockId: membership.card_block_id,
            revision: membership.revision,
            createdAt: membership.created_at,
          }
        : null,
      positions: (positionsByCard.get(card.blockId) ?? []).map((position) => ({
        viewId: position.view_id,
        groupKey: position.group_key,
        rankKey: position.rank_key,
        revision: position.revision,
      })),
    };
  });
  return {
    catalog: readGeneralDatabaseCatalog(projectId, database),
    cards: states,
  };
};

const readMembershipRows = (
  database: Database.Database,
  projectId: string,
  view: GeneralDatabaseViewDefinition,
): MembershipRow[] =>
  database
    .prepare(
      `
      SELECT
        membership.id, membership.database_block_id,
        membership.card_block_id, membership.revision,
        membership.created_at, position.group_key, position.rank_key,
        position.revision AS position_revision
      FROM database_memberships membership
      INNER JOIN blocks card
        ON card.id = membership.card_block_id
       AND card.project_id = membership.project_id
       AND card.type = 'card'
       AND card.lifecycle = 'active'
       AND card.location_kind = 'database'
       AND card.containing_database_id = membership.database_block_id
      LEFT JOIN database_view_positions position
        ON position.view_id = ?
       AND position.project_id = membership.project_id
       AND position.block_id = membership.card_block_id
      WHERE membership.database_block_id = ?
        AND membership.project_id = ?
        AND membership.removed_at IS NULL
      ORDER BY
        CASE WHEN position.rank_key IS NULL THEN 1 ELSE 0 END,
        position.group_key, position.rank_key, membership.card_block_id
    `,
    )
    .all(view.id, view.databaseBlockId, projectId) as MembershipRow[];

const readValuesByMembership = (
  database: Database.Database,
  projectId: string,
  membershipIds: readonly string[],
): ReadonlyMap<string, Readonly<Record<string, GeneralDatabaseValue>>> => {
  if (membershipIds.length === 0) return new Map();
  const placeholders = membershipIds.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `
      SELECT
        value.membership_id, value.property_id, value.value_type,
        value.value_json, value.revision
      FROM database_property_values value
      INNER JOIN database_properties property
        ON property.id = value.property_id
       AND property.database_block_id = value.database_block_id
       AND property.project_id = value.project_id
       AND property.lifecycle = 'active'
      WHERE value.project_id = ?
        AND value.membership_id IN (${placeholders})
      ORDER BY value.membership_id, value.property_id
    `,
    )
    .all(projectId, ...membershipIds) as ValueRow[];
  const result = new Map<string, Record<string, GeneralDatabaseValue>>();
  for (const row of rows) {
    const values = result.get(row.membership_id) ?? {};
    values[row.property_id] = {
      propertyId: row.property_id,
      valueType: row.value_type,
      value: parseJson(
        row.value_json,
        `Database property value ${row.membership_id}/${row.property_id}`,
      ),
      revision: row.revision,
    };
    result.set(row.membership_id, values);
  }
  return result;
};

const matchesViewFilter = (
  row: GeneralDatabaseRow,
  filter: GeneralDatabaseViewConfig["filter"],
): boolean =>
  evaluateDatabaseViewFilter(
    filter,
    (propertyId) => row.values[propertyId]?.value,
  );

const isEmptyValue = (value: DatabaseJsonValue | undefined): boolean =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const compareViewValues = (
  left: DatabaseJsonValue | undefined,
  right: DatabaseJsonValue | undefined,
  nulls: "first" | "last",
  direction: "asc" | "desc",
): number => {
  const leftEmpty = isEmptyValue(left);
  const rightEmpty = isEmptyValue(right);
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return nulls === "first" ? -1 : 1;
  if (rightEmpty) return nulls === "first" ? 1 : -1;
  let comparison: number;
  if (typeof left === "number" && typeof right === "number") {
    comparison = left - right;
  } else if (typeof left === "boolean" && typeof right === "boolean") {
    comparison = Number(left) - Number(right);
  } else {
    comparison = stableStringifyDatabaseJson(left).localeCompare(
      stableStringifyDatabaseJson(right),
    );
  }
  return comparison * (direction === "asc" ? 1 : -1);
};

const compareRows = (
  left: GeneralDatabaseRow,
  right: GeneralDatabaseRow,
  config: GeneralDatabaseViewConfig,
): number => {
  for (const sort of config.sort) {
    let comparison: number;
    if (sort.field.kind === "manual") {
      comparison = compareViewValues(
        left.position?.rankKey,
        right.position?.rankKey,
        sort.nulls,
        sort.direction,
      );
    } else if (sort.field.kind === "title") {
      comparison = compareViewValues(
        left.card.content?.title,
        right.card.content?.title,
        sort.nulls,
        sort.direction,
      );
    } else if (sort.field.kind === "created") {
      comparison = compareViewValues(
        left.card.createdAt,
        right.card.createdAt,
        sort.nulls,
        sort.direction,
      );
    } else {
      comparison = compareViewValues(
        left.values[sort.field.propertyId]?.value,
        right.values[sort.field.propertyId]?.value,
        sort.nulls,
        sort.direction,
      );
    }
    if (comparison !== 0) return comparison;
  }
  return left.card.blockId.localeCompare(right.card.blockId);
};

const groupKeyForValue = (
  value: DatabaseJsonValue | undefined,
): string | null => {
  if (isEmptyValue(value)) return null;
  if (typeof value === "string") return value;
  return stableStringifyDatabaseJson(value);
};

export const queryGeneralDatabaseView = (
  projectId: string,
  viewId: string,
  database: Database.Database = getDb(),
): GeneralDatabaseViewQuery | null => {
  const viewRow = database
    .prepare(
      `
      SELECT
        view.id, view.database_block_id, view.project_id, view.name,
        view.kind, view.config_json, view.is_primary, view.revision,
        view.rank_key, view.lifecycle, view.created_at, view.updated_at
      FROM database_views view
      INNER JOIN database_capabilities capability
        ON capability.block_id = view.database_block_id
       AND capability.project_id = view.project_id
      INNER JOIN blocks database_block
        ON database_block.id = capability.block_id
       AND database_block.project_id = capability.project_id
       AND database_block.type = 'database'
       AND database_block.lifecycle = 'active'
      WHERE view.id = ? AND view.project_id = ? AND view.lifecycle = 'active'
      LIMIT 1
    `,
    )
    .get(viewId, projectId) as DatabaseViewRow | undefined;
  if (!viewRow) return null;
  const view = rowToView(viewRow);
  const capabilityRow = readCapabilityRow(
    database,
    projectId,
    view.databaseBlockId,
  );
  if (!capabilityRow) return null;
  const properties = readPropertyRows(database, projectId, view.databaseBlockId)
    .filter((property) => property.lifecycle === "active")
    .map(rowToProperty);
  const memberships = readMembershipRows(database, projectId, view);
  const summaries = readCardContentSummaries(
    projectId,
    memberships.map((membership) => membership.card_block_id),
    database,
  );
  const summariesById = new Map(
    summaries.map((summary) => [summary.blockId, summary] as const),
  );
  const valuesByMembership = readValuesByMembership(
    database,
    projectId,
    memberships.map((membership) => membership.id),
  );
  const rows = memberships.map((membership): GeneralDatabaseRow => {
    const card = summariesById.get(membership.card_block_id);
    if (!card) {
      throw new GeneralDatabaseQueryError(
        `Database membership ${membership.id} has no readable Card Block`,
      );
    }
    const values = valuesByMembership.get(membership.id) ?? {};
    const configuredGroup = view.config.group;
    const effectiveGroupKey =
      configuredGroup === null
        ? membership.group_key
        : groupKeyForValue(values[configuredGroup.propertyId]?.value);
    if (
      configuredGroup !== null &&
      membership.rank_key !== null &&
      membership.group_key !== effectiveGroupKey
    ) {
      throw new GeneralDatabaseQueryError(
        `Database View ${view.id} position for Card ${membership.card_block_id} diverges from grouped property ${configuredGroup.propertyId}`,
      );
    }
    return {
      membership: {
        id: membership.id,
        databaseBlockId: membership.database_block_id,
        cardBlockId: membership.card_block_id,
        revision: membership.revision,
        createdAt: membership.created_at,
      },
      card,
      values,
      position:
        membership.rank_key === null || membership.position_revision === null
          ? null
          : {
              groupKey: membership.group_key,
              rankKey: membership.rank_key,
              revision: membership.position_revision,
            },
      effectiveGroupKey,
    };
  });
  return {
    database: rowToCapability(capabilityRow),
    view,
    properties,
    rows: rows
      .filter((row) => matchesViewFilter(row, view.config.filter))
      .sort((left, right) => compareRows(left, right, view.config)),
  };
};
