import type Database from "better-sqlite3";
import type {
  CanvasSceneMaterialization,
  DocumentId,
} from "../../shared/block-documents";
import {
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  parseCanvasSceneMaterialization,
} from "../../shared/block-documents";

export interface PersistCanvasSceneMaterializationInput {
  readonly documentId: DocumentId;
  readonly ownerBlockId: string;
  readonly projectId: string;
  readonly generation: number;
  readonly projectedSeq: number;
  readonly materialization: CanvasSceneMaterialization;
  readonly updatedAt?: string;
}

export interface StoredCanvasSceneMaterialization {
  readonly documentId: DocumentId;
  readonly ownerBlockId: string;
  readonly projectId: string;
  readonly generation: number;
  readonly projectedSeq: number;
  readonly schemaVersion: number;
  readonly materialization: CanvasSceneMaterialization;
  readonly updatedAt: string;
}

export class CanvasSceneMaterializationStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CanvasSceneMaterializationStoreError";
  }
}

interface StoredCanvasSceneMaterializationRow {
  readonly document_id: string;
  readonly owner_block_id: string;
  readonly project_id: string;
  readonly generation: number;
  readonly projected_seq: number;
  readonly schema_version: number;
  readonly elements_json: string;
  readonly app_state_json: string;
  readonly files_json: string;
  readonly card_refs_json: string;
  readonly plain_text: string;
  readonly preview: string;
  readonly updated_at: string;
}

const requireInteger = (
  value: number,
  field: string,
  minimum: number,
): number => {
  if (Number.isSafeInteger(value) && value >= minimum) return value;
  throw new CanvasSceneMaterializationStoreError(
    `${field} must be a safe integer >= ${minimum}`,
  );
};

const requireIdentity = (value: string, field: string): string => {
  if (value.length > 0 && value === value.trim()) return value;
  throw new CanvasSceneMaterializationStoreError(
    `${field} must be a canonical non-empty identity`,
  );
};

const parseJson = (value: string, field: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new CanvasSceneMaterializationStoreError(
      `Stored Canvas ${field} is invalid JSON`,
      { cause: error },
    );
  }
};

export const persistCanvasSceneMaterialization = (
  database: Database.Database,
  input: PersistCanvasSceneMaterializationInput,
): void => {
  const documentId = requireIdentity(input.documentId, "documentId");
  const ownerBlockId = requireIdentity(input.ownerBlockId, "ownerBlockId");
  const projectId = requireIdentity(input.projectId, "projectId");
  const generation = requireInteger(input.generation, "generation", 1);
  const projectedSeq = requireInteger(
    input.projectedSeq,
    "projectedSeq",
    0,
  );
  const schemaVersion = requireInteger(
    input.materialization.schemaVersion,
    "schemaVersion",
    1,
  );
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO canvas_scene_materializations (
        document_id, owner_block_id, project_id,
        generation, projected_seq, schema_version,
        elements_json, app_state_json, files_json, card_refs_json,
        plain_text, preview, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET
        owner_block_id = excluded.owner_block_id,
        project_id = excluded.project_id,
        generation = excluded.generation,
        projected_seq = excluded.projected_seq,
        schema_version = excluded.schema_version,
        elements_json = excluded.elements_json,
        app_state_json = excluded.app_state_json,
        files_json = excluded.files_json,
        card_refs_json = excluded.card_refs_json,
        plain_text = excluded.plain_text,
        preview = excluded.preview,
        updated_at = excluded.updated_at
    `,
    )
    .run(
      documentId,
      ownerBlockId,
      projectId,
      generation,
      projectedSeq,
      schemaVersion,
      JSON.stringify(input.materialization.elements),
      JSON.stringify(input.materialization.appState),
      JSON.stringify(input.materialization.files),
      JSON.stringify(input.materialization.cardReferences),
      input.materialization.plainText,
      input.materialization.preview,
      updatedAt,
    );
};

export const readCanvasSceneMaterialization = (
  database: Database.Database,
  documentIdInput: DocumentId,
): StoredCanvasSceneMaterialization | null => {
  const documentId = requireIdentity(documentIdInput, "documentId");
  const row = database
    .prepare(
      `
      SELECT document_id, owner_block_id, project_id,
        generation, projected_seq, schema_version,
        elements_json, app_state_json, files_json, card_refs_json,
        plain_text, preview, updated_at
      FROM canvas_scene_materializations
      WHERE document_id = ?
    `,
    )
    .get(documentId) as StoredCanvasSceneMaterializationRow | undefined;
  if (!row) return null;
  const elements = parseJson(row.elements_json, "elements");
  const appState = parseJson(row.app_state_json, "appState");
  const files = parseJson(row.files_json, "files");
  const cardReferences = parseJson(row.card_refs_json, "card references");
  if (row.schema_version !== CANVAS_DOCUMENT_SCHEMA_VERSION) {
    throw new CanvasSceneMaterializationStoreError(
      `Stored Canvas materialization ${documentId} uses unsupported schema ${row.schema_version}`,
    );
  }
  let materialization: CanvasSceneMaterialization;
  try {
    materialization = parseCanvasSceneMaterialization({
      documentId,
      value: {
        kind: "canvas_scene",
        schemaVersion: row.schema_version,
        elements,
        appState,
        files,
        cardReferences,
        plainText: row.plain_text,
        preview: row.preview,
      },
    });
  } catch (error) {
    throw new CanvasSceneMaterializationStoreError(
      `Stored Canvas materialization ${documentId} is corrupt`,
      { cause: error },
    );
  }
  return {
    documentId,
    ownerBlockId: requireIdentity(row.owner_block_id, "ownerBlockId"),
    projectId: requireIdentity(row.project_id, "projectId"),
    generation: requireInteger(row.generation, "generation", 1),
    projectedSeq: requireInteger(row.projected_seq, "projectedSeq", 0),
    schemaVersion: requireInteger(row.schema_version, "schemaVersion", 1),
    materialization,
    updatedAt: row.updated_at,
  };
};
