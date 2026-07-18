import type {
  CoreClientPort,
  CoreEventEnvelope,
  CoreEventSubscription,
  DocumentResyncRequired,
  LibraryApplyInput,
  LibraryCommittedValue,
  LibraryRead,
  LibraryReadSnapshot,
  OwnedDocumentApplyInput,
  OwnedDocumentCommittedValue,
  OwnedDocumentRead,
  OwnedDocumentReadSnapshot,
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
  readonly reads: LibraryRead[] = [];
  readonly applies: LibraryApplyInput[] = [];
  readonly documentReads: Array<{
    readonly clientSessionId: string;
    readonly read: OwnedDocumentRead;
  }> = [];
  readonly documentApplies: OwnedDocumentApplyInput[] = [];
  readonly documentSyncs: DocumentSyncRequest[] = [];
  readonly documentUpdateApplies: DocumentSyncApplyRequest[] = [];
  readonly awarenessPublishes: DocumentAwarenessPublishRequest[] = [];
  readonly #readResults: LibraryReadSnapshot[] = [];
  readonly #applyResults: LibraryCommittedValue[] = [];
  readonly #documentReadResults: OwnedDocumentReadSnapshot[] = [];
  readonly #documentApplyResults: OwnedDocumentCommittedValue[] = [];
  readonly #documentSyncResults: DocumentSyncResponse[] = [];
  readonly #documentUpdateApplyResults: DocumentSyncApplyAck[] = [];
  readonly #awarenessResults: DocumentAwarenessPublishAck[] = [];
  readonly #eventConsumers = new Set<(event: CoreEventEnvelope) => void>();

  enqueueRead(result: LibraryReadSnapshot): void {
    this.#readResults.push(result);
  }

  enqueueApply(result: LibraryCommittedValue): void {
    this.#applyResults.push(result);
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

  async libraryApply(input: LibraryApplyInput): Promise<LibraryCommittedValue> {
    this.applies.push(input);
    const result = this.#applyResults.shift();
    if (!result) throw new Error("Fake Core client has no queued Library apply");
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
  ): Promise<CoreEventSubscription> {
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
