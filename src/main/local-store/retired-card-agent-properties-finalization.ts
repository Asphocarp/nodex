import type Database from "better-sqlite3";

import { rebuildCardReadModelProjection } from "./card-read-store";

const RETIRED_PROPERTY_KEYS = ["agent.blocked", "agent.status"] as const;

interface CardIdentityRow {
  readonly id: string;
  readonly project_id: string;
}

interface ResidualProjectionRow {
  readonly card_block_id: string;
}

export interface RetiredCardAgentPropertiesFinalizationOptions {
  readonly faultInjector?: (
    point: "after_authority_cleanup" | "after_projection_rebuild",
  ) => void;
}

export interface RetiredCardAgentPropertiesFinalizationResult {
  readonly deletedProperties: number;
  readonly rebuiltCards: number;
}

/**
 * Retire the former Card-owned Agent state without manufacturing domain
 * revisions or change-log evidence. The schema migration owns the surrounding
 * immediate transaction so cleanup and version publication remain atomic.
 */
export const finalizeRetiredCardAgentProperties = (
  database: Database.Database,
  options: RetiredCardAgentPropertiesFinalizationOptions = {},
): RetiredCardAgentPropertiesFinalizationResult => {
  if (!database.inTransaction) {
    throw new Error(
      "Retired Card Agent property finalization requires an active writer transaction",
    );
  }

  const deletion = database.prepare(`
    DELETE FROM block_properties
    WHERE property_key IN (?, ?)
  `).run(...RETIRED_PROPERTY_KEYS);
  options.faultInjector?.("after_authority_cleanup");

  const cards = database.prepare(`
    SELECT id, project_id
    FROM blocks
    WHERE type = 'card'
    ORDER BY project_id, id
  `).all() as CardIdentityRow[];
  const cardIdsByProject = new Map<string, string[]>();
  for (const card of cards) {
    const cardIds = cardIdsByProject.get(card.project_id) ?? [];
    cardIds.push(card.id);
    cardIdsByProject.set(card.project_id, cardIds);
  }
  for (const [projectId, cardIds] of cardIdsByProject) {
    rebuildCardReadModelProjection(database, projectId, cardIds);
  }
  options.faultInjector?.("after_projection_rebuild");

  const residualAuthority = database.prepare(`
    SELECT block_id
    FROM block_properties
    WHERE property_key IN (?, ?)
    LIMIT 1
  `).get(...RETIRED_PROPERTY_KEYS) as { readonly block_id: string } | undefined;
  if (residualAuthority) {
    throw new Error(
      `Retired Card Agent property remains on Block ${residualAuthority.block_id}`,
    );
  }

  const residualProjection = database.prepare(`
    SELECT read_model.card_block_id
    FROM card_read_model read_model
    WHERE EXISTS (
      SELECT 1
      FROM json_each(read_model.intrinsic_properties_json) property
      WHERE property.key IN (?, ?)
    ) OR EXISTS (
      SELECT 1
      FROM json_each(
        json_extract(read_model.property_revisions_json, '$.intrinsic')
      ) property_revision
      WHERE property_revision.key IN (?, ?)
    )
    LIMIT 1
  `).get(
    ...RETIRED_PROPERTY_KEYS,
    ...RETIRED_PROPERTY_KEYS,
  ) as ResidualProjectionRow | undefined;
  if (residualProjection) {
    throw new Error(
      `Retired Card Agent projection remains for Card ${residualProjection.card_block_id}`,
    );
  }

  return {
    deletedProperties: deletion.changes,
    rebuiltCards: cards.length,
  };
};
