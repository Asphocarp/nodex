import type Database from "better-sqlite3";
import type { CardDocumentMaterialization } from "../../shared/block-documents/block-document-codec";
import type { DocumentId } from "../../shared/block-documents/contracts";

export interface PersistCardDocumentMaterializationInput {
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly projectedSeq: number;
  readonly materialization: CardDocumentMaterialization;
  readonly updatedAt?: string;
}

export class DocumentMaterializationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentMaterializationStoreError";
  }
}

const requirePositiveInteger = (value: number, fieldName: string): number => {
  if (Number.isSafeInteger(value) && value >= 1) return value;
  throw new DocumentMaterializationStoreError(
    `${fieldName} must be at least 1`,
  );
};

const requireNonNegativeInteger = (
  value: number,
  fieldName: string,
): number => {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new DocumentMaterializationStoreError(
    `${fieldName} must be non-negative`,
  );
};

const requireNonEmpty = (value: string, fieldName: string): string => {
  if (value.trim().length > 0) return value;
  throw new DocumentMaterializationStoreError(`${fieldName} must not be empty`);
};

/**
 * Persist every rebuildable Card content projection in one SQLite statement.
 * Callers own the surrounding authority transaction, so a committed Document
 * head and its materialization cannot become visible independently.
 */
export const persistCardDocumentMaterialization = (
  database: Database.Database,
  input: PersistCardDocumentMaterializationInput,
): void => {
  const documentId = requireNonEmpty(input.documentId, "documentId");
  const generation = requirePositiveInteger(input.generation, "generation");
  const projectedSeq = requireNonNegativeInteger(
    input.projectedSeq,
    "projectedSeq",
  );
  const schemaVersion = requirePositiveInteger(
    input.materialization.schemaVersion,
    "materialization.schemaVersion",
  );
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  database
    .prepare(
      `
    INSERT INTO document_materializations (
      document_id, generation, projected_seq, schema_version, title,
      nfm, plain_text, preview, block_tree_json, references_json,
      asset_refs_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET
      generation = excluded.generation,
      projected_seq = excluded.projected_seq,
      schema_version = excluded.schema_version,
      title = excluded.title,
      nfm = excluded.nfm,
      plain_text = excluded.plain_text,
      preview = excluded.preview,
      block_tree_json = excluded.block_tree_json,
      references_json = excluded.references_json,
      asset_refs_json = excluded.asset_refs_json,
      updated_at = excluded.updated_at
  `,
    )
    .run(
      documentId,
      generation,
      projectedSeq,
      schemaVersion,
      input.materialization.title,
      input.materialization.nfm,
      input.materialization.plainText,
      input.materialization.preview,
      JSON.stringify(input.materialization.blockTree),
      JSON.stringify(input.materialization.references),
      JSON.stringify(input.materialization.assetRefs),
      updatedAt,
    );
};
