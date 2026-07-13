import Database from "better-sqlite3";
import * as fs from "fs";
import { getDatabasePath, getLocalStoreDir } from "./config";
import { migrateLegacyDatabaseFileName } from "./database-file-migration";
import { finalizeBlockFirstAuthority } from "./block-first-finalization";
import {
  CURRENT_SCHEMA_VERSION,
  ensureDatabase,
  type EnsureDatabaseOptions,
} from "./schema";
import { recoverInterruptedStoreRestore } from "./store-restore-journal";
import { ensurePrimaryCanvasDocuments } from "./primary-canvas-document";
import { finalizeRichCardTitleSchema } from "./rich-title-schema-finalization";
import { assertLegacyCardPromotionCutoverReady } from "./legacy-card-promotion-cutover";
import { repairDocumentSecondaryProjections } from "./block-document-projections";

let db: Database.Database | null = null;
const DATABASE_MAINTENANCE_LEASE_ENV =
  "NODEX_INTERNAL_DATABASE_MAINTENANCE_LEASE";

const readDatabaseMaintenanceLease = (): string | null =>
  process.env[DATABASE_MAINTENANCE_LEASE_ENV] ?? null;

export class DatabaseMaintenanceInProgressError extends Error {
  constructor() {
    super("The local store is unavailable during whole-store maintenance");
    this.name = "DatabaseMaintenanceInProgressError";
  }
}

/** Stable across Bun module reloads and other same-process JS realms. */
export const isDatabaseMaintenanceInProgressError = (
  value: unknown,
): value is DatabaseMaintenanceInProgressError =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  value.name === "DatabaseMaintenanceInProgressError" &&
  "message" in value &&
  value.message ===
    "The local store is unavailable during whole-store maintenance";

export interface DatabaseMaintenanceLease {
  readonly release: () => void;
}

/**
 * Prevents lazy main-process connections from reopening a database while its
 * files are being replaced. The worker connection is fenced separately by the
 * FIFO writer before this lease is acquired.
 */
export function beginDatabaseMaintenance(): DatabaseMaintenanceLease {
  if (readDatabaseMaintenanceLease()) {
    throw new DatabaseMaintenanceInProgressError();
  }

  const lease = `${process.pid}:${Date.now()}:${Math.random()}`;
  process.env[DATABASE_MAINTENANCE_LEASE_ENV] = lease;
  let released = false;
  return {
    release: () => {
      if (released) return;
      if (readDatabaseMaintenanceLease() !== lease) {
        throw new Error("Database maintenance lease ownership was lost");
      }
      released = true;
      delete process.env[DATABASE_MAINTENANCE_LEASE_ENV];
    },
  };
}

export function isDatabaseMaintenanceActive(): boolean {
  return readDatabaseMaintenanceLease() !== null;
}

export function getDb(): Database.Database {
  if (readDatabaseMaintenanceLease()) {
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
  const database = getDb();
  const schemaVersion = database.pragma("user_version", {
    simple: true,
  }) as number;
  if (schemaVersion === CURRENT_SCHEMA_VERSION) {
    ensurePrimaryCanvasDocuments(database);
    finalizeRichCardTitleSchema(database);
    assertLegacyCardPromotionCutoverReady(database);
    return;
  }
  if (schemaVersion !== 69) {
    throw new Error(
      `Cannot finalize Block-first schema v${schemaVersion}; expected v69`,
    );
  }

  // The asynchronous fixed point consumes the legacy v69 Canvas Y.Doc shape.
  // Reopening through ensureDatabase then applies the two synchronous edges in
  // order: scene-native authority (v71), followed by exclusive parents (v72).
  ensurePrimaryCanvasDocuments(database);
  await finalizeBlockFirstAuthority(database, 70);
  closeDatabase();
  ensureDatabase(options);
  const migratedDatabase = getDb();
  const migratedVersion = migratedDatabase.pragma("user_version", {
    simple: true,
  }) as number;
  if (migratedVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Nodex database stopped at schema v${migratedVersion}; expected v${CURRENT_SCHEMA_VERSION}`,
    );
  }
  ensurePrimaryCanvasDocuments(migratedDatabase);
  finalizeRichCardTitleSchema(migratedDatabase);
  assertLegacyCardPromotionCutoverReady(migratedDatabase);
  repairDocumentSecondaryProjections(migratedDatabase);
}
