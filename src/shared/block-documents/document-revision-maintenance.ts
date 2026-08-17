export const MAX_DOCUMENT_REVISION_MAINTENANCE_DOCUMENTS = 200;

export interface MaintainDocumentRevisionHistoryInput {
  readonly storeEpoch: string;
  readonly now: string;
  readonly force?: boolean;
  readonly maxDocuments?: number;
}

export interface MaintainDocumentRevisionHistoryResult {
  readonly scannedDocumentCount: number;
  readonly finalizedDocumentCount: number;
  readonly alreadyCoveredDocumentCount: number;
  readonly staleSessionCount: number;
  readonly deferredDocumentCount: number;
  readonly failedDocumentCount: number;
}

