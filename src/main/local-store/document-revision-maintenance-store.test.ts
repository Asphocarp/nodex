import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";
import { openPageDocument } from "../../shared/block-documents";
import { resetAssetPathCacheForTests } from "./assets";
import {
  applyBlockDocumentUpdate,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { createPage } from "./database-pages";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  checkpointActiveDocumentRevisionIfDue,
  maintainDocumentRevisionHistory,
  prepareDocumentRevisionForUpdate,
} from "./document-revision-maintenance-store";
import { getDocumentVersionDetail } from "./document-versions";

const tempDirectories: string[] = [];

const useTempStore = (): void => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-document-revisions-"),
  );
  tempDirectories.push(directory);
  process.env.NODEX_DIR = directory;
};

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_DIR;
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Document revision maintenance", () => {
  test("captures a pre-burst safety revision and finalizes exact idle content", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const projectId = database
      .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
      .pluck()
      .get() as string;
    const storeEpoch = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .pluck()
      .get() as string;
    const card = await createPage(projectId, "triage", { title: "Before" });
    const documentId = database
      .prepare("SELECT document_id FROM block_documents WHERE block_id = ?")
      .pluck()
      .get(card.id) as string;
    const loaded = loadPrimaryBlockDocument(database, documentId);
    const baseHeadSeq = loaded.head.headSeq;
    const baseVector = Y.encodeStateVector(loaded.document);
    const title = openPageDocument(loaded.document).title;
    title.delete(0, title.length);
    title.insert(0, "After idle");
    const request = {
      documentId,
      storeEpoch,
      generation: loaded.head.generation,
      updateId: "revision:test:idle",
      clientSessionId: "surface:revision-test",
      baseHeadSeq,
      touchedBlockIds: [card.id],
      update: Y.encodeStateAsUpdate(loaded.document, baseVector),
    };
    loaded.document.destroy();

    const beforeEdit = "2026-07-16T00:00:00.000Z";
    const ack = applyBlockDocumentUpdate(database, request, {
      beforeEffectiveUpdate: (transaction, update) => {
        prepareDocumentRevisionForUpdate(transaction, update, beforeEdit);
      },
    });
    expect(ack.duplicate).toBe(false);
    const safety = database
      .prepare(
        `SELECT version_id, base_head_seq, revision_kind, checkpoint_format
         FROM document_versions WHERE document_id = ?`,
      )
      .get(documentId) as {
      readonly version_id: string;
      readonly base_head_seq: number;
      readonly revision_kind: string;
      readonly checkpoint_format: string;
    };
    expect(safety).toMatchObject({
      base_head_seq: baseHeadSeq,
      revision_kind: "safety",
      checkpoint_format: "block_tree_snapshot_v2",
    });
    expect(
      getDocumentVersionDetail(database, {
        projectId,
        documentId,
        versionId: safety.version_id,
      }).materialization,
    ).toMatchObject({ kind: "page", title: "Before" });

    const session = database
      .prepare(
        `SELECT dirty_head_seq, last_edit_at
         FROM document_revision_sessions WHERE document_id = ?`,
      )
      .get(documentId) as {
      readonly dirty_head_seq: number;
      readonly last_edit_at: string;
    };
    expect(session.dirty_head_seq).toBe(ack.committedSeq);

    const idleNow = new Date(Date.parse(session.last_edit_at) + 120_000).toISOString();
    expect(
      maintainDocumentRevisionHistory(database, {
        version: 1,
        storeEpoch,
        now: idleNow,
      }),
    ).toMatchObject({
      finalizedDocumentCount: 1,
      failedDocumentCount: 0,
    });
    const idle = database
      .prepare(
        `SELECT version_id, revision_kind, checkpoint_format
         FROM document_versions
         WHERE document_id = ? AND base_head_seq = ?`,
      )
      .get(documentId, ack.committedSeq) as {
      readonly version_id: string;
      readonly revision_kind: string;
      readonly checkpoint_format: string;
    };
    expect(idle).toMatchObject({
      revision_kind: "automatic",
      checkpoint_format: "block_tree_snapshot_v2",
    });
    expect(
      getDocumentVersionDetail(database, {
        projectId,
        documentId,
        versionId: idle.version_id,
      }).materialization,
    ).toMatchObject({ kind: "page", title: "After idle" });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) FROM document_revision_sessions WHERE document_id = ?",
        )
        .pluck()
        .get(documentId),
    ).toBe(0);
  });

  test("takes an active checkpoint without closing the dirty edit session", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const projectId = database
      .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
      .pluck()
      .get() as string;
    const storeEpoch = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .pluck()
      .get() as string;
    const card = await createPage(projectId, "triage", { title: "Active" });
    const documentId = database
      .prepare("SELECT document_id FROM block_documents WHERE block_id = ?")
      .pluck()
      .get(card.id) as string;
    const loaded = loadPrimaryBlockDocument(database, documentId);
    const vector = Y.encodeStateVector(loaded.document);
    openPageDocument(loaded.document).title.insert(
      openPageDocument(loaded.document).title.length,
      " checkpoint",
    );
    const request = {
      documentId,
      storeEpoch,
      generation: loaded.head.generation,
      updateId: "revision:test:active",
      clientSessionId: "surface:revision-test",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [card.id],
      update: Y.encodeStateAsUpdate(loaded.document, vector),
    };
    loaded.document.destroy();
    applyBlockDocumentUpdate(database, request, {
      beforeEffectiveUpdate: (transaction, update) => {
        prepareDocumentRevisionForUpdate(
          transaction,
          update,
          "2026-07-16T00:00:00.000Z",
        );
      },
    });
    database
      .prepare(
        `UPDATE document_revision_sessions
         SET burst_started_at = '2026-07-16T00:00:00.000Z',
             last_edit_at = '2026-07-16T00:09:59.000Z'
         WHERE document_id = ?`,
      )
      .run(documentId);

    expect(
      checkpointActiveDocumentRevisionIfDue(
        database,
        { documentId, storeEpoch },
        "2026-07-16T00:10:00.000Z",
      ),
    ).toBe(true);
    expect(
      database
        .prepare(
          `SELECT revision_kind FROM document_versions
           WHERE document_id = ? ORDER BY base_head_seq DESC LIMIT 1`,
        )
        .pluck()
        .get(documentId),
    ).toBe("automatic");
    expect(
      database
        .prepare(
          "SELECT last_checkpoint_at FROM document_revision_sessions WHERE document_id = ?",
        )
        .pluck()
        .get(documentId),
    ).toBe("2026-07-16T00:10:00.000Z");
  });

  test("does not create revision state for a causal no-op", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const projectId = database
      .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
      .pluck()
      .get() as string;
    const storeEpoch = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .pluck()
      .get() as string;
    const card = await createPage(projectId, "triage", { title: "No-op" });
    const documentId = database
      .prepare("SELECT document_id FROM block_documents WHERE block_id = ?")
      .pluck()
      .get(card.id) as string;
    const loaded = loadPrimaryBlockDocument(database, documentId);
    const request = {
      documentId,
      storeEpoch,
      generation: loaded.head.generation,
      updateId: "revision:test:noop",
      clientSessionId: "surface:revision-test",
      baseHeadSeq: loaded.head.headSeq,
      touchedBlockIds: [card.id],
      update: Y.encodeStateAsUpdate(
        loaded.document,
        Y.encodeStateVector(loaded.document),
      ),
    };
    loaded.document.destroy();
    let captureCount = 0;

    const ack = applyBlockDocumentUpdate(database, request, {
      beforeEffectiveUpdate: (transaction, update, committedAt) => {
        captureCount += 1;
        prepareDocumentRevisionForUpdate(
          transaction,
          update,
          committedAt,
        );
      },
    });

    expect(ack.duplicate).toBe(true);
    expect(captureCount).toBe(0);
    expect(database.prepare(
      "SELECT COUNT(*) FROM document_versions WHERE document_id = ?",
    ).pluck().get(documentId)).toBe(0);
    expect(database.prepare(
      "SELECT COUNT(*) FROM document_revision_sessions WHERE document_id = ?",
    ).pluck().get(documentId)).toBe(0);
  });
});
