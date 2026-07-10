import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  createCard,
  deleteCard,
} from "../src/main/local-store/cards";
import {
  applyBlockDocumentUpdate,
  BlockDocumentStoreError,
  getBlockDocumentSyncStep,
  initializeCardDocumentGenesis,
  loadBlockDocument,
} from "../src/main/local-store/block-document-store";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  initializeDatabase,
} from "../src/main/local-store/database";
import { undoLatest } from "../src/main/local-store/history";
import {
  createProject,
  deleteProject,
} from "../src/main/local-store/projects";
import {
  createCardDocument,
  openCardDocument,
} from "../src/shared/block-documents";

const FOUNDATION_TABLES_IN_DELETE_ORDER = [
  "database_view_positions",
  "database_views",
  "database_memberships",
  "database_capabilities",
  "document_block_index",
  "document_materializations",
  "document_snapshots",
  "document_updates",
  "block_documents",
  "top_level_block_placements",
  "blocks",
  "documents",
  "block_store_metadata",
] as const;

interface FoundationProbeResult {
  readonly identityPreserved: boolean;
  readonly readiness: string;
  readonly authority: string;
  readonly databaseMembership: boolean;
  readonly groupKey: string | null;
  readonly foreignKeyProblems: number;
  readonly safetyBackups: number;
  readonly backupDatabaseVerified: boolean;
  readonly assetsPreserved: boolean;
  readonly rollbackFailureObserved: boolean;
  readonly versionAfterFailure: number;
  readonly blocksAfterFailure: number;
  readonly projectCleanupVerified: boolean;
  readonly authorityDeletesRejected: boolean;
  readonly capabilityTypeChangesRejected: boolean;
  readonly postV59ShadowContinuity: boolean;
  readonly crossProjectShadowMove: boolean;
  readonly tombstoneReuseRejected: boolean;
  readonly historyRestorePreservedIdentity: boolean;
}

interface DocumentProbeResult {
  readonly headSeq: number;
  readonly committedUpdates: number;
  readonly concurrentClientsConverged: boolean;
  readonly missingDependencyRejected: boolean;
  readonly hiddenRootRejected: boolean;
  readonly dependencyRetryCommitted: boolean;
  readonly bodyBlockRegistered: boolean;
  readonly globalIdentityCollisionRejected: boolean;
  readonly typedTransitionRejected: boolean;
  readonly deleteOnlyStateVectorStable: boolean;
  readonly deletionPersisted: boolean;
  readonly checksumCorruptionRejected: boolean;
  readonly duplicatePayloadNoopRejected: boolean;
  readonly archivedDuplicateAcked: boolean;
  readonly rollbackVerified: boolean;
  readonly restartVerified: boolean;
  readonly duplicateCommittedSeq: number;
  readonly duplicateObservedHeadSeq: number;
}

const invariant = (condition: boolean, message: string): void => {
  if (condition) {
    return;
  }

  throw new Error(message);
};

const operationFails = (operation: () => void): boolean => {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((value, index) => value === right[index]);

const createParagraphBlock = (blockId: string, text: string): Y.XmlElement => {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", blockId);
  const paragraph = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  container.insert(0, [paragraph]);
  return container;
};

const createTypedBlock = (
  blockId: string,
  blockType: string,
  text: string,
): Y.XmlElement => {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", blockId);
  const content = new Y.XmlElement(blockType);
  const xmlText = new Y.XmlText();
  xmlText.insert(0, text);
  content.insert(0, [xmlText]);
  container.insert(0, [content]);
  return container;
};

const withTemporaryStore = async <T>(
  prefix: string,
  run: (tempDir: string) => Promise<T>,
): Promise<T> => {
  closeDatabase();
  const previousNodexDir = process.env.NODEX_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.NODEX_DIR = tempDir;

  try {
    return await run(tempDir);
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousNodexDir === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previousNodexDir;
    }
  }
};

const clearBlockFoundation = (database: Database.Database): void => {
  database.pragma("foreign_keys = OFF");
  try {
    for (const table of FOUNDATION_TABLES_IN_DELETE_ORDER) {
      database.exec(`DELETE FROM ${table}`);
    }
  } finally {
    database.pragma("foreign_keys = ON");
  }
};

const runFoundationProbe = (): Promise<FoundationProbeResult> =>
  withTemporaryStore("nodex-block-foundation-runtime-", async (tempDir) => {
    await initializeDatabase();
    const project = createProject({ name: "Block foundation runtime probe" });
    const card = await createCard(project.id, "in_progress", {
      title: "Stable Card identity",
    });
    const deletedCard = await createCard(project.id, "backlog", {
      title: "Tombstoned Card identity",
    });
    invariant(
      await deleteCard(project.id, "backlog", deletedCard.id),
      "post-v59 Card deletion failed",
    );
    let tombstoneReuseRejected = false;
    try {
      await createCard(project.id, "backlog", {
        id: deletedCard.id,
        title: "Illegal identity reuse",
      });
    } catch (error) {
      tombstoneReuseRejected =
        error instanceof Error &&
        error.message.includes("Card or Block id already exists");
    }
    invariant(tombstoneReuseRejected, "normal Card create reused a tombstoned Block ID");

    const restoreSessionId = "block-foundation-history-restore";
    const restoredCard = await createCard(
      project.id,
      "draft",
      { title: "History-restored Card" },
      restoreSessionId,
    );
    invariant(
      await deleteCard(project.id, "draft", restoredCard.id, restoreSessionId),
      "history restore setup deletion failed",
    );
    const restoreResult = undoLatest(project.id, restoreSessionId);
    invariant(
      restoreResult.success,
      `history undo did not restore the deleted Card: ${JSON.stringify(restoreResult)}`,
    );
    const moveTargetProject = createProject({ name: "Shadow move target" });
    const disposableProject = createProject({ name: "Disposable runtime space" });
    await createCard(disposableProject.id, "draft", {
      title: "Deleted before migration",
    });
    invariant(deleteProject(disposableProject.id), "Project cleanup operation failed");
    closeDatabase();

    const legacyDatabase = new Database(getDatabasePath());
    try {
      const createdShadow = legacyDatabase
        .prepare(`
          SELECT block.lifecycle, document.readiness, membership.removed_at, position.group_key
          FROM blocks block
          INNER JOIN block_documents ownership ON ownership.block_id = block.id
          INNER JOIN documents document ON document.id = ownership.document_id
          INNER JOIN database_memberships membership ON membership.card_block_id = block.id
          INNER JOIN database_view_positions position ON position.block_id = block.id
          WHERE block.id = ?
        `)
        .get(card.id) as
        | {
            lifecycle: string;
            readiness: string;
            removed_at: string | null;
            group_key: string;
          }
        | undefined;
      const deletedShadow = legacyDatabase
        .prepare(`
          SELECT
            block.lifecycle,
            membership.removed_at,
            (SELECT COUNT(*) FROM top_level_block_placements WHERE block_id = block.id) AS placements,
            (SELECT COUNT(*) FROM database_view_positions WHERE block_id = block.id) AS positions
          FROM blocks block
          INNER JOIN block_documents ownership ON ownership.block_id = block.id
          INNER JOIN database_memberships membership ON membership.card_block_id = block.id
          WHERE block.id = ?
        `)
        .get(deletedCard.id) as
        | {
            lifecycle: string;
            removed_at: string | null;
            placements: number;
            positions: number;
          }
        | undefined;
      const restoredShadow = legacyDatabase
        .prepare(`
          SELECT block.lifecycle, document.id AS document_id, membership.removed_at
          FROM cards card
          INNER JOIN blocks block ON block.id = card.id
          INNER JOIN block_documents ownership ON ownership.block_id = block.id
          INNER JOIN documents document ON document.id = ownership.document_id
          INNER JOIN database_memberships membership ON membership.card_block_id = block.id
          WHERE card.id = ?
        `)
        .get(restoredCard.id) as
        | {
            lifecycle: string;
            document_id: string;
            removed_at: string | null;
          }
        | undefined;
      legacyDatabase.prepare(`
        UPDATE cards
        SET status = 'done', "order" = 7, revision = revision + 1
        WHERE id = ?
      `).run(card.id);
      const updatedShadow = legacyDatabase
        .prepare(`
          SELECT position.group_key, position.rank_key, document.genesis_source_revision, card.revision
          FROM cards card
          INNER JOIN block_documents ownership ON ownership.block_id = card.id
          INNER JOIN documents document ON document.id = ownership.document_id
          INNER JOIN database_view_positions position ON position.block_id = card.id
          WHERE card.id = ?
        `)
        .get(card.id) as
        | {
            group_key: string;
            rank_key: string;
            genesis_source_revision: number;
            revision: number;
          }
        | undefined;
      const postV59ShadowContinuity =
        createdShadow?.lifecycle === "active" &&
        createdShadow.readiness === "pending_genesis" &&
        createdShadow.removed_at === null &&
        createdShadow.group_key === "in_progress" &&
        deletedShadow?.lifecycle === "deleted" &&
        deletedShadow.removed_at !== null &&
        deletedShadow.placements === 0 &&
        deletedShadow.positions === 0 &&
        restoredShadow?.lifecycle === "active" &&
        restoredShadow.document_id === `document:${restoredCard.id}` &&
        restoredShadow.removed_at === null &&
        updatedShadow?.group_key === "done" &&
        updatedShadow.rank_key === "00000000000000000007" &&
        updatedShadow.genesis_source_revision === updatedShadow.revision;
      invariant(postV59ShadowContinuity, "post-v59 Card shadow continuity failed");
      legacyDatabase.prepare(`
        UPDATE cards
        SET project_id = ?, status = 'backlog', "order" = 0, revision = revision + 1
        WHERE id = ?
      `).run(moveTargetProject.id, card.id);
      const movedShadow = legacyDatabase
        .prepare(`
          SELECT
            block.project_id AS block_project_id,
            document.project_id AS document_project_id,
            membership.database_block_id,
            position.view_id
          FROM blocks block
          INNER JOIN block_documents ownership ON ownership.block_id = block.id
          INNER JOIN documents document ON document.id = ownership.document_id
          INNER JOIN database_memberships membership ON membership.card_block_id = block.id
          INNER JOIN database_view_positions position ON position.block_id = block.id
          WHERE block.id = ? AND membership.removed_at IS NULL
        `)
        .get(card.id) as
        | {
            block_project_id: string;
            document_project_id: string;
            database_block_id: string;
            view_id: string;
          }
        | undefined;
      const crossProjectShadowMove =
        movedShadow?.block_project_id === moveTargetProject.id &&
        movedShadow.document_project_id === moveTargetProject.id &&
        movedShadow.database_block_id === `database:${moveTargetProject.id}:primary` &&
        movedShadow.view_id ===
          `database-view:${moveTargetProject.id}:primary-kanban`;
      invariant(crossProjectShadowMove, "cross-Project shadow shell did not move atomically");
      legacyDatabase.prepare(`
        UPDATE cards
        SET project_id = ?, status = 'in_progress', "order" = 0, revision = revision + 1
        WHERE id = ?
      `).run(project.id, card.id);

      const cleanupCounts = legacyDatabase
        .prepare(`
          SELECT
            (SELECT COUNT(*) FROM projects WHERE id = ?) AS projects,
            (SELECT COUNT(*) FROM blocks WHERE project_id = ?) AS blocks,
            (SELECT COUNT(*) FROM documents WHERE project_id = ?) AS documents
        `)
        .get(
          disposableProject.id,
          disposableProject.id,
          disposableProject.id,
        ) as { projects: number; blocks: number; documents: number };
      invariant(
        cleanupCounts.projects === 0 &&
          cleanupCounts.blocks === 0 &&
          cleanupCounts.documents === 0,
        "Project deletion left Block foundation rows",
      );
      clearBlockFoundation(legacyDatabase);
      legacyDatabase.pragma("user_version = 58");
    } finally {
      legacyDatabase.close();
    }

    const assetPath = path.join(tempDir, "assets", "runtime-probe.txt");
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, "block-first asset", "utf8");

    await initializeDatabase();
    closeDatabase();

    const migratedDatabase = new Database(getDatabasePath());
    migratedDatabase.pragma("foreign_keys = ON");
    const migrated = migratedDatabase.prepare(`
      SELECT
        block.id,
        document.readiness,
        document.authority,
        membership.database_block_id,
        position.group_key
      FROM blocks block
      INNER JOIN block_documents ownership ON ownership.block_id = block.id
      INNER JOIN documents document ON document.id = ownership.document_id
      INNER JOIN database_memberships membership
        ON membership.card_block_id = block.id AND membership.removed_at IS NULL
      INNER JOIN database_view_positions position ON position.block_id = block.id
      WHERE block.id = ?
    `).get(card.id) as {
      id: string;
      readiness: string;
      authority: string;
      database_block_id: string;
      group_key: string | null;
    } | undefined;
    invariant(migrated !== undefined, "v58 to v59 migration did not create the Card shell");
    const authorityDeletesRejected =
      operationFails(() => {
        migratedDatabase.prepare("DELETE FROM blocks WHERE id = ?").run(card.id);
      }) &&
      operationFails(() => {
        migratedDatabase
          .prepare("DELETE FROM documents WHERE id = ?")
          .run(`document:${card.id}`);
      });
    const capabilityTypeChangesRejected =
      operationFails(() => {
        migratedDatabase
          .prepare("UPDATE blocks SET type = 'paragraph' WHERE id = ?")
          .run(card.id);
      }) &&
      operationFails(() => {
        migratedDatabase
          .prepare("UPDATE blocks SET type = 'paragraph' WHERE id = ?")
          .run(`database:${project.id}:primary`);
      });

    const foreignKeyProblems = migratedDatabase.pragma("foreign_key_check") as unknown[];
    const backupsRoot = path.join(tempDir, "migration-backups");
    const backupDirectories = fs
      .readdirSync(backupsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".tmp"))
      .map((entry) => path.join(backupsRoot, entry.name));
    invariant(backupDirectories.length === 1, "migration did not create exactly one safety backup");
    const backupDirectory = backupDirectories[0];
    invariant(backupDirectory !== undefined, "migration safety backup path is missing");

    const backupDatabase = new Database(path.join(backupDirectory, "nodex.db"), {
      readonly: true,
    });
    let backupDatabaseVerified = false;
    try {
      const backupVersion = backupDatabase.pragma("user_version", {
        simple: true,
      }) as number;
      const backupCard = backupDatabase
        .prepare("SELECT id FROM cards WHERE id = ?")
        .get(card.id) as { id: string } | undefined;
      const quickCheck = backupDatabase.pragma("quick_check", {
        simple: true,
      }) as string;
      backupDatabaseVerified =
        backupVersion === 58 && backupCard?.id === card.id && quickCheck === "ok";
    } finally {
      backupDatabase.close();
    }

    const backupManifest = JSON.parse(
      fs.readFileSync(path.join(backupDirectory, "manifest.json"), "utf8"),
    ) as {
      sourceSchemaVersion?: number;
      targetSchemaVersion?: number;
      includesAssets?: boolean;
    };
    const assetsPreserved =
      backupManifest.sourceSchemaVersion === 58 &&
      backupManifest.targetSchemaVersion === 59 &&
      backupManifest.includesAssets === true &&
      fs.readFileSync(
        path.join(backupDirectory, "assets", "runtime-probe.txt"),
        "utf8",
      ) === "block-first asset";

    clearBlockFoundation(migratedDatabase);
    migratedDatabase.exec(`
      DROP TRIGGER IF EXISTS fail_block_foundation_runtime_probe;
      CREATE TRIGGER fail_block_foundation_runtime_probe
      BEFORE INSERT ON blocks
      WHEN NEW.type = 'card'
      BEGIN
        SELECT RAISE(ABORT, 'injected block foundation migration failure');
      END;
      PRAGMA user_version = 58;
    `);
    migratedDatabase.close();

    let rollbackFailureObserved = false;
    try {
      await initializeDatabase();
    } catch (error) {
      rollbackFailureObserved =
        error instanceof Error &&
        error.message.includes("injected block foundation migration failure");
    } finally {
      closeDatabase();
    }

    const rolledBackDatabase = new Database(getDatabasePath(), { readonly: true });
    const versionAfterFailure = rolledBackDatabase.pragma("user_version", {
      simple: true,
    }) as number;
    const blocksAfterFailure = (
      rolledBackDatabase.prepare("SELECT COUNT(*) AS count FROM blocks").get() as {
        count: number;
      }
    ).count;
    rolledBackDatabase.close();

    const result: FoundationProbeResult = {
      identityPreserved: migrated?.id === card.id,
      readiness: migrated?.readiness ?? "missing",
      authority: migrated?.authority ?? "missing",
      databaseMembership:
        migrated?.database_block_id === `database:${project.id}:primary`,
      groupKey: migrated?.group_key ?? null,
      foreignKeyProblems: foreignKeyProblems.length,
      safetyBackups: backupDirectories.length,
      backupDatabaseVerified,
      assetsPreserved,
      rollbackFailureObserved,
      versionAfterFailure,
      blocksAfterFailure,
      projectCleanupVerified: true,
      authorityDeletesRejected,
      capabilityTypeChangesRejected,
      postV59ShadowContinuity: true,
      crossProjectShadowMove: true,
      tombstoneReuseRejected,
      historyRestorePreservedIdentity: true,
    };

    invariant(result.identityPreserved, "migration changed the Card application identity");
    invariant(result.readiness === "pending_genesis", "migrated Document is not pending genesis");
    invariant(result.authority === "legacy_shadow", "migrated Document has the wrong authority");
    invariant(result.databaseMembership, "migrated Card is missing its primary Database membership");
    invariant(result.groupKey === "in_progress", "migrated Card lost its primary view group");
    invariant(result.foreignKeyProblems === 0, "migrated foundation has foreign-key violations");
    invariant(result.backupDatabaseVerified, "migration safety database is not a valid v58 backup");
    invariant(result.assetsPreserved, "migration safety backup did not preserve assets");
    invariant(result.rollbackFailureObserved, "injected migration failure was not surfaced");
    invariant(result.versionAfterFailure === 58, "failed migration advanced the schema version");
    invariant(result.blocksAfterFailure === 0, "failed migration left partial Block rows");
    invariant(result.authorityDeletesRejected, "authority ownership allowed direct deletion");
    invariant(
      result.capabilityTypeChangesRejected,
      "Block type mutation invalidated an active capability",
    );
    return result;
  });

const seedPendingCardDocument = (
  database: Database.Database,
): { documentId: string; storeEpoch: string } => {
  const project = database
    .prepare("SELECT id FROM projects ORDER BY created LIMIT 1")
    .get() as { id: string } | undefined;
  invariant(project !== undefined, "runtime store has no Project");

  const now = new Date().toISOString();
  const blockId = "block-document-runtime-card";
  const documentId = `document:${blockId}`;
  database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind, containing_document_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
  `).run(blockId, project?.id, now, now);
  database.prepare(`
    INSERT INTO top_level_block_placements (
      block_id, project_id, rank_key, created_at, updated_at
    ) VALUES (?, ?, 'runtime-probe', ?, ?)
  `).run(blockId, project?.id, now, now);
  database.prepare(`
    INSERT INTO documents (
      id, project_id, generation, head_seq, schema_key, schema_version,
      state_vector, readiness, authority, created_at, updated_at
    ) VALUES (?, ?, 1, 0, 'nodex.card', 1, X'', 'pending_genesis', 'legacy_shadow', ?, ?)
  `).run(documentId, project?.id, now, now);
  database.prepare(`
    INSERT INTO block_documents (block_id, document_id, project_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(blockId, documentId, project?.id, now);

  const metadata = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { store_epoch: string } | undefined;
  invariant(metadata !== undefined, "runtime store has no store epoch");
  return { documentId, storeEpoch: metadata?.store_epoch ?? "" };
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

  invariant(captured !== undefined, "Yjs mutation did not emit an update");
  return captured ?? new Uint8Array();
};

const readDocumentHeadSeq = (
  database: Database.Database,
  documentId: string,
): number =>
  (
    database.prepare("SELECT head_seq FROM documents WHERE id = ?").get(documentId) as {
      head_seq: number;
    }
  ).head_seq;

const readDocumentUpdateCount = (
  database: Database.Database,
  documentId: string,
): number =>
  (
    database
      .prepare("SELECT COUNT(*) AS count FROM document_updates WHERE document_id = ?")
      .get(documentId) as { count: number }
  ).count;

const runDocumentStoreProbe = (): Promise<DocumentProbeResult> =>
  withTemporaryStore("nodex-block-document-runtime-", async () => {
    await initializeDatabase();
    closeDatabase();

    let database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    const { documentId, storeEpoch } = seedPendingCardDocument(database);
    const genesis = createCardDocument({ documentId, initialTitle: "Base" });
    const genesisUpdate = Y.encodeStateAsUpdate(genesis.document);
    const genesisAck = initializeCardDocumentGenesis(database, {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: "genesis",
      clientSessionId: "migration",
      update: genesisUpdate,
    });
    invariant(
      genesisAck.committedSeq === 1 && genesisAck.headSeq === 1 && !genesisAck.duplicate,
      "Document genesis ACK is invalid",
    );

    const hiddenRootClient = new Y.Doc({ guid: documentId });
    Y.applyUpdate(hiddenRootClient, genesisUpdate);
    const hiddenRootUpdate = captureOneUpdate(hiddenRootClient, () => {
      hiddenRootClient.getMap("hidden").set("payload", "invisible state");
    });
    let hiddenRootRejected = false;
    try {
      applyBlockDocumentUpdate(database, {
        documentId,
        storeEpoch,
        generation: 1,
        updateId: "hidden-root",
        clientSessionId: "window-hidden",
        baseHeadSeq: 1,
        touchedBlockIds: [],
        update: hiddenRootUpdate,
      });
    } catch (error) {
      hiddenRootRejected =
        error instanceof BlockDocumentStoreError &&
        error.code === "invalid_document_update";
    } finally {
      hiddenRootClient.destroy();
    }
    invariant(hiddenRootRejected, "unsupported named Y.Doc root was persisted");
    invariant(readDocumentHeadSeq(database, documentId) === 1, "hidden root advanced head");

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
    invariant(
      ackA.committedSeq === 2 && ackB.committedSeq === 3,
      "concurrent client updates were not durably sequenced",
    );

    const concurrentState = loadBlockDocument(database, documentId);
    const concurrentTitle = openCardDocument(concurrentState.document).title.toString();
    const concurrentClientsConverged =
      concurrentTitle.includes(" A") && concurrentTitle.includes(" B");
    invariant(concurrentClientsConverged, "concurrent client changes did not converge");

    const dependentClient = new Y.Doc({ guid: documentId });
    Y.applyUpdate(dependentClient, Y.encodeStateAsUpdate(concurrentState.document));
    concurrentState.document.destroy();
    const firstDependentUpdate = captureOneUpdate(dependentClient, () => {
      const title = openCardDocument(dependentClient).title;
      title.insert(title.length, " 1");
    });
    const secondDependentUpdate = captureOneUpdate(dependentClient, () => {
      const title = openCardDocument(dependentClient).title;
      title.insert(title.length, " 2");
    });

    let missingDependencyRejected = false;
    try {
      applyBlockDocumentUpdate(database, {
        documentId,
        storeEpoch,
        generation: 1,
        updateId: "dependent-2",
        clientSessionId: "window-c",
        baseHeadSeq: 3,
        touchedBlockIds: [],
        update: secondDependentUpdate,
      });
    } catch (error) {
      missingDependencyRejected =
        error instanceof BlockDocumentStoreError &&
        error.code === "document_update_missing_dependencies";
    }
    invariant(missingDependencyRejected, "dependent out-of-order update was not rejected");
    invariant(
      readDocumentHeadSeq(database, documentId) === 3 &&
        readDocumentUpdateCount(database, documentId) === 3,
      "rejected dependent update changed durable state",
    );

    const firstDependencyAck = applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: "dependent-1",
      clientSessionId: "window-c",
      baseHeadSeq: 3,
      touchedBlockIds: [],
      update: firstDependentUpdate,
    });
    const dependencyRetryAck = applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: "dependent-2",
      clientSessionId: "window-c",
      baseHeadSeq: 3,
      touchedBlockIds: [],
      update: secondDependentUpdate,
    });
    const dependencyRetryCommitted =
      firstDependencyAck.committedSeq === 4 &&
      dependencyRetryAck.committedSeq === 5 &&
      dependencyRetryAck.headSeq === 5;
    invariant(dependencyRetryCommitted, "dependent update did not commit after its dependency");

    const bodyGroup = openCardDocument(dependentClient).body.toArray()[0];
    invariant(bodyGroup instanceof Y.XmlElement, "canonical body group is missing");
    const bodyBlock = createParagraphBlock("runtime-paragraph", "Durable body");
    const bodyUpdate = captureOneUpdate(dependentClient, () => {
      (bodyGroup as Y.XmlElement).insert(0, [bodyBlock]);
    });
    const bodyAck = applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: "body-block-1",
      clientSessionId: "window-c",
      baseHeadSeq: 5,
      touchedBlockIds: ["runtime-paragraph"],
      update: bodyUpdate,
    });
    const registeredBodyBlock = database
      .prepare(`
        SELECT block.lifecycle, block.containing_document_id, block_index.projected_seq
        FROM blocks block
        INNER JOIN document_block_index block_index ON block_index.block_id = block.id
        WHERE block.id = 'runtime-paragraph'
      `)
      .get() as
      | {
          lifecycle: string;
          containing_document_id: string;
          projected_seq: number;
        }
      | undefined;
    const bodyBlockRegistered =
      bodyAck.headSeq === 6 &&
      registeredBodyBlock?.lifecycle === "active" &&
      registeredBodyBlock.containing_document_id === documentId &&
      registeredBodyBlock.projected_seq === 6;
    invariant(bodyBlockRegistered, "body Block was not registered atomically with its update");

    const durableWithBody = loadBlockDocument(database, documentId);
    const retypeClient = new Y.Doc({ guid: documentId });
    Y.applyUpdate(retypeClient, Y.encodeStateAsUpdate(durableWithBody.document));
    durableWithBody.document.destroy();
    const retypeGroup = openCardDocument(retypeClient).body.toArray()[0];
    invariant(retypeGroup instanceof Y.XmlElement, "retype probe body group is missing");
    const typedTransitionUpdate = captureOneUpdate(retypeClient, () => {
      (retypeGroup as Y.XmlElement).delete(0, 1);
      (retypeGroup as Y.XmlElement).insert(0, [
        createTypedBlock("runtime-paragraph", "card", "Illegal Card transition"),
      ]);
    });
    let typedTransitionRejected = false;
    try {
      applyBlockDocumentUpdate(database, {
        documentId,
        storeEpoch,
        generation: 1,
        updateId: "typed-transition",
        clientSessionId: "window-retype",
        baseHeadSeq: 6,
        touchedBlockIds: ["runtime-paragraph"],
        update: typedTransitionUpdate,
      });
    } catch (error) {
      typedTransitionRejected =
        error instanceof BlockDocumentStoreError &&
        error.code === "invalid_document_update";
    } finally {
      retypeClient.destroy();
    }
    invariant(typedTransitionRejected, "ordinary update changed a paragraph into a Card");
    invariant(readDocumentHeadSeq(database, documentId) === 6, "typed transition advanced head");

    const collisionUpdate = captureOneUpdate(dependentClient, () => {
      (bodyGroup as Y.XmlElement).insert(1, [
        createParagraphBlock("block-document-runtime-card", "Illegal identity reuse"),
      ]);
    });
    let globalIdentityCollisionRejected = false;
    try {
      applyBlockDocumentUpdate(database, {
        documentId,
        storeEpoch,
        generation: 1,
        updateId: "global-id-collision",
        clientSessionId: "window-c",
        baseHeadSeq: 6,
        touchedBlockIds: ["block-document-runtime-card"],
        update: collisionUpdate,
      });
    } catch (error) {
      globalIdentityCollisionRejected =
        error instanceof BlockDocumentStoreError &&
        error.code === "invalid_document_update";
    }
    invariant(globalIdentityCollisionRejected, "global Block identity collision was accepted");
    invariant(readDocumentHeadSeq(database, documentId) === 6, "identity collision advanced head");

    const beforeDelete = loadBlockDocument(database, documentId);
    const deleteClient = new Y.Doc({ guid: documentId });
    Y.applyUpdate(deleteClient, Y.encodeStateAsUpdate(beforeDelete.document));
    const beforeDeleteStateVector = Y.encodeStateVector(deleteClient);
    const cleanGroup = openCardDocument(deleteClient).body.toArray()[0];
    invariant(cleanGroup instanceof Y.XmlElement, "body Block group is missing before deletion");
    const deleteUpdate = captureOneUpdate(deleteClient, () => {
      (cleanGroup as Y.XmlElement).delete(0, 1);
    });
    const afterLocalDeleteStateVector = Y.encodeStateVector(deleteClient);
    const deleteOnlyStateVectorStable = bytesEqual(
      beforeDeleteStateVector,
      afterLocalDeleteStateVector,
    );
    invariant(
      deleteOnlyStateVectorStable,
      "delete-only probe unexpectedly changed the Yjs state vector",
    );
    beforeDelete.document.destroy();
    const deleteAck = applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: "delete-body-block",
      clientSessionId: "window-d",
      baseHeadSeq: 6,
      touchedBlockIds: ["runtime-paragraph"],
      update: deleteUpdate,
    });
    const deletedRegistry = database
      .prepare("SELECT lifecycle FROM blocks WHERE id = 'runtime-paragraph'")
      .get() as { lifecycle: string } | undefined;
    const deletionPersisted =
      deleteAck.headSeq === 7 &&
      deletedRegistry?.lifecycle === "deleted" &&
      (database
        .prepare("SELECT COUNT(*) AS count FROM document_block_index WHERE document_id = ?")
        .get(documentId) as { count: number }).count === 0;
    invariant(deletionPersisted, "delete-only update did not persist registry/index state");

    const storedSnapshotHash = database
      .prepare(`
        SELECT snapshot_hash
        FROM document_snapshots
        WHERE document_id = ? AND generation = 1 AND snapshot_seq = 1
      `)
      .get(documentId) as { snapshot_hash: string };
    database
      .prepare(`
        UPDATE document_snapshots SET snapshot_hash = 'corrupt'
        WHERE document_id = ? AND generation = 1 AND snapshot_seq = 1
      `)
      .run(documentId);
    let checksumCorruptionRejected = false;
    try {
      loadBlockDocument(database, documentId);
    } catch (error) {
      checksumCorruptionRejected =
        error instanceof BlockDocumentStoreError &&
        error.code === "document_state_corrupt";
    } finally {
      database
        .prepare(`
          UPDATE document_snapshots SET snapshot_hash = ?
          WHERE document_id = ? AND generation = 1 AND snapshot_seq = 1
        `)
        .run(storedSnapshotHash.snapshot_hash, documentId);
    }
    invariant(checksumCorruptionRejected, "snapshot checksum corruption was not rejected");

    const rejectedUpdate = captureOneUpdate(deleteClient, () => {
      const title = openCardDocument(deleteClient).title;
      title.insert(title.length, " rejected");
    });
    database.exec(`
      CREATE TRIGGER reject_block_document_runtime_update
      BEFORE INSERT ON document_updates
      WHEN NEW.update_id = 'reject-me'
      BEGIN
        SELECT RAISE(ABORT, 'injected durable document write failure');
      END;
    `);
    let rollbackVerified = false;
    try {
      applyBlockDocumentUpdate(database, {
        documentId,
        storeEpoch,
        generation: 1,
        updateId: "reject-me",
        clientSessionId: "window-c",
        baseHeadSeq: 7,
        touchedBlockIds: [],
        update: rejectedUpdate,
      });
    } catch (error) {
      rollbackVerified =
        error instanceof Error &&
        error.message.includes("injected durable document write failure");
    } finally {
      database.exec("DROP TRIGGER reject_block_document_runtime_update");
    }
    invariant(rollbackVerified, "injected document write failure was not surfaced");
    invariant(
      readDocumentHeadSeq(database, documentId) === 7 &&
        readDocumentUpdateCount(database, documentId) === 7,
      "failed document write changed durable state",
    );

    database.close();
    database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    const reloaded = loadBlockDocument(database, documentId);
    const reloadedTitle = openCardDocument(reloaded.document).title.toString();
    const restartVerified =
      reloaded.head.headSeq === 7 &&
      reloadedTitle.includes(" A") &&
      reloadedTitle.includes(" B") &&
      reloadedTitle.includes(" 1") &&
      reloadedTitle.includes(" 2") &&
      !reloadedTitle.includes(" rejected");
    invariant(restartVerified, "restart did not reconstruct the committed Document head");

    const replicaA = new Y.Doc({ guid: documentId });
    const replicaB = new Y.Doc({ guid: documentId });
    const syncA = getBlockDocumentSyncStep(
      database,
      documentId,
      Y.encodeStateVector(replicaA),
    );
    const syncB = getBlockDocumentSyncStep(
      database,
      documentId,
      Y.encodeStateVector(replicaB),
    );
    Y.applyUpdate(replicaA, syncA.update);
    Y.applyUpdate(replicaB, syncB.update);
    invariant(
      openCardDocument(replicaA).title.toString() === reloadedTitle &&
        openCardDocument(replicaB).title.toString() === reloadedTitle,
      "fresh clients did not converge through state-vector sync",
    );

    let duplicatePayloadNoopRejected = false;
    try {
      applyBlockDocumentUpdate(database, {
        documentId,
        storeEpoch,
        generation: 1,
        updateId: "same-payload-new-id",
        clientSessionId: "window-a",
        baseHeadSeq: 7,
        touchedBlockIds: [],
        update: updateA,
      });
    } catch (error) {
      duplicatePayloadNoopRejected =
        error instanceof BlockDocumentStoreError &&
        error.code === "invalid_document_update";
    }
    invariant(duplicatePayloadNoopRejected, "idempotent payload with a new ID advanced head");

    database
      .prepare("UPDATE blocks SET lifecycle = 'archived' WHERE id = ?")
      .run("block-document-runtime-card");

    const duplicateAck = applyBlockDocumentUpdate(database, {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: "client-b-1",
      clientSessionId: "window-b",
      baseHeadSeq: 1,
      touchedBlockIds: [],
      update: updateB,
    });
    invariant(duplicateAck.duplicate, "committed update retry was not idempotent");
    const archivedDuplicateAcked = duplicateAck.duplicate;
    invariant(
      duplicateAck.committedSeq === 3 && duplicateAck.headSeq === 7,
      "duplicate ACK did not distinguish committed sequence from observed head",
    );

    const result: DocumentProbeResult = {
      headSeq: reloaded.head.headSeq,
      committedUpdates: readDocumentUpdateCount(database, documentId),
      concurrentClientsConverged,
      missingDependencyRejected,
      hiddenRootRejected,
      dependencyRetryCommitted,
      bodyBlockRegistered,
      globalIdentityCollisionRejected,
      typedTransitionRejected,
      deleteOnlyStateVectorStable,
      deletionPersisted,
      checksumCorruptionRejected,
      duplicatePayloadNoopRejected,
      archivedDuplicateAcked,
      rollbackVerified,
      restartVerified,
      duplicateCommittedSeq: duplicateAck.committedSeq,
      duplicateObservedHeadSeq: duplicateAck.headSeq,
    };

    replicaA.destroy();
    replicaB.destroy();
    reloaded.document.destroy();
    deleteClient.destroy();
    dependentClient.destroy();
    clientA.destroy();
    clientB.destroy();
    genesis.document.destroy();
    database.close();
    return result;
  });

const run = async (): Promise<void> => {
  const foundation = await runFoundationProbe();
  const documents = await runDocumentStoreProbe();
  process.stdout.write(`${JSON.stringify({ foundation, documents })}\n`);
};

void run().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
