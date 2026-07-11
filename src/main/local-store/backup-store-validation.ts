import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CARD_DOCUMENT_SCHEMA_KEY,
  getRegisteredBlockDocumentSchemaAdapterForSchema,
} from "../../shared/block-documents";
import {
  isSafeAssetFileName,
  getAssetSource,
  NODEX_ASSET_SCHEME,
  parseAssetSource,
} from "../../shared/assets";
import { CURRENT_SCHEMA_VERSION } from "./schema";
import { readCanvasSceneMaterialization } from "./canvas-scene-materializations";
import { MAX_IMAGE_UPLOAD_BYTES } from "./assets";

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
  const hasCanvasAssetProjection = scalarCount(
    database,
    `
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table' AND name = 'canvas_scene_file_refs'
    `,
  ) === 1;
  if (!hasAssetProjection && !hasCanvasAssetProjection) return 0;

  interface CanvasAssetEvidence {
    readonly managedFileName: string;
    readonly assetHash: string;
    readonly byteLength: number;
  }
  const assetUris = new Set<string>();
  const canvasEvidenceByAssetUri = new Map<string, CanvasAssetEvidence>();
  if (hasAssetProjection) {
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
    rows.forEach((row) => assetUris.add(row.asset_uri));
  }
  if (hasCanvasAssetProjection) {
    const rows = database
      .prepare(
        `
        SELECT asset.asset_uri, asset.managed_file_name,
          asset.asset_hash, asset.byte_length
        FROM canvas_scene_file_refs asset
        INNER JOIN documents document
          ON document.id = asset.document_id
          AND document.project_id = asset.project_id
        WHERE asset.document_generation = document.generation
          AND asset.projected_seq = document.head_seq
        ORDER BY asset.asset_uri ASC, asset.document_id ASC, asset.file_id ASC
      `,
      )
      .all() as Array<{
      readonly asset_uri: string;
      readonly managed_file_name: string;
      readonly asset_hash: string;
      readonly byte_length: number;
    }>;
    for (const row of rows) {
      const parsed = parseAssetSource(row.asset_uri);
      if (
        !parsed ||
        parsed.fileName !== row.managed_file_name ||
        !/^[a-f0-9]{64}$/u.test(row.asset_hash) ||
        !Number.isSafeInteger(row.byte_length) ||
        row.byte_length < 0
      ) {
        throw new BackupStoreValidationError(
          `Backup contains invalid Canvas asset evidence: ${row.asset_uri}`,
        );
      }
      const evidence = {
        managedFileName: row.managed_file_name,
        assetHash: row.asset_hash,
        byteLength: row.byte_length,
      };
      const previous = canvasEvidenceByAssetUri.get(row.asset_uri);
      if (
        previous &&
        (previous.managedFileName !== evidence.managedFileName ||
          previous.assetHash !== evidence.assetHash ||
          previous.byteLength !== evidence.byteLength)
      ) {
        throw new BackupStoreValidationError(
          `Backup contains conflicting Canvas asset evidence: ${row.asset_uri}`,
        );
      }
      assetUris.add(row.asset_uri);
      canvasEvidenceByAssetUri.set(row.asset_uri, evidence);
    }
  }
  for (const assetUri of [...assetUris].sort()) {
    const parsed = parseAssetSource(assetUri);
    if (
      !parsed ||
      !assetUri.startsWith(NODEX_ASSET_SCHEME) ||
      assetUri !== getAssetSource(parsed.fileName)
    ) {
      throw new BackupStoreValidationError(
        `Backup contains an invalid managed asset URI: ${assetUri}`,
      );
    }
    const assetPath = path.resolve(resolvedRoot, parsed.fileName);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(assetPath);
    } catch {
      throw new BackupStoreValidationError(
        `Backup is missing managed asset ${parsed.fileName}`,
      );
    }
    if (
      path.dirname(assetPath) !== resolvedRoot ||
      !stats.isFile() ||
      stats.isSymbolicLink()
    ) {
      throw new BackupStoreValidationError(
        `Backup is missing managed asset ${parsed.fileName}`,
      );
    }
    const evidence = canvasEvidenceByAssetUri.get(assetUri);
    if (!evidence) continue;
    if (stats.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new BackupStoreValidationError(
        `Backup managed Canvas asset exceeds the image limit: ${parsed.fileName}`,
      );
    }
    const bytes = fs.readFileSync(assetPath);
    if (
      stats.size !== evidence.byteLength ||
      bytes.byteLength !== evidence.byteLength ||
      createHash("sha256").update(bytes).digest("hex") !== evidence.assetHash
    ) {
      throw new BackupStoreValidationError(
        `Backup managed asset evidence does not match ${parsed.fileName}`,
      );
    }
  }
  return assetUris.size;
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

  const primaryDocuments = database
    .prepare(
      `
      SELECT document.id, document.generation, document.head_seq,
        document.schema_key, document.schema_version, document.readiness,
        owner.type AS owner_type
      FROM documents document
      INNER JOIN block_documents ownership
        ON ownership.document_id = document.id
        AND ownership.project_id = document.project_id
      INNER JOIN blocks owner
        ON owner.id = ownership.block_id
        AND owner.project_id = ownership.project_id
      WHERE document.authority = 'ydoc_primary'
      ORDER BY document.id
    `,
    )
    .all() as readonly {
    readonly id: string;
    readonly generation: number;
    readonly head_seq: number;
    readonly schema_key: string;
    readonly schema_version: number;
    readonly readiness: string;
    readonly owner_type: string;
  }[];
  let stalePrimaryProjections = 0;
  for (const document of primaryDocuments) {
    let contentModel: "block_tree" | "scene_graph";
    try {
      const adapter = getRegisteredBlockDocumentSchemaAdapterForSchema({
        schemaKey: document.schema_key,
        schemaVersion: document.schema_version,
      });
      if (adapter.ownerType !== document.owner_type) {
        stalePrimaryProjections += 1;
        continue;
      }
      contentModel = adapter.contentModel;
    } catch {
      stalePrimaryProjections += 1;
      continue;
    }
    if (document.readiness !== "ready") {
      stalePrimaryProjections += 1;
      continue;
    }
    let projection:
      | { readonly generation: number; readonly projected_seq: number }
      | undefined;
    try {
      if (contentModel === "scene_graph") {
        const scene = readCanvasSceneMaterialization(database, document.id);
        projection = scene
          ? {
              generation: scene.generation,
              projected_seq: scene.projectedSeq,
            }
          : undefined;
      } else {
        projection = database
          .prepare(
            `SELECT generation, projected_seq FROM document_materializations WHERE document_id = ?`,
          )
          .get(document.id) as
          | { readonly generation: number; readonly projected_seq: number }
          | undefined;
      }
    } catch {
      stalePrimaryProjections += 1;
      continue;
    }
    if (
      !projection ||
      projection.generation !== document.generation ||
      projection.projected_seq !== document.head_seq
    ) {
      stalePrimaryProjections += 1;
    }
  }
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
