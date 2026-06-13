import Database from "better-sqlite3";
import * as fs from "fs";
import { getDatabasePath, getKanbanDir } from "./config";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = getDatabasePath();
    const dir = getKanbanDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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
