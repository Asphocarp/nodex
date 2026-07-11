import type {
  BoardChangeEvent,
  HistoryCardVersionPreview,
  UndoRedoResult,
} from "../shared/ipc-api";
import type {
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandResult,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentMutationRequest,
  DocumentOperationCommandResult,
  DocumentWriteFenceProof,
  OwnedBlockDocumentDescriptor,
  RelocateBlocks,
  RelocationCommandResult,
  RelocationIntent,
  RelocationResult,
} from "../shared/block-documents";
import type {
  CreateDocumentVersionCheckpoint,
  CreatedDocumentVersionSummary,
  DocumentVersionDetail,
  DocumentVersionSummary,
  GetDocumentVersion,
  ListDocumentVersions,
} from "../shared/block-documents/document-history";
import type { DocumentHistoryCommandResult } from "../shared/block-documents/document-history-transport";
import type {
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "../shared/block-property-mutations";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../shared/database-kernel";
import type {
  DatabaseReadCommandResult,
  DatabaseViewSnapshotCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
  PrimaryDatabaseViewSnapshotCommandResult,
} from "../shared/database-query";
import type {
  CardLifecycleMutationCommandResult,
  CardLifecycleMutationRequest,
} from "../shared/card-lifecycle";
import type { CardLifecyclePreflightResult } from "../shared/card-lifecycle-runtime";
import type { ListCardHistoryRequest } from "../shared/card-history";
import type { CardHistoryCommandResult } from "../shared/card-history-transport";
import type {
  AdditionalDocumentCommandRequest,
  AdditionalDocumentCommandResult,
} from "../shared/additional-document-commands";
import type {
  CompactEligibleBlockDocumentsInput,
  CompactEligibleBlockDocumentsResult,
} from "./local-store/block-document-compaction";
import type {
  CutoverCardDocumentInput,
  CutoverEligibleCardDocumentsResult,
} from "./local-store/block-document-cutover";
import type { ForeignReferenceMigrationBatchResult } from "./local-store/foreign-reference-migration";
import type { RepairDocumentSecondaryProjectionsResult } from "./local-store/block-document-projections";
import type {
  BlockDropImportInput,
  BlockDropImportResult,
  Card,
  CardCreateInput,
  CardCreatePlacement,
  CardEditorDropInput,
  CardEditorDropResult,
  CardInput,
  CardOccurrenceActionInput,
  CardOccurrenceUpdateInput,
  CardUpdateResult,
  MoveCardInput,
  MoveCardsInput,
  MoveCardToProjectInput,
  MoveCardToProjectResult,
} from "../shared/types";

export interface CardMutationMetrics {
  mutationId: string;
  queueWaitMs: number;
  workerDurationMs: number;
  transactionMs: number;
  descriptionBytes?: number;
  summaryBytes?: number;
  revisionKind?: "snapshot" | "delta";
  eventCount: number;
  mainEventLoopLagMaxMs?: number;
  shadowJobsProcessed?: number;
  shadowJobsApplied?: number;
  shadowJobsSuperseded?: number;
  shadowJobsFailed?: number;
  shadowDrainErrors?: number;
  shadowDrainExhausted?: boolean;
  foreignReferenceDocumentsProcessed?: number;
  foreignReferencesMigrated?: number;
  foreignReferenceMigrationsFailed?: number;
  foreignReferenceMigrationExhausted?: boolean;
}

export type CardOccurrenceMutationResult = { success: boolean; error?: string };
export type HistoryMutationResult = { success: boolean; error?: string };
export type CardHistoryVersionPreviewResult = {
  preview: HistoryCardVersionPreview | null;
  error?: string;
};
export interface CardReadModelBackfillResult {
  updated: number;
  remaining: number;
}

export interface BlockDocumentShadowInitializationResult {
  readonly processed: number;
  readonly applied: number;
  readonly superseded: number;
  readonly failed: number;
  readonly errors: number;
  readonly exhausted: boolean;
}

interface CardMutationWorkerRequestBase {
  id: number;
  mutationId: string;
  queuedAtEpochMs: number;
}

export type CardMutationWorkerRequest =
  | (CardMutationWorkerRequestBase & {
      type: "createCard";
      payload: {
        projectId: string;
        columnId: Card["status"];
        input: CardCreateInput;
        sessionId?: string;
        placement?: CardCreatePlacement;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "updateCard";
      payload: {
        projectId: string;
        columnId?: Card["status"];
        cardId: string;
        updates: Partial<CardInput>;
        sessionId?: string;
        expectedRevision?: number;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "updateCardDescriptionFromFile";
      payload: {
        projectId: string;
        columnId?: Card["status"];
        cardId: string;
        descriptionFilePath: string;
        sessionId?: string;
        expectedRevision?: number;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "deleteCard";
      payload: {
        projectId: string;
        columnId?: Card["status"];
        cardId: string;
        sessionId?: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "moveCard";
      payload: MoveCardInput & { projectId: string; sessionId?: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "moveCards";
      payload: MoveCardsInput & { projectId: string; sessionId?: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "moveCardToProject";
      payload: MoveCardToProjectInput & { sessionId?: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "importBlockDropAsCards";
      payload: {
        projectId: string;
        input: BlockDropImportInput;
        sessionId?: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "applyCardEditorDrop";
      payload: {
        projectId: string;
        input: CardEditorDropInput;
        sessionId?: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "completeCardOccurrence";
      payload: {
        projectId: string;
        input: CardOccurrenceActionInput;
        sessionId?: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "skipCardOccurrence";
      payload: {
        projectId: string;
        input: CardOccurrenceActionInput;
        sessionId?: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "updateCardOccurrence";
      payload: {
        projectId: string;
        input: CardOccurrenceUpdateInput;
        sessionId?: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "getCardHistoryVersionPreview";
      payload: {
        projectId: string;
        cardId: string;
        historyId: number;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "undoLatest";
      payload: {
        projectId: string;
        sessionId?: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "redoLatest";
      payload: {
        projectId: string;
        sessionId?: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "revertEntry";
      payload: {
        projectId: string;
        historyId: number;
        sessionId?: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "restoreToEntry";
      payload: {
        projectId: string;
        cardId: string;
        historyId: number;
        sessionId?: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "backfillCardReadModel";
      payload: {
        limit?: number;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "initializeBlockDocumentShadows";
    })
  | (CardMutationWorkerRequestBase & {
      type: "migrateLegacyForeignReferences";
      payload: { readonly limit?: number };
    })
  | (CardMutationWorkerRequestBase & {
      type: "repairDocumentSecondaryProjections";
    })
  | (CardMutationWorkerRequestBase & {
      type: "applyBlockPropertyMutation";
      payload: BlockPropertyMutationRequest;
    })
  | (CardMutationWorkerRequestBase & {
      type: "applyDatabaseMutation";
      payload: DatabaseMutationRequest;
    })
  | (CardMutationWorkerRequestBase & {
      type: "applyCardLifecycleMutation";
      payload: CardLifecycleMutationRequest;
    })
  | (CardMutationWorkerRequestBase & {
      type: "readCardLifecyclePreflight";
      payload: { readonly projectId: string; readonly cardId: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "compactEligibleBlockDocuments";
      payload: CompactEligibleBlockDocumentsInput;
    })
  | (CardMutationWorkerRequestBase & {
      type: "readDatabaseDescriptor";
      payload: { readonly projectId: string; readonly databaseBlockId: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "readPrimaryDatabaseDescriptor";
      payload: { readonly projectId: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "readPrimaryDatabaseViewSnapshot";
      payload: { readonly projectId: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "readDatabaseViewSnapshot";
      payload: { readonly projectId: string; readonly viewId: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "queryDatabaseView";
      payload: { readonly projectId: string; readonly viewId: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "syncBlockDocument";
      payload: DocumentSyncRequest;
    })
  | (CardMutationWorkerRequestBase & {
      type: "getBlockDocumentProjectId";
      payload: { readonly documentId: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "getOwnedBlockDocumentDescriptor";
      payload: {
        readonly projectId: string;
        readonly ownerBlockId: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "prepareOwnedBlockDocument";
      payload: {
        readonly projectId: string;
        readonly ownerBlockId: string;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "cutoverCardDocumentToPrimary";
      payload: CutoverCardDocumentInput;
    })
  | (CardMutationWorkerRequestBase & {
      type: "cutoverEligibleCardDocuments";
      payload: { readonly ownerBlockIds?: readonly string[] };
    })
  | (CardMutationWorkerRequestBase & {
      type: "applyBlockDocumentUpdate";
      payload: DocumentSyncApplyRequest;
    })
  | (CardMutationWorkerRequestBase & {
      type: "applyDocumentMutation";
      payload: {
        readonly request: DocumentMutationRequest;
        readonly writeFence?: DocumentWriteFenceProof;
      };
    })
  | (CardMutationWorkerRequestBase & {
      type: "applyAdditionalDocumentCommand";
      payload: AdditionalDocumentCommandRequest;
    })
  | (CardMutationWorkerRequestBase & {
      type: "createDocumentVersionCheckpoint";
      payload: CreateDocumentVersionCheckpoint;
    })
  | (CardMutationWorkerRequestBase & {
      type: "listDocumentVersions";
      payload: ListDocumentVersions;
    })
  | (CardMutationWorkerRequestBase & {
      type: "getDocumentVersion";
      payload: GetDocumentVersion;
    })
  | (CardMutationWorkerRequestBase & {
      type: "listCardHistory";
      payload: ListCardHistoryRequest;
    })
  | (CardMutationWorkerRequestBase & {
    type: "relocateBlocks";
    payload: RelocateBlocks;
  })
  | (CardMutationWorkerRequestBase & {
    type: "prepareRelocationCommand";
    payload: RelocationIntent;
  })
  | (CardMutationWorkerRequestBase & {
    type: "readCommittedRelocation";
    payload: RelocationIntent;
  })
  | (CardMutationWorkerRequestBase & {
      type: "writerBarrier";
    })
  | (CardMutationWorkerRequestBase & {
      type: "shutdown";
    });

export type BlockDocumentWorkerResult =
  | DocumentSyncCommandResult<DocumentSyncResponse>
  | DocumentSyncCommandResult<DocumentSyncApplyAck>
  | DocumentSyncCommandResult<OwnedBlockDocumentDescriptor>
  | DocumentSyncCommandResult<string>
  | DocumentOperationCommandResult
  | DocumentHistoryCommandResult<CreatedDocumentVersionSummary>
  | DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>
  | DocumentHistoryCommandResult<DocumentVersionDetail>
  | CardHistoryCommandResult
  | RelocationCommandResult
  | RelocationCommandResult<RelocateBlocks>
  | RelocationCommandResult<RelocationResult | null>;

export type CardMutationWorkerResult =
  | Card
  | CardUpdateResult
  | boolean
  | "moved"
  | "not_found"
  | "wrong_column"
  | "target_project_not_found"
  | MoveCardToProjectResult
  | BlockDropImportResult
  | CardEditorDropResult
  | CardOccurrenceMutationResult
  | CardReadModelBackfillResult
  | BlockDocumentShadowInitializationResult
  | CardHistoryVersionPreviewResult
  | UndoRedoResult
  | HistoryMutationResult
  | BlockDocumentWorkerResult
  | OwnedBlockDocumentDescriptor
  | CutoverEligibleCardDocumentsResult
  | ForeignReferenceMigrationBatchResult
  | RepairDocumentSecondaryProjectionsResult
  | BlockPropertyMutationCommandResult
  | DatabaseMutationCommandResult
  | CardLifecycleMutationCommandResult
  | CardLifecyclePreflightResult
  | CompactEligibleBlockDocumentsResult
  | DatabaseReadCommandResult<GeneralDatabaseDescriptor>
  | DatabaseReadCommandResult<GeneralDatabaseViewQuery>
  | PrimaryDatabaseViewSnapshotCommandResult
  | DatabaseViewSnapshotCommandResult
  | DocumentOperationCommandResult
  | AdditionalDocumentCommandResult
  | undefined;

export type CardMutationWorkerResponse =
  | {
      id: number;
      ok: true;
      result: CardMutationWorkerResult;
      events: BoardChangeEvent[];
      metrics: CardMutationMetrics;
    }
  | {
      id: number;
      ok: false;
      error: string;
      metrics?: Partial<CardMutationMetrics>;
    };

export type CardMutationWorkerEvent = {
  type: "log";
  payload: {
    level: "debug" | "info" | "warn" | "error";
    message: string;
    data?: Record<string, unknown>;
  };
};

export type CardMutationWorkerMessage =
  CardMutationWorkerResponse | CardMutationWorkerEvent;
