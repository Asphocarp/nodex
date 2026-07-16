import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

import {
  canonicalStringifyCanvasScene,
  materializePortableCanvasScene,
  parsePortableCanvasScene,
  type PortableCanvasScene,
} from "../../shared/block-documents/canvas-scene";
import { readCanvasSceneAuthorityHashEvidence } from "./canvas-scene-authority-reader";

interface CanvasDocumentHashRow {
  readonly document_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_version: number;
  readonly state_hash: string;
}

interface CanvasCheckpointRow {
  readonly version_id: string;
  readonly full_update_blob: Buffer;
  readonly checkpoint_hash: string;
  readonly byte_length: number;
}

export interface CanvasPageReferenceHashMigrationResult {
  readonly liveSceneCount: number;
  readonly checkpointCount: number;
}

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const legacyReferenceFingerprint = (scene: PortableCanvasScene): string =>
  canonicalStringifyCanvasScene({
    schemaVersion: scene.schemaVersion,
    elements: scene.elements,
    appState: scene.appState,
    files: scene.files,
    cardReferences: scene.pageReferences,
  });

const legacyCheckpointShape = (
  scene: PortableCanvasScene,
): Readonly<Record<string, unknown>> => ({
  kind: scene.kind,
  schemaVersion: scene.schemaVersion,
  elements: scene.elements,
  appState: scene.appState,
  files: scene.files,
  cardReferences: scene.pageReferences,
  plainText: scene.plainText,
  preview: scene.preview,
});

const parseCheckpoint = (
  row: CanvasCheckpointRow,
): { readonly scene: PortableCanvasScene; readonly legacy: boolean } => {
  if (
    row.byte_length !== row.full_update_blob.byteLength ||
    row.checkpoint_hash !== sha256(row.full_update_blob)
  ) {
    throw new Error(
      `Canvas checkpoint ${row.version_id} fails its immutable byte evidence`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.full_update_blob.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`Canvas checkpoint ${row.version_id} is invalid JSON`, {
      cause: error,
    });
  }
  if (!isRecord(parsed)) {
    throw new Error(`Canvas checkpoint ${row.version_id} is not an object`);
  }
  if ("pageReferences" in parsed) {
    return { scene: parsePortableCanvasScene(parsed), legacy: false };
  }
  if (!Array.isArray(parsed.cardReferences)) {
    throw new Error(
      `Canvas checkpoint ${row.version_id} has no recognized reference projection`,
    );
  }
  const scene = materializePortableCanvasScene({
    elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    appState: isRecord(parsed.appState) ? parsed.appState : {},
    files: isRecord(parsed.files) ? parsed.files : {},
  });
  if (
    canonicalStringifyCanvasScene(parsed) !==
    canonicalStringifyCanvasScene(legacyCheckpointShape(scene))
  ) {
    throw new Error(
      `Canvas checkpoint ${row.version_id} diverges from its legacy projection`,
    );
  }
  return { scene, legacy: true };
};

/**
 * Rewrite only the aggregate hashes and retained JSON whose canonical key
 * changed during the Card-to-Page reference noun cutover. Element/file clocks
 * and hashes are revalidated first; an unknown aggregate hash remains corrupt.
 * The caller owns the surrounding IMMEDIATE transaction and temporarily
 * suspends the immutable checkpoint UPDATE trigger.
 */
export const migrateCanvasPageReferenceHashes = (
  database: Database.Database,
): CanvasPageReferenceHashMigrationResult => {
  const documents = database.prepare(`
    SELECT id AS document_id, generation, head_seq, schema_version, state_hash
    FROM documents
    WHERE schema_key = 'nodex.canvas'
      AND sync_engine = 'canvas_scene'
      AND readiness = 'ready'
      AND authority = 'ydoc_primary'
    ORDER BY id
  `).all() as readonly CanvasDocumentHashRow[];
  let liveSceneCount = 0;
  for (const document of documents) {
    const evidence = readCanvasSceneAuthorityHashEvidence(database, {
      documentId: document.document_id,
      generation: document.generation,
      headSeq: document.head_seq,
      schemaVersion: document.schema_version,
    });
    const legacyHash = sha256(legacyReferenceFingerprint(evidence.scene));
    if (
      evidence.storedSceneHash !== evidence.sceneHash &&
      evidence.storedSceneHash !== legacyHash
    ) {
      throw new Error(
        `Canvas scene ${document.document_id} has an unknown aggregate hash`,
      );
    }
    if (document.state_hash !== evidence.storedSceneHash) {
      throw new Error(
        `Canvas Document ${document.document_id} disagrees with its scene hash`,
      );
    }
    if (evidence.storedSceneHash === evidence.sceneHash) continue;
    const updatedDocument = database.prepare(`
      UPDATE documents
      SET state_hash = ?
      WHERE id = ? AND generation = ? AND head_seq = ? AND state_hash = ?
    `).run(
      evidence.sceneHash,
      document.document_id,
      document.generation,
      document.head_seq,
      evidence.storedSceneHash,
    );
    const updatedScene = database.prepare(`
      UPDATE canvas_scenes
      SET scene_hash = ?
      WHERE document_id = ? AND generation = ? AND head_seq = ? AND scene_hash = ?
    `).run(
      evidence.sceneHash,
      document.document_id,
      document.generation,
      document.head_seq,
      evidence.storedSceneHash,
    );
    if (updatedDocument.changes !== 1 || updatedScene.changes !== 1) {
      throw new Error(
        `Canvas scene ${document.document_id} changed during hash migration`,
      );
    }
    liveSceneCount += 1;
  }

  const checkpoints = database.prepare(`
    SELECT version.version_id, version.full_update_blob,
      version.checkpoint_hash, version.byte_length
    FROM document_versions version
    INNER JOIN documents document ON document.id = version.document_id
    WHERE document.schema_key = 'nodex.canvas'
      AND version.checkpoint_format = 'canvas_scene_json_v1'
    ORDER BY version.version_id
  `).all() as readonly CanvasCheckpointRow[];
  let checkpointCount = 0;
  for (const checkpoint of checkpoints) {
    const decoded = parseCheckpoint(checkpoint);
    if (!decoded.legacy) continue;
    const bytes = Buffer.from(
      canonicalStringifyCanvasScene(decoded.scene),
      "utf8",
    );
    const updated = database.prepare(`
      UPDATE document_versions
      SET full_update_blob = ?, checkpoint_hash = ?, byte_length = ?
      WHERE version_id = ? AND checkpoint_hash = ?
    `).run(
      bytes,
      sha256(bytes),
      bytes.byteLength,
      checkpoint.version_id,
      checkpoint.checkpoint_hash,
    );
    if (updated.changes !== 1) {
      throw new Error(
        `Canvas checkpoint ${checkpoint.version_id} changed during hash migration`,
      );
    }
    checkpointCount += 1;
  }
  return { liveSceneCount, checkpointCount };
};
