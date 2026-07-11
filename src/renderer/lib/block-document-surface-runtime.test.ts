import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness.js";
import {
  CANVAS_BLOCK_TYPE,
  CANVAS_DOCUMENT_SCHEMA_KEY,
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
  assertValidCardDocumentRoots,
  createCardDocument,
  type DocumentSyncCommandError,
  type OwnedBlockDocumentDescriptor,
} from "../../shared/block-documents";
import type {
  DocumentLocalCheckpoint,
  DocumentLocalCheckpointStore,
} from "./document-local-checkpoint";
import type {
  DocumentSyncAdapter,
  NodexYProviderOptions,
  NodexYProviderStatus,
} from "./nodex-y-provider";
import {
  BlockDocumentSurfaceRuntime,
  type BlockDocumentSurfaceProvider,
} from "./block-document-surface-runtime";

const descriptor = (
  overrides: Partial<OwnedBlockDocumentDescriptor> = {},
): OwnedBlockDocumentDescriptor => ({
  projectId: "project-1",
  ownerBlockId: "card-1",
  ownerType: "card",
  ownerLifecycle: "active",
  documentId: "document:card-1",
  storeEpoch: "store-1",
  generation: 1,
  headSeq: 1,
  schemaKey: CARD_DOCUMENT_SCHEMA_KEY,
  schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
  readiness: "ready",
  authority: "ydoc_primary",
  stateVector: new Uint8Array([0]),
  ...overrides,
});

const unusedAdapter: DocumentSyncAdapter = {
  sync: async () => {
    throw new Error("Fake provider owns sync");
  },
  applyUpdate: async () => {
    throw new Error("Fake provider owns updates");
  },
  subscribe: () => () => undefined,
  publishAwareness: async () => {
    throw new Error("Fake provider owns awareness");
  },
  respondToRelocationLease: async () => {
    throw new Error("Fake provider owns relocation leases");
  },
};

const providerError = (
  code: DocumentSyncCommandError["code"],
  resetRequired: boolean,
): DocumentSyncCommandError => ({
  code,
  message: code,
  retryable: false,
  resetRequired,
});

let fakeProviderSequence = 0;

class FakeSurfaceProvider implements BlockDocumentSurfaceProvider {
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly clientSessionId: string;
  readonly options: NodexYProviderOptions;
  readonly events: string[];
  flushPromise: Promise<void> = Promise.resolve();
  checkpointPromise: Promise<void> = Promise.resolve();
  onConnect: (() => void | Promise<void>) | null = null;

  private status: NodexYProviderStatus;
  private readonly listeners = new Set<() => void>();

  constructor(options: NodexYProviderOptions, events: string[]) {
    fakeProviderSequence += 1;
    this.options = options;
    this.document = options.document;
    this.awareness = new Awareness(this.document);
    this.clientSessionId = `fake-client-${fakeProviderSequence}`;
    this.events = events;
    this.status = {
      phase: "idle",
      documentId: options.documentId,
      clientSessionId: this.clientSessionId,
      connected: false,
      headSeq: 0,
      pendingUpdateCount: 0,
    };
  }

  getStatus = (): NodexYProviderStatus => this.status;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.events.push("subscribe");
    this.listeners.add(listener);
    return () => {
      this.events.push("unsubscribe");
      this.listeners.delete(listener);
    };
  };

  connect = async (): Promise<void> => {
    this.events.push("connect");
    await this.onConnect?.();
  };

  disconnect = (): void => {
    this.events.push("disconnect");
  };

  flush = (): Promise<void> => {
    this.events.push("flush");
    return this.flushPromise;
  };

  checkpoint = (): Promise<void> => {
    this.events.push("checkpoint");
    return this.checkpointPromise;
  };

  destroy = (): void => {
    this.events.push("provider-destroy");
    this.awareness.destroy();
  };

  emit = (input: Partial<NodexYProviderStatus>): void => {
    this.status = { ...this.status, ...input };
    this.events.push(`status:${this.status.phase}`);
    for (const listener of this.listeners) listener();
  };
}

class MemoryCheckpointStore implements DocumentLocalCheckpointStore {
  checkpoint: DocumentLocalCheckpoint | null = null;
  reads = 0;
  writes = 0;
  clears = 0;

  read = async (): Promise<DocumentLocalCheckpoint | null> => {
    this.reads += 1;
    return this.checkpoint;
  };

  write = async (checkpoint: DocumentLocalCheckpoint): Promise<void> => {
    this.writes += 1;
    this.checkpoint = checkpoint;
  };

  clearDocument = async (): Promise<void> => {
    this.clears += 1;
    this.checkpoint = null;
  };
}

const createFactory =
  (providers: FakeSurfaceProvider[], events: string[]) =>
  (options: NodexYProviderOptions): FakeSurfaceProvider => {
    const provider = new FakeSurfaceProvider(options, events);
    providers.push(provider);
    return provider;
  };

const applyServerDocument = (document: Y.Doc, documentId: string): void => {
  const server = createCardDocument({
    documentId,
    initialTitle: "Server title",
  });
  try {
    Y.applyUpdate(
      document,
      Y.encodeStateAsUpdate(server.document),
      "server-sync",
    );
  } finally {
    server.document.destroy();
  }
};

const never = (): Promise<void> => new Promise<void>(() => undefined);

describe("BlockDocumentSurfaceRuntime", () => {
  test("subscribes and syncs before opening or exposing the Card document", async () => {
    const events: string[] = [];
    const providers: FakeSurfaceProvider[] = [];
    const runtime = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor(),
      adapter: unusedAdapter,
      createProvider: createFactory(providers, events),
      openDocument: (document) => {
        events.push("open");
        return { kind: "card", ...assertValidCardDocumentRoots(document) };
      },
      localCheckpointStore: null,
    });
    const provider = providers[0];
    if (!provider) throw new Error("Expected provider");
    provider.onConnect = () => {
      provider.emit({ phase: "connecting", connected: true });
      applyServerDocument(provider.document, provider.options.documentId);
      provider.emit({
        phase: "synced",
        connected: true,
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 1,
      });
    };

    expect(runtime.getReadyDocument()).toBe(null);
    expect(events.join(",")).toBe("subscribe");
    let statusNotifications = 0;
    runtime.subscribe(() => {
      statusNotifications += 1;
    });

    const ready = runtime.whenReady();
    await runtime.connect();
    const readyDocument = await ready;
    expect(
      readyDocument.kind === "card"
        ? readyDocument.title.toString()
        : "wrong-kind",
    ).toBe("Server title");
    expect(runtime.getStatus().phase).toBe("ready");
    expect(runtime.getStatus().ready).toBe(true);
    expect(events.join(",")).toBe(
      "subscribe,connect,status:connecting,status:synced,open",
    );
    expect(statusNotifications > 0).toBe(true);
    await runtime.flush();
    await runtime.checkpoint();
    expect(events.includes("flush")).toBe(true);
    expect(events.includes("checkpoint")).toBe(true);
    await runtime.close();
  });

  test("creates a distinct Y.Doc and provider client for every surface", async () => {
    const providers: FakeSurfaceProvider[] = [];
    const first = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor(),
      adapter: unusedAdapter,
      createProvider: createFactory(providers, []),
      localCheckpointStore: null,
    });
    const second = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor(),
      adapter: unusedAdapter,
      createProvider: createFactory(providers, []),
      localCheckpointStore: null,
    });

    expect(first.document === second.document).toBe(false);
    expect(first.document.clientID === second.document.clientID).toBe(false);
    expect(first.clientSessionId === second.clientSessionId).toBe(false);
    expect(providers[0]?.options.autoConnect).toBe(false);
    expect(providers[1]?.options.autoConnect).toBe(false);
    await Promise.all([first.close(), second.close()]);
  });

  test("passes the descriptor schema identity to local checkpoint recovery", async () => {
    const providers: FakeSurfaceProvider[] = [];
    const runtime = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor({
        ownerBlockId: "canvas-1",
        ownerType: CANVAS_BLOCK_TYPE,
        documentId: "document:canvas-1",
        schemaKey: CANVAS_DOCUMENT_SCHEMA_KEY,
        schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
      }),
      adapter: unusedAdapter,
      createProvider: createFactory(providers, []),
      localCheckpointStore: null,
    });
    const provider = providers[0];
    if (!provider) throw new Error("Expected provider");

    expect(provider.options.documentSchema?.ownerType).toBe(CANVAS_BLOCK_TYPE);
    expect(provider.options.documentSchema?.schemaKey).toBe(
      CANVAS_DOCUMENT_SCHEMA_KEY,
    );
    expect(provider.options.documentSchema?.schemaVersion).toBe(
      CANVAS_DOCUMENT_SCHEMA_VERSION,
    );
    await runtime.close();
  });

  test("runs only surface-local relocation preparers and exposes the write fence", async () => {
    const providers: FakeSurfaceProvider[] = [];
    const first = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor(),
      adapter: unusedAdapter,
      createProvider: createFactory(providers, []),
      localCheckpointStore: null,
    });
    const second = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor({ ownerBlockId: "card-2" }),
      adapter: unusedAdapter,
      createProvider: createFactory(providers, []),
      localCheckpointStore: null,
    });
    const firstProvider = providers[0];
    const secondProvider = providers[1];
    if (!firstProvider || !secondProvider)
      throw new Error("Expected providers");
    const preparations: string[] = [];
    const unregister = first.registerRelocationPreparer(async (event) => {
      preparations.push(`${event.leaseId}:${event.clientSessionId}`);
      await Promise.resolve();
      preparations.push("first-ready");
    });
    second.registerRelocationPreparer(() => {
      preparations.push("wrong-surface");
    });
    const event = {
      kind: "relocation-lease-prepare" as const,
      leaseId: "lease-1",
      documentId: descriptor().documentId,
      clientSessionId: first.clientSessionId,
      storeEpoch: "store-1",
      generation: 1,
      expectedHeadSeq: 2,
      deadlineAt: Date.now() + 10_000,
    };

    firstProvider.emit({ phase: "relocating" });
    expect(first.getStatus().phase).toBe("relocating");
    expect(first.getStatus().writeFrozen).toBe(true);
    expect(first.getWriteFrozen()).toBe(true);
    await firstProvider.options.prepareSurfaceForRelocation?.(event);
    expect(preparations.join(",")).toBe(
      `lease-1:${first.clientSessionId},first-ready`,
    );

    firstProvider.emit({ phase: "frozen" });
    expect(first.getStatus().phase).toBe("frozen");
    unregister();
    await firstProvider.options.prepareSurfaceForRelocation?.({
      ...event,
      leaseId: "lease-2",
    });
    expect(preparations.includes("wrong-surface")).toBe(false);
    firstProvider.emit({ phase: "synced" });
    expect(first.getWriteFrozen()).toBe(false);
    await Promise.all([first.close(), second.close()]);
  });

  test("rejects an unregistered owner before allocating a collaborative surface", () => {
    let providersCreated = 0;
    let errorMessage = "";
    try {
      new BlockDocumentSurfaceRuntime({
        descriptor: descriptor({ ownerType: "database" }),
        adapter: unusedAdapter,
        createProvider: (options) => {
          providersCreated += 1;
          return new FakeSurfaceProvider(options, []);
        },
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    expect(errorMessage).toBe(
      "No owned Document Adapter is registered for database/nodex.card@1",
    );
    expect(providersCreated).toBe(0);
  });

  test("clears presence without disconnecting a retained ready surface", async () => {
    const events: string[] = [];
    const providers: FakeSurfaceProvider[] = [];
    const runtime = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor(),
      adapter: unusedAdapter,
      createProvider: createFactory(providers, events),
      localCheckpointStore: null,
    });
    const provider = providers[0];
    if (!provider) throw new Error("Expected provider");
    provider.onConnect = () => {
      applyServerDocument(provider.document, provider.options.documentId);
      provider.emit({
        phase: "synced",
        connected: true,
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 1,
      });
    };
    await runtime.connect();
    await runtime.whenReady();
    runtime.awareness.setLocalState({ user: "Ada" });

    runtime.clearLocalAwareness();

    expect(runtime.awareness.getLocalState()).toBe(null);
    expect(runtime.getStatus().phase).toBe("ready");
    expect(events.includes("disconnect")).toBe(false);
    await runtime.close();
  });

  test("passes the descriptor generation fence and blocks reset before open", async () => {
    const providers: FakeSurfaceProvider[] = [];
    const checkpoints = new MemoryCheckpointStore();
    const reloads: string[] = [];
    const runtime = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor({ generation: 7, storeEpoch: "store-7" }),
      adapter: unusedAdapter,
      createProvider: createFactory(providers, []),
      localCheckpointStore: checkpoints,
      reload: ({ reason }) => {
        reloads.push(reason);
      },
    });
    const provider = providers[0];
    if (!provider) throw new Error("Expected provider");
    expect(provider.options.expectedGeneration).toBe(7);
    expect(provider.options.expectedStoreEpoch).toBe("store-7");
    provider.onConnect = () => {
      provider.emit({
        phase: "reset-required",
        error: providerError("document_generation_mismatch", true),
      });
    };

    const waiting = runtime.whenReady().then(
      () => "ready",
      () => "reset",
    );
    await runtime.connect();
    expect(await waiting).toBe("reset");
    expect(runtime.getReadyDocument()).toBe(null);
    expect(runtime.getStatus().phase).toBe("reset-required");
    expect(runtime.getStatus().reloadRequired).toBe(true);
    expect(reloads.length).toBe(0);
    await runtime.reload();
    expect(reloads.join(",")).toBe("reset-required");
    expect(checkpoints.clears).toBe(1);
  });

  test("bounds offline close and destroys the provider before its Y.Doc", async () => {
    const events: string[] = [];
    const providers: FakeSurfaceProvider[] = [];
    const runtime = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor(),
      adapter: unusedAdapter,
      createDocument: (input) => {
        const document = new Y.Doc({ guid: input.documentId });
        const destroy = document.destroy.bind(document);
        document.destroy = () => {
          events.push("document-destroy");
          destroy();
        };
        return document;
      },
      createProvider: createFactory(providers, events),
      localCheckpointStore: null,
      closeTimeoutMs: 5,
    });
    const provider = providers[0];
    if (!provider) throw new Error("Expected provider");
    provider.flushPromise = never();
    provider.checkpointPromise = never();
    provider.emit({ phase: "offline", connected: false });

    const result = await runtime.close();
    expect(result.timedOut).toBe(true);
    expect(result.flush).toBe("timed-out");
    expect(result.checkpoint).toBe("timed-out");
    expect(
      events.indexOf("provider-destroy") < events.indexOf("document-destroy"),
    ).toBe(true);
    expect(runtime.getStatus().phase).toBe("closed");
  });

  test("coalesces bounded persistence without disconnecting the live surface", async () => {
    const events: string[] = [];
    const providers: FakeSurfaceProvider[] = [];
    const runtime = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor(),
      adapter: unusedAdapter,
      createProvider: createFactory(providers, events),
      localCheckpointStore: null,
      closeTimeoutMs: 5,
    });
    const provider = providers[0];
    if (!provider) throw new Error("Expected provider");
    provider.flushPromise = never();
    provider.checkpointPromise = never();

    const first = runtime.persist();
    const second = runtime.persist();
    expect(first === second).toBe(true);
    const result = await first;

    expect(result.timedOut).toBe(true);
    expect(result.flush).toBe("timed-out");
    expect(result.checkpoint).toBe("timed-out");
    expect(events.filter((event) => event === "flush").length).toBe(1);
    expect(events.filter((event) => event === "checkpoint").length).toBe(1);
    expect(events.includes("disconnect")).toBe(false);
    expect(events.includes("provider-destroy")).toBe(false);
    await runtime.close();
  });

  test("isolates fatal checkpoints and invokes the reload seam only once", async () => {
    const providers: FakeSurfaceProvider[] = [];
    const checkpoints = new MemoryCheckpointStore();
    const reloads: string[] = [];
    const runtime = new BlockDocumentSurfaceRuntime({
      descriptor: descriptor(),
      adapter: unusedAdapter,
      createProvider: createFactory(providers, []),
      localCheckpointStore: checkpoints,
      reload: ({ reason }) => {
        reloads.push(reason);
      },
    });
    const provider = providers[0];
    if (!provider) throw new Error("Expected provider");
    provider.onConnect = () => {
      applyServerDocument(provider.document, provider.options.documentId);
      provider.emit({
        phase: "synced",
        connected: true,
        storeEpoch: "store-1",
        generation: 1,
        headSeq: 1,
      });
    };
    await runtime.connect();
    await runtime.whenReady();

    const providerCheckpointStore = provider.options.localCheckpointStore;
    if (!providerCheckpointStore) throw new Error("Expected isolated store");
    const checkpoint: DocumentLocalCheckpoint = {
      documentId: "document:card-1",
      storeEpoch: "store-1",
      generation: 1,
      headSeq: 1,
      state: Y.encodeStateAsUpdate(provider.document),
      updatedAt: new Date().toISOString(),
    };
    await providerCheckpointStore.write(checkpoint);
    expect(checkpoints.writes).toBe(1);

    provider.emit({
      phase: "error",
      connected: false,
      error: providerError("invalid_document_update", false),
    });
    provider.emit({
      phase: "error",
      connected: false,
      error: providerError("invalid_document_update", false),
    });
    await providerCheckpointStore.write(checkpoint);
    expect(checkpoints.writes).toBe(1);
    expect(runtime.getReadyDocument()).toBe(null);
    expect(runtime.getStatus().phase).toBe("error");
    expect(reloads.length).toBe(0);

    await Promise.all([runtime.reload(), runtime.reload()]);
    expect(checkpoints.clears).toBe(1);
    expect(checkpoints.checkpoint).toBe(null);
    expect(reloads.join(",")).toBe("fatal");
  });
});
