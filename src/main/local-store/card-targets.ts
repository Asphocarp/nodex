import type Database from "better-sqlite3";
import type { CardTargetReadModel } from "../../shared/card-targets";
import { readCardContentSummary } from "./database-query";
import { getDb } from "./database";

const MAX_BLOCK_ID_LENGTH = 512;

export class CardTargetStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardTargetStoreError";
  }
}

interface CardTargetRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly document_id: string | null;
  readonly readiness: "pending_genesis" | "ready" | "failed" | null;
  readonly schema_key: string | null;
  readonly schema_version: number | null;
}

const requireBlockId = (value: string): string => {
  if (
    value.length > 0 &&
    value.length <= MAX_BLOCK_ID_LENGTH &&
    value === value.trim()
  ) {
    return value;
  }
  throw new CardTargetStoreError("targetBlockId is invalid");
};

/** Resolve one Card identity without assuming it belongs to any Database. */
export const resolveCardTarget = (
  targetBlockId: string,
  database: Database.Database = getDb(),
): CardTargetReadModel => {
  const canonicalTargetBlockId = requireBlockId(targetBlockId);
  return database.transaction((): CardTargetReadModel => {
    const row = database.prepare(`
      SELECT
        target.id,
        target.project_id,
        target.type,
        target.lifecycle,
        document.id AS document_id,
        document.readiness,
        document.schema_key,
        document.schema_version
      FROM blocks target
      LEFT JOIN block_documents ownership ON ownership.block_id = target.id
      LEFT JOIN documents document ON document.id = ownership.document_id
      WHERE target.id = ?
      LIMIT 1
    `).get(canonicalTargetBlockId) as CardTargetRow | undefined;

    if (!row) {
      return { status: "missing", targetBlockId: canonicalTargetBlockId };
    }
    if (row.type !== "card") {
      return {
        status: "invalid_target",
        targetBlockId: canonicalTargetBlockId,
        actualBlockType: row.type,
      };
    }
    if (row.lifecycle === "deleted") {
      return {
        status: "deleted",
        targetBlockId: canonicalTargetBlockId,
        projectId: row.project_id,
      };
    }

    const card = readCardContentSummary(
      row.project_id,
      canonicalTargetBlockId,
      database,
    );
    if (
      !card ||
      card.documentId !== row.document_id ||
      !row.readiness ||
      !row.schema_key ||
      row.schema_version === null
    ) {
      throw new CardTargetStoreError(
        `Card target ${canonicalTargetBlockId} has an incomplete content read model`,
      );
    }
    if (card.lifecycle === "deleted") {
      throw new CardTargetStoreError(
        `Card target ${canonicalTargetBlockId} changed lifecycle while resolving`,
      );
    }

    return {
      status: "available",
      targetBlockId: canonicalTargetBlockId,
      card: { ...card, lifecycle: card.lifecycle },
      document: {
        readiness: row.readiness,
        schemaKey: row.schema_key,
        schemaVersion: row.schema_version,
      },
    };
  })();
};
