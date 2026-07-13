import type Database from "better-sqlite3";

import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "../../shared/block-property-mutations";
import {
  CARD_METADATA_DATABASE_FIELDS,
  CARD_METADATA_INTRINSIC_FIELDS,
  type CardDatabaseMetadataField,
  type CardDatabasePropertyCoordinate,
  type CardIntrinsicMetadataField,
  type CardIntrinsicPropertyCoordinate,
  type CardMetadataPropertySnapshot,
} from "../../shared/card-metadata-property-compiler";

export type CardMetadataPropertySnapshotErrorCode =
  | "store_not_initialized"
  | "card_not_found"
  | "card_not_active"
  | "membership_ambiguous"
  | "property_missing"
  | "property_ambiguous"
  | "property_type_mismatch"
  | "property_value_corrupt";

export class CardMetadataPropertySnapshotError extends Error {
  constructor(
    readonly code: CardMetadataPropertySnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CardMetadataPropertySnapshotError";
  }
}

interface CardRow {
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly metadata_revision: number;
}

interface IntrinsicRow {
  readonly property_key: string;
  readonly value_json: string;
  readonly revision: number;
}

interface MembershipRow {
  readonly id: string;
  readonly database_block_id: string;
}

interface DatabasePropertyRow {
  readonly id: string;
  readonly key: string;
  readonly value_type: string;
  readonly value_json: string | null;
  readonly revision: number | null;
}

const parseValue = (
  value: string | null,
  label: string,
): BlockPropertyJsonValue => {
  if (value === null) {
    throw new CardMetadataPropertySnapshotError(
      "property_missing",
      `${label} has no authoritative value`,
    );
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.parse(
      stableStringifyBlockPropertyJson(parsed),
    ) as BlockPropertyJsonValue;
  } catch {
    throw new CardMetadataPropertySnapshotError(
      "property_value_corrupt",
      `${label} is not valid JSON`,
    );
  }
};

const readSnapshot = (
  database: Database.Database,
  projectId: string,
  cardBlockId: string,
  options: { readonly allowArchived: boolean },
): CardMetadataPropertySnapshot => {
  const store = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (!store) {
    throw new CardMetadataPropertySnapshotError(
      "store_not_initialized",
      "Block store metadata is missing",
    );
  }
  const card = database
    .prepare(
      `
      SELECT type, lifecycle, metadata_revision
      FROM blocks
      WHERE id = ? AND project_id = ?
    `,
    )
    .get(cardBlockId, projectId) as CardRow | undefined;
  if (!card || card.type !== "card") {
    throw new CardMetadataPropertySnapshotError(
      "card_not_found",
      `Card does not exist in Project ${projectId}: ${cardBlockId}`,
    );
  }
  if (
    card.lifecycle === "deleted" ||
    (!options.allowArchived && card.lifecycle !== "active")
  ) {
    throw new CardMetadataPropertySnapshotError(
      "card_not_active",
      `Card is not active: ${cardBlockId}`,
    );
  }

  const intrinsicEntries = Object.entries(
    CARD_METADATA_INTRINSIC_FIELDS,
  ) as Array<[CardIntrinsicMetadataField, string]>;
  const intrinsicRows = database
    .prepare(
      `
      SELECT property_key, value_json, revision
      FROM block_properties
      WHERE block_id = ? AND project_id = ?
        AND property_key IN (${intrinsicEntries.map(() => "?").join(", ")})
    `,
    )
    .all(
      cardBlockId,
      projectId,
      ...intrinsicEntries.map(([, propertyKey]) => propertyKey),
    ) as IntrinsicRow[];
  const intrinsicByKey = new Map(
    intrinsicRows.map((row) => [row.property_key, row]),
  );
  const fields: Array<
    CardDatabasePropertyCoordinate | CardIntrinsicPropertyCoordinate
  > = intrinsicEntries.map(([field, propertyKey]) => {
    const row = intrinsicByKey.get(propertyKey);
    if (!row) {
      throw new CardMetadataPropertySnapshotError(
        "property_missing",
        `Card ${cardBlockId} is missing intrinsic property ${propertyKey}`,
      );
    }
    return {
      scope: "intrinsic",
      field,
      revision: row.revision,
      value: parseValue(row.value_json, `Intrinsic property ${propertyKey}`),
    };
  });

  const memberships = database
    .prepare(
      `
      SELECT id, database_block_id
      FROM database_memberships
      WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
    `,
    )
    .all(cardBlockId, projectId) as MembershipRow[];
  if (memberships.length > 1) {
    throw new CardMetadataPropertySnapshotError(
      "membership_ambiguous",
      `Card has multiple active Database memberships: ${cardBlockId}`,
    );
  }
  const membership = memberships[0];
  if (membership) {
    const databaseEntries = Object.entries(
      CARD_METADATA_DATABASE_FIELDS,
    ) as Array<
      [
        CardDatabaseMetadataField,
        {
          readonly key: string;
          readonly valueType: string;
        },
      ]
    >;
    const rows = database
      .prepare(
        `
        SELECT
          property.id, property.key, property.value_type,
          value.value_json, value.revision
        FROM database_properties property
        LEFT JOIN database_property_values value
          ON value.membership_id = ?
          AND value.property_id = property.id
          AND value.database_block_id = property.database_block_id
          AND value.project_id = property.project_id
        WHERE property.database_block_id = ?
          AND property.project_id = ?
          AND property.lifecycle = 'active'
          AND property.key IN (${databaseEntries.map(() => "?").join(", ")})
      `,
      )
      .all(
        membership.id,
        membership.database_block_id,
        projectId,
        ...databaseEntries.map(([, definition]) => definition.key),
      ) as DatabasePropertyRow[];
    const rowsByKey = new Map<string, DatabasePropertyRow>();
    for (const row of rows) {
      if (rowsByKey.has(row.key)) {
        throw new CardMetadataPropertySnapshotError(
          "property_ambiguous",
          `Database has multiple active properties for key ${row.key}`,
        );
      }
      rowsByKey.set(row.key, row);
    }
    for (const [field, definition] of databaseEntries) {
      const row = rowsByKey.get(definition.key);
      if (!row) continue;
      if (row.value_type !== definition.valueType) {
        throw new CardMetadataPropertySnapshotError(
          "property_type_mismatch",
          `Database property ${row.id} has type ${row.value_type}, expected ${definition.valueType}`,
        );
      }
      fields.push({
        scope: "database",
        field,
        databaseBlockId: membership.database_block_id,
        propertyId: row.id,
        revision: row.revision ?? 0,
        value:
          row.revision === null
            ? definition.valueType === "multi_select"
              ? []
              : null
            : parseValue(
                row.value_json,
                `Database property ${definition.key}`,
              ),
      });
    }
  }

  const change = database
    .prepare(
      "SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log WHERE project_id = ?",
    )
    .get(projectId) as { readonly seq: number };
  return {
    projectId,
    storeEpoch: store.store_epoch,
    changeLogSeq: change.seq,
    cardBlockId,
    metadataRevision: card.metadata_revision,
    fields: fields.sort((left, right) => left.field.localeCompare(right.field)),
  };
};

/** Capture values, property identities, and revisions under one SQLite read. */
export const readCardMetadataPropertySnapshot = (
  database: Database.Database,
  projectId: string,
  cardBlockId: string,
): CardMetadataPropertySnapshot =>
  database
    .transaction(() => readSnapshot(
      database,
      projectId,
      cardBlockId,
      { allowArchived: false },
    ))
    .deferred();

/**
 * Read-only Card Detail may display an archived Card, but mutation callers
 * must continue using `readCardMetadataPropertySnapshot`, which rejects it.
 */
export const readCardMetadataPropertySnapshotForDetail = (
  database: Database.Database,
  projectId: string,
  cardBlockId: string,
): CardMetadataPropertySnapshot =>
  database
    .transaction(() => readSnapshot(
      database,
      projectId,
      cardBlockId,
      { allowArchived: true },
    ))
    .deferred();
