import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import * as Y from "yjs";
import {
  canonicalPortableCanvasSceneFingerprint,
  canonicalStringifyCanvasScene,
  inspectCanvasDocument,
  materializePortableCanvasScene,
  type PortableCanvasScene,
} from "../../shared/block-documents";
import { loadPrimaryBlockDocument } from "./block-document-store";
import {
  initializeCanvasSceneAuthority,
  syncCanvasScene,
} from "./canvas-scene-store";

export type CanvasSceneCutoverFaultPoint =
  | "after_canvas_import"
  | "after_version_conversion"
  | "before_yjs_prune"
  | "after_yjs_prune";

export interface CanvasSceneCutoverOptions {
  readonly faultInjector?: (
    point: CanvasSceneCutoverFaultPoint,
    documentId: string,
  ) => void;
}

export interface CanvasSceneCutoverResult {
  readonly canvasDocumentIds: readonly string[];
  readonly convertedVersionCount: number;
  readonly prunedUpdateCount: number;
  readonly prunedSnapshotCount: number;
  readonly prunedReceiptCount: number;
}

interface CanvasDocumentRow {
  readonly document_id: string;
  readonly project_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_version: number;
}

interface CanvasVersionRow {
  readonly version_id: string;
  readonly full_update_blob: Buffer;
}

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const toPortableScene = (
  elements: readonly unknown[],
  appState: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, unknown>>,
): PortableCanvasScene =>
  materializePortableCanvasScene({ elements, appState, files });

const readLiveCanvasScene = (
  database: Database.Database,
  documentId: string,
): PortableCanvasScene => {
  const loaded = loadPrimaryBlockDocument(database, documentId);
  try {
    const materialization = inspectCanvasDocument(
      loaded.document,
    ).materialization;
    return toPortableScene(
      materialization.elements,
      materialization.appState,
      materialization.files,
    );
  } finally {
    loaded.document.destroy();
  }
};

const decodeCanvasVersion = (
  documentId: string,
  version: CanvasVersionRow,
): PortableCanvasScene => {
  const document = new Y.Doc({ guid: documentId });
  try {
    Y.applyUpdate(document, version.full_update_blob, "canvas-v71-cutover");
    if (
      document.store.pendingStructs !== null ||
      document.store.pendingDs !== null
    ) {
      throw new Error(
        `Canvas checkpoint ${version.version_id} has unresolved Yjs dependencies`,
      );
    }
    const materialization = inspectCanvasDocument(document).materialization;
    return toPortableScene(
      materialization.elements,
      materialization.appState,
      materialization.files,
    );
  } finally {
    document.destroy();
  }
};

const convertCanvasVersions = (
  database: Database.Database,
  documentId: string,
): number => {
  const versions = database
    .prepare(
      `SELECT version_id, full_update_blob
       FROM document_versions
       WHERE document_id = ?
       ORDER BY version_id`,
    )
    .all(documentId) as readonly CanvasVersionRow[];
  for (const version of versions) {
    const scene = decodeCanvasVersion(documentId, version);
    const checkpoint = Buffer.from(canonicalStringifyCanvasScene(scene));
    const updated = database
      .prepare(
        `UPDATE document_versions
         SET checkpoint_format = 'canvas_scene_json_v1',
             full_update_blob = ?, state_vector = X'',
             checkpoint_hash = ?, byte_length = ?
         WHERE version_id = ? AND document_id = ?`,
      )
      .run(
        checkpoint,
        sha256(checkpoint),
        checkpoint.byteLength,
        version.version_id,
        documentId,
      );
    if (updated.changes !== 1) {
      throw new Error(`Canvas checkpoint changed during cutover: ${version.version_id}`);
    }
  }
  return versions.length;
};

/**
 * Convert every ready Canvas from its v70 Y.Doc into normalized scene-native
 * authority. The caller must wrap this function and schema changes in one
 * IMMEDIATE transaction; no destructive step occurs before both live scene
 * and retained checkpoints have decoded and validated.
 */
export const cutoverCanvasScenesFromYjs = (
  database: Database.Database,
  options: CanvasSceneCutoverOptions = {},
): CanvasSceneCutoverResult => {
  const documents = database
    .prepare(
      `SELECT document.id AS document_id, document.project_id,
        document.generation, document.head_seq, document.schema_version
       FROM documents document
       INNER JOIN block_documents ownership
         ON ownership.document_id = document.id
         AND ownership.project_id = document.project_id
       INNER JOIN blocks owner
         ON owner.id = ownership.block_id
         AND owner.project_id = ownership.project_id
       WHERE owner.type = 'canvas'
         AND document.readiness = 'ready'
         AND document.authority = 'ydoc_primary'
         AND document.sync_engine = 'yjs'
       ORDER BY document.id`,
    )
    .all() as readonly CanvasDocumentRow[];
  let convertedVersionCount = 0;
  let prunedUpdateCount = 0;
  let prunedSnapshotCount = 0;
  let prunedReceiptCount = 0;

  database.exec("DROP TRIGGER IF EXISTS document_versions_are_immutable");
  try {
    for (const document of documents) {
      const scene = readLiveCanvasScene(database, document.document_id);
      const changedEngine = database
        .prepare(
          `UPDATE documents
           SET sync_engine = 'canvas_scene'
           WHERE id = ? AND project_id = ?
             AND generation = ? AND head_seq = ?
             AND sync_engine = 'yjs'`,
        )
        .run(
          document.document_id,
          document.project_id,
          document.generation,
          document.head_seq,
        );
      if (changedEngine.changes !== 1) {
        throw new Error(
          `Canvas Document changed before v71 import: ${document.document_id}`,
        );
      }
      const initialized = initializeCanvasSceneAuthority(database, {
        projectId: document.project_id,
        documentId: document.document_id,
        expectedGeneration: document.generation,
        expectedHeadSeq: document.head_seq,
        scene,
      });
      if (
        canonicalPortableCanvasSceneFingerprint(initialized.scene) !==
        canonicalPortableCanvasSceneFingerprint(scene)
      ) {
        throw new Error(
          `Canvas scene changed during v71 import: ${document.document_id}`,
        );
      }
      options.faultInjector?.("after_canvas_import", document.document_id);

      convertedVersionCount += convertCanvasVersions(
        database,
        document.document_id,
      );
      options.faultInjector?.(
        "after_version_conversion",
        document.document_id,
      );
      options.faultInjector?.("before_yjs_prune", document.document_id);

      prunedReceiptCount += database
        .prepare("DELETE FROM document_update_receipts WHERE document_id = ?")
        .run(document.document_id).changes;
      prunedSnapshotCount += database
        .prepare("DELETE FROM document_snapshots WHERE document_id = ?")
        .run(document.document_id).changes;
      prunedUpdateCount += database
        .prepare("DELETE FROM document_updates WHERE document_id = ?")
        .run(document.document_id).changes;
      database
        .prepare(
          `UPDATE documents
           SET state_vector = X'', state_hash = ?
           WHERE id = ? AND project_id = ? AND sync_engine = 'canvas_scene'`,
        )
        .run(initialized.sceneHash, document.document_id, document.project_id);
      options.faultInjector?.("after_yjs_prune", document.document_id);

      const verified = syncCanvasScene(database, {
        version: 1,
        projectId: document.project_id,
        documentId: document.document_id,
        clientSessionId: "system:canvas-v71-cutover",
      });
      if (
        !verified.ok ||
        canonicalPortableCanvasSceneFingerprint(verified.value.scene) !==
          canonicalPortableCanvasSceneFingerprint(scene)
      ) {
        throw new Error(
          `Canvas scene failed v71 verification: ${document.document_id}`,
        );
      }
      const remainingYjsRows = (
        database
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM document_updates WHERE document_id = ?) +
              (SELECT COUNT(*) FROM document_snapshots WHERE document_id = ?) +
              (SELECT COUNT(*) FROM document_update_receipts WHERE document_id = ?)
              AS count`,
          )
          .get(
            document.document_id,
            document.document_id,
            document.document_id,
          ) as { readonly count: number }
      ).count;
      if (remainingYjsRows !== 0) {
        throw new Error(
          `Canvas retained Yjs authority after v71 cutover: ${document.document_id}`,
        );
      }
    }
  } finally {
    database.exec(`
      CREATE TRIGGER IF NOT EXISTS document_versions_are_immutable
        BEFORE UPDATE ON document_versions
        BEGIN
          SELECT RAISE(ABORT, 'document versions are immutable');
        END;
    `);
  }
  const allCanvasDocuments = database
    .prepare(
      `SELECT document.id AS document_id, document.project_id,
        document.sync_engine, document.readiness, document.authority
       FROM documents document
       INNER JOIN block_documents ownership
         ON ownership.document_id = document.id
         AND ownership.project_id = document.project_id
       INNER JOIN blocks owner
         ON owner.id = ownership.block_id
         AND owner.project_id = ownership.project_id
       WHERE owner.type = 'canvas'
       ORDER BY document.id`,
    )
    .all() as readonly {
    readonly document_id: string;
    readonly project_id: string;
    readonly sync_engine: string;
    readonly readiness: string;
    readonly authority: string;
  }[];
  for (const document of allCanvasDocuments) {
    if (
      document.sync_engine !== "canvas_scene" ||
      document.readiness !== "ready" ||
      document.authority !== "ydoc_primary"
    ) {
      throw new Error(
        `Canvas Document did not reach v71 scene authority: ${document.document_id}`,
      );
    }
    const synced = syncCanvasScene(database, {
      version: 1,
      projectId: document.project_id,
      documentId: document.document_id,
      clientSessionId: "system:canvas-v71-final-verification",
    });
    if (!synced.ok) {
      throw new Error(
        `Canvas Document failed final v71 verification: ${document.document_id}`,
      );
    }
    const yjsRows = (
      database
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM document_updates WHERE document_id = ?) +
            (SELECT COUNT(*) FROM document_snapshots WHERE document_id = ?) +
            (SELECT COUNT(*) FROM document_update_receipts WHERE document_id = ?)
            AS count`,
        )
        .get(
          document.document_id,
          document.document_id,
          document.document_id,
        ) as { readonly count: number }
    ).count;
    if (yjsRows === 0) continue;
    throw new Error(
      `Canvas Document retained Yjs rows after v71 verification: ${document.document_id}`,
    );
  }
  return {
    canvasDocumentIds: documents.map((document) => document.document_id),
    convertedVersionCount,
    prunedUpdateCount,
    prunedSnapshotCount,
    prunedReceiptCount,
  };
};
