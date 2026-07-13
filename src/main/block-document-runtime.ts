import type Database from "better-sqlite3";
import * as Y from "yjs";
import {
  MAX_CARD_DOCUMENT_STATE_BYTES,
  type DocumentSyncApplyAck,
  type DocumentSyncApplyRequest,
  type DocumentSyncRequest,
  type DocumentSyncResponse,
} from "../shared/block-documents";
import {
  applyBlockDocumentUpdate,
  BlockDocumentStoreError,
  getBlockDocumentProjectId,
  getBlockDocumentRuntimeIdentity,
  loadBlockDocument,
  type BlockDocumentRuntimeIdentity,
  type LoadedBlockDocument,
} from "./local-store/block-document-store";

const DEFAULT_MAX_DOCUMENTS = 64;
const DEFAULT_MAX_STATE_BYTES = 64 * 1024 * 1024;

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

const requireIdentity = (value: string, field: string): void => {
  if (value.trim().length > 0) {
    return;
  }
  throw new BlockDocumentStoreError(
    "invalid_document_update",
    `${field} must not be empty`,
  );
};

const normalizeLimit = (value: number | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }
  if (Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
};

const headsEqual = (
  left: BlockDocumentRuntimeIdentity["head"],
  right: BlockDocumentRuntimeIdentity["head"],
): boolean =>
  left.documentId === right.documentId
  && left.ownerBlockId === right.ownerBlockId
  && left.generation === right.generation
  && left.headSeq === right.headSeq
  && left.schemaKey === right.schemaKey
  && left.schemaVersion === right.schemaVersion
  && bytesEqual(left.stateVector, right.stateVector);

export interface BlockDocumentRuntimeAuthority {
  readonly readIdentity: (
    documentId: string,
  ) => BlockDocumentRuntimeIdentity;
  readonly load: (documentId: string) => LoadedBlockDocument;
  readonly applyUpdate: (
    input: DocumentSyncApplyRequest,
  ) => DocumentSyncApplyAck;
  readonly getProjectId: (documentId: string) => string;
}

export interface BlockDocumentRuntimeOptions {
  readonly maxDocuments?: number;
  readonly maxStateBytes?: number;
}

export interface BlockDocumentRuntimeCacheStats {
  readonly entryCount: number;
  readonly stateBytes: number;
}

interface CacheEntry {
  readonly document: Y.Doc;
  readonly identity: BlockDocumentRuntimeIdentity;
  readonly stateBytes: number;
}

export const createSqliteBlockDocumentRuntimeAuthority = (
  getDatabase: () => Database.Database,
): BlockDocumentRuntimeAuthority => ({
  readIdentity: (documentId) =>
    getBlockDocumentRuntimeIdentity(getDatabase(), documentId),
  load: (documentId) => loadBlockDocument(getDatabase(), documentId),
  applyUpdate: (input) => applyBlockDocumentUpdate(getDatabase(), input),
  getProjectId: (documentId) =>
    getBlockDocumentProjectId(getDatabase(), documentId),
});

/**
 * Worker-owned Y.Doc cache. The mutable documents never cross this boundary;
 * callers receive copied updates, vectors, ACKs, and scalar scope metadata.
 */
export class BlockDocumentRuntime {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxDocuments: number;
  private readonly maxStateBytes: number;
  private totalStateBytes = 0;

  constructor(
    private readonly authority: BlockDocumentRuntimeAuthority,
    options: BlockDocumentRuntimeOptions = {},
  ) {
    this.maxDocuments = normalizeLimit(
      options.maxDocuments,
      DEFAULT_MAX_DOCUMENTS,
    );
    this.maxStateBytes = normalizeLimit(
      options.maxStateBytes,
      DEFAULT_MAX_STATE_BYTES,
    );
  }

  getProjectId = (documentId: string): string =>
    this.authority.getProjectId(documentId);

  sync = (request: DocumentSyncRequest): DocumentSyncResponse => {
    requireIdentity(request.documentId, "documentId");
    requireIdentity(request.clientSessionId, "clientSessionId");
    if (request.stateVector.byteLength > MAX_CARD_DOCUMENT_STATE_BYTES) {
      throw new BlockDocumentStoreError(
        "invalid_document_update",
        `Client state vector exceeds ${MAX_CARD_DOCUMENT_STATE_BYTES} bytes`,
      );
    }

    let identity: BlockDocumentRuntimeIdentity;
    try {
      identity = this.authority.readIdentity(request.documentId);
    } catch (error) {
      this.evict(request.documentId);
      throw error;
    }
    if (identity.authority !== "ydoc_primary") {
      this.evict(request.documentId);
      throw new BlockDocumentStoreError(
        "document_authority_mismatch",
        `Document ${request.documentId} is not available to collaborative clients before cutover`,
      );
    }

    let entry = this.entries.get(request.documentId);
    let retained = true;
    if (entry && this.entryMatchesIdentity(entry, identity)) {
      this.touch(request.documentId, entry);
    } else {
      this.evict(request.documentId);
      entry = this.loadEntry(identity);
      retained = this.install(entry);
    }

    try {
      let update: Uint8Array;
      try {
        update = Y.encodeStateAsUpdate(entry.document, request.stateVector);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new BlockDocumentStoreError(
          "invalid_document_update",
          `Client state vector is invalid: ${detail}`,
        );
      }
      return {
        documentId: identity.head.documentId,
        storeEpoch: identity.storeEpoch,
        generation: identity.head.generation,
        headSeq: identity.head.headSeq,
        stateVector: identity.head.stateVector.slice(),
        update: update.slice(),
      };
    } finally {
      if (!retained) {
        entry.document.destroy();
      }
    }
  };

  applyUpdate = (
    input: DocumentSyncApplyRequest,
  ): DocumentSyncApplyAck => {
    let ack: DocumentSyncApplyAck;
    try {
      ack = this.authority.applyUpdate(input);
    } catch (error) {
      this.evict(input.documentId);
      throw error;
    }

    this.advanceCacheAfterCommit(input, ack);
    return {
      ...ack,
      stateVector: ack.stateVector.slice(),
    };
  };

  getCacheStats = (): BlockDocumentRuntimeCacheStats => ({
    entryCount: this.entries.size,
    stateBytes: this.totalStateBytes,
  });

  /**
   * Forget a committed Document changed through another worker-owned authority
   * path (for example the legacy Card shadow translator). The next public
   * access revalidates and reloads the SQLite head instead of serving an older
   * in-memory Y.Doc.
   */
  invalidate = (documentId: string): void => {
    this.evict(documentId);
  };

  destroy = (): void => {
    for (const entry of this.entries.values()) {
      entry.document.destroy();
    }
    this.entries.clear();
    this.totalStateBytes = 0;
  };

  private advanceCacheAfterCommit(
    input: DocumentSyncApplyRequest,
    ack: DocumentSyncApplyAck,
  ): void {
    let identity: BlockDocumentRuntimeIdentity;
    try {
      identity = this.authority.readIdentity(input.documentId);
    } catch {
      this.evict(input.documentId);
      return;
    }

    if (!this.ackMatchesIdentity(ack, identity)) {
      this.evict(input.documentId);
      return;
    }

    const entry = this.entries.get(input.documentId);
    if (ack.duplicate) {
      if (entry && this.entryMatchesIdentity(entry, identity)) {
        this.touch(input.documentId, entry);
        return;
      }
      this.evict(input.documentId);
      this.warm(identity);
      return;
    }

    if (
      entry
      && entry.identity.storeEpoch === input.storeEpoch
      && entry.identity.head.generation === input.generation
      && entry.identity.head.headSeq === ack.committedSeq - 1
    ) {
      try {
        Y.applyUpdate(entry.document, input.update, "sqlite-committed-update");
        if (
          entry.document.store.pendingStructs !== null
          || entry.document.store.pendingDs !== null
        ) {
          throw new Error("Committed update left unresolved Yjs dependencies");
        }
        const advanced = this.createEntry(entry.document, identity);
        const retained = this.install(advanced);
        if (!retained) {
          advanced.document.destroy();
        }
        return;
      } catch {
        this.evict(input.documentId);
      }
    } else {
      this.evict(input.documentId);
    }

    this.warm(identity);
  }

  private ackMatchesIdentity(
    ack: DocumentSyncApplyAck,
    identity: BlockDocumentRuntimeIdentity,
  ): boolean {
    return ack.documentId === identity.head.documentId
      && ack.storeEpoch === identity.storeEpoch
      && ack.generation === identity.head.generation
      && ack.headSeq === identity.head.headSeq
      && bytesEqual(ack.stateVector, identity.head.stateVector);
  }

  private entryMatchesIdentity(
    entry: CacheEntry,
    identity: BlockDocumentRuntimeIdentity,
  ): boolean {
    return entry.identity.storeEpoch === identity.storeEpoch
      && entry.identity.authority === identity.authority
      && headsEqual(entry.identity.head, identity.head);
  }

  private loadEntry(identity: BlockDocumentRuntimeIdentity): CacheEntry {
    let loaded: LoadedBlockDocument | null = null;
    try {
      loaded = this.authority.load(identity.head.documentId);
      if (
        loaded.storeEpoch !== identity.storeEpoch
        || loaded.authority !== identity.authority
        || !headsEqual(loaded.head, identity.head)
      ) {
        throw new BlockDocumentStoreError(
          "document_state_corrupt",
          `Document ${identity.head.documentId} changed while loading its runtime state`,
        );
      }
      return this.createEntry(loaded.document, identity);
    } catch (error) {
      loaded?.document.destroy();
      throw error;
    }
  }

  private createEntry(
    document: Y.Doc,
    identity: BlockDocumentRuntimeIdentity,
  ): CacheEntry {
    const state = Y.encodeStateAsUpdate(document);
    const stateVector = Y.encodeStateVector(document);
    if (!bytesEqual(stateVector, identity.head.stateVector)) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Document ${identity.head.documentId} runtime state does not match SQLite head`,
      );
    }
    return {
      document,
      identity: {
        ...identity,
        head: {
          ...identity.head,
          stateVector: identity.head.stateVector.slice(),
        },
      },
      stateBytes: state.byteLength,
    };
  }

  private warm(identity: BlockDocumentRuntimeIdentity): void {
    try {
      const entry = this.loadEntry(identity);
      const retained = this.install(entry);
      if (!retained) {
        entry.document.destroy();
      }
    } catch {
      this.evict(identity.head.documentId);
    }
  }

  private install(entry: CacheEntry): boolean {
    const documentId = entry.identity.head.documentId;
    const existing = this.entries.get(documentId);
    if (existing) {
      this.entries.delete(documentId);
      this.totalStateBytes -= existing.stateBytes;
      if (existing.document !== entry.document) {
        existing.document.destroy();
      }
    }

    if (
      this.maxDocuments === 0
      || this.maxStateBytes === 0
      || entry.stateBytes > this.maxStateBytes
    ) {
      return false;
    }

    while (
      this.entries.size >= this.maxDocuments
      || this.totalStateBytes + entry.stateBytes > this.maxStateBytes
    ) {
      const oldestDocumentId = this.entries.keys().next().value as
        | string
        | undefined;
      if (!oldestDocumentId) {
        break;
      }
      this.evict(oldestDocumentId);
    }

    this.entries.set(documentId, entry);
    this.totalStateBytes += entry.stateBytes;
    return true;
  }

  private touch(documentId: string, entry: CacheEntry): void {
    this.entries.delete(documentId);
    this.entries.set(documentId, entry);
  }

  private evict(documentId: string): void {
    const entry = this.entries.get(documentId);
    if (!entry) {
      return;
    }
    this.entries.delete(documentId);
    this.totalStateBytes -= entry.stateBytes;
    entry.document.destroy();
  }
}
