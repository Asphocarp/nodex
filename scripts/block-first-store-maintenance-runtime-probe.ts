import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as Y from "yjs";
import { blockMutationWriter } from "../src/main/block-mutation-writer";
import { documentSyncHub } from "../src/main/document-sync-runtime";
import * as backupService from "../src/main/local-store/backups";
import { createProject } from "../src/main/local-store/projects";
import { createCard } from "../src/main/local-store/cards";
import {
  closeDatabase,
  initializeDatabase,
} from "../src/main/local-store/database";
import { ensureDatabase } from "../src/main/local-store/schema";
import {
  rotateBackupStoreEpoch,
  validateBackupStore,
} from "../src/main/local-store/backup-store-validation";
import {
  advanceStoreRestoreJournal,
  createStoreRestoreJournal,
  recoverInterruptedStoreRestore,
  type StoreRestorePhase,
} from "../src/main/local-store/store-restore-journal";
import {
  storeMaintenanceGate,
  StoreMaintenanceInProgressError,
} from "../src/main/local-store/store-maintenance-gate";
import { materializeLocalResource } from "../src/main/local-store/assets";
import {
  NodexYProvider,
  type DocumentSyncAdapter,
} from "../src/renderer/lib/nodex-y-provider";
import type {
  DocumentAwarenessPublishRequest,
  DocumentRelocationLeaseResponseRequest,
  DocumentSyncRealtimeEvent,
  DocumentSyncSubscribeRequest,
} from "../src/shared/block-documents/document-sync";
import type { DocumentSyncClientTarget } from "../src/main/document-sync-hub";
import type {
  DocumentCheckpointBoundary,
  DocumentLocalCheckpoint,
  DocumentLocalCheckpointStore,
} from "../src/renderer/lib/document-local-checkpoint";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Store maintenance runtime probe did not settle");
};

let targetSequence = 9_000;

class ProbeTarget extends EventEmitter implements DocumentSyncClientTarget {
  readonly id = ++targetSequence;
  private destroyed = false;
  readonly documentListeners = new Set<
    (event: DocumentSyncRealtimeEvent) => void
  >();

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed || channel !== "document-sync:event") return;
    const event = args[0] as DocumentSyncRealtimeEvent;
    this.documentListeners.forEach((listener) => listener(event));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class HubAdapter implements DocumentSyncAdapter {
  readonly target = new ProbeTarget();

  sync = async (request: Parameters<DocumentSyncAdapter["sync"]>[0]) =>
    documentSyncHub.sync(this.target, request);

  applyUpdate = async (
    request: Parameters<DocumentSyncAdapter["applyUpdate"]>[0],
  ) => documentSyncHub.applyUpdate(this.target, request);

  publishAwareness = async (request: DocumentAwarenessPublishRequest) =>
    documentSyncHub.publishAwareness(this.target, request);

  respondToRelocationLease = async (
    request: DocumentRelocationLeaseResponseRequest,
  ) => documentSyncHub.respondToRelocationLease(this.target, request);

  subscribe = (
    request: DocumentSyncSubscribeRequest,
    listener: (event: DocumentSyncRealtimeEvent) => void,
  ): (() => void) => {
    this.target.documentListeners.add(listener);
    const subscribed = documentSyncHub.subscribe(this.target, request);
    if (!subscribed.ok) throw new Error(subscribed.error.message);
    return () => {
      this.target.documentListeners.delete(listener);
      documentSyncHub.unsubscribe(this.target, request);
    };
  };
}

const checkpointKey = (boundary: DocumentCheckpointBoundary): string =>
  JSON.stringify([
    boundary.documentId,
    boundary.storeEpoch,
    boundary.generation,
  ]);

class ProbeCheckpointStore implements DocumentLocalCheckpointStore {
  readonly values = new Map<string, DocumentLocalCheckpoint>();
  clearCount = 0;

  read = async (boundary: DocumentCheckpointBoundary) =>
    this.values.get(checkpointKey(boundary)) ?? null;

  write = async (checkpoint: DocumentLocalCheckpoint) => {
    this.values.set(checkpointKey(checkpoint), {
      ...checkpoint,
      state: checkpoint.state.slice(),
    });
  };

  clearDocument = async (documentId: string) => {
    this.clearCount += 1;
    for (const [key, value] of this.values) {
      if (value.documentId === documentId) this.values.delete(key);
    }
  };
}

const moveIfPresent = (source: string, destination: string): void => {
  if (fs.existsSync(source)) fs.renameSync(source, destination);
};

const simulateCrashRecovery = (
  directory: string,
  phase: StoreRestorePhase,
): "none" | "rolled_back" | "committed" => {
  process.env.NODEX_DIR = directory;
  ensureDatabase();
  const databasePath = path.join(directory, "nodex.db");
  rotateBackupStoreEpoch(databasePath, () => "epoch-old");
  const assetsPath = path.join(directory, "assets");
  fs.mkdirSync(assetsPath, { recursive: true });
  fs.writeFileSync(path.join(assetsPath, "marker.txt"), "old", "utf8");

  const backupsRoot = path.join(directory, "backups");
  const staging = path.join(backupsRoot, ".restore-runtime");
  const rollback = path.join(backupsRoot, ".rollback-runtime");
  fs.mkdirSync(path.join(staging, "assets"), { recursive: true });
  fs.mkdirSync(rollback, { recursive: true });
  fs.copyFileSync(databasePath, path.join(staging, "nodex.db"));
  rotateBackupStoreEpoch(
    path.join(staging, "nodex.db"),
    () => "epoch-new",
  );
  fs.writeFileSync(path.join(staging, "assets", "marker.txt"), "new", "utf8");
  let journal = createStoreRestoreJournal({
    backupId: "runtime",
    stagingDirectoryPath: staging,
    rollbackDirectoryPath: rollback,
  });
  const advance = (next: StoreRestorePhase) => {
    journal = advanceStoreRestoreJournal(journal, next);
  };
  if (phase !== "prepared") advance("rollback_started");
  if (phase === "rollback_started") {
    moveIfPresent(databasePath, path.join(rollback, "nodex.db"));
  }
  if (
    phase === "install_started" ||
    phase === "epoch_rotating" ||
    phase === "committed"
  ) {
    moveIfPresent(databasePath, path.join(rollback, "nodex.db"));
    moveIfPresent(`${databasePath}-wal`, path.join(rollback, "nodex.db-wal"));
    moveIfPresent(`${databasePath}-shm`, path.join(rollback, "nodex.db-shm"));
    moveIfPresent(assetsPath, path.join(rollback, "assets"));
    moveIfPresent(path.join(staging, "nodex.db"), databasePath);
    advance("install_started");
  }
  if (phase === "epoch_rotating" || phase === "committed") {
    moveIfPresent(path.join(staging, "assets"), assetsPath);
    advance("epoch_rotating");
  }
  if (phase === "committed") advance("committed");

  const recovered = recoverInterruptedStoreRestore();
  const expectedEpoch = phase === "committed" ? "epoch-new" : "epoch-old";
  const validated = validateBackupStore(databasePath);
  invariant(validated.storeEpoch === expectedEpoch, `${phase} epoch recovery failed`);
  invariant(
    fs.readFileSync(path.join(assetsPath, "marker.txt"), "utf8") ===
      (phase === "committed" ? "new" : "old"),
    `${phase} asset recovery failed`,
  );
  return recovered;
};

const run = async (): Promise<void> => {
  const previousDir = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-store-maintenance-runtime-"),
  );
  process.env.NODEX_DIR = directory;
  const providers: NodexYProvider[] = [];
  const documents: Y.Doc[] = [];
  try {
    await initializeDatabase();
    const project = createProject({ name: "Store maintenance" });
    const assetsPath = path.join(directory, "assets");
    fs.mkdirSync(assetsPath, { recursive: true });
    fs.writeFileSync(path.join(assetsPath, "before.txt"), "before", "utf8");
    const card = await createCard(project.id, "draft", {
      title: "Backup title",
      description:
        '<attachment kind="file" mode="materialized" source="nodex://assets/before.txt" name="before.txt" mime="text/plain" bytes="6" />',
    });
    closeDatabase();

    const prepared = await blockMutationWriter.prepareOwnedBlockDocument(
      project.id,
      card.id,
    );
    invariant(prepared.ok, "Card Document was not prepared");
    const descriptor = prepared.value;

    const checkpoints = [new ProbeCheckpointStore(), new ProbeCheckpointStore()];
    for (let index = 0; index < 2; index += 1) {
      const document = new Y.Doc({ guid: descriptor.documentId });
      const provider = new NodexYProvider({
        documentId: descriptor.documentId,
        document,
        adapter: new HubAdapter(),
        clientSessionId: `store-maintenance-window-${index + 1}`,
        expectedStoreEpoch: descriptor.storeEpoch,
        expectedGeneration: descriptor.generation,
        localCheckpointStore: checkpoints[index],
        autoConnect: false,
      });
      documents.push(document);
      providers.push(provider);
      await provider.connect();
    }
    await waitUntil(() => providers.every((provider) => provider.getStatus().phase === "synced"));

    const backup = await backupService.createBackup({
      trigger: "manual",
      label: "before concurrent edits",
    });
    const backupDirectory = path.join(directory, "backups", backup.id);
    const backedUpAsset = path.join(backupDirectory, "assets", "before.txt");
    const heldAsset = path.join(directory, "held-before.txt");
    fs.renameSync(backedUpAsset, heldAsset);
    let missingAssetRejected = false;
    try {
      validateBackupStore(path.join(backupDirectory, "nodex.db"));
    } catch {
      missingAssetRejected = true;
    } finally {
      fs.renameSync(heldAsset, backedUpAsset);
    }
    invariant(missingAssetRejected, "Dangling managed asset backup was accepted");
    const symlinkPath = path.join(backupDirectory, "assets", "escape.txt");
    fs.symlinkSync(path.join(directory, "late.txt"), symlinkPath);
    let assetSymlinkRejected = false;
    try {
      validateBackupStore(path.join(backupDirectory, "nodex.db"));
    } catch {
      assetSymlinkRejected = true;
    } finally {
      fs.rmSync(symlinkPath, { force: true });
    }
    invariant(assetSymlinkRejected, "Symlinked managed asset backup was accepted");
    documents[0].getText("title").insert(0, "Left ");
    documents[1].getText("title").insert(0, "Right ");
    fs.writeFileSync(path.join(assetsPath, "after.txt"), "after", "utf8");
    await waitUntil(
      () =>
        providers.every((provider) => provider.getStatus().phase === "synced") &&
        documents[0].getText("title").toString() ===
          documents[1].getText("title").toString(),
    );

    const maintenance = await storeMaintenanceGate.beginMaintenance();
    let assetGateRejected = false;
    try {
      const localFile = path.join(directory, "late.txt");
      fs.writeFileSync(localFile, "late", "utf8");
      materializeLocalResource(localFile);
    } catch (error) {
      assetGateRejected = error instanceof StoreMaintenanceInProgressError;
    } finally {
      maintenance.release();
    }
    invariant(assetGateRejected, "Managed asset mutation escaped maintenance gate");

    const restored = await backupService.restoreBackup({
      backupId: backup.id,
      confirm: true,
      createSafetyBackup: true,
    });
    invariant(
      restored.success && Boolean(restored.safetyBackupId),
      "Backup restore did not create its in-fence safety snapshot",
    );
    await waitUntil(() =>
      providers.every((provider) => provider.getStatus().phase === "reset-required"),
    );
    invariant(
      checkpoints.every((checkpoint) => checkpoint.clearCount > 0),
      "Restore did not clear both provider checkpoints",
    );
    invariant(fs.existsSync(path.join(assetsPath, "before.txt")), "Old asset missing");
    invariant(!fs.existsSync(path.join(assetsPath, "after.txt")), "New asset crossed restore");

    const restoredDescriptor = (
      await blockMutationWriter.getOwnedDocumentDescriptor(project.id, card.id)
    ).result;
    invariant(
      restoredDescriptor.storeEpoch !== descriptor.storeEpoch,
      "Restore did not rotate store epoch",
    );
    const stale = await blockMutationWriter.applyBlockDocumentUpdate({
      documentId: descriptor.documentId,
      storeEpoch: descriptor.storeEpoch,
      generation: descriptor.generation,
      updateId: "stale-after-restore",
      clientSessionId: "stale-window",
      baseHeadSeq: descriptor.headSeq,
      touchedBlockIds: [],
      update: new Uint8Array([0]),
    });
    invariant(
      !stale.ok && stale.error.code === "store_epoch_mismatch",
      "Old epoch update was not rejected",
    );

    const corruptTarget = await backupService.createBackup({ trigger: "manual" });
    fs.writeFileSync(
      path.join(directory, "backups", corruptTarget.id, "nodex.db"),
      "corrupt",
    );
    let rollbackRejected = false;
    try {
      await backupService.restoreBackup({
        backupId: corruptTarget.id,
        confirm: true,
        createSafetyBackup: false,
      });
    } catch {
      rollbackRejected = true;
    }
    invariant(rollbackRejected, "Corrupt restore unexpectedly committed");
    const afterFailure = (
      await blockMutationWriter.getOwnedDocumentDescriptor(project.id, card.id)
    ).result;
    invariant(
      afterFailure.storeEpoch === restoredDescriptor.storeEpoch,
      "Failed restore changed the live epoch",
    );

    providers.forEach((provider) => provider.destroy());
    documents.forEach((document) => document.destroy());
    providers.splice(0);
    documents.splice(0);
    await blockMutationWriter.shutdown();
    closeDatabase();

    const recoveryResults: string[] = [];
    for (const phase of [
      "prepared",
      "rollback_started",
      "install_started",
      "epoch_rotating",
      "committed",
    ] as const) {
      const crashDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), `nodex-store-crash-${phase}-`),
      );
      try {
        recoveryResults.push(
          simulateCrashRecovery(crashDirectory, phase),
        );
      } finally {
        fs.rmSync(crashDirectory, { recursive: true, force: true });
      }
    }

    process.stdout.write(
      `${JSON.stringify({
        twoProvidersReset: true,
        oldEpochRejected: true,
        failedRestorePreservedEpoch: true,
        assetBoundary: true,
        missingAssetRejected,
        assetSymlinkRejected,
        crashRecoveries: recoveryResults,
      })}\n`,
    );
  } finally {
    providers.forEach((provider) => provider.destroy());
    documents.forEach((document) => document.destroy());
    await blockMutationWriter.shutdown().catch(() => undefined);
    closeDatabase();
    if (previousDir === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previousDir;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
