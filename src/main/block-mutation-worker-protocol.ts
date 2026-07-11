import type { BoardChangeEvent } from "../shared/ipc-api";
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
  DatabaseCatalogSnapshotCommandResult,
  DatabaseManagementSnapshotCommandResult,
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
  CardProjectTransferCommandResult,
  CardProjectTransferIntent,
  CardProjectTransferPreparation,
  CardProjectTransferRequest,
} from "../shared/card-project-transfer";
import type {
  CompactEligibleBlockDocumentsInput,
  CompactEligibleBlockDocumentsResult,
} from "./local-store/block-document-compaction";
import type { RepairDocumentSecondaryProjectionsResult } from "./local-store/block-document-projections";
import type {
  CardOccurrenceActionInput,
  CardOccurrenceUpdateInput,
} from "../shared/types";

export interface CardMutationMetrics {
  mutationId: string;
  queueWaitMs: number;
  workerDurationMs: number;
  transactionMs: number;
  summaryBytes?: number;
  eventCount: number;
  mainEventLoopLagMaxMs?: number;
}

export type CardOccurrenceMutationResult = { success: boolean; error?: string };
interface CardMutationWorkerRequestBase {
  id: number;
  mutationId: string;
  queuedAtEpochMs: number;
}

export type CardMutationWorkerRequest =
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
      type: "readDatabaseCatalog";
      payload: { readonly projectId: string };
    })
  | (CardMutationWorkerRequestBase & {
      type: "readDatabaseManagement";
      payload: { readonly projectId: string };
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
      type: "prepareCardProjectTransfer";
      payload: CardProjectTransferIntent;
    })
  | (CardMutationWorkerRequestBase & {
      type: "applyCardProjectTransfer";
      payload: CardProjectTransferRequest;
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
  | RelocationCommandResult<RelocationResult | null>
  | CardProjectTransferCommandResult
  | CardProjectTransferCommandResult<CardProjectTransferPreparation>;

export type CardMutationWorkerResult =
  | CardOccurrenceMutationResult
  | BlockDocumentWorkerResult
  | OwnedBlockDocumentDescriptor
  | RepairDocumentSecondaryProjectionsResult
  | BlockPropertyMutationCommandResult
  | DatabaseMutationCommandResult
  | CardLifecycleMutationCommandResult
  | CardLifecyclePreflightResult
  | CompactEligibleBlockDocumentsResult
  | DatabaseCatalogSnapshotCommandResult
  | DatabaseManagementSnapshotCommandResult
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
