import Database from "better-sqlite3";
import * as fs from "fs";
import { getDatabasePath, getLocalStoreDir } from "./config";
import { migrateLegacyDatabaseFileName } from "./database-file-migration";
import { backfillCardHistorySnapshots } from "./history";
import { ensureDatabase, type EnsureDatabaseOptions } from "./schema";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
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
  ensureDatabase(options);
  backfillCardHistorySnapshots();
}
