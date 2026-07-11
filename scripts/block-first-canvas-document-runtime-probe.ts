import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  MAX_CARD_DOCUMENT_UPDATE_BYTES,
  applyCanvasSceneSnapshot,
  inspectCanvasDocument,
  openCanvasDocument,
  primaryCanvasBlockId,
  primaryCanvasDocumentId,
} from "../src/shared/block-documents";
import { parseAssetSource } from "../src/shared/assets";
import { DOCUMENT_VERSION_CONTRACT_VERSION } from "../src/shared/block-documents/document-history";
import { resetAssetPathCacheForTests } from "../src/main/local-store/assets";
import {
  BackupStoreValidationError,
  validateBackupStore,
} from "../src/main/local-store/backup-store-validation";
import {
  BlockDocumentStoreError,
  applyBlockDocumentUpdate,
  compactBlockDocument,
  loadPrimaryBlockDocument,
} from "../src/main/local-store/block-document-store";
import { restoreDocumentVersion } from "../src/main/local-store/block-document-operations";
import {
  DocumentSecondaryProjectionError,
  listDocumentAssetRefs,
  searchDocumentBlockUnits,
} from "../src/main/local-store/block-document-projections";
import {
  CanvasSceneMaterializationStoreError,
  readCanvasSceneMaterialization,
} from "../src/main/local-store/canvas-scene-materializations";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import {
  createDocumentVersionCheckpoint,
  prepareDocumentVersionRestore,
} from "../src/main/local-store/document-versions";
import { ensurePrimaryCanvasDocument } from "../src/main/local-store/primary-canvas-document";
import { createProject } from "../src/main/local-store/projects";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const readStoreEpoch = (): string =>
  (
    getDb()
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string }
  ).store_epoch;

const replacePrimaryCanvasWithLegacyFixture = (
  projectId: string,
  scene: {
    readonly elements: readonly unknown[];
    readonly appState: Readonly<Record<string, unknown>>;
    readonly files: Readonly<Record<string, unknown>>;
  },
): void => {
  const now = new Date().toISOString();
  const blockId = primaryCanvasBlockId(projectId);
  const documentId = primaryCanvasDocumentId(projectId);
  getDb()
    .transaction(() => {
      getDb().exec(`
        CREATE TABLE IF NOT EXISTS canvas (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          elements TEXT NOT NULL DEFAULT '[]',
          app_state TEXT NOT NULL DEFAULT '{}',
          files TEXT NOT NULL DEFAULT '{}',
          updated TEXT NOT NULL
        )
      `);
      getDb()
        .prepare("DELETE FROM block_documents WHERE block_id = ?")
        .run(blockId);
      getDb().prepare("DELETE FROM documents WHERE id = ?").run(documentId);
      getDb().prepare("DELETE FROM blocks WHERE id = ?").run(blockId);
      getDb()
        .prepare(
          `
          INSERT INTO canvas (project_id, elements, app_state, files, updated)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET
            elements = excluded.elements,
            app_state = excluded.app_state,
            files = excluded.files,
            updated = excluded.updated
        `,
        )
        .run(
          projectId,
          JSON.stringify(scene.elements),
          JSON.stringify(scene.appState),
          JSON.stringify(scene.files),
          now,
        );
    })
    .immediate();
};

const textElement = (
  id: string,
  text: string,
  version: number,
  index: string,
) => ({
  id,
  type: "text",
  version,
  versionNonce: 100,
  isDeleted: false,
  index,
  text,
  x: 0,
  y: 0,
});

const makeClientUpdate = (
  source: Y.Doc,
  mutate: (document: Y.Doc) => void,
): Uint8Array => {
  const sourceUpdate = Y.encodeStateAsUpdate(source);
  const sourceVector = Y.encodeStateVector(source);
  const client = new Y.Doc({ guid: source.guid });
  try {
    Y.applyUpdate(client, sourceUpdate);
    mutate(client);
    return Y.encodeStateAsUpdate(client, sourceVector);
  } finally {
    client.destroy();
  }
};

const readCanvas = (documentId: string) => {
  const loaded = loadPrimaryBlockDocument(getDb(), documentId);
  try {
    return {
      headSeq: loaded.head.headSeq,
      materialization: inspectCanvasDocument(loaded.document).materialization,
      state: Y.encodeStateAsUpdate(loaded.document),
    };
  } finally {
    loaded.document.destroy();
  }
};

const main = async (): Promise<void> => {
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-canvas-document-probe-"),
  );
  process.env.NODEX_DIR = directory;
  resetAssetPathCacheForTests();
  try {
    await initializeDatabase();
    const project = createProject({ name: "Canvas Document probe" });
    const storeEpoch = readStoreEpoch();
    const blockId = primaryCanvasBlockId(project.id);
    const documentId = primaryCanvasDocumentId(project.id);
    const largeText = "canvas-state-".repeat(60_000);
    const legacyAssetBytes = Buffer.from("legacy Canvas image bytes");
    replacePrimaryCanvasWithLegacyFixture(project.id, {
      elements: [
        textElement("checkpoint-a", `${largeText}:a`, 1, "a0"),
        textElement("checkpoint-b", `${largeText}:b`, 1, "a1"),
        textElement("checkpoint-c", `${largeText}:c`, 1, "a2"),
        {
          id: "legacy-image",
          type: "image",
          fileId: "canvas-file",
          version: 1,
          versionNonce: 100,
          isDeleted: false,
          index: "a3",
          x: 0,
          y: 0,
        },
      ],
      appState: { gridModeEnabled: true, viewBackgroundColor: "#ffffff" },
      files: {
        "canvas-file": {
          id: "canvas-file",
          mimeType: "image/jpeg",
          dataURL: `data:image/png;base64,${legacyAssetBytes.toString("base64")}`,
          created: 1,
        },
      },
    });
    closeDatabase();
    await initializeDatabase();
    const descriptor = ensurePrimaryCanvasDocument(getDb(), project.id);
    invariant(
      descriptor.ownerBlockId === blockId &&
        descriptor.documentId === documentId &&
        descriptor.headSeq === 1,
      "Production primary Canvas bootstrap did not create deterministic ownership",
    );
    invariant(
      !getDb()
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'canvas'`,
        )
        .get(),
      "Production startup retained the legacy whole-scene Canvas table",
    );
    const bootstrapped = readCanvas(documentId);
    const migratedFile = bootstrapped.materialization.files["canvas-file"];
    const parsedMigratedAsset = migratedFile
      ? parseAssetSource(migratedFile.source)
      : null;
    invariant(
      migratedFile?.mimeType === "image/png" && parsedMigratedAsset,
      "Legacy Canvas migration trusted stale MIME instead of materialized MIME",
    );
    const assetPath = path.join(
      directory,
      "assets",
      parsedMigratedAsset.fileName,
    );
    const originalAssetBytes = fs.readFileSync(assetPath);
    const genesisReceipt = getDb()
      .prepare(
        `
        SELECT update_byte_length
        FROM document_update_receipts
        WHERE document_id = ? AND generation = 1 AND seq = 1
      `,
      )
      .get(documentId) as { readonly update_byte_length: number };
    invariant(
      genesisReceipt.update_byte_length > MAX_CARD_DOCUMENT_UPDATE_BYTES,
      "Trusted production Canvas genesis did not cross the public update fence",
    );

    const checkpoint = createDocumentVersionCheckpoint(getDb(), {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      projectId: project.id,
      storeEpoch,
      documentId,
      expectedGeneration: 1,
      expectedHeadSeq: 1,
      cause: "runtime_probe",
      actor: { surface: "canvas-probe" },
    });
    invariant(
      checkpoint.checkpoint.materializationKind === "canvas_scene",
      "Canvas checkpoint was routed through the block-tree codec",
    );
    invariant(
      checkpoint.checkpoint.byteLength > MAX_CARD_DOCUMENT_UPDATE_BYTES,
      "Canvas checkpoint did not retain the trusted oversized state",
    );
    const initial = loadPrimaryBlockDocument(getDb(), documentId);
    let shrinkUpdate: Uint8Array;
    try {
      shrinkUpdate = makeClientUpdate(initial.document, (document) => {
        const current = inspectCanvasDocument(document).materialization;
        applyCanvasSceneSnapshot(openCanvasDocument({ documentId, document }), {
          elements: current.elements.map((element) =>
            element.type === "text"
              ? {
                  ...element,
                  version: 2,
                  versionNonce: 90,
                  text: `Changed ${String(element.id)}`,
                }
              : element,
          ),
          appState: current.appState,
          files: current.files,
        });
      });
    } finally {
      initial.document.destroy();
    }
    const shrinkRequest = {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: "canvas-probe:shrink",
      clientSessionId: "canvas-probe:shrink-client",
      baseHeadSeq: 1,
      touchedBlockIds: [],
      update: shrinkUpdate,
    } as const;
    fs.rmSync(assetPath);
    let missingAssetError: unknown;
    try {
      applyBlockDocumentUpdate(getDb(), shrinkRequest);
    } catch (error) {
      missingAssetError = error;
    }
    invariant(
      missingAssetError instanceof DocumentSecondaryProjectionError &&
        missingAssetError.code === "projection_source_corrupt" &&
        readCanvas(documentId).headSeq === 1,
      "Canvas projection did not lstat every unchanged managed asset atomically",
    );
    fs.writeFileSync(assetPath, originalAssetBytes);
    const shrinkAck = applyBlockDocumentUpdate(getDb(), shrinkRequest);
    invariant(shrinkAck.headSeq === 2, "Retried Canvas shrink did not commit");

    const shortScene = loadPrimaryBlockDocument(getDb(), documentId);
    let oversizedPublicUpdate: Uint8Array;
    try {
      oversizedPublicUpdate = makeClientUpdate(shortScene.document, (document) => {
        const current = inspectCanvasDocument(document).materialization;
        applyCanvasSceneSnapshot(openCanvasDocument({ documentId, document }), {
          elements: [
            ...current.elements,
            textElement("oversized-a", `${largeText}:oversized-a`, 1, "b0"),
            textElement("oversized-b", `${largeText}:oversized-b`, 1, "b1"),
            textElement("oversized-c", `${largeText}:oversized-c`, 1, "b2"),
          ],
          appState: current.appState,
          files: current.files,
        });
      });
    } finally {
      shortScene.document.destroy();
    }
    invariant(
      oversizedPublicUpdate.byteLength > MAX_CARD_DOCUMENT_UPDATE_BYTES,
      "Canvas public-fence probe did not construct an oversized update",
    );
    let oversizedPublicError: unknown;
    try {
      applyBlockDocumentUpdate(getDb(), {
        documentId,
        storeEpoch,
        generation: 1,
        updateId: "canvas-probe:oversized-public",
        clientSessionId: "canvas-probe:oversized-public-client",
        baseHeadSeq: 2,
        touchedBlockIds: [],
        update: oversizedPublicUpdate,
      });
    } catch (error) {
      oversizedPublicError = error;
    }
    invariant(
      oversizedPublicError instanceof BlockDocumentStoreError &&
        oversizedPublicError.code === "invalid_document_update" &&
        readCanvas(documentId).headSeq === 2,
      "Ordinary Canvas transport bypassed the 2 MiB public update fence",
    );

    const concurrentBase = loadPrimaryBlockDocument(getDb(), documentId);
    let firstUpdate: Uint8Array;
    let secondUpdate: Uint8Array;
    try {
      firstUpdate = makeClientUpdate(concurrentBase.document, (document) => {
        const current = inspectCanvasDocument(document).materialization;
        applyCanvasSceneSnapshot(openCanvasDocument({ documentId, document }), {
          elements: [textElement("checkpoint-a", "First client", 3, "a0")],
          appState: current.appState,
          files: current.files,
        });
      });
      secondUpdate = makeClientUpdate(concurrentBase.document, (document) => {
        const current = inspectCanvasDocument(document).materialization;
        applyCanvasSceneSnapshot(openCanvasDocument({ documentId, document }), {
          elements: [
            ...current.elements,
            textElement("second-client", "Second client", 1, "b0"),
          ],
          appState: current.appState,
          files: current.files,
        });
      });
    } finally {
      concurrentBase.document.destroy();
    }
    const mutatedAssetBytes = Buffer.concat([
      originalAssetBytes,
      Buffer.from("-size-changed"),
    ]);
    fs.writeFileSync(assetPath, mutatedAssetBytes);
    const firstAck = applyBlockDocumentUpdate(getDb(), {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: "canvas-probe:first",
      clientSessionId: "canvas-probe:first-client",
      baseHeadSeq: 2,
      touchedBlockIds: [],
      update: firstUpdate,
    });
    const projectedAssetEvidence = getDb()
      .prepare(
        `
        SELECT asset_hash, byte_length
        FROM canvas_scene_file_refs
        WHERE document_id = ? AND file_id = 'canvas-file'
      `,
      )
      .get(documentId) as {
      readonly asset_hash: string;
      readonly byte_length: number;
    };
    invariant(
      projectedAssetEvidence.byte_length === mutatedAssetBytes.byteLength &&
        projectedAssetEvidence.asset_hash ===
          createHash("sha256").update(mutatedAssetBytes).digest("hex"),
      "Canvas projection did not reread a managed asset after lstat size change",
    );
    const secondAck = applyBlockDocumentUpdate(getDb(), {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: "canvas-probe:second",
      clientSessionId: "canvas-probe:second-client",
      baseHeadSeq: 2,
      touchedBlockIds: [],
      update: secondUpdate,
    });
    invariant(
      firstAck.headSeq === 3 && secondAck.headSeq === 4,
      "Concurrent Canvas updates did not append as independent CRDT updates",
    );
    const converged = readCanvas(documentId);
    invariant(
      converged.materialization.elements.some(
        (element) => element.text === "First client",
      ) &&
        converged.materialization.elements.some(
          (element) => element.text === "Second client",
        ),
      "Canvas clients did not converge without whole-scene overwrite",
    );
    invariant(
      searchDocumentBlockUnits(getDb(), {
        projectId: project.id,
        query: "Second client",
        documentId,
      }).length === 1,
      "Canvas marker/plain-text projection was not searchable",
    );
    const assetRefs = listDocumentAssetRefs(getDb(), {
      projectId: project.id,
      documentId,
    });
    invariant(
      assetRefs.length === 1 &&
        assetRefs[0]?.role === "canvas_file" &&
        assetRefs[0]?.assetUri === migratedFile.source,
      "Canvas managed asset was not exposed through the shared asset query",
    );
    const storedProjection = readCanvasSceneMaterialization(
      getDb(),
      documentId,
    );
    invariant(storedProjection, "Canvas durable projection is missing");
    getDb()
      .prepare(
        "UPDATE canvas_scene_materializations SET plain_text = ? WHERE document_id = ?",
      )
      .run("tampered projection", documentId);
    let corruptProjectionError: unknown;
    try {
      readCanvasSceneMaterialization(getDb(), documentId);
    } catch (error) {
      corruptProjectionError = error;
    }
    invariant(
      corruptProjectionError instanceof CanvasSceneMaterializationStoreError,
      "Stored Canvas derived projection corruption did not fail closed",
    );
    getDb()
      .prepare(
        "UPDATE canvas_scene_materializations SET plain_text = ? WHERE document_id = ?",
      )
      .run(storedProjection.materialization.plainText, documentId);

    let faultObserved = false;
    try {
      restoreDocumentVersion(
        getDb(),
        {
          version: DOCUMENT_VERSION_CONTRACT_VERSION,
          mutationId: "canvas-probe:restore-fault",
          projectId: project.id,
          storeEpoch,
          documentId,
          versionId: checkpoint.checkpoint.versionId,
          generation: 1,
          expectedHeadSeq: 4,
          clientSessionId: "canvas-probe:restore-client",
          actor: { surface: "canvas-probe" },
        },
        {
          writeFence: {
            leaseId: "canvas-probe:fault-lease",
            documentId,
            generation: 1,
            headSeq: 4,
          },
          faultInjector: (point) => {
            if (point === "before_commit") throw new Error("restore fault");
          },
        },
      );
    } catch (error) {
      faultObserved = error instanceof Error && error.message === "restore fault";
    }
    invariant(faultObserved, "Canvas restore fault was not injected");
    invariant(readCanvas(documentId).headSeq === 4, "Faulted restore escaped rollback");

    const restore = restoreDocumentVersion(
      getDb(),
      {
        version: DOCUMENT_VERSION_CONTRACT_VERSION,
        mutationId: "canvas-probe:restore",
        projectId: project.id,
        storeEpoch,
        documentId,
        versionId: checkpoint.checkpoint.versionId,
        generation: 1,
        expectedHeadSeq: 4,
        clientSessionId: "canvas-probe:restore-client",
        actor: { surface: "canvas-probe" },
      },
      {
        writeFence: {
          leaseId: "canvas-probe:restore-lease",
          documentId,
          generation: 1,
          headSeq: 4,
        },
      },
    );
    invariant(restore.ok && restore.value.headSeq === 5, "Canvas restore failed");
    const restored = readCanvas(documentId);
    const restoredCheckpoint = restored.materialization.elements.find(
      (element) => element.id === "checkpoint-a",
    );
    const removedSecondClient = restored.materialization.elements.find(
      (element) => element.id === "second-client",
    );
    invariant(
      restoredCheckpoint?.text === `${largeText}:a` &&
        (restoredCheckpoint.version as number) > 3 &&
        removedSecondClient?.isDeleted === true,
      "Canvas checkpoint was not restored as monotonic forward semantics",
    );
    const restoreReceipt = getDb()
      .prepare(
        `
        SELECT update_byte_length
        FROM document_update_receipts
        WHERE document_id = ? AND generation = 1 AND seq = 5
      `,
      )
      .get(documentId) as { readonly update_byte_length: number };
    invariant(
      restoreReceipt.update_byte_length > MAX_CARD_DOCUMENT_UPDATE_BYTES,
      "Trusted Canvas forward restore did not cross the public update fence",
    );
    const alreadyCurrent = prepareDocumentVersionRestore(getDb(), {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      mutationId: "canvas-probe:restore-again",
      projectId: project.id,
      storeEpoch,
      documentId,
      versionId: checkpoint.checkpoint.versionId,
      generation: 1,
      expectedHeadSeq: 5,
      actor: { surface: "canvas-probe" },
    });
    invariant(
      alreadyCurrent.kind === "already_current",
      "Canvas semantic restore produced a repair loop",
    );
    const compacted = compactBlockDocument(getDb(), {
      documentId,
      expectedGeneration: 1,
      expectedHeadSeq: 5,
    });
    invariant(compacted.snapshotSeq === 5, "Canvas compaction did not checkpoint head");
    invariant(
      JSON.stringify(getDb().pragma("foreign_key_check")) === "[]",
      "Canvas projection ownership foreign keys are invalid",
    );

    closeDatabase();
    await initializeDatabase();
    const restarted = readCanvas(documentId);
    invariant(
      restarted.headSeq === 5 &&
        restarted.materialization.elements.find(
          (element) => element.id === "second-client",
        )?.isDeleted === true,
      "Canvas snapshot plus tail did not survive restart",
    );
    closeDatabase();
    const sameSizeCorruption = Buffer.from(mutatedAssetBytes);
    sameSizeCorruption[0] = (sameSizeCorruption[0] ?? 0) ^ 0xff;
    fs.writeFileSync(assetPath, sameSizeCorruption);
    let corruptBackupAssetError: unknown;
    try {
      validateBackupStore(getDatabasePath(), {
        requireCurrentSchema: true,
        assetsPath: path.join(directory, "assets"),
      });
    } catch (error) {
      corruptBackupAssetError = error;
    }
    invariant(
      corruptBackupAssetError instanceof BackupStoreValidationError,
      "Backup validation trusted stale Canvas asset hash evidence",
    );
    fs.writeFileSync(assetPath, mutatedAssetBytes);
    const backup = validateBackupStore(getDatabasePath(), {
      requireCurrentSchema: true,
      assetsPath: path.join(directory, "assets"),
    });
    invariant(
      backup.managedAssetCount === 1,
      "Backup validation ignored Canvas managed assets",
    );
    process.stdout.write(
      `${JSON.stringify({
        sceneGraph: true,
        primaryCanvas: true,
        legacyCanvasRetired: true,
        trustedOversizedGenesis: true,
        publicUpdateFence: true,
        concurrentClients: true,
        durableAck: true,
        markerSearch: true,
        managedAsset: true,
        assetLstatRollback: true,
        assetSizeRehash: true,
        projectionCorruptionFence: true,
        forwardRestore: true,
        trustedOversizedRestore: true,
        restoreFaultRollback: true,
        compaction: true,
        restart: true,
        foreignKeys: true,
        backup: true,
        backupAssetEvidence: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
    resetAssetPathCacheForTests();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main();
