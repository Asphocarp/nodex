import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { getDatabasePath, getLocalStoreDir } from "./config";
import { finalizeBlockFirstAuthority } from "./block-first-finalization";
import {
  CURRENT_SCHEMA_VERSION,
  type EnsureDatabaseOptions,
  finishShippedSchemaImport,
  prepareShippedSchemaImport,
  publishShippedSchemaImport,
} from "./schema";
import { normalizeShippedV26Import } from "./shipped-schema-v26";
import { ensurePrimaryCanvasDocuments } from "./primary-canvas-document";
import { finalizeRichCardTitleSchema } from "./rich-title-schema-finalization";
import { assertLegacyCardPromotionCutoverReady } from "./legacy-card-promotion-cutover";
import { repairDocumentSecondaryProjections } from "./block-document-projections";
import { validateBackupStore } from "./backup-store-validation";
import {
  advanceStoreRestoreJournal,
  cleanupCommittedStoreRestore,
  createStoreRestoreJournal,
  fsyncDirectory,
  fsyncPathRecursively,
  installStagedStoreFiles,
  rollbackStoreRestore,
  type StoreRestoreJournal,
  type StoreRestorePaths,
} from "./store-restore-journal";
import { materializeLegacyCardInlineImages } from "./shipped-schema-inline-assets";

export type ShippedSchemaMigrationFaultPoint =
  | "staging_ready"
  | "journal_prepared"
  | "rollback_started"
  | "store_installed"
  | "committed";

export interface ShippedSchemaMigrationOptions extends EnsureDatabaseOptions {
  readonly localStoreDirectoryPath?: string;
  readonly databasePath?: string;
  readonly injectFault?: (point: ShippedSchemaMigrationFaultPoint) => void;
}

export interface ShippedSchemaMigrationResult {
  readonly migrated: boolean;
  readonly sourceSchemaVersion: number | null;
  readonly installedSchemaVersion: number | null;
}

const readSchemaVersion = (databasePath: string): number | null => {
  if (!fs.existsSync(databasePath)) return null;
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return database.pragma("user_version", { simple: true }) as number;
  } finally {
    database.close();
  }
};

const removePath = (targetPath: string): void => {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
};

const prepareStagingSnapshot = async (
  sourceDatabasePath: string,
  sourceAssetsPath: string,
  stagingDirectoryPath: string,
): Promise<{ readonly databasePath: string; readonly assetsPath: string }> => {
  const stagingDatabasePath = path.join(stagingDirectoryPath, "nodex.db");
  const stagingAssetsPath = path.join(stagingDirectoryPath, "assets");
  fs.mkdirSync(stagingDirectoryPath, { recursive: true });
  fs.mkdirSync(stagingAssetsPath, { recursive: true });
  const sourceDatabase = new Database(sourceDatabasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await sourceDatabase.backup(stagingDatabasePath);
  } finally {
    sourceDatabase.close();
  }
  if (fs.existsSync(sourceAssetsPath)) {
    fs.cpSync(sourceAssetsPath, stagingAssetsPath, {
      recursive: true,
      force: false,
    });
  }
  return { databasePath: stagingDatabasePath, assetsPath: stagingAssetsPath };
};

const buildCurrentStoreInStaging = async (
  stagingDatabasePath: string,
  stagingAssetsPath: string,
  sourceSchemaVersion: 26 | 57,
  onProgress: (value: number) => void,
): Promise<void> => {
  const database = new Database(stagingDatabasePath);
  try {
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    if (sourceSchemaVersion === 26) {
      normalizeShippedV26Import(database);
    }
    onProgress(0.13);
    materializeLegacyCardInlineImages(database, stagingAssetsPath);
    onProgress(0.15);
    prepareShippedSchemaImport(database);
    onProgress(0.35);
    ensurePrimaryCanvasDocuments(database, {
      mode: "shipped_schema_import",
      assetsRootPath: stagingAssetsPath,
    });
    onProgress(0.4);
    await finalizeBlockFirstAuthority(database, () => {
      materializeLegacyCardInlineImages(database, stagingAssetsPath);
    });
    onProgress(0.68);
    finishShippedSchemaImport(database, stagingAssetsPath);
    onProgress(0.76);
    ensurePrimaryCanvasDocuments(database, {
      assetsRootPath: stagingAssetsPath,
    });
    finalizeRichCardTitleSchema(database);
    assertLegacyCardPromotionCutoverReady(database);
    repairDocumentSecondaryProjections(database, {
      assetsRootPath: stagingAssetsPath,
    });
    onProgress(0.82);
    publishShippedSchemaImport(database);
    database.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }
};

const rollbackAfterFailure = (
  journal: StoreRestoreJournal,
  paths: StoreRestorePaths,
  migrationError: unknown,
): never => {
  try {
    rollbackStoreRestore(journal, paths);
  } catch (rollbackError) {
    throw new AggregateError(
      [migrationError, rollbackError],
      "Shipped-schema import failed and its rollback could not be completed",
    );
  }
  throw migrationError;
};

/**
 * Build and validate a shipped source store off to the side, then publish v58
 * through the same crash-recoverable filesystem seam as whole-store restore.
 */
export async function migrateShippedSchemaStoreToCurrent(
  options: ShippedSchemaMigrationOptions = {},
): Promise<ShippedSchemaMigrationResult> {
  const localStoreDirectoryPath =
    options.localStoreDirectoryPath ?? getLocalStoreDir();
  const databasePath = options.databasePath ?? getDatabasePath();
  const sourceSchemaVersion = readSchemaVersion(databasePath);
  if (sourceSchemaVersion === null) {
    return {
      migrated: false,
      sourceSchemaVersion,
      installedSchemaVersion: null,
    };
  }
  if (sourceSchemaVersion === CURRENT_SCHEMA_VERSION) {
    return {
      migrated: false,
      sourceSchemaVersion,
      installedSchemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }
  if (sourceSchemaVersion !== 26 && sourceSchemaVersion !== 57) {
    throw new Error(
      `Unsupported Nodex database schema version ${sourceSchemaVersion}. Expected v26, v57, or v${CURRENT_SCHEMA_VERSION}.`,
    );
  }

  const migrationId =
    `schema-v${sourceSchemaVersion}-to-v${CURRENT_SCHEMA_VERSION}-${randomUUID()}`;
  const backupsRootPath = path.join(localStoreDirectoryPath, "backups");
  const stagingDirectoryPath = path.join(
    backupsRootPath,
    `.restore-${migrationId}`,
  );
  const rollbackDirectoryPath = path.join(
    backupsRootPath,
    `.rollback-${migrationId}`,
  );
  const paths = { localStoreDirectoryPath, databasePath };
  let journal: StoreRestoreJournal | null = null;
  let committed = false;
  fs.mkdirSync(backupsRootPath, { recursive: true });

  try {
    options.onMigrationProgress?.({ type: "InProgress", value: 0 });
    const staging = await prepareStagingSnapshot(
      databasePath,
      path.join(localStoreDirectoryPath, "assets"),
      stagingDirectoryPath,
    );
    options.onMigrationProgress?.({ type: "InProgress", value: 0.1 });
    await buildCurrentStoreInStaging(
      staging.databasePath,
      staging.assetsPath,
      sourceSchemaVersion,
      (value) =>
        options.onMigrationProgress?.({ type: "InProgress", value }),
    );
    options.onMigrationProgress?.({ type: "InProgress", value: 0.85 });
    validateBackupStore(staging.databasePath, {
      assetsPath: staging.assetsPath,
    });
    fsyncPathRecursively(stagingDirectoryPath);
    fsyncDirectory(backupsRootPath);
    options.injectFault?.("staging_ready");

    journal = createStoreRestoreJournal(
      {
        backupId: migrationId,
        stagingDirectoryPath,
        rollbackDirectoryPath,
      },
      paths,
    );
    options.injectFault?.("journal_prepared");
    journal = advanceStoreRestoreJournal(journal, "rollback_started", paths);
    options.injectFault?.("rollback_started");
    installStagedStoreFiles(stagingDirectoryPath, rollbackDirectoryPath, paths);
    options.injectFault?.("store_installed");
    journal = advanceStoreRestoreJournal(journal, "install_started", paths);
    validateBackupStore(databasePath, {
      assetsPath: path.join(localStoreDirectoryPath, "assets"),
    });
    journal = advanceStoreRestoreJournal(journal, "committed", paths);
    committed = true;
    options.injectFault?.("committed");
    try {
      cleanupCommittedStoreRestore(journal, paths);
      journal = null;
    } catch {
      // A durable committed journal is cleaned safely on the next startup.
    }
    options.onMigrationProgress?.({ type: "Done" });
    return {
      migrated: true,
      sourceSchemaVersion,
      installedSchemaVersion: CURRENT_SCHEMA_VERSION,
    };
  } catch (error) {
    if (journal && !committed) {
      return rollbackAfterFailure(journal, paths, error);
    }
    if (!journal) {
      removePath(stagingDirectoryPath);
      removePath(rollbackDirectoryPath);
    }
    throw error;
  }
}
