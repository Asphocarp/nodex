import {
  canonicalizeCanvasSceneMutationIntent,
  encodeCanonicalCanvasSceneMutationIntent,
  type CanvasSceneMutationIntent,
} from "../../shared/block-documents";

export interface CanvasSceneOutbox {
  list: (documentId: string) => Promise<readonly CanvasSceneMutationIntent[]>;
  put: (intent: CanvasSceneMutationIntent) => Promise<void>;
  remove: (documentId: string, mutationId: string) => Promise<void>;
  clear: (documentId: string) => Promise<void>;
}

/** Deterministic test/default-memory implementation; production may use IndexedDB. */
export class MemoryCanvasSceneOutbox implements CanvasSceneOutbox {
  private readonly intents = new Map<
    string,
    Map<string, CanvasSceneMutationIntent>
  >();

  list = async (
    documentId: string,
  ): Promise<readonly CanvasSceneMutationIntent[]> =>
    [...(this.intents.get(documentId)?.values() ?? [])];

  put = async (input: CanvasSceneMutationIntent): Promise<void> => {
    const intent = canonicalizeCanvasSceneMutationIntent(input);
    const documentIntents = this.intents.get(intent.documentId)
      ?? new Map<string, CanvasSceneMutationIntent>();
    const existing = documentIntents.get(intent.mutationId);
    if (
      existing
      && encodeCanonicalCanvasSceneMutationIntent(existing)
        !== encodeCanonicalCanvasSceneMutationIntent(intent)
    ) {
      throw new Error(
        `Canvas mutation ${intent.mutationId} already exists in the outbox`,
      );
    }
    if (existing) return;
    documentIntents.set(intent.mutationId, intent);
    this.intents.set(intent.documentId, documentIntents);
  };

  remove = async (documentId: string, mutationId: string): Promise<void> => {
    const documentIntents = this.intents.get(documentId);
    if (!documentIntents) return;
    documentIntents.delete(mutationId);
    if (documentIntents.size === 0) this.intents.delete(documentId);
  };

  clear = async (documentId: string): Promise<void> => {
    this.intents.delete(documentId);
  };
}

export const CANVAS_SCENE_OUTBOX_DATABASE_NAME = "nodex-canvas-scene-outbox";
export const CANVAS_SCENE_OUTBOX_DATABASE_VERSION = 2;
const MUTATION_STORE = "canvas-scene-mutations";
const DOCUMENT_MUTATION_INDEX = "document-mutation";
const DOCUMENT_SEQUENCE_INDEX = "document-sequence";

interface StoredCanvasSceneMutation {
  readonly enqueueSequence?: number;
  readonly documentId: string;
  readonly mutationId: string;
  readonly intent: CanvasSceneMutationIntent;
}

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

const createMutationStore = (database: IDBDatabase): IDBObjectStore => {
  const store = database.createObjectStore(MUTATION_STORE, {
    keyPath: "enqueueSequence",
    autoIncrement: true,
  });
  store.createIndex(
    DOCUMENT_MUTATION_INDEX,
    ["documentId", "mutationId"],
    { unique: true },
  );
  store.createIndex(
    DOCUMENT_SEQUENCE_INDEX,
    ["documentId", "enqueueSequence"],
    { unique: true },
  );
  return store;
};

const intentFromVersionOneRow = (value: unknown): CanvasSceneMutationIntent => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Canvas outbox v1 row must be an object");
  }
  const request = (value as Readonly<Record<string, unknown>>).request;
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw new TypeError("Canvas outbox v1 row must contain a request");
  }
  return canonicalizeCanvasSceneMutationIntent(
    Object.fromEntries(
      Object.entries(request).filter(([key]) => key !== "clientSessionId"),
    ),
  );
};

const openDatabase = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(
      CANVAS_SCENE_OUTBOX_DATABASE_NAME,
      CANVAS_SCENE_OUTBOX_DATABASE_VERSION,
    );
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (event.oldVersion === 0) {
        createMutationStore(database);
        return;
      }
      const transaction = request.transaction;
      if (!transaction || !database.objectStoreNames.contains(MUTATION_STORE)) {
        transaction?.abort();
        return;
      }
      const versionOneStore = transaction.objectStore(MUTATION_STORE);
      const rows = versionOneStore.getAll();
      rows.onsuccess = () => {
        try {
          const intents = rows.result.map(intentFromVersionOneRow);
          database.deleteObjectStore(MUTATION_STORE);
          const versionTwoStore = createMutationStore(database);
          for (const intent of intents) {
            versionTwoStore.add({
              documentId: intent.documentId,
              mutationId: intent.mutationId,
              intent,
            } satisfies StoredCanvasSceneMutation);
          }
        } catch {
          transaction.abort();
        }
      };
      rows.onerror = () => transaction.abort();
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
  ): Promise<readonly CanvasSceneMutationIntent[]> => {
    const database = await this.getDatabase();
    const transaction = database.transaction(MUTATION_STORE, "readonly");
    const stored = await requestResult(
      transaction.objectStore(MUTATION_STORE)
        .index(DOCUMENT_SEQUENCE_INDEX)
        .getAll(
          IDBKeyRange.bound(
            [documentId, 0],
            [documentId, Number.MAX_SAFE_INTEGER],
          ),
        ),
    ) as readonly StoredCanvasSceneMutation[];
    await transactionComplete(transaction);
    return [...stored]
      .sort(
        (left, right) =>
          (left.enqueueSequence ?? 0) - (right.enqueueSequence ?? 0),
      )
      .map((entry) => canonicalizeCanvasSceneMutationIntent(entry.intent));
  };

  put = async (input: CanvasSceneMutationIntent): Promise<void> => {
    const intent = canonicalizeCanvasSceneMutationIntent(input);
    const database = await this.getDatabase();
    const transaction = database.transaction(MUTATION_STORE, "readwrite");
    const store = transaction.objectStore(MUTATION_STORE);
    const index = store.index(DOCUMENT_MUTATION_INDEX);
    const existingKey = await requestResult(
      index.getKey([intent.documentId, intent.mutationId]),
    );
    if (existingKey !== undefined) {
      const existing = await requestResult(store.get(existingKey)) as
        | StoredCanvasSceneMutation
        | undefined;
      if (
        existing
        && encodeCanonicalCanvasSceneMutationIntent(existing.intent)
          === encodeCanonicalCanvasSceneMutationIntent(intent)
      ) {
        await transactionComplete(transaction);
        return;
      }
      transaction.abort();
      throw new Error(
        `Canvas mutation ${intent.mutationId} already exists in the outbox`,
      );
    }
    store.add({
      documentId: intent.documentId,
      mutationId: intent.mutationId,
      intent,
    } satisfies StoredCanvasSceneMutation);
    await transactionComplete(transaction);
  };

  remove = async (documentId: string, mutationId: string): Promise<void> => {
    const database = await this.getDatabase();
    const transaction = database.transaction(MUTATION_STORE, "readwrite");
    const store = transaction.objectStore(MUTATION_STORE);
    const existingKey = await requestResult(
      store.index(DOCUMENT_MUTATION_INDEX).getKey([documentId, mutationId]),
    );
    if (existingKey !== undefined) store.delete(existingKey);
    await transactionComplete(transaction);
  };

  clear = async (documentId: string): Promise<void> => {
    const database = await this.getDatabase();
    const transaction = database.transaction(MUTATION_STORE, "readwrite");
    const request = transaction.objectStore(MUTATION_STORE)
      .index(DOCUMENT_SEQUENCE_INDEX)
      .openCursor(
        IDBKeyRange.bound(
          [documentId, 0],
          [documentId, Number.MAX_SAFE_INTEGER],
        ),
      );
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
