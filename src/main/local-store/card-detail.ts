import type Database from "better-sqlite3";

import {
  CARD_DETAIL_CONTRACT_VERSION,
  parseCardDetail,
  type CardDetail,
} from "../../shared/card-detail";
import { resolveCardTarget } from "./card-targets";
import { getDb } from "./database";
import { readCardMetadataPropertySnapshotForDetail } from "./card-metadata-property-snapshot";

const MAX_ID_LENGTH = 512;

export type CardDetailStoreErrorCode =
  | "invalid_request"
  | "card_detail_corrupt";

export class CardDetailStoreError extends Error {
  constructor(
    readonly code: CardDetailStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CardDetailStoreError";
  }
}

interface MembershipRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly revision: number;
}

const requireId = (value: string, label: string): string => {
  if (
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    value === value.trim()
  ) {
    return value;
  }
  throw new CardDetailStoreError(
    "invalid_request",
    `${label} must be a canonical non-empty identifier`,
  );
};

const readActiveMemberships = (
  database: Database.Database,
  projectId: string,
  cardBlockId: string,
): readonly MembershipRow[] =>
  database.prepare(`
    SELECT id, database_block_id, revision
    FROM database_memberships
    WHERE project_id = ? AND card_block_id = ? AND removed_at IS NULL
    ORDER BY id
  `).all(projectId, cardBlockId) as readonly MembershipRow[];

/**
 * Read one Card from Block/Document authority without assuming Database
 * membership. Every coordinate is captured under one deferred SQLite read.
 */
export const readCardDetail = (
  projectId: string,
  cardBlockId: string,
  database: Database.Database = getDb(),
): CardDetail | null => {
  const canonicalProjectId = requireId(projectId, "projectId");
  const canonicalCardBlockId = requireId(cardBlockId, "cardBlockId");

  return database.transaction((): CardDetail | null => {
    const target = resolveCardTarget(canonicalCardBlockId, database);
    if (
      target.status === "missing" ||
      target.status === "invalid_target" ||
      target.status === "deleted"
    ) {
      return null;
    }
    if (target.card.projectId !== canonicalProjectId) return null;

    const memberships = readActiveMemberships(
      database,
      canonicalProjectId,
      canonicalCardBlockId,
    );
    if (memberships.length > 1) {
      throw new CardDetailStoreError(
        "card_detail_corrupt",
        `Card ${canonicalCardBlockId} has multiple active Database memberships`,
      );
    }
    const membership = memberships[0] ?? null;
    const location = target.card.location;
    if (location.kind === "database") {
      if (!membership || membership.database_block_id !== location.databaseBlockId) {
        throw new CardDetailStoreError(
          "card_detail_corrupt",
          `Card ${canonicalCardBlockId} Database location has no matching active membership`,
        );
      }
    } else if (membership) {
      throw new CardDetailStoreError(
        "card_detail_corrupt",
        `Card ${canonicalCardBlockId} has an active Database membership outside a Database location`,
      );
    }

    try {
      return parseCardDetail({
        version: CARD_DETAIL_CONTRACT_VERSION,
        card: target.card,
        document: target.document,
        properties: readCardMetadataPropertySnapshotForDetail(
          database,
          canonicalProjectId,
          canonicalCardBlockId,
        ),
        databaseContext: membership
          ? {
              kind: "member",
              membership: {
                id: membership.id,
                databaseBlockId: membership.database_block_id,
                revision: membership.revision,
              },
            }
          : { kind: "standalone" },
      });
    } catch (error) {
      if (error instanceof CardDetailStoreError) throw error;
      throw new CardDetailStoreError(
        "card_detail_corrupt",
        `Card ${canonicalCardBlockId} has an invalid detail authority: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }).deferred();
};
