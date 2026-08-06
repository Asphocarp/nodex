import type { components } from "@nodex/core-protocol";
import type { ProjectionImpact } from "../../shared/projection-stream";
import type {
  DocumentAwarenessPublishAck,
  DocumentAwarenessPublishRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
} from "../../shared/block-documents/document-sync";
import type {
  CanvasSceneSyncRequest,
  CanvasSceneSyncResponse,
} from "../../shared/block-documents/canvas-scene-sync";

export type CoreRuntimeDescriptor = components["schemas"]["RuntimeDescriptor"];
export type CoreHandshakeResponse = components["schemas"]["HandshakeResponse"];
export type CoreEventEnvelope = components["schemas"]["EventEnvelope"];
export type CoreEventReplayRequired = components["schemas"]["EventReplayRequired"];
export type CoreModuleError = components["schemas"]["CoreError"];

export type BlockRecordRead = components["schemas"]["BlockRecordRead"];
export type BlockRecordReadAuthorization =
  components["schemas"]["AgentExecutionAuthorization"];
export type BlockRecordReadSnapshot = SuccessfulPayload<
  components["schemas"]["BlockRecordReadResponse"]
>;
export type BlockRecordCommittedValue = SuccessfulPayload<
  components["schemas"]["BlockRecordApplyResponse"]
>;
export type BlockRecordApplyInput = Omit<
  components["schemas"]["BlockRecordApplyRequest"],
  "contract_version" | "store_epoch"
>;

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
export type CoreDatabaseRowSummary =
  components["schemas"]["DatabaseRowSummary"];
export type CoreDatabaseRowDetail =
  components["schemas"]["DatabaseRowDetail"];
export type CoreDatabaseViewWindow =
  components["schemas"]["DatabaseViewWindow"];

export type ProjectWorkspaceReadRequest = components["schemas"]["ProjectWorkspaceReadRequest"];
export type ProjectWorkspaceRead = ProjectWorkspaceReadRequest["read"];
export type ProjectWorkspaceReadResponse = components["schemas"]["ProjectWorkspaceReadResponse"];
export type ProjectWorkspaceReadSnapshot = SuccessfulPayload<ProjectWorkspaceReadResponse>;
export type ProjectWorkspaceApplyRequest = components["schemas"]["ProjectWorkspaceApplyRequest"];
export type ProjectWorkspaceIntent = ProjectWorkspaceApplyRequest["intent"];
export type ProjectWorkspaceApplyResponse = components["schemas"]["ProjectWorkspaceApplyResponse"];
export type ProjectWorkspaceCommittedValue = SuccessfulPayload<ProjectWorkspaceApplyResponse>;

export type AutomationReadRequest = components["schemas"]["AutomationReadRequest"];
export type AutomationRead = AutomationReadRequest["read"];
export type AutomationReadResponse = components["schemas"]["AutomationReadResponse"];
export type AutomationReadSnapshot = SuccessfulPayload<AutomationReadResponse>;
export type AutomationApplyRequest = components["schemas"]["AutomationApplyRequest"];
export type AutomationIntent = AutomationApplyRequest["intent"];
export type AutomationApplyResponse = components["schemas"]["AutomationApplyResponse"];
export type AutomationCommittedValue = SuccessfulPayload<AutomationApplyResponse>;

export type StoreAdministrationReadRequest =
  components["schemas"]["StoreAdministrationReadRequest"];
export type StoreAdministrationRead = StoreAdministrationReadRequest["read"];
export type StoreAdministrationReadResponse =
  components["schemas"]["StoreAdministrationReadResponse"];
export type StoreAdministrationReadSnapshot =
  SuccessfulPayload<StoreAdministrationReadResponse>;
export type StoreAdministrationApplyRequest =
  components["schemas"]["StoreAdministrationApplyRequest"];
export type StoreAdministrationIntent = StoreAdministrationApplyRequest["intent"];
export type StoreAdministrationApplyResponse =
  components["schemas"]["StoreAdministrationApplyResponse"];
export type StoreAdministrationCommittedValue =
  SuccessfulPayload<StoreAdministrationApplyResponse>;

export interface ProjectWorkspaceApplyInput {
  readonly operationId: string;
  readonly intent: ProjectWorkspaceIntent;
}

export interface AutomationApplyInput {
  readonly operationId: string;
  readonly intent: AutomationIntent;
}

export interface StoreAdministrationApplyInput {
  readonly operationId: string;
  readonly intent: StoreAdministrationIntent;
}

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
  blockRecordRead(
    read: BlockRecordRead,
    agentAuthorization?: BlockRecordReadAuthorization,
  ): Promise<BlockRecordReadSnapshot>;
  blockRecordApply(input: BlockRecordApplyInput): Promise<BlockRecordCommittedValue>;
  openLocalCommitStream(
    after: number,
    onCommit: (commit: BlockRecordCommittedValue) => void,
    signal?: AbortSignal,
  ): Promise<CoreEventSubscription>;
  libraryRead(read: LibraryRead): Promise<LibraryReadSnapshot>;
  libraryApply(input: LibraryApplyInput): Promise<LibraryCommittedValue>;
  filterProjectionImpactForProject(
    projectId: string,
    impact: ProjectionImpact,
  ): Promise<ProjectionImpact>;
  databaseRead(read: DatabaseRead): Promise<DatabaseReadSnapshot>;
  databaseApply(input: DatabaseApplyInput): Promise<DatabaseCommittedValue>;
  workspaceRead(read: ProjectWorkspaceRead): Promise<ProjectWorkspaceReadSnapshot>;
  workspaceApply(input: ProjectWorkspaceApplyInput): Promise<ProjectWorkspaceCommittedValue>;
  automationRead(read: AutomationRead): Promise<AutomationReadSnapshot>;
  automationApply(input: AutomationApplyInput): Promise<AutomationCommittedValue>;
  administrationRead(
    read: StoreAdministrationRead,
  ): Promise<StoreAdministrationReadSnapshot>;
  administrationApply(
    input: StoreAdministrationApplyInput,
  ): Promise<StoreAdministrationCommittedValue>;
  documentRead(
    clientSessionId: string,
    read: OwnedDocumentRead,
  ): Promise<OwnedDocumentReadSnapshot>;
  documentApply(input: OwnedDocumentApplyInput): Promise<OwnedDocumentCommittedValue>;
  documentSync(input: DocumentSyncRequest): Promise<DocumentSyncResponse>;
  documentCanvasSync(input: CanvasSceneSyncRequest): Promise<CanvasSceneSyncResponse>;
  documentApplyUpdate(input: DocumentSyncApplyRequest): Promise<DocumentSyncApplyAck>;
  documentPublishAwareness(
    input: DocumentAwarenessPublishRequest,
  ): Promise<DocumentAwarenessPublishAck>;
  openDocumentEventStream(
    input: {
      readonly documentId: string;
      readonly clientSessionId: string;
      readonly after: number;
      readonly signal?: AbortSignal;
    },
    onEvent: (event: CoreEventEnvelope) => void,
    onResyncRequired: (event: DocumentResyncRequired) => void,
    onRealtimeEvent: (event: DocumentSyncRealtimeEvent) => void,
  ): Promise<CoreEventSubscription>;
  openEventStream(
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
    onResyncRequired?: (event: CoreEventReplayRequired) => void,
    signal?: AbortSignal,
  ): Promise<CoreEventSubscription>;
}
