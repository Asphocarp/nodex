import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { CARD_DOCUMENT_SCHEMA_KEY } from "../../shared/block-documents";
import {
  isSafeAssetFileName,
  NODEX_ASSET_SCHEME,
  parseAssetSource,
} from "../../shared/assets";
import { CURRENT_SCHEMA_VERSION } from "./schema";

export interface ValidatedBackupStore {
  readonly schemaVersion: number;
  readonly storeEpoch: string;
  readonly projectCount: number;
  readonly documentCount: number;
  readonly managedAssetCount: number;
}

export class BackupStoreValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackupStoreValidationError";
  }
}

const scalarCount = (database: Database.Database, sql: string): number => {
  const row = database.prepare(sql).get() as { readonly count: number } | undefined;
  if (!row || !Number.isSafeInteger(row.count) || row.count < 0) {
    throw new BackupStoreValidationError("Backup validation count is invalid");
  }
  return row.count;
};

const validateManagedAssets = (
  database: Database.Database,
  assetsPath: string,
): number => {
  const resolvedRoot = path.resolve(assetsPath);
  if (fs.existsSync(resolvedRoot)) {
    const rootStats = fs.lstatSync(resolvedRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new BackupStoreValidationError(
        "Backup managed assets root must be a real directory",
      );
    }
    for (const entry of fs.readdirSync(resolvedRoot, { withFileTypes: true })) {
      if (
        !isSafeAssetFileName(entry.name) ||
        entry.name === "." ||
        entry.name === ".." ||
        !entry.isFile() ||
        entry.isSymbolicLink()
      ) {
        throw new BackupStoreValidationError(
          `Backup managed asset entry is unsafe: ${entry.name}`,
        );
      }
      const entryPath = path.resolve(resolvedRoot, entry.name);
      if (path.dirname(entryPath) !== resolvedRoot) {
        throw new BackupStoreValidationError(
          `Backup managed asset escapes its root: ${entry.name}`,
        );
      }
    }
  }

  const hasAssetProjection = scalarCount(
    database,
    `
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table' AND name = 'block_asset_refs'
    `,
  ) === 1;
  if (!hasAssetProjection) return 0;

  const rows = database
    .prepare(
      `
        SELECT DISTINCT asset.asset_uri
        FROM block_asset_refs asset
        INNER JOIN documents document
          ON document.id = asset.document_id
          AND document.project_id = asset.project_id
        WHERE asset.document_generation = document.generation
          AND asset.projected_seq = document.head_seq
          AND asset.asset_uri LIKE 'nodex://assets/%'
        ORDER BY asset.asset_uri ASC
      `,
    )
    .all() as Array<{ readonly asset_uri: string }>;
  for (const row of rows) {
    const parsed = parseAssetSource(row.asset_uri);
    if (!parsed || !row.asset_uri.startsWith(NODEX_ASSET_SCHEME)) {
      throw new BackupStoreValidationError(
        `Backup contains an invalid managed asset URI: ${row.asset_uri}`,
      );
    }
    const assetPath = path.resolve(resolvedRoot, parsed.fileName);
    if (
      path.dirname(assetPath) !== resolvedRoot ||
      !fs.existsSync(assetPath) ||
      !fs.lstatSync(assetPath).isFile() ||
      fs.lstatSync(assetPath).isSymbolicLink()
    ) {
      throw new BackupStoreValidationError(
        `Backup is missing managed asset ${parsed.fileName}`,
      );
    }
  }
  return rows.length;
};

const validateOpenDatabase = (
  database: Database.Database,
  options: {
    readonly requireCurrentSchema: boolean;
    readonly assetsPath: string;
  },
): ValidatedBackupStore => {
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  const schemaVersion = database.pragma("user_version", {
    simple: true,
  }) as number;
  const supportedBlockFirstSchema =
    schemaVersion >= 59 && schemaVersion <= CURRENT_SCHEMA_VERSION;
  if (
    (options.requireCurrentSchema && schemaVersion !== CURRENT_SCHEMA_VERSION) ||
    (!options.requireCurrentSchema && !supportedBlockFirstSchema)
  ) {
    throw new BackupStoreValidationError(
      options.requireCurrentSchema
        ? `Backup schema v${schemaVersion} is not the current v${CURRENT_SCHEMA_VERSION}`
        : `Restore journal schema v${schemaVersion} is outside the supported Block-first range`,
    );
  }

  const quickCheck = database.pragma("quick_check") as Array<{
    readonly quick_check: string;
  }>;
  if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== "ok") {
    throw new BackupStoreValidationError("Backup database quick_check failed");
  }
  const foreignKeyViolations = database.pragma("foreign_key_check") as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new BackupStoreValidationError(
      `Backup database has ${foreignKeyViolations.length} foreign-key violation(s)`,
    );
  }

  const metadataRows = database
    .prepare(
      "SELECT id, store_epoch FROM block_store_metadata ORDER BY id ASC",
    )
    .all() as Array<{ readonly id: number; readonly store_epoch: string }>;
  if (
    metadataRows.length !== 1 ||
    metadataRows[0]?.id !== 1 ||
    !metadataRows[0].store_epoch.trim()
  ) {
    throw new BackupStoreValidationError(
      "Backup database has no unique Block store epoch",
    );
  }

  const invalidCardOwnership = scalarCount(
    database,
    `
      SELECT COUNT(*) AS count
      FROM blocks block
      LEFT JOIN block_documents ownership
        ON ownership.block_id = block.id
        AND ownership.project_id = block.project_id
      LEFT JOIN documents document
        ON document.id = ownership.document_id
        AND document.project_id = ownership.project_id
      WHERE block.type = 'card'
        AND (
          ownership.block_id IS NULL
          OR document.id IS NULL
          OR document.schema_key <> '${CARD_DOCUMENT_SCHEMA_KEY}'
        )
    `,
  );
  if (invalidCardOwnership > 0) {
    throw new BackupStoreValidationError(
      `Backup database has ${invalidCardOwnership} Card(s) without a valid owned Document`,
    );
  }

  const unownedDocuments = scalarCount(
    database,
    `
      SELECT COUNT(*) AS count
      FROM documents document
      LEFT JOIN block_documents ownership
        ON ownership.document_id = document.id
        AND ownership.project_id = document.project_id
      WHERE ownership.document_id IS NULL
    `,
  );
  if (unownedDocuments > 0) {
    throw new BackupStoreValidationError(
      `Backup database has ${unownedDocuments} unowned Document(s)`,
    );
  }

  const stalePrimaryProjections = scalarCount(
    database,
    `
      SELECT COUNT(*) AS count
      FROM documents document
      LEFT JOIN document_materializations materialization
        ON materialization.document_id = document.id
      WHERE document.authority = 'ydoc_primary'
        AND (
          document.readiness <> 'ready'
          OR materialization.document_id IS NULL
          OR materialization.generation <> document.generation
          OR materialization.projected_seq <> document.head_seq
        )
    `,
  );
  if (stalePrimaryProjections > 0) {
    throw new BackupStoreValidationError(
      `Backup database has ${stalePrimaryProjections} stale primary Document projection(s)`,
    );
  }

  return {
    schemaVersion,
    storeEpoch: metadataRows[0].store_epoch,
    projectCount: scalarCount(database, "SELECT COUNT(*) AS count FROM projects"),
    documentCount: scalarCount(database, "SELECT COUNT(*) AS count FROM documents"),
    managedAssetCount: validateManagedAssets(database, options.assetsPath),
  };
};

export function validateBackupStore(
  databasePath: string,
  options: {
    readonly requireCurrentSchema?: boolean;
    readonly assetsPath?: string;
  } = {},
): ValidatedBackupStore {
  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    return validateOpenDatabase(database, {
      requireCurrentSchema: options.requireCurrentSchema ?? true,
      assetsPath:
        options.assetsPath ?? path.join(path.dirname(databasePath), "assets"),
    });
  } catch (error) {
    if (error instanceof BackupStoreValidationError) throw error;
    throw new BackupStoreValidationError("Backup database is not readable", {
      cause: error,
    });
  } finally {
    database?.close();
  }
}

export function rotateBackupStoreEpoch(
  databasePath: string,
  createEpoch: () => string = randomUUID,
): ValidatedBackupStore {
  const before = validateBackupStore(databasePath);
  const storeEpoch = createEpoch();
  if (!storeEpoch.trim() || storeEpoch === before.storeEpoch) {
    throw new BackupStoreValidationError(
      "Restored store epoch must be non-empty and different",
    );
  }

  const database = new Database(databasePath, { fileMustExist: true });
  try {
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    database.transaction(() => {
      const result = database
        .prepare(
          `
            UPDATE block_store_metadata
            SET store_epoch = ?, updated_at = ?
            WHERE id = 1 AND store_epoch = ?
          `,
        )
        .run(storeEpoch, new Date().toISOString(), before.storeEpoch);
      if (result.changes !== 1) {
        throw new BackupStoreValidationError(
          "Restored store epoch changed during validation",
        );
      }
    })();
    database.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }

  const after = validateBackupStore(databasePath);
  if (after.storeEpoch !== storeEpoch) {
    throw new BackupStoreValidationError(
      "Restored store epoch rotation was not durable",
    );
  }
  return after;
}
