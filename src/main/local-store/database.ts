import Database from "better-sqlite3";
import * as fs from "fs";
import { getDatabasePath, getLocalStoreDir } from "./config";
import { migrateLegacyDatabaseFileName } from "./database-file-migration";
import { backfillCardHistorySnapshots } from "./history";
import { ensureDatabase, type EnsureDatabaseOptions } from "./schema";
import { recoverInterruptedStoreRestore } from "./store-restore-journal";

let db: Database.Database | null = null;
let maintenanceLease: symbol | null = null;

export class DatabaseMaintenanceInProgressError extends Error {
  constructor() {
    super("The local store is unavailable during whole-store maintenance");
    this.name = "DatabaseMaintenanceInProgressError";
  }
}

export interface DatabaseMaintenanceLease {
  readonly release: () => void;
}

/**
 * Prevents lazy main-process connections from reopening a database while its
 * files are being replaced. The worker connection is fenced separately by the
 * FIFO writer before this lease is acquired.
 */
export function beginDatabaseMaintenance(): DatabaseMaintenanceLease {
  if (maintenanceLease) {
    throw new DatabaseMaintenanceInProgressError();
  }

  const lease = Symbol("database-maintenance");
  maintenanceLease = lease;
  let released = false;
  return {
    release: () => {
      if (released) return;
      if (maintenanceLease !== lease) {
        throw new Error("Database maintenance lease ownership was lost");
      }
      released = true;
      maintenanceLease = null;
    },
  };
}

export function isDatabaseMaintenanceActive(): boolean {
  return maintenanceLease !== null;
}

export function getDb(): Database.Database {
  if (maintenanceLease) {
    throw new DatabaseMaintenanceInProgressError();
  }
  if (!db) {
    const dbPath = getDatabasePath();
    const dir = getLocalStoreDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    migrateLegacyDatabaseFileName(dir);
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
  }
  return db;
}

export function closeDatabase(): void {
  if (!db) return;
  db.close();
  db = null;
}

export async function initializeDatabase(options?: EnsureDatabaseOptions): Promise<void> {
  recoverInterruptedStoreRestore();
  ensureDatabase(options);
  backfillCardHistorySnapshots();
}
