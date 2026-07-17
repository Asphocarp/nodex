import type Database from "better-sqlite3";

import {
  parseDatabaseViewConfig,
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabaseViewSort,
} from "../../shared/database-kernel";
import { readPagesInDatabase } from "./pages";
import {
  compareDatabaseViewOrderItems,
  type DatabaseViewOrderItem,
} from "./database-view-order";
import type { LogicalDatabaseViewPositionItem } from "./database-view-position-plan";

interface LegacyLogicalOrderRow {
  readonly membershipId: string;
  readonly pageId: string;
  readonly positionGroupKey: string | null;
  readonly rankKey: string | null;
}

interface LegacyPropertyValueRow {
  readonly membershipId: string;
  readonly propertyId: string;
  readonly valueJson: string;
}

export interface LegacyDatabaseViewLogicalOrder {
  readonly items: readonly LogicalDatabaseViewPositionItem[];
  readonly effectiveGroupKeys: ReadonlyMap<string, string | null>;
}

export interface LegacyDatabaseViewOrderConfig {
  readonly groupPropertyId: string | null;
  readonly sort: readonly DatabaseViewSort[];
  readonly usesExplicitGroups: boolean;
}

export const resolveLegacyDatabaseViewOrderConfig = (
  configJson: string,
): LegacyDatabaseViewOrderConfig => {
  try {
    const config = parseDatabaseViewConfig(JSON.parse(configJson) as unknown);
    return {
      groupPropertyId: config.group?.propertyId ?? null,
      sort: config.sort,
      usesExplicitGroups: false,
    };
  } catch {
    return {
      groupPropertyId: null,
      sort: [{
        field: { kind: "manual" },
        direction: "asc",
        nulls: "last",
      }],
      usesExplicitGroups: true,
    };
  }
};

const groupKeyForValue = (value: DatabaseJsonValue | undefined): string | null => {
  if (
    value === undefined
    || value === null
    || value === ""
    || (Array.isArray(value) && value.length === 0)
  ) {
    return null;
  }
  if (typeof value === "string") return value;
  return stableStringifyDatabaseJson(value);
};

const parsePropertyValue = (
  pageId: string,
  propertyId: string,
  valueJson: string,
): DatabaseJsonValue => {
  try {
    return JSON.parse(valueJson) as DatabaseJsonValue;
  } catch {
    throw new Error(`Property ${propertyId} value for Page ${pageId} is corrupt`);
  }
};

/**
 * Reads the compatibility Database authority in the same complete, unfiltered
 * logical order exposed by the View's configured sort.
 * Selected Pages may be excluded to tolerate their intentional transient group
 * mismatch between a preceding value write and an explicit position write.
 */
export const readLegacyDatabaseViewLogicalOrder = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly databaseBlockId: string;
    readonly viewId: string;
    readonly groupPropertyId: string | null;
    readonly groupKey: string | null;
    readonly sort: readonly DatabaseViewSort[];
    readonly excludedPageIds?: ReadonlySet<string>;
    readonly positionConsistencyExemptPageIds?: ReadonlySet<string>;
  },
): LegacyDatabaseViewLogicalOrder => {
  const groupPropertyId = input.groupPropertyId;
  const rows = database.prepare(`
    SELECT membership.id AS membershipId,
      membership.page_block_id AS pageId,
      position.group_key AS positionGroupKey,
      position.rank_key AS rankKey
    FROM database_memberships membership
    INNER JOIN blocks block
      ON block.id = membership.page_block_id
      AND block.project_id = membership.project_id
      AND block.lifecycle = 'active'
      AND block.type IN ('page', 'nodex.page')
    LEFT JOIN database_view_positions position
      ON position.view_id = ?
      AND position.block_id = membership.page_block_id
      AND position.project_id = membership.project_id
    WHERE membership.database_block_id = ?
      AND membership.project_id = ?
      AND membership.removed_at IS NULL
  `).all(
    input.viewId,
    input.databaseBlockId,
    input.projectId,
  ) as readonly LegacyLogicalOrderRow[];

  const pageIds = rows.map((row) => row.pageId);
  const pages = readPagesInDatabase(database, pageIds);
  const propertyValues = new Map<string, Record<string, DatabaseJsonValue>>();
  if (rows.length > 0) {
    const placeholders = rows.map(() => "?").join(", ");
    const values = database.prepare(`
      SELECT value.membership_id AS membershipId,
        value.property_id AS propertyId, value.value_json AS valueJson
      FROM database_property_values value
      INNER JOIN database_properties property
        ON property.id = value.property_id
        AND property.database_block_id = value.database_block_id
        AND property.project_id = value.project_id
        AND property.lifecycle = 'active'
      WHERE value.membership_id IN (${placeholders})
      ORDER BY value.membership_id, value.property_id
    `).all(...rows.map((row) => row.membershipId)) as readonly LegacyPropertyValueRow[];
    const pageIdByMembershipId = new Map(
      rows.map((row) => [row.membershipId, row.pageId] as const),
    );
    for (const value of values) {
      const pageId = pageIdByMembershipId.get(value.membershipId);
      if (!pageId) throw new Error(`Property value has no active membership: ${value.membershipId}`);
      const membershipValues = propertyValues.get(value.membershipId) ?? {};
      membershipValues[value.propertyId] = parsePropertyValue(
        pageId,
        value.propertyId,
        value.valueJson,
      );
      propertyValues.set(value.membershipId, membershipValues);
    }
  }

  const effectiveGroupKeys = new Map<string, string | null>();
  const items: LogicalDatabaseViewPositionItem[] = [];
  const orderItems = new Map<string, DatabaseViewOrderItem>();
  for (const row of rows) {
    if (input.excludedPageIds?.has(row.pageId)) continue;
    const page = pages.get(row.pageId);
    if (!page) throw new Error(`View ${input.viewId} Page is unreadable: ${row.pageId}`);
    const values = propertyValues.get(row.membershipId) ?? {};
    const effectiveGroupKey = groupPropertyId === null
      ? row.positionGroupKey
      : groupKeyForValue(values[groupPropertyId]);
    effectiveGroupKeys.set(row.pageId, effectiveGroupKey);
    if (
      groupPropertyId !== null
      && row.rankKey !== null
      && row.positionGroupKey !== effectiveGroupKey
      && !input.positionConsistencyExemptPageIds?.has(row.pageId)
    ) {
      throw new Error(
        `View ${input.viewId} position for Page ${row.pageId} diverges from its grouping property`,
      );
    }
    if (effectiveGroupKey !== input.groupKey) continue;
    items.push({ pageId: row.pageId, rankKey: row.rankKey });
    orderItems.set(row.pageId, {
      pageId: row.pageId,
      title: page.title,
      createdAt: page.createdAt,
      rankKey: row.rankKey,
      propertyValues: values,
    });
  }
  return {
    items: items.sort((left, right) => {
      const leftOrder = orderItems.get(left.pageId);
      const rightOrder = orderItems.get(right.pageId);
      if (!leftOrder || !rightOrder) {
        throw new Error(`View ${input.viewId} order item disappeared during query`);
      }
      return compareDatabaseViewOrderItems(leftOrder, rightOrder, input.sort);
    }),
    effectiveGroupKeys,
  };
};
