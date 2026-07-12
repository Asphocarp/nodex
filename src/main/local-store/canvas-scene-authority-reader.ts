import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  CANVAS_SCENE_SCHEMA_VERSION,
  canonicalPortableCanvasSceneFingerprint,
  canonicalStringifyCanvasScene,
  canonicalizeCanvasSceneElement,
  canonicalizeCanvasSceneFile,
  materializePortableCanvasScene,
  type CanvasSceneElement,
  type CanvasSceneFile,
  type PortableCanvasScene,
} from "../../shared/block-documents";

export interface CanvasSceneAuthorityCoordinate {
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly schemaVersion: number;
}

export interface CanvasSceneAuthoritySnapshot {
  readonly scene: PortableCanvasScene;
  readonly sceneHash: string;
  readonly updatedAt: string;
  readonly elementsById: ReadonlyMap<
    string,
    { readonly element: CanvasSceneElement; readonly orderKey: string }
  >;
  readonly filesById: ReadonlyMap<string, CanvasSceneFile>;
}

export class CanvasSceneAuthorityReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CanvasSceneAuthorityReadError";
  }
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new CanvasSceneAuthorityReadError(`${label} is invalid JSON`, {
      cause: error,
    });
  }
};

/** Read and validate the normalized, authoritative Canvas scene at an exact head. */
export const readCanvasSceneAuthoritySnapshot = (
  database: Database.Database,
  coordinate: CanvasSceneAuthorityCoordinate,
): CanvasSceneAuthoritySnapshot => {
  const sceneRow = database
    .prepare(
      `SELECT generation, head_seq, schema_version, app_state_json,
        scene_hash, updated_at
       FROM canvas_scenes WHERE document_id = ?`,
    )
    .get(coordinate.documentId) as
    | {
        readonly generation: number;
        readonly head_seq: number;
        readonly schema_version: number;
        readonly app_state_json: string;
        readonly scene_hash: string;
        readonly updated_at: string;
      }
    | undefined;
  if (
    !sceneRow ||
    sceneRow.generation !== coordinate.generation ||
    sceneRow.head_seq !== coordinate.headSeq ||
    sceneRow.schema_version !== coordinate.schemaVersion ||
    sceneRow.schema_version !== CANVAS_SCENE_SCHEMA_VERSION
  ) {
    throw new CanvasSceneAuthorityReadError(
      `Canvas scene ${coordinate.documentId} does not match its Document head`,
    );
  }

  const elements = database
    .prepare(
      `SELECT element_id, version, version_nonce, order_key, is_deleted,
        element_json, element_hash
       FROM canvas_scene_elements
       WHERE document_id = ? ORDER BY order_key, element_id`,
    )
    .all(coordinate.documentId) as readonly {
    readonly element_id: string;
    readonly version: number;
    readonly version_nonce: number;
    readonly order_key: string;
    readonly is_deleted: number;
    readonly element_json: string;
    readonly element_hash: string;
  }[];
  const elementsById = new Map<
    string,
    { readonly element: CanvasSceneElement; readonly orderKey: string }
  >();
  const parsedElements = elements.map((row) => {
    const element = canonicalizeCanvasSceneElement(
      parseJson(row.element_json, `Canvas element ${row.element_id}`),
      { expectedId: row.element_id },
    );
    if (
      sha256(canonicalStringifyCanvasScene(element)) !== row.element_hash ||
      element.version !== row.version ||
      element.versionNonce !== row.version_nonce ||
      (element.isDeleted === true ? 1 : 0) !== row.is_deleted ||
      (typeof element.index === "string" && element.index !== row.order_key)
    ) {
      throw new CanvasSceneAuthorityReadError(
        `Canvas element evidence diverges: ${row.element_id}`,
      );
    }
    elementsById.set(row.element_id, { element, orderKey: row.order_key });
    return element;
  });

  const files = database
    .prepare(
      `SELECT file_id, mime_type, asset_uri, created_ms, file_json, file_hash
       FROM canvas_scene_files WHERE document_id = ? ORDER BY file_id`,
    )
    .all(coordinate.documentId) as readonly {
    readonly file_id: string;
    readonly mime_type: string;
    readonly asset_uri: string;
    readonly created_ms: number | null;
    readonly file_json: string;
    readonly file_hash: string;
  }[];
  const filesById = new Map<string, CanvasSceneFile>();
  const parsedFiles = Object.fromEntries(
    files.map((row) => {
      const file = canonicalizeCanvasSceneFile(
        parseJson(row.file_json, `Canvas file ${row.file_id}`),
        row.file_id,
      );
      if (
        sha256(canonicalStringifyCanvasScene(file)) !== row.file_hash ||
        file.mimeType !== row.mime_type ||
        file.source !== row.asset_uri ||
        (file.created ?? null) !== row.created_ms
      ) {
        throw new CanvasSceneAuthorityReadError(
          `Canvas file evidence diverges: ${row.file_id}`,
        );
      }
      filesById.set(row.file_id, file);
      return [row.file_id, file] as const;
    }),
  );
  const appState = parseJson(sceneRow.app_state_json, "Canvas appState");
  if (typeof appState !== "object" || appState === null || Array.isArray(appState)) {
    throw new CanvasSceneAuthorityReadError("Canvas appState must be an object");
  }
  const scene = materializePortableCanvasScene({
    elements: parsedElements,
    appState: appState as Readonly<Record<string, unknown>>,
    files: parsedFiles,
  });
  if (
    sha256(canonicalPortableCanvasSceneFingerprint(scene)) !== sceneRow.scene_hash
  ) {
    throw new CanvasSceneAuthorityReadError(
      `Canvas scene hash diverges: ${coordinate.documentId}`,
    );
  }
  return {
    scene,
    sceneHash: sceneRow.scene_hash,
    updatedAt: sceneRow.updated_at,
    elementsById,
    filesById,
  };
};
