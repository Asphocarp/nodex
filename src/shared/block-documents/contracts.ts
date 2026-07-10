export type BlockId = string;
export type DocumentId = string;

export const MAX_CARD_DOCUMENT_UPDATE_BYTES = 2 * 1024 * 1024;
export const MAX_CARD_DOCUMENT_STATE_BYTES = 16 * 1024 * 1024;
export const MAX_CARD_DOCUMENT_BODY_XML_LENGTH = 4_000_000;
export const MAX_CARD_DOCUMENT_BLOCKS = 100_000;
export const MAX_CARD_DOCUMENT_XML_PATH_DEPTH = 512;
export const MAX_DOCUMENT_TOUCHED_BLOCK_IDS = 10_000;
export const MAX_BLOCK_ID_LENGTH = 512;

export type BlockLocation =
  | {
      readonly kind: "space";
      readonly projectId: string;
      readonly rankKey: string;
    }
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
    };

export interface BlockRecord {
  readonly id: BlockId;
  readonly projectId: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location: BlockLocation;
  readonly locationRevision: number;
  readonly metadataRevision: number;
}

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
  readonly rootBlockIds: readonly BlockId[];
  readonly sourceDocumentId: DocumentId;
  readonly expectedSourceHeadSeq: number;
  readonly expectedLocationRevisions: Readonly<Record<BlockId, number>>;
  readonly target:
    | {
        readonly kind: "document";
        readonly documentId: DocumentId;
        readonly parentBlockId?: BlockId;
        readonly beforeBlockId?: BlockId;
      }
    | {
        readonly kind: "space";
        readonly projectId: string;
        readonly beforeBlockId?: BlockId;
      };
}
