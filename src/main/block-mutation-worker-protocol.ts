import type { BoardChangeEvent } from "../shared/ipc-api";
import type { ProjectResourceGrant } from "../shared/library";
import type { PersistNodexAgentProjectResourceGrantsInput } from "../shared/nodex-agent-resource-access";
import type { PageTargetChangedEvent } from "../shared/page-target-events";
import type {
  DocumentAccessAck,
  DocumentAccessRequest,
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
  MaintainDocumentRevisionHistoryInput,
  MaintainDocumentRevisionHistoryResult,
} from "../shared/block-documents/document-revision-maintenance";
import type {
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
} from "../shared/block-property-mutations-v2";
import type {
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
} from "../shared/database-module-v2";
import type { PageDetailResult } from "../shared/page-detail";
import type {
  PageLifecycleMutationCommandResultV2,
  PageLifecycleMutationRequestV2,
} from "../shared/page-lifecycle-v2";
import type { PageLifecyclePreflightResultV2 } from "../shared/page-lifecycle-v2-runtime";
import type { ListPageHistoryRequest } from "../shared/page-history";
import type { PageHistoryCommandResult } from "../shared/page-history-transport";
import type {
  AdditionalDocumentCommandRequest,
  AdditionalDocumentCommandResult,
} from "../shared/additional-document-commands";
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
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
} from "../shared/types";
import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
  BlockTransferPreparation,
  BlockTransferReceipt,
  BlockTransferRequest,
} from "../shared/block-transfer";
import type {
  CompleteNodexAgentPageUpdateRequest,
  CompleteNodexAgentPageUpdateResult,
  ExecuteNodexAgentCreatePagesResult,
  ExecuteNodexAgentDuplicatePageResult,
  ExecuteNodexAgentMovePagesResult,
  NodexAgentCreatePagesCommand,
  NodexAgentDuplicatePageCommand,
  NodexAgentMovePagesCommand,
  NodexAgentV3ReadCommandResult,
  NodexAgentV3ReadRequest,
  PrepareNodexAgentPageUpdateRequest,
  PrepareNodexAgentPageUpdateResult,
  PrepareNodexAgentCreatePagesRequest,
  PrepareNodexAgentCreatePagesResult,
  PrepareNodexAgentDuplicatePageRequest,
  PrepareNodexAgentDuplicatePageResult,
  PrepareNodexAgentMovePagesRequest,
  PrepareNodexAgentMovePagesResult,
} from "../shared/nodex-agent-tools";

export interface BlockMutationMetrics {
  mutationId: string;
  queueWaitMs: number;
  workerDurationMs: number;
  transactionMs: number;
  summaryBytes?: number;
  eventCount: number;
  mainEventLoopLagMaxMs?: number;
}

export type PageOccurrenceMutationResult = { success: boolean; error?: string };
interface BlockMutationWorkerRequestBase {
  id: number;
  mutationId: string;
  queuedAtEpochMs: number;
}

export type BlockMutationWorkerRequest =
  | (BlockMutationWorkerRequestBase & {
      type: "readNodexAgentV3Tool";
      payload: NodexAgentV3ReadRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "persistNodexAgentProjectResourceGrants";
      payload: PersistNodexAgentProjectResourceGrantsInput;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "prepareNodexAgentPageUpdate";
      payload: PrepareNodexAgentPageUpdateRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "completeNodexAgentPageUpdate";
      payload: CompleteNodexAgentPageUpdateRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "prepareNodexAgentCreatePages";
      payload: PrepareNodexAgentCreatePagesRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "executeNodexAgentCreatePages";
      payload: NodexAgentCreatePagesCommand;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "prepareNodexAgentDuplicatePage";
      payload: PrepareNodexAgentDuplicatePageRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "executeNodexAgentDuplicatePage";
      payload: NodexAgentDuplicatePageCommand;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "prepareNodexAgentMovePages";
      payload: PrepareNodexAgentMovePagesRequest;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "executeNodexAgentMovePages";
      payload: NodexAgentMovePagesCommand;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "completePageOccurrence";
      payload: {
        projectId: string;
        input: PageOccurrenceCompleteInput;
        sessionId?: string;
      };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "skipPageOccurrence";
      payload: {
        projectId: string;
        input: PageOccurrenceActionInput;
        sessionId?: string;
      };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "updatePageOccurrence";
      payload: {
        projectId: string;
        input: PageOccurrenceUpdateInput;
        sessionId?: string;
      };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "repairDocumentSecondaryProjections";
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyBlockPropertyMutation";
      payload: BlockPropertyMutationRequestV2;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "applyDatabaseModule";
      payload: DatabaseApplyV2;
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
      type: "applyPageLifecycleMutation";
      payload: PageLifecycleMutationRequestV2;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readPageLifecyclePreflight";
      payload: { readonly projectId: string; readonly pageId: string };
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
      type: "maintainDocumentRevisionHistory";
      payload: MaintainDocumentRevisionHistoryInput;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "deleteProject";
      payload: { readonly projectId: string };
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readDatabaseModule";
      payload: DatabaseModuleReadRequestV2;
    })
  | (BlockMutationWorkerRequestBase & {
      type: "readPageDetail";
      payload: { readonly projectId: string; readonly pageId: string };
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
      type: "authorizeDocumentAccess";
      payload: DocumentAccessRequest;
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
        readonly executionAuthority?: import("./nodex-agent-execution-authority").NodexAgentMutationExecutionAuthority;
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
      type: "listPageHistory";
      payload: ListPageHistoryRequest;
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
      type: "writerBarrier";
    })
  | (BlockMutationWorkerRequestBase & {
      type: "shutdown";
    });

export type BlockDocumentWorkerResult =
  | DocumentSyncCommandResult<DocumentAccessAck>
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
  | PageHistoryCommandResult
  | RelocationCommandResult
  | RelocationCommandResult<RelocateBlocks>
  | RelocationCommandResult<RelocationResult | null>;

export type BlockMutationWorkerResult =
  | PageOccurrenceMutationResult
  | readonly ProjectResourceGrant[]
  | NodexAgentV3ReadCommandResult
  | PrepareNodexAgentPageUpdateResult
  | CompleteNodexAgentPageUpdateResult
  | PrepareNodexAgentCreatePagesResult
  | ExecuteNodexAgentCreatePagesResult
  | PrepareNodexAgentDuplicatePageResult
  | ExecuteNodexAgentDuplicatePageResult
  | PrepareNodexAgentMovePagesResult
  | ExecuteNodexAgentMovePagesResult
  | BlockDocumentWorkerResult
  | OwnedDocumentDescriptor
  | RepairDocumentSecondaryProjectionsResult
  | BlockPropertyMutationCommandResultV2
  | DatabaseApplyResultV2
  | DatabaseModuleReadResultV2
  | PageDetailResult
  | BlockTransferCommandResult
  | PageLifecycleMutationCommandResultV2
  | PageLifecyclePreflightResultV2
  | CompactEligibleBlockDocumentsResult
  | MaintainStoreBlockRetentionResult
  | MaintainDocumentRevisionHistoryResult
  | ProjectDeletionResult
  | DocumentOperationCommandResult
  | AdditionalDocumentCommandResult
  | undefined;

export type BlockMutationWorkerResponse =
  | {
      id: number;
      ok: true;
      result: BlockMutationWorkerResult;
      events: BoardChangeEvent[];
      targetEvents?: PageTargetChangedEvent[];
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
