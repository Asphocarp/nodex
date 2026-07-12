import { createHash } from "node:crypto";
import * as fs from "node:fs";
import type Database from "better-sqlite3";
import {
  CANVAS_SCENE_SYNC_VERSION,
  canonicalPortableCanvasSceneFingerprint,
  canonicalStringifyCanvasScene,
  canvasSceneElementOrderKey,
  chooseCanvasSceneElementWinner,
  materializePortableCanvasScene,
  parsePortableCanvasScene,
  type CanvasSceneElement,
  type CanvasSceneFile,
  type CanvasSceneJsonValue,
  type PortableCanvasScene,
} from "../../shared/block-documents";
import {
  canonicalizeCanvasSceneMutationRequest,
  encodeCanonicalCanvasSceneMutationRequest,
  type CanvasSceneCommittedEvent,
  type CanvasSceneMutationCommandResult,
  type CanvasSceneMutationError,
  type CanvasSceneMutationErrorCode,
  type CanvasSceneMutationRequest,
  type CanvasSceneMutationResult,
  type CanvasSceneOptionalJson,
  type CanvasSceneSyncCommandResult,
  type CanvasSceneSyncRequest,
  type CanvasSceneSyncResponse,
} from "../../shared/block-documents/canvas-scene-sync";
import { parseAssetSource } from "../../shared/assets";
import { getOwnedDocumentSchemaRegistration } from "../../shared/block-documents/document-schema-adapters";
import { replaceDocumentSecondaryProjections } from "./block-document-projections";
import { resolveAssetPath } from "./assets";
import {
  CanvasSceneAuthorityReadError,
  readCanvasSceneAuthoritySnapshot,
} from "./canvas-scene-authority-reader";

interface CanvasDocumentRow {
  readonly document_id: string;
  readonly project_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly sync_engine: "yjs" | "canvas_scene";
  readonly readiness: string;
  readonly authority: string;
  readonly owner_block_id: string;
  readonly owner_type: string;
}

interface CanvasReceiptRow {
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
  readonly outcome: "committed" | "no_change";
  readonly committed_at: string;
}

interface LoadedCanvasAuthority {
  readonly document: CanvasDocumentRow;
  readonly storeEpoch: string;
  readonly sceneRow: { readonly scene_hash: string; readonly updated_at: string };
  readonly scene: PortableCanvasScene;
  readonly elementsById: ReadonlyMap<
    string,
    { readonly element: CanvasSceneElement; readonly orderKey: string }
  >;
  readonly filesById: ReadonlyMap<string, CanvasSceneFile>;
}

export interface InitializeCanvasSceneAuthorityInput {
  readonly projectId: string;
  readonly documentId: string;
  readonly expectedGeneration: number;
  readonly expectedHeadSeq: number;
  readonly scene: PortableCanvasScene;
  readonly updatedAt?: string;
}

export interface ApplyCanvasSceneMutationOptions {
  readonly now?: () => string;
}

export class CanvasSceneStoreError extends Error {
  constructor(
    readonly code: CanvasSceneMutationErrorCode,
    message: string,
    readonly retryable = false,
    readonly resetRequired = false,
    readonly mutationId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CanvasSceneStoreError";
  }
}

export const toCanvasSceneCommandError = (
  error: unknown,
  mutationId?: string,
): CanvasSceneMutationError => {
  if (error instanceof CanvasSceneStoreError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      resetRequired: error.resetRequired,
      ...(error.mutationId ?? mutationId
        ? { mutationId: error.mutationId ?? mutationId }
        : {}),
    };
  }
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    resetRequired: false,
    ...(mutationId ? { mutationId } : {}),
  };
};

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const parseJson = (value: string, field: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new CanvasSceneStoreError(
      "canvas_scene_corrupt",
      `Stored Canvas ${field} is invalid JSON`,
      false,
      true,
      undefined,
      { cause: error },
    );
  }
};

const sameJson = (left: unknown, right: unknown): boolean =>
  canonicalStringifyCanvasScene(left) === canonicalStringifyCanvasScene(right);

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row?.store_epoch) return row.store_epoch;
  throw new CanvasSceneStoreError(
    "canvas_scene_corrupt",
    "Block store epoch is missing",
    false,
    true,
  );
};

const readDocument = (
  database: Database.Database,
  projectId: string,
  documentId: string,
): CanvasDocumentRow => {
  const row = database
    .prepare(
      `
      SELECT document.id AS document_id, document.project_id,
        document.generation, document.head_seq, document.schema_key,
        document.schema_version, document.sync_engine, document.readiness,
        document.authority,
        ownership.block_id AS owner_block_id, owner.type AS owner_type
      FROM documents document
      INNER JOIN block_documents ownership
        ON ownership.document_id = document.id
        AND ownership.project_id = document.project_id
      INNER JOIN blocks owner
        ON owner.id = ownership.block_id
        AND owner.project_id = ownership.project_id
      WHERE document.id = ?
    `,
    )
    .get(documentId) as CanvasDocumentRow | undefined;
  if (!row) {
    throw new CanvasSceneStoreError(
      "document_not_found",
      `Canvas Document does not exist: ${documentId}`,
    );
  }
  if (row.project_id !== projectId) {
    throw new CanvasSceneStoreError(
      "project_scope_mismatch",
      `Canvas Document ${documentId} does not belong to Project ${projectId}`,
    );
  }
  if (row.readiness !== "ready" || row.authority !== "ydoc_primary") {
    throw new CanvasSceneStoreError(
      "document_not_ready",
      `Canvas Document ${documentId} is not ready`,
      true,
    );
  }
  let registration;
  try {
    registration = getOwnedDocumentSchemaRegistration({
      ownerType: row.owner_type,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
    });
  } catch (error) {
    throw new CanvasSceneStoreError(
      "document_engine_mismatch",
      `Document ${documentId} has no registered Canvas scene engine`,
      false,
      true,
      undefined,
      { cause: error },
    );
  }
  if (
    registration.syncEngine === "canvas_scene" &&
    row.sync_engine === "canvas_scene"
  ) return row;
  throw new CanvasSceneStoreError(
    "document_engine_mismatch",
    `Document ${documentId} stores ${row.sync_engine} but its schema requires ${registration.syncEngine}`,
    false,
    true,
  );
};

const loadAuthority = (
  database: Database.Database,
  projectId: string,
  documentId: string,
): LoadedCanvasAuthority => {
  const document = readDocument(database, projectId, documentId);
  let snapshot;
  try {
    snapshot = readCanvasSceneAuthoritySnapshot(database, {
      documentId,
      generation: document.generation,
      headSeq: document.head_seq,
      schemaVersion: document.schema_version,
    });
  } catch (error) {
    if (!(error instanceof CanvasSceneAuthorityReadError)) throw error;
    throw new CanvasSceneStoreError(
      "canvas_scene_corrupt",
      error.message,
      false,
      true,
      undefined,
      { cause: error },
    );
  }
  return {
    document,
    storeEpoch: readStoreEpoch(database),
    sceneRow: {
      scene_hash: snapshot.sceneHash,
      updated_at: snapshot.updatedAt,
    },
    scene: snapshot.scene,
    elementsById: snapshot.elementsById,
    filesById: snapshot.filesById,
  };
};

const toSyncResponse = (authority: LoadedCanvasAuthority): CanvasSceneSyncResponse => ({
  version: CANVAS_SCENE_SYNC_VERSION,
  projectId: authority.document.project_id,
  documentId: authority.document.document_id,
  storeEpoch: authority.storeEpoch,
  generation: authority.document.generation,
  headSeq: authority.document.head_seq,
  sceneHash: authority.sceneRow.scene_hash,
  scene: authority.scene,
});

const persistElement = (
  database: Database.Database,
  documentId: string,
  element: CanvasSceneElement,
  orderKey: string,
  updatedAt: string,
): void => {
  const elementJson = canonicalStringifyCanvasScene(element);
  database
    .prepare(
      `INSERT INTO canvas_scene_elements (
        document_id, element_id, version, version_nonce, order_key,
        is_deleted, element_json, element_hash, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id, element_id) DO UPDATE SET
        version = excluded.version,
        version_nonce = excluded.version_nonce,
        order_key = excluded.order_key,
        is_deleted = excluded.is_deleted,
        element_json = excluded.element_json,
        element_hash = excluded.element_hash,
        updated_at = excluded.updated_at`,
    )
    .run(
      documentId,
      element.id,
      element.version,
      element.versionNonce,
      orderKey,
      element.isDeleted === true ? 1 : 0,
      elementJson,
      sha256(elementJson),
      updatedAt,
    );
};

const persistFile = (
  database: Database.Database,
  documentId: string,
  file: CanvasSceneFile,
  updatedAt: string,
): void => {
  const fileJson = canonicalStringifyCanvasScene(file);
  database
    .prepare(
      `INSERT INTO canvas_scene_files (
        document_id, file_id, mime_type, asset_uri, created_ms,
        file_json, file_hash, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id, file_id) DO UPDATE SET
        mime_type = excluded.mime_type,
        asset_uri = excluded.asset_uri,
        created_ms = excluded.created_ms,
        file_json = excluded.file_json,
        file_hash = excluded.file_hash,
        updated_at = excluded.updated_at`,
    )
    .run(
      documentId,
      file.id,
      file.mimeType,
      file.source,
      file.created ?? null,
      fileJson,
      sha256(fileJson),
      updatedAt,
    );
};

const persistDerivedProjections = (
  database: Database.Database,
  authority: Pick<LoadedCanvasAuthority, "document">,
  headSeq: number,
): void => {
  replaceDocumentSecondaryProjections(database, {
    documentId: authority.document.document_id,
    expectedGeneration: authority.document.generation,
    expectedProjectedSeq: headSeq,
  });
};

const assertCardReferencesAreScoped = (
  database: Database.Database,
  projectId: string,
  scene: PortableCanvasScene,
): void => {
  const targetIds = [...new Set(
    scene.cardReferences.map((reference) => reference.targetBlockId),
  )];
  if (targetIds.length === 0) return;
  const placeholders = targetIds.map(() => "?").join(", ");
  const count = (
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM blocks
         WHERE project_id = ? AND lifecycle <> 'deleted'
           AND type = 'card'
           AND id IN (${placeholders})`,
      )
      .get(projectId, ...targetIds) as { readonly count: number }
  ).count;
  if (count === targetIds.length) return;
  throw new CanvasSceneStoreError(
    "invalid_canvas_scene_mutation",
    "Canvas scene contains a missing, deleted, or cross-Project Card reference",
  );
};

export const initializeCanvasSceneAuthority = (
  database: Database.Database,
  input: InitializeCanvasSceneAuthorityInput,
): CanvasSceneSyncResponse => {
  const scene = parsePortableCanvasScene(input.scene);
  const initialize = database.transaction(() => {
    const document = readDocument(database, input.projectId, input.documentId);
    if (
      document.generation !== input.expectedGeneration ||
      document.head_seq !== input.expectedHeadSeq
    ) {
      throw new CanvasSceneStoreError(
        "document_generation_mismatch",
        `Canvas Document ${input.documentId} changed before initialization`,
        false,
        true,
      );
    }
    const existing = database
      .prepare("SELECT 1 FROM canvas_scenes WHERE document_id = ?")
      .get(input.documentId);
    if (existing) {
      const loaded = loadAuthority(database, input.projectId, input.documentId);
      if (
        canonicalPortableCanvasSceneFingerprint(loaded.scene) ===
        canonicalPortableCanvasSceneFingerprint(scene)
      ) {
        return toSyncResponse(loaded);
      }
      throw new CanvasSceneStoreError(
        "canvas_scene_corrupt",
        `Canvas scene authority already exists with different content: ${input.documentId}`,
        false,
        true,
      );
    }
    assertCardReferencesAreScoped(database, input.projectId, scene);
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const sceneHash = sha256(canonicalPortableCanvasSceneFingerprint(scene));
    const updatedDocument = database
      .prepare(
        `UPDATE documents
         SET state_vector = X'', state_hash = ?, updated_at = ?
         WHERE id = ? AND project_id = ?
           AND generation = ? AND head_seq = ?
           AND sync_engine = 'canvas_scene'`,
      )
      .run(
        sceneHash,
        updatedAt,
        input.documentId,
        input.projectId,
        document.generation,
        document.head_seq,
      );
    if (updatedDocument.changes !== 1) {
      throw new CanvasSceneStoreError(
        "document_engine_mismatch",
        `Canvas Document ${input.documentId} is not staged for scene authority`,
        false,
        true,
      );
    }
    database
      .prepare(
        `INSERT INTO canvas_scenes (
          document_id, generation, head_seq, schema_version,
          app_state_json, scene_hash, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.documentId,
        document.generation,
        document.head_seq,
        document.schema_version,
        canonicalStringifyCanvasScene(scene.appState),
        sceneHash,
        updatedAt,
      );
    scene.elements.forEach((element, ordinal) =>
      persistElement(
        database,
        input.documentId,
        element,
        canvasSceneElementOrderKey(element, ordinal),
        updatedAt,
      ),
    );
    for (const file of Object.values(scene.files)) {
      persistFile(database, input.documentId, file, updatedAt);
    }
    persistDerivedProjections(database, { document }, document.head_seq);
    return toSyncResponse(loadAuthority(database, input.projectId, input.documentId));
  });
  return initialize.immediate();
};

const validateSyncRequest = (request: CanvasSceneSyncRequest): void => {
  if (request.version !== CANVAS_SCENE_SYNC_VERSION) {
    throw new CanvasSceneStoreError(
      "invalid_canvas_scene_mutation",
      `Canvas scene sync version must be ${CANVAS_SCENE_SYNC_VERSION}`,
    );
  }
  for (const [field, value] of [
    ["projectId", request.projectId],
    ["documentId", request.documentId],
    ["clientSessionId", request.clientSessionId],
  ] as const) {
    if (value.length > 0 && value === value.trim()) continue;
    throw new CanvasSceneStoreError(
      "invalid_canvas_scene_mutation",
      `${field} must be non-empty`,
    );
  }
};

export const syncCanvasScene = (
  database: Database.Database,
  request: CanvasSceneSyncRequest,
): CanvasSceneSyncCommandResult => {
  try {
    validateSyncRequest(request);
    const read = database.transaction(() => {
      const authority = loadAuthority(database, request.projectId, request.documentId);
      if (
        request.knownStoreEpoch !== undefined &&
        request.knownStoreEpoch !== authority.storeEpoch
      ) {
        throw new CanvasSceneStoreError(
          "store_epoch_mismatch",
          "Canvas scene sync belongs to another store epoch",
          false,
          true,
        );
      }
      return toSyncResponse(authority);
    });
    return { ok: true, value: read() };
  } catch (error) {
    return { ok: false, error: toCanvasSceneCommandError(error) };
  }
};

const readReceipt = (
  database: Database.Database,
  documentId: string,
  mutationId: string,
): CanvasReceiptRow | null =>
  (database
    .prepare(
      `SELECT document_id, generation, mutation_id, client_session_id,
        base_head_seq, committed_head_seq, request_hash, request_byte_length,
        request_json, result_json, outcome, committed_at
       FROM canvas_scene_mutation_receipts
       WHERE document_id = ? AND mutation_id = ?`,
    )
    .get(documentId, mutationId) as CanvasReceiptRow | undefined) ?? null;

const replayReceipt = (
  receipt: CanvasReceiptRow,
  request: CanvasSceneMutationRequest,
  requestHash: string,
): CanvasSceneMutationCommandResult => {
  if (
    sha256(receipt.request_json) !== receipt.request_hash ||
    Buffer.byteLength(receipt.request_json) !== receipt.request_byte_length
  ) {
    throw new CanvasSceneStoreError(
      "canvas_scene_corrupt",
      `Canvas mutation receipt ${request.mutationId} request evidence diverges`,
      false,
      true,
      request.mutationId,
    );
  }
  if (receipt.request_hash !== requestHash) {
    throw new CanvasSceneStoreError(
      "mutation_id_collision",
      `Canvas mutation identity ${request.mutationId} was already used`,
      false,
      false,
      request.mutationId,
    );
  }
  const parsed = parseJson(receipt.result_json, "mutation receipt result");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CanvasSceneStoreError(
      "canvas_scene_corrupt",
      `Canvas mutation receipt ${request.mutationId} is corrupt`,
      false,
      true,
      request.mutationId,
    );
  }
  const result = parsed as CanvasSceneMutationResult;
  if (
    result.mutationId !== request.mutationId ||
    result.documentId !== request.documentId ||
    result.generation !== receipt.generation ||
    result.headSeq !== receipt.committed_head_seq ||
    result.outcome !== receipt.outcome
  ) {
    throw new CanvasSceneStoreError(
      "canvas_scene_corrupt",
      `Canvas mutation receipt ${request.mutationId} result diverges`,
      false,
      true,
      request.mutationId,
    );
  }
  return { ok: true, value: { ...result, duplicate: true } };
};

const optionalMatches = (
  current: CanvasSceneJsonValue | undefined,
  expected: CanvasSceneOptionalJson,
): boolean =>
  expected.kind === "absent"
    ? current === undefined
    : current !== undefined && sameJson(current, expected.value);

const applyOptional = (
  target: Record<string, CanvasSceneJsonValue>,
  key: string,
  value: CanvasSceneOptionalJson,
): void => {
  if (value.kind === "absent") {
    delete target[key];
    return;
  }
  target[key] = value.value;
};

const referencedFileIds = (
  elements: Iterable<CanvasSceneElement>,
): ReadonlySet<string> => {
  const referenced = new Set<string>();
  for (const element of elements) {
    if (
      element.isDeleted !== true &&
      element.type === "image" &&
      typeof element.fileId === "string"
    ) {
      referenced.add(element.fileId);
    }
  }
  return referenced;
};

const assertFileAdditionsAreDurable = (
  additions: Readonly<Record<string, CanvasSceneFile>>,
  mutationId: string,
): void => {
  for (const [fileId, file] of Object.entries(additions)) {
    const parsed = parseAssetSource(file.source);
    if (!parsed) {
      throw new CanvasSceneStoreError(
        "invalid_canvas_scene_mutation",
        `Canvas file ${fileId} does not use a managed asset URI`,
        false,
        false,
        mutationId,
      );
    }
    try {
      const stats = fs.lstatSync(resolveAssetPath(parsed.fileName));
      if (stats.isFile() && !stats.isSymbolicLink()) continue;
    } catch {
      // Report one stable boundary error below.
    }
    throw new CanvasSceneStoreError(
      "invalid_canvas_scene_mutation",
      `Canvas file ${fileId} references a missing managed asset`,
      false,
      false,
      mutationId,
    );
  }
};

export const applyCanvasSceneMutation = (
  database: Database.Database,
  requestInput: CanvasSceneMutationRequest,
  options: ApplyCanvasSceneMutationOptions = {},
): CanvasSceneMutationCommandResult => {
  let request: CanvasSceneMutationRequest;
  try {
    request = canonicalizeCanvasSceneMutationRequest(requestInput);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "invalid_canvas_scene_mutation",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        resetRequired: false,
        mutationId: requestInput.mutationId,
      },
    };
  }
  try {
    const requestJson = encodeCanonicalCanvasSceneMutationRequest(request);
    const requestHash = sha256(requestJson);
    const apply = database.transaction((): CanvasSceneMutationCommandResult => {
      const storeEpoch = readStoreEpoch(database);
      if (storeEpoch !== request.storeEpoch) {
        throw new CanvasSceneStoreError(
          "store_epoch_mismatch",
          "Canvas mutation belongs to another store epoch",
          false,
          true,
          request.mutationId,
        );
      }
      const document = readDocument(database, request.projectId, request.documentId);
      const existingReceipt = readReceipt(
        database,
        request.documentId,
        request.mutationId,
      );
      if (existingReceipt) {
        return replayReceipt(existingReceipt, request, requestHash);
      }
      if (document.generation !== request.generation) {
        throw new CanvasSceneStoreError(
          "document_generation_mismatch",
          `Canvas Document generation is ${document.generation}; expected ${request.generation}`,
          false,
          true,
          request.mutationId,
        );
      }
      if (request.baseHeadSeq > document.head_seq) {
        throw new CanvasSceneStoreError(
          "future_base_head",
          `Canvas mutation base head ${request.baseHeadSeq} is ahead of durable head ${document.head_seq}`,
          false,
          true,
          request.mutationId,
        );
      }
      const authority = loadAuthority(database, request.projectId, request.documentId);
      const elements = new Map(authority.elementsById);
      const changedElementIds: string[] = [];
      request.elementCandidates.forEach((candidate, ordinal) => {
        const elementId = candidate.id as string;
        const current = elements.get(elementId);
        const winner = current
          ? chooseCanvasSceneElementWinner(current.element, candidate)
          : candidate;
        if (current && sameJson(current.element, winner)) return;
        const orderKey =
          typeof winner.index === "string"
            ? winner.index
            : current?.orderKey ??
              canvasSceneElementOrderKey(
                winner,
                authority.elementsById.size + ordinal,
              );
        elements.set(elementId, { element: winner, orderKey });
        changedElementIds.push(elementId);
      });

      const appState: Record<string, CanvasSceneJsonValue> = {
        ...authority.scene.appState,
      };
      const appliedAppStateKeys: string[] = [];
      const skippedAppStateKeys: string[] = [];
      let appStateChanged = false;
      for (const [key, intent] of Object.entries(request.appStateIntents)) {
        const current = appState[key];
        if (!optionalMatches(current, intent.expected)) {
          skippedAppStateKeys.push(key);
          continue;
        }
        appliedAppStateKeys.push(key);
        const before = current;
        applyOptional(appState, key, intent.value);
        const after = appState[key];
        if (
          before === undefined
            ? after !== undefined
            : after === undefined || !sameJson(before, after)
        ) {
          appStateChanged = true;
        }
      }

      const combinedFiles = new Map(authority.filesById);
      assertFileAdditionsAreDurable(request.fileAdditions, request.mutationId);
      for (const [fileId, addition] of Object.entries(request.fileAdditions)) {
        const current = combinedFiles.get(fileId);
        if (current && !sameJson(current, addition)) {
          throw new CanvasSceneStoreError(
            "invalid_canvas_scene_mutation",
            `Canvas managed file ${fileId} cannot be redefined`,
            false,
            false,
            request.mutationId,
          );
        }
        combinedFiles.set(fileId, addition);
      }
      const referenced = referencedFileIds(
        [...elements.values()].map(({ element }) => element),
      );
      for (const fileId of referenced) {
        if (combinedFiles.has(fileId)) continue;
        throw new CanvasSceneStoreError(
          "invalid_canvas_scene_mutation",
          `Canvas image references missing managed file ${fileId}`,
          false,
          false,
          request.mutationId,
        );
      }
      const files = new Map(
        [...combinedFiles].filter(([fileId]) => referenced.has(fileId)),
      );
      const addedFileIds = [...files]
        .filter(([fileId]) => !authority.filesById.has(fileId))
        .map(([fileId]) => fileId)
        .sort();
      const removedFileIds = [...authority.filesById.keys()]
        .filter((fileId) => !files.has(fileId))
        .sort();
      const orderedElements = [...elements.values()]
        .sort((left, right) =>
          left.orderKey === right.orderKey
            ? String(left.element.id).localeCompare(String(right.element.id))
            : left.orderKey.localeCompare(right.orderKey),
        )
        .map(({ element }) => element);
      const scene = materializePortableCanvasScene({
        elements: orderedElements,
        appState,
        files: Object.fromEntries(files),
      });
      assertCardReferencesAreScoped(database, request.projectId, scene);
      const changed =
        changedElementIds.length > 0 ||
        appStateChanged ||
        addedFileIds.length > 0 ||
        removedFileIds.length > 0;
      const committedAt = (options.now ?? (() => new Date().toISOString()))();
      const headSeq = changed ? document.head_seq + 1 : document.head_seq;
      const sceneHash = sha256(canonicalPortableCanvasSceneFingerprint(scene));

      if (changed) {
        for (const elementId of changedElementIds) {
          const current = elements.get(elementId);
          if (!current) continue;
          persistElement(
            database,
            request.documentId,
            current.element,
            current.orderKey,
            committedAt,
          );
        }
        for (const fileId of removedFileIds) {
          database
            .prepare(
              "DELETE FROM canvas_scene_files WHERE document_id = ? AND file_id = ?",
            )
            .run(request.documentId, fileId);
        }
        for (const fileId of addedFileIds) {
          const file = files.get(fileId);
          if (file) persistFile(database, request.documentId, file, committedAt);
        }
        database
          .prepare(
            `UPDATE documents
             SET head_seq = ?, state_vector = X'', state_hash = ?, updated_at = ?
             WHERE id = ? AND project_id = ? AND generation = ? AND head_seq = ?`,
          )
          .run(
            headSeq,
            sceneHash,
            committedAt,
            request.documentId,
            request.projectId,
            request.generation,
            document.head_seq,
          );
        database
          .prepare(
            `UPDATE canvas_scenes
             SET head_seq = ?, app_state_json = ?, scene_hash = ?, updated_at = ?
             WHERE document_id = ? AND generation = ? AND head_seq = ?`,
          )
          .run(
            headSeq,
            canonicalStringifyCanvasScene(appState),
            sceneHash,
            committedAt,
            request.documentId,
            request.generation,
            document.head_seq,
          );
        persistDerivedProjections(database, { document }, headSeq);
      }

      const result: CanvasSceneMutationResult = {
        version: CANVAS_SCENE_SYNC_VERSION,
        mutationId: request.mutationId,
        projectId: request.projectId,
        documentId: request.documentId,
        storeEpoch,
        generation: request.generation,
        baseHeadSeq: request.baseHeadSeq,
        headSeq,
        duplicate: false,
        outcome: changed ? "committed" : "no_change",
        sceneHash,
        changedElementIds: [...changedElementIds].sort(),
        appliedAppStateKeys: [...appliedAppStateKeys].sort(),
        skippedAppStateKeys: [...skippedAppStateKeys].sort(),
        addedFileIds,
        removedFileIds,
        committedAt,
      };
      const resultJson = canonicalStringifyCanvasScene(result);
      database
        .prepare(
          `INSERT INTO canvas_scene_mutation_receipts (
            document_id, generation, mutation_id, client_session_id,
            base_head_seq, committed_head_seq, request_hash,
            request_byte_length, request_json, result_json, outcome, committed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.documentId,
          request.generation,
          request.mutationId,
          request.clientSessionId,
          request.baseHeadSeq,
          headSeq,
          requestHash,
          Buffer.byteLength(requestJson),
          requestJson,
          resultJson,
          result.outcome,
          committedAt,
        );
      if (!changed) return { ok: true, value: result };
      const event: CanvasSceneCommittedEvent = {
        type: "canvas_scene_committed",
        version: CANVAS_SCENE_SYNC_VERSION,
        projectId: request.projectId,
        documentId: request.documentId,
        storeEpoch,
        generation: request.generation,
        mutationId: request.mutationId,
        baseHeadSeq: document.head_seq,
        headSeq,
        sceneHash,
        elementUpdates: [...changedElementIds]
          .sort()
          .map((elementId) => elements.get(elementId)?.element)
          .filter((element): element is CanvasSceneElement => element !== undefined),
        appState: scene.appState,
        fileAdditions: Object.fromEntries(
          addedFileIds.flatMap((fileId) => {
            const file = files.get(fileId);
            return file ? [[fileId, file] as const] : [];
          }),
        ),
        removedFileIds,
      };
      return { ok: true, value: result, event };
    });
    return apply.immediate();
  } catch (error) {
    return {
      ok: false,
      error: toCanvasSceneCommandError(error, request.mutationId),
    };
  }
};
