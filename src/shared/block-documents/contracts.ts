import type { AuthorizedReadStamp } from "../authorized-read-stamp";

export type BlockId = string;
export type DocumentId = string;
export type DocumentReadiness = "pending_genesis" | "ready" | "failed";

/**
 * Migration-only authority state from the pre-engine-neutral Document model.
 * Runtime surfaces must dispatch through `OwnedDocumentDescriptor.sync` instead.
 */
export type BlockLifecycle = "active" | "archived" | "deleted";

export interface OwnedDocumentIdentity {
  readonly projectId: string;
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

export interface LibraryOwnedDocumentDescriptor
  extends Omit<OwnedDocumentDescriptor, "projectId"> {
  readonly accessContext: { readonly kind: "library" };
}

export const toLibraryOwnedDocumentDescriptor = (
  descriptor: OwnedDocumentDescriptor,
): LibraryOwnedDocumentDescriptor => {
  const { projectId: _privateProjectId, ...publicDescriptor } = descriptor;
  void _privateProjectId;
  return {
    ...publicDescriptor,
    accessContext: { kind: "library" },
  };
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
      readonly kind: "space";
      readonly projectId: string;
      readonly rankKey: string;
    }
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
    }
  | {
      readonly kind: "database";
      readonly databaseBlockId: BlockId;
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
