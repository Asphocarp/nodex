import type { AuthorizedReadStamp } from "../authorized-read-stamp";
import type {
  ContentAccessContext,
  LibraryContentAccessContext,
  ProjectContentAccessContext,
} from "../content-access-context";

export type BlockId = string;
export type DocumentId = string;
export type DocumentReadiness = "pending_genesis" | "ready" | "failed";

/**
 * Migration-only authority state from the pre-engine-neutral Document model.
 * Runtime surfaces must dispatch through `OwnedDocumentDescriptor.sync` instead.
 */
export type BlockLifecycle = "active" | "archived" | "deleted";

export interface OwnedDocumentIdentity {
  readonly libraryId: string;
  readonly accessContext: ContentAccessContext;
  readonly ownerBlockId: BlockId;
  readonly ownerType: string;
  readonly ownerLifecycle: BlockLifecycle;
  readonly documentId: DocumentId;
  readonly storeEpoch: string;
}

/** Engine-neutral durable coordinates shared by every owned Document. */
export interface OwnedDocumentHead {
  readonly generation: number;
  readonly headSeq: number;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}

export interface YjsDocumentSyncEngine {
  readonly kind: "yjs";
  readonly stateVector: Uint8Array;
}

export interface CanvasSceneDocumentSyncEngine {
  readonly kind: "canvas_scene";
}

export type OwnedDocumentSyncEngine =
  | YjsDocumentSyncEngine
  | CanvasSceneDocumentSyncEngine;

/**
 * Public ownership descriptor. Document identity and durable head semantics do
 * not depend on the content-specific synchronization engine.
 */
export interface OwnedDocumentDescriptor
  extends OwnedDocumentIdentity, OwnedDocumentHead {
  readonly authorization: AuthorizedReadStamp | null;
  readonly readiness: DocumentReadiness;
  readonly sync: OwnedDocumentSyncEngine;
}

export interface ProjectOwnedDocumentDescriptor
  extends OwnedDocumentDescriptor {
  readonly accessContext: ProjectContentAccessContext;
}

export interface LibraryOwnedDocumentDescriptor
  extends OwnedDocumentDescriptor {
  readonly accessContext: LibraryContentAccessContext;
}

export const requireLibraryOwnedDocumentDescriptor = (
  descriptor: OwnedDocumentDescriptor,
): LibraryOwnedDocumentDescriptor => {
  if (descriptor.accessContext.kind === "library") {
    return { ...descriptor, accessContext: descriptor.accessContext };
  }
  throw new TypeError(
    "Owned Document descriptor does not use Library access context",
  );
};

export const requireProjectOwnedDocumentDescriptor = (
  descriptor: OwnedDocumentDescriptor,
  projectId: string,
): ProjectOwnedDocumentDescriptor => {
  if (
    descriptor.accessContext.kind === "project" &&
    descriptor.accessContext.projectId === projectId
  ) {
    return { ...descriptor, accessContext: descriptor.accessContext };
  }
  throw new TypeError(
    "Owned Document descriptor does not match the requested Project access context",
  );
};

export const MAX_PAGE_DOCUMENT_UPDATE_BYTES = 2 * 1024 * 1024;
export const MAX_PAGE_DOCUMENT_STATE_BYTES = 16 * 1024 * 1024;
export const MAX_PAGE_DOCUMENT_BODY_XML_LENGTH = 4_000_000;
export const MAX_PAGE_DOCUMENT_BLOCKS = 100_000;
export const MAX_PAGE_DOCUMENT_XML_PATH_DEPTH = 512;
export const MAX_DOCUMENT_TOUCHED_BLOCK_IDS = 10_000;
export const MAX_BLOCK_ID_LENGTH = 512;
export const MAX_REFERENCE_DISPLAY_HINT_LENGTH = 512;
export const MAX_RELOCATION_ROOT_BLOCKS = 10_000;
export const MAX_RELOCATION_ID_LENGTH = 512;

export type BlockLocation =
  | {
      readonly kind: "library";
      readonly libraryId: string;
      readonly rankKey: string;
    }
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
    }
  | {
      readonly kind: "data_source";
      readonly databaseBlockId: BlockId;
      readonly dataSourceId: string;
    };

export interface BlockRecord {
  readonly id: BlockId;
  readonly projectId: string;
  readonly type: string;
  readonly lifecycle: BlockLifecycle;
  readonly location: BlockLocation;
  readonly locationRevision: number;
  readonly metadataRevision: number;
}

/** @deprecated Yjs-shaped compatibility contract; use `OwnedDocumentHead`. */
export interface DocumentHead {
  readonly documentId: DocumentId;
  readonly ownerBlockId: BlockId;
  readonly generation: number;
  readonly headSeq: number;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly stateVector: Uint8Array;
}

export interface ApplyDocumentUpdate {
  readonly documentId: DocumentId;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly updateId: string;
  readonly clientSessionId: string;
  readonly baseHeadSeq: number;
  readonly touchedBlockIds: readonly BlockId[];
  readonly update: Uint8Array;
}

export interface DocumentCommitRef {
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly headSeq: number;
  readonly updateId: string;
  /** Null only on an idempotent retry after the exact update payload was compacted. */
  readonly update: Uint8Array | null;
  readonly stateVector: Uint8Array;
}
