import type {
  AutomationApplyInput,
  AutomationCommittedValue,
  AutomationRead,
  AutomationReadSnapshot,
  CoreClientPort,
  CoreEventEnvelope,
  CoreEventReplayRequired,
  CoreEventSubscription,
  DatabaseApplyInput,
  DatabaseCommittedValue,
  DatabaseRead,
  DatabaseReadSnapshot,
  DocumentResyncRequired,
  LibraryApplyInput,
  LibraryCommittedValue,
  LibraryRead,
  LibraryReadSnapshot,
  OwnedDocumentApplyInput,
  OwnedDocumentCommittedValue,
  OwnedDocumentRead,
  OwnedDocumentReadSnapshot,
  ProjectWorkspaceRead,
  ProjectWorkspaceApplyInput,
  ProjectWorkspaceCommittedValue,
  ProjectWorkspaceReadSnapshot,
  StoreAdministrationApplyInput,
  StoreAdministrationCommittedValue,
  StoreAdministrationRead,
  StoreAdministrationReadSnapshot,
} from "../types";
import type {
  DocumentAwarenessPublishAck,
  DocumentAwarenessPublishRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
} from "../../../shared/block-documents/document-sync";

export class FakeCoreClient implements CoreClientPort {
  readonly automationReads: AutomationRead[] = [];
  readonly automationApplies: AutomationApplyInput[] = [];
  readonly reads: LibraryRead[] = [];
  readonly applies: LibraryApplyInput[] = [];
  readonly databaseReads: DatabaseRead[] = [];
  readonly databaseApplies: DatabaseApplyInput[] = [];
  readonly workspaceReads: ProjectWorkspaceRead[] = [];
  readonly workspaceApplies: ProjectWorkspaceApplyInput[] = [];
  readonly administrationReads: StoreAdministrationRead[] = [];
  readonly administrationApplies: StoreAdministrationApplyInput[] = [];
  readonly documentReads: Array<{
    readonly clientSessionId: string;
    readonly read: OwnedDocumentRead;
  }> = [];
  readonly documentApplies: OwnedDocumentApplyInput[] = [];
  readonly documentSyncs: DocumentSyncRequest[] = [];
  readonly documentUpdateApplies: DocumentSyncApplyRequest[] = [];
  readonly awarenessPublishes: DocumentAwarenessPublishRequest[] = [];
  readonly #readResults: LibraryReadSnapshot[] = [];
  readonly #automationReadResults: AutomationReadSnapshot[] = [];
  readonly #automationApplyResults: AutomationCommittedValue[] = [];
  readonly #applyResults: LibraryCommittedValue[] = [];
  readonly #databaseReadResults: DatabaseReadSnapshot[] = [];
  readonly #databaseApplyResults: DatabaseCommittedValue[] = [];
  readonly #workspaceReadResults: ProjectWorkspaceReadSnapshot[] = [];
  readonly #workspaceApplyResults: ProjectWorkspaceCommittedValue[] = [];
  readonly #administrationReadResults: StoreAdministrationReadSnapshot[] = [];
  readonly #administrationApplyResults: StoreAdministrationCommittedValue[] = [];
  readonly #documentReadResults: OwnedDocumentReadSnapshot[] = [];
  readonly #documentApplyResults: OwnedDocumentCommittedValue[] = [];
  readonly #documentSyncResults: DocumentSyncResponse[] = [];
  readonly #documentUpdateApplyResults: DocumentSyncApplyAck[] = [];
  readonly #awarenessResults: DocumentAwarenessPublishAck[] = [];
  readonly #eventConsumers = new Set<(event: CoreEventEnvelope) => void>();

  enqueueRead(result: LibraryReadSnapshot): void {
    this.#readResults.push(result);
  }

  enqueueAutomationRead(result: AutomationReadSnapshot): void {
    this.#automationReadResults.push(result);
  }

  enqueueAutomationApply(result: AutomationCommittedValue): void {
    this.#automationApplyResults.push(result);
  }

  enqueueApply(result: LibraryCommittedValue): void {
    this.#applyResults.push(result);
  }

  enqueueDatabaseRead(result: DatabaseReadSnapshot): void {
    this.#databaseReadResults.push(result);
  }

  enqueueDatabaseApply(result: DatabaseCommittedValue): void {
    this.#databaseApplyResults.push(result);
  }

  enqueueWorkspaceRead(result: ProjectWorkspaceReadSnapshot): void {
    this.#workspaceReadResults.push(result);
  }

  enqueueWorkspaceApply(result: ProjectWorkspaceCommittedValue): void {
    this.#workspaceApplyResults.push(result);
  }

  enqueueAdministrationRead(result: StoreAdministrationReadSnapshot): void {
    this.#administrationReadResults.push(result);
  }

  enqueueAdministrationApply(result: StoreAdministrationCommittedValue): void {
    this.#administrationApplyResults.push(result);
  }

  enqueueDocumentRead(result: OwnedDocumentReadSnapshot): void {
    this.#documentReadResults.push(result);
  }

  enqueueDocumentApply(result: OwnedDocumentCommittedValue): void {
    this.#documentApplyResults.push(result);
  }

  enqueueDocumentSync(result: DocumentSyncResponse): void {
    this.#documentSyncResults.push(result);
  }

  enqueueDocumentUpdateApply(result: DocumentSyncApplyAck): void {
    this.#documentUpdateApplyResults.push(result);
  }

  enqueueAwareness(result: DocumentAwarenessPublishAck): void {
    this.#awarenessResults.push(result);
  }

  async libraryRead(read: LibraryRead): Promise<LibraryReadSnapshot> {
    this.reads.push(read);
    const result = this.#readResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Library read");
    return result;
  }

  async automationRead(read: AutomationRead): Promise<AutomationReadSnapshot> {
    this.automationReads.push(read);
    const result = this.#automationReadResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Automation read");
    return result;
  }

  async automationApply(input: AutomationApplyInput): Promise<AutomationCommittedValue> {
    this.automationApplies.push(input);
    const result = this.#automationApplyResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Automation apply");
    return result;
  }

  async libraryApply(input: LibraryApplyInput): Promise<LibraryCommittedValue> {
    this.applies.push(input);
    const result = this.#applyResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Library apply");
    return result;
  }

  async databaseRead(read: DatabaseRead): Promise<DatabaseReadSnapshot> {
    this.databaseReads.push(read);
    const result = this.#databaseReadResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Database read");
    return result;
  }

  async databaseApply(input: DatabaseApplyInput): Promise<DatabaseCommittedValue> {
    this.databaseApplies.push(input);
    const result = this.#databaseApplyResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Database apply");
    return result;
  }

  async workspaceRead(
    read: ProjectWorkspaceRead,
  ): Promise<ProjectWorkspaceReadSnapshot> {
    this.workspaceReads.push(read);
    const result = this.#workspaceReadResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Project Workspace read");
    return result;
  }

  async workspaceApply(
    input: ProjectWorkspaceApplyInput,
  ): Promise<ProjectWorkspaceCommittedValue> {
    this.workspaceApplies.push(input);
    const result = this.#workspaceApplyResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Project Workspace apply");
    return result;
  }

  async administrationRead(
    read: StoreAdministrationRead,
  ): Promise<StoreAdministrationReadSnapshot> {
    this.administrationReads.push(read);
    const result = this.#administrationReadResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Store Administration read");
    return result;
  }

  async administrationApply(
    input: StoreAdministrationApplyInput,
  ): Promise<StoreAdministrationCommittedValue> {
    this.administrationApplies.push(input);
    const result = this.#administrationApplyResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Store Administration apply");
    return result;
  }

  async documentRead(
    clientSessionId: string,
    read: OwnedDocumentRead,
  ): Promise<OwnedDocumentReadSnapshot> {
    this.documentReads.push({ clientSessionId, read });
    const result = this.#documentReadResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Document read");
    return result;
  }

  async documentApply(
    input: OwnedDocumentApplyInput,
  ): Promise<OwnedDocumentCommittedValue> {
    this.documentApplies.push(input);
    const result = this.#documentApplyResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Document apply");
    return result;
  }

  async documentSync(input: DocumentSyncRequest): Promise<DocumentSyncResponse> {
    this.documentSyncs.push(input);
    const result = this.#documentSyncResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Document sync");
    return result;
  }

  async documentApplyUpdate(
    input: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncApplyAck> {
    this.documentUpdateApplies.push(input);
    const result = this.#documentUpdateApplyResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Document update apply");
    return result;
  }

  async documentPublishAwareness(
    input: DocumentAwarenessPublishRequest,
  ): Promise<DocumentAwarenessPublishAck> {
    this.awarenessPublishes.push(input);
    const result = this.#awarenessResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Awareness result");
    return result;
  }

  openDocumentEventStream(
    _input: {
      readonly documentId: string;
      readonly clientSessionId: string;
      readonly after: number;
    },
    onEvent: (event: CoreEventEnvelope) => void,
    _onResyncRequired: (event: DocumentResyncRequired) => void,
    _onRealtimeEvent: (event: DocumentSyncRealtimeEvent) => void,
  ): Promise<CoreEventSubscription> {
    void _onResyncRequired;
    void _onRealtimeEvent;
    return this.openEventStream(0, onEvent);
  }

  async openEventStream(
    _after: number,
    onEvent: (event: CoreEventEnvelope) => void,
    _onResyncRequired?: (event: CoreEventReplayRequired) => void,
  ): Promise<CoreEventSubscription> {
    void _onResyncRequired;
    this.#eventConsumers.add(onEvent);
    let finish: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return {
      done,
      close: () => {
        this.#eventConsumers.delete(onEvent);
        finish?.();
      },
    };
  }

  emit(event: CoreEventEnvelope): void {
    for (const consumer of this.#eventConsumers) consumer(event);
  }
}
