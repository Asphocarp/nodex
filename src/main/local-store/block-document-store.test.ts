import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  createCardDocument,
  openCardDocument,
} from "../../shared/block-documents";
import {
  applyBlockDocumentUpdate,
  BlockDocumentStoreError,
  getBlockDocumentSyncStep,
  initializeCardDocumentGenesis,
  loadBlockDocument,
} from "./block-document-store";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";

const isUnsupportedSqliteError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
};

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      return false;
    }
    throw error;
  }
})();

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

const expectThrowsCode = (
  operation: () => unknown,
  code: BlockDocumentStoreError["code"],
): void => {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }

  expect(error instanceof BlockDocumentStoreError).toBeTrue();
  expect((error as BlockDocumentStoreError).code).toBe(code);
};

const seedPendingCardDocument = (
  database: Database.Database,
): { documentId: string; storeEpoch: string } => {
  const project = database
    .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
    .get() as { id: string };
  const now = new Date().toISOString();
  const blockId = "block-document-store-card";
  const documentId = `document:${blockId}`;

  database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind, containing_document_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
  `).run(blockId, project.id, now, now);
  database.prepare(`
    INSERT INTO top_level_block_placements (
      block_id, project_id, rank_key, created_at, updated_at
    ) VALUES (?, ?, 'document-store-test', ?, ?)
  `).run(blockId, project.id, now, now);
  database.prepare(`
    INSERT INTO documents (
      id, project_id, generation, head_seq, schema_key, schema_version,
      state_vector, readiness, authority, created_at, updated_at
    ) VALUES (?, ?, 1, 0, 'nodex.card', 1, X'', 'pending_genesis', 'legacy_shadow', ?, ?)
  `).run(documentId, project.id, now, now);
  database.prepare(`
    INSERT INTO block_documents (block_id, document_id, project_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(blockId, documentId, project.id, now);

  const metadata = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { store_epoch: string };
  return { documentId, storeEpoch: metadata.store_epoch };
};

const captureOneUpdate = (
  document: Y.Doc,
  mutate: () => void,
): Uint8Array => {
  let captured: Uint8Array | undefined;
  const listener = (update: Uint8Array): void => {
    captured = update.slice();
  };
  document.on("update", listener);
  try {
    mutate();
  } finally {
    document.off("update", listener);
  }

  if (captured) {
    return captured;
  }
  throw new Error("Expected the Y.Doc mutation to emit an update");
};

describe("BlockDocumentStore", () => {
  sqliteTest("durably converges concurrent updates and dependency retries across restart", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-document-store-"));
    process.env.NODEX_DIR = tempDir;

    try {
        await initializeDatabase();
        closeDatabase();

        let database = new Database(getDatabasePath(), { readonly: false });
        database.pragma("foreign_keys = ON");
        const { documentId, storeEpoch } = seedPendingCardDocument(database);
        const genesis = createCardDocument({
          documentId,
          initialTitle: "Base",
        });
        const genesisUpdate = Y.encodeStateAsUpdate(genesis.document);
        const genesisAck = initializeCardDocumentGenesis(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "genesis-1",
          clientSessionId: "migration",
          update: genesisUpdate,
        });
        expect(genesisAck.headSeq).toBe(1);
        expect(genesisAck.updateId).toBe("genesis-1");
        expect(genesisAck.committedSeq).toBe(1);
        expect(genesisAck.duplicate).toBeFalse();

        const duplicateGenesis = initializeCardDocumentGenesis(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "genesis-1",
          clientSessionId: "migration",
          update: genesisUpdate,
        });
        expect(duplicateGenesis.headSeq).toBe(1);
        expect(duplicateGenesis.committedSeq).toBe(1);
        expect(duplicateGenesis.duplicate).toBeTrue();

        const clientA = new Y.Doc({ guid: documentId });
        const clientB = new Y.Doc({ guid: documentId });
        Y.applyUpdate(clientA, genesisUpdate);
        Y.applyUpdate(clientB, genesisUpdate);
        const baseStateVector = Y.encodeStateVector(genesis.document);
        openCardDocument(clientA).title.insert(4, " A");
        openCardDocument(clientB).title.insert(4, " B");
        const updateA = Y.encodeStateAsUpdate(clientA, baseStateVector);
        const updateB = Y.encodeStateAsUpdate(clientB, baseStateVector);

        const ackA = applyBlockDocumentUpdate(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "client-a-1",
          clientSessionId: "window-a",
          baseHeadSeq: 1,
          touchedBlockIds: [],
          update: updateA,
        });
        const ackB = applyBlockDocumentUpdate(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "client-b-1",
          clientSessionId: "window-b",
          baseHeadSeq: 1,
          touchedBlockIds: [],
          update: updateB,
        });
        expect(ackA.headSeq).toBe(2);
        expect(ackA.committedSeq).toBe(2);
        expect(ackB.headSeq).toBe(3);
        expect(ackB.committedSeq).toBe(3);

        const duplicateB = applyBlockDocumentUpdate(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "client-b-1",
          clientSessionId: "window-b",
          baseHeadSeq: 1,
          touchedBlockIds: [],
          update: updateB,
        });
        expect(duplicateB.headSeq).toBe(3);
        expect(duplicateB.committedSeq).toBe(3);
        expect(duplicateB.duplicate).toBeTrue();

        const rejectedUpdate = captureOneUpdate(clientA, () => {
          const title = openCardDocument(clientA).title;
          title.insert(title.length, " rejected");
        });
        database.exec(`
          CREATE TRIGGER reject_test_document_update
          BEFORE INSERT ON document_updates
          WHEN NEW.update_id = 'reject-me'
          BEGIN
            SELECT RAISE(ABORT, 'injected durable write failure');
          END;
        `);
        let rejected = false;
        try {
          applyBlockDocumentUpdate(database, {
            documentId,
            storeEpoch,
            generation: 1,
            updateId: "reject-me",
            clientSessionId: "window-a",
            baseHeadSeq: 3,
            touchedBlockIds: [],
            update: rejectedUpdate,
          });
        } catch (error) {
          rejected = (error as Error).message.includes("injected durable write failure");
        }
        database.exec("DROP TRIGGER reject_test_document_update");
        expect(rejected).toBeTrue();

        const afterConcurrent = loadBlockDocument(database, documentId);
        expect(afterConcurrent.head.headSeq).toBe(3);
        const concurrentTitle = openCardDocument(afterConcurrent.document).title.toString();
        expect(concurrentTitle.includes(" A")).toBeTrue();
        expect(concurrentTitle.includes(" B")).toBeTrue();

        const dependentClient = new Y.Doc({ guid: documentId });
        Y.applyUpdate(
          dependentClient,
          Y.encodeStateAsUpdate(afterConcurrent.document),
        );
        const firstDependentUpdate = captureOneUpdate(dependentClient, () => {
          const title = openCardDocument(dependentClient).title;
          title.insert(title.length, " 1");
        });
        const secondDependentUpdate = captureOneUpdate(dependentClient, () => {
          const title = openCardDocument(dependentClient).title;
          title.insert(title.length, " 2");
        });
        afterConcurrent.document.destroy();

        expectThrowsCode(
          () => applyBlockDocumentUpdate(database, {
            documentId,
            storeEpoch,
            generation: 1,
            updateId: "dependent-2",
            clientSessionId: "window-c",
            baseHeadSeq: 3,
            touchedBlockIds: [],
            update: secondDependentUpdate,
          }),
          "document_update_missing_dependencies",
        );
        const headAfterDependencyRejection = database
          .prepare("SELECT head_seq FROM documents WHERE id = ?")
          .get(documentId) as { head_seq: number };
        expect(headAfterDependencyRejection.head_seq).toBe(3);

        const dependentOneAck = applyBlockDocumentUpdate(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "dependent-1",
          clientSessionId: "window-c",
          baseHeadSeq: 3,
          touchedBlockIds: [],
          update: firstDependentUpdate,
        });
        expect(dependentOneAck.headSeq).toBe(4);
        const dependentTwoAck = applyBlockDocumentUpdate(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "dependent-2",
          clientSessionId: "window-c",
          baseHeadSeq: 3,
          touchedBlockIds: [],
          update: secondDependentUpdate,
        });
        expect(dependentTwoAck.headSeq).toBe(5);

        const clientWithOnlyFirstThreeHeads = new Y.Doc({ guid: documentId });
        Y.applyUpdate(clientWithOnlyFirstThreeHeads, genesisUpdate);
        Y.applyUpdate(clientWithOnlyFirstThreeHeads, updateA);
        Y.applyUpdate(clientWithOnlyFirstThreeHeads, updateB);
        const syncStep = getBlockDocumentSyncStep(
          database,
          documentId,
          Y.encodeStateVector(clientWithOnlyFirstThreeHeads),
        );
        expect(syncStep.head.headSeq).toBe(5);
        Y.applyUpdate(clientWithOnlyFirstThreeHeads, syncStep.update);
        expect(openCardDocument(clientWithOnlyFirstThreeHeads).title.toString()).toBe(
          openCardDocument(dependentClient).title.toString(),
        );

        genesis.document.destroy();
        clientA.destroy();
        clientB.destroy();
        dependentClient.destroy();
        clientWithOnlyFirstThreeHeads.destroy();
        database.close();

        database = new Database(getDatabasePath(), { readonly: false });
        database.pragma("foreign_keys = ON");
        const reloaded = loadBlockDocument(database, documentId);
        expect(reloaded.head.headSeq).toBe(5);
        expect(openCardDocument(reloaded.document).title.toString().includes(" 1 2")).toBeTrue();

        const lateDuplicateB = applyBlockDocumentUpdate(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "client-b-1",
          clientSessionId: "window-b",
          baseHeadSeq: 1,
          touchedBlockIds: [],
          update: updateB,
        });
        expect(lateDuplicateB.committedSeq).toBe(3);
        expect(lateDuplicateB.headSeq).toBe(5);
        expect(lateDuplicateB.duplicate).toBeTrue();

        expectThrowsCode(
          () => applyBlockDocumentUpdate(database, {
            documentId,
            storeEpoch: "stale-store-epoch",
            generation: 1,
            updateId: "stale-epoch-update",
            clientSessionId: "stale-window",
            baseHeadSeq: 5,
            touchedBlockIds: [],
            update: updateA,
          }),
          "store_epoch_mismatch",
        );
        expectThrowsCode(
          () => applyBlockDocumentUpdate(database, {
            documentId,
            storeEpoch,
            generation: 2,
            updateId: "stale-generation-update",
            clientSessionId: "stale-window",
            baseHeadSeq: 5,
            touchedBlockIds: [],
            update: updateA,
          }),
          "document_generation_mismatch",
        );

        const updateCount = database
          .prepare("SELECT COUNT(*) AS count FROM document_updates WHERE document_id = ?")
          .get(documentId) as { count: number };
        expect(updateCount.count).toBe(5);
        reloaded.document.destroy();
        database.close();
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
    }
  });
});
