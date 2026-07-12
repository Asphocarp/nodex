import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { afterEach, describe, expect, test } from "vitest";
import {
  createCanvasDocument,
  primaryCanvasBlockId,
} from "../../shared/block-documents";
import { getOwnedDocumentDescriptor } from "./block-document-cutover";
import { createCard } from "./cards";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";
import { migrateSchema70To71 } from "./schema";
import { initializeBlockDocumentGenesis } from "./block-document-store";
import { getDocumentVersionDetail } from "./document-versions";

const directories: string[] = [];

const sha256 = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const useFreshStore = async (): Promise<Database.Database> => {
  closeDatabase();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-canvas-v71-cutover-"),
  );
  directories.push(directory);
  process.env.NODEX_DIR = directory;
  await initializeDatabase();
  return getDb();
};

const seedV70CanvasYjsAuthority = (
  database: Database.Database,
  projectId: string,
  documentId: string,
): void => {
  database.exec(`
    DROP TRIGGER IF EXISTS documents_sync_engine_immutable;
    DROP TRIGGER IF EXISTS canvas_documents_require_empty_yjs_state_update;
  `);
  database
    .prepare("DELETE FROM canvas_scenes WHERE document_id = ?")
    .run(documentId);
  const envelope = createCanvasDocument({
    documentId,
    initialScene: {
      elements: [
        {
          id: "migrated-shape",
          type: "rectangle",
          isDeleted: false,
          version: 3,
          versionNonce: 7,
          index: "a0",
          x: 42,
        },
      ],
      appState: { gridSize: 20 },
    },
  });
  try {
    const update = Y.encodeStateAsUpdate(envelope.document);
    const now = "2026-07-13T00:00:00.000Z";
    database
      .prepare(
        `UPDATE documents
         SET generation = 1, head_seq = 0, sync_engine = 'yjs',
             state_vector = X'', state_hash = '',
             readiness = 'pending_genesis', authority = 'legacy_shadow',
             updated_at = ?
         WHERE id = ? AND project_id = ?`,
      )
      .run(now, documentId, projectId);
    const storeEpoch = (
      database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    const initialized = initializeBlockDocumentGenesis(database, {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: "v70-canvas-genesis",
      clientSessionId: "v70-fixture",
      update,
      finalAuthority: "ydoc_primary",
    });
    const stateVector = initialized.stateVector;
    database
      .prepare(
        `INSERT INTO document_versions (
          version_id, document_id, project_id, generation, base_head_seq,
          schema_key, schema_version, cause, label, actor_json,
          checkpoint_format, full_update_blob, state_vector,
          checkpoint_hash, byte_length, created_at
         ) VALUES (
          'version:v70-canvas', ?, ?, 1, 1, 'nodex.canvas', 1,
          'manual', NULL, '{}', 'yjs_update_v1', ?, ?, ?, ?, ?
         )`,
      )
      .run(
        documentId,
        projectId,
        update,
        stateVector,
        sha256(update),
        update.byteLength,
        now,
      );
    database.pragma("user_version = 70");
  } finally {
    envelope.document.destroy();
  }
};

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_DIR;
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("schema v71 Canvas scene cutover", () => {
  test("rolls back a failed cutover and retries without losing v70 Yjs evidence", async () => {
    const database = await useFreshStore();
    const project = createProject({ name: "Canvas cutover rollback" });
    const descriptor = getOwnedDocumentDescriptor(
      database,
      project.id,
      primaryCanvasBlockId(project.id),
    );
    seedV70CanvasYjsAuthority(database, project.id, descriptor.documentId);

    expect(() =>
      migrateSchema70To71(database, {
        faultInjector: (point) => {
          if (point === "after_version_conversion") {
            throw new Error("injected Canvas cutover failure");
          }
        },
      }),
    ).toThrow("injected Canvas cutover failure");
    expect(database.pragma("user_version", { simple: true })).toBe(70);
    expect(
      database
        .prepare(
          `SELECT sync_engine,
            (SELECT COUNT(*) FROM canvas_scenes WHERE document_id = documents.id) AS scenes,
            (SELECT COUNT(*) FROM document_updates WHERE document_id = documents.id) AS updates
           FROM documents WHERE id = ?`,
        )
        .get(descriptor.documentId),
    ).toEqual({ sync_engine: "yjs", scenes: 0, updates: 1 });
    expect(
      database
        .prepare(
          "SELECT checkpoint_format FROM document_versions WHERE version_id = 'version:v70-canvas'",
        )
        .get(),
    ).toEqual({ checkpoint_format: "yjs_update_v1" });

    const migrated = migrateSchema70To71(database);
    expect(migrated.canvasDocumentIds).toContain(descriptor.documentId);
    expect(migrated.convertedVersionCount).toBe(1);
    expect(database.pragma("user_version", { simple: true })).toBe(71);
  });

  test("removes only Canvas Yjs rows, converts checkpoints, and leaves Cards unchanged", async () => {
    const database = await useFreshStore();
    const project = createProject({ name: "Canvas cutover isolation" });
    const card = await createCard(project.id, "draft", { title: "Yjs remains" });
    const cardDescriptor = getOwnedDocumentDescriptor(database, project.id, card.id);
    const canvasDescriptor = getOwnedDocumentDescriptor(
      database,
      project.id,
      primaryCanvasBlockId(project.id),
    );
    seedV70CanvasYjsAuthority(
      database,
      project.id,
      canvasDescriptor.documentId,
    );
    const cardUpdatesBefore = (
      database
        .prepare("SELECT COUNT(*) AS count FROM document_updates WHERE document_id = ?")
        .get(cardDescriptor.documentId) as { readonly count: number }
    ).count;

    migrateSchema70To71(database);

    expect(
      database
        .prepare(
          `SELECT sync_engine, length(state_vector) AS state_vector_bytes,
            (SELECT COUNT(*) FROM canvas_scenes WHERE document_id = documents.id) AS scenes,
            (SELECT COUNT(*) FROM document_updates WHERE document_id = documents.id) AS updates,
            (SELECT COUNT(*) FROM document_snapshots WHERE document_id = documents.id) AS snapshots,
            (SELECT COUNT(*) FROM document_update_receipts WHERE document_id = documents.id) AS receipts
           FROM documents WHERE id = ?`,
        )
        .get(canvasDescriptor.documentId),
    ).toEqual({
      sync_engine: "canvas_scene",
      state_vector_bytes: 0,
      scenes: 1,
      updates: 0,
      snapshots: 0,
      receipts: 0,
    });
    const checkpoint = database
      .prepare(
        `SELECT checkpoint_format, length(state_vector) AS state_vector_bytes,
          checkpoint_hash, full_update_blob
         FROM document_versions WHERE version_id = 'version:v70-canvas'`,
      )
      .get() as {
      readonly checkpoint_format: string;
      readonly state_vector_bytes: number;
      readonly checkpoint_hash: string;
      readonly full_update_blob: Buffer;
    };
    expect(checkpoint.checkpoint_format).toBe("canvas_scene_json_v1");
    expect(checkpoint.state_vector_bytes).toBe(0);
    expect(checkpoint.checkpoint_hash).toBe(sha256(checkpoint.full_update_blob));
    expect(JSON.parse(checkpoint.full_update_blob.toString())).toMatchObject({
      kind: "canvas_scene",
      elements: [expect.objectContaining({ id: "migrated-shape", x: 42 })],
    });
    expect(
      getDocumentVersionDetail(database, {
        projectId: project.id,
        documentId: canvasDescriptor.documentId,
        versionId: "version:v70-canvas",
      }).materialization,
    ).toMatchObject({
      kind: "canvas_scene",
      elements: [expect.objectContaining({ id: "migrated-shape", x: 42 })],
    });
    expect(
      database
        .prepare(
          `SELECT sync_engine,
            (SELECT COUNT(*) FROM document_updates WHERE document_id = documents.id) AS updates
           FROM documents WHERE id = ?`,
        )
        .get(cardDescriptor.documentId),
    ).toEqual({ sync_engine: "yjs", updates: cardUpdatesBefore });
  });

  test("fresh Canvas genesis stores its actual scene hash and no Yjs rows", async () => {
    const database = await useFreshStore();
    const project = createProject({ name: "Fresh scene-native Canvas" });
    const descriptor = getOwnedDocumentDescriptor(
      database,
      project.id,
      primaryCanvasBlockId(project.id),
    );
    const row = database
      .prepare(
        `SELECT sync_engine, state_hash,
          (SELECT scene_hash FROM canvas_scenes WHERE document_id = documents.id) AS scene_hash,
          (SELECT COUNT(*) FROM document_updates WHERE document_id = documents.id) AS updates,
          (SELECT COUNT(*) FROM document_snapshots WHERE document_id = documents.id) AS snapshots,
          (SELECT COUNT(*) FROM document_update_receipts WHERE document_id = documents.id) AS receipts
         FROM documents WHERE id = ?`,
      )
      .get(descriptor.documentId) as {
      readonly sync_engine: string;
      readonly state_hash: string;
      readonly scene_hash: string;
      readonly updates: number;
      readonly snapshots: number;
      readonly receipts: number;
    };
    expect(row.sync_engine).toBe("canvas_scene");
    expect(row.state_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(row.state_hash).toBe(row.scene_hash);
    expect({ updates: row.updates, snapshots: row.snapshots, receipts: row.receipts })
      .toEqual({ updates: 0, snapshots: 0, receipts: 0 });
  });
});
