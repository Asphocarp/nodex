import type Database from "better-sqlite3";
import type {
  DatabaseViewCardRow,
  DatabaseViewDefinition,
  DatabaseViewJsonValue,
  DatabaseViewKind,
  DatabaseViewReadModel,
  LegacyInlineDatabaseViewProps,
} from "../../shared/database-views";
import {
  createLegacyInlineDatabaseViewConfig,
  inlineDatabaseViewId,
} from "../../shared/database-views";
import { readCardSummariesByIds } from "./cards";
import { getDb } from "./database";

const MAX_ID_LENGTH = 512;
const MAX_NAME_LENGTH = 256;
const MAX_RULES_LENGTH = 65_536;
const MAX_CSV_LENGTH = 4_096;

export type DatabaseViewStoreErrorCode =
  | "invalid_input"
  | "host_block_not_found"
  | "host_block_scope_mismatch"
  | "host_block_not_current"
  | "database_not_found"
  | "view_identity_collision"
  | "corrupt_view";

export class DatabaseViewStoreError extends Error {
  constructor(
    readonly code: DatabaseViewStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DatabaseViewStoreError";
  }
}

export interface UpsertLegacyInlineDatabaseViewInput {
  /** Stable ID of the `toggleListInlineView` Block inside the host Document. */
  readonly sourceBlockId: string;
  readonly hostDocumentId: string;
  readonly hostProjectId: string;
  /**
   * Canonical Project whose Database owns the migrated View. When the legacy
   * source hint no longer resolves, migration falls back to the host Project
   * while retaining the original hint losslessly in `props`.
   */
  readonly resolvedSourceProjectId?: string;
  readonly name?: string;
  readonly props: LegacyInlineDatabaseViewProps;
}

export interface UpsertLegacyInlineDatabaseViewResult {
  readonly view: DatabaseViewDefinition;
  readonly definitionChange: "created" | "updated" | "unchanged";
  readonly positionsAdded: number;
}

interface DatabaseViewRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly project_id: string;
  readonly name: string;
  readonly kind: DatabaseViewKind;
  readonly config_json: string;
  readonly is_primary: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface PositionedCardRow {
  readonly block_id: string;
  readonly group_key: string | null;
  readonly rank_key: string;
}

const requireBoundedText = (
  value: string,
  field: string,
  maximumLength: number,
): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new DatabaseViewStoreError(
      "invalid_input",
      `${field} must contain between 1 and ${maximumLength} characters`,
    );
  }
  return normalized;
};

const requireBoundedPayload = (
  value: string | undefined,
  field: string,
  maximumLength: number,
): void => {
  if ((value?.length ?? 0) <= maximumLength) return;
  throw new DatabaseViewStoreError(
    "invalid_input",
    `${field} exceeds ${maximumLength} characters`,
  );
};

const canonicalizeJson = (
  value: unknown,
  path = "config",
): DatabaseViewJsonValue => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalizeJson(item, `${path}[${index}]`));
  }
  if (typeof value !== "object") {
    throw new DatabaseViewStoreError(
      "corrupt_view",
      `${path} contains a non-JSON value`,
    );
  }

  const record = value as Record<string, unknown>;
  const result: Record<string, DatabaseViewJsonValue> = {};
  for (const key of Object.keys(record).sort()) {
    result[key] = canonicalizeJson(record[key], `${path}.${key}`);
  }
  return result;
};

const isJsonObject = (
  value: DatabaseViewJsonValue,
): value is Readonly<Record<string, DatabaseViewJsonValue>> =>
  typeof value === "object"
  && value !== null
  && !Array.isArray(value);

const parseConfig = (
  configJson: string,
): Readonly<Record<string, DatabaseViewJsonValue>> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson) as unknown;
  } catch {
    throw new DatabaseViewStoreError(
      "corrupt_view",
      "Database View config is not valid JSON",
    );
  }
  const canonical = canonicalizeJson(parsed);
  if (!isJsonObject(canonical)) {
    throw new DatabaseViewStoreError(
      "corrupt_view",
      "Database View config must be a JSON object",
    );
  }
  return canonical;
};

const stringifyConfig = (value: unknown): string =>
  JSON.stringify(canonicalizeJson(value));

const nextUpdatedAt = (current: string | null, candidate: string): string => {
  if (!current || candidate > current) return candidate;
  const currentTime = Date.parse(current);
  if (!Number.isFinite(currentTime)) return candidate;
  return new Date(currentTime + 1).toISOString();
};

const rowToDefinition = (row: DatabaseViewRow): DatabaseViewDefinition => ({
  id: row.id,
  databaseBlockId: row.database_block_id,
  projectId: row.project_id,
  name: row.name,
  kind: row.kind,
  config: parseConfig(row.config_json),
  isPrimary: row.is_primary === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const readViewRow = (
  database: Database.Database,
  viewId: string,
): DatabaseViewRow | null => {
  const row = database.prepare(`
    SELECT
      view.id,
      view.database_block_id,
      view.project_id,
      view.name,
      view.kind,
      view.config_json,
      view.is_primary,
      view.created_at,
      view.updated_at
    FROM database_views AS view
    INNER JOIN database_capabilities AS capability
      ON capability.block_id = view.database_block_id
      AND capability.project_id = view.project_id
    INNER JOIN blocks AS database_block
      ON database_block.id = capability.block_id
      AND database_block.project_id = capability.project_id
      AND database_block.type = 'database'
      AND database_block.lifecycle = 'active'
    WHERE view.id = ?
    LIMIT 1
  `).get(viewId) as DatabaseViewRow | undefined;
  return row ?? null;
};

const assertHostReferenceBlock = (
  database: Database.Database,
  input: {
    readonly sourceBlockId: string;
    readonly hostDocumentId: string;
    readonly hostProjectId: string;
  },
): void => {
  const row = database.prepare(`
    SELECT
      block.project_id,
      block.lifecycle,
      block.location_kind,
      block.containing_document_id,
      block_index.block_type,
      block_index.projected_seq,
      document.head_seq
    FROM blocks AS block
    INNER JOIN documents AS document
      ON document.id = block.containing_document_id
      AND document.project_id = block.project_id
    LEFT JOIN document_block_index AS block_index
      ON block_index.block_id = block.id
      AND block_index.document_id = block.containing_document_id
    WHERE block.id = ?
    LIMIT 1
  `).get(input.sourceBlockId) as {
    project_id: string;
    lifecycle: string;
    location_kind: string;
    containing_document_id: string;
    block_type: string | null;
    projected_seq: number | null;
    head_seq: number;
  } | undefined;

  if (!row || row.lifecycle !== "active") {
    throw new DatabaseViewStoreError(
      "host_block_not_found",
      `Active inline Database View Block not found: ${input.sourceBlockId}`,
    );
  }
  if (
    row.project_id !== input.hostProjectId
    || row.location_kind !== "document"
    || row.containing_document_id !== input.hostDocumentId
  ) {
    throw new DatabaseViewStoreError(
      "host_block_scope_mismatch",
      "Inline Database View Block does not belong to the requested host Document and Project",
    );
  }
  if (
    row.block_type !== "toggleListInlineView"
    || row.projected_seq !== row.head_seq
  ) {
    throw new DatabaseViewStoreError(
      "host_block_not_current",
      "Inline Database View Block is absent from the current host Document index",
    );
  }
};

const resolvePrimaryDatabaseBlockId = (
  database: Database.Database,
  projectId: string,
): string => {
  const row = database.prepare(`
    SELECT capability.block_id
    FROM database_capabilities AS capability
    INNER JOIN blocks AS block
      ON block.id = capability.block_id
      AND block.project_id = capability.project_id
      AND block.type = 'database'
      AND block.lifecycle = 'active'
    WHERE capability.project_id = ?
      AND capability.is_primary = 1
    LIMIT 1
  `).get(projectId) as { block_id: string } | undefined;
  if (row) return row.block_id;
  throw new DatabaseViewStoreError(
    "database_not_found",
    `Primary Database not found for Project ${projectId}`,
  );
};

const assertExistingViewIdentity = (
  row: DatabaseViewRow,
  input: {
    readonly sourceBlockId: string;
    readonly sourceProjectId: string;
    readonly databaseBlockId: string;
  },
): void => {
  const config = parseConfig(row.config_json);
  const legacy = config.legacy;
  const hasMatchingSource = isJsonObject(legacy)
    && legacy.source === "toggleListInlineView"
    && legacy.sourceBlockId === input.sourceBlockId;
  if (
    row.project_id === input.sourceProjectId
    && row.database_block_id === input.databaseBlockId
    && row.kind === "list"
    && row.is_primary === 0
    && hasMatchingSource
  ) {
    return;
  }
  throw new DatabaseViewStoreError(
    "view_identity_collision",
    `Database View identity is already owned by another source: ${row.id}`,
  );
};

export const readDatabaseViewDefinition = (
  projectId: string,
  viewId: string,
  database: Database.Database = getDb(),
): DatabaseViewDefinition | null => {
  const canonicalProjectId = requireBoundedText(
    projectId,
    "projectId",
    MAX_ID_LENGTH,
  );
  const canonicalViewId = requireBoundedText(viewId, "viewId", MAX_ID_LENGTH * 2);
  const row = readViewRow(database, canonicalViewId);
  if (!row || row.project_id !== canonicalProjectId) return null;
  return rowToDefinition(row);
};

export const readDatabaseViewDefinitionById = (
  viewId: string,
  database: Database.Database = getDb(),
): DatabaseViewDefinition | null => {
  const canonicalViewId = requireBoundedText(viewId, "viewId", MAX_ID_LENGTH * 2);
  const row = readViewRow(database, canonicalViewId);
  return row ? rowToDefinition(row) : null;
};

const readDatabaseViewRows = (
  view: DatabaseViewDefinition,
  database: Database.Database,
): DatabaseViewCardRow[] => {
  const positionedCards = database.prepare(`
    SELECT
      membership.card_block_id AS block_id,
      COALESCE(position.group_key, primary_position.group_key, card.status) AS group_key,
      COALESCE(
        position.rank_key,
        primary_position.rank_key,
        printf('%020d', CASE WHEN card."order" >= 0 THEN card."order" ELSE 0 END)
      ) AS rank_key
    FROM database_memberships AS membership
    INNER JOIN blocks AS card_block
      ON card_block.id = membership.card_block_id
      AND card_block.project_id = membership.project_id
      AND card_block.type = 'card'
      AND card_block.lifecycle = 'active'
    INNER JOIN cards AS card
      ON card.id = card_block.id
      AND card.project_id = card_block.project_id
      AND card.archived = 0
    LEFT JOIN database_view_positions AS position
      ON position.view_id = ?
      AND position.project_id = membership.project_id
      AND position.block_id = membership.card_block_id
    LEFT JOIN database_views AS primary_view
      ON primary_view.database_block_id = membership.database_block_id
      AND primary_view.project_id = membership.project_id
      AND primary_view.is_primary = 1
    LEFT JOIN database_view_positions AS primary_position
      ON primary_position.view_id = primary_view.id
      AND primary_position.project_id = primary_view.project_id
      AND primary_position.block_id = membership.card_block_id
    WHERE membership.database_block_id = ?
      AND membership.project_id = ?
      AND membership.removed_at IS NULL
    ORDER BY group_key ASC, rank_key ASC, membership.card_block_id ASC
  `).all(
    view.id,
    view.databaseBlockId,
    view.projectId,
  ) as PositionedCardRow[];
  const summaries = readCardSummariesByIds(
    positionedCards.map((row) => row.block_id),
    database,
  );
  if (summaries.length !== positionedCards.length) {
    throw new DatabaseViewStoreError(
      "corrupt_view",
      `Database View ${view.id} contains an unreadable active Card position`,
    );
  }

  const rows: DatabaseViewCardRow[] = positionedCards.map((position, index) => ({
    card: summaries[index]!,
    groupKey: position.group_key,
    rankKey: position.rank_key,
  }));
  return rows;
};

export const readDatabaseView = (
  projectId: string,
  viewId: string,
  database: Database.Database = getDb(),
): DatabaseViewReadModel | null => {
  const view = readDatabaseViewDefinition(projectId, viewId, database);
  if (!view) return null;
  return { view, rows: readDatabaseViewRows(view, database) };
};

/**
 * Resolve a reference-only `databaseViewId` through the globally unique view
 * identity. Transport boundaries must wrap this in an explicit requesting
 * Project scope (and its access policy); this form exists for trusted
 * materialization/migration code and that scoped facade because the canonical
 * reference itself intentionally carries no Project hint.
 */
export const readDatabaseViewById = (
  viewId: string,
  database: Database.Database = getDb(),
): DatabaseViewReadModel | null => {
  const view = readDatabaseViewDefinitionById(viewId, database);
  if (!view) return null;
  return { view, rows: readDatabaseViewRows(view, database) };
};

export const upsertLegacyInlineDatabaseView = (
  input: UpsertLegacyInlineDatabaseViewInput,
  database: Database.Database = getDb(),
): UpsertLegacyInlineDatabaseViewResult => {
  const sourceBlockId = requireBoundedText(
    input.sourceBlockId,
    "sourceBlockId",
    MAX_ID_LENGTH,
  );
  const hostDocumentId = requireBoundedText(
    input.hostDocumentId,
    "hostDocumentId",
    MAX_ID_LENGTH,
  );
  const hostProjectId = requireBoundedText(
    input.hostProjectId,
    "hostProjectId",
    MAX_ID_LENGTH,
  );
  const legacySourceProjectId = requireBoundedText(
    input.props.sourceProjectId,
    "props.sourceProjectId",
    MAX_ID_LENGTH,
  );
  const sourceProjectId = requireBoundedText(
    input.resolvedSourceProjectId ?? legacySourceProjectId,
    "resolvedSourceProjectId",
    MAX_ID_LENGTH,
  );
  const name = requireBoundedText(
    input.name?.trim() || "Inline view",
    "name",
    MAX_NAME_LENGTH,
  );
  requireBoundedPayload(input.props.rulesV2B64, "props.rulesV2B64", MAX_RULES_LENGTH);
  requireBoundedPayload(
    input.props.propertyOrderCsv,
    "props.propertyOrderCsv",
    MAX_CSV_LENGTH,
  );
  requireBoundedPayload(
    input.props.hiddenPropertiesCsv,
    "props.hiddenPropertiesCsv",
    MAX_CSV_LENGTH,
  );

  return database.transaction(() => {
    assertHostReferenceBlock(database, {
      sourceBlockId,
      hostDocumentId,
      hostProjectId,
    });
    const databaseBlockId = resolvePrimaryDatabaseBlockId(database, sourceProjectId);
    const viewId = inlineDatabaseViewId(sourceBlockId);
    const config = createLegacyInlineDatabaseViewConfig({
      sourceBlockId,
      props: {
        ...input.props,
        sourceProjectId: legacySourceProjectId,
      },
    });
    const configJson = stringifyConfig(config);
    const existing = readViewRow(database, viewId);
    const now = nextUpdatedAt(existing?.updated_at ?? null, new Date().toISOString());
    let definitionChange: UpsertLegacyInlineDatabaseViewResult["definitionChange"];

    if (!existing) {
      database.prepare(`
        INSERT INTO database_views (
          id, database_block_id, project_id, name, kind, config_json,
          is_primary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'list', ?, 0, ?, ?)
      `).run(
        viewId,
        databaseBlockId,
        sourceProjectId,
        name,
        configJson,
        now,
        now,
      );
      definitionChange = "created";
    } else {
      assertExistingViewIdentity(existing, {
        sourceBlockId,
        sourceProjectId,
        databaseBlockId,
      });
      if (existing.name === name && existing.config_json === configJson) {
        definitionChange = "unchanged";
      } else {
        database.prepare(`
          UPDATE database_views
          SET name = ?, config_json = ?, updated_at = ?
          WHERE id = ?
        `).run(name, configJson, now, viewId);
        definitionChange = "updated";
      }
    }

    const insertedPositions = database.prepare(`
      INSERT INTO database_view_positions (
        view_id, block_id, project_id, group_key, rank_key, created_at, updated_at
      )
      SELECT
        ?,
        membership.card_block_id,
        membership.project_id,
        COALESCE(primary_position.group_key, card.status),
        COALESCE(primary_position.rank_key, printf('%020d', card."order")),
        ?,
        ?
      FROM database_memberships AS membership
      INNER JOIN blocks AS card_block
        ON card_block.id = membership.card_block_id
        AND card_block.project_id = membership.project_id
        AND card_block.type = 'card'
        AND card_block.lifecycle = 'active'
      INNER JOIN cards AS card
        ON card.id = card_block.id
        AND card.project_id = card_block.project_id
        AND card.archived = 0
      LEFT JOIN database_views AS primary_view
        ON primary_view.database_block_id = membership.database_block_id
        AND primary_view.project_id = membership.project_id
        AND primary_view.is_primary = 1
      LEFT JOIN database_view_positions AS primary_position
        ON primary_position.view_id = primary_view.id
        AND primary_position.project_id = primary_view.project_id
        AND primary_position.block_id = membership.card_block_id
      WHERE membership.database_block_id = ?
        AND membership.project_id = ?
        AND membership.removed_at IS NULL
      ON CONFLICT(view_id, block_id) DO NOTHING
    `).run(
      viewId,
      now,
      now,
      databaseBlockId,
      sourceProjectId,
    );

    const view = readViewRow(database, viewId);
    if (!view) {
      throw new DatabaseViewStoreError(
        "corrupt_view",
        `Created Database View cannot be read: ${viewId}`,
      );
    }
    return {
      view: rowToDefinition(view),
      definitionChange,
      positionsAdded: insertedPositions.changes,
    };
  })();
};
