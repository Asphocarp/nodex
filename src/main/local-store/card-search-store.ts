import type Database from "better-sqlite3";
import { isCardStatus } from "../../shared/card-status";
import type { CardSearchInput, CardSearchResult } from "../../shared/types";
import { searchDocumentBlockUnits } from "./block-document-projections";

const MAX_CARD_SEARCH_RESULTS = 100;
const MAX_DOCUMENT_HITS_PER_PROJECT = 200;

interface SearchableCardStatusRow {
  readonly project_id: string;
  readonly card_block_id: string;
  readonly value_json: string;
  readonly view_id: string;
  readonly position_view_id: string | null;
  readonly group_key: string | null;
}

interface CandidateHit {
  readonly projectId: string;
  readonly cardId: string;
  readonly excerpt: string;
  readonly rank: number;
}

const requireProjectId = (value: string): string => {
  const projectId = value.trim();
  if (projectId) return projectId;
  throw new TypeError("Card search requires non-empty Project IDs");
};

const clampLimit = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(Math.trunc(value), MAX_CARD_SEARCH_RESULTS));
};

const readSearchableStatuses = (
  database: Database.Database,
  cardIds: readonly string[],
): ReadonlyMap<string, CardSearchResult["status"]> => {
  if (cardIds.length === 0) return new Map();
  const placeholders = cardIds.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `
      SELECT
        membership.project_id,
        membership.card_block_id,
        value.value_json,
        view.id AS view_id,
        position.view_id AS position_view_id,
        position.group_key
      FROM database_memberships membership
      INNER JOIN blocks card
        ON card.id = membership.card_block_id
        AND card.project_id = membership.project_id
        AND card.type = 'card'
        AND card.lifecycle = 'active'
      INNER JOIN database_properties property
        ON property.database_block_id = membership.database_block_id
        AND property.project_id = membership.project_id
        AND property.key = 'status'
        AND property.lifecycle = 'active'
      INNER JOIN database_property_values value
        ON value.membership_id = membership.id
        AND value.property_id = property.id
        AND value.database_block_id = membership.database_block_id
        AND value.project_id = membership.project_id
      INNER JOIN database_views view
        ON view.database_block_id = membership.database_block_id
        AND view.project_id = membership.project_id
        AND view.kind = 'kanban'
        AND view.is_primary = 1
        AND view.lifecycle = 'active'
      LEFT JOIN database_view_positions position
        ON position.view_id = view.id
        AND position.project_id = view.project_id
        AND position.block_id = membership.card_block_id
      WHERE membership.removed_at IS NULL
        AND membership.card_block_id IN (${placeholders})
    `,
    )
    .all(...cardIds) as readonly SearchableCardStatusRow[];

  const statuses = new Map<string, CardSearchResult["status"]>();
  for (const row of rows) {
    let value: unknown;
    try {
      value = JSON.parse(row.value_json) as unknown;
    } catch {
      continue;
    }
    if (!isCardStatus(value)) continue;
    if (
      row.position_view_id !== null &&
      (row.position_view_id !== row.view_id || row.group_key !== value)
    ) {
      continue;
    }
    statuses.set(JSON.stringify([row.project_id, row.card_block_id]), value);
  }
  return statuses;
};

/**
 * Search current Card Document title/body units and attach the Card's current
 * Database status without reading either legacy content or metadata columns.
 */
export const searchAuthoritativeCards = (
  database: Database.Database,
  input: CardSearchInput,
): CardSearchResult[] => {
  const query = input.query.trim();
  if (!query) return [];
  const projectIds = Array.from(
    new Set(input.projectIds.map(requireProjectId)),
  );
  if (projectIds.length === 0) return [];
  const limit = clampLimit(input.limit);

  return database.transaction(() => {
    const bestHitByCard = new Map<string, CandidateHit>();
    for (const projectId of projectIds) {
      const hits = searchDocumentBlockUnits(database, {
        projectId,
        query,
        limit: MAX_DOCUMENT_HITS_PER_PROJECT,
      });
      for (const hit of hits) {
        const key = JSON.stringify([hit.projectId, hit.ownerBlockId]);
        const existing = bestHitByCard.get(key);
        if (existing && existing.rank <= hit.rank) continue;
        bestHitByCard.set(key, {
          projectId: hit.projectId,
          cardId: hit.ownerBlockId,
          excerpt: hit.excerpt,
          rank: hit.rank,
        });
      }
    }

    const candidates = [...bestHitByCard.values()];
    const statuses = readSearchableStatuses(
      database,
      candidates.map((candidate) => candidate.cardId),
    );
    return candidates
      .flatMap((candidate) => {
        const status = statuses.get(
          JSON.stringify([candidate.projectId, candidate.cardId]),
        );
        return status ? [{ ...candidate, status }] : [];
      })
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          left.projectId.localeCompare(right.projectId) ||
          left.cardId.localeCompare(right.cardId),
      )
      .slice(0, limit)
      .map((candidate, index) => ({
        projectId: candidate.projectId,
        cardId: candidate.cardId,
        status: candidate.status,
        score: Math.max(1, 1_000_000 - index),
        excerpt: candidate.excerpt,
      }));
  })();
};
