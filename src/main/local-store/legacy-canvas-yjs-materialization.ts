import type Database from "better-sqlite3";
import type { CanvasSceneMaterialization } from "./legacy-canvas-ydoc-codec";

/** Persist the legacy Canvas Y.Doc projection required only during import. */
export const persistLegacyCanvasYjsMaterialization = (
  database: Database.Database,
  input: {
    readonly documentId: string;
    readonly ownerBlockId: string;
    readonly projectId: string;
    readonly generation: number;
    readonly projectedSeq: number;
    readonly materialization: CanvasSceneMaterialization;
    readonly updatedAt: string;
  },
): void => {
  const legacyTable = database
    .prepare(
      `SELECT 1 AS present FROM sqlite_master
       WHERE type = 'table' AND name = 'canvas_scene_materializations'`,
    )
    .get();
  if (!legacyTable) return;
  database
    .prepare(
      `INSERT INTO canvas_scene_materializations (
        document_id, owner_block_id, project_id, generation, projected_seq,
        schema_version, elements_json, app_state_json, files_json,
        card_refs_json, plain_text, preview, updated_at
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
         updated_at = excluded.updated_at`,
    )
    .run(
      input.documentId,
      input.ownerBlockId,
      input.projectId,
      input.generation,
      input.projectedSeq,
      input.materialization.schemaVersion,
      JSON.stringify(input.materialization.elements),
      JSON.stringify(input.materialization.appState),
      JSON.stringify(input.materialization.files),
      JSON.stringify(input.materialization.pageReferences),
      input.materialization.plainText,
      input.materialization.preview,
      input.updatedAt,
    );
};
