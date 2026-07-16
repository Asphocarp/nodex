import { createHash } from "node:crypto";
import * as fs from "node:fs";
import type Database from "better-sqlite3";
import type {
  BlockId,
  DocumentId,
} from "../../shared/block-documents/contracts";
import type { CanvasSceneFile } from "../../shared/block-documents/canvas-scene";
import {
  getBlockDocumentSchemaAdapter,
  getOwnedDocumentSchemaRegistration,
} from "../../shared/block-documents/document-schema-adapters";
import { parseAssetSource } from "../../shared/assets";
import { tokenizeSearchQuery } from "../../shared/search-text";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  resolveAssetPath,
  resolveAssetPathInRoot,
} from "./assets";
import { readCanvasSceneAuthoritySnapshot } from "./canvas-scene-authority-reader";
import { readCanvasPageReferenceTable } from "./legacy-page-projection-adapter";

const DOCUMENT_PROJECTION_VERSION = 1;
const MAX_SEARCH_LIMIT = 200;
const MAX_ASSET_QUERY_LIMIT = 1_000;
const SEARCH_SNIPPET_START = "\u0001";
const SEARCH_SNIPPET_END = "\u0002";

export type DocumentSecondaryProjectionErrorCode =
  | "document_not_found"
  | "document_not_ready"
  | "projection_source_stale"
  | "projection_source_corrupt";

export class DocumentSecondaryProjectionError extends Error {
  readonly code: DocumentSecondaryProjectionErrorCode;

  constructor(
    code: DocumentSecondaryProjectionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentSecondaryProjectionError";
    this.code = code;
  }
}

export interface ReplaceDocumentSecondaryProjectionInput {
  readonly documentId: DocumentId;
  readonly expectedGeneration?: number;
  readonly expectedProjectedSeq?: number;
  readonly assetsRootPath?: string;
}

export interface DocumentSecondaryProjectionResult {
  readonly projectId: string;
  readonly ownerBlockId: BlockId;
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly projectedSeq: number;
  readonly searchUnitCount: number;
  readonly assetRefCount: number;
}

export interface ProjectDocumentSecondaryProjectionResult {
  readonly projectId: string;
  readonly documentCount: number;
  readonly searchUnitCount: number;
  readonly assetRefCount: number;
}

export interface RepairDocumentSecondaryProjectionsResult {
  readonly inspectedDocuments: number;
  readonly repairedDocuments: number;
  readonly searchUnitCount: number;
  readonly assetRefCount: number;
}

export type DocumentSearchSourceKind =
  | "document_title"
  | "document_block"
  | "document_marker";

export interface SearchDocumentBlockUnitsInput {
  /** Exactly one content scope is required. Project is a legacy projection scope. */
  readonly projectId?: string;
  /** Library scope is canonical for Page discovery. */
  readonly libraryId?: string;
  readonly query: string;
  readonly documentId?: DocumentId;
  readonly ownerBlockId?: BlockId;
  readonly databaseBlockId?: BlockId;
  readonly ownerType?: string;
  readonly includeArchived?: boolean;
  readonly sourceKinds?: readonly Exclude<DocumentSearchSourceKind, "document_marker">[];
  readonly blockTypes?: readonly string[];
  readonly limit?: number;
}

export interface DocumentBlockSearchHit {
  readonly projectId: string;
  readonly ownerBlockId: BlockId;
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly blockType: string;
  readonly generation: number;
  readonly projectedSeq: number;
  readonly sourceKind: DocumentSearchSourceKind;
  readonly fieldKey: "title" | "text";
  readonly excerpt: string;
  readonly rank: number;
}

export interface ListDocumentAssetRefsInput {
  readonly projectId: string;
  readonly documentId?: DocumentId;
  readonly blockId?: BlockId;
  readonly assetUri?: string;
  readonly limit?: number;
}

export interface DocumentAssetRefProjection {
  readonly projectId: string;
  readonly ownerBlockId: BlockId;
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly generation: number;
  readonly projectedSeq: number;
  readonly role: "image" | "attachment" | "canvas_file";
  readonly ordinal: number;
  readonly assetUri: string;
  readonly assetHash: string | null;
}

interface ProjectionSourceRow {
  readonly document_id: string;
  readonly project_id: string;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly generation: number;
  readonly head_seq: number;
  readonly readiness: string;
  readonly owner_block_id: string | null;
  readonly owner_type: string | null;
  readonly materialization_generation: number | null;
  readonly materialization_projected_seq: number | null;
  readonly title: string | null;
  readonly block_tree_json: string | null;
  readonly asset_refs_json: string | null;
  readonly materialization_updated_at: string | null;
}

interface DocumentBlockIndexRow {
  readonly block_id: string;
  readonly parent_block_id: string | null;
  readonly ordinal: number;
  readonly block_type: string;
  readonly text: string;
  readonly projected_seq: number;
}

interface MaterializedBlockCoordinate {
  readonly blockId: BlockId;
  readonly parentBlockId: BlockId | null;
  readonly blockType: string;
}

interface MaterializedAssetRef {
  readonly sourceBlockId: BlockId;
  readonly kind: "image" | "attachment";
  readonly source: string;
}

interface SearchRow {
  readonly project_id: string;
  readonly owner_block_id: string;
  readonly document_id: string;
  readonly block_id: string;
  readonly block_type: string;
  readonly document_generation: number;
  readonly projected_seq: number;
  readonly source_kind: DocumentSearchSourceKind;
  readonly field_key: "title" | "text";
  readonly excerpt: string;
  readonly rank: number;
}

interface AssetRow {
  readonly project_id: string;
  readonly owner_block_id: string;
  readonly document_id: string;
  readonly block_id: string;
  readonly document_generation: number;
  readonly projected_seq: number;
  readonly role: "image" | "attachment" | "canvas_file";
  readonly ordinal: number;
  readonly asset_uri: string;
  readonly asset_hash: string | null;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const requireIdentity = (value: string, fieldName: string): string => {
  if (value.length > 0 && value === value.trim()) return value;
  throw new DocumentSecondaryProjectionError(
    "projection_source_corrupt",
    `${fieldName} must be a canonical non-empty identity`,
  );
};

const requirePositiveInteger = (value: number, fieldName: string): number => {
  if (Number.isSafeInteger(value) && value >= 1) return value;
  throw new DocumentSecondaryProjectionError(
    "projection_source_corrupt",
    `${fieldName} must be at least 1`,
  );
};

const requireNonNegativeInteger = (
  value: number,
  fieldName: string,
): number => {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new DocumentSecondaryProjectionError(
    "projection_source_corrupt",
    `${fieldName} must be non-negative`,
  );
};

const requireExpectedCoordinate = (
  actual: number,
  expected: number | undefined,
  fieldName: "generation" | "projectedSeq",
  documentId: DocumentId,
): void => {
  if (expected === undefined || actual === expected) return;
  throw new DocumentSecondaryProjectionError(
    "projection_source_stale",
    `Document ${documentId} ${fieldName} is ${actual}, expected ${expected}`,
  );
};

const readProjectionSource = (
  database: Database.Database,
  input: ReplaceDocumentSecondaryProjectionInput,
): ProjectionSourceRow => {
  const documentId = requireIdentity(input.documentId, "documentId");
  const row = database
    .prepare(
      `
      SELECT
        document.id AS document_id,
        document.project_id,
        document.schema_key,
        document.schema_version,
        document.generation,
        document.head_seq,
        document.readiness,
        ownership.block_id AS owner_block_id,
        owner.type AS owner_type,
        materialization.generation AS materialization_generation,
        materialization.projected_seq AS materialization_projected_seq,
        materialization.title,
        materialization.block_tree_json,
        materialization.asset_refs_json,
        materialization.updated_at AS materialization_updated_at
      FROM documents document
      LEFT JOIN block_documents ownership
        ON ownership.document_id = document.id
        AND ownership.project_id = document.project_id
      LEFT JOIN blocks owner
        ON owner.id = ownership.block_id
        AND owner.project_id = ownership.project_id
      LEFT JOIN document_materializations materialization
        ON materialization.document_id = document.id
      WHERE document.id = ?
    `,
    )
    .get(documentId) as ProjectionSourceRow | undefined;

  if (!row) {
    throw new DocumentSecondaryProjectionError(
      "document_not_found",
      `Document ${documentId} does not exist`,
    );
  }
  if (row.readiness !== "ready") {
    throw new DocumentSecondaryProjectionError(
      "document_not_ready",
      `Document ${documentId} is not ready for projection`,
    );
  }
  if (row.owner_type === null) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_corrupt",
      `Document ${documentId} has no owner`,
    );
  }
  try {
    getBlockDocumentSchemaAdapter({
      ownerType: row.owner_type,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
    });
  } catch (error) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_corrupt",
      `Document ${documentId} has no registered secondary projector for ${row.owner_type}/${row.schema_key}@${row.schema_version}`,
      { cause: error },
    );
  }
  if (
    row.owner_block_id === null ||
    row.materialization_generation === null ||
    row.materialization_projected_seq === null ||
    row.title === null ||
    row.block_tree_json === null ||
    row.asset_refs_json === null ||
    row.materialization_updated_at === null
  ) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_stale",
      `Document ${documentId} is missing its owner or materialization`,
    );
  }

  requirePositiveInteger(row.generation, "document.generation");
  requireNonNegativeInteger(row.head_seq, "document.headSeq");
  requireExpectedCoordinate(
    row.generation,
    input.expectedGeneration,
    "generation",
    documentId,
  );
  requireExpectedCoordinate(
    row.head_seq,
    input.expectedProjectedSeq,
    "projectedSeq",
    documentId,
  );
  if (
    row.materialization_generation !== row.generation ||
    row.materialization_projected_seq !== row.head_seq
  ) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_stale",
      `Document ${documentId} materialization does not match its durable head`,
    );
  }

  return row;
};

const parseMaterializedBlockCoordinates = (
  documentId: DocumentId,
  blockTreeJson: string,
): readonly MaterializedBlockCoordinate[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blockTreeJson);
  } catch (error) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_corrupt",
      `Document ${documentId} has invalid materialized Block JSON`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_corrupt",
      `Document ${documentId} materialized Block tree must be an array`,
    );
  }

  const coordinates: MaterializedBlockCoordinate[] = [];
  const seen = new Set<string>();
  const pending: {
    readonly value: unknown;
    readonly parentBlockId: string | null;
  }[] = parsed.toReversed().map((value) => ({ value, parentBlockId: null }));
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate) break;
    if (
      typeof candidate.value !== "object" ||
      candidate.value === null ||
      Array.isArray(candidate.value)
    ) {
      throw new DocumentSecondaryProjectionError(
        "projection_source_corrupt",
        `Document ${documentId} contains a malformed materialized Block`,
      );
    }
    const value = candidate.value as Readonly<Record<string, unknown>>;
    const blockId = value.id;
    const blockType = value.type;
    const children = value.children;
    if (
      typeof blockId !== "string" ||
      typeof blockType !== "string" ||
      blockType.length === 0 ||
      !Array.isArray(children)
    ) {
      throw new DocumentSecondaryProjectionError(
        "projection_source_corrupt",
        `Document ${documentId} contains an incomplete materialized Block`,
      );
    }
    requireIdentity(blockId, "materialized blockId");
    if (seen.has(blockId)) {
      throw new DocumentSecondaryProjectionError(
        "projection_source_corrupt",
        `Document ${documentId} repeats Block ${blockId}`,
      );
    }
    seen.add(blockId);
    coordinates.push({
      blockId,
      parentBlockId: candidate.parentBlockId,
      blockType,
    });
    children
      .toReversed()
      .forEach((child) =>
        pending.push({ value: child, parentBlockId: blockId }),
      );
  }
  return coordinates;
};

const parseMaterializedAssetRefs = (
  documentId: DocumentId,
  assetRefsJson: string,
): readonly MaterializedAssetRef[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(assetRefsJson);
  } catch (error) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_corrupt",
      `Document ${documentId} has invalid materialized asset JSON`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_corrupt",
      `Document ${documentId} materialized assets must be an array`,
    );
  }

  return parsed.map((candidate): MaterializedAssetRef => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      throw new DocumentSecondaryProjectionError(
        "projection_source_corrupt",
        `Document ${documentId} contains a malformed asset reference`,
      );
    }
    const value = candidate as Readonly<Record<string, unknown>>;
    if (
      typeof value.sourceBlockId !== "string" ||
      (value.kind !== "image" && value.kind !== "attachment") ||
      typeof value.source !== "string" ||
      value.source.length === 0 ||
      value.source.length > 4_096
    ) {
      throw new DocumentSecondaryProjectionError(
        "projection_source_corrupt",
        `Document ${documentId} contains an invalid asset reference`,
      );
    }
    return {
      sourceBlockId: requireIdentity(
        value.sourceBlockId,
        "asset sourceBlockId",
      ),
      kind: value.kind,
      source: value.source,
    };
  });
};

const readAndValidateBlockIndex = (
  database: Database.Database,
  source: ProjectionSourceRow & {
    readonly materialization_projected_seq: number;
    readonly block_tree_json: string;
  },
): readonly DocumentBlockIndexRow[] => {
  const rows = database
    .prepare(
      `
      SELECT block_id, parent_block_id, ordinal, block_type, text, projected_seq
      FROM document_block_index
      WHERE document_id = ?
      ORDER BY ordinal, block_id
    `,
    )
    .all(source.document_id) as readonly DocumentBlockIndexRow[];
  const coordinates = parseMaterializedBlockCoordinates(
    source.document_id,
    source.block_tree_json,
  );
  if (coordinates.length !== rows.length) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_stale",
      `Document ${source.document_id} Block index does not match its materialization`,
    );
  }

  rows.forEach((row, index) => {
    const expected = coordinates[index];
    if (
      row.ordinal !== index ||
      row.projected_seq !== source.materialization_projected_seq ||
      row.block_id !== expected?.blockId ||
      row.parent_block_id !== expected.parentBlockId ||
      row.block_type !== expected.blockType
    ) {
      throw new DocumentSecondaryProjectionError(
        "projection_source_stale",
        `Document ${source.document_id} Block index diverges at ordinal ${index}`,
      );
    }
  });
  return rows;
};

const documentUnitKey = (
  documentId: DocumentId,
  blockId: BlockId,
  sourceKind: DocumentSearchSourceKind,
  fieldKey: "title" | "text" | "marker",
): string =>
  `document:${sha256(JSON.stringify([documentId, blockId, sourceKind, fieldKey]))}`;

/**
 * Replace every Document-derived secondary row from the current persisted
 * materialization and Block index. The caller owns the authority transaction;
 * projection failure therefore rolls back the Y.Doc head that caused it.
 */
const replaceBlockTreeDocumentSecondaryProjections = (
  database: Database.Database,
  input: ReplaceDocumentSecondaryProjectionInput,
): DocumentSecondaryProjectionResult => {
  const source = readProjectionSource(database, input);
  const ownerBlockId = requireIdentity(
    source.owner_block_id as string,
    "ownerBlockId",
  );
  const generation = source.materialization_generation as number;
  const projectedSeq = source.materialization_projected_seq as number;
  const title = source.title as string;
  const adapter = getBlockDocumentSchemaAdapter({
    ownerType: source.owner_type as string,
    schemaKey: source.schema_key,
    schemaVersion: source.schema_version,
  });
  const updatedAt = source.materialization_updated_at as string;
  const blockRows = readAndValidateBlockIndex(database, {
    ...source,
    materialization_projected_seq: projectedSeq,
    block_tree_json: source.block_tree_json as string,
  });
  const activeBlockIds = new Set(blockRows.map((row) => row.block_id));
  const assetRefs = parseMaterializedAssetRefs(
    source.document_id,
    source.asset_refs_json as string,
  );
  for (const assetRef of assetRefs) {
    if (activeBlockIds.has(assetRef.sourceBlockId)) continue;
    throw new DocumentSecondaryProjectionError(
      "projection_source_stale",
      `Document ${source.document_id} asset references missing Block ${assetRef.sourceBlockId}`,
    );
  }

  database
    .prepare("DELETE FROM block_asset_refs WHERE document_id = ?")
    .run(source.document_id);
  database
    .prepare("DELETE FROM canvas_scene_file_refs WHERE document_id = ?")
    .run(source.document_id);
  database
    .prepare(`DELETE FROM ${readCanvasPageReferenceTable(database)} WHERE document_id = ?`)
    .run(source.document_id);
  database
    .prepare(
      "DELETE FROM block_search_units WHERE document_id = ? AND source_revision IS NULL",
    )
    .run(source.document_id);

  const insertSearchUnit = database.prepare(`
    INSERT INTO block_search_units (
      unit_key, project_id, block_id, owner_block_id, document_id,
      document_generation, projected_seq, source_revision, projection_version,
      source_kind, field_key, text, text_hash, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
  `);
  insertSearchUnit.run(
    documentUnitKey(
      source.document_id,
      ownerBlockId,
      adapter.capabilities.title ? "document_title" : "document_marker",
      adapter.capabilities.title ? "title" : "marker",
    ),
    source.project_id,
    ownerBlockId,
    ownerBlockId,
    source.document_id,
    generation,
    projectedSeq,
    DOCUMENT_PROJECTION_VERSION,
    adapter.capabilities.title ? "document_title" : "document_marker",
    adapter.capabilities.title ? "title" : "marker",
    title,
    sha256(title),
    updatedAt,
  );
  for (const row of blockRows) {
    insertSearchUnit.run(
      documentUnitKey(
        source.document_id,
        row.block_id,
        "document_block",
        "text",
      ),
      source.project_id,
      row.block_id,
      ownerBlockId,
      source.document_id,
      generation,
      projectedSeq,
      DOCUMENT_PROJECTION_VERSION,
      "document_block",
      "text",
      row.text,
      sha256(row.text),
      updatedAt,
    );
  }

  const insertAssetRef = database.prepare(`
    INSERT INTO block_asset_refs (
      document_id, block_id, owner_block_id, project_id,
      document_generation, projected_seq, projection_version,
      role, ordinal, asset_uri, asset_hash, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `);
  const nextOrdinalByBlockAndRole = new Map<string, number>();
  for (const assetRef of assetRefs) {
    const ordinalKey = JSON.stringify([assetRef.sourceBlockId, assetRef.kind]);
    const ordinal = nextOrdinalByBlockAndRole.get(ordinalKey) ?? 0;
    nextOrdinalByBlockAndRole.set(ordinalKey, ordinal + 1);
    insertAssetRef.run(
      source.document_id,
      assetRef.sourceBlockId,
      ownerBlockId,
      source.project_id,
      generation,
      projectedSeq,
      DOCUMENT_PROJECTION_VERSION,
      assetRef.kind,
      ordinal,
      assetRef.source,
      updatedAt,
    );
  }

  return {
    projectId: source.project_id,
    ownerBlockId,
    documentId: source.document_id,
    generation,
    projectedSeq,
    searchUnitCount: blockRows.length + 1,
    assetRefCount: assetRefs.length,
  };
};

interface RegisteredProjectionSourceRow {
  readonly document_id: string;
  readonly project_id: string;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly generation: number;
  readonly head_seq: number;
  readonly sync_engine: "yjs" | "canvas_scene";
  readonly readiness: string;
  readonly owner_block_id: string | null;
  readonly owner_type: string | null;
}

const readRegisteredProjectionSource = (
  database: Database.Database,
  input: ReplaceDocumentSecondaryProjectionInput,
): {
  readonly row: RegisteredProjectionSourceRow & {
    readonly owner_block_id: string;
    readonly owner_type: string;
  };
  readonly contentModel: "block_tree" | "scene_graph";
} => {
  const documentId = requireIdentity(input.documentId, "documentId");
  const row = database
    .prepare(
      `
      SELECT document.id AS document_id, document.project_id,
        document.schema_key, document.schema_version, document.generation,
        document.head_seq, document.sync_engine, document.readiness,
        ownership.block_id AS owner_block_id, owner.type AS owner_type
      FROM documents document
      LEFT JOIN block_documents ownership
        ON ownership.document_id = document.id
        AND ownership.project_id = document.project_id
      LEFT JOIN blocks owner
        ON owner.id = ownership.block_id
        AND owner.project_id = ownership.project_id
      WHERE document.id = ?
    `,
    )
    .get(documentId) as RegisteredProjectionSourceRow | undefined;
  if (!row) {
    throw new DocumentSecondaryProjectionError(
      "document_not_found",
      `Document ${documentId} does not exist`,
    );
  }
  if (row.readiness !== "ready") {
    throw new DocumentSecondaryProjectionError(
      "document_not_ready",
      `Document ${documentId} is not ready for projection`,
    );
  }
  if (row.owner_block_id === null || row.owner_type === null) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_corrupt",
      `Document ${documentId} has no owner`,
    );
  }
  requireExpectedCoordinate(
    row.generation,
    input.expectedGeneration,
    "generation",
    documentId,
  );
  requireExpectedCoordinate(
    row.head_seq,
    input.expectedProjectedSeq,
    "projectedSeq",
    documentId,
  );
  try {
    const adapter = getOwnedDocumentSchemaRegistration({
      ownerType: row.owner_type,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
    });
    if (adapter.syncEngine !== row.sync_engine) {
      throw new DocumentSecondaryProjectionError(
        "projection_source_corrupt",
        `Document ${documentId} stores ${row.sync_engine} but its schema requires ${adapter.syncEngine}`,
      );
    }
    return {
      row: row as RegisteredProjectionSourceRow & {
        readonly owner_block_id: string;
        readonly owner_type: string;
      },
      contentModel: adapter.contentModel,
    };
  } catch (error) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_corrupt",
      `Document ${documentId} has no registered secondary projector for ${row.owner_type}/${row.schema_key}@${row.schema_version}`,
      { cause: error },
    );
  }
};

export interface ExistingCanvasSceneFileProjection {
  readonly file_id: string;
  readonly asset_uri: string;
  readonly managed_file_name: string;
  readonly asset_hash: string;
  readonly byte_length: number;
}

export interface CanvasSceneFileProjectionPlanEntry {
  readonly fileId: string;
  readonly mimeType: string;
  readonly assetUri: string;
  readonly managedFileName: string;
  readonly reusableAssetHash: string | null;
  readonly reusableByteLength: number | null;
  readonly requiresAssetRead: boolean;
}

/** Managed asset names are immutable, so unchanged refs reuse prior evidence. */
export const planCanvasSceneFileProjections = (
  files: Readonly<Record<string, CanvasSceneFile>>,
  existing: readonly ExistingCanvasSceneFileProjection[],
): readonly CanvasSceneFileProjectionPlanEntry[] => {
  const existingByFileId = new Map(existing.map((row) => [row.file_id, row]));
  return Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileId, file]) => {
      const parsed = parseAssetSource(file.source);
      if (!parsed) {
        throw new DocumentSecondaryProjectionError(
          "projection_source_corrupt",
          `Canvas file ${fileId} has no canonical managed asset source`,
        );
      }
      const previous = existingByFileId.get(fileId);
      const reusable = previous?.asset_uri === file.source ? previous : null;
      return {
        fileId,
        mimeType: file.mimeType,
        assetUri: file.source,
        managedFileName: parsed.fileName,
        reusableAssetHash: reusable?.asset_hash ?? null,
        reusableByteLength: reusable?.byte_length ?? null,
        requiresAssetRead: reusable === null,
      };
    });
};

const replaceCanvasSceneSecondaryProjections = (
  database: Database.Database,
  source: RegisteredProjectionSourceRow & {
    readonly owner_block_id: string;
    readonly owner_type: string;
  },
  assetsRootPath?: string,
): DocumentSecondaryProjectionResult => {
  if (source.sync_engine !== "canvas_scene") {
    throw new DocumentSecondaryProjectionError(
      "projection_source_corrupt",
      `Canvas Document ${source.document_id} does not use scene authority`,
    );
  }
  let authority;
  try {
    authority = readCanvasSceneAuthoritySnapshot(database, {
      documentId: source.document_id,
      generation: source.generation,
      headSeq: source.head_seq,
      schemaVersion: source.schema_version,
    });
  } catch (error) {
    throw new DocumentSecondaryProjectionError(
      "projection_source_stale",
      `Canvas Document ${source.document_id} authority does not match its durable head`,
      { cause: error },
    );
  }
  const existingFileProjections = database
    .prepare(
      `
      SELECT file_id, asset_uri, managed_file_name, asset_hash, byte_length
      FROM canvas_scene_file_refs
      WHERE document_id = ?
      ORDER BY file_id
    `,
    )
    .all(source.document_id) as readonly ExistingCanvasSceneFileProjection[];
  const fileProjectionPlan = planCanvasSceneFileProjections(
    authority.scene.files,
    existingFileProjections,
  );
  database
    .prepare("DELETE FROM block_asset_refs WHERE document_id = ?")
    .run(source.document_id);
  database
    .prepare("DELETE FROM canvas_scene_file_refs WHERE document_id = ?")
    .run(source.document_id);
  database
    .prepare(`DELETE FROM ${readCanvasPageReferenceTable(database)} WHERE document_id = ?`)
    .run(source.document_id);
  database
    .prepare(
      "DELETE FROM block_search_units WHERE document_id = ? AND source_revision IS NULL",
    )
    .run(source.document_id);
  database
    .prepare(
      `
      INSERT INTO block_search_units (
        unit_key, project_id, block_id, owner_block_id, document_id,
        document_generation, projected_seq, source_revision,
        projection_version, source_kind, field_key, text, text_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'document_marker', 'marker', ?, ?, ?)
    `,
    )
    .run(
      documentUnitKey(
        source.document_id,
        source.owner_block_id,
        "document_marker",
        "marker",
      ),
      source.project_id,
      source.owner_block_id,
      source.owner_block_id,
      source.document_id,
      source.generation,
      source.head_seq,
      DOCUMENT_PROJECTION_VERSION,
      authority.scene.plainText,
      sha256(authority.scene.plainText),
      authority.updatedAt,
    );
  const insertFile = database.prepare(`
    INSERT INTO canvas_scene_file_refs (
      document_id, file_id, owner_block_id, project_id,
      document_generation, projected_seq, mime_type, asset_uri,
      managed_file_name, asset_hash, byte_length, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const file of fileProjectionPlan) {
    let assetHash = file.reusableAssetHash;
    let byteLength = file.reusableByteLength;
    const assetPath = assetsRootPath
      ? resolveAssetPathInRoot(assetsRootPath, file.managedFileName)
      : resolveAssetPath(file.managedFileName);
    try {
      const stats = fs.lstatSync(assetPath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new TypeError("Managed Canvas asset is not a regular file");
      }
      if (stats.size > MAX_IMAGE_UPLOAD_BYTES) {
        throw new TypeError("Managed Canvas asset exceeds the image limit");
      }
      if (file.requiresAssetRead || stats.size !== byteLength) {
        const bytes = fs.readFileSync(assetPath);
        assetHash = createHash("sha256").update(bytes).digest("hex");
        byteLength = bytes.byteLength;
      }
    } catch (error) {
      throw new DocumentSecondaryProjectionError(
        "projection_source_corrupt",
        `Canvas file ${file.fileId} references missing managed asset ${file.managedFileName}`,
        { cause: error },
      );
    }
    if (assetHash === null || byteLength === null) {
      throw new DocumentSecondaryProjectionError(
        "projection_source_corrupt",
        `Canvas file ${file.fileId} has no durable asset evidence`,
      );
    }
    insertFile.run(
      source.document_id,
      file.fileId,
      source.owner_block_id,
      source.project_id,
      source.generation,
      source.head_seq,
      file.mimeType,
      file.assetUri,
      file.managedFileName,
      assetHash,
      byteLength,
      authority.updatedAt,
    );
  }
  const insertPageReference = database.prepare(`
    INSERT INTO ${readCanvasPageReferenceTable(database)} (
      document_id, source_element_id, target_block_id, owner_block_id,
      project_id, document_generation, projected_seq, title_hint, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const reference of authority.scene.pageReferences) {
    insertPageReference.run(
      source.document_id,
      reference.sourceElementId,
      reference.targetBlockId,
      source.owner_block_id,
      source.project_id,
      source.generation,
      source.head_seq,
      reference.titleHint ?? null,
      authority.updatedAt,
    );
  }
  return {
    projectId: source.project_id,
    ownerBlockId: source.owner_block_id,
    documentId: source.document_id,
    generation: source.generation,
    projectedSeq: source.head_seq,
    searchUnitCount: 1,
    assetRefCount: Object.keys(authority.scene.files).length,
  };
};

/** Dispatch secondary projections without routing scene Documents through NFM. */
export const replaceDocumentSecondaryProjections = (
  database: Database.Database,
  input: ReplaceDocumentSecondaryProjectionInput,
): DocumentSecondaryProjectionResult => {
  const source = readRegisteredProjectionSource(database, input);
  if (source.contentModel === "block_tree") {
    return replaceBlockTreeDocumentSecondaryProjections(database, input);
  }
  return replaceCanvasSceneSecondaryProjections(
    database,
    source.row,
    input.assetsRootPath,
  );
};

/** Rebuild one disposable projection atomically from SQLite authority. */
export const rebuildDocumentSecondaryProjections = (
  database: Database.Database,
  input: ReplaceDocumentSecondaryProjectionInput,
): DocumentSecondaryProjectionResult =>
  database
    .transaction(() => replaceDocumentSecondaryProjections(database, input))
    .immediate();

/**
 * Rebuild all ready registered Document projections in a Project. Non-Document
 * search units remain untouched for later property/intrinsic projectors.
 */
export const rebuildProjectDocumentSecondaryProjections = (
  database: Database.Database,
  projectIdInput: string,
): ProjectDocumentSecondaryProjectionResult => {
  const projectId = requireIdentity(projectIdInput, "projectId");
  return database
    .transaction(() => {
      const documentIds = database
        .prepare(
          `
        SELECT id
        FROM documents
        WHERE project_id = ? AND readiness = 'ready'
        ORDER BY id
      `,
        )
        .all(projectId) as readonly { readonly id: string }[];
      database
        .prepare(
          `
        DELETE FROM block_asset_refs
        WHERE project_id = ?
          AND document_id IN (
            SELECT id FROM documents
            WHERE project_id = ?
          )
        `,
        )
        .run(projectId, projectId);
      database
        .prepare("DELETE FROM canvas_scene_file_refs WHERE project_id = ?")
        .run(projectId);
      database
        .prepare(`DELETE FROM ${readCanvasPageReferenceTable(database)} WHERE project_id = ?`)
        .run(projectId);
      database
        .prepare(
          `
        DELETE FROM block_search_units
        WHERE project_id = ? AND document_id IS NOT NULL
          AND document_id IN (
            SELECT id FROM documents
            WHERE project_id = ?
          )
      `,
        )
        .run(projectId, projectId);

      const results = documentIds.map(({ id }) =>
        replaceDocumentSecondaryProjections(database, { documentId: id }),
      );
      return {
        projectId,
        documentCount: results.length,
        searchUnitCount: results.reduce(
          (total, result) => total + result.searchUnitCount,
          0,
        ),
        assetRefCount: results.reduce(
          (total, result) => total + result.assetRefCount,
          0,
        ),
      };
    })
    .immediate();
};

/**
 * Backfill or repair ready registered Documents whose current marker is
 * absent. The marker is written atomically with every block/asset row, so one
 * current marker proves the whole secondary projection commit completed.
 */
export const repairDocumentSecondaryProjections = (
  database: Database.Database,
  options: { readonly assetsRootPath?: string } = {},
): RepairDocumentSecondaryProjectionsResult =>
  database
    .transaction(() => {
      const documents = database
        .prepare(
          `
          SELECT document.id, document.schema_key, document.schema_version,
            document.sync_engine, owner.type AS owner_type, marker.unit_key
          FROM documents document
          INNER JOIN block_documents ownership
            ON ownership.document_id = document.id
            AND ownership.project_id = document.project_id
          INNER JOIN blocks owner
            ON owner.id = ownership.block_id
            AND owner.project_id = ownership.project_id
          LEFT JOIN block_search_units marker
            ON marker.document_id = document.id
            AND marker.owner_block_id = ownership.block_id
            AND marker.block_id = ownership.block_id
            AND marker.source_kind IN ('document_title', 'document_marker')
            AND marker.field_key IN ('title', 'marker')
            AND marker.document_generation = document.generation
            AND marker.projected_seq = document.head_seq
          WHERE document.readiness = 'ready'
          ORDER BY document.id
        `,
        )
        .all() as readonly {
        readonly id: string;
        readonly schema_key: string;
        readonly schema_version: number;
        readonly sync_engine: "yjs" | "canvas_scene";
        readonly owner_type: string;
        readonly unit_key: string | null;
      }[];
      const repairs = documents
        .filter((document) => {
          if (document.unit_key !== null) return false;
          const adapter = getOwnedDocumentSchemaRegistration({
            ownerType: document.owner_type,
            schemaKey: document.schema_key,
            schemaVersion: document.schema_version,
          });
          return adapter.syncEngine === document.sync_engine;
        })
        .map((document) =>
          replaceDocumentSecondaryProjections(database, {
            documentId: document.id,
            assetsRootPath: options.assetsRootPath,
          }),
        );
      return {
        inspectedDocuments: documents.length,
        repairedDocuments: repairs.length,
        searchUnitCount: repairs.reduce(
          (total, repair) => total + repair.searchUnitCount,
          0,
        ),
        assetRefCount: repairs.reduce(
          (total, repair) => total + repair.assetRefCount,
          0,
        ),
      };
    })
    .immediate();

const buildDocumentFtsMatchQuery = (query: string): string | null => {
  const tokens = tokenizeSearchQuery(query)
    .flatMap((token) => token.match(/[\p{L}\p{N}_\-/@.:#]+/gu) ?? [])
    .map((token) => token.trim().toLowerCase())
    .filter(
      (token, index, values) =>
        token.length > 0 && values.indexOf(token) === index,
    );
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(" ");
};

const clampLimit = (
  value: number | undefined,
  fallback: number,
  maximum: number,
): number => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), maximum));
};

/** Search only fresh Document-derived Block units within one explicit scope. */
export const searchDocumentBlockUnits = (
  database: Database.Database,
  input: SearchDocumentBlockUnitsInput,
): readonly DocumentBlockSearchHit[] => {
  const hasProjectScope = input.projectId !== undefined;
  const hasLibraryScope = input.libraryId !== undefined;
  if (hasProjectScope === hasLibraryScope) {
    throw new TypeError(
      "Document search requires exactly one Project or Library scope",
    );
  }
  const matchQuery = buildDocumentFtsMatchQuery(input.query.trim());
  if (!matchQuery) return [];
  const conditions = [
    "block_search_units_fts MATCH ?",
    "unit.document_id IS NOT NULL",
    "unit.source_kind IN ('document_title', 'document_block', 'document_marker')",
    "document.readiness = 'ready'",
    "document.generation = unit.document_generation",
    "document.head_seq = unit.projected_seq",
    "source.lifecycle <> 'deleted'",
    "owner.lifecycle <> 'deleted'",
  ];
  const parameters: (string | number)[] = [matchQuery];
  if (input.projectId !== undefined) {
    conditions.push("unit.project_id = ?");
    parameters.push(requireIdentity(input.projectId, "projectId"));
  } else {
    conditions.push("owner_page.library_id = ?");
    parameters.push(requireIdentity(input.libraryId ?? "", "libraryId"));
  }
  if (input.documentId !== undefined) {
    conditions.push("unit.document_id = ?");
    parameters.push(requireIdentity(input.documentId, "documentId"));
  }
  if (input.ownerBlockId !== undefined) {
    conditions.push("unit.owner_block_id = ?");
    parameters.push(requireIdentity(input.ownerBlockId, "ownerBlockId"));
  }
  if (input.databaseBlockId !== undefined) {
    conditions.push(
      "owner.location_kind = 'database'",
      "owner.containing_database_id = ?",
    );
    parameters.push(requireIdentity(input.databaseBlockId, "databaseBlockId"));
  }
  if (input.ownerType !== undefined) {
    conditions.push("owner.type = ?");
    parameters.push(requireIdentity(input.ownerType, "ownerType"));
  }
  if (input.includeArchived === false) {
    conditions.push("owner.lifecycle = 'active'");
  }
  if (input.sourceKinds !== undefined) {
    const sourceKinds = [...new Set(input.sourceKinds)];
    if (sourceKinds.length === 0) return [];
    conditions.push(`unit.source_kind IN (${sourceKinds.map(() => "?").join(", ")})`);
    parameters.push(...sourceKinds);
  }
  if (input.blockTypes !== undefined) {
    const blockTypes = [...new Set(input.blockTypes.map((type) => requireIdentity(type, "blockType")))];
    if (blockTypes.length === 0) return [];
    conditions.push(`source.type IN (${blockTypes.map(() => "?").join(", ")})`);
    parameters.push(...blockTypes);
  }
  parameters.push(clampLimit(input.limit, 50, MAX_SEARCH_LIMIT));

  const rows = database
    .prepare(
      `
      SELECT
        unit.project_id,
        unit.owner_block_id,
        unit.document_id,
        unit.block_id,
        source.type AS block_type,
        unit.document_generation,
        unit.projected_seq,
        unit.source_kind,
        unit.field_key,
        snippet(
          block_search_units_fts,
          0,
          '${SEARCH_SNIPPET_START}',
          '${SEARCH_SNIPPET_END}',
          '…',
          32
        ) AS excerpt,
        bm25(block_search_units_fts) AS rank
      FROM block_search_units_fts
      INNER JOIN block_search_units unit
        ON unit.rowid = block_search_units_fts.rowid
      INNER JOIN documents document
        ON document.id = unit.document_id
        AND document.project_id = unit.project_id
      INNER JOIN blocks source
        ON source.id = unit.block_id
        AND source.project_id = unit.project_id
      INNER JOIN blocks owner
        ON owner.id = unit.owner_block_id
        AND owner.project_id = unit.project_id
      LEFT JOIN pages owner_page
        ON owner_page.block_id = owner.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY rank, unit.owner_block_id, unit.block_id
      LIMIT ?
    `,
    )
    .all(...parameters) as readonly SearchRow[];

  return rows.map((row) => ({
    projectId: row.project_id,
    ownerBlockId: row.owner_block_id,
    documentId: row.document_id,
    blockId: row.block_id,
    blockType: row.block_type,
    generation: row.document_generation,
    projectedSeq: row.projected_seq,
    sourceKind: row.source_kind,
    fieldKey: row.field_key,
    excerpt: row.excerpt
      .replaceAll(SEARCH_SNIPPET_START, "")
      .replaceAll(SEARCH_SNIPPET_END, "")
      .replace(/\s+/g, " ")
      .trim(),
    rank: row.rank,
  }));
};

/** Read only fresh asset references within an explicit Project scope. */
export const listDocumentAssetRefs = (
  database: Database.Database,
  input: ListDocumentAssetRefsInput,
): readonly DocumentAssetRefProjection[] => {
  const projectId = requireIdentity(input.projectId, "projectId");
  const conditions = [
    "asset.project_id = ?",
    "document.readiness = 'ready'",
    "document.generation = asset.document_generation",
    "document.head_seq = asset.projected_seq",
    "source.lifecycle <> 'deleted'",
    "owner.lifecycle <> 'deleted'",
  ];
  const parameters: (string | number)[] = [projectId];
  if (input.documentId !== undefined) {
    conditions.push("asset.document_id = ?");
    parameters.push(requireIdentity(input.documentId, "documentId"));
  }
  if (input.blockId !== undefined) {
    conditions.push("asset.block_id = ?");
    parameters.push(requireIdentity(input.blockId, "blockId"));
  }
  if (input.assetUri !== undefined) {
    conditions.push("asset.asset_uri = ?");
    parameters.push(input.assetUri);
  }
  parameters.push(clampLimit(input.limit, 200, MAX_ASSET_QUERY_LIMIT));

  const rows = database
    .prepare(
      `
      WITH asset AS (
        SELECT
          project_id, owner_block_id, document_id, block_id,
          document_generation, projected_seq, role, ordinal,
          asset_uri, asset_hash
        FROM block_asset_refs
        UNION ALL
        SELECT
          project_id, owner_block_id, document_id,
          owner_block_id AS block_id, document_generation, projected_seq,
          'canvas_file' AS role,
          ROW_NUMBER() OVER (
            PARTITION BY document_id ORDER BY file_id
          ) - 1 AS ordinal,
          asset_uri, asset_hash
        FROM canvas_scene_file_refs
      )
      SELECT
        asset.project_id,
        asset.owner_block_id,
        asset.document_id,
        asset.block_id,
        asset.document_generation,
        asset.projected_seq,
        asset.role,
        asset.ordinal,
        asset.asset_uri,
        asset.asset_hash
      FROM asset
      INNER JOIN documents document
        ON document.id = asset.document_id
        AND document.project_id = asset.project_id
      INNER JOIN blocks source
        ON source.id = asset.block_id
        AND source.project_id = asset.project_id
      INNER JOIN blocks owner
        ON owner.id = asset.owner_block_id
        AND owner.project_id = asset.project_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY asset.document_id, asset.block_id, asset.role, asset.ordinal
      LIMIT ?
    `,
    )
    .all(...parameters) as readonly AssetRow[];

  return rows.map((row) => ({
    projectId: row.project_id,
    ownerBlockId: row.owner_block_id,
    documentId: row.document_id,
    blockId: row.block_id,
    generation: row.document_generation,
    projectedSeq: row.projected_seq,
    role: row.role,
    ordinal: row.ordinal,
    assetUri: row.asset_uri,
    assetHash: row.asset_hash,
  }));
};
