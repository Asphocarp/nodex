import Database from "better-sqlite3";

export { dbNotifier } from "./notifier";
export { getDatabasePath, getLocalStoreDir } from "./config";
export { closeDatabase, getDb } from "./database";
export { listProjects } from "./projects";

export function openStandaloneBackupDatabase(
  databasePath: string,
): Database.Database {
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  return database;
}
