import type { components } from "@nodex/core-protocol";
import type {
  DocumentAwarenessPublishAck,
  DocumentAwarenessPublishRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
} from "../../shared/block-documents/document-sync";

export type CoreRuntimeDescriptor = components["schemas"]["RuntimeDescriptor"];
export type CoreHandshakeResponse = components["schemas"]["HandshakeResponse"];
export type CoreEventEnvelope = components["schemas"]["EventEnvelope"];
export type CoreModuleError = components["schemas"]["CoreError"];

export type LibraryReadRequest = components["schemas"]["LibraryReadRequest"];
export type LibraryRead = LibraryReadRequest["read"];
export type LibraryReadResponse = components["schemas"]["LibraryReadResponse"];
export type LibraryApplyRequest = components["schemas"]["LibraryApplyRequest"];
export type LibraryIntent = LibraryApplyRequest["intent"];
export type LibraryApplyResponse = components["schemas"]["LibraryApplyResponse"];

type SuccessfulPayload<Response> = Response extends {
  readonly status: "ok";
  readonly payload: infer Payload;
}
  ? Payload
  : never;

export type LibraryReadSnapshot = SuccessfulPayload<LibraryReadResponse>;
export type LibraryCommittedValue = SuccessfulPayload<LibraryApplyResponse>;

export type DatabaseReadRequest = components["schemas"]["DatabaseReadRequest"];
export type DatabaseRead = DatabaseReadRequest["read"];
export type DatabaseReadResponse = components["schemas"]["DatabaseReadResponse"];
export type DatabaseApplyRequest = components["schemas"]["DatabaseApplyRequest"];
export type DatabaseIntent = DatabaseApplyRequest["intent"];
export type DatabaseApplyResponse = components["schemas"]["DatabaseApplyResponse"];
export type DatabaseReadSnapshot = SuccessfulPayload<DatabaseReadResponse>;
export type DatabaseCommittedValue = SuccessfulPayload<DatabaseApplyResponse>;

export type ProjectWorkspaceReadRequest = components["schemas"]["ProjectWorkspaceReadRequest"];
export type ProjectWorkspaceRead = ProjectWorkspaceReadRequest["read"];
export type ProjectWorkspaceReadResponse = components["schemas"]["ProjectWorkspaceReadResponse"];
export type ProjectWorkspaceReadSnapshot = SuccessfulPayload<ProjectWorkspaceReadResponse>;

export type OwnedDocumentReadRequest = components["schemas"]["OwnedDocumentReadRequest"];
export type OwnedDocumentRead = OwnedDocumentReadRequest["read"];
export type OwnedDocumentReadResponse = components["schemas"]["OwnedDocumentReadResponse"];
export type OwnedDocumentApplyRequest = components["schemas"]["OwnedDocumentApplyRequest"];
export type OwnedDocumentIntent = OwnedDocumentApplyRequest["intent"];
export type OwnedDocumentApplyResponse = components["schemas"]["OwnedDocumentApplyResponse"];
export type OwnedDocumentReadSnapshot = SuccessfulPayload<OwnedDocumentReadResponse>;
export type OwnedDocumentCommittedValue = SuccessfulPayload<OwnedDocumentApplyResponse>;

export interface LibraryApplyInput {
  readonly operationId: string;
  readonly intent: LibraryIntent;
}

export interface DatabaseApplyInput {
  readonly operationId: string;
  readonly intent: DatabaseIntent;
}

export interface OwnedDocumentApplyInput {
  readonly operationId: string;
  readonly clientSessionId: string;
  readonly intent: OwnedDocumentIntent;
}

export interface DocumentResyncRequired {
  readonly document_id: string;
  readonly store_epoch: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly event_head: number;
}

export interface CoreEventSubscription {
  readonly done: Promise<void>;
  close(): void;
}

export interface CoreClientPort {
  libraryRead(read: LibraryRead): Promise<LibraryReadSnapshot>;
  libraryApply(input: LibraryApplyInput): Promise<LibraryCommittedValue>;
  databaseRead(read: DatabaseRead): Promise<DatabaseReadSnapshot>;
  databaseApply(input: DatabaseApplyInput): Promise<DatabaseCommittedValue>;
  workspaceRead(read: ProjectWorkspaceRead): Promise<ProjectWorkspaceReadSnapshot>;
  documentRead(
    clientSessionId: string,
    read: OwnedDocumentRead,
  ): Promise<OwnedDocumentReadSnapshot>;
  documentApply(input: OwnedDocumentApplyInput): Promise<OwnedDocumentCommittedValue>;
  documentSync(input: DocumentSyncRequest): Promise<DocumentSyncResponse>;
  documentApplyUpdate(input: DocumentSyncApplyRequest): Promise<DocumentSyncApplyAck>;
  documentPublishAwareness(
    input: DocumentAwarenessPublishRequest,
  ): Promise<DocumentAwarenessPublishAck>;
  openDocumentEventStream(
    input: {
      readonly documentId: string;
      readonly clientSessionId: string;
      readonly after: number;
    },
    onEvent: (event: CoreEventEnvelope) => void,
    onResyncRequired: (event: DocumentResyncRequired) => void,
    onRealtimeEvent: (event: DocumentSyncRealtimeEvent) => void,
  ): Promise<CoreEventSubscription>;
  openEventStream(
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
  ): Promise<CoreEventSubscription>;
}
