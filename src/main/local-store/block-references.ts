import type Database from "better-sqlite3";
import type { CardReferenceReadModel } from "../../shared/block-references";
import { readCardSummaryById } from "./cards";
import { getDb } from "./database";

const MAX_BLOCK_ID_LENGTH = 512;

export class BlockReferenceStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockReferenceStoreError";
  }
}

interface ReferenceTargetRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly document_id: string | null;
  readonly generation: number | null;
  readonly head_seq: number | null;
  readonly readiness: "pending_genesis" | "ready" | "failed" | null;
  readonly authority: "legacy_shadow" | "ydoc_primary" | null;
  readonly schema_key: string | null;
  readonly schema_version: number | null;
}

const requireBlockId = (value: string): string => {
  if (
    value.length > 0
    && value.length <= MAX_BLOCK_ID_LENGTH
    && value === value.trim()
  ) {
    return value;
  }
  throw new BlockReferenceStoreError("targetBlockId is invalid");
};

export const resolveCardReference = (
  targetBlockId: string,
  database: Database.Database = getDb(),
): CardReferenceReadModel => {
  const canonicalTargetBlockId = requireBlockId(targetBlockId);
  const row = database.prepare(`
    SELECT
      target.id,
      target.project_id,
      target.type,
      target.lifecycle,
      document.id AS document_id,
      document.generation,
      document.head_seq,
      document.readiness,
      document.authority,
      document.schema_key,
      document.schema_version
    FROM blocks target
    LEFT JOIN block_documents ownership ON ownership.block_id = target.id
    LEFT JOIN documents document ON document.id = ownership.document_id
    WHERE target.id = ?
    LIMIT 1
  `).get(canonicalTargetBlockId) as ReferenceTargetRow | undefined;

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
  const summary = readCardSummaryById(canonicalTargetBlockId, database);
  if (
    !summary
    || !row.document_id
    || row.generation === null
    || row.head_seq === null
    || !row.readiness
    || !row.authority
    || !row.schema_key
    || row.schema_version === null
  ) {
    throw new BlockReferenceStoreError(
      `Card reference ${canonicalTargetBlockId} has an incomplete read model`,
    );
  }

  return {
    status: "available",
    targetBlockId: canonicalTargetBlockId,
    projectId: row.project_id,
    lifecycle: row.lifecycle,
    summary,
    document: {
      documentId: row.document_id,
      generation: row.generation,
      headSeq: row.head_seq,
      readiness: row.readiness,
      authority: row.authority,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
    },
  };
};
