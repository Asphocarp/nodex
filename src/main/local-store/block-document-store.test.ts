import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { createUuidV7, isUuidV7 } from "../../shared/card-id";
import {
  createCardDocument,
  openCardDocument,
} from "../../shared/block-documents";
import {
  applyBlockDocumentUpdate,
  BlockDocumentStoreError,
  compactBlockDocument,
  getBlockDocumentProjectId,
  getBlockDocumentRuntimeIdentity,
  getBlockDocumentSyncStep,
  initializeCardDocumentGenesis,
  loadBlockDocument,
  syncBlockDocument,
  toDocumentSyncCommandError,
} from "./block-document-store";
import { relocateBlocksAtomically } from "./block-relocations";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import { prepareEditableOwnedBlockDocument } from "./owned-block-document-preparation";

const isUnsupportedSqliteError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("better-sqlite3") && message.includes("not yet supported")
  );
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

  expect(error instanceof BlockDocumentStoreError).toBe(true);
  expect((error as BlockDocumentStoreError).code).toBe(code);
};

const seedPendingCardDocument = (
  database: Database.Database,
  blockId = "block-document-store-card",
): { documentId: string; projectId: string; storeEpoch: string } => {
  const project = database
    .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
    .get() as { id: string };
  const now = new Date().toISOString();
  const documentId = `document:${blockId}`;

  database
    .prepare(
      `
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind, containing_document_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
  `,
    )
    .run(blockId, project.id, now, now);
  database
    .prepare(
      `
    INSERT INTO top_level_block_placements (
      block_id, project_id, rank_key, created_at, updated_at
    ) VALUES (?, ?, 'document-store-test', ?, ?)
  `,
    )
    .run(blockId, project.id, now, now);
  database
    .prepare(
      `
    INSERT INTO documents (
      id, project_id, generation, head_seq, schema_key, schema_version,
      state_vector, readiness, authority, created_at, updated_at
    ) VALUES (?, ?, 1, 0, 'nodex.card', 2, X'', 'pending_genesis', 'legacy_shadow', ?, ?)
  `,
    )
    .run(documentId, project.id, now, now);
  database
    .prepare(
      `
    INSERT INTO block_documents (block_id, document_id, project_id, created_at)
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(blockId, documentId, project.id, now);

  const metadata = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { store_epoch: string };
  return {
    documentId,
    projectId: project.id,
    storeEpoch: metadata.store_epoch,
  };
};

const createParagraphBlock = (blockId: string, value: string): Y.XmlElement => {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", blockId);
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, value);
  paragraph.insert(0, [text]);
  container.insert(0, [paragraph]);
  return container;
};

const createCardShellBlock = (
  blockId: string,
  displayHint: string,
): Y.XmlElement => {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", blockId);
  const card = new Y.XmlElement("card");
  card.setAttribute("displayHint", displayHint);
  container.insert(0, [card]);
  return container;
};

const rootBlockGroup = (document: Y.Doc): Y.XmlElement => {
  const root = openCardDocument(document).body.get(0);
  if (root instanceof Y.XmlElement && root.nodeName === "blockGroup")
    return root;
  throw new TypeError("Expected the canonical Card root blockGroup");
};

const findBlockContainer = (document: Y.Doc, blockId: string): Y.XmlElement => {
  for (const node of rootBlockGroup(document).createTreeWalker(() => true)) {
    if (
      node instanceof Y.XmlElement &&
      node.nodeName === "blockContainer" &&
      node.getAttribute("id") === blockId
    ) {
      return node;
    }
  }
  throw new TypeError(`Expected Block ${blockId}`);
};

const firstBlockText = (container: Y.XmlElement): Y.XmlText => {
  for (const node of container.createTreeWalker(() => true)) {
    if (node instanceof Y.XmlText) return node;
  }
  throw new TypeError("Expected Block text");
};

const captureOneUpdate = (document: Y.Doc, mutate: () => void): Uint8Array => {
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
  test("classifies durable store failures without message parsing", () => {
    const dependency = toDocumentSyncCommandError(
      new BlockDocumentStoreError(
        "document_update_missing_dependencies",
        "missing prerequisite",
      ),
    );
    expect(dependency.code).toBe("document_update_missing_dependencies");
    expect(dependency.retryable).toBe(true);
    expect(dependency.resetRequired).toBe(false);

    const beforeCutover = toDocumentSyncCommandError(
      new BlockDocumentStoreError(
        "document_authority_mismatch",
        "legacy shadow is not client writable",
      ),
    );
    expect(beforeCutover.code).toBe("document_not_ready");
    expect(beforeCutover.retryable).toBe(true);
    expect(beforeCutover.resetRequired).toBe(false);

    const restoredStore = toDocumentSyncCommandError(
      new BlockDocumentStoreError("store_epoch_mismatch", "restored store"),
    );
    expect(restoredStore.code).toBe("store_epoch_mismatch");
    expect(restoredStore.retryable).toBe(false);
    expect(restoredStore.resetRequired).toBe(true);

    const malformed = toDocumentSyncCommandError(
      new BlockDocumentStoreError("invalid_document_update", "bad update"),
    );
    expect(malformed.retryable).toBe(false);
    expect(malformed.resetRequired).toBe(false);

    const infrastructure = toDocumentSyncCommandError(
      new Error("worker database unavailable"),
    );
    expect(infrastructure.code).toBe("unknown");
    expect(infrastructure.retryable).toBe(false);
    expect(infrastructure.resetRequired).toBe(false);
  });

  sqliteTest(
    "atomically repairs a historical title-only Card before provider mount",
    async () => {
      closeDatabase();
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nodex-empty-document-prepare-"),
      );
      process.env.NODEX_DIR = tempDir;

      try {
        await initializeDatabase();
        closeDatabase();

        const database = new Database(getDatabasePath(), { readonly: false });
        database.pragma("foreign_keys = ON");
        const blockId = "card-with-historical-empty-body";
        const { documentId, projectId, storeEpoch } = seedPendingCardDocument(
          database,
          blockId,
        );
        const legacyEmpty = createCardDocument({
          documentId,
          initialTitle: "Title only",
        });
        initializeCardDocumentGenesis(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "legacy-empty-genesis",
          clientSessionId: "migration",
          update: Y.encodeStateAsUpdate(legacyEmpty.document),
        });
        legacyEmpty.document.destroy();
        database
          .prepare("UPDATE documents SET authority = 'ydoc_primary' WHERE id = ?")
          .run(documentId);

        const prepared = prepareEditableOwnedBlockDocument(
          database,
          projectId,
          blockId,
        );
        expect(prepared.repairedEmptyRoot).toBe(true);
        expect(prepared.descriptor.headSeq).toBe(2);
        expect(prepared.descriptor.sync.kind).toBe("yjs");

        const loaded = loadBlockDocument(database, documentId);
        const root = rootBlockGroup(loaded.document);
        const repairedBlock = root.get(0);
        const repairedBlockId =
          repairedBlock instanceof Y.XmlElement
            ? repairedBlock.getAttribute("id")
            : null;
        expect(repairedBlock instanceof Y.XmlElement).toBe(true);
        if (typeof repairedBlockId !== "string") {
          throw new TypeError("Expected the repaired root to have a Block id");
        }
        expect(isUuidV7(repairedBlockId)).toBe(true);
        loaded.document.destroy();

        const materialization = database
          .prepare(
            "SELECT nfm, block_tree_json FROM document_materializations WHERE document_id = ?",
          )
          .get(documentId) as { nfm: string; block_tree_json: string };
        expect(materialization.nfm).toBe("");
        expect(JSON.parse(materialization.block_tree_json)).toMatchObject([
          { type: "paragraph", content: [], children: [] },
        ]);

        const repeated = prepareEditableOwnedBlockDocument(
          database,
          projectId,
          blockId,
        );
        expect(repeated.repairedEmptyRoot).toBe(false);
        expect(repeated.descriptor.headSeq).toBe(2);
        expect(repeated.descriptor.sync.kind).toBe("yjs");

        const authoritative = loadBlockDocument(database, documentId);
        const destructiveReplica = new Y.Doc({ guid: documentId });
        Y.applyUpdate(
          destructiveReplica,
          Y.encodeStateAsUpdate(authoritative.document),
        );
        authoritative.document.destroy();
        const beforeDelete = Y.encodeStateVector(destructiveReplica);
        rootBlockGroup(destructiveReplica).delete(0, 1);
        let destructiveUpdateRejected = false;
        try {
          applyBlockDocumentUpdate(database, {
            documentId,
            storeEpoch,
            generation: 1,
            updateId: "delete-final-editable-root",
            clientSessionId: "window-destructive",
            baseHeadSeq: 2,
            touchedBlockIds: [repairedBlockId ?? ""],
            update: Y.encodeStateAsUpdate(destructiveReplica, beforeDelete),
          });
        } catch {
          destructiveUpdateRejected = true;
        }
        expect(destructiveUpdateRejected).toBe(true);
        destructiveReplica.destroy();
        expect(
          getBlockDocumentRuntimeIdentity(database, documentId).head.headSeq,
        ).toBe(2);
        database.close();
      } finally {
        closeDatabase();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    },
  );

  sqliteTest(
    "accepts a registered historical Block id but rejects a new non-v7 Block id",
    async () => {
      closeDatabase();
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nodex-block-id-boundary-"),
      );
      process.env.NODEX_DIR = tempDir;

      try {
        await initializeDatabase();
        closeDatabase();

        const database = new Database(getDatabasePath(), { readonly: false });
        database.pragma("foreign_keys = ON");
        const { documentId, projectId, storeEpoch } =
          seedPendingCardDocument(database);
        const historicalBlockId = "historical-paragraph-id";
        const now = new Date().toISOString();
        database
          .prepare(
            `INSERT INTO blocks (
              id, project_id, type, lifecycle, location_kind,
              containing_document_id, location_revision, metadata_revision,
              created_at, updated_at
            ) VALUES (?, ?, 'paragraph', 'active', 'document', ?, 1, 1, ?, ?)`,
          )
          .run(historicalBlockId, projectId, documentId, now, now);

        const genesis = createCardDocument({
          documentId,
          initialTitle: "Historical Block",
        });
        rootBlockGroup(genesis.document).insert(0, [
          createParagraphBlock(historicalBlockId, "Before"),
        ]);
        initializeCardDocumentGenesis(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "historical-block-genesis",
          clientSessionId: "migration",
          update: Y.encodeStateAsUpdate(genesis.document),
        });
        genesis.document.destroy();
        database
          .prepare("UPDATE documents SET authority = 'ydoc_primary' WHERE id = ?")
          .run(documentId);

        const historicalReplica = loadBlockDocument(database, documentId);
        const historicalUpdate = captureOneUpdate(
          historicalReplica.document,
          () => {
            firstBlockText(
              findBlockContainer(historicalReplica.document, historicalBlockId),
            ).insert(6, " updated");
          },
        );
        const accepted = applyBlockDocumentUpdate(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "historical-block-update",
          clientSessionId: "historical-client",
          baseHeadSeq: 1,
          touchedBlockIds: [historicalBlockId],
          update: historicalUpdate,
        });
        expect(accepted.headSeq).toBe(2);
        historicalReplica.document.destroy();

        const invalidReplica = loadBlockDocument(database, documentId);
        const nonV7BlockId = crypto.randomUUID();
        const invalidUpdate = captureOneUpdate(invalidReplica.document, () => {
          rootBlockGroup(invalidReplica.document).insert(1, [
            createParagraphBlock(nonV7BlockId, "New"),
          ]);
        });
        expectThrowsCode(
          () =>
            applyBlockDocumentUpdate(database, {
              documentId,
              storeEpoch,
              generation: 1,
              updateId: "non-v7-block-update",
              clientSessionId: "modern-client",
              baseHeadSeq: 2,
              touchedBlockIds: [nonV7BlockId],
              update: invalidUpdate,
            }),
          "invalid_document_update",
        );
        invalidReplica.document.destroy();
        expect(
          getBlockDocumentRuntimeIdentity(database, documentId).head.headSeq,
        ).toBe(2);
        database.close();
      } finally {
        closeDatabase();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    },
  );

  sqliteTest(
    "rejects an ordinary Yjs update that manufactures a Card owner shell",
    async () => {
      closeDatabase();
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nodex-card-shell-typed-create-"),
      );
      process.env.NODEX_DIR = tempDir;

      try {
        await initializeDatabase();
        closeDatabase();
        const database = new Database(getDatabasePath(), { readonly: false });
        database.pragma("foreign_keys = ON");
        const { documentId, storeEpoch } = seedPendingCardDocument(
          database,
          "card-shell-host",
        );
        const genesis = createCardDocument({
          documentId,
          initialTitle: "Host",
        });
        initializeCardDocumentGenesis(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "card-shell-host-genesis",
          clientSessionId: "migration",
          update: Y.encodeStateAsUpdate(genesis.document),
          finalAuthority: "ydoc_primary",
        });
        genesis.document.destroy();

        const replica = loadBlockDocument(database, documentId);
        const before = Y.encodeStateVector(replica.document);
        rootBlockGroup(replica.document).insert(
          rootBlockGroup(replica.document).length,
          [createCardShellBlock("unowned-card-shell", "Unowned")],
        );
        expectThrowsCode(
          () =>
            applyBlockDocumentUpdate(database, {
              documentId,
              storeEpoch,
              generation: 1,
              updateId: "manufacture-card-shell",
              clientSessionId: "window-1",
              baseHeadSeq: 1,
              touchedBlockIds: ["unowned-card-shell"],
              update: Y.encodeStateAsUpdate(replica.document, before),
            }),
          "invalid_document_update",
        );
        replica.document.destroy();
        expect(
          database
            .prepare("SELECT 1 FROM blocks WHERE id = 'unowned-card-shell'")
            .get(),
        ).toBeUndefined();
        database.close();
      } finally {
        closeDatabase();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    },
  );

  sqliteTest(
    "durably converges concurrent updates and dependency retries across restart",
    async () => {
      closeDatabase();
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nodex-document-store-"),
      );
      process.env.NODEX_DIR = tempDir;

      try {
        await initializeDatabase();
        closeDatabase();

        let database = new Database(getDatabasePath(), { readonly: false });
        database.pragma("foreign_keys = ON");
        const { documentId, projectId, storeEpoch } =
          seedPendingCardDocument(database);
        expect(getBlockDocumentProjectId(database, documentId)).toBe(projectId);
        expectThrowsCode(
          () => getBlockDocumentRuntimeIdentity(database, documentId),
          "document_not_ready",
        );
        expectThrowsCode(
          () => getBlockDocumentProjectId(database, "document:missing"),
          "document_not_found",
        );
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
        expect(genesisAck.storeEpoch).toBe(storeEpoch);
        expect(genesisAck.duplicate).toBe(false);
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
        expect(duplicateGenesis.storeEpoch).toBe(storeEpoch);
        expect(duplicateGenesis.duplicate).toBe(true);

        expectThrowsCode(
          () => getBlockDocumentRuntimeIdentity(database, documentId),
          "document_authority_mismatch",
        );
        const shadowReplica = new Y.Doc({ guid: documentId });
        expectThrowsCode(
          () =>
            syncBlockDocument(database, {
              documentId,
              clientSessionId: "window-before-cutover",
              stateVector: Y.encodeStateVector(shadowReplica),
            }),
          "document_authority_mismatch",
        );
        shadowReplica.destroy();

        database
          .prepare(
            `
          UPDATE documents SET authority = 'ydoc_primary' WHERE id = ?
        `,
          )
          .run(documentId);
        const genesisIdentity = getBlockDocumentRuntimeIdentity(
          database,
          documentId,
        );
        expect(genesisIdentity.storeEpoch).toBe(storeEpoch);
        expect(genesisIdentity.head.headSeq).toBe(1);
        expect(genesisIdentity.stateHash.length).toBe(64);

        const emptyReplica = new Y.Doc({ guid: documentId });
        const initialSync = syncBlockDocument(database, {
          documentId,
          clientSessionId: "window-empty",
          stateVector: Y.encodeStateVector(emptyReplica),
        });
        expect(initialSync.documentId).toBe(documentId);
        expect(initialSync.storeEpoch).toBe(storeEpoch);
        expect(initialSync.generation).toBe(1);
        expect(initialSync.headSeq).toBe(1);
        Y.applyUpdate(emptyReplica, initialSync.update);
        expect(openCardDocument(emptyReplica).title.toString()).toBe("Base");
        emptyReplica.destroy();

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
        expect(ackA.storeEpoch).toBe(storeEpoch);
        expect(ackB.headSeq).toBe(3);
        expect(ackB.committedSeq).toBe(3);
        const derivedTitleReceipt = database
          .prepare(
            `
          SELECT client_touched_block_ids_json, derived_touched_block_ids_json,
                 derivation_version
          FROM document_update_receipts
          WHERE document_id = ? AND update_id = 'client-a-1'
        `,
          )
          .get(documentId) as {
          client_touched_block_ids_json: string;
          derived_touched_block_ids_json: string;
          derivation_version: number;
        };
        expect(derivedTitleReceipt.client_touched_block_ids_json).toBe("[]");
        expect(derivedTitleReceipt.derived_touched_block_ids_json).toBe(
          '["block-document-store-card"]',
        );
        expect(derivedTitleReceipt.derivation_version).toBe(1);

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
        expect(duplicateB.duplicate).toBe(true);

        const causalReplay = applyBlockDocumentUpdate(database, {
          documentId,
          storeEpoch,
          generation: 1,
          updateId: "client-b-causal-replay",
          clientSessionId: "window-after-restart",
          baseHeadSeq: 3,
          touchedBlockIds: [],
          update: updateB,
        });
        expect(causalReplay.headSeq).toBe(3);
        expect(causalReplay.committedSeq).toBe(3);
        expect(causalReplay.duplicate).toBe(true);
        const causalReplayReceipt = database
          .prepare(
            `
          SELECT COUNT(*) AS count
          FROM document_update_receipts
          WHERE document_id = ? AND update_id = 'client-b-causal-replay'
        `,
          )
          .get(documentId) as { count: number };
        expect(causalReplayReceipt.count).toBe(0);

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
          rejected = (error as Error).message.includes(
            "injected durable write failure",
          );
        }
        database.exec("DROP TRIGGER reject_test_document_update");
        expect(rejected).toBe(true);

        const afterConcurrent = loadBlockDocument(database, documentId);
        expect(afterConcurrent.head.headSeq).toBe(3);
        const concurrentTitle = openCardDocument(
          afterConcurrent.document,
        ).title.toString();
        expect(concurrentTitle.includes(" A")).toBe(true);
        expect(concurrentTitle.includes(" B")).toBe(true);

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
          () =>
            applyBlockDocumentUpdate(database, {
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
        expect(
          openCardDocument(clientWithOnlyFirstThreeHeads).title.toString(),
        ).toBe(openCardDocument(dependentClient).title.toString());

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
        expect(
          openCardDocument(reloaded.document).title.toString().includes(" 1 2"),
        ).toBe(true);

        database.exec(`
          CREATE TRIGGER corrupt_test_document_compaction_snapshot
          AFTER INSERT ON document_snapshots
          WHEN NEW.document_id = '${documentId}' AND NEW.snapshot_seq = 5
          BEGIN
            UPDATE document_snapshots
            SET snapshot_hash = 'corrupt'
            WHERE document_id = NEW.document_id
              AND generation = NEW.generation
              AND snapshot_seq = NEW.snapshot_seq;
          END;
        `);
        expectThrowsCode(
          () =>
            compactBlockDocument(database, {
              documentId,
              expectedGeneration: 1,
              expectedHeadSeq: 5,
            }),
          "document_state_corrupt",
        );
        database.exec("DROP TRIGGER corrupt_test_document_compaction_snapshot");
        const snapshotAfterVerificationFailure = database
          .prepare(
            `
          SELECT MAX(snapshot_seq) AS snapshot_seq
          FROM document_snapshots
          WHERE document_id = ?
        `,
          )
          .get(documentId) as { snapshot_seq: number };
        expect(snapshotAfterVerificationFailure.snapshot_seq).toBe(1);

        database.exec(`
          CREATE TRIGGER reject_test_document_compaction
          BEFORE DELETE ON document_updates
          BEGIN
            SELECT RAISE(ABORT, 'injected compaction failure');
          END;
        `);
        let compactionRejected = false;
        try {
          compactBlockDocument(database, {
            documentId,
            expectedGeneration: 1,
            expectedHeadSeq: 5,
          });
        } catch (error) {
          compactionRejected = (error as Error).message.includes(
            "injected compaction failure",
          );
        }
        database.exec("DROP TRIGGER reject_test_document_compaction");
        expect(compactionRejected).toBe(true);
        const rolledBackSnapshot = database
          .prepare(
            `
          SELECT MAX(snapshot_seq) AS snapshot_seq
          FROM document_snapshots
          WHERE document_id = ?
        `,
          )
          .get(documentId) as { snapshot_seq: number };
        expect(rolledBackSnapshot.snapshot_seq).toBe(1);

        const compacted = compactBlockDocument(database, {
          documentId,
          expectedGeneration: 1,
          expectedHeadSeq: 5,
        });
        expect(compacted.snapshotSeq).toBe(5);
        expect(compacted.prunedUpdateCount).toBe(5);
        expect(compacted.retainedReceiptCount).toBe(5);
        expect(compacted.snapshotBytes > 0).toBe(true);

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
        expect(lateDuplicateB.duplicate).toBe(true);

        expectThrowsCode(
          () =>
            applyBlockDocumentUpdate(database, {
              documentId,
              storeEpoch,
              generation: 1,
              updateId: "client-b-1",
              clientSessionId: "window-b",
              baseHeadSeq: 1,
              touchedBlockIds: [],
              update: updateA,
            }),
          "update_id_collision",
        );

        expectThrowsCode(
          () =>
            applyBlockDocumentUpdate(database, {
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
          () =>
            applyBlockDocumentUpdate(database, {
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
          .prepare(
            "SELECT COUNT(*) AS count FROM document_updates WHERE document_id = ?",
          )
          .get(documentId) as { count: number };
        expect(updateCount.count).toBe(0);
        const receiptCount = database
          .prepare(
            "SELECT COUNT(*) AS count FROM document_update_receipts WHERE document_id = ?",
          )
          .get(documentId) as { count: number };
        expect(receiptCount.count).toBe(5);
        const snapshotCount = database
          .prepare(
            "SELECT COUNT(*) AS count FROM document_snapshots WHERE document_id = ?",
          )
          .get(documentId) as { count: number };
        expect(snapshotCount.count).toBe(1);
        reloaded.document.destroy();
        database.close();
      } finally {
        closeDatabase();
        fs.rmSync(tempDir, { recursive: true, force: true });
        delete process.env.NODEX_DIR;
      }
    },
  );

  sqliteTest(
    "preserves stale updates that cross a Block relocation and only accepts structurally visible edits",
    async () => {
      closeDatabase();
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "nodex-document-recovery-"),
      );
      process.env.NODEX_DIR = tempDir;

      try {
        await initializeDatabase();
        closeDatabase();
        const database = new Database(getDatabasePath(), { readonly: false });
        database.pragma("foreign_keys = ON");
        try {
          const source = seedPendingCardDocument(
            database,
            "recovery-source-card",
          );
          const target = seedPendingCardDocument(
            database,
            "recovery-target-card",
          );
          expect(source.projectId).toBe(target.projectId);
          expect(source.storeEpoch).toBe(target.storeEpoch);

          const sourceGenesis = createCardDocument({
            documentId: source.documentId,
            initialTitle: "Source",
          });
          const movingRootId = createUuidV7();
          const laterDeletedId = createUuidV7();
          const remainingRootId = createUuidV7();
          rootBlockGroup(sourceGenesis.document).insert(0, [
            createParagraphBlock(movingRootId, "Move me"),
            createParagraphBlock(laterDeletedId, "Delete me later"),
            createParagraphBlock(remainingRootId, "Remain"),
          ]);
          const sourceGenesisUpdate = Y.encodeStateAsUpdate(
            sourceGenesis.document,
          );
          const targetGenesis = createCardDocument({
            documentId: target.documentId,
            initialTitle: "Target",
          });
          const targetGenesisUpdate = Y.encodeStateAsUpdate(
            targetGenesis.document,
          );
          initializeCardDocumentGenesis(database, {
            documentId: source.documentId,
            storeEpoch: source.storeEpoch,
            generation: 1,
            updateId: "source-genesis",
            clientSessionId: "migration",
            update: sourceGenesisUpdate,
          });
          initializeCardDocumentGenesis(database, {
            documentId: target.documentId,
            storeEpoch: target.storeEpoch,
            generation: 1,
            updateId: "target-genesis",
            clientSessionId: "migration",
            update: targetGenesisUpdate,
          });
          database
            .prepare(
              `
          UPDATE documents SET authority = 'ydoc_primary'
          WHERE id IN (?, ?)
        `,
            )
            .run(source.documentId, target.documentId);

          const relocation = relocateBlocksAtomically(database, {
            relocationId: "recovery-relocation",
            projectId: source.projectId,
            storeEpoch: source.storeEpoch,
            rootBlockIds: [movingRootId],
            sourceDocumentId: source.documentId,
            sourceGeneration: 1,
            expectedSourceHeadSeq: 1,
            expectedLocationRevisions: { [movingRootId]: 1 },
            target: {
              kind: "document",
              documentId: target.documentId,
              generation: 1,
              expectedHeadSeq: 1,
            },
          });
          expect(relocation.sourceCommit.headSeq).toBe(2);
          expect(relocation.targetCommit?.headSeq).toBe(2);

          const makeStaleReplica = (): Y.Doc => {
            const replica = new Y.Doc({ guid: source.documentId });
            Y.applyUpdate(replica, sourceGenesisUpdate);
            return replica;
          };
          const captureStoreError = (
            operation: () => unknown,
          ): BlockDocumentStoreError => {
            let caught: unknown;
            try {
              operation();
            } catch (error) {
              caught = error;
            }
            expect(caught instanceof BlockDocumentStoreError).toBe(true);
            return caught as BlockDocumentStoreError;
          };

          const derivedHitReplica = makeStaleReplica();
          const derivedHitUpdate = captureOneUpdate(derivedHitReplica, () => {
            const text = firstBlockText(
              findBlockContainer(derivedHitReplica, movingRootId),
            );
            text.insert(text.length, " while offline");
          });
          const derivedHitInput = {
            documentId: source.documentId,
            storeEpoch: source.storeEpoch,
            generation: 1,
            updateId: "stale-derived-relocated",
            clientSessionId: "offline-derived",
            baseHeadSeq: 1,
            touchedBlockIds: [] as readonly string[],
            update: derivedHitUpdate,
          };
          const derivedHit = captureStoreError(() =>
            applyBlockDocumentUpdate(database, derivedHitInput),
          );
          expect(derivedHit.code).toBe("block_relocated");
          expect(derivedHit.relocationId).toBe("recovery-relocation");
          expect(typeof derivedHit.recoveryArtifactId).toBe("string");
          const derivedArtifact = database
            .prepare(
              `
          SELECT reason, derived_touched_block_ids_json, relocation_ids_json,
                 update_hash, update_byte_length
          FROM document_recovery_artifacts
          WHERE id = ?
        `,
            )
            .get(derivedHit.recoveryArtifactId) as {
            reason: string;
            derived_touched_block_ids_json: string | null;
            relocation_ids_json: string;
            update_hash: string;
            update_byte_length: number;
          };
          expect(derivedArtifact.reason).toBe("block_relocated");
          expect(
            JSON.parse(
              derivedArtifact.derived_touched_block_ids_json ?? "[]",
            ).includes(movingRootId),
          ).toBe(true);
          expect(derivedArtifact.relocation_ids_json).toBe(
            '["recovery-relocation"]',
          );
          expect(derivedArtifact.update_hash.length).toBe(64);
          expect(derivedArtifact.update_byte_length).toBe(
            derivedHitUpdate.byteLength,
          );

          const exactRetry = captureStoreError(() =>
            applyBlockDocumentUpdate(database, derivedHitInput),
          );
          expect(exactRetry.code).toBe("block_relocated");
          expect(exactRetry.recoveryArtifactId).toBe(
            derivedHit.recoveryArtifactId,
          );
          const collision = captureStoreError(() =>
            applyBlockDocumentUpdate(database, {
              ...derivedHitInput,
              touchedBlockIds: [remainingRootId],
            }),
          );
          expect(collision.code).toBe("update_id_collision");

          database
            .prepare(
              `
          UPDATE document_recovery_artifacts
          SET status = 'resolved', resolved_at = ?
          WHERE id = ?
        `,
            )
            .run(new Date().toISOString(), derivedHit.recoveryArtifactId);
          const resolvedRetry = captureStoreError(() =>
            applyBlockDocumentUpdate(database, derivedHitInput),
          );
          expect(resolvedRetry.code).toBe("block_relocated");
          expect(resolvedRetry.recoveryArtifactId).toBe(
            derivedHit.recoveryArtifactId,
          );

          const declaredHitReplica = makeStaleReplica();
          const declaredHitUpdate = captureOneUpdate(declaredHitReplica, () => {
            openCardDocument(declaredHitReplica).title.insert(6, " declared");
          });
          const declaredHit = captureStoreError(() =>
            applyBlockDocumentUpdate(database, {
              documentId: source.documentId,
              storeEpoch: source.storeEpoch,
              generation: 1,
              updateId: "stale-declared-relocated",
              clientSessionId: "offline-declared",
              baseHeadSeq: 1,
              touchedBlockIds: [movingRootId],
              update: declaredHitUpdate,
            }),
          );
          expect(declaredHit.code).toBe("block_relocated");
          const declaredArtifact = database
            .prepare(
              `
          SELECT derived_touched_block_ids_json
          FROM document_recovery_artifacts WHERE id = ?
        `,
            )
            .get(declaredHit.recoveryArtifactId) as {
            derived_touched_block_ids_json: string | null;
          };
          expect(declaredArtifact.derived_touched_block_ids_json).toBe(null);

          const currentSource = loadBlockDocument(database, source.documentId);
          const deleteUpdate = captureOneUpdate(currentSource.document, () => {
            const group = rootBlockGroup(currentSource.document);
            const index = group
              .toArray()
              .findIndex(
                (node) =>
                  node instanceof Y.XmlElement &&
                  node.getAttribute("id") === laterDeletedId,
              );
            if (index < 0) throw new Error("Expected later-deleted Block");
            group.delete(index, 1);
          });
          currentSource.document.destroy();
          const deleteAck = applyBlockDocumentUpdate(database, {
            documentId: source.documentId,
            storeEpoch: source.storeEpoch,
            generation: 1,
            updateId: "delete-after-relocation",
            clientSessionId: "online-source",
            baseHeadSeq: 2,
            touchedBlockIds: [laterDeletedId],
            update: deleteUpdate,
          });
          expect(deleteAck.headSeq).toBe(3);

          const opaqueReplica = makeStaleReplica();
          const opaqueUpdate = captureOneUpdate(opaqueReplica, () => {
            const text = firstBlockText(
              findBlockContainer(opaqueReplica, laterDeletedId),
            );
            text.insert(text.length, " invisible offline edit");
          });
          const opaque = captureStoreError(() =>
            applyBlockDocumentUpdate(database, {
              documentId: source.documentId,
              storeEpoch: source.storeEpoch,
              generation: 1,
              updateId: "stale-opaque-update",
              clientSessionId: "offline-opaque",
              baseHeadSeq: 1,
              touchedBlockIds: [],
              update: opaqueUpdate,
            }),
          );
          expect(opaque.code).toBe("recovery_required");
          const opaqueArtifact = database
            .prepare(
              `
          SELECT reason FROM document_recovery_artifacts WHERE id = ?
        `,
            )
            .get(opaque.recoveryArtifactId) as { reason: string };
          expect(opaqueArtifact.reason).toBe("unsafe_stale_update");

          const safeReplica = makeStaleReplica();
          const safeUpdate = captureOneUpdate(safeReplica, () => {
            const title = openCardDocument(safeReplica).title;
            title.insert(title.length, " safe offline title");
          });
          const safeAck = applyBlockDocumentUpdate(database, {
            documentId: source.documentId,
            storeEpoch: source.storeEpoch,
            generation: 1,
            updateId: "stale-safe-title",
            clientSessionId: "offline-safe",
            baseHeadSeq: 1,
            touchedBlockIds: [],
            update: safeUpdate,
          });
          expect(safeAck.headSeq).toBe(4);
          const safeReload = loadBlockDocument(database, source.documentId);
          expect(
            openCardDocument(safeReload.document)
              .title.toString()
              .includes("safe offline title"),
          ).toBe(true);
          safeReload.document.destroy();

          const targetCurrent = loadBlockDocument(database, target.documentId);
          const reservedUpdate = captureOneUpdate(
            targetCurrent.document,
            () => {
              const title = openCardDocument(targetCurrent.document).title;
              title.insert(title.length, " reserved");
            },
          );
          targetCurrent.document.destroy();
          const reserved = captureStoreError(() =>
            applyBlockDocumentUpdate(database, {
              documentId: target.documentId,
              storeEpoch: target.storeEpoch,
              generation: 1,
              updateId: "relocation:user-preallocation",
              clientSessionId: "untrusted-renderer",
              baseHeadSeq: 2,
              touchedBlockIds: [],
              update: reservedUpdate,
            }),
          );
          expect(reserved.code).toBe("invalid_document_update");
          const reservedReceipt = database
            .prepare(
              `
          SELECT COUNT(*) AS count FROM document_update_receipts
          WHERE document_id = ? AND update_id = 'relocation:user-preallocation'
        `,
            )
            .get(target.documentId) as { count: number };
          expect(reservedReceipt.count).toBe(0);

          const rejectedReceiptCount = database
            .prepare(
              `
          SELECT COUNT(*) AS count FROM document_update_receipts
          WHERE document_id = ? AND update_id IN (
            'stale-derived-relocated',
            'stale-declared-relocated',
            'stale-opaque-update'
          )
        `,
            )
            .get(source.documentId) as { count: number };
          expect(rejectedReceiptCount.count).toBe(0);
          const artifactCount = database
            .prepare(
              `
          SELECT COUNT(*) AS count FROM document_recovery_artifacts
          WHERE document_id = ?
        `,
            )
            .get(source.documentId) as { count: number };
          expect(artifactCount.count).toBe(3);

          sourceGenesis.document.destroy();
          targetGenesis.document.destroy();
          derivedHitReplica.destroy();
          declaredHitReplica.destroy();
          opaqueReplica.destroy();
          safeReplica.destroy();
        } finally {
          database.close();
        }
      } finally {
        closeDatabase();
        fs.rmSync(tempDir, { recursive: true, force: true });
        delete process.env.NODEX_DIR;
      }
    },
  );
});
