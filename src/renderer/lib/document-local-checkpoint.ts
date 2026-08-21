import * as Y from "yjs";
import {
  PAGE_DOCUMENT_SCHEMA_KEY,
  PAGE_DOCUMENT_SCHEMA_VERSION,
  MAX_PAGE_DOCUMENT_STATE_BYTES,
  getRegisteredBlockDocumentSchemaAdapter,
  type DocumentId,
  type RegisteredBlockDocumentSchemaAdapter,
} from "../../shared/block-documents";

const DATABASE_NAME = "nodex-document-cache";
const DATABASE_VERSION = 1;
const CHECKPOINT_STORE = "document-checkpoints";
const DOCUMENT_ID_INDEX = "document-id";

export interface DocumentCheckpointBoundary {
  readonly documentId: DocumentId;
  readonly storeEpoch: string;
  readonly generation: number;
}

export interface DocumentLocalCheckpoint extends DocumentCheckpointBoundary {
  readonly headSeq: number;
  readonly state: Uint8Array;
  readonly updatedAt: string;
}

export interface DocumentLocalCheckpointStateConstraints {
  readonly maxStateBytes: number;
}

export type DocumentLocalCheckpointSchemaAdapter = Pick<
  RegisteredBlockDocumentSchemaAdapter,
  "inspect" | "limits"
>;

export interface DocumentLocalCheckpointStore {
  read: (
    boundary: DocumentCheckpointBoundary,
    constraints?: DocumentLocalCheckpointStateConstraints,
  ) => Promise<DocumentLocalCheckpoint | null>;
  /** Atomically merges this Yjs delta with the existing boundary checkpoint. */
  write: (
    checkpoint: DocumentLocalCheckpoint,
    constraints?: DocumentLocalCheckpointStateConstraints,
  ) => Promise<void>;
  clearDocument: (documentId: DocumentId) => Promise<void>;
}

interface StoredDocumentLocalCheckpoint {
  readonly key: string;
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly state: ArrayBuffer;
  readonly updatedAt: string;
}

export class DocumentLocalCheckpointError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentLocalCheckpointError";
  }
}

const requireIdentity = (value: string, field: string): string => {
  if (value.length > 0 && value === value.trim()) return value;
  throw new DocumentLocalCheckpointError(`${field} must be non-empty`);
};

const requireGeneration = (value: number): number => {
  if (Number.isSafeInteger(value) && value >= 1) return value;
  throw new DocumentLocalCheckpointError("generation must be a positive integer");
};

const requireHeadSeq = (value: number): number => {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new DocumentLocalCheckpointError("headSeq must be a non-negative integer");
};

const validateBoundary = (boundary: DocumentCheckpointBoundary): DocumentCheckpointBoundary => ({
  documentId: requireIdentity(boundary.documentId, "documentId"),
  storeEpoch: requireIdentity(boundary.storeEpoch, "storeEpoch"),
  generation: requireGeneration(boundary.generation),
});

const checkpointKey = (boundary: DocumentCheckpointBoundary): string =>
  JSON.stringify([boundary.documentId, boundary.storeEpoch, boundary.generation]);

const DEFAULT_STATE_CONSTRAINTS: DocumentLocalCheckpointStateConstraints = {
  maxStateBytes: MAX_PAGE_DOCUMENT_STATE_BYTES,
};

const DEFAULT_CARD_SCHEMA_ADAPTER = getRegisteredBlockDocumentSchemaAdapter({
  ownerType: "page",
  schemaKey: PAGE_DOCUMENT_SCHEMA_KEY,
  schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
});

const EMPTY_DOCUMENT_UPDATE = (() => {
  const document = new Y.Doc();
  try {
    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
})();

const validateStateConstraints = (
  constraints: DocumentLocalCheckpointStateConstraints | undefined,
): DocumentLocalCheckpointStateConstraints => {
  const resolved = constraints ?? DEFAULT_STATE_CONSTRAINTS;
  if (Number.isSafeInteger(resolved.maxStateBytes) && resolved.maxStateBytes > 0) {
    return resolved;
  }
  throw new DocumentLocalCheckpointError("maxStateBytes must be a positive integer");
};

const copyState = (
  state: Uint8Array,
  input?: DocumentLocalCheckpointStateConstraints,
): Uint8Array => {
  const constraints = validateStateConstraints(input);
  if (state.byteLength === 0) {
    throw new DocumentLocalCheckpointError("checkpoint state must not be empty");
  }
  if (state.byteLength > constraints.maxStateBytes) {
    throw new DocumentLocalCheckpointError(
      `checkpoint state exceeds ${constraints.maxStateBytes} bytes`,
    );
  }
  return state.slice();
};

const assertValidDocumentState = (
  document: Y.Doc,
  adapter: DocumentLocalCheckpointSchemaAdapter,
): void => {
  adapter.inspect(document);
};

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

const transactionComplete = (transaction: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction was aborted"));
  });

const openCheckpointDatabase = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(CHECKPOINT_STORE)) return;
      const store = database.createObjectStore(CHECKPOINT_STORE, {
        keyPath: "key",
      });
      store.createIndex(DOCUMENT_ID_INDEX, "documentId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open the document checkpoint cache"));
  });

const toStoredCheckpoint = (
  checkpoint: DocumentLocalCheckpoint,
  constraints?: DocumentLocalCheckpointStateConstraints,
): StoredDocumentLocalCheckpoint => {
  const boundary = validateBoundary(checkpoint);
  const state = copyState(checkpoint.state, constraints);
  const updatedAt = requireIdentity(checkpoint.updatedAt, "updatedAt");
  if (!Number.isFinite(Date.parse(updatedAt))) {
    throw new DocumentLocalCheckpointError("updatedAt must be an ISO timestamp");
  }
  return {
    key: checkpointKey(boundary),
    ...boundary,
    headSeq: requireHeadSeq(checkpoint.headSeq),
    state: state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength) as ArrayBuffer,
    updatedAt,
  };
};

const fromStoredCheckpoint = (
  stored: StoredDocumentLocalCheckpoint,
  expected: DocumentCheckpointBoundary,
  constraints?: DocumentLocalCheckpointStateConstraints,
): DocumentLocalCheckpoint => {
  const checkpoint: DocumentLocalCheckpoint = {
    documentId: stored.documentId,
    storeEpoch: stored.storeEpoch,
    generation: stored.generation,
    headSeq: stored.headSeq,
    state: new Uint8Array(stored.state.slice(0)),
    updatedAt: stored.updatedAt,
  };
  const actual = validateBoundary(checkpoint);
  if (checkpointKey(actual) !== checkpointKey(expected)) {
    throw new DocumentLocalCheckpointError(
      "IndexedDB returned a checkpoint from another Document boundary",
    );
  }
  return {
    ...checkpoint,
    headSeq: requireHeadSeq(checkpoint.headSeq),
    state: copyState(checkpoint.state, constraints),
  };
};

export class IndexedDbDocumentLocalCheckpointStore implements DocumentLocalCheckpointStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  read = async (
    input: DocumentCheckpointBoundary,
    constraints?: DocumentLocalCheckpointStateConstraints,
  ): Promise<DocumentLocalCheckpoint | null> => {
    const boundary = validateBoundary(input);
    const database = await this.getDatabase();
    const transaction = database.transaction(CHECKPOINT_STORE, "readonly");
    const stored = (await requestResult(
      transaction.objectStore(CHECKPOINT_STORE).get(checkpointKey(boundary)),
    )) as StoredDocumentLocalCheckpoint | undefined;
    await transactionComplete(transaction);
    return stored ? fromStoredCheckpoint(stored, boundary, constraints) : null;
  };

  write = async (
    checkpoint: DocumentLocalCheckpoint,
    constraints?: DocumentLocalCheckpointStateConstraints,
  ): Promise<void> => {
    let stored = toStoredCheckpoint(checkpoint, constraints);
    const database = await this.getDatabase();
    const transaction = database.transaction(CHECKPOINT_STORE, "readwrite");
    const store = transaction.objectStore(CHECKPOINT_STORE);
    const existing = (await requestResult(store.get(stored.key))) as
      | StoredDocumentLocalCheckpoint
      | undefined;
    if (existing) {
      const mergedState = copyState(
        Y.mergeUpdates([new Uint8Array(existing.state), new Uint8Array(stored.state)]),
        constraints,
      );
      stored = {
        ...stored,
        headSeq: Math.max(existing.headSeq, stored.headSeq),
        state: mergedState.buffer.slice(
          mergedState.byteOffset,
          mergedState.byteOffset + mergedState.byteLength,
        ) as ArrayBuffer,
      };
    }
    store.put(stored);
    await transactionComplete(transaction);
  };

  clearDocument = async (documentId: DocumentId): Promise<void> => {
    const normalizedDocumentId = requireIdentity(documentId, "documentId");
    const database = await this.getDatabase();
    const transaction = database.transaction(CHECKPOINT_STORE, "readwrite");
    const index = transaction.objectStore(CHECKPOINT_STORE).index(DOCUMENT_ID_INDEX);
    const request = index.openCursor(normalizedDocumentId);
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Could not clear Document checkpoints"));
    });
    await transactionComplete(transaction);
  };

  private getDatabase(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = openCheckpointDatabase(this.factory).then(
        (database) => {
          database.onversionchange = () => {
            database.close();
            this.databasePromise = null;
          };
          return database;
        },
        (error) => {
          this.databasePromise = null;
          throw error;
        },
      );
    }
    return this.databasePromise;
  }
}

export const createDefaultDocumentLocalCheckpointStore =
  (): DocumentLocalCheckpointStore | null => {
    if (typeof globalThis.indexedDB === "undefined") return null;
    return new IndexedDbDocumentLocalCheckpointStore(globalThis.indexedDB);
  };

export const captureDocumentLocalCheckpoint = (
  document: Y.Doc,
  input: DocumentCheckpointBoundary & { readonly headSeq: number },
  schemaAdapter: DocumentLocalCheckpointSchemaAdapter = DEFAULT_CARD_SCHEMA_ADAPTER,
): DocumentLocalCheckpoint => {
  const boundary = validateBoundary(input);
  assertValidDocumentState(document, schemaAdapter);
  return {
    ...boundary,
    headSeq: requireHeadSeq(input.headSeq),
    state: copyState(Y.encodeStateAsUpdate(document), schemaAdapter.limits),
    updatedAt: new Date().toISOString(),
  };
};

export const restoreDocumentLocalCheckpoint = (
  document: Y.Doc,
  serverStateVector: Uint8Array,
  checkpoint: DocumentLocalCheckpoint,
  origin: unknown,
  schemaAdapter: DocumentLocalCheckpointSchemaAdapter = DEFAULT_CARD_SCHEMA_ADAPTER,
): Uint8Array => {
  const boundary = validateBoundary(checkpoint);
  requireHeadSeq(checkpoint.headSeq);
  const checkpointState = copyState(checkpoint.state, schemaAdapter.limits);
  const durableSnapshot = Y.snapshot(document);
  const candidate = new Y.Doc({ guid: boundary.documentId });
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document), "checkpoint-current");
    Y.applyUpdate(candidate, checkpointState, "checkpoint-candidate");
    assertValidDocumentState(candidate, schemaAdapter);
    const missingOnServer = Y.equalSnapshots(durableSnapshot, Y.snapshot(candidate))
      ? EMPTY_DOCUMENT_UPDATE.slice()
      : Y.encodeStateAsUpdate(candidate, serverStateVector);
    Y.applyUpdate(document, checkpointState, origin);
    return missingOnServer.slice();
  } catch (error) {
    throw new DocumentLocalCheckpointError(
      `Could not restore local checkpoint for ${boundary.documentId}`,
      { cause: error },
    );
  } finally {
    candidate.destroy();
  }
};

export const hasDocumentUpdateContent = (update: Uint8Array): boolean => {
  try {
    const decoded = Y.decodeUpdate(update);
    return decoded.structs.length > 0 || decoded.ds.clients.size > 0;
  } catch (error) {
    throw new DocumentLocalCheckpointError("Invalid encoded Yjs update", {
      cause: error,
    });
  }
};
