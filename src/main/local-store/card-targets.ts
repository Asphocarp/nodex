import type Database from "better-sqlite3";
import type { CardTargetReadModel } from "../../shared/card-targets";
import type {
  CardTargetChangedEvent,
  CardTargetChangeKind,
} from "../../shared/card-target-events";
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

interface CardTargetDocumentCoordinateRow {
  readonly block_id: string;
  readonly project_id: string;
  readonly document_id: string;
  readonly generation: number;
  readonly head_seq: number;
}

/** Map a committed Card Document head to its target invalidation coordinate. */
export const readCardTargetContentChangedEvent = (
  database: Database.Database,
  documentId: string,
): CardTargetChangedEvent | null => {
  const row = database.prepare(`
    SELECT owner.id AS block_id,
           owner.project_id,
           document.id AS document_id,
           document.generation,
           document.head_seq
    FROM documents document
    JOIN block_documents ownership ON ownership.document_id = document.id
    JOIN blocks owner ON owner.id = ownership.block_id
      AND owner.project_id = ownership.project_id
    WHERE document.id = ? AND owner.type = 'card'
    LIMIT 1
  `).get(documentId) as CardTargetDocumentCoordinateRow | undefined;
  if (!row) return null;
  return {
    projectId: row.project_id,
    targetBlockId: row.block_id,
    changeKind: "content",
    document: {
      id: row.document_id,
      generation: row.generation,
      headSeq: row.head_seq,
    },
  };
};

export const readCardTargetChangedEvent = (
  database: Database.Database,
  targetBlockId: string,
  changeKind: Exclude<CardTargetChangeKind, "content">,
): CardTargetChangedEvent | null => {
  const row = database.prepare(`
    SELECT id AS block_id, project_id
    FROM blocks
    WHERE id = ? AND type = 'card'
    LIMIT 1
  `).get(targetBlockId) as
    | { readonly block_id: string; readonly project_id: string }
    | undefined;
  if (!row) return null;
  return {
    projectId: row.project_id,
    targetBlockId: row.block_id,
    changeKind,
  };
};

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
