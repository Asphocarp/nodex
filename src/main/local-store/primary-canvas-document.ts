import type Database from "better-sqlite3";
import * as Y from "yjs";
import {
  CANVAS_BLOCK_TYPE,
  CANVAS_DOCUMENT_SCHEMA_KEY,
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  materializePortableCanvasScene,
  primaryCanvasBlockId,
  primaryCanvasDocumentId,
} from "../../shared/block-documents";
import { getAssetSource, parseAssetSource } from "../../shared/assets";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import { materializeInlineCanvasImage } from "./assets";
import {
  getOwnedBlockDocumentDescriptor,
  getOwnedDocumentDescriptor,
} from "./block-document-cutover";
import { initializeLegacyCanvasYjsGenesis } from "./block-document-store";
import { initializeCanvasSceneAuthority, syncCanvasScene } from "./canvas-scene-store";
import {
  createCanvasDocument,
  type CanvasSceneSnapshot,
} from "./legacy-canvas-ydoc-codec";

const PRIMARY_CANVAS_RANK_KEY = "e0000000000000000000000000000000";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Legacy Canvas ${label} is invalid JSON`, { cause: error });
  }
};

const hasLegacyCanvasTable = (database: Database.Database): boolean =>
  Boolean(
    database
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'canvas'`,
      )
      .get(),
  );

const readLegacyCanvasScene = (
  database: Database.Database,
  projectId: string,
): CanvasSceneSnapshot => {
  if (!hasLegacyCanvasTable(database)) {
    return { elements: [], appState: {}, files: {} };
  }
  const columns = new Set(
    (
      database.prepare("PRAGMA table_info(canvas)").all() as readonly {
        readonly name: string;
      }[]
    ).map((column) => column.name),
  );
  if (!["elements", "app_state", "files"].every((name) => columns.has(name))) {
    return { elements: [], appState: {}, files: {} };
  }
  const row = database
    .prepare(
      `SELECT elements, app_state, files FROM canvas WHERE project_id = ?`,
    )
    .get(projectId) as
    | {
        readonly elements: string;
        readonly app_state: string;
        readonly files: string;
      }
    | undefined;
  if (!row) return { elements: [], appState: {}, files: {} };
  const elements = parseJson(row.elements, "elements");
  const appState = parseJson(row.app_state, "appState");
  const files = parseJson(row.files, "files");
  if (!Array.isArray(elements) || !isRecord(appState) || !isRecord(files)) {
    throw new Error("Legacy Canvas scene has invalid JSON shapes");
  }
  const managedFiles: Record<string, unknown> = {};
  for (const [fileId, candidate] of Object.entries(files)) {
    if (!isRecord(candidate) || typeof candidate.mimeType !== "string") {
      throw new Error(`Legacy Canvas file ${fileId} is malformed`);
    }
    const parsedSource =
      typeof candidate.source === "string"
        ? parseAssetSource(candidate.source)
        : null;
    const managed =
      parsedSource
        ? {
            source: getAssetSource(parsedSource.fileName),
            mimeType: candidate.mimeType,
          }
        : typeof candidate.dataURL === "string"
          ? materializeInlineCanvasImage(candidate.dataURL)
          : null;
    if (!managed) {
      throw new Error(`Legacy Canvas file ${fileId} has no recoverable data`);
    }
    managedFiles[fileId] = {
      id: fileId,
      mimeType: managed.mimeType,
      source: managed.source,
      ...(typeof candidate.created === "number" &&
      Number.isSafeInteger(candidate.created) &&
      candidate.created >= 0
        ? { created: candidate.created }
        : {}),
    };
  }
  return { elements, appState, files: managedFiles };
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row) return row.store_epoch;
  throw new Error("Block store metadata is missing");
};

const assertExistingPrimaryCanvas = (
  database: Database.Database,
  projectId: string,
  blockId: string,
) => {
  const schemaVersion = database.pragma("user_version", { simple: true }) as number;
  if (schemaVersion >= 71) {
    const descriptor = getOwnedDocumentDescriptor(database, projectId, blockId);
    const synced = syncCanvasScene(database, {
      version: 1,
      projectId,
      documentId: descriptor.documentId,
      clientSessionId: "system:primary-canvas-check",
    });
    if (
      descriptor.ownerType === CANVAS_BLOCK_TYPE &&
      descriptor.ownerLifecycle === "active" &&
      descriptor.documentId === primaryCanvasDocumentId(projectId) &&
      descriptor.schemaKey === CANVAS_DOCUMENT_SCHEMA_KEY &&
      descriptor.schemaVersion === CANVAS_DOCUMENT_SCHEMA_VERSION &&
      descriptor.readiness === "ready" &&
      descriptor.sync.kind === "canvas_scene" &&
      synced.ok
    ) {
      return descriptor;
    }
    throw new Error(`Project ${projectId} has a corrupt primary Canvas owner`);
  }
  const descriptor = getOwnedBlockDocumentDescriptor(
    database,
    projectId,
    blockId,
  );
  if (
    descriptor.ownerType === CANVAS_BLOCK_TYPE &&
    descriptor.ownerLifecycle === "active" &&
    descriptor.documentId === primaryCanvasDocumentId(projectId) &&
    descriptor.schemaKey === CANVAS_DOCUMENT_SCHEMA_KEY &&
    descriptor.schemaVersion === CANVAS_DOCUMENT_SCHEMA_VERSION &&
    descriptor.readiness === "ready" &&
    descriptor.authority === "ydoc_primary"
  ) {
    return descriptor;
  }
  throw new Error(`Project ${projectId} has a corrupt primary Canvas owner`);
};

/** Idempotently bootstrap the Project's default Canvas through its live engine. */
export const ensurePrimaryCanvasDocument = (
  database: Database.Database,
  projectId: string,
) => {
  const blockId = primaryCanvasBlockId(projectId);
  const documentId = primaryCanvasDocumentId(projectId);
  const existingBlock = database
    .prepare("SELECT 1 FROM blocks WHERE id = ?")
    .get(blockId);
  if (existingBlock) {
    return assertExistingPrimaryCanvas(database, projectId, blockId);
  }
  if (
    database.prepare("SELECT 1 FROM documents WHERE id = ?").get(documentId)
  ) {
    throw new Error(`Primary Canvas Document identity collision: ${documentId}`);
  }
  const schemaVersion = database.pragma("user_version", { simple: true }) as number;
  const scene = readLegacyCanvasScene(database, projectId);
  const create = database.transaction(() => {
    const now = new Date().toISOString();
    database
      .prepare(
        `
        INSERT INTO blocks (
          id, project_id, type, lifecycle, location_kind,
          containing_document_id, location_revision, metadata_revision,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'active', 'space', NULL, 1, 1, ?, ?)
      `,
      )
      .run(blockId, projectId, CANVAS_BLOCK_TYPE, now, now);
    database
      .prepare(
        `
        INSERT INTO block_properties (
          block_id, project_id, property_key, value_type,
          value_json, revision, updated_at
        ) VALUES (?, ?, 'document.display_name', 'string', ?, 1, ?)
      `,
      )
      .run(
        blockId,
        projectId,
        stableStringifyBlockPropertyJson("Canvas"),
        now,
      );
    database
      .prepare(
        `
        INSERT INTO top_level_block_placements (
          block_id, project_id, rank_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(blockId, projectId, PRIMARY_CANVAS_RANK_KEY, now, now);
    if (schemaVersion >= 71) {
      database
        .prepare(
          `INSERT INTO documents (
            id, project_id, generation, head_seq, schema_key, schema_version,
            state_vector, state_hash, sync_engine, readiness, authority,
            genesis_source_revision, created_at, updated_at
          ) VALUES (?, ?, 1, 0, ?, ?, X'', ?, 'canvas_scene',
            'ready', 'ydoc_primary', NULL, ?, ?)` ,
        )
        .run(
          documentId,
          projectId,
          CANVAS_DOCUMENT_SCHEMA_KEY,
          CANVAS_DOCUMENT_SCHEMA_VERSION,
          "0".repeat(64),
          now,
          now,
        );
    } else {
      database
        .prepare(
          `INSERT INTO documents (
            id, project_id, generation, head_seq, schema_key, schema_version,
            state_vector, state_hash, readiness, authority,
            genesis_source_revision, created_at, updated_at
          ) VALUES (?, ?, 1, 0, ?, ?, X'', '',
            'pending_genesis', 'legacy_shadow', NULL, ?, ?)` ,
        )
        .run(
          documentId,
          projectId,
          CANVAS_DOCUMENT_SCHEMA_KEY,
          CANVAS_DOCUMENT_SCHEMA_VERSION,
          now,
          now,
        );
    }
    database
      .prepare(
        `
        INSERT INTO block_documents (
          block_id, document_id, project_id, created_at
        ) VALUES (?, ?, ?, ?)
      `,
      )
      .run(blockId, documentId, projectId, now);
    if (schemaVersion >= 71) {
      initializeCanvasSceneAuthority(database, {
        projectId,
        documentId,
        expectedGeneration: 1,
        expectedHeadSeq: 0,
        scene: materializePortableCanvasScene({
          elements: scene.elements,
          appState: scene.appState,
          files: scene.files,
        }),
      });
      return;
    }
    const envelope = createCanvasDocument({ documentId, initialScene: scene });
    try {
    initializeLegacyCanvasYjsGenesis(database, {
        documentId,
        storeEpoch: readStoreEpoch(database),
        generation: 1,
        updateId: `canvas-bootstrap:${projectId}:genesis`,
        clientSessionId: `canvas-bootstrap:${projectId}`,
        update: Y.encodeStateAsUpdate(envelope.document),
        finalAuthority: "ydoc_primary",
      });
    } finally {
      envelope.document.destroy();
    }
  });
  create.immediate();
  return assertExistingPrimaryCanvas(database, projectId, blockId);
};

export const ensurePrimaryCanvasDocuments = (
  database: Database.Database,
): number => {
  const projects = database
    .prepare("SELECT id FROM projects ORDER BY id")
    .all() as readonly { readonly id: string }[];
  projects.forEach((project) =>
    ensurePrimaryCanvasDocument(database, project.id),
  );
  if (hasLegacyCanvasTable(database)) {
    database.exec("DROP TABLE canvas");
  }
  return projects.length;
};
