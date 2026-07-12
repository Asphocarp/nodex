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
  OwnedDocumentDescriptor,
  RelocateBlocks,
  RelocationCommandResult,
  RelocationIntent,
  RelocationResult,
} from "../shared/block-documents";
import type {
  CanvasSceneMutationCommandResult,
  CanvasSceneMutationRequest,
  CanvasSceneSyncRequest,
  CanvasSceneSyncCommandResult,
} from "../shared/block-documents/canvas-scene-sync";
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
import type {
  MaintainStoreBlockRetentionInput,
  MaintainStoreBlockRetentionResult,
} from "./local-store/block-retention-maintenance-store";
import type { ProjectDeletionResult } from "./local-store/project-deletion";
import type { RepairDocumentSecondaryProjectionsResult } from "./local-store/block-document-projections";
import type {
  CardOccurrenceActionInput,
  CardOccurrenceCompleteInput,
  CardOccurrenceUpdateInput,
} from "../shared/types";
import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
  BlockTransferPreparation,
  BlockTransferReceipt,
  BlockTransferRequest,
} from "../shared/block-transfer";

export interface BlockMutationMetrics {
  mutationId: string;
  queueWaitMs: number;
  workerDurationMs: number;
  transactionMs: number;
  summaryBytes?: number;
  eventCount: number;
  mainEventLoopLagMaxMs?: number;
}

export type CardOccurrenceMutationResult = { success: boolean; error?: string };
interface BlockMutationWorkerRequestBase {
  id: number;
  mutationId: string;
  queuedAtEpochMs: number;
}

export type BlockMutationWorkerRequest =
  | (BlockMutationWorkerRequestBase & {
      type: "completeCardOccurrence";
      payload: {
        projectId: string;
        input: CardOccurrenceCompleteInput;
        sessionId?: string;
      };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "skipCardOccurrence";
      payload: {
        projectId: string;
        input: CardOccurrenceActionInput;
        sessionId?: string;
      };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "updateCardOccurrence";
      payload: {
        projectId: string;
        input: CardOccurrenceUpdateInput;
        sessionId?: string;
      };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "repairDocumentSecondaryProjections";
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyBlockPropertyMutation";
      payload: BlockPropertyMutationRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyDatabaseMutation";
      payload: DatabaseMutationRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyBlockTransfer";
      payload: BlockTransferRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "prepareBlockTransfer";
      payload: BlockTransferIntent;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readCommittedBlockTransfer";
      payload: BlockTransferIntent;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyCardLifecycleMutation";
      payload: CardLifecycleMutationRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readCardLifecyclePreflight";
      payload: { readonly projectId: string; readonly cardId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "compactEligibleBlockDocuments";
      payload: CompactEligibleBlockDocumentsInput;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "maintainStoreBlockRetention";
      payload: MaintainStoreBlockRetentionInput;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "deleteProject";
      payload: { readonly projectId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readDatabaseCatalog";
      payload: { readonly projectId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readDatabaseManagement";
      payload: { readonly projectId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readDatabaseDescriptor";
      payload: { readonly projectId: string; readonly databaseBlockId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readPrimaryDatabaseDescriptor";
      payload: { readonly projectId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readPrimaryDatabaseViewSnapshot";
      payload: { readonly projectId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readDatabaseViewSnapshot";
      payload: { readonly projectId: string; readonly viewId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "queryDatabaseView";
      payload: { readonly projectId: string; readonly viewId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "syncBlockDocument";
      payload: DocumentSyncRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "syncCanvasScene";
      payload: CanvasSceneSyncRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "getBlockDocumentProjectId";
      payload: { readonly documentId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "getOwnedDocumentDescriptor";
      payload: {
        readonly projectId: string;
        readonly ownerBlockId: string;
      };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "prepareOwnedBlockDocument";
      payload: {
        readonly projectId: string;
        readonly ownerBlockId: string;
      };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyBlockDocumentUpdate";
      payload: DocumentSyncApplyRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyCanvasSceneMutation";
      payload: CanvasSceneMutationRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyDocumentMutation";
      payload: {
        readonly request: DocumentMutationRequest;
        readonly writeFence?: DocumentWriteFenceProof;
      };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyAdditionalDocumentCommand";
      payload: AdditionalDocumentCommandRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "createDocumentVersionCheckpoint";
      payload: CreateDocumentVersionCheckpoint;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "listDocumentVersions";
      payload: ListDocumentVersions;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "getDocumentVersion";
      payload: GetDocumentVersion;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "listCardHistory";
      payload: ListCardHistoryRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "relocateBlocks";
      payload: RelocateBlocks;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "prepareRelocationCommand";
      payload: RelocationIntent;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readCommittedRelocation";
      payload: RelocationIntent;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "prepareCardProjectTransfer";
      payload: CardProjectTransferIntent;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyCardProjectTransfer";
      payload: CardProjectTransferRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "writerBarrier";
    })
  | (BlockMutationWorkerRequestBase & {
      type: "shutdown";
    });

export type BlockDocumentWorkerResult =
  | DocumentSyncCommandResult<DocumentSyncResponse>
  | DocumentSyncCommandResult<DocumentSyncApplyAck>
  | CanvasSceneSyncCommandResult
  | CanvasSceneMutationCommandResult
  | DocumentSyncCommandResult<OwnedDocumentDescriptor>
  | DocumentSyncCommandResult<string>
  | DocumentOperationCommandResult
  | DocumentHistoryCommandResult<CreatedDocumentVersionSummary>
  | BlockTransferCommandResult<BlockTransferPreparation>
  | BlockTransferCommandResult<BlockTransferReceipt | null>
  | DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>
  | DocumentHistoryCommandResult<DocumentVersionDetail>
  | CardHistoryCommandResult
  | RelocationCommandResult
  | RelocationCommandResult<RelocateBlocks>
  | RelocationCommandResult<RelocationResult | null>
  | CardProjectTransferCommandResult
  | CardProjectTransferCommandResult<CardProjectTransferPreparation>;

export type BlockMutationWorkerResult =
  | CardOccurrenceMutationResult
  | BlockDocumentWorkerResult
  | OwnedDocumentDescriptor
  | RepairDocumentSecondaryProjectionsResult
  | BlockPropertyMutationCommandResult
  | DatabaseMutationCommandResult
  | BlockTransferCommandResult
  | CardLifecycleMutationCommandResult
  | CardLifecyclePreflightResult
  | CompactEligibleBlockDocumentsResult
  | MaintainStoreBlockRetentionResult
  | ProjectDeletionResult
  | DatabaseCatalogSnapshotCommandResult
  | DatabaseManagementSnapshotCommandResult
  | DatabaseReadCommandResult<GeneralDatabaseDescriptor>
  | DatabaseReadCommandResult<GeneralDatabaseViewQuery>
  | PrimaryDatabaseViewSnapshotCommandResult
  | DatabaseViewSnapshotCommandResult
  | DocumentOperationCommandResult
  | AdditionalDocumentCommandResult
  | undefined;

export type BlockMutationWorkerResponse =
  | {
      id: number;
      ok: true;
      result: BlockMutationWorkerResult;
      events: BoardChangeEvent[];
      metrics: BlockMutationMetrics;
    }
  | {
      id: number;
      ok: false;
      error: string;
      metrics?: Partial<BlockMutationMetrics>;
    };

export type BlockMutationWorkerEvent = {
  type: "log";
  payload: {
    level: "debug" | "info" | "warn" | "error";
    message: string;
    data?: Record<string, unknown>;
  };
};

export type BlockMutationWorkerMessage =
  BlockMutationWorkerResponse | BlockMutationWorkerEvent;
