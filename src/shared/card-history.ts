export const CARD_HISTORY_CONTRACT_VERSION = 1;
export const DEFAULT_CARD_HISTORY_PAGE_SIZE = 50;
export const MAX_CARD_HISTORY_PAGE_SIZE = 100;

export type CardHistoryCursor =
  | {
      readonly occurredAt: string;
      readonly source: "document_version";
      readonly versionId: string;
    }
  | {
      readonly occurredAt: string;
      readonly source: "change_log";
      readonly changeSeq: number;
    };

export interface ListCardHistoryRequest {
  readonly version: typeof CARD_HISTORY_CONTRACT_VERSION;
  readonly projectId: string;
  readonly cardBlockId: string;
  readonly before?: CardHistoryCursor;
  readonly pageSize?: number;
}

export type CardHistoryCategory =
  | "checkpoint"
  | "content"
  | "property"
  | "database"
  | "lifecycle"
  | "location"
  | "unknown";

export interface CardHistoryDisplay {
  readonly category: CardHistoryCategory;
  readonly title: string;
  readonly detail: string | null;
  readonly actorLabel: string | null;
}

export type CardHistoryEvidence =
  | { readonly status: "verified" }
  | {
      readonly status: "unavailable";
      readonly reason:
        "missing_ledger" | "malformed_evidence" | "unsupported_evidence";
    };

export type CardHistoryRecovery =
  | {
      readonly kind: "restore_document_version";
      readonly documentId: string;
      readonly versionId: string;
    }
  | {
      readonly kind: "unavailable";
      readonly reason:
        | "document_generation_changed"
        | "insufficient_evidence"
        | "no_inverse_contract";
    };

interface CardHistoryEntryBase {
  readonly id: string;
  readonly projectId: string;
  readonly cardBlockId: string;
  readonly documentId: string;
  readonly occurredAt: string;
  readonly display: CardHistoryDisplay;
  readonly evidence: CardHistoryEvidence;
  readonly recovery: CardHistoryRecovery;
}

export interface CardDocumentVersionHistoryEntry extends CardHistoryEntryBase {
  readonly kind: "document_version";
  readonly versionMetadata: {
    readonly versionId: string;
    readonly generation: number;
    readonly baseHeadSeq: number;
    readonly schemaKey: string;
    readonly schemaVersion: number;
    readonly cause: string;
    readonly label: string | null;
    readonly checkpointHash: string;
    readonly byteLength: number;
  };
}

export interface CardBlockMutationHistoryEntry extends CardHistoryEntryBase {
  readonly kind: "block_mutation";
  readonly changeSeq: number;
  readonly mutationId: string | null;
  readonly mutationKind: string | null;
  readonly affectedBlockCount: number | null;
  readonly fieldIntentCount: number | null;
}

export interface CardBlockRelocationHistoryEntry extends CardHistoryEntryBase {
  readonly kind: "block_relocation";
  readonly changeSeq: number;
  readonly relocationId: string | null;
  readonly direction: "into_card" | "out_of_card" | "within_card" | "unknown";
  readonly movedBlockCount: number | null;
}

export type CardHistoryEntry =
  | CardDocumentVersionHistoryEntry
  | CardBlockMutationHistoryEntry
  | CardBlockRelocationHistoryEntry;

export interface CardHistoryPage {
  readonly version: typeof CARD_HISTORY_CONTRACT_VERSION;
  readonly projectId: string;
  readonly cardBlockId: string;
  readonly documentId: string;
  readonly entries: readonly CardHistoryEntry[];
  readonly nextCursor: CardHistoryCursor | null;
}
