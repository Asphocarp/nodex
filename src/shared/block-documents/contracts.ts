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
  readonly readiness: DocumentReadiness;
  readonly sync: OwnedDocumentSyncEngine;
}

export const MAX_CARD_DOCUMENT_UPDATE_BYTES = 2 * 1024 * 1024;
export const MAX_CARD_DOCUMENT_STATE_BYTES = 16 * 1024 * 1024;
export const MAX_CARD_DOCUMENT_BODY_XML_LENGTH = 4_000_000;
export const MAX_CARD_DOCUMENT_BLOCKS = 100_000;
export const MAX_CARD_DOCUMENT_XML_PATH_DEPTH = 512;
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

export interface RelocateBlocks {
  readonly relocationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly rootBlockIds: readonly BlockId[];
  readonly sourceDocumentId: DocumentId;
  readonly sourceGeneration: number;
  readonly expectedSourceHeadSeq: number;
  readonly expectedLocationRevisions: Readonly<Record<BlockId, number>>;
  readonly target:
    | {
        readonly kind: "document";
        readonly documentId: DocumentId;
        readonly generation: number;
        readonly expectedHeadSeq: number;
        readonly parentBlockId?: BlockId;
        readonly beforeBlockId?: BlockId;
      }
    | {
        readonly kind: "space";
        readonly projectId: string;
        readonly beforeBlockId?: BlockId;
      };
}

/** Stable logical move request captured before editors enter the lease fence. */
export interface RelocationIntent {
  readonly relocationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly rootBlockIds: readonly BlockId[];
  readonly sourceDocumentId: DocumentId;
  readonly sourceGeneration: number;
  readonly target: {
    readonly kind: "document";
    readonly documentId: DocumentId;
    readonly generation: number;
    readonly parentBlockId?: BlockId;
    readonly beforeBlockId?: BlockId;
  };
}

export interface RelocationDocumentCommit {
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly headSeq: number;
  readonly updateId: string;
  /** Null only on an idempotent retry after the exact update payload was compacted. */
  readonly update: Uint8Array | null;
  readonly stateVector: Uint8Array;
}

export interface RelocationResult {
  readonly relocationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly duplicate: boolean;
  readonly rootBlockIds: readonly BlockId[];
  readonly movedBlockIds: readonly BlockId[];
  readonly finalLocations: Readonly<Record<BlockId, BlockLocation>>;
  readonly finalLocationRevisions: Readonly<Record<BlockId, number>>;
  readonly sourceCommit: RelocationDocumentCommit;
  readonly targetCommit?: RelocationDocumentCommit;
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

export type RelocationErrorCode =
  | "invalid_relocation_request"
  | "store_epoch_mismatch"
  | "relocation_id_collision"
  | "relocation_lease_timeout"
  | "source_document_not_found"
  | "target_document_not_found"
  | "document_not_ready"
  | "document_generation_mismatch"
  | "source_head_mismatch"
  | "target_head_changed"
  | "block_not_found"
  | "invalid_relocation_roots"
  | "block_location_mismatch"
  | "block_location_revision_mismatch"
  | "invalid_relocation_target"
  | "relocation_cycle"
  | "block_relocated"
  | "recovery_required"
  | "document_state_corrupt"
  | "unknown";

export interface RelocationCommandError {
  readonly code: RelocationErrorCode;
  readonly message: string;
  /** The exact same relocation request may be attempted again. */
  readonly retryable: boolean;
  /** Current editors must reload one or both Documents before retrying. */
  readonly reloadRequired: boolean;
  readonly relocationId?: string;
  readonly recoveryArtifactId?: string;
}

export type RelocationCommandResult<T = RelocationResult> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RelocationCommandError };
