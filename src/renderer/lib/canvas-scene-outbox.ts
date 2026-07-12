import {
  canonicalizeCanvasSceneMutationRequest,
  type CanvasSceneMutationRequest,
} from "../../shared/block-documents";

export interface CanvasSceneOutbox {
  list: (documentId: string) => Promise<readonly CanvasSceneMutationRequest[]>;
  put: (request: CanvasSceneMutationRequest) => Promise<void>;
  remove: (documentId: string, mutationId: string) => Promise<void>;
  clear: (documentId: string) => Promise<void>;
}

/** Deterministic test/default-memory implementation; production may use IndexedDB. */
export class MemoryCanvasSceneOutbox implements CanvasSceneOutbox {
  private readonly requests = new Map<
    string,
    Map<string, CanvasSceneMutationRequest>
  >();

  list = async (
    documentId: string,
  ): Promise<readonly CanvasSceneMutationRequest[]> =>
    [...(this.requests.get(documentId)?.values() ?? [])];

  put = async (request: CanvasSceneMutationRequest): Promise<void> => {
    const documentRequests = this.requests.get(request.documentId)
      ?? new Map<string, CanvasSceneMutationRequest>();
    const existing = documentRequests.get(request.mutationId);
    if (existing && existing !== request) {
      throw new Error(
        `Canvas mutation ${request.mutationId} already exists in the outbox`,
      );
    }
    documentRequests.set(request.mutationId, request);
    this.requests.set(request.documentId, documentRequests);
  };

  remove = async (documentId: string, mutationId: string): Promise<void> => {
    const documentRequests = this.requests.get(documentId);
    if (!documentRequests) return;
    documentRequests.delete(mutationId);
    if (documentRequests.size === 0) this.requests.delete(documentId);
  };

  clear = async (documentId: string): Promise<void> => {
    this.requests.delete(documentId);
  };
}

const DATABASE_NAME = "nodex-canvas-scene-outbox";
const DATABASE_VERSION = 1;
const MUTATION_STORE = "canvas-scene-mutations";
const DOCUMENT_ID_INDEX = "document-id";

interface StoredCanvasSceneMutation {
  readonly key: string;
  readonly documentId: string;
  readonly mutationId: string;
  readonly request: CanvasSceneMutationRequest;
}

const mutationKey = (documentId: string, mutationId: string): string =>
  JSON.stringify([documentId, mutationId]);

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("Canvas outbox IndexedDB request failed"),
    );
  });

const transactionComplete = (transaction: IDBTransaction): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("Canvas outbox transaction failed"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("Canvas outbox transaction was aborted"),
    );
  });

const openDatabase = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(MUTATION_STORE)) return;
      const store = database.createObjectStore(MUTATION_STORE, {
        keyPath: "key",
      });
      store.createIndex(DOCUMENT_ID_INDEX, "documentId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("Could not open the Canvas scene outbox"),
    );
  });

export class IndexedDbCanvasSceneOutbox implements CanvasSceneOutbox {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  list = async (
    documentId: string,
  ): Promise<readonly CanvasSceneMutationRequest[]> => {
    const database = await this.getDatabase();
    const transaction = database.transaction(MUTATION_STORE, "readonly");
    const stored = await requestResult(
      transaction.objectStore(MUTATION_STORE)
        .index(DOCUMENT_ID_INDEX)
        .getAll(documentId),
    ) as readonly StoredCanvasSceneMutation[];
    await transactionComplete(transaction);
    return [...stored]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((entry) => canonicalizeCanvasSceneMutationRequest(entry.request));
  };

  put = async (input: CanvasSceneMutationRequest): Promise<void> => {
    const request = canonicalizeCanvasSceneMutationRequest(input);
    const database = await this.getDatabase();
    const transaction = database.transaction(MUTATION_STORE, "readwrite");
    transaction.objectStore(MUTATION_STORE).put({
      key: mutationKey(request.documentId, request.mutationId),
      documentId: request.documentId,
      mutationId: request.mutationId,
      request,
    } satisfies StoredCanvasSceneMutation);
    await transactionComplete(transaction);
  };

  remove = async (documentId: string, mutationId: string): Promise<void> => {
    const database = await this.getDatabase();
    const transaction = database.transaction(MUTATION_STORE, "readwrite");
    transaction.objectStore(MUTATION_STORE).delete(
      mutationKey(documentId, mutationId),
    );
    await transactionComplete(transaction);
  };

  clear = async (documentId: string): Promise<void> => {
    const database = await this.getDatabase();
    const transaction = database.transaction(MUTATION_STORE, "readwrite");
    const request = transaction.objectStore(MUTATION_STORE)
      .index(DOCUMENT_ID_INDEX)
      .openCursor(documentId);
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
      request.onerror = () => reject(
        request.error ?? new Error("Could not clear the Canvas scene outbox"),
      );
    });
    await transactionComplete(transaction);
  };

  private getDatabase(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = openDatabase(this.factory).then(
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

export const createDefaultCanvasSceneOutbox = (): CanvasSceneOutbox => {
  if (typeof globalThis.indexedDB === "undefined") {
    return new MemoryCanvasSceneOutbox();
  }
  return new IndexedDbCanvasSceneOutbox(globalThis.indexedDB);
};
