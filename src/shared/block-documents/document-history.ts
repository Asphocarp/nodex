import type {
  BlockTreeNode,
  BlockTreeValue,
  CardDocumentMaterialization,
} from "./block-document-codec";
import type { BlockId, DocumentId } from "./contracts";
import type { DocumentBlockOperation } from "./document-operations";

export const DOCUMENT_VERSION_CONTRACT_VERSION = 1;
export const MAX_DOCUMENT_VERSION_CAUSE_LENGTH = 128;
export const MAX_DOCUMENT_VERSION_LABEL_LENGTH = 512;
export const MAX_DOCUMENT_VERSION_HISTORY_LIMIT = 200;

export type DocumentVersionActor = Readonly<Record<string, BlockTreeValue>>;

export interface CreateDocumentVersionCheckpoint {
  readonly version: typeof DOCUMENT_VERSION_CONTRACT_VERSION;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly documentId: DocumentId;
  readonly expectedGeneration: number;
  readonly expectedHeadSeq: number;
  readonly cause: string;
  readonly label?: string;
  readonly actor: DocumentVersionActor;
}

export interface DocumentVersionSummary {
  readonly versionId: string;
  readonly documentId: DocumentId;
  readonly projectId: string;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly cause: string;
  readonly label: string | null;
  readonly actor: DocumentVersionActor;
  readonly checkpointHash: string;
  readonly stateVectorHash: string;
  readonly materializationHash: string;
  readonly byteLength: number;
  readonly title: string;
  readonly preview: string;
  readonly blockCount: number;
  readonly createdAt: string;
}

export interface DocumentVersionCheckpoint extends DocumentVersionSummary {
  readonly fullUpdate: Uint8Array;
  readonly stateVector: Uint8Array;
  readonly materialization: CardDocumentMaterialization;
}

export interface CreatedDocumentVersionCheckpoint {
  readonly checkpoint: DocumentVersionCheckpoint;
  readonly duplicate: boolean;
}

export interface CreatedDocumentVersionSummary {
  readonly checkpoint: DocumentVersionSummary;
  readonly duplicate: boolean;
}

export interface DocumentVersionDetail {
  readonly summary: DocumentVersionSummary;
  readonly materialization: CardDocumentMaterialization;
}

export interface DocumentVersionCursor {
  readonly baseHeadSeq: number;
  readonly createdAt: string;
  readonly versionId: string;
}

export interface ListDocumentVersions {
  readonly projectId: string;
  readonly documentId: DocumentId;
  readonly before?: DocumentVersionCursor;
  readonly limit?: number;
}

export interface GetDocumentVersion {
  readonly projectId: string;
  readonly documentId: DocumentId;
  readonly versionId: string;
}

export interface PrepareDocumentVersionRestore {
  readonly version: typeof DOCUMENT_VERSION_CONTRACT_VERSION;
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly documentId: DocumentId;
  readonly versionId: string;
  readonly generation: number;
  readonly expectedHeadSeq: number;
  readonly clientSessionId?: string;
  readonly actor: DocumentVersionActor;
}

export interface DocumentVersionRestorePlan {
  readonly version: typeof DOCUMENT_VERSION_CONTRACT_VERSION;
  readonly kind: "document_version_restore";
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly expectedHeadSeq: number;
  readonly clientSessionId?: string;
  readonly actor: DocumentVersionActor;
  readonly sourceVersion: DocumentVersionSummary;
  readonly targetTitle: string;
  readonly targetBlockTree: readonly BlockTreeNode[];
  readonly operations: readonly DocumentBlockOperation[];
  readonly requiresWriteFence: true;
}

export type PreparedDocumentVersionRestore =
  | {
      readonly kind: "already_current";
      readonly sourceVersion: DocumentVersionSummary;
    }
  | {
      readonly kind: "operation_plan";
      readonly plan: DocumentVersionRestorePlan;
    };

export interface ListBlockChangeHistory {
  readonly projectId: string;
  readonly blockId?: BlockId;
  readonly documentId?: DocumentId;
  readonly beforeChangeSeq?: number;
  readonly limit?: number;
}

export interface BlockChangeHistoryEntry {
  readonly changeSeq: number;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly kind: "block_mutation" | "block_relocation";
  readonly operationId: string | null;
  readonly mutationKind: string | null;
  readonly clientSessionId: string | null;
  readonly actor: DocumentVersionActor;
  readonly blockIds: readonly BlockId[];
  readonly documentIds: readonly DocumentId[];
  readonly databaseBlockIds: readonly BlockId[];
  readonly fieldIntents: readonly BlockTreeValue[];
  readonly payload: Readonly<Record<string, BlockTreeValue>>;
  readonly committedAt: string;
}
