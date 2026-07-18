import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { getDatabasePath, getNodexHome } from "./config";
import { validateBackupStore } from "./backup-store-validation";
import {
  CURRENT_SCHEMA_VERSION,
  getReleaseSchemaVersions,
} from "./schema";

const JOURNAL_FILE_NAME = ".store-restore-journal.json";
const JOURNAL_VERSION = 1;
const ASSETS_DIRECTORY_NAME = "assets";

export type StoreRestorePhase =
  | "prepared"
  | "rollback_started"
  | "install_started"
  | "epoch_rotating"
  | "committed";

export interface StoreRestoreJournal {
  readonly version: 1;
  readonly backupId: string;
  readonly stagingDirectoryPath: string;
  readonly rollbackDirectoryPath: string;
  readonly phase: StoreRestorePhase;
  readonly hadAssets: boolean;
  readonly hadWal: boolean;
  readonly hadShm: boolean;
  readonly sourceSchemaVersion: number;
  readonly installedSchemaVersion: number;
  readonly updatedAt: string;
}

export interface StoreRestorePaths {
  readonly nodexHome: string;
  readonly databasePath: string;
}

const defaultStoreRestorePaths = (): StoreRestorePaths => ({
  nodexHome: getNodexHome(),
  databasePath: getDatabasePath(),
});

const journalPath = (paths: StoreRestorePaths): string =>
  path.join(paths.nodexHome, JOURNAL_FILE_NAME);

export const fsyncDirectory = (directoryPath: string): void => {
  const descriptor = fs.openSync(directoryPath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
};

export const fsyncPathRecursively = (targetPath: string): void => {
  if (!fs.existsSync(targetPath)) return;
  const stats = fs.lstatSync(targetPath);
  if (stats.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath)) {
      fsyncPathRecursively(path.join(targetPath, entry));
    }
    fsyncDirectory(targetPath);
    return;
  }
  if (!stats.isFile()) return;
  const descriptor = fs.openSync(targetPath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
};

const writeFileDurably = (targetPath: string, contents: string): void => {
  const temporaryPath = `${targetPath}.tmp`;
  const descriptor = fs.openSync(temporaryPath, "w", 0o600);
  try {
    fs.writeFileSync(descriptor, contents, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporaryPath, targetPath);
  fsyncDirectory(path.dirname(targetPath));
};

const removeDurably = (targetPath: string): void => {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { force: true });
  fsyncDirectory(path.dirname(targetPath));
};

const removePath = (targetPath: string): void => {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
};

const movePath = (sourcePath: string, destinationPath: string): void => {
  if (!fs.existsSync(sourcePath)) return;
  fs.renameSync(sourcePath, destinationPath);
  const sourceParent = path.dirname(sourcePath);
  const destinationParent = path.dirname(destinationPath);
  fsyncDirectory(sourceParent);
  if (destinationParent !== sourceParent) {
    fsyncDirectory(destinationParent);
  }
};

const validateShippedMigrationRollbackSource = (
  databasePath: string,
): 26 | 57 => {
  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    const schemaVersion = database.pragma("user_version", {
      simple: true,
    }) as number;
    if (schemaVersion !== 26 && schemaVersion !== 57) {
      throw new Error(
        `Expected shipped schema v26 or v57, received v${schemaVersion}`,
      );
    }
    const quickCheck = database.pragma("quick_check") as readonly {
      readonly quick_check: string;
    }[];
    if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== "ok") {
      throw new Error(`Shipped v${schemaVersion} database quick_check failed`);
    }
    const foreignKeyViolations = database.pragma(
      "foreign_key_check",
    ) as unknown[];
    if (foreignKeyViolations.length > 0) {
      throw new Error(
        `Shipped v${schemaVersion} database has ${foreignKeyViolations.length} foreign-key violation(s)`,
      );
    }
    const requiredTables = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('projects', 'cards')
         ORDER BY name`,
      )
      .all() as readonly { readonly name: string }[];
    if (requiredTables.length !== 2) {
      throw new Error(
        `Shipped v${schemaVersion} database is missing core tables`,
      );
    }
    return schemaVersion;
  } finally {
    database?.close();
  }
};

const validateJournalStorePath = (databasePath: string): number => {
  const validationErrors: unknown[] = [];
  for (const expectedSchemaVersion of getReleaseSchemaVersions().reverse()) {
    try {
      const validated = validateBackupStore(databasePath, {
        expectedSchemaVersion,
      });
      if (validated.schemaVersion === expectedSchemaVersion) {
        return validated.schemaVersion;
      }
    } catch (error) {
      validationErrors.push(error);
    }
  }

  let database: Database.Database | null = null;
  let schemaVersion: number;
  try {
    database = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    schemaVersion = database.pragma("user_version", {
      simple: true,
    }) as number;
  } catch (error) {
    throw validationErrors[0] ?? error;
  } finally {
    database?.close();
  }
  if (schemaVersion === 26 || schemaVersion === 57) {
    return validateShippedMigrationRollbackSource(databasePath);
  }
  throw new Error(
    `Restore journal store schema v${schemaVersion} is unsupported`,
  );
};

export function installStagedStoreFiles(
  stagingDirectoryPath: string,
  rollbackDirectoryPath: string,
  paths: StoreRestorePaths = defaultStoreRestorePaths(),
): void {
  const databasePath = paths.databasePath;
  const assetsPath = path.join(
    paths.nodexHome,
    ASSETS_DIRECTORY_NAME,
  );
  fs.mkdirSync(rollbackDirectoryPath, { recursive: true });

  movePath(databasePath, path.join(rollbackDirectoryPath, "nodex.db"));
  movePath(`${databasePath}-wal`, path.join(rollbackDirectoryPath, "nodex.db-wal"));
  movePath(`${databasePath}-shm`, path.join(rollbackDirectoryPath, "nodex.db-shm"));
  movePath(
    assetsPath,
    path.join(rollbackDirectoryPath, ASSETS_DIRECTORY_NAME),
  );
  movePath(path.join(stagingDirectoryPath, "nodex.db"), databasePath);
  movePath(
    path.join(stagingDirectoryPath, ASSETS_DIRECTORY_NAME),
    assetsPath,
  );
  fsyncDirectory(paths.nodexHome);
}

const assertJournalPath = (
  candidatePath: string,
  prefix: ".restore-" | ".rollback-",
  paths: StoreRestorePaths,
): string => {
  const backupsRoot = path.join(paths.nodexHome, "backups");
  const resolved = path.resolve(candidatePath);
  if (
    path.dirname(resolved) !== path.resolve(backupsRoot) ||
    !path.basename(resolved).startsWith(prefix)
  ) {
    throw new Error("Store restore journal contains an unsafe path");
  }
  return resolved;
};

const parseJournal = (
  contents: string,
  paths: StoreRestorePaths,
): StoreRestoreJournal => {
  const value = JSON.parse(contents) as Partial<StoreRestoreJournal>;
  const validPhase =
    value.phase === "prepared" ||
    value.phase === "rollback_started" ||
    value.phase === "install_started" ||
    value.phase === "epoch_rotating" ||
    value.phase === "committed";
  if (
    value.version !== JOURNAL_VERSION ||
    typeof value.backupId !== "string" ||
    !value.backupId ||
    typeof value.stagingDirectoryPath !== "string" ||
    typeof value.rollbackDirectoryPath !== "string" ||
    !validPhase ||
    typeof value.hadAssets !== "boolean" ||
    typeof value.hadWal !== "boolean" ||
    typeof value.hadShm !== "boolean" ||
    typeof value.sourceSchemaVersion !== "number" ||
    !Number.isSafeInteger(value.sourceSchemaVersion) ||
    typeof value.installedSchemaVersion !== "number" ||
    !Number.isSafeInteger(value.installedSchemaVersion) ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error("Store restore journal is invalid");
  }
  return {
    version: 1,
    backupId: value.backupId,
    stagingDirectoryPath: assertJournalPath(
      value.stagingDirectoryPath,
      ".restore-",
      paths,
    ),
    rollbackDirectoryPath: assertJournalPath(
      value.rollbackDirectoryPath,
      ".rollback-",
      paths,
    ),
    phase: value.phase,
    hadAssets: value.hadAssets,
    hadWal: value.hadWal,
    hadShm: value.hadShm,
    sourceSchemaVersion: value.sourceSchemaVersion,
    installedSchemaVersion: value.installedSchemaVersion,
    updatedAt: value.updatedAt,
  };
};

const persistJournal = (
  journal: StoreRestoreJournal,
  paths: StoreRestorePaths,
): void => {
  writeFileDurably(journalPath(paths), JSON.stringify(journal, null, 2));
};

export function createStoreRestoreJournal(input: {
  readonly backupId: string;
  readonly stagingDirectoryPath: string;
  readonly rollbackDirectoryPath: string;
  readonly expectedInstalledSchemaVersion?: number;
}, paths: StoreRestorePaths = defaultStoreRestorePaths()): StoreRestoreJournal {
  if (fs.existsSync(journalPath(paths))) {
    throw new Error("An interrupted whole-store restore must be recovered first");
  }
  const databasePath = paths.databasePath;
  const sourceSchemaVersion = validateJournalStorePath(databasePath);
  const installedSchemaVersion = validateJournalStorePath(
    path.join(input.stagingDirectoryPath, "nodex.db"),
  );
  const expectedInstalledSchemaVersion =
    input.expectedInstalledSchemaVersion ?? CURRENT_SCHEMA_VERSION;
  if (installedSchemaVersion !== expectedInstalledSchemaVersion) {
    throw new Error(
      `Staged store schema v${installedSchemaVersion} is not expected v${expectedInstalledSchemaVersion}`,
    );
  }
  const journal: StoreRestoreJournal = {
    version: 1,
    backupId: input.backupId,
    stagingDirectoryPath: assertJournalPath(
      input.stagingDirectoryPath,
      ".restore-",
      paths,
    ),
    rollbackDirectoryPath: assertJournalPath(
      input.rollbackDirectoryPath,
      ".rollback-",
      paths,
    ),
    phase: "prepared",
    hadAssets: fs.existsSync(
      path.join(paths.nodexHome, ASSETS_DIRECTORY_NAME),
    ),
    hadWal: fs.existsSync(`${databasePath}-wal`),
    hadShm: fs.existsSync(`${databasePath}-shm`),
    sourceSchemaVersion,
    installedSchemaVersion,
    updatedAt: new Date().toISOString(),
  };
  persistJournal(journal, paths);
  return journal;
}

export function advanceStoreRestoreJournal(
  journal: StoreRestoreJournal,
  phase: StoreRestorePhase,
  paths: StoreRestorePaths = defaultStoreRestorePaths(),
): StoreRestoreJournal {
  const next = { ...journal, phase, updatedAt: new Date().toISOString() };
  persistJournal(next, paths);
  return next;
}

const restoreRollback = (
  journal: StoreRestoreJournal,
  paths: StoreRestorePaths,
): void => {
  const databasePath = paths.databasePath;
  const assetsPath = path.join(
    paths.nodexHome,
    ASSETS_DIRECTORY_NAME,
  );
  const rollbackDatabasePath = path.join(
    journal.rollbackDirectoryPath,
    "nodex.db",
  );
  if (!fs.existsSync(rollbackDatabasePath)) {
    return;
  }

  removePath(databasePath);
  movePath(rollbackDatabasePath, databasePath);
  const rollbackWalPath = path.join(
    journal.rollbackDirectoryPath,
    "nodex.db-wal",
  );
  if (journal.hadWal && fs.existsSync(rollbackWalPath)) {
    removePath(`${databasePath}-wal`);
    movePath(
      rollbackWalPath,
      `${databasePath}-wal`,
    );
  } else if (!journal.hadWal) {
    removePath(`${databasePath}-wal`);
  }
  const rollbackShmPath = path.join(
    journal.rollbackDirectoryPath,
    "nodex.db-shm",
  );
  if (journal.hadShm && fs.existsSync(rollbackShmPath)) {
    removePath(`${databasePath}-shm`);
    movePath(
      rollbackShmPath,
      `${databasePath}-shm`,
    );
  } else if (!journal.hadShm) {
    removePath(`${databasePath}-shm`);
  }
  const rollbackAssetsPath = path.join(
    journal.rollbackDirectoryPath,
    ASSETS_DIRECTORY_NAME,
  );
  if (journal.hadAssets && fs.existsSync(rollbackAssetsPath)) {
    removePath(assetsPath);
    movePath(
      rollbackAssetsPath,
      assetsPath,
    );
  } else if (!journal.hadAssets) {
    removePath(assetsPath);
  }
  fsyncDirectory(paths.nodexHome);
};

const cleanupJournalArtifacts = (
  journal: StoreRestoreJournal,
  paths: StoreRestorePaths,
): void => {
  removePath(journal.stagingDirectoryPath);
  removePath(journal.rollbackDirectoryPath);
  fsyncDirectory(path.dirname(journal.stagingDirectoryPath));
  removeDurably(journalPath(paths));
};

const validateJournalStore = (
  expectedSchemaVersion: number,
  paths: StoreRestorePaths,
): void => {
  const schemaVersion = validateJournalStorePath(paths.databasePath);
  if (schemaVersion !== expectedSchemaVersion) {
    throw new Error(
      `Recovered store schema v${schemaVersion} does not match journal v${expectedSchemaVersion}`,
    );
  }
};

export function rollbackStoreRestore(
  journal: StoreRestoreJournal,
  paths: StoreRestorePaths = defaultStoreRestorePaths(),
): void {
  restoreRollback(journal, paths);
  validateJournalStore(journal.sourceSchemaVersion, paths);
  cleanupJournalArtifacts(journal, paths);
}

export function cleanupCommittedStoreRestore(
  journal: StoreRestoreJournal,
  paths: StoreRestorePaths = defaultStoreRestorePaths(),
): void {
  validateJournalStore(journal.installedSchemaVersion, paths);
  cleanupJournalArtifacts(journal, paths);
}

/** Runs before schema initialization opens the live database. */
export function recoverInterruptedStoreRestore():
  | "none"
  | "rolled_back"
  | "committed" {
  const paths = defaultStoreRestorePaths();
  const targetPath = journalPath(paths);
  if (!fs.existsSync(targetPath)) return "none";
  const journal = parseJournal(fs.readFileSync(targetPath, "utf8"), paths);
  if (journal.phase === "committed") {
    try {
      validateJournalStore(journal.installedSchemaVersion, paths);
    } catch {
      rollbackStoreRestore(journal, paths);
      return "rolled_back";
    }
    cleanupJournalArtifacts(journal, paths);
    return "committed";
  }

  if (journal.phase !== "prepared") {
    restoreRollback(journal, paths);
    validateJournalStore(journal.sourceSchemaVersion, paths);
  } else {
    validateJournalStore(journal.sourceSchemaVersion, paths);
  }
  cleanupJournalArtifacts(journal, paths);
  return journal.phase === "prepared" ? "none" : "rolled_back";
}
