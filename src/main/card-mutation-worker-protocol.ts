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
  OwnedBlockDocumentDescriptor,
} from "../shared/block-documents";
import type { CutoverCardDocumentInput } from "./local-store/block-document-cutover";
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
}

export type CardOccurrenceMutationResult = { success: boolean; error?: string };
export type HistoryMutationResult = { success: boolean; error?: string };
export type CardHistoryVersionPreviewResult = { preview: HistoryCardVersionPreview | null; error?: string };
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
    type: "cutoverCardDocumentToPrimary";
    payload: CutoverCardDocumentInput;
  })
  | (CardMutationWorkerRequestBase & {
    type: "applyBlockDocumentUpdate";
    payload: DocumentSyncApplyRequest;
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
  | DocumentSyncCommandResult<string>;

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

export type CardMutationWorkerMessage = CardMutationWorkerResponse | CardMutationWorkerEvent;
