import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  PAGE_DOCUMENT_SCHEMA_KEY,
  canonicalizeCanvasSceneMutationRequest,
  canonicalizeCanvasSceneMutationResult,
  encodeCanonicalCanvasSceneMutationRequest,
  encodeCanonicalCanvasSceneMutationResult,
  getOwnedDocumentSchemaRegistration,
} from "../../shared/block-documents";
import {
  isSafeAssetFileName,
  getAssetSource,
  NODEX_ASSET_SCHEME,
  parseAssetSource,
} from "../../shared/assets";
import { CURRENT_SCHEMA_VERSION } from "./schema";
import { readCanvasSceneAuthoritySnapshot } from "./canvas-scene-authority-reader";
import { readCanvasPageReferenceTable } from "./legacy-page-projection-adapter";
import {
  isCanvasPageReferenceProjectionCurrent,
  isCanvasFileProjectionCurrent,
} from "./canvas-scene-projection-equivalence";
import { MAX_IMAGE_UPLOAD_BYTES } from "./assets";
import { findInvalidPageHierarchy } from "./page-hierarchy";

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

const hashText = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const validateCanvasMutationReceipts = (database: Database.Database): void => {
  const rows = database
    .prepare(
      `SELECT document_id, generation, mutation_id, client_session_id,
        base_head_seq, committed_head_seq, request_hash, request_byte_length,
        request_json, result_json, result_hash, outcome, committed_at
       FROM canvas_scene_mutation_receipts
       ORDER BY document_id, generation, mutation_id`,
    )
    .all() as readonly {
    readonly document_id: string;
    readonly generation: number;
    readonly mutation_id: string;
    readonly client_session_id: string;
    readonly base_head_seq: number;
    readonly committed_head_seq: number;
    readonly request_hash: string;
    readonly request_byte_length: number;
    readonly request_json: string;
    readonly result_json: string;
    readonly result_hash: string;
    readonly outcome: "committed" | "no_change";
    readonly committed_at: string;
  }[];
  for (const row of rows) {
    try {
      const request = canonicalizeCanvasSceneMutationRequest(
        JSON.parse(row.request_json) as unknown,
      );
      const canonicalRequest = encodeCanonicalCanvasSceneMutationRequest(request);
      const result = canonicalizeCanvasSceneMutationResult(
        JSON.parse(row.result_json) as unknown,
      );
      if (
        canonicalRequest !== row.request_json ||
        hashText(row.request_json) !== row.request_hash ||
        Buffer.byteLength(row.request_json) !== row.request_byte_length ||
        encodeCanonicalCanvasSceneMutationResult(result) !== row.result_json ||
        hashText(row.result_json) !== row.result_hash ||
        request.documentId !== row.document_id ||
        request.generation !== row.generation ||
        request.mutationId !== row.mutation_id ||
        request.clientSessionId !== row.client_session_id ||
        request.baseHeadSeq !== row.base_head_seq ||
        result.documentId !== row.document_id ||
        result.generation !== row.generation ||
        result.mutationId !== row.mutation_id ||
        result.projectId !== request.projectId ||
        result.storeEpoch !== request.storeEpoch ||
        result.baseHeadSeq !== row.base_head_seq ||
        result.headSeq !== row.committed_head_seq ||
        result.outcome !== row.outcome ||
        result.committedAt !== row.committed_at ||
        result.duplicate !== false
      ) {
        throw new TypeError("receipt evidence diverges");
      }
    } catch (error) {
      throw new BackupStoreValidationError(
        `Backup Canvas mutation receipt is corrupt: ${row.document_id}/${row.mutation_id}`,
        { cause: error },
      );
    }
  }
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
    readonly assetsPath: string;
    readonly expectedSchemaVersion: number;
  },
): ValidatedBackupStore => {
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  const schemaVersion = database.pragma("user_version", {
    simple: true,
  }) as number;
  if (schemaVersion !== options.expectedSchemaVersion) {
    throw new BackupStoreValidationError(
      `Backup schema v${schemaVersion} is not the expected v${options.expectedSchemaVersion}`,
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

  const invalidPageOwnership = scalarCount(
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
      WHERE block.type = 'page'
        AND (
          ownership.block_id IS NULL
          OR document.id IS NULL
          OR document.schema_key <> '${PAGE_DOCUMENT_SCHEMA_KEY}'
        )
    `,
  );
  if (invalidPageOwnership > 0) {
    throw new BackupStoreValidationError(
      `Backup database has ${invalidPageOwnership} Page(s) without a valid owned Document`,
    );
  }

  const hasCanonicalPages = scalarCount(
    database,
    `
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table' AND name = 'pages'
    `,
  ) === 1;
  if (hasCanonicalPages) {
    const invalidPageHierarchy = findInvalidPageHierarchy(database);
    if (invalidPageHierarchy) {
      throw new BackupStoreValidationError(
        `Backup Page ${invalidPageHierarchy.pageId} has an invalid ownership hierarchy: ${invalidPageHierarchy.error.message}`,
      );
    }
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
      SELECT document.id, document.project_id, document.generation, document.head_seq,
        document.schema_key, document.schema_version, document.readiness,
        document.sync_engine, ownership.block_id AS owner_block_id,
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
    readonly project_id: string;
    readonly generation: number;
    readonly head_seq: number;
    readonly schema_key: string;
    readonly schema_version: number;
    readonly readiness: string;
    readonly sync_engine: "yjs" | "canvas_scene";
    readonly owner_block_id: string;
    readonly owner_type: string;
  }[];
  let stalePrimaryProjections = 0;
  for (const document of primaryDocuments) {
    let contentModel: "block_tree" | "scene_graph";
    try {
      const adapter = getOwnedDocumentSchemaRegistration({
        ownerType: document.owner_type,
        schemaKey: document.schema_key,
        schemaVersion: document.schema_version,
      });
      if (adapter.syncEngine !== document.sync_engine) {
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
        const authority = readCanvasSceneAuthoritySnapshot(database, {
          documentId: document.id,
          generation: document.generation,
          headSeq: document.head_seq,
          schemaVersion: document.schema_version,
        });
        const marker = database
          .prepare(
            `SELECT document_generation AS generation, projected_seq, text,
               text_hash
             FROM block_search_units
             WHERE document_id = ? AND owner_block_id = ?
               AND block_id = ? AND source_kind = 'document_marker'
               AND field_key = 'marker'`,
          )
          .get(
            document.id,
            document.owner_block_id,
            document.owner_block_id,
          ) as
          | {
              readonly generation: number;
              readonly projected_seq: number;
              readonly text: string;
              readonly text_hash: string;
            }
          | undefined;
        projection = marker;
        if (
          marker &&
          (marker.text !== authority.scene.plainText ||
            marker.text_hash !== hashText(authority.scene.plainText))
        ) {
          projection = undefined;
        }
        const projectedReferences = database
          .prepare(
            `SELECT source_element_id, target_block_id
             FROM ${readCanvasPageReferenceTable(database)}
             WHERE document_id = ? AND project_id = ?
               AND document_generation = ? AND projected_seq = ?
             ORDER BY source_element_id`,
          )
          .all(
            document.id,
            document.project_id,
            document.generation,
            document.head_seq,
          ) as readonly {
          readonly source_element_id: string;
          readonly target_block_id: string;
        }[];
        if (
          !isCanvasPageReferenceProjectionCurrent(
            authority.scene.pageReferences,
            projectedReferences,
          )
        ) {
          projection = undefined;
        }
        const projectedFiles = database
          .prepare(
            `SELECT file_id, mime_type, asset_uri
             FROM canvas_scene_file_refs
             WHERE document_id = ? AND project_id = ?
               AND document_generation = ? AND projected_seq = ?
             ORDER BY file_id`,
          )
          .all(
            document.id,
            document.project_id,
            document.generation,
            document.head_seq,
          ) as readonly {
          readonly file_id: string;
          readonly mime_type: string;
          readonly asset_uri: string;
        }[];
        if (!isCanvasFileProjectionCurrent(authority.scene.files, projectedFiles)) {
          projection = undefined;
        }
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

  const canvasYjsRowCount = (
    database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM document_updates update_row
            INNER JOIN documents document ON document.id = update_row.document_id
            WHERE document.sync_engine = 'canvas_scene') +
          (SELECT COUNT(*) FROM document_snapshots snapshot
            INNER JOIN documents document ON document.id = snapshot.document_id
            WHERE document.sync_engine = 'canvas_scene') +
          (SELECT COUNT(*) FROM document_update_receipts receipt
            INNER JOIN documents document ON document.id = receipt.document_id
            WHERE document.sync_engine = 'canvas_scene') AS count`,
      )
      .get() as { readonly count: number }
  ).count;
  if (canvasYjsRowCount > 0) {
    throw new BackupStoreValidationError(
      `Backup database has ${canvasYjsRowCount} Canvas row(s) in Yjs authority tables`,
    );
  }
  validateCanvasMutationReceipts(database);

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
    readonly assetsPath?: string;
    readonly expectedSchemaVersion?: number;
  } = {},
): ValidatedBackupStore {
  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    return validateOpenDatabase(database, {
      assetsPath:
        options.assetsPath ?? path.join(path.dirname(databasePath), "assets"),
      expectedSchemaVersion:
        options.expectedSchemaVersion ?? CURRENT_SCHEMA_VERSION,
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
